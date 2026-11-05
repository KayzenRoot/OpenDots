FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4310 DATABASE_PATH=/data/opendots.sqlite
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /data && chown node:node /data
COPY --from=build /app/dist ./dist
# Entrypoint validates config, waits (bounded) for Postgres, then execs the app.
# The app runs its idempotent, versioned migrations on startup and exits
# non-zero if they cannot run; exec preserves that exit code.
COPY deployment/docker-entrypoint.sh /usr/local/bin/opendots-entrypoint.sh
RUN chmod 0755 /usr/local/bin/opendots-entrypoint.sh
USER node
EXPOSE 4310
# Liveness only (no datastore access, no auth). Node 24 has global fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:4310/api/health").then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'
ENTRYPOINT ["/usr/local/bin/opendots-entrypoint.sh"]
CMD ["node", "dist/server/server/index.js"]

FROM node:24-bookworm-slim AS browser
ENV NODE_ENV=production BROWSER_HOST=0.0.0.0 BROWSER_PORT=4311 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npx playwright install --with-deps chromium && chmod -R a+rX /ms-playwright
COPY --from=build /app/dist/server ./dist/server
USER node
EXPOSE 4311
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:4311/health").then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'
CMD ["node", "dist/server/browser/index.js"]
