import { describe, expect, it } from "vitest";

import { validateGeocodeResult } from "../src/geocode/geocode.validation.js";

const SHIP_BOTTOM = { city: "ship-bottom", state: "nj" };

describe("geocode validation", () => {
  describe("validateGeocodeResult", () => {
    it("accepts a result in the expected city and state", () => {
      expect(
        validateGeocodeResult(
          {
            town: "Ship Bottom",
            state: "New Jersey",
            "ISO3166-2-lvl4": "US-NJ",
            country_code: "us",
          },
          SHIP_BOTTOM,
        ),
      ).toEqual({ ok: true });
    });

    // The wrong-pin failure this whole design exists to close: a confident
    // result for the same street name in another state.
    it("rejects a result in a different state", () => {
      const result = validateGeocodeResult(
        { city: "Ship Bottom", state: "New York", country_code: "us" },
        SHIP_BOTTOM,
      );

      expect(result.ok).toBe(false);
      expect(result).toMatchObject({
        reason: "result state ny does not match expected nj",
      });
    });

    it("rejects a result in a different city within the right state", () => {
      const result = validateGeocodeResult(
        { city: "Asbury Park", "ISO3166-2-lvl4": "US-NJ", country_code: "us" },
        SHIP_BOTTOM,
      );

      expect(result.ok).toBe(false);
      expect(result).toMatchObject({
        reason:
          "result localities asbury-park do not include expected ship-bottom",
      });
    });

    it("rejects a result outside the US", () => {
      expect(
        validateGeocodeResult(
          { city: "Ship Bottom", state: "New Jersey", country_code: "gb" },
          SHIP_BOTTOM,
        ),
      ).toEqual({ ok: false, reason: "result is in country gb" });
    });

    it("rejects a result that carries nothing to validate against", () => {
      expect(validateGeocodeResult(undefined, SHIP_BOTTOM)).toEqual({
        ok: false,
        reason: "result carried no address details",
      });
      expect(
        validateGeocodeResult({ country_code: "us" }, SHIP_BOTTOM),
      ).toEqual({ ok: false, reason: "result carried no recognizable state" });
      expect(
        validateGeocodeResult(
          { state: "New Jersey", country_code: "us" },
          SHIP_BOTTOM,
        ),
      ).toEqual({ ok: false, reason: "result carried no locality name" });
    });

    // A mailing city is often not the administrative one. Manahawkin addresses
    // come back under Stafford Township, which still contains the expected town.
    it("accepts a mailing city that appears as a secondary locality", () => {
      expect(
        validateGeocodeResult(
          {
            town: "Stafford Township",
            hamlet: "Manahawkin",
            "ISO3166-2-lvl4": "US-NJ",
            country_code: "us",
          },
          { city: "manahawkin", state: "nj" },
        ),
      ).toEqual({ ok: true });
    });
  });
});
