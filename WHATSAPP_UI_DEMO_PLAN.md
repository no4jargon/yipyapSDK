# WHATSAPP_UI_DEMO_PLAN.md

## Purpose

This file defines the next implementation steps after completion of `WHATSAPP_INBOX_IMPLEMENTATION_PLAN.md`.

It describes how to build a **demo app** that proves the platform can drive a WhatsApp-like interface, while keeping the repository's primary focus on the **platform itself**.

This document is intentionally explicit about boundaries:

- the **platform** remains the product
- the **demo app** is only an example consumer of the platform
- demo work must validate platform capabilities, not replace them with demo-only logic

---

## 1. Product stance

### Primary product
The primary product in this repository remains:

- canonical mirror storage
- provider integration
- sync orchestration
- history import
- attachment handling
- search
- metadata
- event streaming
- export
- deletion/redaction
- typed SDK / HTTP API surface

### Demo role
The demo app exists only to:

- prove that the platform can power a WhatsApp-like interface
- serve as a reference integration for API consumers
- expose gaps in the API contract or realtime model
- help acceptance-test the platform end-to-end

### Demo non-goals
The demo app is **not**:

- a separate product
- a rich frontend framework initiative
- a replacement for platform tests
- a place to introduce business logic that belongs in core packages
- a reason to distort public API shape around one-off UI shortcuts

---

## 2. Success criteria

The demo is successful only if it demonstrates that an external consumer can build a WhatsApp-like UI **using the platform as-is**.

That means the demo must consume platform APIs for:

1. connection lifecycle
2. conversation discovery and selection
3. inbox chat list
4. conversation timeline reads
5. realtime normalized event streaming
6. sending text and attachments
7. older-history backfill
8. attachment download flow
9. search
10. clusters
11. metadata
12. deletion/redaction-safe rendering

The demo should make clear that the platform maintains the durable state and the UI is just a projection consumer.

---

## 3. Core architecture constraints

## 3.1 Platform-first rule
All durable state and queryability must come from platform services and canonical storage.

The demo must not:

- read Postgres directly
- depend on provider-memory state
- implement its own inbox ordering semantics outside platform responses
- treat websocket/SSE events as the source of truth

The demo must:

- do initial page hydration from HTTP APIs
- use realtime stream only for incremental updates
- recover from refresh/restart via API reads + cursor replay

## 3.2 Thin demo rule
Keep demo code mostly confined to:

- `apps/demo/`
- small SDK/API client helpers if needed

Do not spread demo-specific conditionals across core packages unless a true platform gap is discovered.

## 3.3 Platform gap rule
If demo work reveals a missing capability, fix it in the platform first.

Examples:
- missing inbox field -> add to platform API
- missing timeline pagination field -> add to platform API
- missing replay cursor handling -> add to event stream/export layer

Do **not** patch around missing platform behavior purely in the demo.

---

## 4. Required demo capabilities

The demo must showcase the following user-visible flows.

## 4.1 Connection flow
The user can:

- create a connection
- see current connection state
- fetch and render the QR code
- observe transition to connected
- disconnect and reconnect

## 4.2 Discovery and selection flow
The user can:

- list discovered conversations for a connection
- inspect basic conversation metadata
- manually select conversations to mirror
- deselect conversations
- observe sync/import state

## 4.3 Inbox flow
The user can:

- open an inbox view
- see chats ordered by latest visible message descending
- see title, preview, timestamp, chat type, selected state
- observe inbox reordering on inbound and outbound messages

## 4.4 Timeline flow
The user can:

- click a chat to open its timeline
- see ordered messages
- distinguish inbound vs outbound
- see sender attribution for groups
- see message status/receipts for outbound messages
- load older messages with cursor pagination

## 4.5 Realtime flow
The user can:

- keep the demo open and see new messages arrive live
- send a message and see it appear live
- observe message status updates
- recover after stream interruption by replaying from last seen cursor

## 4.6 History/backfill flow
The user can:

- tell whether a conversation is fully mirrored or still partial
- request older history
- observe backfill status
- see older messages appear in the timeline without duplicates

## 4.7 Attachment flow
The user can:

- see attachment-bearing messages in the timeline
- request attachment download
- retrieve/download an available attachment URL
- observe attachment download state changes

## 4.8 Search flow
The user can:

- search mirrored messages
- search attachments by file name
- jump from a result to the corresponding conversation/timeline area

