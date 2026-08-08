import _ from "lodash";

import {
  eventCityLocation,
  normalizeGeocodeQuery,
} from "../calendar/address.utils.js";
import dayjs, { type Dayjs } from "../calendar/calendar.dates.js";
import { eventEndInTimeZone } from "../calendar/calendar.utils.js";
import type { CalendarEvent } from "../calendar/calendar.types.js";
import {
  buildCoordinateRecord,
  getCoordinateStore,
  type CoordinateStore,
} from "./geocode.store.js";
import type { GeocodeLogger } from "./geocode.types.js";
import { validateGeocodeResult } from "./geocode.validation.js";
import {
  createNominatimGeocoder,
  type NominatimGeocoder,
} from "./nominatim.js";

// A venue OSM did not know about last week may be mapped by next week, and this
// process may run for months without a restart, so a failure has to age out on
// its own rather than wait for a deploy. Weeks, not the 30 minutes the calendar
// refreshes on: retrying a dead address every cycle is what turns a handful of
// venues into steady background traffic.
const NEGATIVE_RETRY_MS = 7 * 24 * 60 * 60_000;
// Two failures in a row means the provider is down or throttling us. Continuing
// down the queue would just spend the rest of the run collecting 429s.
const MAX_CONSECUTIVE_FAILURES = 2;

interface GeocodeTarget {
  // The normalized query, which is also the store key. Keying on this means a
  // cosmetic venue-name edit does not re-geocode an identical street address.
  key: string;
  // The verbatim LOCATION, kept for the raw fallback query.
  raw: string;
  // Earliest start among the address's events that have not ended yet. Drives
  // the queue order so a cold backfill fills in the soonest shows first.
  nextOccurrence: Dayjs;
  eventCount: number;
}

interface GeocodeRunSummary {
  addresses: number;
  queued: number;
  resolved: number;
  rejected: number;
  unresolvable: number;
  failed: number;
  aborted: boolean;
  skipped: boolean;
}

interface GeocodeDecorationJob {
  run(events: readonly CalendarEvent[]): Promise<GeocodeRunSummary>;
  stop(): Promise<void>;
}

interface GeocodeDecorationJobOptions {
  logger: GeocodeLogger;
  store?: CoordinateStore;
  geocoder?: NominatimGeocoder;
  now?: () => Dayjs;
  negativeRetryMs?: number;
  fallbackTimeZone?: string;
}

// Step 1 through 6 of the decoration algorithm: dedupe by address, drop
// addresses whose events are all in the past, then order by how soon a visitor
// needs the pin.
export function collectGeocodeTargets(
  events: readonly CalendarEvent[],
  now: Dayjs,
  fallbackTimeZone = "UTC",
): GeocodeTarget[] {
  const byKey = new Map<string, GeocodeTarget>();

  for (const event of events) {
    const raw = event.location ?? event.address;

    // `end` rather than `start`, so a show that is on right now still counts as
    // needing a pin. Its start is in the past, which sorts it first — correct,
    // since it is the soonest thing a visitor could be looking for.
    if (!raw || eventEndInTimeZone(event, fallbackTimeZone).isBefore(now)) {
      continue;
    }

    const key = normalizeGeocodeQuery(raw);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, { key, raw, nextOccurrence: event.start, eventCount: 1 });
      continue;
    }

    byKey.set(key, {
      ...existing,
      nextOccurrence: event.start.isBefore(existing.nextOccurrence)
        ? event.start
        : existing.nextOccurrence,
      eventCount: existing.eventCount + 1,
    });
  }

  return _.sortBy([...byKey.values()], (target) =>
    target.nextOccurrence.valueOf(),
  );
}

export function createGeocodeDecorationJob(
  options: GeocodeDecorationJobOptions,
): GeocodeDecorationJob {
  return new NominatimDecorationJob(options);
}

type TargetOutcome = "resolved" | "rejected" | "unresolvable" | "failed";

class NominatimDecorationJob implements GeocodeDecorationJob {
  private readonly logger: GeocodeLogger;
  private readonly store: CoordinateStore;
  private readonly geocoder: NominatimGeocoder;
  private readonly now: () => Dayjs;
  private readonly negativeRetryMs: number;
  private readonly fallbackTimeZone: string;
  private running = false;

  constructor(options: GeocodeDecorationJobOptions) {
    this.logger = options.logger;
    this.store = options.store ?? getCoordinateStore();
    this.geocoder =
      options.geocoder ?? createNominatimGeocoder({ logger: options.logger });
    this.now = options.now ?? (() => dayjs());
    this.negativeRetryMs = options.negativeRetryMs ?? NEGATIVE_RETRY_MS;
    this.fallbackTimeZone = options.fallbackTimeZone ?? "UTC";
  }

