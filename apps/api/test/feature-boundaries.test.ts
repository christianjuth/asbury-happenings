import { ESLint } from "eslint";
import path from "node:path";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({
  cwd: process.cwd(),
  overrideConfigFile: path.resolve("eslint.config.js"),
});
const PROBE_MODULES = {
  geocode: "geocode.scheduler.js",
  "samantha-dress": "samantha-dress.cache.js",
};

describe("feature dependency boundaries", () => {
  it("allows an explicitly declared directed edge", async () => {
    const messages = await lintFeatureImport("index-now", "samantha-dress");

    expect(messages).not.toContainEqual(
      expect.objectContaining({ ruleId: "import-x/no-restricted-paths" }),
    );
  });

  it("rejects an undeclared directed edge", async () => {
    const messages = await lintFeatureImport("index-now", "geocode");

    expect(messages).toContainEqual(
      expect.objectContaining({
        ruleId: "import-x/no-restricted-paths",
        message: expect.stringContaining("index-now -> geocode"),
      }),
    );
  });

  it("rejects the legacy Samantha calendar shim", async () => {
    const messages = await lintImport(
      "index-now",
      "../calendar/config/samantha-dress.js",
    );

    expect(messages).toContainEqual(
      expect.objectContaining({
        ruleId: "import-x/no-restricted-paths",
        message: expect.stringContaining("legacy Samantha Dress calendar shim"),
      }),
    );
  });

  it("rejects aggregate calendar configuration that exposes the shim", async () => {
    const messages = await lintImport(
      "index-now",
      "../calendar/calendar.config.js",
    );

    expect(messages).toContainEqual(
      expect.objectContaining({
        ruleId: "import-x/no-restricted-paths",
        message: expect.stringContaining(
          "aggregate legacy calendar configuration",
        ),
      }),
    );
  });
});

async function lintFeatureImport(
  importer: string,
  imported: string,
): Promise<unknown[]> {
  const importedModule = PROBE_MODULES[imported as keyof typeof PROBE_MODULES];

  if (!importedModule) {
    throw new Error(`No probe module configured for ${imported}`);
  }

  return lintImport(importer, `../${imported}/${importedModule}`);
}

async function lintImport(
  importer: string,
  importSpecifier: string,
): Promise<unknown[]> {
  const [result] = await eslint.lintText(`import "${importSpecifier}";`, {
    filePath: path.resolve("src", importer, "boundary-probe.ts"),
  });

  return result?.messages ?? [];
}
