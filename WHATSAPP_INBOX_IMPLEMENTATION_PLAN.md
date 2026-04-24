# WHATSAPP_INBOX_IMPLEMENTATION_PLAN.md

## Purpose

This file is the working implementation reference for evolving YipYap into a database-backed, WhatsApp-like inbox/timeline API.

It complements `AGENTS.md`.

- `AGENTS.md` remains the authoritative product and sequencing spec for the overall platform.
- This file is the authoritative implementation plan for the inbox/timeline serving model needed to support a WhatsApp-like interface over the API.

This document is intentionally concrete and repo-specific so implementation can proceed against it directly.

---

## 1. Problem statement

The platform must support an API consumer that wants to render a WhatsApp-like interface from YipYap API responses.

That means the API must reliably support:

1. **Inbox / chat list**
   - direct and group chats
   - ordered by latest provider message descending
   - stable chat preview data
   - resilient across restarts

2. **Open chat / timeline**
   - messages for one conversation
   - stable ordering
   - cursor pagination
   - enough normalized data for UI rendering

3. **Realtime updates**
   - inbound messages
   - outbound messages
   - status / receipt changes
   - inbox reordering when latest message changes

4. **Historical fetch**
   - older messages can be fetched on demand
   - fetched messages become part of canonical timeline state
   - repeated backfills remain idempotent

The current repo already has the canonical data model and major service building blocks, but it does **not yet** maintain a proper inbox/timeline read model for this SLA.

---

## 2. Core architecture decision

### Decision
The API consumer must read from the **database-backed canonical mirror**, not from live Baileys session memory.

### Provider role
The live WhatsApp/Baileys adapter is only responsible for:

- connection bootstrap
- live event ingress
- history backfill
- attachment fetch

### Serving role
Postgres-backed canonical state and projections must serve:

- inbox chat list
- conversation timeline
- sync status
- replay/export
- realtime stream payloads

### Why
A WhatsApp-like interface needs stable queries such as:

- list chats ordered by latest message desc
- open a chat and page messages
- update chat order immediately on inbound/outbound message
- survive process restarts
- resume streams from durable sequence state

These are database problems, not live provider-memory query problems.

---

## 3. Current repo status

### Already present

- live linked-device adapter in `packages/provider-whatsapp-linked`
- canonical normalized repositories in `packages/storage`
- append-only event log in `packages/event-log`
- mirror engine in `packages/mirror-engine`
- history import in `packages/history-import`
- send pipeline in `packages/query-api`
- attachment service in `packages/attachment-service`
- event stream/export basics in `packages/event-stream-api` and `packages/export-api`
- integrated HTTP server in `apps/api`

### Main functional gaps

1. `conversations.last_provider_message_at` exists but is not maintained as an authoritative inbox-sort field.
2. No stable conversation summary projection for last message preview / type / direction.
3. No explicit per-conversation sync coverage state for recent-window readiness and older-history availability.
4. Current discovery route is not a UI-grade inbox route.
5. No dedicated timeline route with cursor semantics intended for a WhatsApp-like interface.
6. No dedicated backfill route / state machine for lazy older-history expansion.
7. Realtime stream layer is not yet UI-grade for inbox/timeline consumers.

---

## 4. Target serving model

Use the following 3-layer model:

### Layer A — Raw provider event log
Source of truth for:
- audit
- replay
- recovery/debugging

Backed by existing `event_log` table.

### Layer B — Normalized canonical mirror
Source of truth for:
- conversations
- participants
- messages
- attachments
- receipts

Backed by existing canonical tables.

### Layer C — UI-oriented conversation projection + sync state
Source of truth for:
- inbox ordering
- last message preview
- latest message metadata
- recent-window readiness
- older-history availability

This will be implemented by:
- enriching `conversations`
- adding a new `conversation_sync_state` table

---

## 5. Data model changes

## 5.1 Extend `conversations`

These fields must become authoritative for inbox rendering:

- `last_provider_message_at` timestamp nullable
- `last_mirrored_message_at` timestamp nullable
- `last_message_id` nullable id
- `last_message_ingest_seq` nullable bigint
- `last_message_preview` nullable text
- `last_message_type` nullable enum
- `last_message_direction` nullable enum
- `inbox_visible` boolean default true
- `recent_window_anchor_at` nullable timestamp
- `recent_window_complete_through` nullable timestamp
- `recent_window_status` enum:
  - `unknown`
  - `bootstrapping`
  - `partial`
  - `ready`
  - `failed`

