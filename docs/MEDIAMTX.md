# MediaMTX integration

Pinned image: **`bluenviron/mediamtx:1.21.0`**. The app talks to the
**Control API** (verified against v1.21.0's `apidocs/openapi.yaml`) rather than
editing `mediamtx.yml` blindly, so MediaMTX validates and hot‑applies every
change.

## What the app does

`backend/src/services/mediamtx-client.ts` (typed client) +
`mediamtx-service.ts` (domain logic):

| Need | Endpoint |
|---|---|
| server health / version / uptime | `GET /v3/info` |
| create a mosaic path | `POST /v3/config/paths/add/{slug}` with `{ source: "publisher", maxReaders: 0, record: false, overridePublisher: true }` |
| keep required knobs applied | `PATCH /v3/config/paths/patch/{slug}` |
| delete a mosaic path | `DELETE /v3/config/paths/delete/{slug}` (idempotent on 404) |
| list configured paths | `GET /v3/config/paths/list` (paginated) |
| inspect runtime paths / publishers / readers / tracks | `GET /v3/paths/list`, `GET /v3/paths/get/{slug}` |
| RTSP sessions | `GET /v3/rtsp/sessions/list` |

FFmpeg publishes each mosaic to `rtsp://mediamtx:8554/<slug>` (internal
network). MediaMTX exposes it to the LAN at `rtsp://<host>:8554/<slug>` — the URL
shown with a copy button on every mosaic. `<host>` is `PUBLIC_HOST` if set,
otherwise the address you opened the web UI on (from the request's `Host`
header, `X-Forwarded-Host`-aware).

## Reconciliation & self‑healing (spec §17, §33)

The **DB is the desired state**; MediaMTX is the actual state.

* **On boot:** wait for the Control API (retry up to 120 s — tolerates MediaMTX
  starting *after* the app), then for every mosaic slug: add it to MediaMTX if
  missing; delete any *managed* path whose mosaic is gone.
* **On a detected MediaMTX restart** (`/v3/info.started` changed): re‑add all
  managed paths; the FFmpeg supervisor re‑publishes on its next cycle.
* **Manual:** `POST /api/mediamtx/reconcile`, or the **Reconcile paths** button
  on the MediaMTX page.

The app only ever adds/deletes paths it recorded in the
`mediamtx_managed_paths` table. Paths you define yourself in `mediamtx.yml` show
up in the UI tagged **external** and are never touched.

## `mediamtx/mediamtx.yml`

Key settings (see the file for the full annotated config):

```yaml
api: yes
apiAddress: :9997          # NOT published to the host in docker-compose.yml
rtsp: yes
rtspAddress: :8554
rtspTransports: [tcp, udp]
authMethod: internal
authInternalUsers:
  - { user: any, ips: [],                         permissions: [{action: read},{action: playback}] }
  - { user: any, ips: [<private ranges>, ...],    permissions: [{action: publish},{action: api},{action: metrics}] }
paths: {}                  # runtime-managed
```

* **Reads are open to the LAN** — the Roku has no credentials.
* **Publishing and the Control API are restricted to private IP ranges**, which
  covers the Docker bridge network. To lock down further, replace `user: any`
  in the publish/api entry with a real user/pass and set
  `MEDIAMTX_PUBLISH_USER/PASS` + `MEDIAMTX_API_USER/PASS` on the app.

## Upgrading MediaMTX

1. Check the release notes for Control‑API or config‑schema changes:
   <https://github.com/bluenviron/mediamtx/releases>
2. Bump the tag in `docker-compose.yml`.
3. `docker compose up -d`.
4. Confirm the **MediaMTX** page shows the new version and your mosaic paths are
   `ready`. If a path went missing, hit **Reconcile paths**.

The client uses only stable `/v3/config/paths/*`, `/v3/paths/*`, `/v3/info` and
`/v3/rtsp/sessions/*` endpoints, which have been stable across the 1.x line.

## The separate MediaMTX web UI

If you deploy the standalone MediaMTX web UI, add its URL to the environment and
link to it — the **MediaMTX** page already has an **API docs** button. This app
remains the primary interface for mosaic management.

## Browser preview (optional, spec §31)

`hls: yes` is enabled, so any mosaic is previewable in a browser at
`http://<host>:8888/<slug>` without extra transcoding (MediaMTX remuxes the same
H.264). The Roku output stays pure RTSP. WebRTC is available too but needs ICE
ports opened — see `docs/DOCKER.md`.
