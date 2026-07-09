FROM node:22-alpine AS deps
WORKDIR /app
ENV HUSKY=0
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile || pnpm install

FROM node:22-alpine AS build
WORKDIR /app
ENV HUSKY=0
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build
RUN pnpm prune --prod --ignore-scripts

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
