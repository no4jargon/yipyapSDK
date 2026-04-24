# AGENTS.md

## Purpose
This file is the authoritative implementation spec for the coding agent. It defines product scope, sequencing, constraints, and completion criteria.

## Mission

Build v1 of a backend-first developer platform that turns selected WhatsApp conversations into structured, synced, queryable conversation streams inside another application.

This is **not** a project-management app. This is **not** a WhatsApp clone. This is **not** a generic comms SDK.

This platform exists so app developers can:

- connect a user's WhatsApp through a linked-device flow
- discover WhatsApp conversations
- let the user manually select conversations to mirror
- import message history week-by-week into the past
- keep selected conversations synced in real time
- send and receive messages, including attachments
- download attachments on demand
- search mirrored content
- group conversations into manual clusters
- read a unified timeline across a cluster
- attach arbitrary app-defined metadata to messages, conversations, participants, attachments, and clusters
- consume both raw provider events and normalized events
- export ordered streams to power AI, workflow, summarization, dashboards, and automations in the host app
- use helper APIs for participant candidate matching and manual merges without any built-in identity intelligence
- perform deletion and redaction through SDK/platform primitives

The host app owns:

- permissioning and roles
- UI/UX
- workflow semantics
- project/task/business logic
- entity taxonomy semantics
- AI behavior
- summarization logic
- dashboards
- automations

## Build style

Build the system sequentially using strict red-green TDD. Every module must be implemented only after failing tests are written. Do not skip tests. Do not create placeholder code without tests. Do not change the product scope unless the spec explicitly says to. Do not add speculative features.

Implementation hygiene rules:

- Do not replace existing project configuration with generic defaults unless the spec or tests require it.
- Do not create new files, interfaces, or abstractions unless they are necessary for the current phase or failing tests.
- Produce only the minimum code needed to make the current failing tests pass.
- Let errors bubble up with clear typed context; do not mask useful failures behind vague catch-all handling.

Agent-legible codebase rules:

- Prefer modularization with clear boundaries so work in one area does not corrupt another.
- Prefer known, repeated patterns and conventions over one-off cleverness.
- Keep the core simple and push complexity to higher layers where possible.
- Avoid hidden magic; if behavior is important, make it visible in code the agent can read and follow.

Mechanical enforcement rules:

- No bare catch-all error handling.
- No raw SQL outside the storage/repository abstraction layer.
- No raw input boxes in UI code; use the shared component layer when UI work exists.
- No dynamic imports unless explicitly required by the spec.
- Keep function names unique within a module/package area where practical to favor discovery over accidental duplication.
- Prefer TypeScript configuration and syntax choices that keep the codebase erasable-syntax-only where feasible.

## Non-goals for v1

Do not implement:

- automated clusters
- workflow/task creation semantics
- app-level permissions model
- frontend UI beyond minimal API smoke-test harnesses and developer test fixtures
- OCR, transcription, or semantic search
- disappearing messages support beyond pass-through metadata if provider emits it
- calls, voice/video call state, status/stories, communities, polls, location-sharing UI, stickers authoring, or contact card enrichment beyond generic attachment/message support
- identity inference or ML-based matching
- browser automation approach; use linked-device adapter approach only
- stealth, ban-evasion, spoofing, or mass messaging features

## Canonical product decisions

1. The platform persists the canonical mirror store.
2. The host app consumes mirrored state through query APIs, event streams, and export APIs.
3. Conversation selection is manual in v1.
4. Clusters are manual in v1.
5. A conversation may belong to multiple clusters.
6. Groups and 1:1 conversations are equally important.
7. Attachments are first-class objects.
8. Historical import is week-by-week into the past.
9. Attachment fetch is on demand by default.
10. Search covers message text and attachment names only in v1.
11. Metadata is backend-first and arbitrary JSON, within configured limits.
12. Expose both raw provider events and normalized events.
13. Expose helper candidate-matching and merge endpoints, but no intelligence.
14. Expose deletion/redaction primitives in the SDK/platform.
15. The WhatsApp adapter is hidden behind a stable internal interface.
16. The public product is a developer platform with SDKs, not a thin library.

---

# 1. System architecture

## 1.1 High-level layers

Build these layers in order:

