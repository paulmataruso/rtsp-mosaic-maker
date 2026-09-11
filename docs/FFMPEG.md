# FFmpeg design

Everything here is implemented by **one dedicated command builder**
(`backend/src/services/ffmpeg-command.ts`, pure + unit‑tested) and a
**supervisor** (`ffmpeg-process.ts` + `ffmpeg-manager.ts`). No FFmpeg command
strings are scattered through the codebase.

```ts
buildMosaicCommand({ grid, output, encoder, tiles, publish, resilience, ffmpeg, hw })
  -> { bin, args, pretty (redacted), inputIndexToPosition, inputIndexKind, cell, canvas }
```

## Version

The image installs FFmpeg from **Debian 13 "trixie"** — currently
**`7.1.5`** (`ffmpeg -version` is logged at boot and shown in **Settings**). It
is dynamically linked against the system VA drivers, which is why Intel VAAPI
works with only `/dev/dri` passed in. It is compatible with MediaMTX 1.21.0's
RTSP implementation.

## The graph

For a `rows × cols` mosaic at `W × H`:

1. `cellW = even(floor(W / cols))`, `cellH = even(floor(H / rows))`.
2. **Every grid cell becomes exactly one input** — a live camera, an OFFLINE
   placeholder (`color=c=0x1a1a1a` + `drawtext`), or a plain background colour
   for an empty cell. This makes the `xstack` layout fully deterministic and
   lets the supervisor swap a failed camera for a placeholder **without
   changing the graph shape**.
3. Per input `i`:
   ```
   [i:v] <scale/crop/pad per fit mode> , fps=<out fps> , setsar=1 [, drawtext=<label>] [vi]
   ```
4. Composite: `[v0][v1]…[vN-1] xstack=inputs=N:layout=<pixel offsets>:fill=<bg> [grid]`
   (`xstack`'s `fill` needs FFmpeg ≥ 5.1; we're on 7.1). A 1×1 mosaic uses
   `null` instead of `xstack`.
5. Finalise: `[grid] pad=W:H:(ow-iw)/2:(oh-ih)/2:color=<bg> , format=<pixfmt|nv12,hwupload> [vout]`.
6. `-map [vout] -an -fps_mode cfr -r <fps> -muxdelay 0`
7. Encode (below), then `-f rtsp -rtsp_transport tcp rtsp://mediamtx:8554/<slug>`.

### Fit modes (per tile, spec §10)

| Mode | Filter |
|---|---|
| `fit` | `scale=w:h:force_original_aspect_ratio=decrease, pad=…:color=black` |
| `letterbox` | same, padded with the **mosaic background colour** |
| `fill` | `scale=w:h` (stretch, ignore aspect) |
| `crop` | `scale=w:h:force_original_aspect_ratio=increase, crop=w:h` |

Aspect ratio is preserved by default (`letterbox`).

### Labels (spec §9)

`drawtext` with a bundled DejaVu font (`FFMPEG_FONT_FILE`). Per‑tile:
enabled/disabled, text (defaults to the camera name), one of 6 positions, font
size, and a semi‑transparent `box` whose opacity is the "background opacity".
All text is escaped for drawtext's double parser. No external compositor.

## Encoders (spec §12)

Compositing is always done in **software** (predictable across mixed camera
resolutions / frame‑rates). Only the final H.264 encode is offloaded:

| Encoder | Args (abridged) | Notes |
|---|---|---|
| `libx264` (CPU) | `-c:v libx264 -preset veryfast -profile:v high -b:v Kk -maxrate Kk -bufsize 2Kk -bf 0 -g <2·fps>` | always available |
| `h264_vaapi` | `-vaapi_device /dev/dri/renderD128` … graph ends `format=nv12,hwupload` … `-c:v h264_vaapi -rc_mode CBR` | Intel iGPU |
| `h264_qsv` | `-init_hw_device qsv=hw -filter_hw_device hw` … `hwupload=extra_hw_frames=64` … `-c:v h264_qsv` | Intel Quick Sync |
| `h264_nvenc` | `-c:v h264_nvenc -preset p4 -tune ll -rc cbr` (system‑memory frames, no hwupload) | NVIDIA |

`GOP = round(gopSeconds · fps)`, `keyint_min` pinned equal, `-bf 0` for low
latency. The code path is written so **H.265/HEVC** is a matter of adding
encoder entries — `codec` is already an enum.

Availability is probed at boot with a real 0.1 s test encode
(`ffmpeg-capabilities.ts`); the UI disables encoders that fail and the API
refuses to **start** a mosaic whose encoder is unavailable, with a clear
message.

## Substreams (spec §13)

