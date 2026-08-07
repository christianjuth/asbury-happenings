// Display zone inferred from an event's state when the source calendar carries
// no explicit TZID. samanthadress.com treats a zone that came from a TZID as
// certain and one inferred here as a guess the UI has to label, which is what
// `timeZoneSource: "state"` in the JSON snapshot records.
//
// States spanning more than one zone map to their most populous zone (Tennessee
// to Central for Nashville and Memphis, Florida to Eastern, Texas to Central).
// The inference is already published as a guess, so being an hour off for a
// minority county beats refusing to render a local time at all.
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
};

export function timeZoneForState(
  state: string | undefined,
): string | undefined {
  if (!state) {
    return undefined;
  }

  return STATE_TIME_ZONES[state.trim().toLowerCase()];
}