1. `core-types`
2. `storage`
3. `event-log`
4. `mirror-engine`
5. `provider-adapter-interface`
6. `provider-whatsapp-linked`
7. `sync-orchestrator`
8. `history-import`
9. `attachment-service`
10. `search-index`
11. `cluster-service`
12. `metadata-service`
13. `participant-matching-service`
14. `deletion-redaction-service`
15. `query-api`
16. `event-stream-api`
17. `export-api`
18. `sdk-node`
19. `sdk-server-http`
20. `end-to-end acceptance suite`

## 1.2 Runtime components

Build these runtime components:

- API server
- background worker
- provider connection worker
- import worker
- attachment worker
- search indexing worker
- event-stream publisher

Keep them in one deployable service for v1 if needed, but modularize the code so they can be split later.

## 1.3 Persistence

Use PostgreSQL as the canonical system of record. Use object storage for attachment blobs. Use Redis only if needed for job queues or ephemeral coordination, not as canonical state.

Canonical state must live in PostgreSQL tables.

## 1.4 Package layout

Use a monorepo with this shape:

```text
repo/
  apps/
    api/
    worker/
    provider-worker/
  packages/
    core-types/
    test-kit/
    storage/
    event-log/
    mirror-engine/
    provider-adapter-interface/
    provider-whatsapp-linked/
    sync-orchestrator/
    history-import/
    attachment-service/
    search-index/
    cluster-service/
    metadata-service/
    participant-matching-service/
    deletion-redaction-service/
    query-api/
    event-stream-api/
    export-api/
    sdk-node/
    sdk-server-http/
  infra/
    migrations/
    docker/
  tests/
    acceptance/
```

---

# 2. Core domain model

Every object must have:

- stable `id` generated by platform
- `created_at`
- `updated_at`
- `tenant_id`

Use UTC timestamps everywhere. Preserve provider timestamps separately.

## 2.1 Connection

Represents one linked WhatsApp connection for one host-app user.

Fields:

- `id`
- `tenant_id`
- `workspace_user_ref` string
- `provider` enum: `whatsapp_linked`
- `status` enum:
  - `pending`
  - `qr_ready`
  - `connecting`
  - `connected`
  - `degraded`
  - `reconnecting`
  - `disconnected`
  - `reauth_required`
  - `failed`
- `status_reason` nullable enum:
  - `none`
  - `network_loss`
  - `logged_out`
  - `auth_invalid`
  - `provider_reject`
  - `protocol_change_suspected`
  - `manual_disconnect`
  - `unknown`
- `provider_account_ref` nullable string
- `device_label` nullable string
- `last_connected_at` nullable timestamp
- `last_heartbeat_at` nullable timestamp
- `reauth_required_at` nullable timestamp
- `disconnected_at` nullable timestamp

## 2.2 Conversation

One WhatsApp thread, either 1:1 or group.

Fields:

- `id`
- `tenant_id`
- `connection_id`
- `provider_conversation_id` string unique within connection
- `conversation_type` enum:
  - `direct`
  - `group`
  - `broadcast`
  - `unknown`
- `title` string
- `normalized_title` string
- `avatar_ref` nullable string
- `is_selected` boolean
- `selection_state_changed_at` nullable timestamp
- `last_provider_message_at` nullable timestamp
- `last_mirrored_message_at` nullable timestamp
- `participant_count` integer nullable
- `provider_metadata` jsonb

## 2.3 Conversation membership snapshot

Represents a participant known to belong to a conversation at a given version.

Fields:

- `id`
- `tenant_id`
- `conversation_id`
- `participant_id`
- `membership_state` enum:
  - `active`
  - `left`
  - `removed`
  - `unknown`
- `observed_at`
- `provider_metadata` jsonb

## 2.4 Participant

A person inside WhatsApp.

Fields:

- `id`
- `tenant_id`
- `connection_id`
- `provider_participant_id` string unique within connection
- `phone_e164` nullable string
- `display_name` nullable string
- `profile_name` nullable string
- `wa_business_name` nullable string
- `is_self` boolean
- `provider_metadata` jsonb

## 2.5 Entity mapping

Maps a participant to a host-app entity.

Fields:

