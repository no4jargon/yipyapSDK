import { afterEach, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { createPlatformServer } from '../../apps/api/src/platform-server';
import type { ProviderAdapter, ProviderAttachmentFetchResult, ProviderConversation, ProviderHistoryPage, ProviderRawEvent, ProviderSendResult } from '../../packages/provider-adapter-interface/src';

const tenantId = 'tenant_demo';

describe('platform api server', () => {
  let closeServer: (() => Promise<void>) | null = null;

  afterEach(async () => {
    await closeServer?.();
    closeServer = null;
  });

  it('runs a live-style end-to-end platform flow over HTTP routes', async () => {
    const adapter = new StubLiveProviderAdapter();
    const app = await createPlatformServer({ providerAdapter: adapter, objectStorageDir: '/tmp/yipyap-platform-api-test' });
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    closeServer = async () => {
      await app.close();
    };
    const address = app.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected TCP address');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const connection = await httpJson(baseUrl, 'POST', '/connections', { workspaceUserRef: 'user_1' });
    expect(connection.body).toMatchObject({ status: 'qr_ready' });
    const connectionId = (connection.body as { id: string }).id;

    const qr = await httpJson(baseUrl, 'GET', `/connections/${connectionId}/qr`);
    expect(qr.body).toEqual({ qrPayload: 'stub-qr' });

    const conversations = await httpJson(baseUrl, 'GET', `/connections/${connectionId}/conversations`);
    const conversationId = (conversations.body as Array<{ id: string }>)[0]?.id;
    expect(conversationId).toBeTruthy();

    await httpJson(baseUrl, 'POST', `/conversations/${conversationId}/select`, {});
    await waitFor(async () => {
      const messages = await httpJson(baseUrl, 'GET', `/conversations/${conversationId}/messages`);
      expect((messages.body as Array<{ providerMessageId: string }>)).toEqual([
        expect.objectContaining({ providerMessageId: 'history_1' })
      ]);
    });

    const timeline = await httpJson(baseUrl, 'GET', `/conversations/${conversationId}/timeline?limit=10`);
    expect(timeline.body).toEqual(expect.objectContaining({
      conversation: expect.objectContaining({ conversationId, title: 'Alice', type: 'direct' }),
      items: [
        expect.objectContaining({
          providerMessageId: 'history_1',
          senderDisplayName: 'Alice',
          messageType: 'document',
          text: 'historic file',
          messagePreviewText: 'historic file',
          attachments: [
            expect.objectContaining({
              fileName: 'history.txt',
              attachmentType: 'document'
            })
          ],
          receipts: []
        })
      ],
      pageInfo: expect.objectContaining({ hasOlder: false })
    }));

    const sendResult = await httpJson(baseUrl, 'POST', `/conversations/${conversationId}/messages/text`, { text: 'hello from api' });
    expect(sendResult.body).toMatchObject({ messageStatus: 'sent' });

    const attachments = await httpJson(baseUrl, 'GET', `/conversations/${conversationId}/attachments`);
    const attachmentId = (attachments.body as Array<{ id: string }>)[0]?.id;
    expect(attachmentId).toBeTruthy();

    const requestDownload = await httpJson(baseUrl, 'POST', `/attachments/${attachmentId}/download`, {});
    expect(requestDownload.body).toMatchObject({ downloadState: 'pending' });

    await waitFor(async () => {
      const attachment = await httpJson(baseUrl, 'GET', `/attachments/${attachmentId}`);
      expect(attachment.body).toMatchObject({ downloadState: 'available' });
    });

    const cluster = await httpJson(baseUrl, 'POST', '/clusters', { name: 'Priority' });
    const clusterId = (cluster.body as { id: string }).id;
    await httpJson(baseUrl, 'POST', `/clusters/${clusterId}/conversations`, { conversationId });

    const search = await httpJson(baseUrl, 'POST', '/search/messages', { query: 'historic', scope: { type: 'conversation', conversationId } });
    expect(search.body).toEqual([expect.objectContaining({ providerMessageId: 'history_1' })]);

    const metadata = await httpJson(baseUrl, 'POST', '/metadata', {
      targetType: 'conversation',
      targetId: conversationId,
      namespace: 'demo',
      key: 'stage',
      valueJson: { value: 'active' }
    });
    expect(metadata.body).toMatchObject({ version: 1 });

    const participants = await httpJson(baseUrl, 'GET', `/connections/${connectionId}/participants`);
    const participantId = (participants.body as Array<{ id: string }>).find((item) => item.id)?.id;
    expect(participantId).toBeTruthy();

    const mapping = await httpJson(baseUrl, 'POST', '/mappings', {
      participantId,
      entityType: 'contact',
      entityRef: 'contact_1',
      label: 'Demo Contact'
    });
    expect(mapping.body).toMatchObject({ mappingStatus: 'active' });

    const events = await httpJson(baseUrl, 'POST', '/exports/events', { cursorName: 'demo_cursor', limit: 100 });
    expect((events.body as Array<{ eventType: string }>).length).toBeGreaterThan(0);

    const messages = await httpJson(baseUrl, 'GET', `/conversations/${conversationId}/messages`);
    const messageId = (messages.body as Array<{ id: string; providerMessageId: string }>).find((item) => item.providerMessageId === 'history_1')?.id;
    expect(messageId).toBeTruthy();

    const deletion = await httpJson(baseUrl, 'POST', `/messages/${messageId}/soft-delete`, { reason: 'cleanup' });
    expect(deletion.body).toMatchObject({ status: 'completed' });

    const health = await httpJson(baseUrl, 'GET', '/health');
    expect(health.statusCode).toBe(200);
    expect(health.body).toMatchObject({ ok: true });
  });
});

class StubLiveProviderAdapter implements ProviderAdapter {
  private readonly subscribers = new Map<string, Set<(event: ProviderRawEvent) => Promise<void>>>();

  async createSession(): Promise<void> {}

  async getConnectionBootstrapState(): Promise<{ status: 'qr_ready'; qrPayload: string }> {
    return { status: 'qr_ready', qrPayload: 'stub-qr' };
  }

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  async listDiscoveredConversations(): Promise<ProviderConversation[]> {
    return [
      {
        providerConversationId: '15551234567@s.whatsapp.net',
        conversationType: 'direct',
        title: 'Alice',
        participants: [
          { providerParticipantId: 'participant_self', displayName: 'Self', phoneE164: '+15550000000', isSelf: true },
          { providerParticipantId: 'alice', displayName: 'Alice', phoneE164: '+15551234567', isSelf: false }
        ]
      }
    ];
  }

  async subscribe(connectionId: string, onEvent: (event: ProviderRawEvent) => Promise<void>): Promise<() => Promise<void>> {
    const handlers = this.subscribers.get(connectionId) ?? new Set();
    handlers.add(onEvent);
    this.subscribers.set(connectionId, handlers);
    return async () => {
      handlers.delete(onEvent);
    };
  }

  async requestHistoryPage(): Promise<ProviderHistoryPage> {
    return {
      messages: [
        {
          providerMessageId: 'history_1',
          providerConversationId: '15551234567@s.whatsapp.net',
          senderId: 'alice',
          sentAt: new Date('2026-04-20T10:00:00.000Z'),
          messageType: 'document',
          textBody: 'historic file',
          attachmentRef: 'attachment_provider_1',
          fileName: 'history.txt'
        }
      ],
      nextAnchor: null
    };
  }

  async sendTextMessage(): Promise<ProviderSendResult> {
    return {
      providerMessageId: 'sent_1',
      providerTimestamp: new Date('2026-04-22T10:00:00.000Z')
    };
  }

  async sendAttachmentMessage(): Promise<ProviderSendResult> {
    return {
      providerMessageId: 'sent_attachment_1',
      providerTimestamp: new Date('2026-04-22T10:01:00.000Z')
    };
  }

  async fetchAttachment(): Promise<ProviderAttachmentFetchResult> {
    return {
      fileName: 'history.txt',
      mimeType: 'text/plain',
      data: Buffer.from('history file')
    };
  }
}

async function waitFor(assertion: () => Promise<void>, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  await assertion();
}

async function httpJson(baseUrl: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ statusCode: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = request(`${baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': tenantId
      }
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode ?? 0,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
        });
      });
      response.on('error', reject);
    });
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}
