FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
ARG APP_VERSION=0.2.1
LABEL org.opencontainers.image.title="RepoHarbor" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.source="https://github.com/zzxCoding/repo-harbor" \
      org.opencontainers.image.licenses="MIT" \
      io.code-atlas.codegraph="3.0.0"
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates tar \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-fund --registry=https://registry.npmjs.org \
    && npm cache clean --force
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY src ./src
COPY public ./public
RUN chmod 755 /app/src/askpass.mjs && mkdir -p /data && chown node:node /data \
    && /app/node_modules/.bin/codegraph doctor
ENV NODE_ENV=production DATA_DIR=/data PORT=8093 HOME=/data/home
USER node
EXPOSE 8093
HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8093/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.mjs"]
