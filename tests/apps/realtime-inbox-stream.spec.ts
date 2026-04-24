import { afterEach, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { createPlatformServer } from '../../apps/api/src/platform-server';
import type {
  ProviderAdapter,
  ProviderAttachmentFetchResult,
  ProviderConversation,
  ProviderHistoryPage,
  ProviderRawEvent,
  ProviderSendResult
} from '../../packages/provider-adapter-interface/src';

const tenantId = 'tenant_stream';

describe('platform realtime stream', () => {
  let closeServer: (() => Promise<void>) | null = null;

  afterEach(async () => {
    await closeServer?.();
    closeServer = null;
  });

  it('streams normalized events after a durable ingest sequence cursor', async () => {
    const adapter = new StreamProviderAdapterStub();
    const app = await createPlatformServer({ providerAdapter: adapter, objectStorageDir: '/tmp/yipyap-stream-api-test' });
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
    await httpJson(baseUrl, 'GET', `/connections/${connectionId}/conversations`);

    const exported = await httpJson(baseUrl, 'POST', '/exports/events', { cursorName: 'stream_cursor', limit: 100 });
    const events = exported.body as Array<{ ingestSeq: string }>;
    const afterIngestSeq = events.at(-1)?.ingestSeq ?? '0';

    const firstEventPromise = readFirstSseEvent(`${baseUrl}/events/stream?afterIngestSeq=${afterIngestSeq}`);

    await adapter.emit({
      family: 'provider_raw',
      type: 'message.received',
      connectionId,
      occurredAt: new Date('2026-04-22T11:00:00.000Z'),
      payload: {
        providerConversationId: 'alice@s.whatsapp.net',
        providerMessageId: 'live_1',
        senderId: 'alice',
        messageType: 'text',
        textBody: 'hello stream'
      }
    });

    const streamed = await firstEventPromise;
    expect(streamed).toEqual(expect.objectContaining({
      eventType: 'message.mirrored',
      eventFamily: 'normalized',
      payload: expect.objectContaining({ providerMessageId: 'live_1' })
    }));
  });
});

class StreamProviderAdapterStub implements ProviderAdapter {
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
  async requestHistoryPage(): Promise<ProviderHistoryPage> {
    return { messages: [], nextAnchor: null };
  }
  async sendTextMessage(): Promise<ProviderSendResult> {
    return { providerMessageId: 'sent_1', providerTimestamp: new Date('2026-04-22T10:00:00.000Z') };
  }
  async sendAttachmentMessage(): Promise<ProviderSendResult> {
    return { providerMessageId: 'sent_attachment_1', providerTimestamp: new Date('2026-04-22T10:01:00.000Z') };
  }
  async fetchAttachment(): Promise<ProviderAttachmentFetchResult> {
    return { fileName: 'file.txt', mimeType: 'text/plain', data: Buffer.from('hello') };
  }
}

async function readFirstSseEvent(url: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'GET',
      headers: {
        accept: 'text/event-stream',
        'x-tenant-id': tenantId
      }
    }, (response) => {
      let buffer = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        buffer += chunk;
        const index = buffer.indexOf('\n\n');
        if (index === -1) {
          return;
        }
        const rawEvent = buffer.slice(0, index);
        if (rawEvent.startsWith(':')) {
          buffer = buffer.slice(index + 2);
          return;
        }
        const dataLine = rawEvent.split('\n').find((line) => line.startsWith('data: '));
        if (!dataLine) {
          return;
        }
        req.destroy();
        resolve(JSON.parse(dataLine.slice(6)) as Record<string, unknown>);
      });
      response.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
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