### Notes
- `last_provider_message_at` and `last_mirrored_message_at` already exist and must now become actively maintained.
- `last_message_*` fields prevent expensive latest-message recomputation during inbox reads.
- `recent_window_*` fields provide a conversation-level summary of whether the “recent inbox” mirror is trustworthy.

---

## 5.2 Add `conversation_sync_state`

### Purpose
Track per-conversation mirror coverage and backfill progress.

### Fields
- `id`
- `tenant_id`
- `conversation_id`
- `connection_id`
- `recent_window_days` integer
- `recent_window_start_at` nullable timestamp
- `recent_window_end_at` nullable timestamp
- `earliest_mirrored_provider_sent_at` nullable timestamp
- `latest_mirrored_provider_sent_at` nullable timestamp
- `older_history_possible` boolean
- `newer_history_possible` boolean
- `bootstrap_state` enum:
  - `not_started`
  - `queued`
  - `running`
  - `partial`
  - `ready`
  - `failed`
- `backfill_state` enum:
  - `idle`
  - `queued`
  - `running`
  - `paused`
  - `exhausted`
  - `failed`
- `last_backfill_anchor_cursor` nullable text
- `last_backfill_requested_at` nullable timestamp
- `last_backfill_completed_at` nullable timestamp
- `last_error_code` nullable string
- `last_error_message` nullable text
- `created_at`
- `updated_at`

### Constraints
- unique `(tenant_id, conversation_id)`

### Why separate table
This state is operational / coverage state and should not overload the core `conversations` record.

---

## 5.3 Extend `messages`

The existing `messages` table is close, but add fields that make interface rendering and reconciliation easier:

- `from_me` boolean default false
- `provider_sender_ref` nullable string
- `message_preview_text` nullable text
- `deleted_at` nullable timestamp
- `edited_at` nullable timestamp
- `is_latest_in_conversation` boolean default false

### Notes
- `direction` remains useful, but `from_me` removes ambiguity for UI consumers.
- `provider_sender_ref` helps render group timelines before all participant mappings are resolved.
- `message_preview_text` should be computed on write so preview logic is stable.
- `is_latest_in_conversation` is optional but recommended for consistency checks and easier latest-message repair.

---

## 5.4 No separate inbox projection table for now

Do **not** add a dedicated `conversation_inbox_projection` table in the first iteration.

Reason:
- simpler initial migration path
- fewer joins
- current repo size favors evolving `conversations` directly first

If performance or projection complexity grows later, that table can be introduced as a second-stage optimization.

---

## 6. Required indexes

### Conversations
- `(tenant_id, connection_id, inbox_visible, last_provider_message_at desc, last_message_ingest_seq desc)`
- `(tenant_id, connection_id, conversation_type, last_provider_message_at desc)`
- `(tenant_id, connection_id, recent_window_status, last_provider_message_at desc)`

### Messages
- `(tenant_id, conversation_id, provider_sent_at asc, ingest_seq asc)`
- `(tenant_id, conversation_id, provider_sent_at desc, ingest_seq desc)`
- `(tenant_id, connection_id, provider_sent_at desc)`
- unique where feasible on `(tenant_id, conversation_id, provider_message_id)`

### Conversation sync state
- `(tenant_id, conversation_id)` unique
- `(tenant_id, connection_id, bootstrap_state, updated_at)`
- `(tenant_id, connection_id, backfill_state, updated_at)`

These are required for low-latency inbox and timeline reads.

---

## 7. Projection update rules

Conversation summary fields must be updated whenever an event can affect inbox ordering or the latest visible message.

## 7.1 On bootstrap/history-set ingestion

Event source:
- Baileys `messaging-history.set`

Actions:
1. upsert conversation shells
2. upsert participants if available
3. ingest messages into canonical `messages`
4. for each affected conversation, compute latest visible message
5. update `conversations`:
   - `last_provider_message_at`
   - `last_message_id`
   - `last_message_ingest_seq`
   - `last_message_preview`
   - `last_message_type`
   - `last_message_direction`
   - `last_mirrored_message_at`
   - `recent_window_status` => `bootstrapping` or `partial`
6. initialize / update `conversation_sync_state`

---

## 7.2 On inbound message

Event source:
- normalized live provider ingest

Actions:
1. upsert message
2. if message is newer than current latest visible message, update conversation summary
3. set:
   - `last_provider_message_at = message.provider_sent_at`
   - `last_message_*` from this message
   - `last_mirrored_message_at = now`
