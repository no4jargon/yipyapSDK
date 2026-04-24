# Quickstart

## Fastest path

Clone the repo, install dependencies, and run the full demo stack in one command:

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

This quickstart uses the deterministic **fake provider adapter** so anyone can run the demo without WhatsApp credentials.

---

## What to click in the demo

1. Click **Create connection**
2. Click **Discover conversations** if needed
3. Click **Select** on a discovered conversation
4. Click the conversation in **Inbox**
5. Explore:
   - timeline
   - send message
   - load older messages
   - request backfill
   - search
   - metadata
   - cluster timeline

---

## Run API and demo separately

### Local demo mode

Terminal 1:

```bash
pnpm api
```

Terminal 2:

```bash
pnpm demo
```

### Live WhatsApp mode

Terminal 1:

```bash
export YIPYAP_WHATSAPP_AUTH_DIR="$PWD/.tmp/whatsapp-auth"
export YIPYAP_WHATSAPP_DEVICE_LABEL="YipYap Demo"
pnpm api:live
```

Terminal 2:

```bash
export YIPYAP_API_BASE_URL="http://127.0.0.1:4000"
pnpm demo
```

---

## Notes

- `pnpm api` defaults to **fake provider mode** for easy cloning and demoing.
- `pnpm api:live` is the opt-in path for real linked-device WhatsApp usage.
- The demo is a thin reference client for the platform, not the product itself.
