export default {
  "apps/api/{src,test}/**/*.ts": "pnpm --filter @repo/api exec eslint --fix",
  "apps/web/src/**/*.{ts,tsx}": "pnpm --filter @repo/web exec eslint --fix",
  "*.{js,mjs,cjs,ts,tsx,json,jsonc,md,yml,yaml,css,html}": "prettier --write",
};
