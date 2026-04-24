import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { WAMessage, WASocket } from '@whiskeysockets/baileys';
import { createBaileysWhatsAppLinkedProviderAdapter } from '../../packages/provider-whatsapp-linked/src';
import { createStructuredLogger } from '../../packages/query-api/src/operational';
import { createProviderWorkerRuntime } from '../../apps/provider-worker/src/runtime';

describe('final hardening runtime wiring', () => {
  it('retries transient history fetch failures with structured logging', async () => {
    const entries: Array<Record<string, unknown>> = [];
    const logger = createStructuredLogger({
      write(entry) {
        entries.push(entry);
      }
    });
    const sockets: FakeSocket[] = [];
    const adapter = await createBaileysWhatsAppLinkedProviderAdapter(
      { authDir: '/tmp/yipyap-whatsapp-auth', deviceLabel: 'YipYap Dev' },
      {
        mkdirImpl: vi.fn(async () => {}),
        useAuthStateImpl: vi.fn(async () => ({ state: {} as unknown, saveCreds: async () => {} })),
        resolveVersionImpl: vi.fn(async () => [2, 3000, 1027609463] as [number, number, number]),
        createSocketImpl: vi.fn(() => {
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket as unknown as WASocket;
        }),
        structuredLogger: logger,
        retryDelayMs: 0
      }
    );

    await adapter.createSession({ connectionId: 'conn_history_retry' });
    sockets[0].emitMessagingHistorySet({
      chats: [],
      contacts: [],
      messages: [
        {
          key: { remoteJid: '5551234567@s.whatsapp.net', fromMe: false, id: 'msg_recent' },
          messageTimestamp: 1768608000,
          pushName: 'Alice',
          message: { conversation: 'recent' }
        } as WAMessage
      ]
    });
    sockets[0].fetchMessageHistoryImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient history'))
      .mockResolvedValueOnce(undefined);
    sockets[0].emitConnectionUpdate({ connection: 'open' });

    await expect(
      adapter.requestHistoryPage({
        connectionId: 'conn_history_retry',
        providerConversationId: '5551234567@s.whatsapp.net',
        pageDirection: 'backward',
        pageSizeDays: 7
      })
    ).resolves.toMatchObject({
      messages: [
        { providerMessageId: 'msg_recent' }
      ]
    });

    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: 'warn',
        component: 'whatsapp-linked',
        event: 'retry.scheduled',
        operation: 'history.fetch'
      })
    ]));
  });

  it('retries transient media download failures with structured logging', async () => {
    const entries: Array<Record<string, unknown>> = [];
    const logger = createStructuredLogger({
      write(entry) {
        entries.push(entry);
      }
    });
    const sockets: FakeSocket[] = [];
    const downloadMediaMessageImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient media'))
      .mockResolvedValueOnce(Buffer.from('history attachment'));

    const adapter = await createBaileysWhatsAppLinkedProviderAdapter(
      { authDir: '/tmp/yipyap-whatsapp-auth', deviceLabel: 'YipYap Dev' },
      {
        mkdirImpl: vi.fn(async () => {}),
        useAuthStateImpl: vi.fn(async () => ({ state: {} as unknown, saveCreds: async () => {} })),
        resolveVersionImpl: vi.fn(async () => [2, 3000, 1027609463] as [number, number, number]),
        createSocketImpl: vi.fn(() => {
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket as unknown as WASocket;
        }),
        downloadMediaMessageImpl,
        structuredLogger: logger,
        retryDelayMs: 0
      }
    );

    await adapter.createSession({ connectionId: 'conn_media_retry' });
    sockets[0].emitMessagingHistorySet({
      chats: [],
      contacts: [],
      messages: [
        {
          key: { remoteJid: '5551234567@s.whatsapp.net', fromMe: false, id: 'media_1' },
          messageTimestamp: 1768003200,
          pushName: 'Alice',
          message: {
            documentMessage: {
              fileName: 'history.txt',
              mimetype: 'text/plain'
            }
          }
        } as WAMessage
      ]
    });
    sockets[0].emitConnectionUpdate({ connection: 'open' });

    await expect(
      adapter.fetchAttachment({
        connectionId: 'conn_media_retry',
        providerAttachmentRef: 'media_1'
      })
    ).resolves.toMatchObject({
      fileName: 'history.txt',
      mimeType: 'text/plain'
    });

    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: 'warn',
        component: 'whatsapp-linked',
        event: 'retry.scheduled',
        operation: 'attachment.fetch'
      })
    ]));
  });

  it('rejects provider worker jobs beyond the configured backpressure limit', async () => {
    let releaseFirst: (() => void) | null = null;
    const runtime = createProviderWorkerRuntime({
      maxInFlight: 1,
      runJob: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      })
    });

    const firstJob = runtime.execute({ jobType: 'sync', connectionId: 'conn_1' });

    await expect(runtime.execute({ jobType: 'sync', connectionId: 'conn_2' })).rejects.toMatchObject({
      code: 'precondition_failed'
    });

    const release = releaseFirst as (() => void) | null;
    if (!release) {
      throw new Error('expected first job release');
    }
    release();
    await firstJob;
  });
});

class FakeSocket {
  public readonly ev = new EventEmitter();
  public groupFetchAllParticipatingCalls = 0;
  public endCalls = 0;
  public logoutCalls = 0;
  public groupMetadata: Record<string, { id: string; subject: string; participants: unknown[] }> = {};
  public fetchMessageHistoryCalls: Array<{ count: number; oldestMsgKey: unknown; oldestMsgTimestamp: number | bigint | string }> = [];
  public fetchMessageHistoryImpl: (() => Promise<string | void>) | null = null;

  async logout(): Promise<void> {
    this.logoutCalls += 1;
  }

  end(): void {
    this.endCalls += 1;
  }

  async sendMessage(): Promise<WAMessage | undefined> {
    return { key: { id: 'msg_1' } } as WAMessage;
  }

  async fetchMessageHistory(count: number, oldestMsgKey: unknown, oldestMsgTimestamp: number | bigint | string): Promise<string | void> {
    this.fetchMessageHistoryCalls.push({ count, oldestMsgKey, oldestMsgTimestamp });
    return this.fetchMessageHistoryImpl?.() ?? 'cursor';
  }

  async groupFetchAllParticipating(): Promise<Record<string, { id: string; subject: string; participants: unknown[] }>> {
    this.groupFetchAllParticipatingCalls += 1;
    return this.groupMetadata;
  }

  emitConnectionUpdate(update: { connection?: 'open' | 'close'; qr?: string; lastDisconnect?: { error?: { output?: { statusCode?: number } } } }): void {
    this.ev.emit('connection.update', update);
  }

  emitMessagingHistorySet(event: {
    chats: Array<Record<string, unknown>>;
    contacts: Array<Record<string, unknown>>;
    messages: WAMessage[];
  }): void {
    this.ev.emit('messaging-history.set', event);
  }
}
