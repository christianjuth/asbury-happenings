import { ESLint } from "eslint";
import path from "node:path";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({
  cwd: process.cwd(),
  overrideConfigFile: path.resolve("eslint.config.js"),
});
const PROBE_MODULES = {
  "happy-hour": "happy-hour.cache.js",
  nixle: "nixle.cache.js",
};

describe("feature dependency boundaries", () => {
  it("rejects an undeclared directed edge", async () => {
    const messages = await lintFeatureImport("happy-hour", "nixle");

    expect(messages).toContainEqual(
      expect.objectContaining({
        ruleId: "import-x/no-restricted-paths",
        message: expect.stringContaining("happy-hour -> nixle"),
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
