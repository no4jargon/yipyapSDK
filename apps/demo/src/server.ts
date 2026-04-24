import { Readable } from 'node:stream';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import QRCode from 'qrcode';

export function createDemoServer(input: { apiBaseUrl: string }): Server {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');

    try {
      if (request.method === 'GET' && url.pathname === '/favicon.ico') {
        response.statusCode = 204;
        response.end();
        return;
      }

      if (request.method === 'GET' && url.pathname === '/qr.svg') {
        const payload = url.searchParams.get('payload') ?? '';
        if (!payload) {
          response.statusCode = 400;
          response.setHeader('content-type', 'text/plain; charset=utf-8');
          response.end('missing qr payload');
          return;
        }

        const svg = await QRCode.toString(payload, { type: 'svg', margin: 1, width: 320 });
        response.statusCode = 200;
        response.setHeader('content-type', 'image/svg+xml; charset=utf-8');
        response.end(svg);
        return;
      }

      if (url.pathname === '/proxy/events/stream') {
        await proxyEventStream({ apiBaseUrl: input.apiBaseUrl, request, response, url });
        return;
      }

      if (url.pathname.startsWith('/proxy/')) {
        await proxyJsonRequest({ apiBaseUrl: input.apiBaseUrl, request, response, url });
        return;
      }

      if (request.method !== 'GET' || url.pathname !== '/') {
        response.statusCode = 404;
        response.end('not found');
        return;
      }

      response.statusCode = 200;
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(renderIndexHtml(input.apiBaseUrl));
    } catch (error: unknown) {
      respondJson(response, {
        code: 'internal_error',
        message: error instanceof Error ? error.message : String(error)
      }, 500);
    }
  });
}

async function proxyJsonRequest(input: {
  apiBaseUrl: string;
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
}): Promise<void> {
  const upstreamUrl = new URL(input.url.pathname.replace(/^\/proxy/, '') + input.url.search, input.apiBaseUrl);
  const requestBody = await readBody(input.request);
  const tenantId = getTenantId(input.request, input.url);

  const upstreamResponse = await fetch(upstreamUrl, {
    method: input.request.method ?? 'GET',
    headers: {
      accept: input.request.headers.accept ?? 'application/json',
      'content-type': input.request.headers['content-type'] ?? 'application/json',
      'x-tenant-id': tenantId
    },
    body: canHaveBody(input.request.method) && requestBody.length > 0 ? requestBody.toString('utf8') : undefined,
    duplex: 'half'
  } as RequestInit & { duplex: 'half' });

  input.response.statusCode = upstreamResponse.status;
  input.response.setHeader('content-type', upstreamResponse.headers.get('content-type') ?? 'application/json');
  input.response.end(Buffer.from(await upstreamResponse.arrayBuffer()));
}

async function proxyEventStream(input: {
  apiBaseUrl: string;
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
}): Promise<void> {
  const tenantId = getTenantId(input.request, input.url);
  const upstreamUrl = new URL('/events/stream', input.apiBaseUrl);
  const afterIngestSeq = input.url.searchParams.get('afterIngestSeq');
  if (afterIngestSeq) {
    upstreamUrl.searchParams.set('afterIngestSeq', afterIngestSeq);
  }

  const controller = new AbortController();
  input.request.on('close', () => controller.abort());

  const upstreamResponse = await fetch(upstreamUrl, {
    method: 'GET',
    headers: {
      accept: 'text/event-stream',
      'x-tenant-id': tenantId
    },
    signal: controller.signal
  });

  input.response.statusCode = upstreamResponse.status;
  input.response.setHeader('content-type', upstreamResponse.headers.get('content-type') ?? 'text/event-stream');
  input.response.setHeader('cache-control', upstreamResponse.headers.get('cache-control') ?? 'no-cache');
  input.response.setHeader('connection', 'keep-alive');

  if (!upstreamResponse.body) {
    input.response.end();
    return;
  }

  const body = Readable.fromWeb(upstreamResponse.body as never);
  body.on('error', () => {
    if (!input.response.writableEnded) {
      input.response.end();
    }
  });
  body.pipe(input.response);
}

