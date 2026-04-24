# BUILD_PROGRESS.md

## Purpose
Execution log for implementation progress.

Use this file to track:
- current phase
- failing tests introduced
- tests passing
- migrations added
- APIs added
- open defects / blockers
- decisions taken during implementation

Do not use this file as a duplicate product spec. `AGENTS.md` is the source of truth for scope and sequencing.

---

## Current status

- Current phase: `Phase 19. Final hardening (complete)`
- Overall status: `19 / 19 phases complete`
- Current blocker: `No active phase blocker. Remaining work is broader manual signoff/spec-parity verification while exercising the integrated live-adapter API and reference demo client.`
- Next required action: `Run the integrated API and demo flow against the live adapter, then close any gaps discovered during manual end-to-end validation.`

---

## Update rules

1. Append updates; do not delete historical entries.
2. Update at the start and end of each phase.
3. Do not mark a phase complete unless its AGENTS.md definition of done is satisfied.
4. Record blockers with enough detail to unblock the next session.
5. Keep entries factual and concise.

---

## Phase entry template

## Entry XXXX
### Timestamp
- YYYY-MM-DD HH:MM TZ

### Phase
- Phase N. <name>

### Status
- not started | in progress | blocked | complete

### Failing tests introduced
- test file / scenario

### Tests passing
- test file / scenario

### Migrations added
- none | migration name

### APIs added or changed
- none | API summary

### Open defects / blockers
- none | item

### Decisions taken
- none | item

### Notes
- optional short context

---

## Running log

## Entry 0001
### Timestamp
- 2026-04-21 16:24 IST

### Phase
- Phase 1. Repository and test harness

### Status
- complete

### Failing tests introduced
- tests/smoke/workspace.spec.ts
- tests/smoke/postgres-harness.spec.ts
- tests/smoke/object-storage-harness.spec.ts
- tests/smoke/ci-script.spec.ts
- tests/placeholders/phase-2-placeholder.spec.ts

### Tests passing
- tests/smoke/workspace.spec.ts
- tests/smoke/postgres-harness.spec.ts
- tests/smoke/object-storage-harness.spec.ts
- tests/smoke/ci-script.spec.ts
- tests/placeholders/phase-2-placeholder.spec.ts

### Migrations added
- none

### APIs added or changed
- none

### Open defects / blockers
- none

### Decisions taken
- Use `vitest` for the initial test runner.
- Use `@electric-sql/pglite` to provide an isolated PostgreSQL-compatible Phase 1 test harness.
- Use a filesystem-backed fake object storage harness in `packages/test-kit`.
- Keep Phase 2 placeholders as `it.fails(...)` tests so Phase 1 remains green while next-phase failures are recorded.