4. update sync coverage:
   - `latest_mirrored_provider_sent_at`
   - `recent_window_end_at`
5. emit realtime events:
   - `message.upserted`
   - `conversation.updated`
   - `conversation.reordered`

---

## 7.3 On outbound send

Event source:
- send pipeline

Actions:
1. create canonical outbound message immediately
2. mark:
   - `from_me = true`
   - `direction = outbound`
3. update latest-message conversation summary exactly as for inbound
4. emit reorder event immediately
5. reconcile later receipt/status updates without delaying chat movement

This ensures WhatsApp-like behavior where sending a message instantly moves the chat to the top.

---

## 7.4 On receipt/status update

Actions:
1. update message status
2. emit `message.updated`
3. optionally emit `conversation.updated` if latest-message display changed
4. do **not** reorder inbox unless provider timestamp/order changes

---

## 7.5 On delete/redact

If the latest visible message is deleted or redacted:
1. update message row
2. recompute latest visible message for that conversation
3. update `last_message_*`
4. if no visible message remains:
   - preserve conversation shell
   - clear preview fields
   - keep or recompute `last_provider_message_at` according to visibility rules

Default serving behavior should use the latest visible non-soft-deleted message for inbox preview.

---

## 7.6 On backfill completion

Actions:
1. upsert older messages
2. update coverage fields:
   - `earliest_mirrored_provider_sent_at`
   - `older_history_possible`
   - `last_backfill_*`
3. do not reorder inbox unless a newer unexpected latest message was discovered
4. emit:
   - `conversation.sync.updated`
   - `conversation.timeline.expanded`

---

## 7.7 On conversation metadata update

Examples:
- title changes
- group participant count changes

Actions:
1. update conversation metadata
2. emit `conversation.updated`
3. do not reorder unless activity timestamp changed

---

## 8. Preview generation rules

`last_message_preview` and `message_preview_text` must be deterministic.

Rules:
- text => first 140 chars of `text_body`
- image with caption => caption
- image without caption => `[Image]`
- video => `[Video]`
- audio => `[Audio]`
- document => `[Document] <file_name?>`
- system => concise system phrase
- deleted => `[Message deleted]`
- redacted => `[Message redacted]`

Compute once during write/update; do not recompute ad hoc in inbox queries.

---

## 9. API contracts to add

## 9.1 Inbox chat list

### Route
`GET /connections/:connectionId/inbox/chats`

### Query params
- `type=direct|group|broadcast|unknown|all`
- `active_since=<ISO timestamp>` optional
- `selected=true|false` optional
- `recent_window_status=ready|partial|bootstrapping|failed` optional
- `cursor=<opaque cursor>` optional
- `limit=<n>` default 50 max 200

### Ordering
Always:
1. `last_provider_message_at desc`
2. `last_message_ingest_seq desc`
3. `conversation.id asc`

### Response shape
```json
{
  "items": [
    {
      "conversationId": "conv_1",
      "providerConversationId": "123@s.whatsapp.net",
      "type": "direct",
      "title": "Alice",
      "participantCount": 2,
      "selected": false,
      "lastMessageAt": "2026-04-22T12:00:00.000Z",
      "lastMessage": {
        "messageId": "msg_1",
        "type": "text",
        "direction": "inbound",
        "fromMe": false,
        "preview": "See you tomorrow",
        "status": "delivered"
      },
      "sync": {
        "recentWindowStatus": "ready",
        "earliestMirroredAt": "2026-04-15T00:00:00.000Z",
        "latestMirroredAt": "2026-04-22T12:00:00.000Z",
        "olderHistoryPossible": true
      }
    }
  ],
  "nextCursor": "..."
}
```

---

## 9.2 Conversation timeline

### Route
`GET /conversations/:conversationId/timeline`

### Query params
- `before=<opaque cursor>` optional
- `after=<opaque cursor>` optional
- `limit=<n>` default 50 max 200
- `include_deleted=false|true` optional

### Ordering
Ascending by:
- `provider_sent_at`
- `ingest_seq`

