import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  useMultiFileAuthState,
  type AnyMessageContent,
  type ConnectionState,
  type WASocket,
  type WAMessage,
  type WAVersion
} from '@whiskeysockets/baileys';
import pino, { type Logger } from 'pino';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { AppError } from '../../query-api/src/errors';
import { createStructuredLogger, retryWithBackoff, type StructuredLogger } from '../../query-api/src/operational';
import { createFakeProviderAdapter } from '../../provider-adapter-interface/src/fake-provider-adapter';
import type {
  ConnectionBootstrapStatus,
  ProviderAdapter,
  ProviderAttachmentFetchResult,
  ProviderAttachmentSource,
  ProviderConversation,
  ProviderConversationParticipant,
  ProviderHistoryAnchor,
  ProviderHistoryPage,
  ProviderRawEvent,
  ProviderSendResult
} from '../../provider-adapter-interface/src';

export interface WhatsAppLinkedProviderAdapterOptions {
  mode: 'contract-test' | 'smoke';
  allowSmoke?: boolean;
  createLiveAdapter?: (input: { authDir: string; deviceLabel: string | null }) => Promise<ProviderAdapter>;
}

export interface SmokeCloseableProviderAdapter extends ProviderAdapter {
  closeSession(connectionId: string): Promise<void>;
}

interface SessionState {
  status: ConnectionBootstrapStatus;
  qrPayload?: string;
  socket: WASocket | null;
  connectPromise: Promise<SessionState> | null;
  reconnectScheduled: boolean;
  generation: number;
  unsubscribers: Array<() => void>;
  subscribers: Set<(event: ProviderRawEvent) => Promise<void>>;
  contacts: Map<string, { displayName: string | null; phoneE164: string | null }>;
  conversations: Map<string, ProviderConversation>;
  messagesByConversation: Map<string, Map<string, WAMessage>>;
  attachmentsByMessageId: Map<string, WAMessage>;
  bootstrapWaiters: Array<() => void>;
}

export async function createWhatsAppLinkedProviderAdapter(
  options: WhatsAppLinkedProviderAdapterOptions
): Promise<ProviderAdapter> {
  if (options.mode === 'contract-test') {
    return createFakeProviderAdapter();
  }

  if (options.allowSmoke !== true) {
    throw new AppError(
      'precondition_failed',
      'live whatsapp linked smoke setup requires allowSmoke=true'
    );
  }

  if (process.env.YIPYAP_ENABLE_WHATSAPP_LINKED_SMOKE !== '1') {
    throw new AppError(
      'precondition_failed',
      'live whatsapp linked smoke setup requires YIPYAP_ENABLE_WHATSAPP_LINKED_SMOKE=1'
    );
  }

  const authDir = process.env.YIPYAP_WHATSAPP_AUTH_DIR;
  if (!authDir) {
    throw new AppError('invalid_argument', 'YIPYAP_WHATSAPP_AUTH_DIR is required for live whatsapp smoke mode');
  }

  const deviceLabel = process.env.YIPYAP_WHATSAPP_DEVICE_LABEL ?? null;
  if (options.createLiveAdapter) {
    return options.createLiveAdapter({ authDir, deviceLabel });
  }

  return createBaileysWhatsAppLinkedProviderAdapter({ authDir, deviceLabel });
}

interface BaileysAdapterDeps {
  mkdirImpl: (path: string, options: { recursive: true }) => Promise<unknown>;
  useAuthStateImpl: (folder: string) => Promise<{ state: unknown; saveCreds: () => Promise<void> }>;
  resolveVersionImpl: (logger: Logger<string>) => Promise<WAVersion>;
  createSocketImpl: (config: any) => WASocket;
  downloadMediaMessageImpl: (message: WAMessage, type: 'buffer') => Promise<Buffer>;
  logger: Logger<string>;
  structuredLogger: StructuredLogger;
  retryDelayMs: number;
  bootstrapWaitMs: number;
}

