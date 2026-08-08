import { describe, expect, it } from "vitest";

import {
  cityStateFromLocation,
  eventCityLocation,
  normalizeGeocodeQuery,
  venueFromLocation,
} from "../src/calendar/address.utils.js";

describe("address utils", () => {
  describe("normalizeGeocodeQuery", () => {
    it("strips a leading venue name before the house number", () => {
      expect(
        normalizeGeocodeQuery(
          "LBI Distilling Company, 1 Main St, Manahawkin, NJ",
        ),
      ).toBe("1 Main St, Manahawkin, NJ");
    });

    it("keeps an address that already starts with a house number", () => {
      expect(normalizeGeocodeQuery("1213 Ocean Ave, Asbury Park, NJ")).toBe(
        "1213 Ocean Ave, Asbury Park, NJ",
      );
    });

    it("leaves name-only venues untouched so POI lookup can work", () => {
      expect(normalizeGeocodeQuery("The Stone Pony, Asbury Park, NJ")).toBe(
        "The Stone Pony, Asbury Park, NJ",
      );
    });

    it("ignores digits inside a venue name and strips at the real address", () => {
      expect(normalizeGeocodeQuery("Bar 21, 45 Main St, Town, NJ")).toBe(
        "45 Main St, Town, NJ",
      );
    });

    it("handles hyphenated house numbers", () => {
      expect(
        normalizeGeocodeQuery("The Venue, 123-45 Broadway, Queens, NY"),
      ).toBe("123-45 Broadway, Queens, NY");
    });

    // No comma between the venue name and the street it runs into.
    it("strips a venue name fused onto the street address", () => {
      expect(
        normalizeGeocodeQuery(
          "Lake Como Borough 1740 Main St, Belmar, NJ 07719, United States",
        ),
      ).toBe("1740 Main St, Belmar, NJ 07719, United States");
    });

    // A digit inside a venue name is not a house number, so there is nothing to
    // split off and the whole string still goes to the geocoder.
    it("leaves a venue name that merely contains a number alone", () => {
      expect(normalizeGeocodeQuery("Bar 21 Grill, Asbury Park, NJ")).toBe(
        "Bar 21 Grill, Asbury Park, NJ",
      );
    });
  });

  describe("cityStateFromLocation", () => {
    it("parses city and state from a full venue address", () => {
      expect(
        cityStateFromLocation(
          "LBI Distilling Company, 1 Main St, Manahawkin, NJ",
        ),
      ).toBe("Manahawkin, NJ");
    });

    it("parses city and state from an address with a ZIP code", () => {
      expect(
        cityStateFromLocation(
          "South Orange Performing Arts Center, 400 South Orange Ave, South Orange, NJ 07079",
        ),
      ).toBe("South Orange, NJ");
    });

    it("falls back for venue-only locations with city and state segments", () => {
      expect(cityStateFromLocation("The Stone Pony, Asbury Park, NJ")).toBe(
        "Asbury Park, NJ",
      );
    });

    it("returns null when there is no city and state information", () => {
      expect(cityStateFromLocation("TBD")).toBeNull();
      expect(cityStateFromLocation(undefined)).toBeNull();
    });

    it.each([
      // The town runs straight on from the street with no comma, and the country
      // shares a segment with the state and ZIP.
      [
        "6805 Long Beach Blvd Beach Haven, NJ 08008 United States",
        "Beach Haven, NJ",
      ],
      // The venue name runs into the street instead.
      [
        "Lake Como Borough 1740 Main St, Belmar, NJ 07719, United States",
        "Belmar, NJ",
      ],
      // Territories address like states and now parse like them. The ZIP sits on
      // its own segment here, which is never a city.
      [
        "The Beach House Rincón, PR-413 Km 2.8, Rincón, 00677, Puerto Rico",
        "Rincón, PR",
      ],
      ["1 Marina Dr, St Thomas, VI 00802", "St Thomas, VI"],
      ["1 Main St, San Juan, PR, 00901, Puerto Rico", "San Juan, PR"],
      [
        "1 Marina Dr, St Thomas, VI, 00802, U.S. Virgin Islands",
        "St Thomas, VI",
      ],
      ["123 Main St North, NJ", null],
      ["123 Main St Suite A, NJ", null],
    ])("parses %s", (location, expected) => {
      expect(cityStateFromLocation(location)).toBe(expected);
    });

    // "Suite 3 Beach Haven" is not a city, and these feed indexed
    // `/events/<state>/<city>` paths where a wrong city costs a redirect. No
    // city at all is the safer answer.
    it("refuses to split a town off a street that carries a unit number", () => {
      expect(
        cityStateFromLocation(
          "6805 Long Beach Blvd Suite 3 Beach Haven, NJ 08008 United States",
        ),
      ).toBeNull();
    });

    // Still the existing hard stop: a segment that is only a street address is
    // not a city, fused town or not.
    it("returns null when the segment before the state is only a street", () => {
      expect(
        cityStateFromLocation("6805 Long Beach Blvd, NJ 08008 United States"),
      ).toBeNull();
    });
  });

  describe("venueFromLocation", () => {
    it.each([
      ["The Boardwalk, 100 Ocean Ave, Ship Bottom, NJ", "The Boardwalk"],
      ["Bird & Betty's, 20th St, Beach Haven, NJ", "Bird & Betty's"],
      // No street address, so the leading segment is the venue only when it is
      // not the city itself.
      ["The Stone Pony, Asbury Park, NJ", "The Stone Pony"],
      ["Ship Bottom, NJ", null],
      // Already starts with a house number: there is no venue name to take.
      ["123 Main St, Freehold, NJ 07728", null],
      // No comma before the street, so the split happens inside the segment.
      [
        "Lake Como Borough 1740 Main St, Belmar, NJ 07719, United States",
        "Lake Como Borough",
      ],
      [
        "The Beach House Rincón, PR-413 Km 2.8, Rincón, 00677, Puerto Rico",
        "The Beach House Rincón",
      ],
      ["TBD", null],
      [undefined, null],
    ])("reads the venue name out of %s", (location, expected) => {
      expect(venueFromLocation(location)).toBe(expected);
    });
  });

  describe("eventCityLocation", () => {
    it.each([
      [
        "The Stone Pony, Asbury Park, New Jersey, USA",
        { state: "nj", city: "asbury-park" },
      ],
      [
        "Long Beach Island, New Jersey",
        { state: "nj", city: "long-beach-island" },
      ],
      ["Indiana, PA", { state: "pa", city: "indiana" }],
      ["Kansas City, Kansas, USA", { state: "ks", city: "kansas-city" }],
      ["Washington, DC, USA", { state: "dc", city: "washington" }],
      ["Some Venue, Xx", undefined],
      ["The Stone Pony, 913 Ocean Ave, NJ", undefined],
      [
        "LBI Distilling Company, 123 Main St, Beach Haven, NJ 08008",
        { state: "nj", city: "beach-haven" },
      ],
      ["Ship Bottom, NJ", { state: "nj", city: "ship-bottom" }],
      ["123 Main St, Freehold, NJ 07728", { state: "nj", city: "freehold" }],
      ["TBD", undefined],
      // Accents fold rather than being stripped as punctuation, which would slug
      // Rincón to `rinc-n`.
      [
        "The Beach House Rincón, PR-413 Km 2.8, Rincón, 00677, Puerto Rico",
        { state: "pr", city: "rincon" },
      ],
      [
        "6805 Long Beach Blvd Beach Haven, NJ 08008 United States",
        { state: "nj", city: "beach-haven" },
      ],
    ] as const)("normalizes %s for routing", (location, expected) => {
      expect(eventCityLocation(location)).toEqual(expected);
    });
  });
});