### Response shape
```json
{
  "conversation": {
    "conversationId": "conv_1",
    "title": "Alice",
    "type": "direct"
  },
  "items": [
    {
      "messageId": "msg_1",
      "providerMessageId": "ABCD",
      "sentAt": "2026-04-22T11:00:00.000Z",
      "fromMe": false,
      "direction": "inbound",
      "senderParticipantId": "participant_1",
      "messageType": "text",
      "text": "hello",
      "attachment": null,
      "status": "delivered",
      "quotedMessageId": null
    }
  ],
  "pageInfo": {
    "nextBeforeCursor": "...",
    "nextAfterCursor": null,
    "hasOlder": true,
    "hasNewer": false
  },
  "sync": {
    "earliestMirroredAt": "2026-04-15T00:00:00.000Z",
    "latestMirroredAt": "2026-04-22T12:00:00.000Z",
    "olderHistoryPossible": true,
    "backfillState": "idle"
  }
}
```

---

## 9.3 Older-history backfill

### Route
`POST /conversations/:conversationId/backfill`

### Request shape
```json
{
  "direction": "older",
  "until": "2026-03-01T00:00:00.000Z",
  "pageSizeDays": 7,
  "idempotencyKey": "optional-key"
}
```

### Behavior
- queue or start older-history fetch
- persist fetched messages before they become queryable
- return sync-state response

### Response shape
```json
{
  "conversationId": "conv_1",
  "status": "queued",
  "backfillState": "queued",
  "earliestMirroredAt": "2026-04-01T00:00:00.000Z",
  "olderHistoryPossible": true
}
```

---

## 9.4 Sync status

### Route
`GET /conversations/:conversationId/sync-status`

### Response shape
```json
{
  "conversationId": "conv_1",
  "recentWindow": {
    "days": 7,
    "status": "ready",
    "startAt": "2026-04-15T00:00:00.000Z",
    "endAt": "2026-04-22T00:00:00.000Z"
  },
  "coverage": {
    "earliestMirroredAt": "2026-04-01T00:00:00.000Z",
    "latestMirroredAt": "2026-04-22T12:00:00.000Z",
    "olderHistoryPossible": true
  },
  "backfill": {
    "state": "idle",
    "lastRequestedAt": null,
    "lastCompletedAt": null,
    "lastErrorCode": null
  }
}
```

---

## 9.5 Optional bootstrap endpoint

### Route
`GET /connections/:connectionId/inbox/bootstrap?windowDays=7`

### Purpose
Return a UI-friendly initial payload containing:
- connection status
- first page of inbox chats
- optional first/open conversation timeline
- stream resume cursor seed

This is optional but recommended for frontend simplicity.

---

## 10. Realtime event contract

Use SSE first.

### Route
`GET /events/stream?afterIngestSeq=...`

### UI-grade event types to emit
- `conversation.updated`
- `conversation.reordered`
- `message.upserted`
- `message.updated`
- `message.deleted`
- `receipt.updated`
- `conversation.sync.updated`
- `backfill.started`
- `backfill.completed`
- `backfill.failed`

### Event rules
- every event must correspond to canonical state already persisted
- replay/resume ordering is by `ingest_seq`
- consumers should be able to resume after disconnect without losing ordering guarantees

---

## 11. Backfill state machine

## 11.1 Recent-window bootstrap

Track via:
- `conversations.recent_window_status`
- `conversation_sync_state.bootstrap_state`

### States
- `not_started`
- `queued`
- `running`
- `partial`
- `ready`
- `failed`

### Meanings
- `not_started` => no recent-window work attempted
- `queued` => recent-window bootstrap scheduled
- `running` => active provider bootstrap/import work
- `partial` => some recent messages exist, but completeness not guaranteed
- `ready` => recent-window considered complete
- `failed` => latest attempt failed

---

## 11.2 Older-history backfill

Track via `conversation_sync_state.backfill_state`.

### States
- `idle`
- `queued`
- `running`
- `paused`
- `exhausted`
- `failed`

### Meanings
- `idle` => no active older-history fetch
- `queued` => request accepted
- `running` => active paging backward
- `paused` => intentionally suspended
- `exhausted` => no older history remains
- `failed` => latest attempt failed

---

## 11.3 Transition rules

### Bootstrap transitions
- `not_started -> queued`
- `queued -> running`
- `running -> partial`
- `partial -> ready`
- `running -> failed`
- `partial -> failed`

### Backfill transitions
- `idle -> queued`
- `queued -> running`
- `running -> idle` when request completed but more history may remain
- `running -> exhausted` when provider indicates no older history
- `running -> failed`
- `failed -> queued` on retry

---

## 11.4 Backfill algorithm

For `POST /conversations/:conversationId/backfill`:

1. load `conversation_sync_state`
2. if `backfill_state` is `queued` or `running`, return current state idempotently
3. choose anchor from:
   - current `earliest_mirrored_provider_sent_at`
   - or `last_backfill_anchor_cursor`
