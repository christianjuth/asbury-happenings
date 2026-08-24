FROM node:22-alpine AS build
WORKDIR /app
ENV HUSKY=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/eslint-config/package.json ./packages/eslint-config/package.json
RUN pnpm install --frozen-lockfile --filter @repo/api...
COPY apps/api ./apps/api
COPY packages/eslint-config ./packages/eslint-config
RUN pnpm --filter @repo/api run build
RUN pnpm --filter @repo/api deploy --prod /prod/api

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /prod/api ./
EXPOSE 3101
CMD ["node", "dist/main.js"]
