# syntax=docker/dockerfile:1

# --- Base: shared setup for every stage ---
FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts

# --- deps: install node_modules (runs `prisma generate` via postinstall) ---
FROM base AS deps
RUN npm ci

# --- build: compile the TypeScript API to dist/ ---
FROM deps AS build
COPY . .
RUN npx prisma generate && npm run build

# --- runtime: minimal production image ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# node_modules is copied unpruned so the Prisma CLI stays available for
# `prisma migrate deploy` at container start.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY package.json package-lock.json ./

EXPOSE 5000
USER node

CMD ["node", "dist/server.js"]
