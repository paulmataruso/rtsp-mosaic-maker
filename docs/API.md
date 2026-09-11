# API reference

Interactive, always‑current docs (generated from the Zod schemas) are served by
the running app:

* Swagger UI — `http://<host>:3333/docs`
* OpenAPI JSON — `http://<host>:3333/docs/json`

All bodies and responses are `application/json`. Validation errors return
`400 { "error": { "code": "validation_error", "message", "details" } }`. Other
errors use the same envelope with codes `not_found` (404), `bad_request` (400),
`conflict` (409), `precondition_failed` (412), `resource_limit` (422),
`unauthorized` (401), `upstream_error` (502), `internal_error` (500).

## Auth

`APP_AUTH_ENABLED=false` (default): all endpoints are open; `POST /api/auth/login`
still issues a token so the client flow is uniform.

`APP_AUTH_ENABLED=true`: every `/api/*` route except `/api/health`,
`/api/auth/status`, `/api/auth/login` requires `Authorization: Bearer <token>`.
The `/ws` endpoint takes `?token=<jwt>`.

| Method | Path | Body | Result |
|---|---|---|---|
| `GET` | `/api/auth/status` | — | `{ authEnabled }` |
| `POST` | `/api/auth/login` | `{ username, password }` | `{ token, expiresIn }` |

## Health

| Method | Path | Result |
|---|---|---|
| `GET` | `/api/health` | `{ status: "ok" \| "degraded", uptimeSeconds, version, mediamtx: "online"\|"offline"\|"unknown", ffmpegProcesses, time }` — `503` when degraded |

## Cameras (spec §4, §6, §27)

| Method | Path | Body | Result |
|---|---|---|---|
| `GET` | `/api/cameras` | — | `Camera[]` |
| `POST` | `/api/cameras` | `CameraInput` | `Camera` (201) |
| `GET` | `/api/cameras/:id` | — | `Camera` |
| `PUT` | `/api/cameras/:id` | `Partial<CameraInput>` | `Camera` |
| `DELETE` | `/api/cameras/:id` | — | `{ ok: true }` — `409` if used by a running mosaic |
| `POST` | `/api/cameras/:id/test` | `{ streamType: "main"\|"sub", overrides?: {...} }` | `CameraTestResult` |
| `GET` | `/api/cameras/:id/status` | — | `CameraStatus` |
| `GET` | `/api/cameras-status` | — | `CameraStatus[]` |

`CameraInput`: `name, description?, host, mainRtspUrl, subRtspUrl?, username?,
password?, transport: "tcp"|"udp"|"auto", enabled?, onvif?: { host, port,
profileToken } | null`.

* `password` is **write‑only**: omit on update to leave it unchanged, send `""`
  to clear. Responses carry `hasPassword: boolean`, never the password.
* Credentials embedded in a pasted RTSP URL are moved into `username`/`password`
  and the stored URL is sanitised.

`CameraTestResult`: `{ ok, streamType, summary, steps: [{ step: "dns"|"tcp"|
"rtsp"|"auth"|"stream", ok, skipped, durationMs, message }], stream: { width,
height, codec, pixFmt, fps, bitrateKbps, hasAudio } | null }`.

## Mosaics (spec §7–§11, §18, §19, §27)

| Method | Path | Body | Result |
|---|---|---|---|
| `GET` | `/api/mosaics` | — | `Mosaic[]` |
| `POST` | `/api/mosaics` | `MosaicInput` | `Mosaic` (201) |
| `GET` | `/api/mosaics/:id` | — | `Mosaic` |
| `PUT` | `/api/mosaics/:id` | `Partial<MosaicInput>` | `Mosaic` — restarts FFmpeg if running |
| `DELETE` | `/api/mosaics/:id` | — | `{ ok: true }` — stops FFmpeg, removes the MediaMTX path, deletes config, verifies |
| `POST` | `/api/mosaics/:id/start` | — | `MosaicStatus` |
| `POST` | `/api/mosaics/:id/stop` | — | `MosaicStatus` |
| `POST` | `/api/mosaics/:id/restart` | — | `MosaicStatus` |
| `GET` | `/api/mosaics/:id/status` | — | `MosaicStatus` |
| `GET` | `/api/mosaics-status` | — | `MosaicStatus[]` |
| `GET` | `/api/mosaics/slug-preview?name=` | — | `{ slug, valid, reason }` |
| `POST` | `/api/mosaics/validate-slug` | `{ slug }` | `{ valid: true }` or `400` |

`MosaicInput`: `name, description?, slug?, rows, cols, width, height, fps,
videoBitrateKbps, codec: "h264", encoder: "libx264"|"h264_vaapi"|"h264_qsv"|
"h264_nvenc", gopSeconds?, backgroundColor?, autoStart?, enabled?,
cells: MosaicCellInput[]`.