4. request provider history page backward
5. persist messages/attachments/participants
6. update earliest mirrored timestamp
7. if provider indicates no older messages:
   - set `older_history_possible = false`
   - set `backfill_state = exhausted`
8. otherwise:
   - keep `older_history_possible = true`
   - set `backfill_state = idle` unless continuing immediately

---

## 12. Recent-window mirror strategy

To support a WhatsApp-like interface, the platform must maintain a lightweight recent mirror for all discovered chats.

### Important distinction
This is **not** the same as deep history import.

### Lightweight recent mirror for all chats
Includes:
- conversation shell
- enough recent messages to render inbox and recent open-chat view
- recent-window completeness state

### Deep canonical mirror for selected chats
Includes:
- broader historical import
- richer long-term export/search/cluster guarantees

This preserves compatibility with the project’s manual-selection model while enabling the inbox SLA.

---

## 13. Query semantics

### Inbox queries
Must read from:
- `conversations`
- joined `conversation_sync_state`

Must **not** scan message history to compute latest chat ordering on every request.

### Timeline queries
Must read from:
- `messages`
- joined attachments/receipts as needed

Must use cursor pagination.

### Provider fetches in hot path
Normal inbox/timeline requests should not directly fetch from provider.

Instead:
- provider fetch writes canonical state first
- API then reads canonical state

This is a key system rule.

---

## 14. Relationship to conversation selection and clusters

### Rule
A conversation may appear in the inbox even if not selected for deep historical mirroring.

### Selection semantics remain
Selection still governs:
- deeper historical import guarantees
- stronger canonical long-term sync intent
- downstream export/search/cluster expectations if the product wants that constraint

### Cluster semantics
Clusters continue to attach to canonical `conversation_id`.
No cluster redesign is needed.

---

## 15. Repo-specific ownership map

## 15.1 `packages/storage`

### Add / change
- new migration for `conversations` summary fields
- new migration for `conversation_sync_state`
- optional migration for new `messages` fields
- repository additions:
  - extend `conversation-repository.ts`
  - add `conversation-sync-state-repository.ts`
  - extend `message-repository.ts`
  - export new repository from `packages/storage/src/index.ts`

### Responsibilities
- inbox chat list query primitives
- timeline cursor query primitives
- conversation sync state reads/writes
- latest-message repair queries

---

## 15.2 `packages/mirror-engine`

### Add / change
- update live provider ingestion to maintain conversation summary fields
- update latest-message projection on inbound messages
- update receipt/update/delete handling so projection stays correct

### Responsibilities
- canonical writes first
- projection maintenance on live event ingest
- normalized event emission for UI-grade stream consumers

---

## 15.3 `packages/history-import`

### Add / change
- split conceptual responsibility into:
  - recent-window bootstrap completion
  - older-history backfill
- support backfill state transitions against `conversation_sync_state`

### Responsibilities
- week-by-week backward paging
- idempotent backfill
- coverage tracking updates
- backfill events

---

## 15.4 `packages/query-api`

### Add / change
- add inbox query service
- add timeline query service
- add backfill orchestration service
- evolve conversation discovery so it remains shell discovery, not the primary UI inbox route

### Responsibilities
- tenant-scoped orchestration
- typed errors
- route-facing service interfaces for inbox/timeline/backfill/sync-status

---

## 15.5 `packages/event-stream-api`

### Add / change
- emit UI-grade events listed in section 10
- support resume from `ingest_seq`

### Responsibilities
- real-time delivery from canonical persisted state
- no event before persistence

---

## 15.6 `apps/api`

### Add / change
- new routes:
  - `GET /connections/:connectionId/inbox/chats`
  - `GET /conversations/:conversationId/timeline`
  - `POST /conversations/:conversationId/backfill`
  - `GET /conversations/:conversationId/sync-status`
  - optional `GET /connections/:connectionId/inbox/bootstrap`
- SSE route enhancements if needed

### Responsibilities
- HTTP shape only
- no provider-direct serving path for inbox/timeline

---

## 15.7 `apps/demo`

### Add / change later
- inbox list instead of raw conversation dump
- open conversation timeline pane
- backfill older messages button
- live stream updates

### Note
Demo updates should follow after API contracts exist.

---

## 16. Test plan

Implementation must follow red-green TDD.

## 16.1 Storage tests first