## 4.9 Cluster flow
The user can:

- create a cluster
- add conversations to it
- inspect cluster conversation membership
- read a merged cluster timeline

## 4.10 Metadata flow
The user can:

- attach metadata to messages/conversations/clusters
- list metadata
- observe versioned updates and deletes in a simple inspector view

## 4.11 Deletion/redaction flow
The user can:

- soft-delete a message and see normal views exclude it
- redact a message and see the shell remain
- inspect attachment hard-delete consequences gracefully

---

## 5. Proposed demo shape

Build the demo as a lightweight example app in `apps/demo`.

## 5.1 UI layout
Use a minimal three-pane layout where practical:

1. **Left pane**: connection + inbox
2. **Center pane**: active conversation timeline
3. **Right pane**: inspector / metadata / sync / debug panels

This can remain simple HTML/CSS/JS if that keeps the example maintainable.

## 5.2 Example sections
At minimum, the demo should contain:

- connection controls
- discovered conversations panel
- inbox panel
- active thread panel
- message composer
- attachment actions
- sync/backfill status area
- event stream status area
- search panel
- cluster panel
- metadata panel
- debug output panel

## 5.3 Demo implementation philosophy
Prefer:

- boring, readable code
- direct HTTP/API usage
- simple event-stream reconciliation
- explicit local state objects

Avoid:

- elaborate frontend architecture
- custom component frameworks unless necessary
- hidden abstractions that make the demo harder to audit

---

## 6. API contract expectations for the demo

The demo should consume stable public routes only.

## 6.1 Inbox contract
The inbox route should provide enough data to render a chat list without extra per-row fetches.

Each inbox item should expose at least:

- `conversationId`
- `connectionId`
- `title`
- `conversationType`
- `avatarRef`
- `isSelected`
- `lastMessageAt`
- `lastMessagePreview`
- `lastMessageType`
- `lastMessageDirection`
- `lastMessageFromMe`
- `lastMessageStatus`
- `participantCount`
- `syncState` / `recentWindowStatus` / backfill coverage summary

## 6.2 Timeline contract
The timeline route should provide enough data to render message bubbles and attachments directly.

Each timeline row should expose at least:

- `messageId`
- `conversationId`
- `providerMessageId`
- `senderParticipantId`
- `senderDisplayName` or equivalent renderable sender info
- `fromMe`
- `direction`
- `messageType`
- `textBody`
- `messagePreviewText`
- `providerSentAt`
- `mirroredAt`
- `ingestSeq`
- `messageStatus`
- `deletedAt`
- redaction-safe representation
- `attachments[]`
- `receipts[]`
- quote/reply references where present

## 6.3 Stream contract
The demo stream consumer should rely on:

- durable ordering via `ingest_seq`
- reconnect support from last seen `ingest_seq`
- normalized event payloads sufficient to patch inbox/timeline state

## 6.4 Backfill contract
The demo should be able to:

- read current sync/backfill state
- request older-history backfill
- observe completion/failure
- refresh timeline without duplicates

If any of these contracts are still weak, strengthen the platform contract before deepening demo UX.

---

## 7. Sequential implementation plan

Follow this order.

## Phase 1 — Demo requirements freeze
Deliver:

- confirm the minimum UI flows to support
- confirm which routes the demo will use
- document required request/response payload shapes
- document stream reconciliation rules

Definition of done:

- this file is accepted as the demo plan
- no major ambiguity remains about inbox/timeline/stream usage

## Phase 2 — Gap audit against current platform
Deliver:

- review the current `apps/api`, SDK surface, and event stream behavior against demo needs
- identify missing fields, weak route shapes, or replay issues
- classify gaps as platform fixes vs demo work

Definition of done:

- a small checklist exists of any blocking platform gaps
- demo implementation does not need private data access or hacks

## Phase 3 — Harden the platform contract where needed
Deliver only platform fixes needed by the demo, such as:

- missing inbox item fields
- missing timeline item fields
- missing sync status fields
- missing event payload fields
- missing cursor/replay behavior

Definition of done:

- the platform API is sufficient for a third-party consumer to build the demo
- demo-specific hacks are not required

## Phase 4 — Build demo shell in `apps/demo`
Deliver:

- simple app layout
- API base URL configuration
- tenant/connection selection
- reusable fetch helper
- event stream connection helper
- local state structure for inbox + timeline + cursor

Definition of done:

