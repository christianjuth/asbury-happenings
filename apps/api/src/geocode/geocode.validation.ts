import {
  normalizeStateSlug,
  slugifyPathSegment,
  type EventCityLocation,
} from "../calendar/address.utils.js";
import type { NominatimAddress } from "./nominatim.js";

const ISO_STATE_CODE = /^US-([A-Za-z]{2})$/;

// Nominatim spreads the locality across whichever of these the place happens to
// carry. A mailing city is often not the administrative one — Manahawkin
// addresses come back under Stafford Township — so a match on any of them still
// means the result sits inside a locality that goes by the expected name.
const LOCALITY_FIELDS = [
  "city",
  "town",
  "village",
  "hamlet",
  "municipality",
  "suburb",
  "neighbourhood",
  "county",
] as const;

type ValidationResult = { ok: true } | { ok: false; reason: string };

// `expected` is parsed from the LOCATION string itself, never taken from the
// geocoder — checking a result against the answer it just gave would validate
// nothing.
export function validateGeocodeResult(
  address: NominatimAddress | undefined,
  expected: EventCityLocation,
): ValidationResult {
  if (!address) {
    return { ok: false, reason: "result carried no address details" };
  }

  const countryCode = address.country_code?.toLowerCase();

  if (countryCode && countryCode !== "us") {
    return { ok: false, reason: `result is in country ${countryCode}` };
  }

  const state = readResultState(address);

  if (!state) {
    return { ok: false, reason: "result carried no recognizable state" };
  }

  if (state !== expected.state) {
    return {
      ok: false,
      reason: `result state ${state} does not match expected ${expected.state}`,
    };
  }

  const localities = readResultLocalities(address);

  if (!localities.length) {
    return { ok: false, reason: "result carried no locality name" };
  }

  if (!localities.includes(expected.city)) {
    return {
      ok: false,
      reason: `result localities ${localities.join("/")} do not include expected ${expected.city}`,
    };
  }

  return { ok: true };
}

function readResultState(address: NominatimAddress): string | undefined {
  const isoCode = address["ISO3166-2-lvl4"]?.match(ISO_STATE_CODE)?.[1];

  if (isoCode) {
    return normalizeStateSlug(isoCode);
  }

  return address.state ? normalizeStateSlug(address.state) : undefined;
}

function readResultLocalities(address: NominatimAddress): string[] {
  return LOCALITY_FIELDS.flatMap((field) => {
    const value = address[field];

    return value ? [slugifyPathSegment(value)] : [];
  }).filter(Boolean);
}
