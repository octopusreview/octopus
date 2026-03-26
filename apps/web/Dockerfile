FROM oven/bun:1-alpine AS base

# --- deps ---
FROM base AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
COPY packages/agent-helpers/package.json ./packages/agent-helpers/
COPY packages/package-analyzer/package.json ./packages/package-analyzer/
COPY tools/tsconfig/package.json ./tools/tsconfig/
COPY tools/eslint-config/package.json ./tools/eslint-config/
RUN bun install --frozen-lockfile

# --- build ---
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY tools ./tools
COPY packages/db ./packages/db
COPY packages/package-analyzer ./packages/package-analyzer
COPY apps/web ./apps/web
COPY package.json bun.lock turbo.json ./
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
ENV BETTER_AUTH_SECRET="build-time-dummy-secret"
ENV BETTER_AUTH_URL="http://localhost:3000"
RUN touch .env
RUN cd packages/db && bun run db:generate
ARG NEXT_PUBLIC_BUILD_ID
ARG NEXT_PUBLIC_GITHUB_APP_SLUG
ARG NEXT_PUBLIC_PUBBY_KEY
ENV NEXT_PUBLIC_BUILD_ID=${NEXT_PUBLIC_BUILD_ID}
ENV NEXT_PUBLIC_GITHUB_APP_SLUG=${NEXT_PUBLIC_GITHUB_APP_SLUG}
ENV NEXT_PUBLIC_PUBBY_KEY=${NEXT_PUBLIC_PUBBY_KEY}
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN cd apps/web && bun run build

# --- runner ---
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache git && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000
ENV HOSTNAME=0.0.0.0
ENV NODE_OPTIONS="--max-old-space-size=4096"
CMD ["node", "apps/web/server.js"]