`MosaicCellInput`: `position (row‑major, 0‑based), cameraId | null,
streamType: "main"|"sub", fitMode: "fit"|"fill"|"crop"|"letterbox",
label | null, labelEnabled, labelPosition, labelFontSize, labelBgOpacity,
enabled`.

`Mosaic` adds `id, rtspUrl (rtsp://PUBLIC_HOST:8554/slug), cells[] with ids,
createdAt, updatedAt`.

`MosaicStatus`: `{ mosaicId, slug, state: "created"|"starting"|"running"|
"degraded"|"stopped"|"failed"|"restarting", health, pid, since, restartCount,
lastExitCode, lastError, backoffUntil, metrics: { fps, bitrateKbps, frames,
dropFrames, dupFrames, speed, cpuPercent, memoryMb }, tiles: [{ position,
cameraId, cameraName, streamType, render: "live"|"placeholder"|"empty" }],
mediamtx: { pathExists, publishing, readers, tracks } }`.

## MediaMTX (spec §16, §17, §32)

| Method | Path | Result |
|---|---|---|
| `GET` | `/api/mediamtx/status` | `{ reachable, version, uptimeSeconds, apiUrl, publicRtspBase, paths: [{ name, managed, ready, source, tracks, readers, bytesReceived, bytesSent }], lastError }` |
| `GET` | `/api/mediamtx/paths` | the `paths[]` array above |
| `GET` | `/api/mediamtx/config-paths` | raw MediaMTX config path entries |
| `POST` | `/api/mediamtx/reconcile` | `{ ok: true }` — force a desired‑vs‑actual reconciliation |

## ONVIF (spec §5)

| Method | Path | Body | Result |
|---|---|---|---|
| `POST` | `/api/onvif/discover` | `{ timeoutMs }` | `{ devices: [{ address, port, xaddrs, name, hardware, scopes }] }` — always `200`; `[]` if nothing answered (needs host networking) |
| `POST` | `/api/onvif/profiles` | `{ host, port, username, password }` | `{ host, profiles: [{ token, name, resolution, fps, encoding, rtspUri }] }` |

## System (spec §12, §34, §25/settings)

| Method | Path | Body | Result |
|---|---|---|---|
| `GET` | `/api/system/settings` | — | `SystemSettings` |
| `PUT` | `/api/system/settings` | `Partial<SystemSettings>` | `SystemSettings` |
| `GET` | `/api/system/capabilities?refresh=` | — | `{ ffmpegVersion, probedAt, encoders: [{ id, available, detail }], devices: { dri[], nvidia } }` |
| `GET` | `/api/system/presets` | — | layouts / resolutions / fps / bitrates / encoders / fitModes |
| `POST` | `/api/system/estimate` | `{ width, height, fps, encoder, tiles: [{ streamType, sourceWidth?, sourceHeight? }], excludeMosaicId? }` | `{ band, estimatedCpuCores, estimatedMemoryMb, decodeLoad, encodeLoad, notes[], current }` |
| `GET` | `/api/system/dashboard` | — | `{ camerasOnline, camerasTotal, mosaicsRunning, mosaicsTotal, ffmpegProcesses, mediamtx, host: { cpuPercent, loadAvg1, memUsedMb, memTotalMb, cpuCount } }` |

`SystemSettings`: `defaultEncoder, defaultTransport, defaultStreamType,
defaultFitMode, rtspConnectTimeoutMs, rtspReadTimeoutMs, reconnectBaseDelayMs,
reconnectMaxDelayMs, maxRestartAttempts`.

## Logs (spec §22)

| Method | Path | Query | Result |
|---|---|---|---|
| `GET` | `/api/logs` | `source? ("app"\|"ffmpeg"\|"mediamtx"\|"camera"), level?, mosaicId?, cameraId?, since? (ISO), limit? (≤2000)` | `{ entries: [{ ts, level, source, message, mosaicId?, cameraId?, slug? }] }` |

Credential‑bearing strings are redacted before an entry is stored.

## WebSocket — `/ws` (spec §28)

Client → server: `{ type: "subscribe" \| "unsubscribe", channels: string[] }`,
`{ type: "ping" }`. Channels: `dashboard`, `mosaics`, `cameras`, `mediamtx`,
`logs`.

Server → client frames:

```
{ type: "hello", serverTime, channels }
{ type: "pong",  serverTime }
{ type: "dashboard",     payload: DashboardSummary }
{ type: "mosaic.status", payload: MosaicStatus }
{ type: "mosaic.removed", payload: { mosaicId } }
{ type: "camera.status", payload: CameraStatus }
{ type: "mediamtx.status", payload: MediamtxStatus }
{ type: "log", payload: LogEntry }
```

On connect the server sends `hello` then a snapshot of every current mosaic /
camera status, the MediaMTX status, and the dashboard. The UI never polls.
