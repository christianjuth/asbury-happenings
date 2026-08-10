import tsParser from "@typescript-eslint/parser";
import { createNodeResolver, importX } from "eslint-plugin-import-x";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { FEATURE_DEPENDENCIES } from "./feature-boundaries.config.js";

const FEATURE_BOUNDARY_ZONES = buildFeatureBoundaryZones();

const DEAD_EXPORT_GRAPH = buildDeadExportGraph({
  exportRoots: ["src"],
  usageRoots: ["src", "test"],
});

const localRules = {
  rules: {
    "no-unused-exports": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Report exported declarations in src that are not imported anywhere in the codebase.",
        },
        messages: {
          unusedExport:
            "'{{name}}' is exported but not imported anywhere in src or test.",
        },
        schema: [],
      },
      create(context) {
        const filePath = normalizePath(context.filename);
        const unusedExports =
          DEAD_EXPORT_GRAPH.unusedExportsByFile.get(filePath);

        if (!unusedExports?.length) {
          return {};
        }

        return {
          Program(node) {
            for (const exportInfo of unusedExports) {
              context.report({
                node,
                loc: exportInfo.loc,
                messageId: "unusedExport",
                data: {
                  name: exportInfo.name,
                },
              });
            }
          },
        };
      },
    },
  },
};

export default [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["src/**/*.ts", "test/**/*.ts", "*.ts"],
    plugins: {
      "import-x": importX,
      local: localRules,
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
      "import-x/no-cycle": [
        "error",
        {
          ignoreExternal: true,
        },
      ],
      "import-x/no-restricted-paths": [
        "error",
        {
          basePath: process.cwd(),
          zones: FEATURE_BOUNDARY_ZONES,
        },
      ],
      "local/no-unused-exports": "error",
    },
  },
];

function buildFeatureBoundaryZones() {
  const features = Object.keys(FEATURE_DEPENDENCIES);

  return features.flatMap((importer) =>
    features
      .filter(
        (imported) =>
          imported !== importer &&
          !FEATURE_DEPENDENCIES[importer].includes(imported),
      )
      .map((imported) => ({
        target: path.join("src", importer),
        from: path.join("src", imported),
        message: `Feature "${importer}" may not import "${imported}". Add the directed edge "${importer} -> ${imported}" to feature-boundaries.config.js if this dependency is intentional.`,
      })),
  );
}

function buildDeadExportGraph({ exportRoots, usageRoots }) {
  const exportFiles = new Set(
    exportRoots.flatMap((root) => findTypeScriptFiles(root)),
  );
  const usageFiles = usageRoots.flatMap((root) => findTypeScriptFiles(root));
  const exportsByFile = new Map();
  const usedExportsByFile = new Map();

  for (const filePath of exportFiles) {
    const sourceFile = readSourceFile(filePath);
    const exportInfos = collectExports(sourceFile);

    if (exportInfos.length) {
      exportsByFile.set(filePath, exportInfos);
    }
  }

  for (const filePath of usageFiles) {
    const sourceFile = readSourceFile(filePath);

    collectImportUses(sourceFile, filePath, exportFiles, usedExportsByFile);
  }

  const unusedExportsByFile = new Map();

  for (const [filePath, exportInfos] of exportsByFile) {
    const usedNames = usedExportsByFile.get(filePath) ?? new Set();
    const unusedExports = exportInfos.filter(
      (exportInfo) => !usedNames.has(exportInfo.name),
    );

    if (unusedExports.length) {
      unusedExportsByFile.set(filePath, unusedExports);
    }
  }

  return { unusedExportsByFile };
}

function collectExports(sourceFile) {
  const exportInfos = [];

  for (const statement of sourceFile.statements) {
    if (hasExportModifier(statement)) {
      collectExportedDeclaration(statement, sourceFile, exportInfos);
      continue;
    }

    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const specifier of statement.exportClause.elements) {
        addExportInfo(
          exportInfos,
          specifier.name.text,
          specifier.name,
          sourceFile,
        );
      }
    }
  }

  return exportInfos;
}

function collectExportedDeclaration(statement, sourceFile, exportInfos) {
  if (hasDefaultModifier(statement)) {
    addExportInfo(exportInfos, "default", statement, sourceFile);
    return;
  }

  if (
    (ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement)) &&
    statement.name
  ) {
    addExportInfo(exportInfos, statement.name.text, statement.name, sourceFile);
    return;
  }

  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      collectBindingNameExports(declaration.name, sourceFile, exportInfos);
    }
  }
}

