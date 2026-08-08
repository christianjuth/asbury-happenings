import { parseAddress } from "addresser";

const HOUSE_NUMBER = String.raw`\d+[a-z]?(?:-\d+[a-z]?)?`;
const HOUSE_NUMBER_SEGMENT = new RegExp(`^${HOUSE_NUMBER}\\s`, "i");
const ZIP_CODE = /\s+\d{5}(?:-\d{4})?$/;
// A whole segment that is only a postal code, which Google Calendar emits as its
// own comma segment on some addresses ("..., Rincón, 00677, Puerto Rico"). Never
// a city, so the city search steps over it.
const POSTAL_CODE_SEGMENT = /^\d{5}(?:-\d{4})?$/;
// A country trailing the state inside one segment ("NJ 08008 United States").
// A country on its own segment needs no handling: it simply never resolves to a
// state and the search moves on to the segment before it.
const TRAILING_COUNTRY =
  /[,\s]+(?:usa?|u\.s\.(?:a\.)?|united states(?: of america)?)\.?$/i;
// Enough of a street suffix vocabulary to find where a street address ends,
// which is the only thing it is used for. A missing suffix costs an unsplit
// segment, i.e. exactly today's behaviour.
const STREET_SUFFIX = [
  "ave",
  "avenue",
  "blvd",
  "boulevard",
  "cir",
  "circle",
  "ct",
  "court",
  "dr",
  "drive",
  "hwy",
  "highway",
  "ln",
  "lane",
  "pike",
  "pkwy",
  "parkway",
  "pl",
  "place",
  "rd",
  "road",
  "row",
  "sq",
  "square",
  "st",
  "street",
  "ter",
  "terrace",
  "tpke",
  "turnpike",
  "trl",
  "trail",
  "way",
].join("|");
const STREET = `${HOUSE_NUMBER}\\s+.*?\\b(?:${STREET_SUFFIX})\\b\\.?`;
// A venue name with the street fused onto it, no comma between:
// "Lake Como Borough 1740 Main St". Anchored on a street suffix so a digit
// inside a venue name ("Bar 21 Grill") is not mistaken for a house number.
const FUSED_VENUE = new RegExp(`^(.*?\\S)\\s+(${STREET})$`, "i");
// The mirror image: a town fused onto the end of a street address with no comma
// before it, "6805 Long Beach Blvd Beach Haven". The town must be letters only,
// so a unit number ("... Main St Suite 3 Freehold") is left unsplit rather than
// published as a city — these feed indexed `/events/<state>/<city>` paths, where
// a wrong city is worse than no city.
const FUSED_TOWN = new RegExp(
  `^(${STREET})\\s+(\\p{L}[\\p{L}\\p{M}\\s.'’-]*)$`,
  "iu",
);

const NON_TOWN_FUSED_SUFFIX = /^(?:north|south|east|west|n|s|e|w)$/i;
const FUSED_UNIT_PREFIX =
  /^(?:suite|ste|unit|apt|apartment|floor|fl|room|rm|building|bldg)\b/i;

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
  // Territories. USPS treats these as state codes and they address exactly like
  // states, so leaving them out did not degrade gracefully: a Puerto Rico
  // address parsed to no state at all, which cost it its city URL and dropped
  // its time zone through to the source's default zone.
  "puerto rico": "pr",
  "us virgin islands": "vi",
  "u.s. virgin islands": "vi",
  "united states virgin islands": "vi",
  "virgin islands": "vi",
  guam: "gu",
  "american samoa": "as",
  "northern mariana islands": "mp",
};
const STATE_CODES = new Set(Object.values(STATE_SLUGS));
const TERRITORY_CODES = new Set(["pr", "vi", "gu", "as", "mp"]);

export interface EventCityLocation {
  state: string;
  city: string;
}

export function normalizeGeocodeQuery(location: string): string {
  return locationParts(location).address;
}

export function cityStateFromLocation(
  location: string | null | undefined,
): string | null {
  if (!location) {
    return null;
  }

  const segments = removeRedundantTerritoryCountry(
    splitLocationSegments(normalizeGeocodeQuery(location)),
  );

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

    const state = normalizeStateSlug(
      stateSegment.replace(TRAILING_COUNTRY, "").replace(ZIP_CODE, ""),
    );

    if (!state) {
      continue;
    }

    const city = readCitySegment(segments, index - 1);

    if (!city) {
      return null;
    }

    return `${city}, ${state.toUpperCase()}`;
  }

  return null;
}