- `id`
- `tenant_id`
- `participant_id`
- `entity_type` string
- `entity_ref` string
- `label` nullable string
- `mapping_status` enum:
  - `active`
  - `merged`
  - `deleted`
- `merged_into_mapping_id` nullable id
- `notes` nullable text

## 2.6 Message

Normalized mirrored message.

Fields:

- `id`
- `tenant_id`
- `connection_id`
- `conversation_id`
- `provider_message_id` string unique within conversation where possible
- `sender_participant_id` nullable id
- `message_type` enum:
  - `text`
  - `image`
  - `video`
  - `audio`
  - `document`
  - `sticker`
  - `reaction`
  - `system`
  - `unknown`
- `direction` enum:
  - `inbound`
  - `outbound`
  - `system`
- `text_body` nullable text
- `normalized_text_body` nullable text
- `quoted_message_id` nullable id
- `reply_to_provider_message_id` nullable string
- `provider_sent_at` timestamp
- `mirrored_at` timestamp
- `ingest_seq` bigint unique, globally ordered
- `message_status` enum:
  - `pending`
  - `sent`
  - `server_ack`
  - `delivered`
  - `read`
  - `failed`
  - `deleted`
  - `redacted`
- `has_attachments` boolean
- `provider_metadata` jsonb
- `raw_payload_ref` nullable string

## 2.7 Attachment

First-class attachment object.

Fields:

- `id`
- `tenant_id`
- `message_id`
- `provider_attachment_id` nullable string
- `attachment_type` enum:
  - `image`
  - `video`
  - `audio`
  - `document`
  - `sticker`
  - `unknown`
- `file_name` nullable string
- `mime_type` nullable string
- `byte_size` nullable bigint
- `checksum_sha256` nullable string
- `storage_key` nullable string
- `download_state` enum:
  - `not_requested`
  - `pending`
  - `available`
  - `failed`
  - `deleted`
  - `redacted`
- `provider_url_ref` nullable string
- `preview_ref` nullable string
- `download_requested_at` nullable timestamp
- `download_completed_at` nullable timestamp
- `provider_metadata` jsonb

## 2.8 Receipt

Message delivery/read receipt.

Fields:

- `id`
- `tenant_id`
- `message_id`
- `receipt_type` enum:
  - `server_ack`
  - `delivered`
  - `read`
- `participant_id` nullable id
- `provider_at` timestamp
- `observed_at` timestamp

## 2.9 Cluster

Named set of conversations.

Fields:

- `id`
- `tenant_id`
- `name` string
- `description` nullable text
- `cluster_type` enum: `manual`
- `archived` boolean

## 2.10 Cluster conversation membership

Fields:

- `id`
- `tenant_id`
- `cluster_id`
- `conversation_id`
- `added_at`
- unique `(cluster_id, conversation_id)`

## 2.11 Metadata record

Arbitrary app-defined metadata.

Fields:

- `id`
- `tenant_id`
- `target_type` enum:
  - `message`
  - `conversation`
  - `participant`
  - `attachment`
  - `cluster`
- `target_id`
- `namespace` string
- `key` string
- `value_json` jsonb
- `version` integer
- `deleted` boolean
- unique `(tenant_id, target_type, target_id, namespace, key, version)`

## 2.12 Deletion/redaction record

Fields:

- `id`
- `tenant_id`
- `target_type` enum:
  - `message`
  - `attachment`
  - `conversation`
  - `participant`
  - `cluster`
- `target_id`
- `operation_type` enum:
  - `soft_delete`
  - `hard_delete`
  - `redact`
- `reason` nullable string
- `requested_by_ref` nullable string
- `requested_at`
- `completed_at` nullable timestamp
- `status` enum:
  - `pending`
  - `completed`
  - `failed`

## 2.13 Event log

Canonical append-only event log.

Fields:

- `id`
- `tenant_id`
- `event_type` string
- `event_family` enum:
  - `provider_raw`
  - `normalized`
  - `system`
- `connection_id` nullable id
- `conversation_id` nullable id
- `message_id` nullable id
- `cluster_id` nullable id
- `ingest_seq` bigint unique
- `occurred_at` timestamp
- `payload_json` jsonb
- `dedupe_key` nullable string unique where applicable

## 2.14 Export cursor

Fields:

