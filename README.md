# YipYap

**YipYap is a backend-first developer platform for turning selected WhatsApp conversations into structured, synced, queryable application data.**

Instead of treating WhatsApp as a UI destination, YipYap treats it as an input stream that can power CRMs, support tooling, AI copilots, workflow systems, operations software, and internal dashboards.

## Why this exists

Many companies already run important parts of their business over WhatsApp, but WhatsApp data is hard to use inside software products.

Developers usually need to:
- link a user's WhatsApp account
- discover conversations
- select which chats to mirror
- import message history
- keep those chats synced in real time
- send messages back through the same system
- search and organize chats and attachments
- stream events into AI or automation pipelines

YipYap exists to provide that platform layer.

## What YipYap is

YipYap provides:
- linked-device WhatsApp connection handling
- manual conversation discovery and selection
- week-by-week historical import
- real-time mirroring of selected conversations
- send / receive support for messages and attachments
- attachment download on demand
- search over mirrored message text and attachment names
- manual conversation clusters and unified timelines
- arbitrary app-defined metadata
- raw and normalized event export
- deletion and redaction primitives
- a thin demo client that proves a WhatsApp-like interface can be built on top of the platform

## What YipYap is not

YipYap is **not**:
- a consumer WhatsApp client
- a WhatsApp clone
- a project-management app
- a browser automation hack
- a generic frontend chat widget

The product focus of this repository is the **platform**, not the demo UI.

---

## Fastest way to run it

If you want the easiest possible GitHub experience:

```bash
git clone <your-repo-url>
cd yipyap
pnpm install
pnpm demo:quickstart
```

Then open:

```text
http://127.0.0.1:4010
```

This starts:
- the API server on `http://127.0.0.1:4000`
- the demo app on `http://127.0.0.1:4010`
- the deterministic **fake provider adapter**, so the demo works without WhatsApp credentials

Detailed setup: [`docs/QUICKSTART.md`](docs/QUICKSTART.md)

---

## What the demo proves

The demo is a thin reference client for the platform. It shows that an API consumer can build a WhatsApp-like interface using YipYap as the durable backend.

The demo includes:
- connection creation and QR rendering
- conversation discovery and selection
- inbox chat list ordered by latest mirrored activity
- conversation timeline rendering
- older-history loading and backfill
- realtime normalized event streaming
- send message flow
- attachment download requests
- search
- cluster timeline reads
- metadata inspection
- deletion-safe rendering flows

---

## Run modes

### 1. Quick local demo mode
Recommended for first-time users.

```bash
pnpm demo:quickstart
```

### 2. API + demo separately
Terminal 1:

```bash
pnpm api
```

Terminal 2:

```bash
pnpm demo
```

By default, `pnpm api` runs in **fake provider mode** so the repository is easy to clone and try.

### 3. Live WhatsApp mode
When you want a real linked-device flow:

```bash
export YIPYAP_WHATSAPP_AUTH_DIR="$PWD/.tmp/whatsapp-auth"
export YIPYAP_WHATSAPP_DEVICE_LABEL="YipYap Demo"
pnpm api:live
```

Then in another terminal:

```bash
export YIPYAP_API_BASE_URL="http://127.0.0.1:4000"
pnpm demo
```

---

## Repository structure

```text
apps/
  api/            Integrated local API server
  demo/           Thin reference client
packages/         Platform modules
infra/            Migrations and infra artifacts
tests/            Unit, repository, service, and API coverage
scripts/          Quickstart and smoke entrypoints
docs/             Repo guides
```

A more detailed guide is here: [`docs/REPOSITORY_MAP.md`](docs/REPOSITORY_MAP.md)

---

## Key technical idea

YipYap uses a **database-backed canonical mirror** as the serving layer.

That means:
- provider sessions ingest events
- normalized state is persisted in canonical storage
- inbox and timeline queries are served from durable DB state
- realtime updates are incremental, not the source of truth
- replay/export is driven by durable `ingest_seq` ordering

This is what makes a reliable WhatsApp-like application interface possible.

---

## Main components

- `packages/storage` — canonical repositories and migrations
- `packages/event-log` — append-only canonical event log
- `packages/mirror-engine` — provider event normalization
- `packages/history-import` — resumable week-by-week import
- `packages/query-api` — connection, discovery, send, inbox, and backfill services
- `packages/provider-adapter-interface` — internal adapter contract + fake adapter
- `packages/provider-whatsapp-linked` — live linked-device adapter
- `packages/sdk-node` — typed API client surface

---

## Current status

This repository already contains:
- a working platform API
- a deterministic quickstart path for demoing locally
- a live WhatsApp adapter path for manual real-world testing
- an inbox/timeline read model suitable for a WhatsApp-like interface
- realtime normalized event streaming
- a demo app that consumes the platform as an example client
- automated test coverage across storage, services, API, provider adapter, and demo wiring

---

## For technical readers

Start here:
1. [`docs/QUICKSTART.md`](docs/QUICKSTART.md)
2. [`docs/REPOSITORY_MAP.md`](docs/REPOSITORY_MAP.md)
3. [`AGENTS.md`](AGENTS.md)
4. [`BUILD_PROGRESS.md`](BUILD_PROGRESS.md)
5. [`WHATSAPP_INBOX_IMPLEMENTATION_PLAN.md`](WHATSAPP_INBOX_IMPLEMENTATION_PLAN.md)
6. [`WHATSAPP_UI_DEMO_PLAN.md`](WHATSAPP_UI_DEMO_PLAN.md)

---

## Commands

```bash
pnpm install
pnpm lint
pnpm test
pnpm api
pnpm api:live
pnpm demo
pnpm demo:quickstart
```

---

## Notes

- The demo is intentionally lightweight and secondary to the platform.
- The fake-adapter path exists to make GitHub onboarding simple.
- The live-adapter path exists to validate real linked-device behavior.
- Canonical state is maintained in-process for local runs using the repository's test/storage harnesses.
