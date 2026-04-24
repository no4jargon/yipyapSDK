import { afterEach, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { createPlatformServer } from '../../apps/api/src/platform-server';
import type {
  ProviderAdapter,
  ProviderAttachmentFetchResult,
  ProviderConversation,
  ProviderHistoryAnchor,
  ProviderHistoryPage,
  ProviderRawEvent,
  ProviderSendResult
} from '../../packages/provider-adapter-interface/src';

const tenantId = 'tenant_demo';

describe('platform inbox and timeline api', () => {
  let closeServer: (() => Promise<void>) | null = null;

  afterEach(async () => {
    await closeServer?.();
    closeServer = null;
  });

  it('serves inbox chats, timeline pages, sync status, and older-history backfill from canonical state', async () => {
    const adapter = new InboxProviderAdapterStub();
    const app = await createPlatformServer({ providerAdapter: adapter, objectStorageDir: '/tmp/yipyap-inbox-api-test' });
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
    const connectionId = (connection.body as { id: string }).id;

    const discovered = await httpJson(baseUrl, 'GET', `/connections/${connectionId}/conversations`);
    const conversations = discovered.body as Array<{ id: string; title: string }>;
    const aliceConversationId = conversations.find((item) => item.title === 'Alice')?.id;
    const teamConversationId = conversations.find((item) => item.title === 'Team')?.id;
    expect(aliceConversationId).toBeTruthy();
    expect(teamConversationId).toBeTruthy();

    await httpJson(baseUrl, 'POST', `/conversations/${aliceConversationId}/select`, {});
    await waitFor(async () => {
      const timeline = await httpJson(baseUrl, 'GET', `/conversations/${aliceConversationId}/timeline?limit=10`);
      expect((timeline.body as { items: Array<{ providerMessageId: string }> }).items.map((item) => item.providerMessageId)).toEqual(['alice_hist_recent']);
    });

    await adapter.emit({
      family: 'provider_raw',
      type: 'message.received',
      connectionId,
      occurredAt: new Date('2026-04-22T11:00:00.000Z'),
      payload: {
        providerConversationId: 'team@g.us',
        providerMessageId: 'team_live_1',
        senderId: 'bob',
        messageType: 'text',
        textBody: 'Newest group reply'
      }
    });

    const inbox = await httpJson(baseUrl, 'GET', `/connections/${connectionId}/inbox/chats?limit=10`);
    expect(inbox.body).toEqual({
      items: [
        expect.objectContaining({
          title: 'Team',
          type: 'group',
          lastMessage: expect.objectContaining({ preview: 'Newest group reply', direction: 'inbound' }),
          sync: expect.objectContaining({ bootstrapState: 'ready' })
        }),
        expect.objectContaining({
          title: 'Alice',
          type: 'direct',
          lastMessage: expect.objectContaining({ preview: 'Recent hello from Alice' })
        })
      ],
      nextCursor: null
    });

    const teamTimeline = await httpJson(baseUrl, 'GET', `/conversations/${teamConversationId}/timeline?limit=10`);
    expect(teamTimeline.body).toEqual(expect.objectContaining({
      items: [
        expect.objectContaining({ providerMessageId: 'team_live_1', text: 'Newest group reply' })
      ],
      pageInfo: expect.objectContaining({ hasOlder: false }),
      sync: expect.objectContaining({ olderHistoryPossible: true })
    }));

    const syncStatusBeforeBackfill = await httpJson(baseUrl, 'GET', `/conversations/${teamConversationId}/sync-status`);
    expect(syncStatusBeforeBackfill.body).toEqual(expect.objectContaining({
      coverage: expect.objectContaining({ olderHistoryPossible: true }),
      backfill: expect.objectContaining({ state: 'idle' })
    }));

    const backfill = await httpJson(baseUrl, 'POST', `/conversations/${teamConversationId}/backfill`, { direction: 'older', pageSizeDays: 7 });
    expect(backfill.body).toEqual(expect.objectContaining({
      conversationId: teamConversationId,
      olderHistoryPossible: false
    }));

    const teamTimelineAfterBackfill = await httpJson(baseUrl, 'GET', `/conversations/${teamConversationId}/timeline?limit=10`);
    expect(teamTimelineAfterBackfill.body).toEqual(expect.objectContaining({
      items: [
        expect.objectContaining({ providerMessageId: 'team_hist_older', text: 'Earlier team message' }),
        expect.objectContaining({ providerMessageId: 'team_live_1', text: 'Newest group reply' })
      ],
      pageInfo: expect.objectContaining({ hasOlder: false })
    }));

    const syncStatusAfterBackfill = await httpJson(baseUrl, 'GET', `/conversations/${teamConversationId}/sync-status`);
    expect(syncStatusAfterBackfill.body).toEqual(expect.objectContaining({
      coverage: expect.objectContaining({ olderHistoryPossible: false }),
      backfill: expect.objectContaining({ state: 'exhausted' })
    }));
  });
});

class InboxProviderAdapterStub implements ProviderAdapter {
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
        providerConversationId: 'alice@s.whatsapp.net',
        conversationType: 'direct',
        title: 'Alice',
        participants: [
          { providerParticipantId: 'participant_self', displayName: 'Self', phoneE164: '+15550000000', isSelf: true },
          { providerParticipantId: 'alice', displayName: 'Alice', phoneE164: '+15551234567', isSelf: false }
        ]
      },
      {
        providerConversationId: 'team@g.us',
        conversationType: 'group',
        title: 'Team',
        participants: [
          { providerParticipantId: 'participant_self', displayName: 'Self', phoneE164: '+15550000000', isSelf: true },
          { providerParticipantId: 'bob', displayName: 'Bob', phoneE164: '+15553334444', isSelf: false },
          { providerParticipantId: 'carol', displayName: 'Carol', phoneE164: '+15553335555', isSelf: false }
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

  async emit(event: ProviderRawEvent): Promise<void> {
    const handlers = this.subscribers.get(event.connectionId) ?? new Set();
    for (const handler of handlers) {
      await handler(event);
    }
  }

  async requestHistoryPage(input: {
    connectionId: string;
    providerConversationId: string;
    pageDirection: 'backward';
    anchor?: ProviderHistoryAnchor;
    pageSizeDays: 7;
  }): Promise<ProviderHistoryPage> {
    if (input.providerConversationId === 'alice@s.whatsapp.net') {
      return {
        messages: [
          {
            providerMessageId: 'alice_hist_recent',
            providerConversationId: 'alice@s.whatsapp.net',
            senderId: 'alice',
            sentAt: new Date('2026-04-22T10:00:00.000Z'),
            messageType: 'text',
            textBody: 'Recent hello from Alice'
          }
        ],
        nextAnchor: null
      };
    }

    if (input.providerConversationId === 'team@g.us' && !input.anchor) {
      return {
        messages: [
          {
            providerMessageId: 'team_hist_older',
            providerConversationId: 'team@g.us',
            senderId: 'bob',
            sentAt: new Date('2026-04-20T08:00:00.000Z'),
            messageType: 'text',
            textBody: 'Earlier team message'
          }
        ],
        nextAnchor: null
      };
    }

    return { messages: [], nextAnchor: null };
  }

  async sendTextMessage(): Promise<ProviderSendResult> {
    return {
      providerMessageId: 'sent_1',
      providerTimestamp: new Date('2026-04-22T10:30:00.000Z')
    };
  }

  async sendAttachmentMessage(): Promise<ProviderSendResult> {
    return {
      providerMessageId: 'sent_attachment_1',
      providerTimestamp: new Date('2026-04-22T10:31:00.000Z')
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
