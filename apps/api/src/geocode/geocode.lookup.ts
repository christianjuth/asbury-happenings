import { normalizeGeocodeQuery } from "../calendar/address.utils.js";
import type { CoordinateStore } from "./geocode.store.js";
import type { Coordinates, CoordinatesStatus } from "./geocode.types.js";

interface ResolvedCoordinates {
  coordinates: Coordinates | null;
  status: CoordinatesStatus;
}

// Coordinates join onto events at read time by normalized address rather than
// being written into the cached events. A calendar refresh replaces every event
// object, so a decorated copy would be thrown away every 30 minutes; the address
// is the stable key.
export function lookupCoordinates(
  store: CoordinateStore,
  location: string | undefined,
  options: { past: boolean },
): ResolvedCoordinates {
  if (!location) {
    return { coordinates: null, status: "unresolvable" };
  }

  const record = store.get(normalizeGeocodeQuery(location));

  if (record?.status === "resolved" && record.coordinates) {
    return { coordinates: record.coordinates, status: "resolved" };
  }

  if (record) {
    return {
      coordinates: null,
      status: record.status === "rejected" ? "rejected" : "unresolvable",
    };
  }

  // Nothing stored. A past event was deliberately never queued; anything else is
  // waiting for the next decoration run.
  return {
    coordinates: null,
    status: options.past ? "skipped_past" : "pending",
  };
}