export async function createBaileysWhatsAppLinkedProviderAdapter(
  input: { authDir: string; deviceLabel: string | null },
  deps?: Partial<BaileysAdapterDeps>
): Promise<SmokeCloseableProviderAdapter> {
  const sessions = new Map<string, SessionState>();
  const inputAuth = {
    authDir: input.authDir,
    deviceLabel: input.deviceLabel ?? 'YipYap Dev'
  };
  const basePinoLogger = deps?.logger ?? (pino({ level: process.env.YIPYAP_WHATSAPP_LOG_LEVEL ?? 'info' }) as Logger<string>);
  const structuredLogger = (deps?.structuredLogger ?? createStructuredLogger({
    write(entry) {
      basePinoLogger.warn(entry);
    }
  })).child({ component: 'whatsapp-linked' });
  const resolvedDeps: BaileysAdapterDeps = {
    mkdirImpl: deps?.mkdirImpl ?? mkdir,
    useAuthStateImpl: deps?.useAuthStateImpl ?? useMultiFileAuthState,
    resolveVersionImpl: deps?.resolveVersionImpl ?? resolveWhatsAppWebVersion,
    createSocketImpl: deps?.createSocketImpl ?? ((config) => makeWASocket(config)),
    downloadMediaMessageImpl: deps?.downloadMediaMessageImpl ?? (async (message, type) => downloadMediaMessage(message, type, {})),
    logger: basePinoLogger,
    structuredLogger,
    retryDelayMs: deps?.retryDelayMs ?? 250,
    bootstrapWaitMs: deps?.bootstrapWaitMs ?? 3000
  };

  return {
    async createSession({ connectionId }): Promise<void> {
      await ensureSession({ connectionId, sessions, baseAuthDir: inputAuth.authDir, deviceLabel: inputAuth.deviceLabel, deps: resolvedDeps });
    },

    async getConnectionBootstrapState(connectionId) {
      const session = sessions.get(connectionId);
      if (!session) {
        return { status: 'pending' as const };
      }
      if (session.status === 'connecting' && !session.qrPayload) {
        await waitForBootstrapProgress(session, resolvedDeps.bootstrapWaitMs);
      }
      return session.qrPayload
        ? { status: session.status, qrPayload: session.qrPayload }
        : { status: session.status };
    },

    async connect(connectionId): Promise<void> {
      await ensureSession({ connectionId, sessions, baseAuthDir: inputAuth.authDir, deviceLabel: inputAuth.deviceLabel, deps: resolvedDeps });
    },

    async disconnect(connectionId): Promise<void> {
      const session = sessions.get(connectionId);
      if (!session?.socket) {
        sessions.set(connectionId, createEmptySession());
        return;
      }
      const socket = session.socket;
      cleanupSession(session);
      session.socket = null;
      await socket.logout();
      sessions.set(connectionId, createEmptySession());
    },

    async closeSession(connectionId): Promise<void> {
      const session = sessions.get(connectionId);
      if (!session?.socket) {
        sessions.set(connectionId, createEmptySession());
        return;
      }
      closeSocket(session, session.socket);
      sessions.set(connectionId, createEmptySession());
    },

    async listDiscoveredConversations(connectionId): Promise<ProviderConversation[]> {
      const session = await ensureSession({ connectionId, sessions, baseAuthDir: inputAuth.authDir, deviceLabel: inputAuth.deviceLabel, deps: resolvedDeps });
      return Array.from(session.conversations.values()).map(cloneConversation);
    },

    async subscribe(connectionId, onEvent) {
      const session = await ensureSession({ connectionId, sessions, baseAuthDir: inputAuth.authDir, deviceLabel: inputAuth.deviceLabel, deps: resolvedDeps });
      session.subscribers.add(onEvent);
      return async () => {
        session.subscribers.delete(onEvent);
      };
    },

    async requestHistoryPage(input): Promise<ProviderHistoryPage> {
      const session = await requireConnectedSession({
        connectionId: input.connectionId,
        sessions,
        baseAuthDir: inputAuth.authDir,
        deviceLabel: inputAuth.deviceLabel,
        deps: resolvedDeps
      });
      return retryOperation({
        logger: resolvedDeps.structuredLogger,
        retryDelayMs: resolvedDeps.retryDelayMs,
        operation: 'history.fetch',
        fn: async () => requestHistoryPageFromSession(session, input)
      });
    },

    async sendTextMessage(input): Promise<ProviderSendResult> {
      const session = await requireConnectedSession({
        connectionId: input.connectionId,
        sessions,
        baseAuthDir: inputAuth.authDir,
        deviceLabel: inputAuth.deviceLabel,
        deps: resolvedDeps
      });
      const result = await session.socket!.sendMessage(input.providerConversationId, { text: input.text });
      return mapSendResult(result);
    },

    async sendAttachmentMessage(input): Promise<ProviderSendResult> {
      const session = await requireConnectedSession({
        connectionId: input.connectionId,
        sessions,
        baseAuthDir: inputAuth.authDir,
        deviceLabel: inputAuth.deviceLabel,
        deps: resolvedDeps
      });
      const result = await session.socket!.sendMessage(input.providerConversationId, toMediaContent(input.attachmentSource, input.caption));
      return mapSendResult(result);
    },

    async fetchAttachment(input): Promise<ProviderAttachmentFetchResult> {
      const session = await requireConnectedSession({
        connectionId: input.connectionId,
        sessions,
        baseAuthDir: inputAuth.authDir,
        deviceLabel: inputAuth.deviceLabel,
        deps: resolvedDeps
      });
      const message = session.attachmentsByMessageId.get(input.providerAttachmentRef);
      if (!message) {
        throw new AppError('not_found', `attachment ${input.providerAttachmentRef} was not found in live message cache`);
      }
      const descriptor = getMessageAttachmentDescriptor(message);
      if (!descriptor) {
        throw new AppError('unsupported', `message ${input.providerAttachmentRef} does not contain a supported attachment`);
      }
      const data = await retryOperation({
        logger: resolvedDeps.structuredLogger,
        retryDelayMs: resolvedDeps.retryDelayMs,
        operation: 'attachment.fetch',
        fn: async () => resolvedDeps.downloadMediaMessageImpl(message, 'buffer')
      });
      return {
        mimeType: descriptor.mimeType,
        fileName: descriptor.fileName,
        data
      };
    }
  };
}

