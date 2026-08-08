// Only features listed here are enforced. `calendar` is intentionally omitted
// while its existing service remains responsible for the other ICS feeds and
// Samantha Dress v1 (`/calendar/samantha-dress.ics`) is phased out separately.
//
// Edges point from importer to imported feature. Same-feature imports and
// imports from unenrolled infrastructure are allowed without an edge.
export const FEATURE_DEPENDENCIES = {
  geocode: ["samantha-dress"],
  "happy-hour": [],
  "index-now": ["samantha-dress"],
  nixle: [],
  // Geocoding consumes Samantha refreshes, while Samantha reads the coordinate
  // store. Both directions are intentional until those responsibilities split.
  "samantha-dress": ["geocode"],
};