// The city sitting before an already-matched state segment. Walks back over
// postal codes, which are their own segment often enough to matter, and splits a
// town off a street address it was fused onto. Returns null rather than a guess
// when what it lands on is only a street.
function readCitySegment(
  segments: string[],
  startIndex: number,
): string | null {
  for (let index = startIndex; index >= 0; index -= 1) {
    const segment = segments[index];

    if (!segment || POSTAL_CODE_SEGMENT.test(segment)) {
      continue;
    }

    if (!HOUSE_NUMBER_SEGMENT.test(segment)) {
      return segment;
    }

    const fusedTown = FUSED_TOWN.exec(segment)?.[2]?.trim();

    if (
      !fusedTown ||
      NON_TOWN_FUSED_SUFFIX.test(fusedTown) ||
      FUSED_UNIT_PREFIX.test(fusedTown)
    ) {
      return null;
    }

    return fusedTown;
  }

  return null;
}

// What `normalizeGeocodeQuery` strips before asking the geocoder, i.e. the venue
// name. Returns null when the LOCATION opens with a house number (no venue name
// to take) or is only a city and state.
export function venueFromLocation(
  location: string | null | undefined,
): string | null {
  if (!location) {
    return null;
  }

  const parts = locationParts(location);

  if (parts.hasStreetAddress) {
    return parts.venue;
  }

  // No street address anywhere: the first segment is a venue name only when it
  // is not already the city, so "Ship Bottom, NJ" reports no venue while
  // "The Stone Pony, Asbury Park, NJ" reports one.
  const city = cityStateFromLocation(location)?.split(",")[0]?.trim();
  const firstSegment = splitLocationSegments(location)[0];

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
  return (
    value
      // Folded rather than dropped, so Rincón slugs to `rincon` and not the
      // `rinc-n` that stripping the accent as punctuation would produce.
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}

interface LocationParts {
  // The leading venue name, or null when the location opens with the street.
  venue: string | null;
  // What is left to hand a geocoder, venue name removed.
  address: string;
  // Whether a street address was found at all. Distinguishes "opened with the
  // house number, so there is no venue name" from "no street address anywhere,
  // so the leading segment may itself be the venue".
  hasStreetAddress: boolean;
}

// Splits a LOCATION into its venue name and its geocodable address, keeping the
// two complementary: whatever `venueFromLocation` reports is exactly what
// `normalizeGeocodeQuery` removes.
function locationParts(location: string): LocationParts {
  const segments = splitLocationSegments(location);
  const startIndex = segments.findIndex((segment) =>
    HOUSE_NUMBER_SEGMENT.test(segment),
  );

  if (startIndex === 0) {
    return { venue: null, address: location, hasStreetAddress: true };
  }

  if (startIndex > 0) {
    return {
      venue: segments.slice(0, startIndex).join(", ") || null,
      address: segments.slice(startIndex).join(", "),
      hasStreetAddress: true,
    };
  }

  // No segment starts with a house number, but the street may still be fused
  // onto the venue name with no comma between them.
  for (const [index, segment] of segments.entries()) {
    const fused = FUSED_VENUE.exec(segment);
    const venue = fused?.[1]?.trim();
    const street = fused?.[2]?.trim();

    if (!venue || !street) {
      continue;
    }

    return {
      venue: [...segments.slice(0, index), venue].join(", "),
      address: [street, ...segments.slice(index + 1)].join(", "),
      hasStreetAddress: true,
    };
  }

  return { venue: null, address: location, hasStreetAddress: false };
}

function removeRedundantTerritoryCountry(segments: string[]): string[] {
  return segments.filter(
    (_, index) => !isRedundantTerritoryCountry(segments, index),
  );
}

function isRedundantTerritoryCountry(
  segments: string[],
  index: number,
): boolean {
  const countryCode = territoryCodeFromSegment(segments[index]);

  if (!countryCode) {
    return false;
  }

  for (let preceding = index - 1; preceding >= 0; preceding -= 1) {
    const segment = segments[preceding];

    if (!segment || POSTAL_CODE_SEGMENT.test(segment)) {
      continue;
    }

    return territoryCodeFromSegment(segment) === countryCode;
  }

  return false;
}

function territoryCodeFromSegment(
  value: string | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = normalizeStateSlug(
    value.replace(TRAILING_COUNTRY, "").replace(ZIP_CODE, ""),
  );

  return normalized && TERRITORY_CODES.has(normalized) ? normalized : undefined;
}

function splitLocationSegments(location: string): string[] {
  return location
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
}