async function ensureSession(input: {
  connectionId: string;
  sessions: Map<string, SessionState>;
  baseAuthDir: string;
  deviceLabel: string;
  deps: BaileysAdapterDeps;
}): Promise<SessionState> {
  const existing = input.sessions.get(input.connectionId);
  if (existing?.socket) {
    return existing;
  }
  if (existing?.connectPromise) {
    return existing.connectPromise;
  }

  const session = existing ?? createEmptySession();
  input.sessions.set(input.connectionId, session);

  const connectPromise = (async () => {
    const authDir = path.join(input.baseAuthDir, input.connectionId);
    await input.deps.mkdirImpl(authDir, { recursive: true });
    const { state, saveCreds } = await input.deps.useAuthStateImpl(authDir);
    session.status = 'connecting';
    session.qrPayload = undefined;
    session.generation += 1;

    const generation = session.generation;
    const version = await input.deps.resolveVersionImpl(input.deps.logger);
    const socket = input.deps.createSocketImpl({
      auth: state,
      logger: input.deps.logger,
      version,
      browser: Browsers.macOS('Desktop'),
      syncFullHistory: true,
      markOnlineOnConnect: false
    });

    session.socket = socket;

    session.unsubscribers.push(registerSocketEvent(socket, 'creds.update', async () => {
      if (!isCurrentSocket(session, socket, generation)) {
        return;
      }
      await saveCreds();
    }));
    session.unsubscribers.push(registerSocketEvent(socket, 'messaging-history.set', async (event: {
      chats: Array<Record<string, unknown>>;
      contacts: Array<Record<string, unknown>>;
      messages?: WAMessage[];
    }) => {
      if (!isCurrentSocket(session, socket, generation)) {
        return;
      }
      upsertContacts(session, event.contacts);
      upsertChats(session, event.chats);
      cacheMessages(session, event.messages ?? []);
      upsertConversationsFromMessages(session, event.messages ?? []);
      await emitRaw(session, {
        family: 'provider_raw',
        type: 'messaging-history.set',
        connectionId: input.connectionId,
        occurredAt: new Date(),
        payload: { chats: safeJson(event.chats), contacts: safeJson(event.contacts), messages: safeJson(event.messages ?? []) }
      });
    }));
    session.unsubscribers.push(registerSocketEvent(socket, 'messages.upsert', async (event: { messages?: WAMessage[] }) => {
      if (!isCurrentSocket(session, socket, generation)) {
        return;
      }
      cacheMessages(session, event.messages ?? []);
      upsertConversationsFromMessages(session, event.messages ?? []);
      await emitRaw(session, {
        family: 'provider_raw',
        type: 'messages.upsert',
        connectionId: input.connectionId,
        occurredAt: new Date(),
        payload: { messages: safeJson(event.messages ?? []) }
      });
    }));
    session.unsubscribers.push(registerSocketEvent(socket, 'connection.update', async (update: Partial<ConnectionState>) => {
      if (!isCurrentSocket(session, socket, generation)) {
        return;
      }

      const statusCode = getDisconnectStatusCode(update);
      input.deps.structuredLogger.warn({
        event: 'provider.connection.update',
        connectionId: input.connectionId,
        connection: update.connection ?? null,
        hasQr: typeof update.qr === 'string' && update.qr.length > 0,
        statusCode
      });

      if (update.qr) {
        session.status = 'qr_ready';
        session.qrPayload = update.qr;
        notifyBootstrapProgress(session);
      }

      if (update.connection === 'open') {
        session.status = 'connected';
        session.qrPayload = undefined;
        notifyBootstrapProgress(session);
        await retryOperation({
          logger: input.deps.structuredLogger,
          retryDelayMs: input.deps.retryDelayMs,
          operation: 'groups.hydrate',
          fn: async () => {
            await hydrateGroups(session);
          }
        });
      }

      if (update.connection === 'close') {
        closeSocket(session, socket);
        if (statusCode === DisconnectReason.loggedOut) {
          session.status = 'reauth_required';
          session.qrPayload = undefined;
          notifyBootstrapProgress(session);
          return;
        }
        if (isQrBootstrapTimeout(update, statusCode)) {
          session.status = 'failed';
          session.qrPayload = undefined;
          input.deps.structuredLogger.warn({
            event: 'provider.qr.bootstrap_timeout',
            connectionId: input.connectionId,
            statusCode
          });
          notifyBootstrapProgress(session);
          return;
        }

        input.deps.structuredLogger.warn({
          event: 'provider.connection.closed',
          connectionId: input.connectionId,
          statusCode
        });
        session.status = 'connecting';
        session.qrPayload = undefined;
        notifyBootstrapProgress(session);
        scheduleReconnect(session, input);
      }
    }));

    return session;
  })();

  session.connectPromise = connectPromise;

  try {
    return await connectPromise;
  } finally {
    if (session.connectPromise === connectPromise) {
      session.connectPromise = null;
    }
  }
}

