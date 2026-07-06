import tsParser from "@typescript-eslint/parser";
import { createNodeResolver, importX } from "eslint-plugin-import-x";

export default [
  {
    ignores: ["dist/**", "node_modules/**"]
  },
  {
    files: ["src/**/*.ts", "test/**/*.ts", "*.ts"],
    plugins: {
      "import-x": importX
    },
    settings: {
      "import-x/extensions": [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"],
      "import-x/parsers": {
        "@typescript-eslint/parser": [".ts", ".mts", ".cts"]
      },
      "import-x/resolver-next": [
        createNodeResolver({
          extensionAlias: {
            ".js": [".ts", ".js"],
            ".mjs": [".mts", ".mjs"],
            ".cjs": [".cts", ".cjs"]
          },
          extensions: [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json", ".node"]
        })
      ]
    },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module"
    },
    rules: {
      "import-x/no-cycle": [
        "error",
        {
          ignoreExternal: true
        }
      ]
    }
  }
];
