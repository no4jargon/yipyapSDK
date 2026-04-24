import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DisconnectReason, type ConnectionState, type WAMessage, type WASocket } from '@whiskeysockets/baileys';
import type { ProviderAdapter } from '../../packages/provider-adapter-interface/src';
import { createBaileysWhatsAppLinkedProviderAdapter, createWhatsAppLinkedProviderAdapter } from '../../packages/provider-whatsapp-linked/src';
import { createStructuredLogger } from '../../packages/query-api/src/operational';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe('whatsapp linked live adapter factory', () => {
  it('requires an auth directory when smoke mode is explicitly enabled', async () => {
    process.env.YIPYAP_ENABLE_WHATSAPP_LINKED_SMOKE = '1';
    delete process.env.YIPYAP_WHATSAPP_AUTH_DIR;

    await expect(
      createWhatsAppLinkedProviderAdapter({ mode: 'smoke', allowSmoke: true })
    ).rejects.toMatchObject({
      code: 'invalid_argument'
    });
  });

  it('builds a live adapter from environment-backed smoke configuration', async () => {
    process.env.YIPYAP_ENABLE_WHATSAPP_LINKED_SMOKE = '1';
    process.env.YIPYAP_WHATSAPP_AUTH_DIR = '/tmp/yipyap-whatsapp-auth';
    process.env.YIPYAP_WHATSAPP_DEVICE_LABEL = 'YipYap Dev';

    const fakeAdapter: ProviderAdapter = {
      createSession: vi.fn(async () => {}),
      getConnectionBootstrapState: vi.fn(async () => ({ status: 'pending' as const })),
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
      listDiscoveredConversations: vi.fn(async () => []),
      subscribe: vi.fn(async () => async () => {}),
      requestHistoryPage: vi.fn(async () => ({ messages: [], nextAnchor: null })),
      sendTextMessage: vi.fn(async () => ({ providerMessageId: 'pm_1', providerTimestamp: new Date('2026-01-01T00:00:00.000Z') })),
      sendAttachmentMessage: vi.fn(async () => ({ providerMessageId: 'pa_1', providerTimestamp: new Date('2026-01-01T00:00:00.000Z') })),
      fetchAttachment: vi.fn(async () => ({ mimeType: 'text/plain', fileName: 'file.txt', data: Buffer.from('ok') }))
    };

    const createLiveAdapter = vi.fn(async (input: { authDir: string; deviceLabel: string | null }) => {
      expect(input).toEqual({
        authDir: '/tmp/yipyap-whatsapp-auth',
        deviceLabel: 'YipYap Dev'
      });
      return fakeAdapter;
    });

    await expect(
      createWhatsAppLinkedProviderAdapter({ mode: 'smoke', allowSmoke: true, createLiveAdapter })
    ).resolves.toBe(fakeAdapter);

    expect(createLiveAdapter).toHaveBeenCalledTimes(1);
  });

  it('restarts the live socket when WhatsApp requires a restart after pairing and hydrates conversations from history sync', async () => {
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
        logger: { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return this; } } as never
      }
    );

    await adapter.createSession({ connectionId: 'conn_1' });

    expect(sockets).toHaveLength(1);
    sockets[0].emitConnectionUpdate({ qr: 'qr_1' });

    await expect(adapter.getConnectionBootstrapState('conn_1')).resolves.toMatchObject({
      status: 'qr_ready',
      qrPayload: 'qr_1'
    });

    sockets[0].emitConnectionUpdate({
      connection: 'close',
      lastDisconnect: {
        error: { output: { statusCode: DisconnectReason.restartRequired } } as unknown as Error,
        date: new Date('2026-01-01T00:00:00.000Z')
      }
    });

    await waitFor(() => sockets.length === 2);

    sockets[1].groupMetadata = {
      '123-456@g.us': {
        id: '123-456@g.us',
        subject: 'Project Team',
        participants: []
      }
    };
    sockets[1].emitMessagingHistorySet({
      chats: [
        { id: '12345@s.whatsapp.net', name: 'Alice' },
        { id: '123-456@g.us', name: 'Project Team' }
      ],
      contacts: [
        { id: '12345@s.whatsapp.net', notify: 'Alice' }
      ],
      messages: []
    });
    sockets[1].emitConnectionUpdate({ connection: 'open' });

    await waitFor(() => sockets[1].groupFetchAllParticipatingCalls === 1);

    await expect(adapter.getConnectionBootstrapState('conn_1')).resolves.toMatchObject({
      status: 'connected'
    });

    await expect(adapter.listDiscoveredConversations('conn_1')).resolves.toMatchObject([
      {
        providerConversationId: '12345@s.whatsapp.net',
        conversationType: 'direct',
        title: 'Alice'
      },
      {
        providerConversationId: '123-456@g.us',
        conversationType: 'group',
        title: 'Project Team'
      }
    ]);
  });

  it('retries the live socket after a transient connection failure before QR is shown', async () => {
    const sockets: FakeSocket[] = [];
    const adapter = await createBaileysWhatsAppLinkedProviderAdapter(
      { authDir: '/tmp/yipyap-whatsapp-auth', deviceLabel: 'YipYap Dev' },
      {
        mkdirImpl: vi.fn(async () => {}),
        useAuthStateImpl: vi.fn(async () => ({ state: {} as unknown, saveCreds: async () => {} })),
        resolveVersionImpl: vi.fn(async () => [2, 3000, 1037799039] as [number, number, number]),
        createSocketImpl: vi.fn(() => {
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket as unknown as WASocket;
        }),
        logger: { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return this; } } as never
      }
    );

    await adapter.createSession({ connectionId: 'conn_retry' });

    expect(sockets).toHaveLength(1);
    sockets[0].emitConnectionUpdate({
      connection: 'close',
      lastDisconnect: {
        error: { output: { statusCode: 500 } } as unknown as Error,
        date: new Date('2026-01-01T00:00:00.000Z')
      }
    });

    await waitFor(() => sockets.length === 2);
    sockets[1].emitConnectionUpdate({ qr: 'qr_retry' });

    await expect(adapter.getConnectionBootstrapState('conn_retry')).resolves.toMatchObject({
      status: 'qr_ready',
      qrPayload: 'qr_retry'
    });
  });

  it('creates at most one reconnecting socket for repeated close events from the same stale socket', async () => {
    const sockets: FakeSocket[] = [];
    const adapter = await createBaileysWhatsAppLinkedProviderAdapter(
      { authDir: '/tmp/yipyap-whatsapp-auth', deviceLabel: 'YipYap Dev' },
      {
        mkdirImpl: vi.fn(async () => {}),
        useAuthStateImpl: vi.fn(async () => ({ state: {} as unknown, saveCreds: async () => {} })),
        resolveVersionImpl: vi.fn(async () => [2, 3000, 1037799039] as [number, number, number]),
        createSocketImpl: vi.fn(() => {
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket as unknown as WASocket;
        }),
        logger: { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return this; } } as never
      }
    );

    await adapter.createSession({ connectionId: 'conn_single_flight' });

    expect(sockets).toHaveLength(1);
    sockets[0].emitConnectionUpdate({
      connection: 'close',
      lastDisconnect: {
        error: { output: { statusCode: 500 } } as unknown as Error,
        date: new Date('2026-01-01T00:00:00.000Z')
      }
    });
    sockets[0].emitConnectionUpdate({
      connection: 'close',
      lastDisconnect: {
        error: { output: { statusCode: 500 } } as unknown as Error,
        date: new Date('2026-01-01T00:00:01.000Z')
      }
    });

    await waitFor(() => sockets.length === 2);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sockets).toHaveLength(2);

    sockets[0].emitConnectionUpdate({ qr: 'stale_qr' });
    sockets[1].emitConnectionUpdate({ qr: 'fresh_qr' });

    await expect(adapter.getConnectionBootstrapState('conn_single_flight')).resolves.toMatchObject({
      status: 'qr_ready',
      qrPayload: 'fresh_qr'
    });
  });

  it('ignores close events from stale sockets after a replacement socket already exists', async () => {
    const sockets: FakeSocket[] = [];
    const adapter = await createBaileysWhatsAppLinkedProviderAdapter(
      { authDir: '/tmp/yipyap-whatsapp-auth', deviceLabel: 'YipYap Dev' },
      {
        mkdirImpl: vi.fn(async () => {}),
        useAuthStateImpl: vi.fn(async () => ({ state: {} as unknown, saveCreds: async () => {} })),
        resolveVersionImpl: vi.fn(async () => [2, 3000, 1037799039] as [number, number, number]),
        createSocketImpl: vi.fn(() => {
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket as unknown as WASocket;
        }),
        logger: { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return this; } } as never
      }
    );

    await adapter.createSession({ connectionId: 'conn_stale' });

    sockets[0].emitConnectionUpdate({
      connection: 'close',
      lastDisconnect: {
        error: { output: { statusCode: 500 } } as unknown as Error,
        date: new Date('2026-01-01T00:00:00.000Z')
      }
    });

    await waitFor(() => sockets.length === 2);
    sockets[1].emitConnectionUpdate({ qr: 'fresh_qr' });

    sockets[0].emitConnectionUpdate({
      connection: 'close',
      lastDisconnect: {
        error: { output: { statusCode: 500 } } as unknown as Error,
        date: new Date('2026-01-01T00:00:02.000Z')
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sockets).toHaveLength(2);
    await expect(adapter.getConnectionBootstrapState('conn_stale')).resolves.toMatchObject({
      status: 'qr_ready',
      qrPayload: 'fresh_qr'
    });
  });

  it('ends the stale socket before reconnecting after a transient close', async () => {
    const sockets: FakeSocket[] = [];
    const adapter = await createBaileysWhatsAppLinkedProviderAdapter(
      { authDir: '/tmp/yipyap-whatsapp-auth', deviceLabel: 'YipYap Dev' },
      {
        mkdirImpl: vi.fn(async () => {}),
        useAuthStateImpl: vi.fn(async () => ({ state: {} as unknown, saveCreds: async () => {} })),
        resolveVersionImpl: vi.fn(async () => [2, 3000, 1037799039] as [number, number, number]),
        createSocketImpl: vi.fn(() => {
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket as unknown as WASocket;
        }),
        logger: { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return this; } } as never
      }
    );

    await adapter.createSession({ connectionId: 'conn_end_old_socket' });

    sockets[0].emitConnectionUpdate({
      connection: 'close',
      lastDisconnect: {
        error: { output: { statusCode: 500 } } as unknown as Error,
        date: new Date('2026-01-01T00:00:00.000Z')
      }
    });

    await waitFor(() => sockets.length === 2);
    expect(sockets[0].endCalls).toBe(1);
  });

  it('closes the smoke socket without logging out when asked for non-destructive teardown', async () => {
    const sockets: FakeSocket[] = [];
    const adapter = await createBaileysWhatsAppLinkedProviderAdapter(
      { authDir: '/tmp/yipyap-whatsapp-auth', deviceLabel: 'YipYap Dev' },
      {
        mkdirImpl: vi.fn(async () => {}),
        useAuthStateImpl: vi.fn(async () => ({ state: {} as unknown, saveCreds: async () => {} })),
        resolveVersionImpl: vi.fn(async () => [2, 3000, 1037799039] as [number, number, number]),
        createSocketImpl: vi.fn(() => {
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket as unknown as WASocket;
        }),
        logger: { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return this; } } as never
      }
    );

    await adapter.createSession({ connectionId: 'conn_close_only' });
    await (adapter as ProviderAdapter & { closeSession: (connectionId: string) => Promise<void> }).closeSession('conn_close_only');

    expect(sockets[0].endCalls).toBe(1);
    expect(sockets[0].logoutCalls).toBe(0);
    await expect(adapter.getConnectionBootstrapState('conn_close_only')).resolves.toMatchObject({ status: 'pending' });
  });

  it('hydrates direct chats from history-sync messages even when chat upserts are absent', async () => {
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
        logger: { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return this; } } as never
      }
    );

    await adapter.createSession({ connectionId: 'conn_direct' });

    sockets[0].emitMessagingHistorySet({
      chats: [],
      contacts: [],
      messages: [
        {
          key: { remoteJid: '5551234567@s.whatsapp.net', fromMe: false, id: 'msg_1' },
          messageTimestamp: 1776775000,
          pushName: 'Direct Alice'
        } as WAMessage
      ]
    });
    sockets[0].emitConnectionUpdate({ connection: 'open' });

    await expect(adapter.listDiscoveredConversations('conn_direct')).resolves.toMatchObject([
      {
        providerConversationId: '5551234567@s.whatsapp.net',
        conversationType: 'direct',
        title: 'Direct Alice'
      }
    ]);
  });

  it('pages seven days of live history backward by combining cached history with explicit fetchMessageHistory backfill', async () => {
    const sockets: FakeSocket[] = [];
    const adapter = await createBaileysWhatsAppLinkedProviderAdapter(
      { authDir: '/tmp/yipyap-whatsapp-auth', deviceLabel: 'YipYap Dev' },
      {
        mkdirImpl: vi.fn(async () => {}),
        useAuthStateImpl: vi.fn(async () => ({ state: {} as unknown, saveCreds: async () => {} })),
        resolveVersionImpl: vi.fn(async () => [2, 3000, 1027609463] as [number, number, number]),
        createSocketImpl: vi.fn(() => {
          const socket = new FakeSocket();
          socket.fetchMessageHistoryImpl = async () => {
            socket.emitMessagesUpsert({
              messages: [
                {
                  key: { remoteJid: '5551234567@s.whatsapp.net', fromMe: false, id: 'msg_window' },
                  messageTimestamp: 1767830400,
                  pushName: 'Alice',
                  message: { conversation: 'within window' }
                } as WAMessage,
                {
                  key: { remoteJid: '5551234567@s.whatsapp.net', fromMe: false, id: 'msg_old' },
                  messageTimestamp: 1767225600,
                  pushName: 'Alice',
                  message: { conversation: 'too old' }
                } as WAMessage
              ]
            });
            return 'cursor_1';
          };
          sockets.push(socket);
          return socket as unknown as WASocket;
        }),
        logger: { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return this; } } as never
      }
    );

    await adapter.createSession({ connectionId: 'conn_history' });
    sockets[0].emitMessagingHistorySet({
      chats: [],
      contacts: [],
      messages: [
        {
          key: { remoteJid: '5551234567@s.whatsapp.net', fromMe: false, id: 'msg_recent' },
          messageTimestamp: 1768003200,
          pushName: 'Alice',
          message: { conversation: 'recent hello' }
        } as WAMessage
      ]
    });
    sockets[0].emitConnectionUpdate({ connection: 'open' });

    const page = await adapter.requestHistoryPage({
      connectionId: 'conn_history',
      providerConversationId: '5551234567@s.whatsapp.net',
      pageDirection: 'backward',
      pageSizeDays: 7
    });

    expect(sockets[0].fetchMessageHistoryCalls).toHaveLength(1);
    expect(page.messages).toMatchObject([
      { providerMessageId: 'msg_window', textBody: 'within window' },
      { providerMessageId: 'msg_recent', textBody: 'recent hello' }
    ]);
    expect(page.nextAnchor).not.toBeNull();
  });

  it('fetches a live attachment from a cached media message', async () => {
    const sockets: FakeSocket[] = [];
    const downloadMediaMessageImpl = vi.fn(async () => Buffer.from('history attachment'));
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
        logger: { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return this; } } as never
      }
    );

    await adapter.createSession({ connectionId: 'conn_attachment' });
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
        } as WAMessage,
        {
          key: { remoteJid: '5551234567@s.whatsapp.net', fromMe: false, id: 'media_2' },
          messageTimestamp: 1768003201,
          pushName: 'Alice',
          message: {
            videoMessage: {
              mimetype: 'video/mp4'
            }
          }
        } as WAMessage
      ]
    });
    sockets[0].emitConnectionUpdate({ connection: 'open' });

    await expect(
      adapter.fetchAttachment({
        connectionId: 'conn_attachment',
        providerAttachmentRef: 'media_1'
      })
    ).resolves.toMatchObject({
      fileName: 'history.txt',
      mimeType: 'text/plain',
      data: Buffer.from('history attachment')
    });

    await expect(
      adapter.fetchAttachment({
        connectionId: 'conn_attachment',
        providerAttachmentRef: 'media_2'
      })
    ).resolves.toMatchObject({
      fileName: 'media_2',
      mimeType: 'video/mp4',
      data: Buffer.from('history attachment')
    });

    expect(downloadMediaMessageImpl).toHaveBeenCalledTimes(2);
  });

  it('logs connection updates and preserves qr_ready state when qr arrives asynchronously', async () => {
    const entries: Array<Record<string, unknown>> = [];
    const structuredLogger = createStructuredLogger({
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
        resolveVersionImpl: vi.fn(async () => [2, 3000, 1037799039] as [number, number, number]),
        createSocketImpl: vi.fn(() => {
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket as unknown as WASocket;
        }),
        structuredLogger,
        logger: { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return this; } } as never
      }
    );

    await adapter.createSession({ connectionId: 'conn_qr_async' });
    setTimeout(() => {
      sockets[0]?.emitConnectionUpdate({ qr: 'qr_async' });
    }, 0);

    await expect(adapter.getConnectionBootstrapState('conn_qr_async')).resolves.toMatchObject({
      status: 'qr_ready',
      qrPayload: 'qr_async'
    });

    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: 'warn',
        component: 'whatsapp-linked',
        event: 'provider.connection.update',
        connectionId: 'conn_qr_async',
        hasQr: true
      })
    ]));
  });

  it('marks the session failed and stops reconnect churn when qr bootstrap attempts are exhausted', async () => {
    const entries: Array<Record<string, unknown>> = [];
    const structuredLogger = createStructuredLogger({
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
        resolveVersionImpl: vi.fn(async () => [2, 3000, 1037799039] as [number, number, number]),
        createSocketImpl: vi.fn(() => {
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket as unknown as WASocket;
        }),
        structuredLogger,
        logger: { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return this; } } as never
      }
    );

    await adapter.createSession({ connectionId: 'conn_qr_timeout' });

    sockets[0].emitConnectionUpdate({
      connection: 'close',
      lastDisconnect: {
        error: Object.assign(new Error('QR refs attempts ended'), { output: { statusCode: 408 } }) as unknown as Error,
        date: new Date('2026-01-01T00:00:00.000Z')
      }
    });

    await expect(adapter.getConnectionBootstrapState('conn_qr_timeout')).resolves.toMatchObject({
      status: 'failed'
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sockets).toHaveLength(1);
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: 'warn',
        component: 'whatsapp-linked',
        event: 'provider.qr.bootstrap_timeout',
        connectionId: 'conn_qr_timeout',
        statusCode: 408
      })
    ]));
  });
});