- the app loads and can talk to the running platform API
- no WhatsApp-specific UX polish required yet

## Phase 5 — Implement connection and discovery views
Deliver:

- create connection flow
- QR rendering
- connection status polling/refresh
- discovered conversations list
- select/deselect actions

Definition of done:

- user can connect and choose mirrored chats from the demo

## Phase 6 — Implement inbox view
Deliver:

- inbox list rendering from platform inbox route
- stable descending sort from API response
- selected chat highlighting
- timestamp + preview rendering
- refresh action

Definition of done:

- inbox reads are fully API-driven
- no per-chat extra queries needed for initial list display

## Phase 7 — Implement timeline view and composer
Deliver:

- chat timeline rendering
- text composer
- outbound send handling
- receipts/status rendering
- attachment message rendering

Definition of done:

- user can open a mirrored chat and read/send messages

## Phase 8 — Implement realtime reconciliation
Deliver:

- subscribe to normalized event stream
- keep last seen `ingest_seq`
- patch inbox rows on relevant events
- patch active timeline on relevant events
- replay after reconnect from last cursor

Definition of done:

- new inbound/outbound messages appear live
- stream interruption does not cause missed messages or duplicated rendering

## Phase 9 — Implement older-history UX
Deliver:

- timeline “load older” control
- backfill trigger action
- sync/backfill status banner
- refresh/merge behavior for older history

Definition of done:

- user can progressively extend a conversation timeline into older history

## Phase 10 — Implement supporting capability panels
Deliver:

- attachment actions
- search panel with jump-to-chat behavior
- cluster panel with merged timeline read
- metadata inspector/editor
- deletion/redaction examples

Definition of done:

- the demo exercises major platform capabilities beyond base chat rendering

## Phase 11 — Demo acceptance and polish
Deliver:

- smoke-test the demo against fake-adapter-backed local runs
- smoke-test the demo against live WhatsApp mode behind explicit flags
- improve copy/layout just enough for comprehension
- document how to run the demo

Definition of done:

- the demo reliably showcases platform capabilities end-to-end
- platform remains the center of the repository story

---

## 8. State management rules for the demo

The demo should keep a minimal local state model.

Suggested state:

- `tenantId`
- `connectionId`
- `selectedConversationId`
- `lastSeenIngestSeq`
- `inboxByConversationId`
- `inboxOrder`
- `timelineByConversationId`
- `timelineCursorByConversationId`
- `syncStatusByConversationId`
- `streamConnectionState`

Rules:

1. initial page load comes from API reads
2. stream events patch existing state incrementally
3. on refresh, the UI must be reconstructible from APIs alone
4. stream events must never be the only copy of important UI state

---

## 9. Demo-specific testing strategy

The demo should not replace the platform acceptance suite, but it should have targeted smoke coverage.

## 9.1 Minimum tests
Add focused tests for:

- demo server serves the app
- demo can render QR SVG endpoint
- demo stream connection wiring works at a basic level
- demo page references the platform routes it depends on

## 9.2 Optional higher-value tests
If practical, add integration-style tests that validate:

- inbox API payload can render demo inbox HTML/state
- timeline API payload can render demo thread HTML/state
- stream event payload patches local demo state correctly

These should stay lightweight and not become a second full acceptance suite.

---

## 10. Acceptance checklist

The demo is complete only when all of the following are true:

1. A user can open the demo and point it at the platform API.
2. A user can create a connection and obtain a QR.
3. A user can observe connection status changes.
4. A user can list discovered conversations.
5. A user can select a conversation to mirror.
6. The inbox view shows mirrored chats ordered by latest message descending.
7. Clicking a chat opens its timeline.
8. The timeline supports older-message pagination.
9. Sending a message from the demo updates the thread and inbox.
10. Incoming realtime messages update the thread and inbox.
11. Stream reconnect/replay from last cursor works.
12. Backfill controls can extend older history.
13. Attachment download flow is visible.
14. Search results can navigate into a conversation context.
15. Cluster timeline can be demonstrated.
16. Metadata operations can be demonstrated.
17. Deletion/redaction-safe rendering can be demonstrated.
18. The demo can be explained as a thin platform consumer, not a separate product.

---

## 11. Repo boundaries and implementation guardrails

### Guardrail 1
Do not move core logic from platform packages into the demo.

### Guardrail 2
Do not make undocumented private API calls from the demo.

### Guardrail 3
Do not create demo-only storage or sidecar persistence.