- `id`
- `tenant_id`
- `cursor_name` string
- `last_ingest_seq`
- unique `(tenant_id, cursor_name)`

---

# 3. Public API surface

All public APIs are server-side/backend-first. Do not build browser-only privileged SDK calls.

## 3.1 Connection APIs

Required methods:

- `createConnection(workspaceUserRef)`
- `getConnection(connectionId)`
- `getConnectionStatus(connectionId)`
- `getConnectionQr(connectionId)`
- `disconnectConnection(connectionId)`
- `reconnectConnection(connectionId)`
- `listConnections(workspaceUserRef?)`

Acceptance criteria:

- QR is available only in valid states
- status transitions are persisted and emitted as events
- disconnect marks connection accordingly and tears down provider session

## 3.2 Conversation APIs

Required methods:

- `listDiscoveredConversations(connectionId, filters, pagination)`
- `getConversation(conversationId)`
- `selectConversation(conversationId)`
- `deselectConversation(conversationId)`
- `bulkSelectConversations(connectionId, conversationIds[])`
- `bulkDeselectConversations(connectionId, conversationIds[])`
- `getConversationParticipants(conversationId)`

Selection must trigger history import scheduling. Deselection must stop future sync but must not hard-delete historical mirrored data by default.

## 3.3 Message APIs

Required methods:

- `listMessages(conversationId, pagination, filters)`
- `getMessage(messageId)`
- `sendTextMessage(conversationId, text, clientMessageId?)`
- `sendAttachmentMessage(conversationId, attachmentUploadRef, caption?, clientMessageId?)`
- `getReceipts(messageId)`

## 3.4 Attachment APIs

Required methods:

- `listAttachments(conversationId?, clusterId?, filters, pagination)`
- `requestAttachmentDownload(attachmentId)`
- `getAttachment(attachmentId)`
- `getAttachmentDownloadUrl(attachmentId)`

Rules:

- attachments default to `not_requested`
- requesting download enqueues job
- repeated request is idempotent
- URL only returned when `download_state = available`

## 3.5 Cluster APIs

Required methods:

- `createCluster(name, description?)`
- `getCluster(clusterId)`
- `listClusters(filters, pagination)`
- `updateCluster(clusterId, patch)`
- `archiveCluster(clusterId)`
- `addConversationToCluster(clusterId, conversationId)`
- `removeConversationFromCluster(clusterId, conversationId)`
- `listClusterConversations(clusterId, pagination)`
- `getClusterTimeline(clusterId, pagination, filters)`

## 3.6 Search APIs

Required methods:

- `searchMessages(query, scope, filters, pagination)`
- `searchAttachmentsByName(query, scope, filters, pagination)`

Supported scopes:

- tenant
- connection
- conversation
- cluster

v1 search fields only:

- message text
- attachment file name
- metadata exact-match filters if feasible via JSONB operators

## 3.7 Metadata APIs

Required methods:

- `setMetadata(targetType, targetId, namespace, key, valueJson)`
- `getMetadata(targetType, targetId, namespace?, key?)`
- `deleteMetadata(targetType, targetId, namespace, key)`
- `listMetadata(targetType, targetId, pagination)`

Rules:

- metadata is versioned
- delete is logical delete
- enforce per-record size limits

## 3.8 Participant and mapping APIs

Required methods:

- `listParticipants(connectionId, filters, pagination)`
- `getParticipant(participantId)`
- `createEntityMapping(participantId, entityType, entityRef, label?)`
- `listEntityMappings(filters, pagination)`
- `deleteEntityMapping(mappingId)`
- `listCandidateMatches(participantId, candidateSet)`
- `mergeParticipantMappings(sourceMappingId, targetMappingId)`

Rules:

- candidate matching is deterministic helper logic only
- no model-based suggestions
- expose simple score inputs if implemented, but no intelligence claims

## 3.9 Export APIs

Required methods:

- `exportEvents(cursorName, afterIngestSeq?, limit)`
- `exportMessages(scope, afterIngestSeq?, limit)`
- `getOrCreateCursor(cursorName)`
- `advanceCursor(cursorName, lastIngestSeq)`

Rules:

- ordering must be by global `ingest_seq`
- exports must be idempotent and resumable

