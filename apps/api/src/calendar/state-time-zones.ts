// Display zone inferred from an event's state when the source calendar carries
// no explicit TZID. samanthadress.com treats a zone that came from a TZID as
// certain and one inferred here as a guess the UI has to label, which is what
// `timeZoneSource: "state"` in the JSON snapshot records.
//
// States spanning more than one zone map to their most populous zone (Tennessee
// to Central for Nashville and Memphis, Florida to Eastern, Texas to Central).
// The inference is already published as a guess, so being an hour off for a
// minority county beats refusing to render a local time at all — and
// `MULTI_ZONE_STATES` below tells the consumer which guesses are the risky ones.
const STATE_TIME_ZONES: Record<string, string> = {
  al: "America/Chicago",
  ak: "America/Anchorage",
  az: "America/Phoenix",
  ar: "America/Chicago",
  ca: "America/Los_Angeles",
  co: "America/Denver",
  ct: "America/New_York",
  dc: "America/New_York",
  de: "America/New_York",
  fl: "America/New_York",
  ga: "America/New_York",
  hi: "Pacific/Honolulu",
  ia: "America/Chicago",
  id: "America/Boise",
  il: "America/Chicago",
  in: "America/Indiana/Indianapolis",
  ks: "America/Chicago",
  ky: "America/New_York",
  la: "America/Chicago",
  ma: "America/New_York",
  md: "America/New_York",
  me: "America/New_York",
  mi: "America/Detroit",
  mn: "America/Chicago",
  mo: "America/Chicago",
  ms: "America/Chicago",
  mt: "America/Denver",
  nc: "America/New_York",
  nd: "America/Chicago",
  ne: "America/Chicago",
  nh: "America/New_York",
  nj: "America/New_York",
  nm: "America/Denver",
  nv: "America/Los_Angeles",
  ny: "America/New_York",
  oh: "America/New_York",
  ok: "America/Chicago",
  or: "America/Los_Angeles",
  pa: "America/New_York",
  ri: "America/New_York",
  sc: "America/New_York",
  sd: "America/Chicago",
  tn: "America/Chicago",
  tx: "America/Chicago",
  ut: "America/Denver",
  va: "America/New_York",
  vt: "America/New_York",
  wa: "America/Los_Angeles",
  wi: "America/Chicago",
  wv: "America/New_York",
  wy: "America/Denver",
  // Territories, none of which observe DST. Absent from this table they fell
  // through to the source's configured zone, so a San Juan show rendered as
  // America/New_York: right offset from March to November by coincidence, an
  // hour wrong and labelled "EST" the rest of the year.
  pr: "America/Puerto_Rico",
  vi: "America/St_Thomas",
  gu: "Pacific/Guam",
  as: "Pacific/Pago_Pago",
  mp: "Pacific/Saipan",
};

// States whose representative zone may not be right for every venue. Most span
// multiple IANA zones; Arizona is included because the Navajo Nation observes
// DST while the representative America/Phoenix zone does not.
const MULTI_ZONE_STATES = new Set([
  "ak",
  "az",
  "fl",
  "id",
  "in",
  "ks",
  "ky",
  "mi",
  "nd",
  "ne",
  "nv",
  "or",
  "sd",
  "tn",
  "tx",
]);

interface StateTimeZone {
  timeZone: string;
  // Whether this state-level inference could be an hour off. Published so the
  // site can label a Texas show "times shown in Central" without keeping its own
  // copy of this table.
  ambiguous: boolean;
}

export function timeZoneForState(
  state: string | undefined,
): StateTimeZone | undefined {
  if (!state) {
    return undefined;
  }

  const stateCode = state.trim().toLowerCase();
  const timeZone = STATE_TIME_ZONES[stateCode];

  if (!timeZone) {
    return undefined;
  }

  return { timeZone, ambiguous: MULTI_ZONE_STATES.has(stateCode) };
}