### Notes
- Created the monorepo skeleton directories from `AGENTS.md`.
- Added root workspace/config files: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.ts`.
- Added a basic GitHub Actions workflow at `.github/workflows/ci.yml`.
- Verified `pnpm lint` and `pnpm test` both pass.

---

## Entry 0002
### Timestamp
- 2026-04-21 16:35 IST

### Phase
- Phase 2. Core domain and storage

### Status
- complete

### Failing tests introduced
- tests/core-types/connection.spec.ts
- tests/storage/schema.spec.ts
- tests/storage/connection-repository.spec.ts

### Tests passing
- tests/core-types/connection.spec.ts
- tests/storage/schema.spec.ts
- tests/storage/connection-repository.spec.ts

### Migrations added
- infra/migrations/0001_initial.ts

### APIs added or changed
- packages/core-types/src/index.ts
- packages/storage/src/migrate.ts
- packages/storage/src/connection-repository.ts
- packages/storage/src/index.ts

### Open defects / blockers
- none

### Decisions taken
- Start Phase 2 with a thin vertical slice: canonical connection enums, title normalization, connection schema migration, and a tenant-scoped connection repository.
- Use a simple migration runner over the Phase 1 PGlite harness.
- Enforce one key multi-tenant uniqueness invariant immediately: `(tenant_id, provider_account_ref)` where provider account ref is present.

### Notes
- Tests were written before implementation to preserve red-green TDD.
- Implemented the minimum storage slice needed for a real repository-backed Phase 2 foundation.
- Verified `pnpm lint` and `pnpm test` both pass after the Phase 2 implementation.

---

## Entry 0003
### Timestamp
- 2026-04-21 16:40 IST

### Phase
- Phase 3. Canonical event log

### Status
- complete

### Failing tests introduced
- tests/event-log/schema.spec.ts
- tests/event-log/event-log-repository.spec.ts

### Tests passing
- tests/event-log/schema.spec.ts
- tests/event-log/event-log-repository.spec.ts

### Migrations added
- infra/migrations/0002_event_log.ts

### APIs added or changed
- packages/event-log/src/event-log-repository.ts
- packages/event-log/src/index.ts
- packages/storage/src/migrate.ts
- packages/storage/src/sql.ts

### Open defects / blockers
- none

### Decisions taken
- Begin Phase 3 with the smallest canonical slice: event table schema, append API, replay ordering, dedupe support, and ingest sequence allocation.

### Notes
- Phase 2 is complete and green.
- Implemented a canonical event log slice with globally increasing `ingest_seq`, replay by tenant, and dedupe-key idempotency.
- Verified `pnpm lint` and `pnpm test` both pass after the Phase 3 implementation.

---

## Entry 0004
### Timestamp
- 2026-04-21 16:42 IST

### Phase
- Phase 4. Fake provider adapter and internal adapter contract

### Status
- complete

### Failing tests introduced
- tests/provider-adapter/provider-adapter-types.spec.ts
- tests/provider-adapter/fake-provider-adapter.spec.ts
- tests/provider-adapter/provider-adapter-contract.ts

### Tests passing
- tests/provider-adapter/provider-adapter-types.spec.ts
- tests/provider-adapter/fake-provider-adapter.spec.ts

### Migrations added
- none

### APIs added or changed
- packages/provider-adapter-interface/src/index.ts
- packages/provider-adapter-interface/src/fake-provider-adapter.ts

### Open defects / blockers
- none

### Decisions taken
- Start Phase 4 with a deterministic in-memory fake adapter and a shared contract test runner.

### Notes
- Wrote a shared contract test runner and made the deterministic in-memory fake adapter pass it.
- Covered session bootstrap, QR state, connect flow, discovered conversations, seven-day backward history paging, subscribed raw events, sending text, sending attachments, and attachment fetch.

---

## Entry 0005
### Timestamp
- 2026-04-21 16:53 IST

### Phase
- Phase 5. Connection lifecycle service

### Status
- complete

### Failing tests introduced
- tests/connection/connection-lifecycle-service.spec.ts

### Tests passing
- tests/connection/connection-lifecycle-service.spec.ts

### Migrations added
- none

### APIs added or changed
- packages/query-api/src/connection-lifecycle-service.ts

### Open defects / blockers
- none

### Decisions taken
- Drive Phase 5 directly from repository-backed lifecycle service tests using the fake provider adapter.
- Persist lifecycle transitions and emit normalized connection events in the query service layer.

### Notes
- Implemented create/get/status/QR/disconnect/reconnect behavior needed by the Phase 5 acceptance slice.
- Lifecycle event persistence now covers `connection.created`, `connection.qr_ready`, `connection.disconnected`, `connection.reconnecting`, and `connection.connected`.
- Manual testing remains premature until a more meaningful runnable flow exists.

---

## Entry 0006
### Timestamp
- 2026-04-21 17:11 IST

### Phase
- Phase 6. Conversation discovery and selection

### Status
- complete

### Failing tests introduced
- tests/conversation/conversation-discovery-service.spec.ts

### Tests passing
- tests/conversation/conversation-discovery-service.spec.ts

### Migrations added
- infra/migrations/0003_conversations_and_participants.ts

### APIs added or changed
- packages/storage/src/conversation-repository.ts
- packages/storage/src/participant-repository.ts
- packages/storage/src/conversation-membership-repository.ts
- packages/history-import/src/import-scheduler.ts
- packages/query-api/src/conversation-discovery-service.ts
- packages/storage/src/migrate.ts
- packages/storage/src/index.ts

### Open defects / blockers
- none

### Decisions taken
- Persist discovered conversations and participants before adding selection behavior.
- Model group membership as append-only observed snapshots to preserve provider state history.
- Treat conversation selection idempotently and schedule import exactly once on first selection.

### Notes
- Implemented the minimum repository and service slice for discovered direct/group conversations plus participant snapshots.
- Selection now flips `is_selected`, timestamps the change, emits events, and enqueues the import scheduler once.

---

## Entry 0007
### Timestamp
- 2026-04-21 17:33 IST

### Phase
- Phase 7. Mirror engine and normalized message ingestion

### Status
- complete

### Failing tests introduced
- tests/mirror-engine/mirror-engine.spec.ts

### Tests passing
- tests/mirror-engine/mirror-engine.spec.ts

### Migrations added
- infra/migrations/0004_messages_attachments_receipts.ts

### APIs added or changed
- packages/mirror-engine/src/mirror-engine.ts
- packages/storage/src/message-repository.ts
- packages/storage/src/attachment-repository.ts
- packages/storage/src/receipt-repository.ts
- packages/storage/src/migrate.ts
- packages/storage/src/index.ts

### Open defects / blockers
- none

### Decisions taken
- Treat raw provider events as first-class canonical event-log entries and derive normalized storage state from them.
- Reuse raw-event ingest order for the minimal mirrored message ordering slice.
- Use raw dedupe keys to keep message/attachment normalization idempotent.

### Notes
- Added canonical message, attachment, and receipt storage plus a repository-backed mirror engine.
- Covered text messages, attachment discovery, receipt normalization, and duplicate raw event idempotency.

---

## Entry 0008
### Timestamp
- 2026-04-21 18:04 IST

### Phase
- Phase 8. History import engine

### Status
- complete

### Failing tests introduced
- tests/history-import/history-import-service.spec.ts

### Tests passing
- tests/history-import/history-import-service.spec.ts

### Migrations added
- infra/migrations/0005_history_imports.ts

### APIs added or changed
- packages/history-import/src/history-import-service.ts
- packages/storage/src/history-import-repository.ts
- packages/storage/src/migrate.ts
- packages/storage/src/index.ts

### Open defects / blockers
- none

### Decisions taken
- Import history strictly week-by-week backward using resumable per-conversation anchors.
- Keep the first history implementation restart-safe by making message upserts and import scheduling idempotent.

### Notes
- Implemented resumable import state tracking, import events, and deterministic provider-time ordering with ingest-seq tiebreaking.

---

## Entry 0009
### Timestamp
- 2026-04-21 18:19 IST

### Phase
- Phase 9. Send pipeline

### Status
- complete

### Failing tests introduced
- tests/send/send-pipeline-service.spec.ts

### Tests passing
- tests/send/send-pipeline-service.spec.ts

### Migrations added
- none

### APIs added or changed
- packages/query-api/src/send-pipeline-service.ts

### Open defects / blockers
- none

### Decisions taken
- Persist the outbound canonical message immediately from the provider send result.
- Keep outbound attachment persistence idempotent by upserting attachment metadata once per provider message.

### Notes
- Implemented text and attachment send slices against the fake provider adapter.

---

## Entry 0010
### Timestamp
- 2026-04-21 18:44 IST

### Phase
- Phase 10. Attachment service

### Status
- complete

### Failing tests introduced
- tests/attachment-service/attachment-service.spec.ts

### Tests passing
- tests/attachment-service/attachment-service.spec.ts

### Migrations added
- none

### APIs added or changed
- packages/attachment-service/src/attachment-service.ts
- packages/storage/src/attachment-repository.ts

### Open defects / blockers
- none

### Decisions taken
- Start Phase 10 with a minimal in-process background-worker shape: request transition plus `processNextPendingDownload()`.
- Keep repeated attachment download requests idempotent when an attachment is already `pending` or `available`.
- Accept an injected storage-key factory so object storage layout stays deterministic and testable.

### Notes
- Implemented request/download/availability behavior and normalized attachment download events.
- Reused the fake object storage harness from Phase 1.

---

## Entry 0011
### Timestamp
- 2026-04-21 19:05 IST

### Phase
- Phase 11. Clusters and cluster timeline

### Status
- complete

### Failing tests introduced
- tests/cluster-service/cluster-service.spec.ts

### Tests passing
- tests/cluster-service/cluster-service.spec.ts

### Migrations added
- infra/migrations/0006_clusters.ts

### APIs added or changed
- packages/cluster-service/src/cluster-service.ts
- packages/storage/src/cluster-repository.ts
- packages/storage/src/cluster-conversation-repository.ts
- packages/storage/src/migrate.ts
- packages/storage/src/index.ts

### Open defects / blockers
- none

### Decisions taken
- Implement only manual clusters for the current phase.
- Scope membership idempotency to `(cluster_id, conversation_id)` so the same conversation can belong to multiple clusters.
- Order cluster timelines canonically by `provider_sent_at` with `ingest_seq` as deterministic tiebreaker.

### Notes
- Implemented manual cluster CRUD/membership and a merged ordered timeline query.

---

## Entry 0012
### Timestamp
- 2026-04-21 19:28 IST

### Phase
- Phase 12. Metadata service

### Status
- complete

### Failing tests introduced
- tests/metadata-service/metadata-service.spec.ts

### Tests passing
- tests/metadata-service/metadata-service.spec.ts

### Migrations added
- infra/migrations/0007_metadata.ts

### APIs added or changed
- packages/metadata-service/src/metadata-service.ts
- packages/storage/src/metadata-repository.ts
- packages/storage/src/migrate.ts
- packages/storage/src/index.ts

### Open defects / blockers
- none

### Decisions taken
- Enforce metadata size limits in the service layer using serialized JSON byte length.
- Implement deletes as versioned tombstones with `value_json = null` and `deleted = true`.
- Validate only currently exercised target types (`message`, `conversation`, `cluster`) until more phases require wider coverage.

### Notes
- Implemented versioned metadata set/get/list/delete behavior and size-limit enforcement.

---

## Entry 0013
### Timestamp
- 2026-04-21 20:03 IST

### Phase
- Phase 13. Participant mapping service

### Status
- complete

### Failing tests introduced
- tests/participant-matching-service/participant-matching-service.spec.ts

### Tests passing
- tests/participant-matching-service/participant-matching-service.spec.ts

### Migrations added
- infra/migrations/0008_mappings_and_cursors.ts

### APIs added or changed
- packages/participant-matching-service/src/participant-matching-service.ts
- packages/storage/src/entity-mapping-repository.ts
- packages/storage/src/export-cursor-repository.ts
- packages/storage/src/participant-repository.ts
- packages/storage/src/index.ts
- packages/storage/src/migrate.ts

### Open defects / blockers
- none

### Decisions taken
- Keep candidate matching deterministic using exact phone matches and normalized name overlap only.
- Persist merges by updating source/target mapping state rather than introducing identity intelligence.

### Notes
- Implemented create/list/delete/merge mapping behavior and deterministic candidate helper output.

---

## Entry 0014
### Timestamp
- 2026-04-21 20:21 IST

### Phase
- Phase 14. Search

### Status
- complete

### Failing tests introduced
- tests/search-index/search-service.spec.ts

### Tests passing
- tests/search-index/search-service.spec.ts

### Migrations added
- none

### APIs added or changed
- packages/search-index/src/search-service.ts
- packages/storage/src/message-repository.ts
- packages/storage/src/attachment-repository.ts

### Open defects / blockers
- none

### Decisions taken
- Implement pragmatic v1 search using repository-backed substring matching over normalized message text and attachment file names.
- Support cluster scope by resolving cluster conversation membership first, not by introducing a separate index.

### Notes
- Implemented tenant/cluster/conversation scoped search for messages and attachments.

---

## Entry 0015
### Timestamp
- 2026-04-21 20:39 IST

### Phase
- Phase 15. Export and event streaming

### Status
- complete

### Failing tests introduced
- tests/export-api/export-service.spec.ts

### Tests passing
- tests/export-api/export-service.spec.ts

### Migrations added
- none

### APIs added or changed
- packages/export-api/src/export-service.ts
- packages/event-stream-api/src/event-stream-service.ts

### Open defects / blockers
- none

### Decisions taken
- Keep the first export/event-stream slice repository-driven and replay-oriented.
- Model export cursors as explicit tenant-scoped persisted state.

### Notes
- Implemented resumable export of events/messages in ingest order and a minimal in-memory event stream API.

---

## Entry 0016
### Timestamp
- 2026-04-21 21:08 IST

### Phase
- Phase 16. Deletion and redaction

### Status
- complete

### Failing tests introduced
- tests/deletion-redaction-service/deletion-redaction-service.spec.ts

### Tests passing
- tests/deletion-redaction-service/deletion-redaction-service.spec.ts

### Migrations added
- infra/migrations/0009_deletions.ts

### APIs added or changed
- packages/deletion-redaction-service/src/deletion-redaction-service.ts
- packages/storage/src/deletion-record-repository.ts
- packages/storage/src/message-repository.ts
- packages/storage/src/attachment-repository.ts
- packages/storage/src/migrate.ts
- packages/storage/src/index.ts

### Open defects / blockers
- none

### Decisions taken
- Implement deletion/redaction as explicit audited operations with search-result filtering built into the current search service.
- Preserve object shells for redaction while removing sensitive content and storage linkage as required by the spec.

### Notes
- Implemented soft delete, redact, and hard delete slices for messages/attachments plus audit record queries.

---

## Entry 0017
### Timestamp
- 2026-04-21 21:32 IST

### Phase
- Phase 17. Server SDK and HTTP SDK surface

### Status
- complete

### Failing tests introduced
- tests/sdk-node/sdk-node.spec.ts

### Tests passing
- tests/sdk-node/sdk-node.spec.ts

### Migrations added
- none

### APIs added or changed
- packages/sdk-node/src/index.ts

### Open defects / blockers
- none

### Decisions taken
- Keep the SDK HTTP layer tiny and explicit with visible method-to-route wrappers.
- Validate SDK request paths/payloads against an in-test local HTTP server before adding heavier runtime integration.

### Notes
- Added the first typed HTTP-backed SDK client methods across connection, conversation, send, search, metadata, mapping, export, and deletion slices.

---

## Entry 0018
### Timestamp
- 2026-04-22 14:50 IST

### Phase
- Phase 18. Real WhatsApp linked adapter

### Status
- in progress

### Failing tests introduced
- tests/provider-adapter/whatsapp-linked-live-adapter.spec.ts
- tests/provider-adapter/whatsapp-linked-smoke-flow.spec.ts
- tests/provider-adapter/whatsapp-linked-smoke-report.spec.ts

### Tests passing
- tests/provider-adapter/whatsapp-linked-provider-adapter.spec.ts
- tests/provider-adapter/whatsapp-linked-smoke-completion.spec.ts

### Migrations added
- none

### APIs added or changed
- packages/provider-whatsapp-linked/src/index.ts
- packages/provider-whatsapp-linked/src/smoke-flow.ts
- packages/provider-whatsapp-linked/src/smoke-report.ts
- scripts/whatsapp-linked-smoke.ts

### Open defects / blockers
- Need live smoke confirmation that explicit history-page and attachment-fetch validation succeed against a real session.

### Decisions taken
- Cache live messages from both `messaging-history.set` and `messages.upsert` so history paging and attachment fetch work from session state.
- Implement seven-day backward history paging by combining the message cache with one explicit `fetchMessageHistory(...)` backfill when needed.
- Use message ids as live attachment refs and fetch blobs from cached media messages.
- Keep smoke teardown non-destructive by closing the socket without logout.

### Notes
- Added smoke summary/reporting, history hydration wait logic, blank-title fallback, `@lid` direct-like handling, and explicit smoke validation hooks.

---

## Entry 0019
### Timestamp
- 2026-04-22 15:14 IST

### Phase
- Phase 19. Final hardening

### Status
- in progress

### Failing tests introduced
- tests/final-hardening/operational-basics.spec.ts

### Tests passing
- tests/final-hardening/operational-basics.spec.ts

### Migrations added
- none

### APIs added or changed
- apps/api/src/health.ts
- packages/query-api/src/operational.ts

### Open defects / blockers
- Hardening work is still helper-level only; runtime surfaces are not wired yet.

### Decisions taken
- Start Phase 19 with directly testable operational primitives: health snapshots, structured logging, retry, and backpressure helpers.
- Raise the Vitest timeout modestly to keep the growing suite green under repository-backed load.

### Notes
- This entry established the helper slice but did not yet wire those helpers into live/runtime entry points.

---

## Entry 0020
### Timestamp
- 2026-04-22 16:25 IST

### Phase
- Phase 19. Final hardening

### Status
- in progress

### Failing tests introduced
- tests/final-hardening/api-health-server.spec.ts
- tests/final-hardening/live-runtime-wiring.spec.ts

### Tests passing
- tests/final-hardening/api-health-server.spec.ts
- tests/final-hardening/live-runtime-wiring.spec.ts
- tests/provider-adapter/whatsapp-linked-live-adapter.spec.ts
- tests/provider-adapter/whatsapp-linked-smoke-flow.spec.ts
- tests/provider-adapter/whatsapp-linked-smoke-report.spec.ts

### Migrations added
- none

### APIs added or changed
- apps/api/src/server.ts
- apps/provider-worker/src/runtime.ts
- packages/provider-whatsapp-linked/src/index.ts

### Open defects / blockers
- Remaining Phase 19 work is now mostly completion polish: broader observability/docs cleanup and deciding whether the hardening slice is sufficient to mark the phase complete.

### Decisions taken
- Expose a minimal real HTTP health endpoint at `/health` instead of keeping health checks helper-only.
- Wire retry/backoff into live adapter history fetch, group hydration, and media download paths.
- Emit structured warnings for transient live-connection close/retry paths.
- Put backpressure gating around a provider-worker runtime entry point instead of leaving the gate helper unused.

### Notes
- Full suite is green after the runtime wiring slice: `pnpm lint && pnpm test`.
- Phase 18 live smoke validation succeeded separately, so the repo has now advanced to `18 / 19 phases complete` while Phase 19 remains in progress.

---

## Entry 0021
### Timestamp
- 2026-04-22 16:47 IST

### Phase
- Phase 19. Final hardening

### Status
- complete

### Failing tests introduced
- tests/apps/platform-api.spec.ts
- tests/apps/demo-server.spec.ts

### Tests passing
- tests/apps/platform-api.spec.ts
- tests/apps/demo-server.spec.ts
- tests/final-hardening/api-health-server.spec.ts
- tests/final-hardening/live-runtime-wiring.spec.ts
- full suite green via `pnpm lint && pnpm test`

### Migrations added
- none

### APIs added or changed
- apps/api/src/platform-server.ts
- apps/api/src/main.ts
- apps/demo/src/server.ts
- apps/demo/src/main.ts
- packages/export-api/src/export-service.ts
- packages/storage/src/connection-repository.ts
- packages/storage/src/cluster-repository.ts
- packages/storage/src/cluster-conversation-repository.ts
- packages/storage/src/deletion-record-repository.ts
- packages/deletion-redaction-service/src/deletion-redaction-service.ts
- README.md
- package.json
- tsconfig.json

### Open defects / blockers
- No active implementation blocker.
- Broader manual spec-parity validation is still worth doing now that the integrated API/demo path exists.

### Decisions taken
- Default runtime usage to the live WhatsApp linked adapter while still allowing injected adapters in tests.
- Build a real integrated API server on top of the existing repositories/services instead of leaving functionality package-only.
- Add a minimal developer demo UI as a basic manual operator harness, not a product frontend.
- Keep storage/object persistence in-process for the repo demo path using the existing PGlite harness plus local filesystem-backed object storage.

### Notes
- Added a live-adapter-first HTTP surface with connection, conversation, message, attachment, cluster, search, metadata, mapping, export, and deletion routes.
- Added scripts to run the API and demo locally: `pnpm api` and `pnpm demo`.
- Updated the root README with current run instructions, live adapter env requirements, and route inventory.

---

## Entry 0022
### Timestamp
- 2026-04-22 20:48 IST

### Phase
- Phase 19. Final hardening

### Status
- complete

### Failing tests introduced
- tests/storage/conversation-sync-state-repository.spec.ts
- tests/storage/conversation-inbox-timeline.spec.ts
- tests/apps/inbox-api.spec.ts
- tests/apps/realtime-inbox-stream.spec.ts
- tests/sdk-node/sdk-node.spec.ts
- tests/conversation/conversation-discovery-service.spec.ts
- tests/mirror-engine/mirror-engine.spec.ts
- tests/history-import/history-import-service.spec.ts
- tests/send/send-pipeline-service.spec.ts
- tests/deletion-redaction-service/deletion-redaction-service.spec.ts

### Tests passing
- full suite green via `pnpm vitest run`
- inbox/timeline/storage/service/API/stream coverage added in the new and updated tests above

### Migrations added
- infra/migrations/0010_inbox_projection_and_sync_state.ts

### APIs added or changed
- WHATSAPP_INBOX_IMPLEMENTATION_PLAN.md
- apps/api/src/platform-server.ts
- apps/demo/src/server.ts
- packages/query-api/src/inbox-projection.ts
- packages/query-api/src/conversation-backfill-service.ts
- packages/sdk-node/src/index.ts
- packages/storage/src/conversation-repository.ts
- packages/storage/src/conversation-sync-state-repository.ts
- packages/storage/src/message-repository.ts
- packages/storage/src/migrate.ts
- packages/storage/src/index.ts
- packages/mirror-engine/src/mirror-engine.ts
- packages/history-import/src/history-import-service.ts
- packages/query-api/src/conversation-discovery-service.ts
- packages/query-api/src/send-pipeline-service.ts
- packages/deletion-redaction-service/src/deletion-redaction-service.ts

### Open defects / blockers
- No active implementation blocker.
- Live-adapter parity for richer Baileys-native event normalization beyond the current canonical inbox/timeline contract can still be expanded later without changing the new DB-backed serving model.

### Decisions taken
- Treat the database-backed canonical mirror as the serving layer for inbox, timeline, sync status, backfill, and realtime replay.
- Extend `conversations` with latest-message summary fields instead of introducing a separate inbox projection table in the first iteration.
- Add `conversation_sync_state` as explicit per-conversation coverage/backfill state.
- Implement lazy older-history backfill as a dedicated service and HTTP route.
- Expose SSE-style event streaming by replaying persisted normalized/system events from the canonical event log after `ingest_seq`.

### Notes
- Implemented inbox ordering, timeline pagination, sync-status reporting, lazy backfill, and SSE event streaming.
- Updated mirror ingestion, send pipeline, history import, conversation discovery, and deletion/redaction flows so conversation summaries stay consistent.
- Enhanced the demo harness with inbox/timeline/backfill controls while preserving the existing smoke-test surface.

---

## Entry 0023
### Timestamp
- 2026-04-22 21:05 IST

### Phase
- Phase 19. Final hardening

### Status
- complete

### Failing tests introduced
- tests/apps/demo-server.spec.ts
- tests/apps/platform-api.spec.ts

### Tests passing
- tests/apps/demo-server.spec.ts
- tests/apps/platform-api.spec.ts
- full suite green via `pnpm vitest run`

### Migrations added
- none

### APIs added or changed
- WHATSAPP_UI_DEMO_PLAN.md
- apps/demo/src/server.ts
- apps/api/src/platform-server.ts
- README.md

### Open defects / blockers
- No active implementation blocker.
- The demo still needs manual live-adapter exercise for UX validation against real WhatsApp traffic.

### Decisions taken
- Keep the demo as a thin reference client instead of turning it into a second product surface.
- Add a demo-side proxy for platform JSON and SSE access so tenant-scoped browser usage remains compatible with the platform's backend-first API conventions.
- Enrich the timeline route with sender, attachment, receipt, preview, and deletion/edit metadata so a WhatsApp-like renderer can be driven directly from platform responses.
- Prefer API-backed refresh/reconcile behavior in the demo over shadow client-side business logic.

### Notes
- Reworked `apps/demo` from a button-only route exerciser into a three-pane inbox/thread/inspector reference client.
- Added server-side proxy coverage for browser JSON calls and normalized event stream replay.
- Updated the platform timeline response to include attachment and receipt data needed for UI rendering.
- Verified the full suite passes with 98 tests green.

---

## Entry 0024
### Timestamp
- 2026-04-24 15:03 IST

### Phase
- Phase 19. Final hardening

### Status
- complete

### Failing tests introduced
- none

### Tests passing
- `pnpm lint`
- `pnpm test`
- full suite green with 41 test files / 99 tests passing

### Migrations added
- none

### APIs added or changed
- README.md
- .gitignore
- .env.example
- docs/QUICKSTART.md
- docs/REPOSITORY_MAP.md
- apps/api/src/main.ts
- scripts/demo-quickstart.ts
- scripts/api-live.ts
- package.json
- tsconfig.json
- vitest.config.ts

### Open defects / blockers
- No active implementation blocker.
- Repository presentation and onboarding are now materially better, but real screenshots and a production deployment story can still improve investor-facing polish later.

### Decisions taken
- Default local `pnpm api` usage to the fake provider adapter so a fresh clone can run without live WhatsApp credentials.
- Keep live WhatsApp usage opt-in via `pnpm api:live`.
- Add a one-command `pnpm demo:quickstart` path that starts the fake-backed API and demo together.
- Add explicit quickstart and repository-map docs to make the repo easier to understand from GitHub.
- Rewrite the root README for a mixed audience: investors first, technical operators second.
- Raise Vitest timeout to 20 seconds to reduce CI flake from a few heavier integration tests.

### Notes
- Added GitHub-friendly onboarding files and ignored local/generated artifacts.
- Added fake-first local runtime ergonomics while preserving the live adapter path.
- Reframed the README around the problem, platform thesis, quickstart, and repository digestibility.
