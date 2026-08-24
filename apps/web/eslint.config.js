import { defineFeatureBoundaries } from "@repo/eslint-config/feature-boundaries";
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import { importX } from "eslint-plugin-import-x";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";
import { FEATURE_DEPENDENCIES } from "./feature-boundaries.config.mjs";

const APP_ROOT = fileURLToPath(new URL(".", import.meta.url));
const FEATURE_BOUNDARIES = defineFeatureBoundaries({
  dependencies: FEATURE_DEPENDENCIES,
  infrastructureRoots: ["src/components", "src/config", "src/lib"],
  compositionRoots: ["src/app"],
});

export default defineConfig([
  globalIgnores(["dist", "node_modules"]),
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      sourceType: "module",
    },
    plugins: {
      "import-x": importX,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    settings: {
      "import-x/resolver-next": [
        createTypeScriptImportResolver({
          project: "./tsconfig.app.json",
        }),
      ],
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
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
]);
