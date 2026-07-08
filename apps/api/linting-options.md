# Linting Options

Options, no changes:

## 1. TypeScript Built-Ins

`noUnusedLocals` / `noUnusedParameters` in `tsconfig`.

Catches:
- unused local variables
- unused private/non-exported functions
- unused imports, depending setup

Does not reliably catch:
- exported functions like `buildCalendarFeed()`
- “public but unused inside app” APIs

Good baseline, low complexity.

## 2. ESLint Unused Vars

`@typescript-eslint/no-unused-vars`.

Similar to TypeScript unused checks, more configurable.

Catches local unused things. Still does not solve exported helpers unless they are not exported.

Useful if we want ignore patterns like `_unused`.

## 3. `import-x/no-unused-modules`

Already have `eslint-plugin-import-x`. It includes `no-unused-modules`.

This is closest to what we mean.

Can catch:
- exported functions nobody imports
- unused modules

Would likely flag:
- `buildCalendarFeed`
- `buildCalendarDebugText`

Tradeoff:
- needs config tuning
- tests can count as usage unless configured otherwise
- dynamic imports / public API files can create false positives
- sometimes annoying in apps with intentionally exported utilities

## 4. Knip

Dedicated dead-code tool.

Can catch:
- unused files
- unused exports
- unused dependencies
- unused package scripts/types

Usually better than ESLint for project-wide dead code.

Tradeoff:
- new dev dependency/tool
- needs ignore config for entrypoints, tests, generated files

## 5. Remove Exports By Default

Not linting exactly, but good policy.

If a function is only used in one module, do not export it. Then TypeScript/ESLint can catch it as unused. Export only route-facing/test-needed APIs.

## Take

For this repo:
- Add TypeScript or ESLint local unused checks as baseline.
- Use `import-x/no-unused-modules` or `knip` if we specifically want “unused exported functions.”
- Start with `import-x/no-unused-modules` since dependency already exists, then move to `knip` if false positives get annoying.

## Implementation Note

`import-x/no-unused-modules` is currently a no-op under ESLint 10 in the installed plugin version because ESLint removed the FileEnumerator API that rule depends on.

The implemented approach is:
- TypeScript checks local unused code with `noUnusedLocals` and `noUnusedParameters`.
- ESLint runs a local `local/no-unused-exports` rule from `eslint.config.js`.
- That rule scans `src` exports and `src`/`test` imports with the TypeScript parser API, then reports exported `src` symbols that are not imported anywhere in the codebase.