Each tile independently selects `main` or `sub`. The recommended default is
**substream** — it minimises decode CPU, network bandwidth and memory. The
designer defaults new tiles to `sub`; a camera with no substream URL falls
back to main and the UI warns.

## RTSP resilience — verified options

Research notes (see also the mailing‑list threads linked in the commit history):

* **`-stimeout` is removed** from modern FFmpeg. The correct option for RTSP is
  **`-timeout <µs>`** (socket I/O timeout). We set it from
  `Settings → RTSP connect timeout`.
* **`-rw_timeout` is *not* honoured by the RTSP demuxer** — don't rely on it.
* **`-reconnect`, `-reconnect_at_eof`, `-reconnect_streamed`,
  `-reconnect_delay_max`, `-reconnect_on_network_error` are HTTP/TCP‑protocol
  options and do *not* apply to RTSP.** FFmpeg has no dependable built‑in RTSP
  reconnect. Cross‑restart resilience is therefore the **supervisor's** job.

Per‑input hardening we *do* apply:

```
-rtsp_transport tcp        (or udp; "auto" -> -rtsp_flags prefer_tcp)
-timeout <ms·1000>
-fflags +genpts+discardcorrupt
-use_wallclock_as_timestamps 1
-analyzeduration 3000000 -probesize 5000000
-thread_queue_size 512
-err_detect ignore_err
```

## One camera dies — the mosaic does not (spec §23)

Layered handling:

1. **Known‑down at (re)start.** The camera monitor probes every enabled camera
   every `CAMERA_MONITOR_MS` (30 s). If a camera is `offline` when the builder
   runs, its tile is rendered as an **OFFLINE placeholder** — no RTSP input for
   it at all.
2. **Fails mid‑stream.** FFmpeg exits. The supervisor:
   * classifies the stderr tail (auth / timeout / refused / bad codec / …),
   * attributes the failure to a tile when FFmpeg named the input,
   * triggers an **immediate camera re‑probe** (don't wait for the 30 s sweep),
   * restarts with **exponential backoff + jitter**; state → `degraded` /
     `restarting`.
   On the next attempt the now‑known‑down camera is a placeholder, so the
   mosaic comes back showing an OFFLINE tile while the others play.
3. **Camera recovers.** The monitor sees it healthy again and asks the manager
   to reload that mosaic once, restoring the live tile.
4. **Gives up.** After `maxRestartAttempts` consecutive failed starts the
   mosaic is marked `failed` with an actionable message; an operator restarts
   it after fixing the cause.

**Known limitation (v1):** substituting a placeholder requires one supervised
restart, so a mid‑stream camera drop causes a brief (≈1–30 s, depending on how
fast the monitor confirms the camera is down) interruption of the *whole*
mosaic before it returns degraded. True zero‑restart per‑tile hot‑swap needs a
per‑camera relay layer and is a roadmap item.

## Stream synchronisation (spec §49)

Cameras differ in fps, PTS, keyframe interval and resolution. Normalisation:

* `-use_wallclock_as_timestamps 1` on every input (robust against bad camera PTS),
* `fps=<out fps>` per tile → common cadence,
* `setsar=1` + `scale`/`pad` → identical pixel geometry per cell,
* `-fps_mode cfr -r <fps>` on the output → a stable constant‑frame‑rate program
  even when sources stutter.

## Process management (spec §14)

`created → starting → running ⇄ degraded`, plus `restarting / stopped / failed`.
Spawn, **graceful `SIGTERM`→`SIGKILL`**, crash detection, exponential restart
backoff, `stdout` `-progress` parsing (`fps`, `bitrate`, `drop_frames`,
`dup_frames`, `speed`), structured stderr → the Logs page, `pidusage` CPU/RAM,
PID tracking, a no‑first‑frame watchdog, and a "healthy for long enough → forgive
restarts" reset. **On app shutdown every child FFmpeg is terminated — no
orphans.**

## Resource model (spec §34)

`resource-estimator.ts` gives a deliberately rough estimate (decode + composite
+ encode "cores per gigapixel/second", tile‑count aware) rendered as a band
(low / moderate / high / very‑high) against the host core count, shown live in
the designer. The dashboard shows the **measured** CPU/RAM of the running
FFmpeg processes next to it — trust the measurement, not the estimate.

## Performance target (spec §50)

`16 × 640×360 substreams → 4×4 → 1920×1080 H.264 @ 15 fps` is comfortable on a
modern quad/hex‑core mini‑PC with `libx264 -preset veryfast`. `16 × 1080p`
needs NVENC/QSV/VAAPI — see `docs/GPU.md`. CPU‑only 16×1080p encoding is *not*
cheap and the estimator says so.
