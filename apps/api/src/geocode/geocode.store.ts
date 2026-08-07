import type { CoordinateRecord } from "./geocode.types.js";

export interface CoordinateStore {
  get(key: string): CoordinateRecord | undefined;
  set(key: string, record: CoordinateRecord): void;
  entries(): [string, CoordinateRecord][];
  size(): number;
}

// Deliberately in-memory and deliberately lost on deploy. The distinct venue
// count is small — addresses dedupe hard, since the same rooms come back week
// after week — so a cold backfill is a couple of minutes at one request per
// second, once per release. Paying for a volume to skip that was not worth the
// ops coupling of pinning the app to one machine in one region.
//
// This is a cache, not a record: nothing outside the process should depend on it
// surviving, and nothing inside it should depend on the process being restarted.
// A failed address ages out on its own (see NEGATIVE_RETRY_MS) rather than
// waiting for a deploy, because this may run for months without one.
export function createCoordinateStore(): CoordinateStore {
  const records = new Map<string, CoordinateRecord>();

  return {
    get(key) {
      return records.get(key);
    },
    set(key, record) {
      records.set(key, record);
    },
    entries() {
      return [...records.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      );
    },
    size() {
      return records.size;
    },
  };
}

let sharedStore: CoordinateStore | undefined;

// One store per process, shared by the decoration job that writes it and the
// Samantha Dress service that reads it.
export function getCoordinateStore(): CoordinateStore {
  sharedStore ??= createCoordinateStore();

  return sharedStore;
}

export function clearCoordinateStore(): void {
  sharedStore = undefined;
}

export function buildCoordinateRecord(options: {
  status: CoordinateRecord["status"];
  coordinates?: CoordinateRecord["coordinates"];
  attemptedAt: string;
  reason?: string;
}): CoordinateRecord {
  return {
    status: options.status,
    coordinates: options.coordinates ?? null,
    attemptedAt: options.attemptedAt,
    reason: options.reason,
  };
}