function renderIndexHtml(apiBaseUrl: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>YipYap Demo</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0b1321;
        --panel: #111827;
        --panel-soft: #1f2937;
        --border: #334155;
        --muted: #94a3b8;
        --text: #e5eefc;
        --accent: #22c55e;
        --accent-soft: #16a34a;
        --bubble-in: #172554;
        --bubble-out: #064e3b;
        --danger: #ef4444;
        --warning: #f59e0b;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg);
        color: var(--text);
      }
      button, input, textarea, select {
        font: inherit;
        border-radius: 10px;
        border: 1px solid var(--border);
        background: #0f172a;
        color: var(--text);
      }
      button {
        cursor: pointer;
        background: #1d4ed8;
        border: 0;
        padding: 10px 12px;
      }
      button.secondary { background: #334155; }
      button.success { background: var(--accent-soft); }
      button.warn { background: var(--warning); color: #111827; }
      button.danger { background: var(--danger); }
      input, textarea, select { width: 100%; padding: 10px 12px; }
      textarea { min-height: 88px; resize: vertical; }
      a { color: #93c5fd; }
      .page {
        display: grid;
        grid-template-rows: auto 1fr;
        min-height: 100vh;
      }
      .topbar {
        border-bottom: 1px solid var(--border);
        background: rgba(15, 23, 42, 0.88);
        backdrop-filter: blur(8px);
        padding: 16px 20px;
      }
      .topbar h1 { margin: 0 0 6px; font-size: 24px; }
      .topbar p { margin: 0; color: var(--muted); }
      .workspace {
        display: grid;
        grid-template-columns: 360px minmax(420px, 1fr) 360px;
        gap: 0;
        min-height: 0;
      }
      .pane {
        border-right: 1px solid var(--border);
        min-height: calc(100vh - 84px);
        display: flex;
        flex-direction: column;
        background: var(--panel);
      }
      .pane:last-child { border-right: 0; }
      .pane-header {
        padding: 16px;
        border-bottom: 1px solid var(--border);
      }
      .pane-header h2, .pane-header h3 { margin: 0 0 8px; }
      .pane-scroll {
        overflow: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .stack { display: flex; flex-direction: column; gap: 10px; }
      .row { display: flex; gap: 8px; }
      .row > * { flex: 1; }
      .helper { color: var(--muted); font-size: 13px; }
      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: 999px;
        background: #0f172a;
        border: 1px solid var(--border);
        font-size: 12px;
      }
      .panel-card {
        background: var(--panel-soft);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 12px;
      }
      .list { display: flex; flex-direction: column; gap: 8px; }
      .chat-row {
        width: 100%;
        text-align: left;
        background: transparent;
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 12px;
      }
      .chat-row.active { border-color: #60a5fa; background: #172033; }
      .chat-row-header {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 4px;
      }
      .chat-row-title { font-weight: 700; }
      .chat-row-subtitle, .chat-row-meta { color: var(--muted); font-size: 13px; }
      .timeline-actions {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        align-items: center;
      }
      .timeline {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .message {
        max-width: 82%;
        border-radius: 16px;
        padding: 10px 12px;
        border: 1px solid var(--border);
      }
      .message.inbound { align-self: flex-start; background: var(--bubble-in); }
      .message.outbound { align-self: flex-end; background: var(--bubble-out); }
      .message.system { align-self: center; background: #1e293b; }
      .message.active { outline: 2px solid #93c5fd; }
      .message-header, .message-footer {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        font-size: 12px;
        color: #cbd5e1;
        margin-bottom: 6px;
      }
      .message-footer { margin-top: 8px; margin-bottom: 0; }
      .message-text { white-space: pre-wrap; line-height: 1.45; }
      .message-empty { color: var(--muted); font-style: italic; }
      .attachment-list, .receipt-list, .search-results { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
      .attachment-card, .search-result, .event-log-entry {
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 10px;
        background: #0f172a;
      }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; font-size: 12px; }
      .qr-card {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 200px;
        background: white;
        border-radius: 14px;
        padding: 12px;
      }
      .qr-card img { max-width: 100%; height: auto; display: block; }
      .empty-state {
        color: var(--muted);
        padding: 14px;
        border: 1px dashed var(--border);
        border-radius: 12px;
      }
      .split-title {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
      }
      @media (max-width: 1200px) {
        .workspace { grid-template-columns: 320px 1fr; }
        .pane:last-child { grid-column: 1 / -1; min-height: auto; }
      }
      @media (max-width: 860px) {
        .workspace { grid-template-columns: 1fr; }
        .pane { min-height: auto; border-right: 0; border-bottom: 1px solid var(--border); }
        .pane:last-child { border-bottom: 0; }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <header class="topbar">
        <h1>YipYap Demo</h1>
        <p>This is a thin reference client for the platform. API base: <span class="mono">${escapeHtml(apiBaseUrl)}</span></p>
      </header>
      <main class="workspace">
        <aside class="pane">
          <div class="pane-header">
            <div class="split-title">
              <div>
                <h2>Connection + Inbox</h2>
                <div id="connectionStatus" class="helper">No connection yet.</div>
              </div>
              <span id="streamStatus" class="status-pill">stream stopped</span>
            </div>
          </div>
          <div class="pane-scroll">
            <section class="panel-card stack">
              <div class="row">
                <div>
                  <label class="helper" for="tenantId">Tenant</label>
                  <input id="tenantId" value="tenant_demo" placeholder="Tenant ID" />
                </div>
                <div>
                  <label class="helper" for="workspaceUserRef">Workspace user</label>
                  <input id="workspaceUserRef" value="demo-user" placeholder="Workspace user ref" />
                </div>
              </div>
              <div class="row">
                <button onclick="createConnection()">Create connection</button>
                <button class="secondary" onclick="loadConnections()">List connections</button>
              </div>
              <div class="row">
                <button class="secondary" onclick="loadConnectionStatus()">Refresh status</button>
                <button class="secondary" onclick="loadQr()">Load QR</button>
              </div>
              <div class="row">
                <button class="success" onclick="startEventStream()">Start live stream</button>
                <button class="secondary" onclick="stopEventStream()">Stop stream</button>
              </div>
              <div class="qr-card">
                <img id="qrPreview" alt="WhatsApp QR code" style="display:none" />
                <small id="qrHint" class="helper">QR not loaded yet.</small>
              </div>
            </section>

            <section class="panel-card stack">
              <div class="split-title">
                <h3>Discovered conversations</h3>
                <button class="secondary" onclick="discoverConversations()">Refresh</button>
              </div>
              <div id="demoDiscoveredList" class="list"></div>
            </section>

            <section class="panel-card stack">
              <div class="split-title">
                <h3>Inbox</h3>
                <button class="secondary" onclick="refreshInbox()">Refresh</button>
              </div>
              <div id="demoInboxList" class="list"></div>
            </section>
          </div>
        </aside>

        <section class="pane">
          <div class="pane-header">
            <div class="split-title">
              <div>
                <h2 id="selectedConversationTitle">No conversation selected</h2>
                <div id="selectedConversationSubtitle" class="helper">Select a mirrored conversation from the inbox or discovery list.</div>
              </div>
              <div class="status-pill" id="selectedConversationSyncPill">sync unknown</div>
            </div>
          </div>
          <div class="pane-scroll">
            <section class="panel-card stack">
              <div class="timeline-actions">
                <button class="secondary" onclick="loadOlderMessages()">Load older messages</button>
                <div class="helper" id="timelinePageInfo">No timeline loaded yet.</div>
              </div>
              <div id="syncBanner" class="helper">Sync status will appear here.</div>
            </section>

            <section class="panel-card stack">
              <div id="demoTimeline" class="timeline"></div>
            </section>

            <section class="panel-card stack">
              <h3>Composer</h3>
              <textarea id="messageText" placeholder="Type a message">hello from demo</textarea>
              <div class="row">
                <button onclick="sendTextMessage()">Send message</button>
                <button class="secondary" onclick="backfillOlder()">Request older-history backfill</button>
              </div>
            </section>
          </div>
        </section>

        <aside class="pane" id="demoInspector">
          <div class="pane-header">
            <h2>Inspector</h2>
            <div class="helper">Search, attachments, metadata, clusters, and event/debug state.</div>
          </div>
          <div class="pane-scroll">
            <section class="panel-card stack">
              <h3>Search</h3>
              <input id="searchQuery" value="hello" placeholder="Search mirrored messages" />
              <button onclick="searchMessages()">Search messages</button>
              <div id="searchResults" class="search-results"></div>
            </section>

            <section class="panel-card stack">
              <h3>Selected message actions</h3>
              <div class="helper mono" id="selectedMessageLabel">No message selected.</div>
              <div class="row">
                <button class="secondary" onclick="requestSelectedAttachmentDownload()">Request attachment download</button>
                <button class="danger" onclick="softDeleteSelectedMessage()">Soft delete message</button>
              </div>
            </section>

            <section class="panel-card stack">
              <h3>Metadata</h3>
              <div class="helper" id="metadataTargetLabel">Target follows the selected conversation.</div>
              <button onclick="setMetadata()">Set demo metadata</button>
              <button class="secondary" onclick="loadMetadata()">Load metadata</button>
              <pre id="metadataOutput" class="mono">No metadata loaded yet.</pre>
            </section>

            <section class="panel-card stack">
              <h3>Clusters</h3>
              <input id="clusterName" value="Priority" placeholder="Cluster name" />
              <div class="row">
                <button onclick="createClusterFromSelection()">Create cluster + add selected chat</button>
                <button class="secondary" onclick="loadActiveClusterTimeline()">Load cluster timeline</button>
              </div>
              <pre id="clusterOutput" class="mono">No cluster created yet.</pre>
            </section>

            <section class="panel-card stack">
              <h3>Sync + debug</h3>
              <pre id="syncOutput" class="mono">No sync status yet.</pre>
              <pre id="eventLogOutput" class="mono">No streamed events yet.</pre>
            </section>
          </div>
        </aside>
      </main>
    </div>
    <script>
      const apiBaseUrl = ${JSON.stringify(apiBaseUrl)};
      const state = {
        tenantId: 'tenant_demo',
        workspaceUserRef: 'demo-user',
        connectionId: '',
        selectedConversationId: '',
        selectedConversationTitle: '',
        selectedMessageId: '',
        selectedAttachmentId: '',
        lastSeenIngestSeq: '0',
        inboxItems: [],
        discoveredConversations: [],
        timeline: { items: [], pageInfo: null, sync: null, conversation: null },
        syncStatus: null,
        searchResults: [],
        metadataRecords: [],
        activeClusterId: '',
        activeClusterTimeline: null,
        eventLog: [],
        streamStatus: 'stopped'
      };
      let statusPollHandle = null;
      let streamSource = null;
      let streamRefreshHandle = null;

      function $(id) {
        return document.getElementById(id);
      }

      function escapeHtml(value) {
        return String(value ?? '')
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }

      function syncInputsIntoState() {
        state.tenantId = $('tenantId').value || 'tenant_demo';
        state.workspaceUserRef = $('workspaceUserRef').value || 'demo-user';
      }

      async function api(path, method = 'GET', body) {
        syncInputsIntoState();
        const response = await fetch('/proxy' + path, {
          method,
          headers: {
            'content-type': 'application/json',
            'x-tenant-id': state.tenantId
          },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
        const raw = await response.text();
        const payload = raw ? JSON.parse(raw) : null;
        if (!response.ok) {
          throw new Error(payload?.message || payload?.code || response.statusText || 'request failed');
        }
        return payload;
      }

      function logEvent(label, payload) {
        state.eventLog.unshift({ label, payload, at: new Date().toISOString() });
        state.eventLog = state.eventLog.slice(0, 30);
        renderEventLog();
      }

      function setConnectionState(connectionId, status, extra) {
        if (connectionId) {
          state.connectionId = connectionId;
        }
        const parts = [];
        if (state.connectionId) parts.push('connection=' + state.connectionId);
        if (status) parts.push('status=' + status);
        if (extra) parts.push(extra);
        $('connectionStatus').textContent = parts.join(' | ') || 'No connection yet.';
      }

      function setQrPreview(qrPayload) {
        const image = $('qrPreview');
        const hint = $('qrHint');
        if (!qrPayload) {
          image.style.display = 'none';
          image.removeAttribute('src');
          hint.style.display = 'block';
          hint.textContent = 'QR not loaded yet.';
          return;
        }
        image.src = '/qr.svg?payload=' + encodeURIComponent(qrPayload);
        image.style.display = 'block';
        hint.style.display = 'none';
      }

      function updateStreamStatus(status) {
        state.streamStatus = status;
        $('streamStatus').textContent = status;
      }

      function startStatusPolling() {
        stopStatusPolling();
        statusPollHandle = setInterval(() => {
          if (!state.connectionId) {
            return;
          }
          void loadConnectionStatus(true);
        }, 2000);
      }

      function stopStatusPolling() {
        if (statusPollHandle) {
          clearInterval(statusPollHandle);
          statusPollHandle = null;
        }
      }

      function scheduleRefreshFromEvent(payload) {
        if (streamRefreshHandle) {
          clearTimeout(streamRefreshHandle);
        }
        streamRefreshHandle = setTimeout(async () => {
          streamRefreshHandle = null;
          try {
            if (payload.connectionId && payload.connectionId === state.connectionId) {
              await refreshInbox();
            }
            if (payload.conversationId && payload.conversationId === state.selectedConversationId) {
              await openConversation(payload.conversationId, { refreshInbox: false, preserveSelection: true });
            }
          } catch (error) {
            logEvent('refresh_error', { message: error instanceof Error ? error.message : String(error) });
          }
        }, 75);
      }

      function registerStreamHandler(source, eventName) {
        source.addEventListener(eventName, async (event) => {
          try {
            const payload = JSON.parse(event.data);
            if (payload?.ingestSeq) {
              state.lastSeenIngestSeq = String(payload.ingestSeq);
            }
            logEvent(eventName, payload);
            scheduleRefreshFromEvent(payload);
          } catch (error) {
            logEvent('stream_parse_error', { eventName, message: error instanceof Error ? error.message : String(error) });
          }
        });
      }

      async function createConnection() {
        try {
          const payload = await api('/connections', 'POST', { workspaceUserRef: state.workspaceUserRef });
          state.connectionId = payload.id;
          setQrPreview(null);
          setConnectionState(payload.id, payload.status || 'unknown', 'waiting for QR or connected state');
          logEvent('connection.created', payload);
          startStatusPolling();
          await discoverConversations();
        } catch (error) {
          logEvent('create_connection_failed', { message: error instanceof Error ? error.message : String(error) });
        }
      }

      async function loadConnections() {
        try {
          const payload = await api('/connections');
          if (Array.isArray(payload) && payload.length > 0) {
            const latest = payload[payload.length - 1];
            state.connectionId = latest.id;
            setConnectionState(latest.id, latest.status || 'unknown');
            await discoverConversations();
            await refreshInbox();
          }
          logEvent('connections.loaded', payload);
        } catch (error) {
          logEvent('connections_failed', { message: error instanceof Error ? error.message : String(error) });
        }
      }

      async function loadConnectionStatus(silent = false) {
        if (!state.connectionId) {
          throw new Error('create or select a connection first');
        }
        const payload = await api('/connections/' + state.connectionId + '/status');
        setConnectionState(state.connectionId, payload.status || 'unknown');
        if (payload.status !== 'qr_ready') {
          setQrPreview(null);
        }
        if (!silent) {
          logEvent('connection.status', payload);
        }
        if (payload.status === 'qr_ready' || payload.status === 'connected' || payload.status === 'failed' || payload.status === 'reauth_required') {
          stopStatusPolling();
        }
        if (payload.status === 'connected') {
          await discoverConversations();
          await refreshInbox();
        }
        return payload;
      }

      async function loadQr() {
        if (!state.connectionId) {
          throw new Error('create or select a connection first');
        }
        try {
          const payload = await api('/connections/' + state.connectionId + '/qr');
          if (payload.qrPayload) {
            setQrPreview(payload.qrPayload);
            setConnectionState(state.connectionId, 'qr_ready', 'scan the QR image below');
          }
          logEvent('connection.qr_ready', payload);
        } catch (error) {
          logEvent('load_qr_failed', { message: error instanceof Error ? error.message : String(error) });
        }
      }

      async function discoverConversations() {
        if (!state.connectionId) {
          renderDiscovered();
          return;
        }
        try {
          const payload = await api('/connections/' + state.connectionId + '/conversations');
          state.discoveredConversations = Array.isArray(payload) ? payload : [];
          renderDiscovered();
          logEvent('conversations.discovered', { count: state.discoveredConversations.length });
        } catch (error) {
          logEvent('discover_failed', { message: error instanceof Error ? error.message : String(error) });
        }
      }

      async function refreshInbox() {
        if (!state.connectionId) {
          renderInbox();
          return;
        }
        try {
          const payload = await api('/connections/' + state.connectionId + '/inbox/chats?limit=50');
          state.inboxItems = Array.isArray(payload.items) ? payload.items : [];
          renderInbox();
          if (!state.selectedConversationId && state.inboxItems[0]?.conversationId) {
            await openConversation(state.inboxItems[0].conversationId, { refreshInbox: false });
          }
        } catch (error) {
          logEvent('inbox_failed', { message: error instanceof Error ? error.message : String(error) });
        }
      }

      async function setConversationSelection(conversationId, isSelected) {
        try {
          await api('/conversations/' + conversationId + '/' + (isSelected ? 'select' : 'deselect'), 'POST', {});
          await discoverConversations();
          await refreshInbox();
          if (conversationId === state.selectedConversationId) {
            await loadSyncStatus();
          }
        } catch (error) {
          logEvent('selection_failed', { conversationId, message: error instanceof Error ? error.message : String(error) });
        }
      }

      async function openConversation(conversationId, options = {}) {
        if (!conversationId) {
          return;
        }
        state.selectedConversationId = conversationId;
        state.selectedMessageId = '';
        state.selectedAttachmentId = '';
        $('selectedMessageLabel').textContent = 'No message selected.';
        if (options.refreshInbox !== false) {
          await refreshInbox();
        } else {
          renderInbox();
        }
        try {
          const payload = await api('/conversations/' + conversationId + '/timeline?limit=30');
          state.timeline = {
            items: Array.isArray(payload.items) ? payload.items : [],
            pageInfo: payload.pageInfo ?? null,
            sync: payload.sync ?? null,
            conversation: payload.conversation ?? null
          };
          state.selectedConversationTitle = payload.conversation?.title || conversationId;
          $('selectedConversationTitle').textContent = state.selectedConversationTitle;
          $('selectedConversationSubtitle').textContent = payload.conversation
            ? payload.conversation.type + ' conversation · ' + conversationId
            : conversationId;
          await loadSyncStatus();
          renderTimeline();
        } catch (error) {
          logEvent('timeline_failed', { conversationId, message: error instanceof Error ? error.message : String(error) });
        }
      }

      async function loadOlderMessages() {
        if (!state.selectedConversationId) {
          return;
        }
        const before = state.timeline?.pageInfo?.nextBeforeCursor;
        if (!before) {
          logEvent('timeline.no_older', { conversationId: state.selectedConversationId });
          return;
        }
        try {
          const payload = await api('/conversations/' + state.selectedConversationId + '/timeline?limit=30&before=' + encodeURIComponent(before));
          const existing = new Map((state.timeline.items || []).map((item) => [item.messageId, item]));
          for (const item of payload.items || []) {
            existing.set(item.messageId, item);
          }
          state.timeline = {
            items: Array.from(existing.values()).sort((left, right) => new Date(left.sentAt).getTime() - new Date(right.sentAt).getTime() || String(left.messageId).localeCompare(String(right.messageId))),
            pageInfo: payload.pageInfo ?? state.timeline.pageInfo,
            sync: payload.sync ?? state.timeline.sync,
            conversation: payload.conversation ?? state.timeline.conversation
          };
          renderTimeline();
        } catch (error) {
          logEvent('timeline_older_failed', { message: error instanceof Error ? error.message : String(error) });
        }
      }

      async function loadSyncStatus() {
        if (!state.selectedConversationId) {
          return;
        }
        try {
          state.syncStatus = await api('/conversations/' + state.selectedConversationId + '/sync-status');
          $('selectedConversationSyncPill').textContent = 'sync ' + (state.syncStatus.backfill?.state || state.syncStatus.recentWindow?.status || 'unknown');
          $('syncBanner').textContent = 'Recent window: ' + (state.syncStatus.recentWindow?.status || 'unknown') + ' · older history possible: ' + String(state.syncStatus.coverage?.olderHistoryPossible ?? true) + ' · backfill: ' + (state.syncStatus.backfill?.state || 'idle');
          $('syncOutput').textContent = JSON.stringify(state.syncStatus, null, 2);
        } catch (error) {
          logEvent('sync_failed', { message: error instanceof Error ? error.message : String(error) });
        }
      }

      async function backfillOlder() {
        if (!state.selectedConversationId) {
          return;
        }
        try {
          const payload = await api('/conversations/' + state.selectedConversationId + '/backfill', 'POST', { pageSizeDays: 7 });
          logEvent('backfill.requested', payload);
          await openConversation(state.selectedConversationId, { refreshInbox: false, preserveSelection: true });
        } catch (error) {
          logEvent('backfill_failed', { message: error instanceof Error ? error.message : String(error) });
        }
      }

      async function sendTextMessage() {
        if (!state.selectedConversationId) {
          return;
        }
        try {
          const payload = await api('/conversations/' + state.selectedConversationId + '/messages/text', 'POST', {
            text: $('messageText').value
          });
          logEvent('message.sent', payload);
          $('messageText').value = '';
          await openConversation(state.selectedConversationId, { refreshInbox: true, preserveSelection: true });
        } catch (error) {
          logEvent('send_failed', { message: error instanceof Error ? error.message : String(error) });
        }
      }

      async function requestAttachmentDownload(attachmentId) {
        if (!attachmentId) {
          return;
        }
        try {
          const payload = await api('/attachments/' + attachmentId + '/download', 'POST', {});
          state.selectedAttachmentId = attachmentId;
          logEvent('attachment.download.requested', payload);
          if (state.selectedConversationId) {
            await openConversation(state.selectedConversationId, { refreshInbox: false, preserveSelection: true });
          }
        } catch (error) {
          logEvent('attachment_failed', { message: error instanceof Error ? error.message : String(error) });
        }
      }

      async function requestSelectedAttachmentDownload() {
        await requestAttachmentDownload(state.selectedAttachmentId);
      }

      async function searchMessages() {
        try {
          const payload = await api('/search/messages', 'POST', {
            query: $('searchQuery').value,
            scope: { type: 'tenant' }
          });
          state.searchResults = Array.isArray(payload) ? payload : [];
          renderSearchResults();
        } catch (error) {
          logEvent('search_failed', { message: error instanceof Error ? error.message : String(error) });
        }
      }

      async function setMetadata() {
        if (!state.selectedConversationId) {
          return;
        }
        try {
          const payload = await api('/metadata', 'POST', {
            targetType: 'conversation',
            targetId: state.selectedConversationId,
            namespace: 'demo',
            key: 'stage',
            valueJson: { value: 'active' }
          });
          $('metadataOutput').textContent = JSON.stringify(payload, null, 2);
          await loadMetadata();
        } catch (error) {
          logEvent('metadata_failed', { message: error instanceof Error ? error.message : String(error) });
        }
      }

      async function loadMetadata() {
        if (!state.selectedConversationId) {
          return;
        }
        try {
          const payload = await api('/metadata/conversation/' + state.selectedConversationId);
          state.metadataRecords = Array.isArray(payload) ? payload : [];
          $('metadataOutput').textContent = JSON.stringify(state.metadataRecords, null, 2);
        } catch (error) {
          logEvent('metadata_load_failed', { message: error instanceof Error ? error.message : String(error) });
        }
      }

      async function createClusterFromSelection() {
        if (!state.selectedConversationId) {
          return;
        }
        try {
          const cluster = await api('/clusters', 'POST', { name: $('clusterName').value });
          state.activeClusterId = cluster.id;
          await api('/clusters/' + cluster.id + '/conversations', 'POST', { conversationId: state.selectedConversationId });
          await loadActiveClusterTimeline();
        } catch (error) {
          logEvent('cluster_failed', { message: error instanceof Error ? error.message : String(error) });
        }
      }

      async function loadActiveClusterTimeline() {
        if (!state.activeClusterId) {
          return;
        }
        try {
          const payload = await api('/clusters/' + state.activeClusterId + '/timeline');
          state.activeClusterTimeline = payload;
          $('clusterOutput').textContent = JSON.stringify({ clusterId: state.activeClusterId, timeline: payload }, null, 2);
        } catch (error) {
          logEvent('cluster_timeline_failed', { message: error instanceof Error ? error.message : String(error) });
        }
      }

      async function softDeleteSelectedMessage() {
        if (!state.selectedMessageId) {
          return;
        }
        try {
          const payload = await api('/messages/' + state.selectedMessageId + '/soft-delete', 'POST', { reason: 'demo cleanup' });
          logEvent('message.soft_deleted', payload);
          await openConversation(state.selectedConversationId, { refreshInbox: true, preserveSelection: true });
        } catch (error) {
          logEvent('soft_delete_failed', { message: error instanceof Error ? error.message : String(error) });
        }
      }

      function selectMessage(messageId, attachmentId) {
        state.selectedMessageId = messageId || '';
        state.selectedAttachmentId = attachmentId || '';
        $('selectedMessageLabel').textContent = state.selectedMessageId
          ? 'message=' + state.selectedMessageId + (state.selectedAttachmentId ? ' | attachment=' + state.selectedAttachmentId : '')
          : 'No message selected.';
        renderTimeline();
      }

      function startEventStream() {
        stopEventStream();
        syncInputsIntoState();
        const url = '/proxy/events/stream?tenantId=' + encodeURIComponent(state.tenantId) + '&afterIngestSeq=' + encodeURIComponent(state.lastSeenIngestSeq || '0');
        streamSource = new EventSource(url, { withCredentials: false });
        updateStreamStatus('stream connecting');
        const eventNames = [
          'message.mirrored',
          'message.updated',
          'message.sent',
          'message.failed',
          'receipt.observed',
          'conversation.updated',
          'conversation.selected',
          'conversation.deselected',
          'attachment.download.completed',
          'attachment.download.failed',
          'history_import.started',
          'history_import.page_completed',
          'history_import.completed'
        ];
        for (const eventName of eventNames) {
          registerStreamHandler(streamSource, eventName);
        }
        streamSource.onopen = () => updateStreamStatus('stream live');
        streamSource.onerror = () => updateStreamStatus('stream disconnected');
      }

      function stopEventStream() {
        if (streamSource) {
          streamSource.close();
          streamSource = null;
        }
        updateStreamStatus('stream stopped');
      }

      function renderDiscovered() {
        const container = $('demoDiscoveredList');
        if (!state.discoveredConversations.length) {
          container.innerHTML = '<div class="empty-state">No discovered conversations yet.</div>';
          return;
        }
        container.innerHTML = state.discoveredConversations.map((conversation) => {
          const isActive = conversation.id === state.selectedConversationId;
          return '<div class="panel-card">'
            + '<div class="chat-row-title">' + escapeHtml(conversation.title || conversation.providerConversationId || conversation.id) + '</div>'
            + '<div class="chat-row-subtitle">' + escapeHtml(conversation.conversationType || 'unknown') + ' · selected=' + String(Boolean(conversation.isSelected)) + '</div>'
            + '<div class="row" style="margin-top:8px">'
            + '<button class="secondary" onclick="openConversation(' + JSON.stringify(conversation.id) + ')">Open</button>'
            + '<button onclick="setConversationSelection(' + JSON.stringify(conversation.id) + ', true)">Select</button>'
            + '<button class="secondary" onclick="setConversationSelection(' + JSON.stringify(conversation.id) + ', false)">Deselect</button>'
            + '</div>'
            + '</div>';
        }).join('');
      }

      function renderInbox() {
        const container = $('demoInboxList');
        if (!state.inboxItems.length) {
          container.innerHTML = '<div class="empty-state">No mirrored chats yet. Select a conversation and let import/sync populate the inbox.</div>';
          return;
        }
        container.innerHTML = state.inboxItems.map((item) => {
          const isActive = item.conversationId === state.selectedConversationId;
          const preview = item.lastMessage?.preview || 'No mirrored messages yet';
          const timestamp = item.lastMessageAt ? new Date(item.lastMessageAt).toLocaleString() : 'no activity';
          const sync = item.sync?.bootstrapState || item.sync?.recentWindowStatus || 'unknown';
          return '<button class="chat-row' + (isActive ? ' active' : '') + '" onclick="openConversation(' + JSON.stringify(item.conversationId) + ')">'
            + '<div class="chat-row-header"><span class="chat-row-title">' + escapeHtml(item.title) + '</span><span class="chat-row-meta">' + escapeHtml(timestamp) + '</span></div>'
            + '<div class="chat-row-subtitle">' + escapeHtml(preview) + '</div>'
            + '<div class="chat-row-meta">' + escapeHtml(item.type) + ' · selected=' + String(Boolean(item.selected)) + ' · sync=' + escapeHtml(sync) + '</div>'
            + '</button>';
        }).join('');
      }

      function renderTimeline() {
        const container = $('demoTimeline');
        const items = state.timeline?.items || [];
        if (!items.length) {
          container.innerHTML = '<div class="empty-state">Open a conversation to read its timeline.</div>';
          $('timelinePageInfo').textContent = 'No timeline loaded yet.';
          return;
        }
        container.innerHTML = items.map((message) => {
          const direction = message.direction || (message.fromMe ? 'outbound' : 'inbound');
          const isActive = message.messageId === state.selectedMessageId;
          const text = message.text || (message.messageStatus === 'redacted' ? '[redacted]' : message.messageStatus === 'deleted' ? '[deleted]' : '');
          const attachments = Array.isArray(message.attachments) ? message.attachments : [];
          const receipts = Array.isArray(message.receipts) ? message.receipts : [];
          const attachmentMarkup = attachments.length === 0
            ? ''
            : '<div class="attachment-list">' + attachments.map((attachment) => {
                const link = attachment.downloadUrl
                  ? '<a href="' + escapeHtml(attachment.downloadUrl) + '" target="_blank" rel="noreferrer">download</a>'
                  : '<button class="secondary" onclick="event.stopPropagation(); requestAttachmentDownload(' + JSON.stringify(attachment.id) + ')">request download</button>';
                return '<div class="attachment-card">'
                  + '<div><strong>' + escapeHtml(attachment.fileName || attachment.mimeType || attachment.attachmentType || 'attachment') + '</strong></div>'
                  + '<div class="helper">' + escapeHtml(attachment.attachmentType || 'unknown') + ' · ' + escapeHtml(attachment.downloadState || 'not_requested') + '</div>'
                  + '<div style="margin-top:6px">' + link + '</div>'
                  + '</div>';
              }).join('') + '</div>';
          const receiptMarkup = receipts.length === 0
            ? ''
            : '<div class="receipt-list helper">Receipts: ' + receipts.map((receipt) => escapeHtml(receipt.receiptType + (receipt.participantDisplayName ? ' (' + receipt.participantDisplayName + ')' : ''))).join(', ') + '</div>';
          return '<div class="message ' + escapeHtml(direction) + (isActive ? ' active' : '') + '" onclick="selectMessage(' + JSON.stringify(message.messageId) + ', ' + JSON.stringify(attachments[0]?.id || '') + ')">'
            + '<div class="message-header"><span>' + escapeHtml(message.senderDisplayName || (message.fromMe ? 'You' : message.providerSenderRef || 'Unknown sender')) + '</span><span>' + escapeHtml(new Date(message.sentAt).toLocaleString()) + '</span></div>'
            + '<div class="message-text' + (!text ? ' message-empty' : '') + '">' + escapeHtml(text || '[no text body]') + '</div>'
            + attachmentMarkup
            + receiptMarkup
            + '<div class="message-footer"><span>' + escapeHtml(message.messageType || 'unknown') + '</span><span>' + escapeHtml(message.status || 'unknown') + '</span></div>'
            + '</div>';
        }).join('');
        const pageInfo = state.timeline.pageInfo || {};
        $('timelinePageInfo').textContent = 'hasOlder=' + String(Boolean(pageInfo.hasOlder)) + ' · hasNewer=' + String(Boolean(pageInfo.hasNewer));
      }

      function renderSearchResults() {
        const container = $('searchResults');
        if (!state.searchResults.length) {
          container.innerHTML = '<div class="empty-state">No search results yet.</div>';
          return;
        }
        container.innerHTML = state.searchResults.map((message) => {
          const label = message.textBody || message.messagePreviewText || message.normalizedTextBody || message.providerMessageId || message.id;
          return '<div class="search-result">'
            + '<div><strong>' + escapeHtml(label || 'message') + '</strong></div>'
            + '<div class="helper">conversation=' + escapeHtml(message.conversationId || 'unknown') + '</div>'
            + '<div style="margin-top:8px"><button class="secondary" onclick="jumpToSearchResult(' + JSON.stringify(message.conversationId || '') + ', ' + JSON.stringify(message.id || '') + ')">Open conversation</button></div>'
            + '</div>';
        }).join('');
      }

      async function jumpToSearchResult(conversationId, messageId) {
        await openConversation(conversationId, { refreshInbox: false, preserveSelection: true });
        selectMessage(messageId, '');
      }

      function renderEventLog() {
        $('eventLogOutput').textContent = state.eventLog.length > 0
          ? state.eventLog.map((entry) => '[' + entry.at + '] ' + entry.label + '\\n' + JSON.stringify(entry.payload, null, 2)).join('\\n\\n')
          : 'No streamed events yet.';
      }

      window.createConnection = createConnection;
      window.loadConnections = loadConnections;
      window.loadConnectionStatus = loadConnectionStatus;
      window.loadQr = loadQr;
      window.discoverConversations = discoverConversations;
      window.refreshInbox = refreshInbox;
      window.openConversation = openConversation;
      window.setConversationSelection = setConversationSelection;
      window.loadOlderMessages = loadOlderMessages;
      window.backfillOlder = backfillOlder;
      window.sendTextMessage = sendTextMessage;
      window.requestAttachmentDownload = requestAttachmentDownload;
      window.requestSelectedAttachmentDownload = requestSelectedAttachmentDownload;
      window.searchMessages = searchMessages;
      window.jumpToSearchResult = jumpToSearchResult;
      window.setMetadata = setMetadata;
      window.loadMetadata = loadMetadata;
      window.createClusterFromSelection = createClusterFromSelection;
      window.loadActiveClusterTimeline = loadActiveClusterTimeline;
      window.softDeleteSelectedMessage = softDeleteSelectedMessage;
      window.selectMessage = selectMessage;
      window.startEventStream = startEventStream;
      window.stopEventStream = stopEventStream;

      renderDiscovered();
      renderInbox();
      renderTimeline();
      renderSearchResults();
      renderEventLog();
    </script>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getTenantId(request: IncomingMessage, url: URL): string {
  const headerTenant = request.headers['x-tenant-id'];
  if (typeof headerTenant === 'string' && headerTenant.length > 0) {
    return headerTenant;
  }
  const queryTenant = url.searchParams.get('tenantId');
  return queryTenant && queryTenant.length > 0 ? queryTenant : 'tenant_demo';
}

function canHaveBody(method: string | undefined): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function respondJson(response: ServerResponse, body: unknown, statusCode = 200): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}