Add failing tests for:
- conversation summary field persistence
- conversation sync state CRUD + transitions
- inbox ordering query
- timeline cursor query
- latest-message recomputation query

Suggested test files:
- `tests/storage/conversation-inbox-projection.spec.ts`
- `tests/storage/conversation-sync-state-repository.spec.ts`
- `tests/storage/message-timeline-query.spec.ts`

---

## 16.2 Mirror engine tests

Add failing tests for:
- inbound message updates latest chat projection
- outbound message updates latest chat projection
- latest message delete/redact repairs projection
- receipts do not reorder inbox incorrectly

Suggested test file:
- `tests/mirror-engine/conversation-projection.spec.ts`

---

## 16.3 History/backfill tests

Add failing tests for:
- backfill request transitions sync state correctly
- repeated backfill is idempotent
- coverage metadata updates correctly
- older-history exhaustion is recorded

Suggested test file:
- `tests/history-import/conversation-backfill.spec.ts`

---

## 16.4 API tests

Add failing tests for:
- inbox chats route ordering and filtering
- timeline route pagination
- sync-status route
- backfill route idempotency
- realtime stream emits UI-grade events in canonical order

Suggested test files:
- `tests/apps/inbox-api.spec.ts`
- `tests/apps/timeline-api.spec.ts`
- `tests/apps/backfill-api.spec.ts`
- `tests/apps/realtime-inbox-stream.spec.ts`

---

## 16.5 Acceptance tests

Add end-to-end acceptance coverage for:
1. connect and bootstrap recent inbox
2. inbox ordered by latest message desc
3. send message reorders inbox immediately
4. inbound message reorders inbox immediately
5. opening chat returns stable timeline ordering
6. requesting backfill expands timeline without duplicates
7. restart preserves inbox/timeline state
8. realtime stream resumes from ingest sequence correctly

---

## 17. Recommended implementation sequence

## Step 1 — Schema and repository foundation
- add migrations
- extend repositories
- add sync-state repository
- add indexes

## Step 2 — Latest-message projection maintenance
- update mirror engine
- update send pipeline
- maintain conversation latest fields on every message write

## Step 3 — Query services
- add inbox query service
- add timeline query service
- add sync-status service

## Step 4 — Backfill orchestration
- add conversation backfill service/state machine
- persist coverage state

## Step 5 — HTTP routes
- add inbox/timeline/backfill/sync-status endpoints

## Step 6 — Realtime stream enhancements
- emit UI-grade events with resume support

## Step 7 — Demo harness updates
- replace raw dump UX with inbox/timeline UX

This order keeps the serving layer DB-backed from the start.

---

## 18. Explicit non-goals for the first inbox/timeline implementation

Do not block delivery on:
- exact unread count parity
- pinned chats
- archived chats
- mute status parity
- disappearing-message semantics parity
- reaction/edit parity beyond basic passthrough if already available
- stories/status/communities
- semantic search or media gallery UX

The first objective is:
- correct inbox ordering
- correct timeline rendering
- correct realtime behavior
- correct historical expansion

---

## 19. Operational rules

1. All inbox/timeline reads must be tenant-scoped.
2. All realtime events must be persisted before delivery.
3. Provider history fetch must never directly power a hot UI response without canonical persistence first.
4. Timeline ordering contract is always:
   - `provider_sent_at asc`
   - `ingest_seq asc`
5. Inbox ordering contract is always:
   - `last_provider_message_at desc`
   - `last_message_ingest_seq desc`
6. Backfill requests must be idempotent.
7. Duplicate provider events must not create duplicate messages or duplicate inbox reorder effects.
8. Restarting workers/processes must preserve inbox/timeline state from DB.

---

## 20. Definition of done for this plan

This plan is considered implemented when all of the following are true:

1. API consumer can list chats ordered like a WhatsApp inbox from the DB.
2. API consumer can open a conversation timeline from the DB with cursor pagination.
3. New inbound and outbound messages update both timeline and inbox ordering in real time.
4. Older messages can be fetched on demand and then read from the same canonical timeline API.
5. Inbox/timeline state survives restarts.
6. Stream consumers can resume from durable `ingest_seq` without losing ordering.
7. Tests cover storage, service, API, and acceptance behavior for the above flows.

---

## 21. Working rule for future implementation sessions

While implementing this inbox/timeline architecture:

- treat this file as the working technical reference
- keep `AGENTS.md` as the broader product/phase authority
- if implementation decisions materially diverge from this plan, update this file first before changing code

This file should stay current as implementation proceeds.
