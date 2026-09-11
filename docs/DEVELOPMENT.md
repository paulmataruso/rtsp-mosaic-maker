# Development

## Prerequisites

* Node 20.11+ (uses ESM, `--env-file`‑free — the backend parses `.env` itself)
* Docker + Compose (for MediaMTX + synthetic cameras during dev)
* No local FFmpeg needed for unit tests; needed for `npm run dev` if you point
  cameras at real streams (the dev compose provides synthetic ones)

## Layout (npm workspaces)

```
shared/     Zod schemas + inferred types + constants + pure utils   (built with tsc)
backend/    Fastify API + services + Drizzle/SQLite                  (built with tsup/esbuild)
  src/
    config/     env (zod-validated), logger (pino + redaction)
    db/         schema.ts, drizzle migrations, repos
    lib/        crypto, errors, event-bus, log-store, rtsp-url, host-metrics, async
    services/   ffmpeg-command (pure builder), ffmpeg-process, ffmpeg-manager,
                mediamtx-client, mediamtx-service, camera-tester, camera-monitor,
                onvif-service, resource-estimator, reconciler, status-hub,
                mosaic-service (planner), bootstrap, registry
    routes/     one file per resource; Zod schemas for validation + OpenAPI
    ws/         single /ws endpoint, bus fan-out
    test/       vitest
frontend/   React + Vite + Mantine                                  (built with vite)
mediamtx/   mediamtx.yml
docs/
```

## Run it locally

```bash
npm install

# MediaMTX + two synthetic RTSP cameras (test-cam-1 / test-cam-2)
docker compose -f docker-compose.dev.yml up -d

# backend on :3333 (tsx watch), frontend on :5173 (Vite, proxies /api + /ws)
npm run dev
```

Open <http://localhost:5173>. Add cameras pointing at:

```
rtsp://localhost:8554/test-cam-1     # 1280x720 @ 15 fps, moving box + clock
rtsp://localhost:8554/test-cam-2     # 640x360  @ 10 fps, SMPTE bars
```

> The dev compose mounts `mediamtx/mediamtx.dev.yml` — like production but with
> the Control API reachable from the host and the two `test-cam-*` paths
> pre‑declared. The app still creates mosaic paths via the API. To add your
> **own** external RTSP test source, run it as its own RTSP server or point a
> throw‑away permissive MediaMTX at it.

Individual dev servers:

```bash
npm run dev:backend      # just the API (builds shared first)
npm run dev:frontend     # just the UI
```

## Scripts

```bash
npm run build            # shared (tsc) + backend (tsup) + frontend (vite)
npm run typecheck        # tsc --noEmit across all three
npm run lint             # eslint (flat config at repo root)
npm test                 # backend unit tests (vitest)
npm run db:generate      # regenerate the Drizzle migration after editing schema.ts
npm run db:migrate       # apply migrations to $DATABASE_URL
```

`npm run dev` does **not** type‑check (tsx transpiles). Run `npm run typecheck`
before committing; CI should run `typecheck` + `lint` + `test` + `build`.

## Tests (spec §40)

`backend/src/test/`:

| File | Covers |
|---|---|
| `ffmpeg-command.test.ts` | the command builder: 4 / 9 / 16 cameras, 3×3 / 4×4 / 1×1, empty cells, OFFLINE placeholder, mixed main/sub, every fit mode, layout offsets, VAAPI/NVENC encoder args, credential injection + redaction, odd‑dimension rounding, publish URL |
| `slug.test.ts` | `slugify` + `validateSlug` (reserved names, double hyphen, length) |
| `crypto.test.ts` | AES‑256‑GCM round‑trip, tamper detection, `safeEqual`, unicode |
| `mediamtx-client.test.ts` | Control API: correct method/URL/body per call, Basic auth, pagination, idempotent delete, error mapping (fetch mocked) |
| `camera-service.test.ts` | camera CRUD, password never exposed, encrypted at rest, credential extraction from pasted URLs, URL sanitising, stream resolution |
| `mosaic-service.test.ts` | mosaic CRUD, slug auto‑derivation + disambiguation + custom validation, cell/grid validation, delete teardown order, `planBuild` (inputs per camera, suspect → placeholder) |
| `resource-estimator.test.ts` | band ratings and hardware‑encoder shift |

Run one file: `npm -w backend exec vitest run src/test/ffmpeg-command.test.ts`.

### End‑to‑end smoke (manual, needs Docker)

The full `Camera → FFmpeg → MediaMTX → RTSP client` path, reproducing what CI
would do:

```bash
cp .env.example .env    # just set APP_SECRET; PUBLIC_HOST auto-detects, APP_PORT defaults to 3333
docker compose up -d

# a permissive MediaMTX to act as a fake camera + a test pattern into it
docker run -d --name fakecam-mtx --network camera-mosaic_default bluenviron/mediamtx:1.21.0
docker run -d --name fakecam-src --network camera-mosaic_default \
  linuxserver/ffmpeg:version-7.1-cli \
  -re -stream_loop -1 -f lavfi -i "testsrc2=size=1280x720:rate=15" \
  -c:v libx264 -preset veryfast -g 30 -pix_fmt yuv420p -an \
  -f rtsp -rtsp_transport tcp rtsp://fakecam-mtx:8554/cam1

# then via the UI or the REST API:
#  1. add a camera:  rtsp://fakecam-mtx:8554/cam1   -> Test connection (all green)
#  2. new 2x2 mosaic, drop the camera into all 4 cells, 1280x720 / 10 fps / libx264
#  3. Save & Start  -> mosaic goes RUNNING, MediaMTX shows a publisher
#  4. read it back:
docker run --rm --network camera-mosaic_default linuxserver/ffmpeg:version-7.1-cli \
  -rtsp_transport tcp -i rtsp://camera-mosaic-mediamtx:8554/<slug> -t 3 -f null -
#  5. `docker stop fakecam-src` -> mosaic goes DEGRADED with OFFLINE tiles, FFmpeg stays up
#  6. `docker start fakecam-src` -> tiles go live again
#  7. delete the mosaic -> FFmpeg stops, MediaMTX path removed, no orphan processes

docker rm -f fakecam-src fakecam-mtx
docker compose down -v
```

## Adding a PostgreSQL dialect (later)

`backend/src/db/schema.ts` is written portably. To add Postgres:

1. Add a `schema.pg.ts` using `drizzle-orm/pg-core` table builders (same
   columns; `timestamp`/`jsonb` instead of text where you prefer).
2. In `db/index.ts` branch on the `DATABASE_URL` scheme: `postgres://` →
   `drizzle-orm/node-postgres`, else `better-sqlite3`.
3. Regenerate migrations for the pg dialect.

Repos and services already talk only to Drizzle query builders, not to SQLite.
