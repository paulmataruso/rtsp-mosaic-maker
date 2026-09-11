# Architecture

## 1. Pipeline

```
                     Web Browser
                          │  HTTP + WebSocket
                          ▼
              ┌───────────────────────────┐
              │  app container            │
              │                           │
              │  React UI (static)        │
              │  Fastify REST + /ws       │
              │  ┌─────────────────────┐  │
              │  │ FFmpeg Manager      │  │  spawn / supervise / backoff
              │  │  └─ FFmpeg child ×N │──┼──┐  (one per running mosaic)
              │  ├─────────────────────┤  │  │
              │  │ MediaMTX client     │──┼──┼──── Control API (/v3, :9997)
              │  ├─────────────────────┤  │  │
              │  │ Camera monitor      │  │  │
              │  │ Reconciler          │  │  │
              │  │ SQLite (Drizzle)    │  │  │
              │  └─────────────────────┘  │  │
              └───────────────────────────┘  │
                          ▲                   │ RTSP publish
              direct RTSP │                   ▼
                   ┌──────┴──────┐    ┌────────────────┐
                   │  IP Cameras │    │   mediamtx     │  RTSP :8554
                   │  RTSP/ONVIF │    │   container    │──────────────▶ Roku / LAN
                   └─────────────┘    └────────────────┘
```

* **Cameras connect directly to FFmpeg.** No NVR, no DW Spectrum, no restreamer
  in the video path.
* **FFmpeg** decodes each camera, normalises it (scale / crop / pad / fps /
  label), tiles them with `xstack`, encodes one H.264 program, and **publishes**
  it to MediaMTX over RTSP.
* **MediaMTX** is the only thing the Roku talks to.
* The **app** owns the desired configuration and drives everything else.

## 2. Why two containers (`app` + `mediamtx`)

The spec allows a 4‑container split (`app`, `ffmpeg`, `mediamtx`, `database`).
We deliberately ship **two**:

| Concern | Decision | Rationale |
|---|---|---|
| FFmpeg | **child processes of `app`**, not a separate service | The process manager needs a real parent/child relationship: direct `SIGTERM`→`SIGKILL`, `stdout`/`stderr` pipes for `-progress` + log capture, `pidusage`, and a guarantee that **no orphan FFmpeg survives** app shutdown. A separate container would need an RPC layer for spawn/kill/stream‑logs — complexity with no reliability gain. FFmpeg is CPU/GPU bound, not memory‑fragile, so isolation buys little. |
| Database | **SQLite file on a volume**, in‑process | Single‑writer, tiny dataset (cameras + mosaics + cells). A Postgres container is pure overhead for a LAN appliance. The persistence layer is written portably (ISO‑8601 text timestamps, JSON blobs, no SQLite‑only column types) so a `drizzle-orm/pg-core` dialect can be added later — see `backend/src/db/schema.ts`. |
| MediaMTX | **its own container**, pinned image | It's a separate, independently‑upgradable product with its own release cadence and its own config/API surface. Keeping it isolated means `docker compose pull` upgrades it cleanly, and a MediaMTX crash/restart doesn't take the app down (the app detects it and re‑reconciles). |
| GPU access | give the **`app`** container `/dev/dri` or the NVIDIA runtime | FFmpeg runs there, so that's where the device belongs. See `docs/GPU.md`. |

Result: `docker compose up -d` brings up the whole system; upgrades are
`docker compose pull && docker compose up -d --build`; restart behaviour is
`restart: unless-stopped` on both.

## 3. The desired‑state model (spec §33, §54)

```
   SQLite (desired)              MediaMTX (actual streaming state)
   ─────────────────            ──────────────────────────────────
   cameras                       runtime paths  (/v3/paths/list)
   mosaics  ──── slug ─────────▶ config paths   (/v3/config/paths/*)
   mosaic_cells                  publishers / readers
   mediamtx_managed_paths ◀──── bookkeeping: which paths WE own
```

* **The app database is the single source of truth.** FFmpeg owns video
  processing; MediaMTX owns RTSP distribution; the browser controls the system.