async function requireConnectedSession(input: {
  connectionId: string;
  sessions: Map<string, SessionState>;
  baseAuthDir: string;
  deviceLabel: string;
  deps: BaileysAdapterDeps;
}): Promise<SessionState> {
  const session = await ensureSession(input);
  if (session.status !== 'connected' || !session.socket) {
    throw new AppError('precondition_failed', `connection ${input.connectionId} is not connected`);
  }
  return session;
}

function createEmptySession(): SessionState {
  return {
    status: 'pending',
    socket: null,
    connectPromise: null,
    reconnectScheduled: false,
    generation: 0,
    unsubscribers: [],
    subscribers: new Set(),
    contacts: new Map(),
    conversations: new Map(),
    messagesByConversation: new Map(),
    attachmentsByMessageId: new Map(),
    bootstrapWaiters: []
  };
}

function cleanupSession(session: SessionState): void {
  for (const unsubscribe of session.unsubscribers.splice(0)) {
    unsubscribe();
  }
}

function notifyBootstrapProgress(session: SessionState): void {
  for (const waiter of session.bootstrapWaiters.splice(0)) {
    waiter();
  }
}

async function waitForBootstrapProgress(session: SessionState, timeoutMs: number): Promise<void> {
  if (session.status !== 'connecting' || session.qrPayload) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      session.bootstrapWaiters = session.bootstrapWaiters.filter((waiter) => waiter !== onProgress);
      resolve();
    }, timeoutMs);
    const onProgress = () => {
      clearTimeout(timeout);
      resolve();
    };
    session.bootstrapWaiters.push(onProgress);
  });
}

