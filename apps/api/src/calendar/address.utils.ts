import { parseAddress } from "addresser";

const HOUSE_NUMBER_SEGMENT = /^\d+[a-z]?(?:-\d+[a-z]?)?\s/i;
const ZIP_CODE = /\s+\d{5}(?:-\d{4})?$/;

const STATE_SLUGS: Record<string, string> = {
  alabama: "al",
  alaska: "ak",
  arizona: "az",
  arkansas: "ar",
  california: "ca",
  colorado: "co",
  connecticut: "ct",
  delaware: "de",
  "district of columbia": "dc",
  florida: "fl",
  georgia: "ga",
  hawaii: "hi",
  idaho: "id",
  illinois: "il",
  indiana: "in",
  iowa: "ia",
  kansas: "ks",
  kentucky: "ky",
  louisiana: "la",
  maine: "me",
  maryland: "md",
  massachusetts: "ma",
  michigan: "mi",
  minnesota: "mn",
  mississippi: "ms",
  missouri: "mo",
  montana: "mt",
  nebraska: "ne",
  nevada: "nv",
  "new hampshire": "nh",
  "new jersey": "nj",
  "new mexico": "nm",
  "new york": "ny",
  "north carolina": "nc",
  "north dakota": "nd",
  ohio: "oh",
  oklahoma: "ok",
  oregon: "or",
  pennsylvania: "pa",
  "rhode island": "ri",
  "south carolina": "sc",
  "south dakota": "sd",
  tennessee: "tn",
  texas: "tx",
  utah: "ut",
  vermont: "vt",
  virginia: "va",
  washington: "wa",
  "west virginia": "wv",
  wisconsin: "wi",
  wyoming: "wy",
};
const STATE_CODES = new Set(Object.values(STATE_SLUGS));

export interface EventCityLocation {
  state: string;
  city: string;
}

export function normalizeGeocodeQuery(location: string): string {
  const segments = splitLocationSegments(location);

  const startIndex = segments.findIndex((segment) =>
    HOUSE_NUMBER_SEGMENT.test(segment),
  );

  return startIndex > 0 ? segments.slice(startIndex).join(", ") : location;
}

export function cityStateFromLocation(
  location: string | null | undefined,
): string | null {
  if (!location) {
    return null;
  }

  const segments = splitLocationSegments(normalizeGeocodeQuery(location));

  try {
    const parsed = parseAddress(segments.join(", "));

    if (parsed.placeName && parsed.stateAbbreviation) {
      return `${parsed.placeName}, ${parsed.stateAbbreviation}`;
    }
  } catch {
    // Fall through to the conservative segment parser.
  }

  for (let index = segments.length - 1; index > 0; index -= 1) {
    const stateSegment = segments[index];

    if (!stateSegment) {
      continue;
    }

    const state = normalizeStateSlug(stateSegment.replace(ZIP_CODE, ""));
    const city = segments[index - 1];

    if (!state || !city) {
      continue;
    }

    if (HOUSE_NUMBER_SEGMENT.test(city)) {
      return null;
    }

    return `${city}, ${state.toUpperCase()}`;
  }

  return null;
}

// The leading comma-segments that `normalizeGeocodeQuery` strips before asking
// the geocoder, i.e. the venue name. Returns null when the LOCATION opens with a
// house number (no venue name to take) or is only a city and state.
export function venueFromLocation(
  location: string | null | undefined,
): string | null {
  if (!location) {
    return null;
  }

  const segments = splitLocationSegments(location);
  const houseNumberIndex = segments.findIndex((segment) =>
    HOUSE_NUMBER_SEGMENT.test(segment),
  );

  if (houseNumberIndex > 0) {
    return segments.slice(0, houseNumberIndex).join(", ") || null;
  }

  if (houseNumberIndex === 0) {
    return null;
  }

  // No street address anywhere: the first segment is a venue name only when it
  // is not already the city, so "Ship Bottom, NJ" reports no venue while
  // "The Stone Pony, Asbury Park, NJ" reports one.
  const city = cityStateFromLocation(location)?.split(",")[0]?.trim();
  const firstSegment = segments[0];

  if (
    !city ||
    !firstSegment ||
    firstSegment.toLowerCase() === city.toLowerCase()
  ) {
    return null;
  }

  return firstSegment;
}

export function eventCityLocation(
  location: string | null | undefined,
): EventCityLocation | undefined {
  const cityState = cityStateFromLocation(location);
  const [city, state] = cityState?.split(",").map((part) => part.trim()) ?? [];

  if (!city || !state) {
    return undefined;
  }

  const citySlug = slugifyPathSegment(city);
  const stateSlug = normalizeStateSlug(state);

  if (!citySlug || !stateSlug) {
    return undefined;
  }

  return {
    state: stateSlug,
    city: citySlug,
  };
}

// Accepts either a two-letter code or a full state name, so it also normalizes
// whatever a geocoder returns for comparison against the expected state.
export function normalizeStateSlug(value: string): string | undefined {
  const normalized = value.trim().toLowerCase().replace(/-/g, " ");
  const stateSlug = STATE_SLUGS[normalized] ?? normalized;

  return STATE_CODES.has(stateSlug) ? stateSlug : undefined;
}

export function slugifyPathSegment(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function splitLocationSegments(location: string): string[] {
  return location
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
}
