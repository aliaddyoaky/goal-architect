# syntax=docker/dockerfile:1

# DeepSeek Harness (dsh) ships native bindings built for glibc, not musl.
# Use Debian (bookworm) based images so dsh's native addons resolve correctly.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001

RUN groupadd --gid 1001 nodejs \
  && useradd --uid 1001 --gid nodejs --system --shell /bin/sh --home-dir /app nextjs

# Install DeepSeek Harness (dsh) — required for full agent mode.
# The app spawns `dsh --profile <DSH_PROFILE>` as a child process.
# On Debian/glibc the gnu native bindings resolve correctly.
RUN npm install -g @deepseek-ai/dsh \
  && dsh --version

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Entrypoint fixes dsh-home ownership, then drops to the unprivileged user.
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 3001
ENTRYPOINT ["/app/entrypoint.sh"]
