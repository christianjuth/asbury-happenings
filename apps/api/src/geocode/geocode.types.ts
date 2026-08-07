export interface Coordinates {
  lat: number;
  lon: number;
}

// What the JSON snapshot publishes per event. All of these render identically on
// samanthadress.com (no map), but they mean different things operationally.
export type CoordinatesStatus =
  "resolved" | "pending" | "unresolvable" | "rejected" | "skipped_past";

// Terminal states the coordinate store records. `pending` and `skipped_past` are
// derived at read time from the absence of a record, so they are never written: a
// queued address is simply one the store has not heard of yet.
type CoordinateRecordStatus = "resolved" | "unresolvable" | "rejected";

export interface CoordinateRecord {
  status: CoordinateRecordStatus;
  // Null for every status except `resolved`. A stored null is the negative cache
  // that keeps an unresolvable address out of the work queue; leaving the record
  // absent instead would re-queue it every 30 minutes forever.
  coordinates: Coordinates | null;
  // When the attempt finished, successful or not. Drives the slow retry cadence
  // for negatives, and is reported by /debug/geocode so a venue that never
  // resolves is diagnosable.
  attemptedAt: string;
  reason?: string;
}

export interface GeocodeLogger {
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}
