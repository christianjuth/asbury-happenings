import path from "node:path";

export function defineFeatureBoundaries({
  dependencies,
  featureRoot = path.join("src", "features"),
  infrastructureRoots = [],
  compositionRoots = [],
}) {
  if (!dependencies || typeof dependencies !== "object") {
    throw new TypeError("Feature dependencies must be an object.");
  }

  const features = Object.keys(dependencies);
  const featureSet = new Set(features);

  for (const [feature, importedFeatures] of Object.entries(dependencies)) {
    if (!Array.isArray(importedFeatures)) {
      throw new TypeError(
        `Dependencies for feature "${feature}" must be an array.`,
      );
    }

    for (const importedFeature of importedFeatures) {
      if (!featureSet.has(importedFeature)) {
        throw new Error(
          `Feature "${feature}" depends on unknown feature "${importedFeature}".`,
        );
      }
    }
  }

  assertAcyclic(dependencies, features);

  const featurePath = (feature) => path.join(featureRoot, feature);
  const zones = [];

  for (const importer of features) {
    const allowedImports = new Set(dependencies[importer]);

    for (const imported of features) {
      if (imported === importer || allowedImports.has(imported)) {
        continue;
      }

      zones.push({
        target: featurePath(importer),
        from: featurePath(imported),
        message: `Feature "${importer}" may not import "${imported}". Add the directed edge "${importer} -> ${imported}" if this dependency is intentional.`,
      });
    }

    for (const compositionRoot of compositionRoots) {
      zones.push({
        target: featurePath(importer),
        from: compositionRoot,
        message: `Feature "${importer}" may not import composition code from "${compositionRoot}".`,
      });
    }
  }

  for (const infrastructureRoot of infrastructureRoots) {
    for (const feature of features) {
      zones.push({
        target: infrastructureRoot,
        from: featurePath(feature),
        message: `Infrastructure in "${infrastructureRoot}" may not import feature "${feature}".`,
      });
    }
  }

  return { features, zones };
}

function assertAcyclic(dependencies, features) {
  const states = new Map();
  const stack = [];

  for (const feature of features) {
    visit(feature);
  }

  function visit(feature) {
    const state = states.get(feature);

    if (state === "visited") {
      return;
    }

    if (state === "visiting") {
      const cycleStart = stack.indexOf(feature);
      const cycle = [...stack.slice(cycleStart), feature].join(" -> ");

      throw new Error(`Feature dependency cycle detected: ${cycle}.`);
    }

    states.set(feature, "visiting");
    stack.push(feature);

    for (const dependency of dependencies[feature]) {
      visit(dependency);
    }

    stack.pop();
    states.set(feature, "visited");
  }
}
