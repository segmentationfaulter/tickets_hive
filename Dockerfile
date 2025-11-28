# syntax=docker/dockerfile:1

ARG NODE_VERSION=24.11.1

# Build stage - Type checking only
FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY packages/database/package.json ./packages/database/
COPY packages/types/package.json ./packages/types/
COPY packages/lib/package.json ./packages/lib/
RUN npm ci
COPY . .
# Type check only (no transpilation needed for native TS support)
RUN npm run build

# Development stage - uses native TypeScript
FROM node:${NODE_VERSION}-alpine AS development
WORKDIR /usr/src/app
COPY --from=builder /app ./
EXPOSE 3000 9229
# No CMD - services specify command in compose.yaml

# Production stage - runs TypeScript directly
FROM node:${NODE_VERSION}-alpine AS production
WORKDIR /usr/src/app
# No need to copy compiled dist - run TypeScript source directly
COPY --from=builder /app/apps ./apps
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/secrets ./secrets
# No CMD - services specify command in compose.yaml
