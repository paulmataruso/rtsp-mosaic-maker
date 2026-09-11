# Docker

## Files

| File | Purpose |
|---|---|
| `Dockerfile` | Multi‑stage: `build` (deps + esbuild backend + Vite frontend) → `deps` (prod `node_modules`) → `runtime` (Debian slim + FFmpeg + VA drivers + fonts, non‑root, `tini`, `HEALTHCHECK`). |
| `docker-compose.yml` | Production stack: `app` + `mediamtx`. |
| `docker-compose.dev.yml` | MediaMTX + two synthetic RTSP test cameras; run the app on the host. |
| `docker-compose.gpu-nvidia.yml` | NVENC override. |
| `docker-compose.gpu-intel.yml` | VAAPI / QSV override (passes `/dev/dri`). |
| `mediamtx/mediamtx.yml` | MediaMTX base config (API on, auth, RTSP; paths managed at runtime). |

## Start / stop / upgrade

```bash
cp .env.example .env          # set APP_SECRET (PUBLIC_HOST optional — auto-detected)
docker compose up -d          # build + start
docker compose ps
docker compose logs -f app
docker compose down           # stop, keep volumes
docker compose down -v        # stop + delete the database/logs volumes
```

**Upgrade the app** (new code):

```bash
git pull
docker compose up -d --build
```

**Upgrade MediaMTX**: bump the tag in `docker-compose.yml`
(`bluenviron/mediamtx:1.21.0` → new version), then `docker compose up -d`.
See `docs/MEDIAMTX.md` for compatibility notes.

**Upgrade FFmpeg**: change `ARG NODE_IMAGE` to a newer Debian‑based Node image
(the FFmpeg version tracks the Debian release), rebuild. The exact version is
logged at boot and shown in **Settings**.

## Volumes

| Mount | Contents | Notes |
|---|---|---|
| `app-data` → `/data` | `app.db` (SQLite), `secret.key` / `jwt.key` (only if `APP_SECRET` / `APP_JWT_SECRET` are unset) | back this up |
| `app-logs` → `/logs` | reserved for future file logging | pino currently logs JSON to stdout, captured by `docker logs` |

Camera **video is never persisted** — this is a live mosaic generator.

## Ports

| Host | Container | Service | Exposed to |
|---|---|---|---|
| `${APP_PORT:-3333}` | `3333` | app: web UI + REST + `/ws` | LAN admins |
| `${MEDIAMTX_PUBLIC_RTSP_PORT:-8554}` tcp+udp | `8554` | MediaMTX RTSP | **Roku / LAN players** |
| `8000-8001/udp` | `8000-8001` | RTP/RTCP for RTSP‑over‑UDP readers | LAN |
| `${MEDIAMTX_HLS_PORT:-8888}` | `8888` | MediaMTX HLS (optional browser preview) | LAN |
| *(not published)* | `9997` | MediaMTX Control API | app only, internal network |
| *(not published)* | `9998` | MediaMTX metrics | app only |

WebRTC (`8889`) is left unpublished by default — it needs an ICE UDP port range;
add it only if you want in‑browser WebRTC preview.

## Environment variables (spec §37)

All optional; defaults shown are what the container uses. Set them in `.env`
(compose interpolates it) or under `services.app.environment`.

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `3333` | app HTTP port inside the container |
| `PUBLIC_HOST` | *(blank → auto)* | host for **display** of RTSP URLs; blank = use each request's Host header |
| `DATABASE_URL` | `file:/data/app.db` | SQLite path (`postgres://…` reserved for later) |
| `MEDIAMTX_API_URL` | `http://mediamtx:9997` | Control API base |
| `MEDIAMTX_RTSP_URL` | `rtsp://mediamtx:8554` | where FFmpeg publishes (internal) |
| `MEDIAMTX_PUBLIC_RTSP_PORT` | `8554` | port used in **display** URLs |
| `MEDIAMTX_PUBLISH_USER/PASS` | *(empty)* | if set, FFmpeg authenticates to MediaMTX when publishing |
| `MEDIAMTX_API_USER/PASS` | *(empty)* | HTTP Basic auth for the Control API, if you enable it in `mediamtx.yml` |
| `APP_SECRET` | *(empty → key file)* | derives the AES key for camera passwords — **set this** |
| `APP_AUTH_ENABLED` | `false` | require a bearer token for `/api/*` |
| `APP_AUTH_USERNAME/PASSWORD` | `admin` / *(empty)* | single‑user login |
| `APP_JWT_SECRET` | *(empty → key file)* | JWT signing key |
| `LOG_LEVEL` | `info` | `trace`…`fatal`, `silent` |
| `FFMPEG_LOG_LEVEL` | `warning` | FFmpeg's own `-loglevel` |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe` | binary locations |
| `FFMPEG_FONT_FILE` | `…/DejaVuSans.ttf` | drawtext font for labels |
| `TZ` | `UTC` | timezone for log timestamps |
| `MAX_CONCURRENT_MOSAICS` | `8` | hard cap on running FFmpeg processes |
| `MAX_TOTAL_TILES` | `64` | hard cap on live tiles across all mosaics |
| `MEDIAMTX_POLL_MS` / `CAMERA_MONITOR_MS` / `METRICS_POLL_MS` | `4000` / `30000` / `3000` | poll intervals |

You never configure individual FFmpeg commands.

## Health checks

* `app`: the image's `HEALTHCHECK` curls `/api/health` (`200` = ok, `503` =
  degraded when MediaMTX is unreachable). Compose shows `healthy`/`unhealthy`.
* `mediamtx`: no in‑container shell to health‑check with; the app's reconciler
  polls the Control API and reports MediaMTX status in the UI and in
  `/api/health`. `restart: unless-stopped` covers crashes.

## Image size

The Debian `ffmpeg` metapackage pulls a lot of libraries (~1 GB image). This is
the trade for a current, VA‑driver‑linked FFmpeg with no custom build. If size
matters, swap the runtime stage for a slim purpose‑built FFmpeg — the app only
needs `ffmpeg` + `ffprobe` + `libx264` + the VA/QSV/NVENC runtimes you use.

## GPU

See `docs/GPU.md`. Quick version:

```bash
# Intel
docker compose -f docker-compose.yml -f docker-compose.gpu-intel.yml up -d
# NVIDIA
docker compose -f docker-compose.yml -f docker-compose.gpu-nvidia.yml up -d
```