## 3.10 Deletion and redaction APIs

Required methods:

- `softDeleteMessage(messageId, reason?)`
- `redactMessage(messageId, reason?)`
- `hardDeleteMessage(messageId, reason?)`
- `softDeleteAttachment(attachmentId, reason?)`
- `redactAttachment(attachmentId, reason?)`
- `hardDeleteAttachment(attachmentId, reason?)`
- `getDeletionRecord(recordId)`
- `listDeletionRecords(filters, pagination)`

Rules:

- soft delete keeps auditability
- redact preserves object but removes sensitive content fields
- hard delete removes object content and storage linkage, while preserving required audit record

## 3.11 Event stream APIs

Required methods:

- webhook subscription registration
- webhook delivery retries
- server-sent events or websocket stream for normalized events
- stream raw provider events separately from normalized events

Event ordering contract:

- best effort real-time delivery
- canonical replay order via `ingest_seq`

---

# 4. Internal adapter boundary

The WhatsApp provider adapter must be fully hidden behind an internal interface. No public API may expose adapter-specific types.

## 4.1 Required internal adapter interface

```ts
interface ProviderAdapter {
  createSession(input: { connectionId: string }): Promise<void>
  getConnectionBootstrapState(connectionId: string): Promise<{
    status: 'pending' | 'qr_ready' | 'connecting' | 'connected' | 'reauth_required' | 'failed'
    qrPayload?: string
  }>
  connect(connectionId: string): Promise<void>
  disconnect(connectionId: string): Promise<void>
  listDiscoveredConversations(connectionId: string): Promise<ProviderConversation[]>
  subscribe(connectionId: string, onEvent: (event: ProviderRawEvent) => Promise<void>): Promise<() => Promise<void>>
  requestHistoryPage(input: {
    connectionId: string
    providerConversationId: string
    pageDirection: 'backward'
    anchor?: ProviderHistoryAnchor
    pageSizeDays: 7
  }): Promise<ProviderHistoryPage>
  sendTextMessage(input: {
    connectionId: string
    providerConversationId: string
    text: string
    clientMessageId?: string
  }): Promise<ProviderSendResult>
  sendAttachmentMessage(input: {
    connectionId: string
    providerConversationId: string
    attachmentSource: ProviderAttachmentSource
    caption?: string
    clientMessageId?: string
  }): Promise<ProviderSendResult>
  fetchAttachment(input: {
    connectionId: string
    providerAttachmentRef: string
  }): Promise<ProviderAttachmentFetchResult>
}
```

The WhatsApp adapter implementation may use Baileys-style mechanics internally, but code outside the adapter must not depend on any Baileys types.

---

# 5. Event model

There are two public event families:

- raw provider events
- normalized platform events

## 5.1 Required normalized events

Emit these event types at minimum:

- `connection.created`
- `connection.qr_ready`
- `connection.connecting`
- `connection.connected`
- `connection.degraded`
- `connection.reconnecting`
- `connection.disconnected`
- `connection.reauth_required`
- `conversation.discovered`
- `conversation.updated`
- `conversation.selected`
- `conversation.deselected`
- `conversation.membership.updated`
- `participant.discovered`
- `participant.updated`
- `mapping.created`
- `mapping.deleted`
- `mapping.merged`
- `message.mirrored`
- `message.updated`
- `message.sent`
- `message.failed`
- `receipt.observed`
- `attachment.discovered`
- `attachment.download.requested`
- `attachment.download.completed`
- `attachment.download.failed`
- `cluster.created`
- `cluster.updated`
- `cluster.archived`
- `cluster.conversation.added`
- `cluster.conversation.removed`
- `metadata.set`
- `metadata.deleted`
- `deletion.requested`
- `deletion.completed`
- `redaction.completed`
- `history_import.started`
- `history_import.page_completed`
- `history_import.completed`
- `search.indexed`

## 5.2 Event rules

- every normalized event must be persisted before external delivery
- every event must carry `ingest_seq`
- all public replay/export semantics rely on `ingest_seq`
- dedupe incoming provider events where reasonable
- event handlers must be idempotent

---

# 6. History import semantics

## 6.1 General rules

