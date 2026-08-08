import { setTimeout as delay } from "node:timers/promises";
import Bottleneck from "bottleneck";
import { z } from "zod";

import { getErrorDetails } from "../logging.js";
import type { Coordinates, GeocodeLogger } from "./geocode.types.js";

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
// Nominatim's policy requires a descriptive User-Agent naming the application
// with a contact address; requests without one may be blocked. Not configurable,
// because there is no environment where it should differ.
const NOMINATIM_USER_AGENT =
  "samanthadress.com calendar-service (site@samanthadress.com)";
// Generous on purpose. The public instance runs on donated hardware and
// routinely takes several seconds under load; a tight timeout turns "slow but
// working" into three timeouts, an aborted run, and a feed that never resolves
// anything. Nothing waits on this job, so a slow request costs only itself.
const NOMINATIM_TIMEOUT_MS = 10_000;
// Nominatim's published ceiling is an absolute maximum of 1 request per second,
// not a burst allowance, so this is a floor between requests rather than a
// target rate.
const NOMINATIM_MIN_TIME_MS = 1_000;
const NOMINATIM_MAX_ATTEMPTS = 3;
const NOMINATIM_RETRY_BASE_MS = 2_000;
const RESPONSE_BODY_LOG_LIMIT = 200;
const NOMINATIM_RESULT_LIMIT = 10;
const ADDRESSABLE_POI_TYPES = new Set([
  "amenity",
  "office",
  "shop",
  "tourism",
  "leisure",
]);

const ADDRESS_SCHEMA = z.object({
  house_number: z.string().optional(),
  city: z.string().optional(),
  town: z.string().optional(),
  village: z.string().optional(),
  hamlet: z.string().optional(),
  municipality: z.string().optional(),
  suburb: z.string().optional(),
  neighbourhood: z.string().optional(),
  county: z.string().optional(),
  state: z.string().optional(),
  "ISO3166-2-lvl4": z.string().optional(),
  country_code: z.string().optional(),
});

const RESULT_SCHEMA = z.object({
  lat: z.string(),
  lon: z.string(),
  type: z.string().optional(),
  addresstype: z.string().optional(),
  address: ADDRESS_SCHEMA.optional(),
});

const RESPONSE_SCHEMA = z.array(RESULT_SCHEMA);

export type NominatimAddress = z.infer<typeof ADDRESS_SCHEMA>;

export type GeocodeQueryResult =
  | { kind: "resolved"; coordinates: Coordinates; address?: NominatimAddress }
  // The provider answered and has nothing for this query. A real negative worth
  // caching.
  | { kind: "no-result" }
  | { kind: "failed"; reason: string; failure: GeocodeFailureKind };

// "Should I ask again in a moment?" and "has this address been ruled out?" are
// different questions, and only the layer holding the status code can answer the
// second. A 403 is Nominatim's answer to a blocked IP: pointless to retry now,
// but it says nothing about the address, and recording it as an address failure
// would blank every venue for a week over a block that lifts in minutes.
type GeocodeFailureKind =
  // Rate limited, 5xx, timeout, transport error. Worth retrying immediately.
  | "transient"
  // The provider is refusing or broken: 403, 401, an unexpected endpoint status,
  // a body that is not the JSON we asked for. Retrying now will not help, but
  // the address is not implicated, so it must not be cached as a negative.
  | "provider"
  // The request itself is wrong and will be wrong every time it is sent. Only a
  // 400 qualifies: we build every part of the URL except the query string, so
  // that is the only part that can be at fault.
  | "address";

export interface NominatimGeocoder {
  geocode(query: string): Promise<GeocodeQueryResult>;
  stop(): Promise<void>;
}

interface NominatimGeocoderOptions {
  logger: GeocodeLogger;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  minTimeMs?: number;
  maxAttempts?: number;
  retryBaseMs?: number;
}

