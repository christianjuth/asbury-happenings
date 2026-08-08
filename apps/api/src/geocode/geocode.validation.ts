import {
  normalizeStateSlug,
  slugifyPathSegment,
  type EventCityLocation,
} from "../calendar/address.utils.js";
import type { NominatimAddress } from "./nominatim.js";

const ISO_STATE_CODE = /^US-([A-Za-z]{2})$/;

// US territories carry their own ISO country code, and OSM models some of them
// as a country in their own right rather than as a US subdivision. Accepted only
// when the address was itself parsed as that same territory, so this can never
// widen what counts as a match for one of the fifty states.
const TERRITORY_COUNTRY_CODES = new Set(["pr", "vi", "gu", "as", "mp"]);

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
// OSM may return the municipality containing a mailing city, such as Long Beach
// Township for a Long Beach address. Only explicit administrative suffixes are
// folded; arbitrary prefixes would make wrong-town results look valid.
const ADMINISTRATIVE_LOCALITY_SUFFIX = /-(?:borough|municipality|township)$/;

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
  const expectedTerritory = TERRITORY_COUNTRY_CODES.has(expected.state)
    ? expected.state
    : undefined;

  if (
    countryCode &&
    countryCode !== "us" &&
    countryCode !== expectedTerritory
  ) {
    return { ok: false, reason: `result is in country ${countryCode}` };
  }

  const state = readResultState(address, countryCode);

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

  if (
    !localities.some((locality) =>
      matchesExpectedLocality(locality, expected.city),
    )
  ) {
    return {
      ok: false,
      reason: `result localities ${localities.join("/")} do not include expected ${expected.city}`,
    };
  }

  return { ok: true };
}

function matchesExpectedLocality(locality: string, expected: string): boolean {
  return (
    locality === expected ||
    locality.replace(ADMINISTRATIVE_LOCALITY_SUFFIX, "") === expected
  );
}

function readResultState(
  address: NominatimAddress,
  countryCode: string | undefined,
): string | undefined {
  const isoCode = address["ISO3166-2-lvl4"]?.match(ISO_STATE_CODE)?.[1];

  if (isoCode) {
    return normalizeStateSlug(isoCode);
  }

  if (address.state) {
    return normalizeStateSlug(address.state);
  }

  // A territory modeled as its own country has no state field to read; its
  // country code is the state code.
  return countryCode && TERRITORY_COUNTRY_CODES.has(countryCode)
    ? countryCode
    : undefined;
}

function readResultLocalities(address: NominatimAddress): string[] {
  return LOCALITY_FIELDS.flatMap((field) => {
    const value = address[field];

    return value ? [slugifyPathSegment(value)] : [];
  }).filter(Boolean);
}