- import is triggered when a conversation becomes selected
- import runs week-by-week backward into history
- default page size is exactly 7 days of provider time window where supported
- import continues until provider history is exhausted or job is explicitly stopped
- import is resumable and idempotent

## 6.2 State tracking

Track per conversation import state:

- `not_started`
- `running`
- `paused`
- `completed`
- `failed`

Track per conversation import anchor/cursor.

## 6.3 Acceptance requirements

- selecting a conversation schedules import exactly once
- restarting workers does not duplicate imported messages
- messages are ordered in export/query by `provider_sent_at`, with deterministic tiebreak by `ingest_seq`
- import progress is queryable

---

# 7. Search semantics

Implement pragmatic v1 search only.

## 7.1 Searchable fields

- `message.normalized_text_body`
- `attachment.file_name`

## 7.2 Search modes

Support:

- substring / ILIKE or PostgreSQL full text search for message text
- substring / ILIKE for attachment file names
- filters by:
  - connection
  - conversation
  - cluster
  - date range
  - participant
  - message type

## 7.3 Non-goals

Do not implement:

- OCR
- transcript indexing
- semantic vector search
- embedding pipelines

---

# 8. Metadata semantics

Metadata is arbitrary app-defined JSON. The platform does not interpret it.

## 8.1 Constraints

- target object must exist
- max metadata payload size configurable, default 32 KB
- metadata writes are versioned
- metadata delete creates a new tombstone version

## 8.2 Queryability

Support exact namespace/key lookup in v1. JSON deep querying beyond basic filters is optional.

---

# 9. Deletion and redaction semantics

Deletion and redaction must be explicit and auditable.

## 9.1 Soft delete

- object remains in storage
- object excluded from normal list/search responses unless requested with admin/debug flag
- audit trail preserved

## 9.2 Redaction

- sensitive content fields are blanked or replaced with redaction token
- object shell remains
- relations remain valid
- search index removed/updated accordingly

For messages, redact:

- `text_body`
- `normalized_text_body`
- sensitive provider payload fields

For attachments, redact:

- file name if requested
- storage key
- download URL
- preview refs

## 9.3 Hard delete

- object content is removed irreversibly where possible
- attachment blobs deleted from object storage
- audit record remains
- references degrade gracefully in query APIs

---

# 10. Testing strategy

Use strict red-green TDD for every module. No implementation without a failing test first.

## 10.1 Test layers

Build tests in this order:

1. pure unit tests for core types and invariants
2. storage repository tests against real PostgreSQL test DB
3. event log and idempotency tests
4. service-level tests with fake provider adapter
5. contract tests for internal provider adapter interface
6. API tests
7. end-to-end acceptance tests using deterministic fake adapter
8. optional live adapter smoke tests behind an explicit flag

## 10.2 Fake adapter

Before real WhatsApp adapter work, build a deterministic fake provider adapter that can:

- create fake connections
- expose fake conversations
- emit raw events
- paginate fake history pages
- send fake messages
- expose fake attachments

This fake adapter is mandatory and must drive most acceptance tests.

## 10.3 Mandatory acceptance scenarios

The following scenarios must pass before v1 is considered complete:

1. Create connection and reach `qr_ready`
2. Connection moves to `connected`
3. Conversations are discovered and listed
4. Selecting one conversation triggers week-by-week import
5. Imported messages are queryable and exported in stable order
6. Group conversation participants are queryable
7. Sending a text message results in mirrored sent message and receipt updates
8. Sending an attachment message results in mirrored attachment metadata
9. Requesting attachment download makes blob available
10. Search returns message text matches
11. Search returns attachment name matches
12. Creating a cluster and adding conversations works
13. Cluster timeline returns merged ordered timeline across included conversations
14. A conversation can belong to multiple clusters
15. Metadata can be set, read, versioned, and deleted on message/conversation/cluster
16. Candidate matching endpoint returns deterministic helper output
17. Merging mappings updates source/target correctly
18. Soft delete message excludes it from default list responses
19. Redact message removes content but preserves shell and auditability
20. Hard delete attachment removes storage linkage and preserves audit record
21. Raw provider events are replayable
22. Normalized events are replayable
23. Export cursors support resumable incremental consumption
24. Worker restart does not duplicate messages or attachments
25. Deselecting a conversation stops future mirroring but preserves historical mirrored data