function collectImportUses(
  sourceFile,
  filePath,
  exportFiles,
  usedExportsByFile,
) {
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      collectImportDeclarationUses(
        statement,
        filePath,
        exportFiles,
        usedExportsByFile,
      );
      continue;
    }

    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      collectReExportUses(statement, filePath, exportFiles, usedExportsByFile);
    }
  }
}

function collectImportDeclarationUses(
  statement,
  filePath,
  exportFiles,
  usedExportsByFile,
) {
  const importedFilePath = resolveLocalModule(
    filePath,
    getModuleSpecifierText(statement),
    exportFiles,
  );

  if (!importedFilePath || !statement.importClause) {
    return;
  }

  if (statement.importClause.name) {
    addUsedExport(usedExportsByFile, importedFilePath, "default");
  }

  const namedBindings = statement.importClause.namedBindings;

  if (!namedBindings) {
    return;
  }

  if (ts.isNamespaceImport(namedBindings)) {
    markAllExportsUsed(usedExportsByFile, importedFilePath);
    return;
  }

  for (const specifier of namedBindings.elements) {
    addUsedExport(
      usedExportsByFile,
      importedFilePath,
      (specifier.propertyName ?? specifier.name).text,
    );
  }
}

function collectReExportUses(
  statement,
  filePath,
  exportFiles,
  usedExportsByFile,
) {
  const importedFilePath = resolveLocalModule(
    filePath,
    getModuleSpecifierText(statement),
    exportFiles,
  );

  if (!importedFilePath) {
    return;
  }

  if (!statement.exportClause) {
    markAllExportsUsed(usedExportsByFile, importedFilePath);
    return;
  }

  if (!ts.isNamedExports(statement.exportClause)) {
    return;
  }

  for (const specifier of statement.exportClause.elements) {
    addUsedExport(
      usedExportsByFile,
      importedFilePath,
      (specifier.propertyName ?? specifier.name).text,
    );
  }
}

function collectBindingNameExports(name, sourceFile, exportInfos) {
  if (ts.isIdentifier(name)) {
    addExportInfo(exportInfos, name.text, name, sourceFile);
    return;
  }

  for (const element of name.elements) {
    if (ts.isBindingElement(element)) {
      collectBindingNameExports(element.name, sourceFile, exportInfos);
    }
  }
}

function addExportInfo(exportInfos, name, node, sourceFile) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );

  exportInfos.push({
    name,
    loc: {
      line: line + 1,
      column: character,
    },
  });
}

function addUsedExport(usedExportsByFile, filePath, name) {
  const usedNames = usedExportsByFile.get(filePath) ?? new Set();

  usedNames.add(name);
  usedExportsByFile.set(filePath, usedNames);
}

function markAllExportsUsed(usedExportsByFile, filePath) {
  const sourceFile = readSourceFile(filePath);

  for (const exportInfo of collectExports(sourceFile)) {
    addUsedExport(usedExportsByFile, filePath, exportInfo.name);
  }
}

function hasExportModifier(node) {
  return Boolean(
    node.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ),
  );
}

function hasDefaultModifier(node) {
  return Boolean(
    node.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
    ),
  );
}

function getModuleSpecifierText(statement) {
  return ts.isStringLiteral(statement.moduleSpecifier)
    ? statement.moduleSpecifier.text
    : undefined;
}

function resolveLocalModule(importerPath, specifier, knownFiles) {
  if (!specifier?.startsWith(".")) {
    return undefined;
  }

  const basePath = normalizePath(
    path.resolve(path.dirname(importerPath), specifier),
  );
  const candidates = [
    basePath,
    replaceExtension(basePath, ".ts"),
    `${basePath}.ts`,
    normalizePath(path.join(basePath, "index.ts")),
  ];

  return candidates.find((candidate) => knownFiles.has(candidate));
}

function replaceExtension(filePath, extension) {
  return normalizePath(filePath.replace(/\.[cm]?[jt]s$/, extension));
}

function readSourceFile(filePath) {
  return ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
}

function findTypeScriptFiles(root) {
  const rootPath = normalizePath(path.resolve(root));

  if (!fs.existsSync(rootPath)) {
    return [];
  }

  return walkFiles(rootPath)
    .filter(
      (filePath) => filePath.endsWith(".ts") && !filePath.endsWith(".d.ts"),
    )
    .map(normalizePath);
}

function walkFiles(directory) {
  const files = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function normalizePath(filePath) {
  return path.resolve(filePath).replaceAll(path.sep, "/");
}
