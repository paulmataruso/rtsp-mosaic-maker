# Third-party notices

This project's own source is licensed **AGPL-3.0-or-later** (see `LICENSE`).
This file documents the licenses of what it depends on, and why AGPL is
compatible with all of it.

## 1. npm dependencies (bundled into the shipped code)

Everything imported into the backend or bundled into the frontend's built JS
ends up distributed as part of this software, so its license matters directly.
Scanned transitively across every **production** dependency of `backend/`,
`frontend/` and `shared/` (208 resolved packages, from each package's
`package.json` `license` field). Re-run any time with:

```bash
node scripts/check-licenses.cjs
```

| License | Count | Examples |
|---|---:|---|
| MIT | 164 | `react`, `react-dom`, `fastify`, `@fastify/*`, `@mantine/*`, `@tanstack/react-query`, `@dnd-kit/*`, `zod`, `zustand`, `pino`, `better-sqlite3`, `onvif`, `pidusage` |
| ISC | 20 | `semver`, `lru-cache`, `yaml`, `zod-to-json-schema`, `which`, … |
| BlueOak-1.0.0 | 8 | `glob`, `minimatch`, `path-scurry`, `jackspeak`, … |
| BSD-3-Clause | 5 | `react-transition-group`, `ieee754`, `secure-json-parse`, … |
| Apache-2.0 | 5 | `drizzle-orm`, `detect-libc`, `fast-jwt`, `ecdsa-sig-formatter`, `tunnel-agent` |
| BSD-2-Clause | 1 | `uri-js` |
| 0BSD | 1 | `tslib` |
| Dual-licensed (MIT/BSD/Apache/CC0/WTFPL options) | 3 | `rc`, `type-fest`, `expand-template` |

**Zero copyleft dependencies.** Every one of these is a *permissive* license
(MIT/ISC/BSD/0BSD/BlueOak) or **Apache-2.0**, and permissive code can always be
incorporated into a copyleft (GPL/AGPL) work — that's precisely what permissive
licenses allow. Apache-2.0 specifically is listed by the FSF as compatible with
GPLv3/AGPLv3 (its patent-grant clause is why it is *not* compatible with GPLv2,
which doesn't apply here since this project uses AGPLv3). There is nothing in
the dependency tree that would prevent, or be violated by, licensing this
project under the AGPL.

Dev-only tooling (`typescript`, `vite`, `vitest`, `eslint`, `tsup`, …) was also
checked and contains no copyleft licenses either, though it wouldn't matter
either way — build tools aren't distributed as part of the running software.

## 2. External programs (not linked — invoked as separate processes)

| Program | License | How it's used |
|---|---|---|
| [FFmpeg](https://ffmpeg.org) | GPL-2.0-or-later / GPL-3.0-or-later (as built by Debian, which enables `libx264` etc.) | Installed as a system package in the Docker image and invoked via `child_process.spawn()` — a separate OS process communicating over `stdin`/`stdout`/`stderr` pipes and CLI arguments. No FFmpeg library is linked into this project's code. |
| [MediaMTX](https://github.com/bluenviron/mediamtx) | MIT | Runs in its own container; this project talks to it exclusively over the network (its HTTP Control API and RTSP). |

Running a GPL-licensed program via `exec`/subprocess, or over the network, is
the textbook case of **"mere aggregation"** rather than combining programs into
one work — the FSF's own GPL FAQ says invoking a separate program via a system
call does not require that program (or its caller) to share a license, because
no linking or shared address space is involved. The same reasoning applies to
communicating with MediaMTX over RTSP/HTTP, regardless of its license. This is
the same relationship practically every video tool — open- or closed-source —
has with FFmpeg.

Distributing the Docker image (which contains this AGPL project's code
alongside Debian's GPL FFmpeg package and Node.js) is ordinary "aggregate
distribution": each component keeps its own license and runs as an independent
process, exactly like any Linux distribution mixing GPL, LGPL, MIT and Apache
software. No relicensing of any component happens or is required in either
direction.

## 3. Fonts

DejaVu Sans (`fonts-dejavu-core`, used for FFmpeg `drawtext` tile labels) is
under the [Bitstream Vera / DejaVu fonts license](https://dejavu-fonts.github.io/License.html),
a permissive font license with no copyleft.

## Summary

| Component | License | Compatible with AGPL-3.0? |
|---|---|---|
| This repository | AGPL-3.0-or-later | — |
| All bundled npm dependencies | MIT / ISC / BSD / 0BSD / BlueOak / Apache-2.0 | Yes — permissive, one-directional compatible |
| FFmpeg (subprocess, not linked) | GPL | Not applicable — separate program, no linking |
| MediaMTX (separate network service) | MIT | Not applicable — separate program |