---

# 11. Sequential build plan

The coding agent must implement modules sequentially in the exact order below. Do not jump ahead. Do not implement the real WhatsApp adapter until the fake adapter-based acceptance path is solid.

## Phase 1: repository and test harness

Deliver:

- monorepo skeleton
- TypeScript project references or equivalent
- linting, formatting, test runner
- PostgreSQL test harness
- fake object storage harness
- CI script

Definition of done:

- empty smoke tests pass
- failing placeholder tests for next phase exist

## Phase 2: core domain and storage

Deliver:

- core type definitions
- validation helpers
- SQL migrations for all canonical tables
- repository layer for each aggregate

Definition of done:

- all repository tests pass against real PostgreSQL
- invariants enforced by tests and DB constraints

## Phase 3: canonical event log

Deliver:

- append-only event log writer
- ingest sequence allocator
- event query/replay repository
- dedupe support

Definition of done:

- event ordering, persistence, replay, and dedupe tests pass

## Phase 4: fake provider adapter and internal adapter contract

Deliver:

- provider adapter interface
- deterministic fake provider adapter
- contract tests shared across adapters

Definition of done:

- fake adapter passes all contract tests

## Phase 5: connection lifecycle service

Deliver:

- create connection
- QR state handling
- connection status transitions
- teardown/reconnect logic against fake adapter

Definition of done:

- connection acceptance tests pass with fake adapter

## Phase 6: conversation discovery and selection

Deliver:

- discovery ingestion
- conversation storage
- participant discovery
- selection/deselection APIs

Definition of done:

- discovered conversations and participant tests pass
- selection schedules import jobs

## Phase 7: mirror engine and normalized message ingestion

Deliver:

- raw provider event persistence
- normalization pipeline
- message/receipt/attachment metadata ingestion
- idempotent upserts

Definition of done:

- mirrored message tests pass
- duplicate raw event tests pass

## Phase 8: history import engine

Deliver:

- week-by-week import coordinator
- import progress state
- resumable anchors
- import events

Definition of done:

- import acceptance scenarios pass
- worker restart idempotency passes

## Phase 9: send pipeline

Deliver:

- send text
- send attachment
- map outbound results back into canonical store
- message status updates

Definition of done:

- outbound text and attachment acceptance tests pass

## Phase 10: attachment service

Deliver:

- attachment download request API
- background downloader
- object storage persistence
- signed URL retrieval

Definition of done:

- on-demand download tests pass
- repeated requests are idempotent

## Phase 11: clusters and cluster timeline

Deliver:

- manual clusters CRUD
- cluster membership management
- unified cluster timeline query

Definition of done:

- cluster acceptance tests pass

## Phase 12: metadata service

Deliver:

- set/get/list/delete metadata
- versioning
- size constraints

Definition of done:

- metadata acceptance tests pass

## Phase 13: participant mapping service

Deliver:

- create/delete/list mappings
- deterministic candidate helper endpoint
- merge mappings

Definition of done:

- mapping acceptance tests pass

## Phase 14: search

Deliver:

- message text indexing/querying
- attachment file name indexing/querying
- cluster scope support

Definition of done:

- search acceptance tests pass

## Phase 15: export and event streaming

Deliver:

- replay/export APIs
- cursor APIs
- webhook or SSE stream for normalized events
- raw event stream exposure

Definition of done:

- export and replay acceptance tests pass

## Phase 16: deletion and redaction

Deliver:

- soft delete
- redact
- hard delete
- audit records
- search index cleanup

Definition of done:

- deletion/redaction acceptance tests pass

## Phase 17: server SDK and HTTP SDK surface

Deliver:

- `sdk-node`
- typed server-facing HTTP API client
- example backend integration

Definition of done:

- SDK integration tests pass against local API server

## Phase 18: real WhatsApp linked adapter

Deliver:

- adapter implementation behind internal interface
- adapter contract tests
- adapter smoke tests behind explicit environment flag

Definition of done:

- fake adapter acceptance suite still passes unchanged
- real adapter passes contract tests
- smoke tests pass when configured

## Phase 19: final hardening

Deliver:

- observability hooks
- structured logs
- basic health endpoints
- retry policies
- backpressure protections
- docs cleanup