* Every mosaic has a **slug** (`Warehouse Main → warehouse-main`, overridable,
  validated before it's sent to MediaMTX). The MediaMTX path name **is** the slug.
* The app only ever creates/deletes MediaMTX paths that it recorded in
  `mediamtx_managed_paths`. Paths you define yourself in `mediamtx.yml` are never
  touched.

### Reconciliation

On **startup** (`backend/src/services/reconciler.ts`):

```
wait for MediaMTX Control API  (retry up to 120 s — tolerates MediaMTX booting after the app)
        │
add every mosaic slug that is missing from MediaMTX's config
delete every managed path that no longer has a mosaic
        │
start mosaics flagged "Start automatically" (staggered)
```

When MediaMTX **restarts** (detected because `/v3/info.started` changed), the
reconciler re‑adds all managed paths; the FFmpeg supervisor re‑publishes on its
next cycle. The system is self‑healing without relying on Docker start ordering.

## 4. FFmpeg process lifecycle (spec §14)

`backend/src/services/ffmpeg-manager.ts` runs a small state machine per mosaic:

```
 created → starting → running ⇄ degraded
                │         │
                │         └── FFmpeg exits ──▶ restarting ──(backoff)──▶ starting
                │                                   │
                └── stop requested ──▶ stopped      └── > maxRestartAttempts ──▶ failed
```

* **Spawn / graceful shutdown / crash detection / exponential backoff with
  jitter / structured stderr capture / PID tracking / health watchdog.**
* stderr is classified (auth failure, timeout, refused, bad codec, encoder
  missing, …) and, where FFmpeg names the input, the failing tile is attributed
  to a specific camera.
* A **no‑output watchdog** kills a start that never produces a frame.
* A mosaic that runs cleanly for `reconnectMaxDelayMs + 60 s` has its restart
  counter forgiven.
* On shutdown every child gets `SIGTERM` then `SIGKILL` — **no orphans**.

Camera‑failure isolation is covered in `docs/FFMPEG.md` §"One camera dies".

## 5. Live status

An in‑process typed `EventBus` (`backend/src/lib/event-bus.ts`) carries
`mosaic.status`, `camera.status`, `mediamtx.status`, `dashboard`, and `log`
events. The single `/ws` endpoint fans them out to subscribed browsers; the
`StatusHub` composes the FFmpeg process view with the MediaMTX runtime‑path view
for the REST endpoints. The UI never polls on a timer.

## 6. Persistence schema

`Camera`, `Mosaic`, `MosaicCell`, `SystemSettings` (single JSON row),
`MediamtxManagedPath`. See `backend/src/db/schema.ts` and the generated
migration in `backend/drizzle/`.

* Camera passwords are stored as **AES‑256‑GCM** ciphertext
  (`v1:salt:iv:tag:ciphertext`), key derived with scrypt from `APP_SECRET`
  (or a persisted random key file). They are never returned by the API
  (`hasPassword: boolean` instead), never logged, never placed in a UI‑visible URL.

## 7. Security posture

LAN appliance, but: no credential logging (pino redaction + a message‑level
scrubber), no passwords in API responses or UI URLs, credentials kept out of
frontend state. Optional single‑user bearer‑token auth (`APP_AUTH_ENABLED`),
structured so multi‑user auth can replace it without touching route handlers.
MediaMTX reads are open to the LAN (Roku has no credentials); publish + Control
API are restricted to private IP ranges.

## 8. Technology

| Layer | Choice |
|---|---|
| Backend | Node 20 + TypeScript (ESM), **Fastify 5**, `@fastify/websocket`, **Zod** validation + OpenAPI, **Drizzle ORM** + `better-sqlite3`, `pino` |
| Frontend | **React 18** + TypeScript + **Vite**, **Mantine 7** component library (dark‑mode, desktop‑first), `@tanstack/react-query`, `@dnd-kit` for the designer, `zustand` for the live‑status store |
| Streaming | **FFmpeg** (Debian 13 / 7.1.x), **MediaMTX 1.21.0** |
| Build | `tsup`/esbuild for the backend (fast), `tsc` for type‑checking, `vitest` for tests |