function isCurrentSocket(session: SessionState, socket: WASocket, generation: number): boolean {
  return session.socket === socket && session.generation === generation;
}

function closeSocket(session: SessionState, socket: WASocket): void {
  if (session.socket !== socket) {
    return;
  }

  cleanupSession(session);
  session.socket = null;
  socket.end(undefined);
}

function scheduleReconnect(
  session: SessionState,
  input: {
    connectionId: string;
    sessions: Map<string, SessionState>;
    baseAuthDir: string;
    deviceLabel: string;
    deps: BaileysAdapterDeps;
  }
): void {
  if (session.reconnectScheduled || session.connectPromise || session.socket) {
    return;
  }

  session.reconnectScheduled = true;
  queueMicrotask(() => {
    session.reconnectScheduled = false;
    if (session.socket || session.connectPromise) {
      return;
    }
    void ensureSession(input);
  });
}

function registerSocketEvent<T>(socket: WASocket, eventName: string, handler: (value: T) => void | Promise<void>): () => void {
  const emitter = socket.ev as { on: (event: string, handler: (value: T) => void) => void; off?: (event: string, handler: (value: T) => void) => void; removeListener?: (event: string, handler: (value: T) => void) => void };
  const wrapped = (value: T) => {
    void handler(value);
  };
  emitter.on(eventName, wrapped);
  return () => {
    if (emitter.off) {
      emitter.off(eventName, wrapped);
      return;
    }
    emitter.removeListener?.(eventName, wrapped);
  };
}

async function hydrateGroups(session: SessionState): Promise<void> {
  const groupFetch = (session.socket as unknown as { groupFetchAllParticipating?: () => Promise<Record<string, { id: string; subject: string; participants: Array<Record<string, unknown>> }>> }).groupFetchAllParticipating;
  if (!groupFetch) {
    return;
  }
  const groups = await groupFetch.call(session.socket);
  for (const group of Object.values(groups)) {
    session.conversations.set(group.id, {
      providerConversationId: group.id,
      conversationType: 'group',
      title: group.subject,
      participants: Array.isArray(group.participants)
        ? group.participants.map(mapGroupParticipant).filter((value) => value !== null)
        : []
    });
  }
}

function upsertContacts(session: SessionState, contacts: Array<Record<string, unknown>>): void {
  for (const contact of contacts) {
    const id = typeof contact.id === 'string' ? contact.id : null;
    if (!id) {
      continue;
    }
    session.contacts.set(id, {
      displayName: firstString(contact.notify, contact.name, contact.verifiedName),
      phoneE164: null
    });
  }
}

function upsertChats(session: SessionState, chats: Array<Record<string, unknown>>): void {
  for (const chat of chats) {
    const id = typeof chat.id === 'string' ? chat.id : null;
    if (!id) {
      continue;
    }
    const existing = session.conversations.get(id);
    session.conversations.set(id, {
      providerConversationId: id,
      conversationType: inferConversationType(id),
      title: firstString(chat.name, chat.subject, existing?.title, session.contacts.get(id)?.displayName, id) ?? id,
      participants: existing?.participants
    });
  }
}