Definition of done:

- full acceptance suite passes in CI
- AGENTS.md checklist complete

---

# 12. API conventions

## 12.1 Error handling

Use typed errors with machine-readable codes. At minimum:

- `not_found`
- `invalid_argument`
- `conflict`
- `already_exists`
- `precondition_failed`
- `rate_limited`
- `internal_error`
- `provider_error`
- `unsupported`

## 12.2 Pagination

Use cursor-based pagination, not offset pagination, for messages, cluster timelines, exports, and events. Offset pagination is acceptable for small admin lists only if needed.

## 12.3 Idempotency

Support idempotency keys for:

- send message
- send attachment
- metadata set if possible
- deletion/redaction requests

## 12.4 Multi-tenancy

Every query must be tenant-scoped. No cross-tenant leakage. All tests must include tenant isolation cases.

---

# 13. Minimal SDK methods for v1

The Node SDK must expose at least:

```ts
createConnection(input)
getConnection(input)
getConnectionStatus(input)
getConnectionQr(input)
disconnectConnection(input)
reconnectConnection(input)
listConnections(input)

listDiscoveredConversations(input)
getConversation(input)
selectConversation(input)
deselectConversation(input)
bulkSelectConversations(input)
bulkDeselectConversations(input)
getConversationParticipants(input)

listMessages(input)
getMessage(input)
sendTextMessage(input)
sendAttachmentMessage(input)
getReceipts(input)

listAttachments(input)
requestAttachmentDownload(input)
getAttachment(input)
getAttachmentDownloadUrl(input)

createCluster(input)
getCluster(input)
listClusters(input)
updateCluster(input)
archiveCluster(input)
addConversationToCluster(input)
removeConversationFromCluster(input)
listClusterConversations(input)
getClusterTimeline(input)

searchMessages(input)
searchAttachmentsByName(input)

setMetadata(input)
getMetadata(input)
deleteMetadata(input)
listMetadata(input)

listParticipants(input)
getParticipant(input)
createEntityMapping(input)
listEntityMappings(input)
deleteEntityMapping(input)
listCandidateMatches(input)
mergeParticipantMappings(input)

exportEvents(input)
exportMessages(input)
getOrCreateCursor(input)
advanceCursor(input)

softDeleteMessage(input)
redactMessage(input)
hardDeleteMessage(input)
softDeleteAttachment(input)
redactAttachment(input)
hardDeleteAttachment(input)
getDeletionRecord(input)
listDeletionRecords(input)
```

---

# 14. Definition of complete v1

v1 is complete only when all of the following are true:

- all modules in the sequential plan are implemented
- no acceptance tests are skipped
- fake adapter based end-to-end suite passes fully
- real WhatsApp adapter contract tests pass
- live adapter smoke tests pass when credentials/config are provided
- all public APIs are documented in code and typed SDK surface
- deletion/redaction behavior is tested and working
- cluster timeline, search, attachments, metadata, export, and participant mapping are all implemented
- event replay by `ingest_seq` is stable and resumable
- week-by-week history import is resumable and idempotent

If any one of these is incomplete, v1 is not complete.

---

# 15. Instructions to the coding agent

1. Follow the sequential build plan exactly.
2. Use red-green TDD for every change.
3. Before each phase, write or extend failing tests for that phase.
4. Make the smallest implementation needed to pass the tests.
5. Refactor only after green.
6. Do not invent product behavior not specified here.
7. Prefer deterministic fake-adapter coverage over premature real-adapter work.
8. Keep the internal provider interface stable.
9. Preserve tenant isolation and idempotency invariants at all times.
10. Do not stop until the full v1 definition of done is satisfied.
11. When blocked on the real adapter, continue advancing all fake-adapter-covered modules and acceptance tests.
12. Keep a running build log in the repo root named `BUILD_PROGRESS.md` with:

- current phase
- failing tests introduced
- tests passing
- migrations added
- APIs added
- open defects

13. After completing each phase, update `BUILD_PROGRESS.md` and commit the phase atomically.
14. Never delete or weaken acceptance tests to make progress.
15. If implementation details are ambiguous, choose the simpler option that preserves the canonical product decisions above.

End of spec.

