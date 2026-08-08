import { normalizeGeocodeQuery } from "../calendar/address.utils.js";
import type { Coordinates } from "./geocode.types.js";

interface CoordinateOverride {
  // The address as it appears in the calendar `LOCATION`, or just the part of it
  // a geocoder would be handed — a leading venue name is stripped before the
  // entry is keyed, so either form matches the same events.
  address: string;
  coordinates: Coordinates;
  // Why this address is pinned by hand. Required, because a row with no reason
  // is indistinguishable from a stale one nobody dares delete.
  reason: string;
}

// Addresses whose coordinates are set by hand. The geocoder is never asked about
// anything listed here, and its answer would not be used if it were: an address
// earns a row because the automatic answer is wrong or unavailable, and a wrong
// answer that passes validation is stored `resolved` like any other.
//
// Keep this small. Every row is a claim we now maintain by hand, and it outlives
// the reason it was added without saying so — OSM fixes its own data eventually,
// and nothing here notices when it does.
//
// Coordinates are decimal degrees, south and west negative.
export const COORDINATE_OVERRIDES: readonly CoordinateOverride[] = [
  {
    address: "6805 Long Beach Blvd, Long Beach, NJ 08008, USA",
    // 39.61583° N, 74.19869° W
    coordinates: { lat: 39.61583, lon: -74.19869 },
    reason:
      "Long Beach Blvd runs the length of the island through several towns, " +
      "and the geocoded answer for this block does not land on the venue.",
  },
];

// A trailing country segment, which Google Calendar appends to some addresses
// and not others ("..., NJ 08008, USA"). Dropped from the key so one row covers
// both spellings; every segment before it still has to match exactly.
const COUNTRY_SEGMENT =
  /^(?:usa?|u\.s\.(?:a\.)?|united states(?: of america)?)\.?$/i;

// Overrides are matched on the same normalized address the store is keyed by, so
// a venue-name edit ("The Sand Bar" to "Sand Bar") does not drop the pin. Case
// and inner spacing are folded on both sides: this table is hand-edited, and a
// row that silently fails to match is worse than no row at all.
function coordinateOverrideKey(location: string): string {
  const segments = normalizeGeocodeQuery(location)
    .split(",")
    .map((segment) => segment.trim().replace(/\s+/g, " "))
    .filter(Boolean);

  if (COUNTRY_SEGMENT.test(segments.at(-1) ?? "")) {
    segments.pop();
  }

  return segments.join(", ").toLowerCase();
}

const overridesByKey = new Map(
  COORDINATE_OVERRIDES.flatMap((override): [string, CoordinateOverride][] => {
    const key = coordinateOverrideKey(override.address);

    // A row whose address normalizes to nothing would answer for every location
    // that also normalizes to nothing, which is not a pin anyone asked for. It
    // is dropped here and fails the reachability check in the tests.
    return key ? [[key, override]] : [];
  }),
);

export function findCoordinateOverride(
  location: string | null | undefined,
): CoordinateOverride | undefined {
  return location
    ? overridesByKey.get(coordinateOverrideKey(location))
    : undefined;
}

// The table as it is actually keyed, for `/debug/geocode`. A row that does not
// match the address it was written for is invisible otherwise.
export function coordinateOverrideEntries(): [string, CoordinateOverride][] {
  return [...overridesByKey.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
}
