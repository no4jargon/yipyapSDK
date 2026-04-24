import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createSdkClient } from '../../packages/sdk-node/src';

describe('sdk node client', () => {
  let closeServer: (() => Promise<void>) | null = null;

  afterEach(async () => {
    await closeServer?.();
    closeServer = null;
  });

  it('calls the server HTTP surface for core connection, inbox, timeline, messaging, search, metadata, mapping, export, and deletion methods', async () => {
    const requests: Array<{ method: string; url: string; body: unknown }> = [];
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const body = rawBody ? JSON.parse(rawBody) : null;
      requests.push({ method: req.method ?? 'GET', url: req.url ?? '/', body });

      if (req.method === 'POST' && req.url === '/connections') {
        return respond(res, { id: 'conn_1', status: 'qr_ready' });
      }
      if (req.method === 'GET' && req.url === '/connections/conn_1/status') {
        return respond(res, { id: 'conn_1', status: 'connected' });
      }
      if (req.method === 'GET' && req.url === '/connections/conn_1/conversations') {
        return respond(res, [{ id: 'conv_1' }]);
      }
      if (req.method === 'GET' && req.url === '/connections/conn_1/inbox/chats?limit=10') {
        return respond(res, { items: [{ conversationId: 'conv_1' }], nextCursor: null });
      }
      if (req.method === 'POST' && req.url === '/conversations/conv_1/select') {
        return respond(res, { id: 'conv_1', isSelected: true });
      }
      if (req.method === 'GET' && req.url === '/conversations/conv_1/timeline?limit=25') {
        return respond(res, { items: [{ messageId: 'message_1' }], pageInfo: { nextBeforeCursor: null, nextAfterCursor: null, hasOlder: false, hasNewer: false } });
      }
      if (req.method === 'GET' && req.url === '/conversations/conv_1/sync-status') {
        return respond(res, { conversationId: 'conv_1', backfill: { state: 'idle' } });
      }
      if (req.method === 'POST' && req.url === '/conversations/conv_1/backfill') {
        return respond(res, { conversationId: 'conv_1', backfillState: 'exhausted' });
      }
      if (req.method === 'POST' && req.url === '/conversations/conv_1/messages/text') {
        return respond(res, { id: 'message_1', messageStatus: 'sent' });
      }
      if (req.method === 'POST' && req.url === '/attachments/attachment_1/download') {
        return respond(res, { id: 'attachment_1', downloadState: 'pending' });
      }
      if (req.method === 'POST' && req.url === '/clusters') {
        return respond(res, { id: 'cluster_1', name: 'Priority' });
      }
      if (req.method === 'POST' && req.url === '/search/messages') {
        return respond(res, [{ id: 'message_1' }]);
      }
      if (req.method === 'POST' && req.url === '/metadata') {
        return respond(res, { id: 'metadata_1', version: 1 });
      }
      if (req.method === 'POST' && req.url === '/mappings') {
        return respond(res, { id: 'mapping_1', mappingStatus: 'active' });
      }
      if (req.method === 'POST' && req.url === '/exports/events') {
        return respond(res, [{ id: 'event_1', ingestSeq: '10' }]);
      }
      if (req.method === 'POST' && req.url === '/messages/message_1/soft-delete') {
        return respond(res, { id: 'deletion_1', status: 'completed' });
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'not_found' }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    closeServer = async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('failed to bind test server');
    }

    const client = createSdkClient({ baseUrl: `http://127.0.0.1:${address.port}` });

    await expect(client.createConnection({ workspaceUserRef: 'user_1' })).resolves.toMatchObject({ id: 'conn_1', status: 'qr_ready' });
    await expect(client.getConnectionStatus({ connectionId: 'conn_1' })).resolves.toMatchObject({ id: 'conn_1', status: 'connected' });
    await expect(client.listDiscoveredConversations({ connectionId: 'conn_1' })).resolves.toMatchObject([{ id: 'conv_1' }]);
    await expect(client.listInboxChats({ connectionId: 'conn_1', limit: 10 })).resolves.toMatchObject({ items: [{ conversationId: 'conv_1' }], nextCursor: null });
    await expect(client.selectConversation({ conversationId: 'conv_1' })).resolves.toMatchObject({ id: 'conv_1', isSelected: true });
    await expect(client.getConversationTimeline({ conversationId: 'conv_1', limit: 25 })).resolves.toMatchObject({ items: [{ messageId: 'message_1' }] });
    await expect(client.getConversationSyncStatus({ conversationId: 'conv_1' })).resolves.toMatchObject({ conversationId: 'conv_1', backfill: { state: 'idle' } });
    await expect(client.backfillConversation({ conversationId: 'conv_1' })).resolves.toMatchObject({ conversationId: 'conv_1', backfillState: 'exhausted' });
    await expect(client.sendTextMessage({ conversationId: 'conv_1', text: 'hello', clientMessageId: 'client_1' })).resolves.toMatchObject({ id: 'message_1', messageStatus: 'sent' });
    await expect(client.requestAttachmentDownload({ attachmentId: 'attachment_1' })).resolves.toMatchObject({ id: 'attachment_1', downloadState: 'pending' });
    await expect(client.createCluster({ name: 'Priority', description: 'important chats' })).resolves.toMatchObject({ id: 'cluster_1', name: 'Priority' });
    await expect(client.searchMessages({ query: 'hello', scope: { type: 'tenant' } })).resolves.toMatchObject([{ id: 'message_1' }]);
    await expect(client.setMetadata({ targetType: 'message', targetId: 'message_1', namespace: 'app', key: 'priority', valueJson: { level: 1 } })).resolves.toMatchObject({ id: 'metadata_1', version: 1 });
    await expect(client.createEntityMapping({ participantId: 'participant_1', entityType: 'contact', entityRef: 'contact_1', label: 'Primary' })).resolves.toMatchObject({ id: 'mapping_1', mappingStatus: 'active' });
    await expect(client.exportEvents({ cursorName: 'cursor_1', limit: 50 })).resolves.toMatchObject([{ id: 'event_1', ingestSeq: '10' }]);
    await expect(client.softDeleteMessage({ messageId: 'message_1', reason: 'user request' })).resolves.toMatchObject({ id: 'deletion_1', status: 'completed' });

    expect(requests).toEqual([
      { method: 'POST', url: '/connections', body: { workspaceUserRef: 'user_1' } },
      { method: 'GET', url: '/connections/conn_1/status', body: null },
      { method: 'GET', url: '/connections/conn_1/conversations', body: null },
      { method: 'GET', url: '/connections/conn_1/inbox/chats?limit=10', body: null },
      { method: 'POST', url: '/conversations/conv_1/select', body: {} },
      { method: 'GET', url: '/conversations/conv_1/timeline?limit=25', body: null },
      { method: 'GET', url: '/conversations/conv_1/sync-status', body: null },
      { method: 'POST', url: '/conversations/conv_1/backfill', body: {} },
      { method: 'POST', url: '/conversations/conv_1/messages/text', body: { text: 'hello', clientMessageId: 'client_1' } },
      { method: 'POST', url: '/attachments/attachment_1/download', body: {} },
      { method: 'POST', url: '/clusters', body: { name: 'Priority', description: 'important chats' } },
      { method: 'POST', url: '/search/messages', body: { query: 'hello', scope: { type: 'tenant' } } },
      { method: 'POST', url: '/metadata', body: { targetType: 'message', targetId: 'message_1', namespace: 'app', key: 'priority', valueJson: { level: 1 } } },
      { method: 'POST', url: '/mappings', body: { participantId: 'participant_1', entityType: 'contact', entityRef: 'contact_1', label: 'Primary' } },
      { method: 'POST', url: '/exports/events', body: { cursorName: 'cursor_1', limit: 50 } },
      { method: 'POST', url: '/messages/message_1/soft-delete', body: { reason: 'user request' } }
    ]);
  });
});

function respond(response: import('node:http').ServerResponse, payload: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}
