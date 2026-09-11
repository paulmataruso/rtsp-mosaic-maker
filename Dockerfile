# syntax=docker/dockerfile:1.7
###############################################################################
# Camera Mosaic Platform — single application image
#
#   build stage : install all deps, build shared + backend (esbuild) + frontend
#   deps  stage : production-only node_modules
#   runtime     : Debian slim + pinned FFmpeg + VA drivers + fonts, non-root
#
# FFmpeg comes from Debian 13 "trixie" (currently 7.1.x) — a current stable
# release, dynamically linked against the system VA-API drivers so Intel VAAPI
# works out of the box (see docs/FFMPEG.md / docs/GPU.md). QSV and NVENC need
# the GPU compose overrides.
###############################################################################

ARG NODE_IMAGE=node:22-trixie-slim

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV npm_config_fund=false npm_config_audit=false
# better-sqlite3 falls back to a source build if no prebuild matches.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci
COPY . .
RUN npm run build:shared \
    && npm -w backend run build \
    && npm -w frontend run build

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV npm_config_fund=false npm_config_audit=false
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3333 \
    DATA_DIR=/data \
    DATABASE_URL=file:/data/app.db \
    DRIZZLE_MIGRATIONS_DIR=/app/backend/drizzle \
    FFMPEG_PATH=ffmpeg \
    FFPROBE_PATH=ffprobe \
    FFMPEG_FONT_FILE=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      fonts-dejavu-core \
      libva2 libva-drm2 mesa-va-drivers intel-media-va-driver \
      ca-certificates tini curl \
    && rm -rf /var/lib/apt/lists/* \
    && ffmpeg -hide_banner -version | head -n1

# Non-root runtime user; member of video + render so a passed-in /dev/dri
# render node is usable (the GPU compose overrides also add the host GID).
RUN groupadd -r app \
    && (getent group video  >/dev/null || groupadd -r video) \
    && (getent group render >/dev/null || groupadd -r render) \
    && useradd -r -g app -G video,render -d /app app \
    && mkdir -p /data /logs && chown -R app:app /app /data /logs

COPY --from=deps    /app/node_modules        ./node_modules
COPY --from=build   /app/backend/dist        ./backend/dist
COPY --from=build   /app/backend/drizzle     ./backend/drizzle
COPY --from=build   /app/backend/package.json ./backend/package.json
COPY --from=build   /app/frontend/dist       ./frontend/dist
COPY --from=build   /app/package.json        ./package.json

USER app
EXPOSE 3333
VOLUME ["/data", "/logs"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=4 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "backend/dist/index.js"]
