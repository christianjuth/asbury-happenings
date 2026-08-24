import { defineFeatureBoundaries } from "@repo/eslint-config/feature-boundaries";
import tsParser from "@typescript-eslint/parser";
import { createNodeResolver, importX } from "eslint-plugin-import-x";
import { fileURLToPath } from "node:url";
import { FEATURE_DEPENDENCIES } from "./feature-boundaries.config.js";

const APP_ROOT = fileURLToPath(new URL(".", import.meta.url));
const FEATURE_BOUNDARIES = defineFeatureBoundaries({
  dependencies: FEATURE_DEPENDENCIES,
  featureRoot: "src",
});

export default [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["src/**/*.ts", "test/**/*.ts", "*.ts"],
    plugins: {
      "import-x": importX,
    },
    settings: {
      "import-x/extensions": [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"],
      "import-x/parsers": {
        "@typescript-eslint/parser": [".ts", ".mts", ".cts"],
      },
      "import-x/resolver-next": [
        createNodeResolver({
          extensionAlias: {
            ".js": [".ts", ".js"],
            ".mjs": [".mts", ".mjs"],
            ".cjs": [".cts", ".cjs"],
          },
          extensions: [
            ".ts",
            ".mts",
            ".cts",
            ".js",
            ".mjs",
            ".cjs",
            ".json",
            ".node",
          ],
        }),
      ],
    },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "import-x/no-cycle": ["error", { ignoreExternal: true }],
      "import-x/no-restricted-paths": [
        "error",
        {
          basePath: APP_ROOT,
          zones: FEATURE_BOUNDARIES.zones,
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSImportType",
          message:
            "Use a top-level import type declaration so dependency analysis can see the edge.",
        },
      ],
    },
  },
];