export function createNominatimGeocoder(
  options: NominatimGeocoderOptions,
): NominatimGeocoder {
  const {
    logger,
    fetchImpl = globalThis.fetch,
    timeoutMs = NOMINATIM_TIMEOUT_MS,
    minTimeMs = NOMINATIM_MIN_TIME_MS,
    maxAttempts = NOMINATIM_MAX_ATTEMPTS,
    retryBaseMs = NOMINATIM_RETRY_BASE_MS,
  } = options;
  // Serializes every request through one queue with a hard minimum spacing, so
  // the normalized query and its raw fallback are also a second apart and no
  // code path can accidentally fan out with Promise.all.
  const limiter = new Bottleneck({
    id: "nominatim",
    maxConcurrent: 1,
    minTime: minTimeMs,
  });

  limiter.on("error", (error) => {
    logger.error(getErrorDetails(error), "Nominatim limiter error");
  });

  async function attempt(query: string): Promise<GeocodeQueryResult> {
    const url = buildSearchUrl(query);

    try {
      const response = await fetchImpl(url, {
        headers: {
          accept: "application/json",
          // Nominatim's policy requires a descriptive User-Agent identifying the
          // application with a contact address. Requests without one are blocked.
          "user-agent": NOMINATIM_USER_AGENT,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const body = await readResponseBody(response);

        return {
          kind: "failed",
          reason: `http ${response.status}${body ? `: ${body}` : ""}`,
          failure: classifyStatus(response.status),
        };
      }

      const parsed = RESPONSE_SCHEMA.safeParse(await response.json());

      if (!parsed.success) {
        // A 200 that is not the JSON we asked for is a maintenance page or a
        // proxy, not a statement about this address.
        return {
          kind: "failed",
          reason: "unexpected response shape",
          failure: "provider",
        };
      }

      const result = selectBestResult(parsed.data, query);

      if (!result) {
        return { kind: "no-result" };
      }

      const coordinates = readCoordinates(result.lat, result.lon);

      if (!coordinates) {
        // Nominatim returning a result with unparseable coordinates is the
        // provider malfunctioning, not the address being unmappable.
        return {
          kind: "failed",
          reason: "result had unusable coordinates",
          failure: "provider",
        };
      }

      return { kind: "resolved", coordinates, address: result.address };
    } catch (error) {
      // Timeout or transport error: the address has not been ruled out.
      return {
        kind: "failed",
        reason: describeError(error),
        failure: "transient",
      };
    }
  }

  return {
    async geocode(query) {
      let last: GeocodeQueryResult = {
        kind: "failed",
        reason: "no attempt made",
        failure: "provider",
      };

      for (let tryNumber = 1; tryNumber <= maxAttempts; tryNumber += 1) {
        // A queued job rejects when stop() drops it, which is an ordinary
        // shutdown rather than something the caller should treat as a throw.
        last = await limiter
          .schedule(() => attempt(query))
          .catch((error: unknown) => ({
            kind: "failed" as const,
            reason: describeError(error),
            failure: "provider" as const,
          }));

        if (last.kind !== "failed" || last.failure !== "transient") {
          return last;
        }

        if (tryNumber < maxAttempts) {
          logger.warn(
            { query, attempt: tryNumber, reason: last.reason },
            "Nominatim request failed, retrying",
          );
          await delay(retryBaseMs * 2 ** (tryNumber - 1));
        }
      }

      return last;
    },
    async stop() {
      await limiter.stop({
        dropWaitingJobs: true,
        dropErrorMessage: "Geocoding stopped",
      });
    },
  };
}

// Beyond the documented query, `addressdetails` is what makes the city/state
// validation possible at all, and `countrycodes` keeps a US venue from matching
// a same-named place abroad. Both narrow the answer; neither widens the query.
function buildSearchUrl(query: string): string {
  const params = new URLSearchParams({
    format: "json",
    limit: String(NOMINATIM_RESULT_LIMIT),
    addressdetails: "1",
    countrycodes: "us",
    q: query,
  });

  return `${NOMINATIM_ENDPOINT}?${params.toString()}`;
}

// Nominatim ranks a road segment above a more useful address when it cannot
// resolve the house number. Keep its ranking for real addressable results, but
// use a small road-type preference as a fallback: residential segments are more
// likely to represent an address than a tertiary road carrying the same name.
function selectBestResult(
  results: z.infer<typeof RESPONSE_SCHEMA>,
  query: string,
): z.infer<typeof RESULT_SCHEMA> | undefined {
  const requestedHouseNumber = readHouseNumber(query);
  let best: z.infer<typeof RESULT_SCHEMA> | undefined;
  let bestScore = -1;

  for (const result of results) {
    const score = scoreResult(result, requestedHouseNumber);

    if (score > bestScore) {
      best = result;
      bestScore = score;
    }
  }

  return best;
}

function scoreResult(
  result: z.infer<typeof RESULT_SCHEMA>,
  requestedHouseNumber: string | undefined,
): number {
  const houseNumber = result.address?.house_number?.toUpperCase();

  if (houseNumber && houseNumber === requestedHouseNumber) {
    return 300;
  }

  if (houseNumber || result.type === "house" || result.type === "building") {
    return 200;
  }

  if (ADDRESSABLE_POI_TYPES.has(result.addresstype ?? "")) {
    return 100;
  }

  if (result.addresstype !== "road") {
    return 0;
  }

  return (
    {
      residential: 30,
      unclassified: 20,
      tertiary: 10,
    }[result.type ?? ""] ?? 0
  );
}

function readHouseNumber(query: string): string | undefined {
  return query
    .match(/^\s*(\d+[A-Za-z]?(?:-\d+[A-Za-z]?)?)(?:\s|,|$)/)?.[1]
    ?.toUpperCase();
}

// Only a 400 blames the query string. Everything else the provider can say —
// 403 for a blocked IP, 401, an unexpected status — is about the provider or
// the connection, and must never be recorded against an address.
function classifyStatus(status: number): GeocodeFailureKind {
  if (status === 429 || (status >= 500 && status <= 599)) {
    return "transient";
  }

  return status === 400 ? "address" : "provider";
}

function readCoordinates(lat: string, lon: string): Coordinates | null {
  const parsedLat = Number(lat);
  const parsedLon = Number(lon);

  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLon)) {
    return null;
  }

  return { lat: parsedLat, lon: parsedLon };
}

async function readResponseBody(response: Response): Promise<string> {
  try {
    return (await response.text())
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, RESPONSE_BODY_LOG_LIMIT);
  } catch {
    return "";
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "TimeoutError" ? "timeout" : error.message;
  }

  return String(error);
}