class FakeSocket {
  public readonly ev = new EventEmitter();
  public groupFetchAllParticipatingCalls = 0;
  public endCalls = 0;
  public logoutCalls = 0;
  public groupMetadata: Record<string, { id: string; subject: string; participants: unknown[] }> = {};
  public fetchMessageHistoryCalls: Array<{ count: number; oldestMsgKey: unknown; oldestMsgTimestamp: number | bigint | string }> = [];
  public fetchMessageHistoryImpl: (() => Promise<string>) | null = null;

  async logout(): Promise<void> {
    this.logoutCalls += 1;
  }

  end(): void {
    this.endCalls += 1;
  }

  async sendMessage(): Promise<WAMessage | undefined> {
    return { key: { id: 'msg_1' } } as WAMessage;
  }

  async fetchMessageHistory(count: number, oldestMsgKey: unknown, oldestMsgTimestamp: number | bigint | string): Promise<string> {
    this.fetchMessageHistoryCalls.push({ count, oldestMsgKey, oldestMsgTimestamp });
    return this.fetchMessageHistoryImpl?.() ?? 'cursor';
  }

  async groupFetchAllParticipating(): Promise<Record<string, { id: string; subject: string; participants: unknown[] }>> {
    this.groupFetchAllParticipatingCalls += 1;
    return this.groupMetadata;
  }

  emitConnectionUpdate(update: Partial<ConnectionState>): void {
    this.ev.emit('connection.update', update);
  }

  emitMessagingHistorySet(event: {
    chats: Array<Record<string, unknown>>;
    contacts: Array<Record<string, unknown>>;
    messages: WAMessage[];
  }): void {
    this.ev.emit('messaging-history.set', event);
  }

  emitMessagesUpsert(event: { messages: WAMessage[] }): void {
    this.ev.emit('messages.upsert', event);
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 1000) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