### Guardrail 4
Do not over-invest in frontend styling at the expense of platform correctness.

### Guardrail 5
If a platform feature is unclear, fix and document the platform contract first.

### Guardrail 6
Keep the demo runnable with both:

- deterministic fake-adapter-backed flows where applicable
- explicit live WhatsApp smoke/manual flows

---

## 12. Recommended next concrete actions

1. Review `apps/demo` and classify current behavior as:
   - reusable
   - temporary
   - missing
2. Perform a platform gap audit specifically for:
   - inbox route payload shape
   - timeline route payload shape
   - realtime replay semantics
   - sync/backfill route shape
3. Document exact demo-consumed API payloads in code comments or route tests.
4. Upgrade `apps/demo` from a route exerciser into a thin inbox/timeline reference client.
5. Add a short runbook to `README.md` explaining how to launch:
   - API server
   - demo app
   - optional live WhatsApp smoke setup
6. Add only minimal demo tests needed to keep the example from regressing.

---

## 13. Final principle

The right end state is:

- the platform remains the durable, tested, canonical system
- the demo app clearly shows that a WhatsApp-like UI can be built on top of it
- the demo stays small, understandable, and secondary to the platform

If a choice must be made between demo polish and platform clarity, choose platform clarity.

---

## 14. Current `apps/demo` audit

This section records the current state of `apps/demo` after review of:

- `apps/demo/src/main.ts`
- `apps/demo/src/server.ts`
- `tests/apps/demo-server.spec.ts`
- relevant API routes in `apps/api/src/platform-server.ts`

## 14.1 What is currently reusable

These parts are worth keeping and iterating on:

1. **Very small footprint**
   - `apps/demo` is isolated and easy to reason about.
   - it has not polluted core packages with demo-specific logic.

2. **Simple runtime boot path**
   - `apps/demo/src/main.ts` is a clean entrypoint with configurable host/port/API base URL.

3. **Small HTTP wrapper server**
   - `apps/demo/src/server.ts` already provides a tiny shell for serving HTML.
   - this is a good place to keep demo-only server helpers such as QR rendering and, if needed later, a lightweight stream/API proxy.

4. **QR SVG helper endpoint**
   - `/qr.svg` is useful and should remain.
   - it keeps QR rendering simple without adding frontend complexity.

5. **Existing route exerciser controls**
   - the current buttons already touch important routes:
     - connections
     - discovery
     - inbox
     - timeline
     - backfill
     - send text
     - attachment download request
     - cluster create
     - search
     - metadata
     - export
     - soft delete
   - this is a useful starting point for a richer reference app.

6. **Basic tests**
   - `tests/apps/demo-server.spec.ts` already protects the shell and QR endpoint.
   - these tests can stay and be extended incrementally.

## 14.2 What is currently temporary / insufficient

The current demo is still primarily a **route exerciser**, not yet a WhatsApp-like reference client.

1. **No real inbox UI**
   - inbox data is dumped into the generic output panel.
   - there is no persistent chat list view.
   - there is no row selection state, unread-style highlighting, or visible last-message ordering behavior.

2. **No real timeline UI**
   - timeline responses are shown as raw JSON.
   - there are no chat bubbles, sender attribution, status presentation, attachment cards, or date grouping.

3. **No meaningful client state model**
   - the page stores only a few implicit IDs in inputs/global variables.
   - there is no maintained state for inbox rows, active conversation timeline, cursors, or sync state.

4. **No realtime reconciliation**
   - the current stream path writes the latest event payload directly into the output panel.
   - it does not patch inbox state.
   - it does not patch timeline state.
   - it does not keep `lastSeenIngestSeq`.
   - it does not implement reconnect/replay.

5. **Current EventSource usage is not sufficient**
   - the platform emits named SSE events via `event: <eventType>`.
   - the demo only uses `streamSource.onmessage`, which does not handle named events correctly.
   - the demo therefore is not yet consuming the stream in a UI-grade way.

6. **Current browser-to-API shape is not ideal for a backend-first platform**
   - the demo browser calls the platform API directly.
   - the platform is intentionally backend-first and tenant-scoped by header.
   - raw browser `EventSource` cannot set `x-tenant-id`, so the current stream path only works accidentally for the default tenant fallback.
   - for a better example consumer, the demo likely needs a small server-side bridge/proxy for platform requests and SSE.

