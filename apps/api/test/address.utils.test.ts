import { describe, expect, it } from "vitest";

import {
  cityStateFromLocation,
  eventCityLocation,
  normalizeGeocodeQuery,
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
    ] as const)("normalizes %s for routing", (location, expected) => {
      expect(eventCityLocation(location)).toEqual(expected);
    });
  });
});
