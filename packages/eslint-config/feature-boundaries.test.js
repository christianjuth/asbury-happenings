import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { defineFeatureBoundaries } from "./feature-boundaries.js";

describe("defineFeatureBoundaries", () => {
  it("allows same-feature and declared directed imports", () => {
    const boundaries = defineFeatureBoundaries({
      dependencies: {
        booking: ["events"],
        events: [],
      },
    });

    assert.equal(hasZone(boundaries.zones, "booking", "booking"), false);
    assert.equal(hasZone(boundaries.zones, "booking", "events"), false);
  });

  it("restricts undeclared edges without granting transitive access", () => {
    const boundaries = defineFeatureBoundaries({
      dependencies: {
        booking: ["events"],
        events: ["music"],
        music: [],
      },
    });

    assert.equal(hasZone(boundaries.zones, "booking", "music"), true);
    assert.equal(hasZone(boundaries.zones, "music", "events"), true);
  });

  it("rejects unknown feature names", () => {
    assert.throws(
      () =>
        defineFeatureBoundaries({
          dependencies: {
            booking: ["missing"],
          },
        }),
      /unknown feature "missing"/,
    );
  });

  it("rejects dependency cycles", () => {
    assert.throws(
      () =>
        defineFeatureBoundaries({
          dependencies: {
            booking: ["events"],
            events: ["booking"],
          },
        }),
      /booking -> events -> booking/,
    );
  });

  it("restricts infrastructure and composition dependencies", () => {
    const boundaries = defineFeatureBoundaries({
      dependencies: {
        booking: [],
      },
      infrastructureRoots: [path.join("src", "lib")],
      compositionRoots: [path.join("src", "app")],
    });

    assert.deepEqual(boundaries.zones, [
      {
        target: path.join("src", "features", "booking"),
        from: path.join("src", "app"),
        message:
          'Feature "booking" may not import composition code from "src/app".',
      },
      {
        target: path.join("src", "lib"),
        from: path.join("src", "features", "booking"),
        message:
          'Infrastructure in "src/lib" may not import feature "booking".',
      },
    ]);
  });
});

function hasZone(zones, importer, imported) {
  return zones.some(
    (zone) =>
      zone.target === path.join("src", "features", importer) &&
      zone.from === path.join("src", "features", imported),
  );
}
