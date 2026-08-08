import { normalizeGeocodeQuery } from "../calendar/address.utils.js";
import { findCoordinateOverride } from "./geocode.overrides.js";
import type { CoordinateStore } from "./geocode.store.js";
import type { Coordinates, CoordinatesStatus } from "./geocode.types.js";

interface ResolvedCoordinates {
  coordinates: Coordinates | null;
  status: CoordinatesStatus;
  // True only for a pin that came from the override table. `resolved` says a
  // coordinate is trustworthy; this says who vouched for it, which is the one
  // thing a reader cannot work out from the pin itself.
  manual: boolean;
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
    return { coordinates: null, status: "unresolvable", manual: false };
  }

  // The manual table is read before the store and wins over it. An address is
  // listed there precisely because the geocoder's answer is wrong, and a wrong
  // answer that passed validation is stored `resolved` like any other — so
  // checking the store first would hand back the pin the override exists to
  // replace. It also applies to past events, which are never queued: a
  // hand-written coordinate needs no run to have happened.
  const override = findCoordinateOverride(location);

  if (override) {
    return {
      coordinates: override.coordinates,
      status: "resolved",
      manual: true,
    };
  }

  const record = store.get(normalizeGeocodeQuery(location));

  if (record?.status === "resolved" && record.coordinates) {
    return {
      coordinates: record.coordinates,
      status: "resolved",
      manual: false,
    };
  }

  if (record) {
    return {
      coordinates: null,
      status: record.status === "rejected" ? "rejected" : "unresolvable",
      manual: false,
    };
  }

  // Nothing stored. A past event was deliberately never queued; anything else is
  // waiting for the next decoration run.
  return {
    coordinates: null,
    status: options.past ? "skipped_past" : "pending",
    manual: false,
  };
}
