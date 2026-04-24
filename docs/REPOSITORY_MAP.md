# Repository map

This repo is organized as a platform-first monorepo.

## Top-level directories

- `apps/api` — integrated local API server
- `apps/demo` — thin reference client showing inbox, timeline, realtime stream, and inspector flows
- `packages/` — platform modules
- `infra/` — migrations and infrastructure artifacts
- `tests/` — unit, repository, service, API, and acceptance-style coverage
- `scripts/` — runnable helper entrypoints such as quickstart and smoke flows
- `docs/` — operator-facing repo guides

## Key packages

- `packages/storage` — canonical repositories and migrations wiring
- `packages/event-log` — append-only replayable event log
- `packages/mirror-engine` — raw provider event normalization and mirroring
- `packages/history-import` — week-by-week history import orchestration
- `packages/query-api` — connection, discovery, send, inbox projection, and backfill services
- `packages/attachment-service` — on-demand attachment retrieval and storage
- `packages/search-index` — message and attachment search
- `packages/cluster-service` — cluster CRUD and merged timelines
- `packages/metadata-service` — arbitrary app-defined metadata
- `packages/deletion-redaction-service` — deletion and redaction primitives
- `packages/export-api` — replay/export by ingest sequence
- `packages/provider-adapter-interface` — internal adapter contract and fake adapter
- `packages/provider-whatsapp-linked` — linked-device WhatsApp adapter implementation
- `packages/sdk-node` — typed server-facing SDK

## Read this order

If you are new to the repo, read in this order:

1. `README.md`
2. `docs/QUICKSTART.md`
3. `docs/REPOSITORY_MAP.md`
4. `AGENTS.md` for the product spec
5. `WHATSAPP_INBOX_IMPLEMENTATION_PLAN.md`
6. `WHATSAPP_UI_DEMO_PLAN.md`
7. `BUILD_PROGRESS.md`
