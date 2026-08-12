# owu-gateway v2 Dockerfile
# Multi-stage build: backend TypeScript via tsx, frontend built separately.
FROM node:22-bookworm-slim AS base

WORKDIR /app

# 国内镜像加速：apt 源（deb.debian.org 在国内不可达/慢）
RUN sed -i -e 's|deb.debian.org|mirrors.aliyun.com|g' -e 's|security.debian.org|mirrors.aliyun.com|g' \
        /etc/apt/sources.list /etc/apt/sources.list.d/*.sources 2>/dev/null || true

# Install dependencies first (better-sqlite3 may need python3/make)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# npm 国内镜像
ENV npm_config_registry=https://registry.npmmirror.com

COPY package.json package-lock.json* ./
RUN npm ci

# --- Backend stage ---
FROM base AS backend

WORKDIR /app
COPY --from=base /app/node_modules ./node_modules
COPY . .

# Build frontend if present
RUN if [ -d frontend ]; then npm run build:frontend; fi || true

EXPOSE 3019

CMD ["./node_modules/.bin/tsx", "src/index.ts"]