function upsertConversationsFromMessages(session: SessionState, messages: WAMessage[]): void {
  for (const message of messages) {
    const remoteJid = typeof message.key?.remoteJid === 'string' ? message.key.remoteJid : null;
    if (!remoteJid) {
      continue;
    }
    const existing = session.conversations.get(remoteJid);
    session.conversations.set(remoteJid, {
      providerConversationId: remoteJid,
      conversationType: inferConversationType(remoteJid),
      title: firstString(existing?.title, message.pushName, session.contacts.get(remoteJid)?.displayName, remoteJid) ?? remoteJid,
      participants: existing?.participants
    });
  }
}

function cacheMessages(session: SessionState, messages: WAMessage[]): void {
  for (const message of messages) {
    const remoteJid = typeof message.key?.remoteJid === 'string' ? message.key.remoteJid : null;
    const messageId = typeof message.key?.id === 'string' ? message.key.id : null;
    if (!remoteJid || !messageId) {
      continue;
    }
    const conversationMessages = session.messagesByConversation.get(remoteJid) ?? new Map<string, WAMessage>();
    conversationMessages.set(messageId, message);
    session.messagesByConversation.set(remoteJid, conversationMessages);
    if (getMessageAttachmentDescriptor(message)) {
      session.attachmentsByMessageId.set(messageId, message);
    }
  }
}

async function requestHistoryPageFromSession(
  session: SessionState,
  input: {
    providerConversationId: string;
    anchor?: ProviderHistoryAnchor;
    pageDirection: 'backward';
    pageSizeDays: 7;
  }
): Promise<ProviderHistoryPage> {
  if (input.pageDirection !== 'backward' || input.pageSizeDays !== 7) {
    throw new AppError('unsupported', 'live whatsapp adapter only supports seven-day backward history pages');
  }

  const initialMessages = getConversationMessages(session, input.providerConversationId);
  const pageEnd = getPageEnd(input.anchor, initialMessages);
  const pageStart = pageEnd - 7 * 24 * 60 * 60 * 1000;

  const oldestMessage = initialMessages[0] ?? null;
  const fetchMessageHistory = (session.socket as unknown as {
    fetchMessageHistory?: (count: number, oldestMsgKey: unknown, oldestMsgTimestamp: number) => Promise<unknown>;
  }).fetchMessageHistory;
  if (fetchMessageHistory && oldestMessage && getMessageTimestampMs(oldestMessage) > pageStart) {
    await fetchMessageHistory.call(
      session.socket,
      50,
      oldestMessage.key,
      Math.floor(getMessageTimestampMs(oldestMessage) / 1000)
    );
  }

  const allMessages = getConversationMessages(session, input.providerConversationId);
  const pageMessages = allMessages
    .filter((message) => {
      const timestamp = getMessageTimestampMs(message);
      return timestamp <= pageEnd && timestamp >= pageStart;
    })
    .map(toProviderHistoryMessage);

  const hasOlderMessages = allMessages.some((message) => getMessageTimestampMs(message) < pageStart);
  return {
    messages: pageMessages,
    nextAnchor: hasOlderMessages ? { cursor: String(pageStart - 1) } : null
  };
}

function getConversationMessages(session: SessionState, providerConversationId: string): WAMessage[] {
  return Array.from(session.messagesByConversation.get(providerConversationId)?.values() ?? [])
    .filter((message) => Boolean(message.key?.id) && getMessageTimestampMs(message) > 0)
    .sort((left, right) => getMessageTimestampMs(left) - getMessageTimestampMs(right));
}

function getPageEnd(anchor: ProviderHistoryAnchor | undefined, messages: WAMessage[]): number {
  if (anchor) {
    const parsed = Number(anchor.cursor);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return messages[messages.length - 1] ? getMessageTimestampMs(messages[messages.length - 1]) : Date.now();
}

function getMessageTimestampMs(message: WAMessage): number {
  const candidate = message.messageTimestamp;
  if (typeof candidate === 'number' && Number.isFinite(candidate)) {
    return candidate * 1000;
  }
  if (typeof candidate === 'bigint') {
    return Number(candidate) * 1000;
  }
  if (typeof candidate === 'string') {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) {
      return parsed * 1000;
    }
  }
  return 0;
}