7. **No older-message pagination UX**
   - the demo can load one timeline page and trigger backfill, but not progressively page older/newer messages in a user-facing thread.

8. **No conversation sync-status presentation**
   - sync/backfill data exists in the platform but is not rendered as a banner/panel with actionable meaning.

9. **No jump-driven search UX**
   - search results are not tied back into conversation/timeline navigation.

10. **No cluster/timeline visualization**
   - the demo can create a cluster, but not inspect a cluster timeline as a user-facing view.

11. **No metadata inspector workflow**
   - metadata can be set, but not browsed or versioned meaningfully in the UI.

12. **No deletion/redaction-safe rendering**
   - current output does not demonstrate how a consumer should render soft-deleted, redacted, or hard-deleted objects.

## 14.3 Platform-facing gaps confirmed during the audit

The current platform is close, but a few API/stream areas should be treated as likely phase-3 hardening work before the demo is considered complete.

1. **Timeline response is still too thin for a WhatsApp-like renderer**
   - current `/conversations/:id/timeline` items are mapped with a narrow shape.
   - confirmed omissions in the route mapping include:
     - attachment payloads are currently returned as `attachment: null`
     - no receipts array
     - no sender display name
     - no deleted/redacted rendering hints
     - no richer preview/render metadata
   - this is a platform contract gap, not a demo-only concern.

2. **Browser-friendly multi-tenant realtime access is not solved cleanly yet**
   - `/events/stream` expects tenant context through the normal server-side model.
   - a thin browser demo cannot reliably supply that through `EventSource` headers.
   - this should be solved either by:
     - a demo-side server proxy, or
     - an explicitly documented browser-safe stream access mechanism.
   - because the product is backend-first, the preferred solution is likely the demo-side proxy.

3. **Exact inbox item contract should be frozen and documented**
   - inbox works, but the demo should depend on a clearly documented stable row shape.
   - route tests should pin the fields the reference UI relies on.

4. **Normalized event payloads may need explicit UI patch fields**
   - the event stream already delivers normalized events durably.
   - however, the demo will be simpler if the stream payloads are explicit enough to patch inbox/timeline state without extra guesswork.

---

## 15. Concrete gap checklist

Use this checklist to drive the next work.

## 15.1 Reusable as-is or with very small edits

- `apps/demo/src/main.ts`
- `apps/demo/src/server.ts` shell structure
- `/qr.svg` endpoint
- basic API base URL configuration
- basic connection controls as placeholders
- `tests/apps/demo-server.spec.ts` as the base smoke coverage

## 15.2 Replace or significantly reshape inside `apps/demo`

- replace single `output` JSON dump as the primary UX
- replace input-driven workflow with pane-based inbox/thread interactions
- replace implicit globals with an explicit local state model
- replace naive `EventSource.onmessage` handling with named-event listeners and cursor tracking
- replace direct browser-only privileged API usage where it conflicts with backend-first assumptions
- add actual inbox rendering
- add actual timeline rendering
- add selected conversation state
- add pagination controls/state
- add sync/backfill banner
- add search results panel with jump behavior
- add cluster timeline panel
- add metadata inspector panel
- add deletion/redaction examples in rendered form

## 15.3 Platform hardening tasks likely needed before or during demo work

- freeze the inbox row contract in route tests
- enrich the timeline route so it returns render-ready attachment/receipt/sender/deletion-redaction data
- confirm stream replay semantics and codify demo usage of `afterIngestSeq`
- decide and document the tenant/auth approach for demo stream consumption
- ensure normalized events contain enough information for deterministic inbox/timeline patching

## 15.4 Tests to add once demo work starts

- demo route test still passes after UI refactor
- demo HTML contains inbox/thread regions, not just route buttons
- demo stream wiring handles named SSE events
- demo state patching test for a streamed `message.mirrored` event
- demo pagination/backfill smoke test at the UI-state level if feasible

## 15.5 Recommended immediate next steps

1. Freeze the exact demo-consumed contracts for:
   - inbox route
   - timeline route
   - sync-status route
   - event stream replay usage
2. Decide whether `apps/demo` will:
   - proxy platform requests server-side, or
   - remain a direct browser caller only for non-privileged flows
3. Harden platform route tests for any missing timeline/inbox fields.
4. Refactor `apps/demo` from “button panel + raw JSON” into “inbox pane + thread pane + inspector pane”.
5. Add only enough demo tests to prevent regressions while keeping the platform as the main tested surface.