  async run(events: readonly CalendarEvent[]): Promise<GeocodeRunSummary> {
    const targets = collectGeocodeTargets(
      events,
      this.now(),
      this.fallbackTimeZone,
    );
    const summary: GeocodeRunSummary = {
      addresses: targets.length,
      queued: 0,
      resolved: 0,
      rejected: 0,
      unresolvable: 0,
      failed: 0,
      aborted: false,
      skipped: false,
    };

    // A cold backfill can outlast the 30-minute refresh interval. Skipping the
    // overlapping run keeps requests serialized; stacking them would break the
    // one-request-per-second floor.
    if (this.running) {
      this.logger.warn(
        { addresses: targets.length },
        "Coordinate decoration skipped because the previous run is still going",
      );

      return { ...summary, skipped: true };
    }

    this.running = true;

    try {
      const queue = targets.filter((target) => this.needsGeocode(target));

      summary.queued = queue.length;

      // Steady state. Every address is already resolved, so there is nothing to
      // ask anyone and nothing worth logging.
      if (!queue.length) {
        return summary;
      }

      this.logger.info(
        {
          addresses: targets.length,
          queued: queue.length,
          storedAddresses: this.store.size(),
        },
        "Coordinate decoration started",
      );

      let consecutiveFailures = 0;

      for (const target of queue) {
        const outcome = await this.resolveTarget(target);

        summary[outcome] += 1;

        if (outcome !== "failed") {
          consecutiveFailures = 0;
          continue;
        }

        consecutiveFailures += 1;

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          summary.aborted = true;
          this.logger.warn(
            { ...summary, remaining: queue.length - summaryAttempts(summary) },
            "Coordinate decoration aborted after repeated geocoder failures",
          );
          break;
        }
      }

      this.logger.info({ ...summary }, "Coordinate decoration finished");

      return summary;
    } finally {
      this.running = false;
    }
  }

  async stop(): Promise<void> {
    await this.geocoder.stop();
  }

  private needsGeocode(target: GeocodeTarget): boolean {
    const record = this.store.get(target.key);

    if (!record) {
      return true;
    }

    // Addresses do not move. Once an address has coordinates that answer is
    // permanent and never re-queried.
    if (record.status === "resolved") {
      return false;
    }

    // A failure is remembered so it does not re-enter the queue every 30 minutes,
    // but only until it goes stale — otherwise a venue that failed once would
    // stay uncoordinated for as long as the process lives, which may be forever.
    return (
      this.now().diff(dayjs(record.attemptedAt), "millisecond") >=
      this.negativeRetryMs
    );
  }

  private async resolveTarget(target: GeocodeTarget): Promise<TargetOutcome> {
    // The city and state a result has to match come from the LOCATION string
    // itself, never from the geocoder.
    const expected = eventCityLocation(target.raw);

    if (!expected) {
      // No city or state to check an answer against, so any result would be
      // unverifiable. Record it without spending a request.
      return this.storeFailure(target, "unresolvable", {
        reason: "no city and state could be parsed from the location",
      });
    }

    let rejectionReason: string | undefined;
    let deterministicFailure: string | undefined;

    for (const query of buildQueries(target)) {
      const result = await this.geocoder.geocode(query);

      if (result.kind === "failed" && result.failure !== "address") {
        // The provider timed out, throttled us, or is refusing us outright.
        // Nothing is stored, because none of that rules the address out —
        // caching a 403 from a blocked IP would blank every venue for a week
        // over a block that lifts in minutes. These are also the only failures
        // that count toward the run's abort, which is what stops a backfill from
        // working down the queue collecting the same refusal.
        this.logger.warn(
          {
            address: target.key,
            query,
            reason: result.reason,
            failure: result.failure,
          },
          "Geocoder request failed, leaving the address queued",
        );

        return "failed";
      }

      if (result.kind === "failed") {
        // The query itself is malformed, so it will be malformed on the next
        // refresh too. This has to reach the store or it re-queues every 30
        // minutes forever.
        deterministicFailure = result.reason;
        continue;
      }

      if (result.kind === "no-result") {
        continue;
      }

      const validation = validateGeocodeResult(result.address, expected);

      if (validation.ok) {
        this.store.set(
          target.key,
          buildCoordinateRecord({
            status: "resolved",
            coordinates: result.coordinates,
            attemptedAt: this.now().toISOString(),
          }),
        );

        return "resolved";
      }

      rejectionReason = validation.reason;
    }

    // Both queries are exhausted. The normalize-to-raw retry is the only
    // broadening we allow; widening further would trade precision for a pin we
    // cannot stand behind.
    return this.storeFailure(
      target,
      rejectionReason ? "rejected" : "unresolvable",
      { reason: rejectionReason ?? deterministicFailure },
    );
  }

  private storeFailure(
    target: GeocodeTarget,
    status: "rejected" | "unresolvable",
    details: { reason?: string },
  ): TargetOutcome {
    this.store.set(
      target.key,
      buildCoordinateRecord({
        status,
        attemptedAt: this.now().toISOString(),
        reason: details.reason,
      }),
    );

    // Never silent. A venue she plays every weekend that never resolves has to
    // be findable by someone reading the logs, since there is no admin UI.
    this.logger.warn(
      {
        address: target.key,
        location: target.raw,
        events: target.eventCount,
        status,
        reason: details.reason,
      },
      "Coordinates unavailable for a venue",
    );

    return status;
  }
}

// Query the normalized address, then fall back to the raw LOCATION, which OSM
// sometimes knows by venue name. When normalization was a no-op the two are
// identical, so the fallback is dropped rather than paying for the same request
// twice.
function buildQueries(target: GeocodeTarget): string[] {
  return target.raw === target.key ? [target.key] : [target.key, target.raw];
}

function summaryAttempts(summary: GeocodeRunSummary): number {
  return (
    summary.resolved + summary.rejected + summary.unresolvable + summary.failed
  );
}