function toProviderHistoryMessage(message: WAMessage) {
  const remoteJid = typeof message.key?.remoteJid === 'string' ? message.key.remoteJid : 'unknown';
  const descriptor = getMessageDescriptor(message);
  return {
    providerMessageId: message.key?.id ?? 'unknown',
    providerConversationId: remoteJid,
    senderId: typeof message.key?.participant === 'string' ? message.key.participant : remoteJid,
    sentAt: new Date(getMessageTimestampMs(message)),
    messageType: descriptor.messageType,
    textBody: descriptor.textBody,
    attachmentRef: descriptor.attachmentRef,
    fileName: descriptor.fileName
  };
}

function getMessageDescriptor(message: WAMessage): {
  messageType: 'text' | 'image' | 'document' | 'unknown';
  textBody?: string;
  attachmentRef?: string;
  fileName?: string;
} {
  const content = message.message as Record<string, unknown> | undefined;
  if (typeof content?.conversation === 'string') {
    return { messageType: 'text', textBody: content.conversation };
  }
  const extendedText = asRecord(content?.extendedTextMessage);
  if (typeof extendedText?.text === 'string') {
    return { messageType: 'text', textBody: extendedText.text };
  }
  const image = asRecord(content?.imageMessage);
  if (image) {
    return {
      messageType: 'image',
      textBody: typeof image.caption === 'string' ? image.caption : undefined,
      attachmentRef: message.key?.id ?? undefined,
      fileName: typeof image.fileName === 'string' ? image.fileName : undefined
    };
  }
  const video = asRecord(content?.videoMessage);
  if (video) {
    return {
      messageType: 'document',
      textBody: typeof video.caption === 'string' ? video.caption : undefined,
      attachmentRef: message.key?.id ?? undefined,
      fileName: typeof video.fileName === 'string' ? video.fileName : undefined
    };
  }
  const audio = asRecord(content?.audioMessage);
  if (audio) {
    return {
      messageType: 'document',
      attachmentRef: message.key?.id ?? undefined,
      fileName: typeof audio.fileName === 'string' ? audio.fileName : undefined
    };
  }
  const document = asRecord(content?.documentMessage);
  if (document) {
    return {
      messageType: 'document',
      attachmentRef: message.key?.id ?? undefined,
      fileName: typeof document.fileName === 'string' ? document.fileName : undefined
    };
  }
  return { messageType: 'unknown' };
}

function getMessageAttachmentDescriptor(message: WAMessage): { mimeType: string; fileName: string } | null {
  const content = message.message as Record<string, unknown> | undefined;
  const image = asRecord(content?.imageMessage);
  if (image) {
    return {
      mimeType: typeof image.mimetype === 'string' ? image.mimetype : 'image/jpeg',
      fileName: typeof image.fileName === 'string' ? image.fileName : (message.key?.id ?? 'image')
    };
  }
  const video = asRecord(content?.videoMessage);
  if (video) {
    return {
      mimeType: typeof video.mimetype === 'string' ? video.mimetype : 'video/mp4',
      fileName: typeof video.fileName === 'string' ? video.fileName : (message.key?.id ?? 'video')
    };
  }
  const audio = asRecord(content?.audioMessage);
  if (audio) {
    return {
      mimeType: typeof audio.mimetype === 'string' ? audio.mimetype : 'audio/ogg',
      fileName: typeof audio.fileName === 'string' ? audio.fileName : (message.key?.id ?? 'audio')
    };
  }
  const document = asRecord(content?.documentMessage);
  if (document) {
    return {
      mimeType: typeof document.mimetype === 'string' ? document.mimetype : 'application/octet-stream',
      fileName: typeof document.fileName === 'string' ? document.fileName : (message.key?.id ?? 'attachment')
    };
  }
  return null;
}

function inferConversationType(jid: string): ProviderConversation['conversationType'] {
  if (jid.endsWith('@g.us')) {
    return 'group';
  }
  if (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid')) {
    return 'direct';
  }
  return 'unknown';
}

