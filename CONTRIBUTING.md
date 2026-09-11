# Contributing

Thanks for taking a look.

## Setup

```bash
nvm use            # Node 20 (see .nvmrc)
npm install
docker compose -f docker-compose.dev.yml up -d   # MediaMTX + 2 synthetic RTSP cameras
npm run dev                                        # backend :3333, Vite UI :5173
```

Full details, project layout and the end‑to‑end smoke procedure are in
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Before opening a PR

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

CI (`.github/workflows/ci.yml`) runs all of the above on Node 20 & 22, builds the
Docker image, and does a `docker compose up` health check.

## Conventions

- TypeScript, ESM, 2‑space indent (`.editorconfig`).
- Shared types/validation live in `shared/` (Zod schemas → inferred types) and are
  imported by both the backend and the frontend — don't duplicate them.
- No FFmpeg command strings outside `backend/src/services/ffmpeg-command.ts`.
- Never log credentials or put them in API responses / UI‑visible URLs.
- After changing `backend/src/db/schema.ts`, run `npm run db:generate` and commit
  the generated migration.

## Scope

This is a live mosaic generator. Recording, motion detection, PTZ, multi‑user
auth, etc. are explicitly out of scope for v1 (see `docs/ARCHITECTURE.md` and the
"future architecture" notes) — but the code is structured so they can be added.