function mapGroupParticipant(candidate: Record<string, unknown>): ProviderConversationParticipant | null {
  const id = typeof candidate.id === 'string' ? candidate.id : null;
  if (!id) {
    return null;
  }
  return {
    providerParticipantId: id,
    displayName: firstString(candidate.notify, candidate.name, id),
    phoneE164: null,
    isSelf: Boolean(candidate.admin === 'superadmin' && false)
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function firstString(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

async function emitRaw(session: SessionState, event: ProviderRawEvent): Promise<void> {
  for (const subscriber of session.subscribers) {
    await subscriber(event);
  }
}

function mapSendResult(result: WAMessage | undefined): ProviderSendResult {
  return {
    providerMessageId: result?.key?.id ?? 'unknown',
    providerTimestamp: new Date()
  };
}

function toMediaContent(source: ProviderAttachmentSource, caption?: string): AnyMessageContent {
  if (source.mimeType.startsWith('image/')) {
    return { image: source.data, caption } as AnyMessageContent;
  }
  if (source.mimeType.startsWith('video/')) {
    return { video: source.data, caption } as AnyMessageContent;
  }
  if (source.mimeType.startsWith('audio/')) {
    return { audio: source.data, mimetype: source.mimeType } as AnyMessageContent;
  }
  return { document: source.data, fileName: source.fileName, mimetype: source.mimeType, caption } as AnyMessageContent;
}

async function retryOperation<T>(input: {
  logger: StructuredLogger;
  retryDelayMs: number;
  operation: string;
  fn: () => Promise<T>;
}): Promise<T> {
  return retryWithBackoff({
    logger: input.logger.child({ operation: input.operation }),
    maxAttempts: 2,
    delayMs: input.retryDelayMs,
    shouldRetry(error) {
      return !(error instanceof AppError);
    },
    operation: input.fn
  });
}

function safeJson(value: unknown): Record<string, unknown> | unknown[] {
  return JSON.parse(JSON.stringify(value ?? null)) as Record<string, unknown> | unknown[];
}

function cloneConversation(conversation: ProviderConversation): ProviderConversation {
  return {
    providerConversationId: conversation.providerConversationId,
    conversationType: conversation.conversationType,
    title: conversation.title,
    participants: conversation.participants?.map((participant) => ({ ...participant }))
  };
}

function getDisconnectStatusCode(update: Partial<ConnectionState>): number | null {
  const lastDisconnect = update.lastDisconnect as { error?: { output?: { statusCode?: number } } } | undefined;
  return typeof lastDisconnect?.error?.output?.statusCode === 'number' ? lastDisconnect.error.output.statusCode : null;
}

function isQrBootstrapTimeout(update: Partial<ConnectionState>, statusCode: number | null): boolean {
  if (statusCode !== 408) {
    return false;
  }
  const message = getDisconnectErrorMessage(update);
  return message.includes('qr refs attempts ended');
}

function getDisconnectErrorMessage(update: Partial<ConnectionState>): string {
  const lastDisconnect = update.lastDisconnect as { error?: unknown } | undefined;
  const error = lastDisconnect?.error;
  if (error instanceof Error) {
    return error.message.toLowerCase();
  }
  return String(error ?? '').toLowerCase();
}

async function resolveWhatsAppWebVersion(logger: Logger<string>): Promise<WAVersion> {
  const waWeb = await fetchLatestWaWebVersion();
  if ('version' in waWeb && Array.isArray(waWeb.version)) {
    return waWeb.version;
  }

  logger.warn({ error: 'error' in waWeb ? waWeb.error : null }, 'failed to fetch latest WA web version, falling back to latest Baileys version');
  const baileys = await fetchLatestBaileysVersion();
  if (!('error' in baileys) || baileys.error === undefined) {
    return baileys.version;
  }

  logger.warn({ error: baileys.error }, 'failed to fetch latest Baileys version, falling back to known-safe default');
  return [2, 3000, 1037799039];
}
