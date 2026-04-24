import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { AttachmentService } from '../../../packages/attachment-service/src/attachment-service';
import { ClusterService } from '../../../packages/cluster-service/src/cluster-service';
import { DeletionRedactionService } from '../../../packages/deletion-redaction-service/src/deletion-redaction-service';
import { PostgresEventLogRepository } from '../../../packages/event-log/src/event-log-repository';
import { ExportService } from '../../../packages/export-api/src/export-service';
import { HistoryImportService } from '../../../packages/history-import/src/history-import-service';
import { MetadataService } from '../../../packages/metadata-service/src/metadata-service';
import { MirrorEngine } from '../../../packages/mirror-engine/src/mirror-engine';
import { ParticipantMatchingService } from '../../../packages/participant-matching-service/src/participant-matching-service';
import { createBaileysWhatsAppLinkedProviderAdapter } from '../../../packages/provider-whatsapp-linked/src';
import type { ProviderAdapter } from '../../../packages/provider-adapter-interface/src';
import { ConnectionLifecycleService } from '../../../packages/query-api/src/connection-lifecycle-service';
import { ConversationBackfillService } from '../../../packages/query-api/src/conversation-backfill-service';
import { ConversationDiscoveryService } from '../../../packages/query-api/src/conversation-discovery-service';
import { AppError } from '../../../packages/query-api/src/errors';
import { createBackpressureGate, createStructuredLogger } from '../../../packages/query-api/src/operational';
import { SendPipelineService } from '../../../packages/query-api/src/send-pipeline-service';
import { SearchService } from '../../../packages/search-index/src/search-service';
import {
  PostgresAttachmentRepository,
  PostgresClusterConversationRepository,
  PostgresClusterRepository,
  PostgresConnectionRepository,
  PostgresConversationMembershipRepository,
  PostgresConversationRepository,
  PostgresConversationSyncStateRepository,
  PostgresDeletionRecordRepository,
  PostgresEntityMappingRepository,
  PostgresExportCursorRepository,
  PostgresMessageRepository,
  PostgresMetadataRepository,
  PostgresParticipantRepository,
  PostgresReceiptRepository,
  PostgresHistoryImportRepository,
  runMigrations
} from '../../../packages/storage/src';
import { createPostgresTestHarness, type PostgresTestHarness } from '../../../packages/test-kit/src/postgres-test-harness';
import { getHealthSnapshot } from './health';

interface LocalObjectStorage {
  putObject(key: string, body: Buffer): Promise<void>;
  getObject(key: string): Promise<Buffer>;
  dispose(): Promise<void>;
}

export interface PlatformServer {
  server: Server;
  close(): Promise<void>;
}

export async function createPlatformServer(input?: {
  providerAdapter?: ProviderAdapter;
  objectStorageDir?: string;
  liveAuthDir?: string;
  deviceLabel?: string | null;
  resetStateOnBoot?: boolean;
}): Promise<PlatformServer> {
  const db = await createPostgresTestHarness();
  await runMigrations(db);

  const resolvedAuthDir = input?.liveAuthDir ?? join(tmpdir(), 'yipyap-whatsapp-auth');
  if (input?.resetStateOnBoot) {
    await resetDirectory(input.objectStorageDir);
    if (!input?.providerAdapter) {
      await resetDirectory(resolvedAuthDir);
    }
  }

  const objectStorage = await createLocalObjectStorage(input?.objectStorageDir);
  const providerAdapter = input?.providerAdapter
    ?? await createBaileysWhatsAppLinkedProviderAdapter({
      authDir: resolvedAuthDir,
      deviceLabel: input?.deviceLabel ?? process.env.YIPYAP_WHATSAPP_DEVICE_LABEL ?? 'YipYap Demo'
    });

  const logger = createStructuredLogger({
    write(entry) {
      console.warn(JSON.stringify(entry));
    },
    bindings: { component: 'platform-api' }
  });

  const now = () => new Date();
  const createId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '')}`;

  const repositories = {
    connectionRepository: new PostgresConnectionRepository(db),
    conversationRepository: new PostgresConversationRepository(db),
    conversationSyncStateRepository: new PostgresConversationSyncStateRepository(db),
    participantRepository: new PostgresParticipantRepository(db),
    membershipRepository: new PostgresConversationMembershipRepository(db),
    messageRepository: new PostgresMessageRepository(db),
    attachmentRepository: new PostgresAttachmentRepository(db),
    receiptRepository: new PostgresReceiptRepository(db),
    historyImportRepository: new PostgresHistoryImportRepository(db),
    clusterRepository: new PostgresClusterRepository(db),
    clusterConversationRepository: new PostgresClusterConversationRepository(db),
    metadataRepository: new PostgresMetadataRepository(db),
    entityMappingRepository: new PostgresEntityMappingRepository(db),
    exportCursorRepository: new PostgresExportCursorRepository(db),
    deletionRecordRepository: new PostgresDeletionRecordRepository(db),
    eventLogRepository: new PostgresEventLogRepository(db)
  };

  const services = {
    connectionLifecycle: new ConnectionLifecycleService({
      connectionRepository: repositories.connectionRepository,
      eventLogRepository: repositories.eventLogRepository,
      providerAdapter,
      now,
      createId
    }),
    mirrorEngine: new MirrorEngine({
      connectionRepository: repositories.connectionRepository,
      conversationRepository: repositories.conversationRepository,
      conversationSyncStateRepository: repositories.conversationSyncStateRepository,
      participantRepository: repositories.participantRepository,
      messageRepository: repositories.messageRepository,
      attachmentRepository: repositories.attachmentRepository,
      receiptRepository: repositories.receiptRepository,
      eventLogRepository: repositories.eventLogRepository,
      now,
      createId
    }),
    historyImport: null as unknown as HistoryImportService,
    conversationDiscovery: null as unknown as ConversationDiscoveryService,
    conversationBackfill: null as unknown as ConversationBackfillService,
    sendPipeline: null as unknown as SendPipelineService,
    attachmentService: null as unknown as AttachmentService,
    clusterService: null as unknown as ClusterService,
    metadataService: null as unknown as MetadataService,
    participantMatchingService: null as unknown as ParticipantMatchingService,
    searchService: null as unknown as SearchService,
    exportService: null as unknown as ExportService,
    deletionRedactionService: null as unknown as DeletionRedactionService
  };

  services.historyImport = new HistoryImportService({
    connectionRepository: repositories.connectionRepository,
    conversationRepository: repositories.conversationRepository,
    conversationSyncStateRepository: repositories.conversationSyncStateRepository,
    participantRepository: repositories.participantRepository,
    messageRepository: repositories.messageRepository,
    attachmentRepository: repositories.attachmentRepository,
    historyImportRepository: repositories.historyImportRepository,
    eventLogRepository: repositories.eventLogRepository,
    providerAdapter,
    now,
    createId
  });

  services.conversationDiscovery = new ConversationDiscoveryService({
    connectionRepository: repositories.connectionRepository,
    conversationRepository: repositories.conversationRepository,
    conversationSyncStateRepository: repositories.conversationSyncStateRepository,
    participantRepository: repositories.participantRepository,
    membershipRepository: repositories.membershipRepository,
    eventLogRepository: repositories.eventLogRepository,
    providerAdapter,
    importScheduler: services.historyImport,
    now,
    createId
  });

  services.conversationBackfill = new ConversationBackfillService({
    connectionRepository: repositories.connectionRepository,
    conversationRepository: repositories.conversationRepository,
    conversationSyncStateRepository: repositories.conversationSyncStateRepository,
    participantRepository: repositories.participantRepository,
    messageRepository: repositories.messageRepository,
    attachmentRepository: repositories.attachmentRepository,
    eventLogRepository: repositories.eventLogRepository,
    providerAdapter,
    now,
    createId
  });

  services.sendPipeline = new SendPipelineService({
    connectionRepository: repositories.connectionRepository,
    conversationRepository: repositories.conversationRepository,
    conversationSyncStateRepository: repositories.conversationSyncStateRepository,
    participantRepository: repositories.participantRepository,
    messageRepository: repositories.messageRepository,
    attachmentRepository: repositories.attachmentRepository,
    eventLogRepository: repositories.eventLogRepository,
    providerAdapter,
    now,
    createId
  });

  services.attachmentService = new AttachmentService({
    connectionRepository: repositories.connectionRepository,
    conversationRepository: repositories.conversationRepository,
    messageRepository: repositories.messageRepository,
    attachmentRepository: repositories.attachmentRepository,
    eventLogRepository: repositories.eventLogRepository,
    providerAdapter,
    objectStorage,
    now,
    createId,
    createStorageKey: (attachmentId) => `attachments/${attachmentId}`
  });

  services.clusterService = new ClusterService({
    clusterRepository: repositories.clusterRepository,
    clusterConversationRepository: repositories.clusterConversationRepository,
    conversationRepository: repositories.conversationRepository,
    messageRepository: repositories.messageRepository,
    now,
    createId
  });

  services.metadataService = new MetadataService({
    messageRepository: repositories.messageRepository,
    conversationRepository: repositories.conversationRepository,
    clusterRepository: repositories.clusterRepository,
    metadataRepository: repositories.metadataRepository,
    now,
    createId,
    maxValueBytes: 32 * 1024
  });

  services.participantMatchingService = new ParticipantMatchingService({
    participantRepository: repositories.participantRepository,
    entityMappingRepository: repositories.entityMappingRepository,
    now,
    createId
  });

  services.searchService = new SearchService({
    messageRepository: repositories.messageRepository,
    attachmentRepository: repositories.attachmentRepository,
    clusterConversationRepository: repositories.clusterConversationRepository
  });

  services.exportService = new ExportService({
    eventLogRepository: repositories.eventLogRepository,
    messageRepository: repositories.messageRepository,
    exportCursorRepository: repositories.exportCursorRepository,
    createId
  });

  services.deletionRedactionService = new DeletionRedactionService({
    messageRepository: repositories.messageRepository,
    conversationRepository: repositories.conversationRepository,
    attachmentRepository: repositories.attachmentRepository,
    deletionRecordRepository: repositories.deletionRecordRepository,
    now,
    createId
  });

  const activeTenants = new Set<string>();
  const connectionSubscriptions = new Map<string, () => Promise<void>>();
  const importGate = createBackpressureGate({ maxInFlight: 1 });
  const attachmentGate = createBackpressureGate({ maxInFlight: 1 });

  const workerTimer = setInterval(() => {
    void drainBackgroundWork();
  }, 50);

  async function drainBackgroundWork(): Promise<void> {
    for (const tenantId of activeTenants) {
      try {
        const releaseImport = importGate.enter();
        try {
          await services.historyImport.runNextScheduledImport({ tenantId });
        } finally {
          releaseImport();
        }
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== 'precondition_failed') {
          logger.warn({ event: 'background.import.failed', tenantId, error: formatError(error) });
        }
      }

      try {
        const releaseAttachment = attachmentGate.enter();
        try {
          await services.attachmentService.processNextPendingDownload({ tenantId });
        } finally {
          releaseAttachment();
        }
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== 'precondition_failed') {
          logger.warn({ event: 'background.attachment.failed', tenantId, error: formatError(error) });
        }
      }
    }
  }

  async function ensureConnectionSubscription(tenantId: string, connectionId: string): Promise<void> {
    if (connectionSubscriptions.has(connectionId)) {
      return;
    }
    const unsubscribe = await providerAdapter.subscribe(connectionId, async (event) => {
      await services.mirrorEngine.ingestProviderEvent({ tenantId, event });
    });
    connectionSubscriptions.set(connectionId, unsubscribe);
  }

  async function syncConnectionStatus(tenantId: string, connectionId: string) {
    const connection = await repositories.connectionRepository.getById({ tenantId, id: connectionId });
    if (!connection) {
      throw new AppError('not_found', `connection ${connectionId} was not found`);
    }
    const bootstrap = await providerAdapter.getConnectionBootstrapState(connectionId);
    const nextStatus = bootstrap.status === 'connecting' || bootstrap.status === 'pending'
      ? connection.status
      : bootstrap.status;
    if (nextStatus !== connection.status) {
      await repositories.connectionRepository.update({
        tenantId,
        id: connectionId,
        patch: {
          status: nextStatus,
          statusReason: nextStatus === 'reauth_required' ? 'auth_invalid' : 'none',
          updatedAt: now(),
          lastConnectedAt: nextStatus === 'connected' ? now() : connection.lastConnectedAt,
          disconnectedAt: nextStatus === 'connected' ? null : connection.disconnectedAt,
          reauthRequiredAt: nextStatus === 'reauth_required' ? now() : connection.reauthRequiredAt,
          providerAccountRef: connection.providerAccountRef,
          deviceLabel: connection.deviceLabel,
          lastHeartbeatAt: connection.lastHeartbeatAt
        }
      });
    }
    if (bootstrap.status === 'connected') {
      await ensureConnectionSubscription(tenantId, connectionId);
    }
    return await repositories.connectionRepository.getById({ tenantId, id: connectionId });
  }

  const server = createServer(async (request, response) => {
    applyCorsHeaders(response);
    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      response.end();
      return;
    }

    try {
      await handleRequest(request, response);
    } catch (error) {
      const appError = error instanceof AppError ? error : new AppError('internal_error', error instanceof Error ? error.message : 'internal error');
      response.statusCode = appError.code === 'not_found' ? 404 : appError.code === 'invalid_argument' ? 400 : appError.code === 'precondition_failed' ? 412 : 500;
      response.setHeader('content-type', 'application/json');
      response.end(stringifyJson({ code: appError.code, message: appError.message }));
    }
  });

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const tenantId = getTenantId(request);
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    const path = requestUrl.pathname;
    activeTenants.add(tenantId);

    if (request.method === 'GET' && path === '/health') {
      const snapshot = await getHealthSnapshot({
        checks: {
          storage: async () => {
            await repositories.eventLogRepository.listByTenant({ tenantId, afterIngestSeq: null, limit: 1 });
            return { ok: true };
          },
          provider: async () => ({ ok: true })
        }
      });
      response.statusCode = snapshot.ok ? 200 : 503;
      response.setHeader('content-type', 'application/json');
      response.end(stringifyJson(snapshot));
      return;
    }

    if (request.method === 'GET' && path === '/events/stream') {
      const requestedAfter = requestUrl.searchParams.get('afterIngestSeq');
      let lastIngestSeq = requestedAfter ? BigInt(requestedAfter) : BigInt(0);
      let closed = false;
      let polling = false;
      response.statusCode = 200;
      response.setHeader('content-type', 'text/event-stream');
      response.setHeader('cache-control', 'no-cache');
      response.setHeader('connection', 'keep-alive');
      response.write(': connected\n\n');

      const pump = async () => {
        if (closed || polling) {
          return;
        }
        polling = true;
        try {
          const events = await repositories.eventLogRepository.listByTenant({ tenantId, afterIngestSeq: lastIngestSeq, limit: 100 });
          for (const event of events) {
            if (event.eventFamily === 'provider_raw') {
              lastIngestSeq = event.ingestSeq;
              continue;
            }
            lastIngestSeq = event.ingestSeq;
            response.write(`event: ${event.eventType}\n`);
            response.write(`data: ${stringifyJson({
              eventType: event.eventType,
              eventFamily: event.eventFamily,
              ingestSeq: event.ingestSeq,
              connectionId: event.connectionId,
              conversationId: event.conversationId,
              messageId: event.messageId,
              occurredAt: event.occurredAt,
              payload: event.payloadJson
            })}\n\n`);
          }
        } finally {
          polling = false;
        }
      };

      const interval = setInterval(() => {
        void pump();
      }, 50);
      void pump();

      request.on('close', () => {
        closed = true;
        clearInterval(interval);
      });
      return;
    }

    if (request.method === 'POST' && request.url === '/connections') {
      const body = await readJsonBody<{ workspaceUserRef: string }>(request);
      const connection = await services.connectionLifecycle.createConnection({ tenantId, workspaceUserRef: body.workspaceUserRef });
      await ensureConnectionSubscription(tenantId, connection.id);
      respondJson(response, connection);
      return;
    }

    if (request.method === 'GET' && request.url?.startsWith('/connections/') && request.url.endsWith('/status')) {
      const connectionId = request.url.split('/')[2] ?? '';
      const connection = await syncConnectionStatus(tenantId, connectionId);
      respondJson(response, connection);
      return;
    }

    if (request.method === 'GET' && request.url?.startsWith('/connections/') && request.url.endsWith('/qr')) {
      const connectionId = request.url.split('/')[2] ?? '';
      respondJson(response, await services.connectionLifecycle.getConnectionQr({ tenantId, connectionId }));
      return;
    }

    if (request.method === 'GET' && request.url === '/connections') {
      respondJson(response, await repositories.connectionRepository.listByTenant({ tenantId }));
      return;
    }

    if (request.method === 'GET' && path.startsWith('/connections/') && path.endsWith('/inbox/chats')) {
      const connectionId = path.split('/')[2] ?? '';
      const limit = Math.min(Number(requestUrl.searchParams.get('limit') ?? '50') || 50, 200);
      const cursor = parseInboxCursor(requestUrl.searchParams.get('cursor'));
      const items = await repositories.conversationRepository.listInboxChats({
        tenantId,
        connectionId,
        limit: limit + 1,
        cursor,
        conversationType: parseConversationTypeFilter(requestUrl.searchParams.get('type')),
        isSelected: parseBooleanQuery(requestUrl.searchParams.get('selected')),
        recentWindowStatus: parseRecentWindowStatus(requestUrl.searchParams.get('recent_window_status'))
      });
      const hasMore = items.length > limit;
      const pageItems = hasMore ? items.slice(0, limit) : items;
      const lastItem = pageItems.at(-1) ?? null;
      respondJson(response, {
        items: pageItems,
        nextCursor: hasMore && lastItem
          ? encodeInboxCursor({
              lastProviderMessageAt: lastItem.lastMessageAt,
              lastMessageIngestSeq: lastItem.lastMessage?.messageId ? (await repositories.conversationRepository.getById({ tenantId, id: lastItem.conversationId }))?.lastMessageIngestSeq ?? null : null,
              conversationId: lastItem.conversationId
            })
          : null
      });
      return;
    }

    if (request.method === 'GET' && path.startsWith('/connections/') && path.endsWith('/conversations')) {
      const connectionId = path.split('/')[2] ?? '';
      const conversations = await services.conversationDiscovery.discoverConversations({ tenantId, connectionId });
      respondJson(response, conversations);
      return;
    }

    if (request.method === 'GET' && request.url?.startsWith('/connections/') && request.url.endsWith('/participants')) {
      const connectionId = request.url.split('/')[2] ?? '';
      respondJson(response, await repositories.participantRepository.listByConnection({ tenantId, connectionId }));
      return;
    }

    if (request.method === 'POST' && request.url?.startsWith('/conversations/') && request.url.endsWith('/select')) {
      const conversationId = request.url.split('/')[2] ?? '';
      await services.conversationDiscovery.selectConversation({ tenantId, conversationId });
      const conversation = await repositories.conversationRepository.getById({ tenantId, id: conversationId });
      respondJson(response, conversation);
      return;
    }

    if (request.method === 'GET' && path.startsWith('/conversations/') && path.endsWith('/timeline')) {
      const conversationId = path.split('/')[2] ?? '';
      const conversation = await repositories.conversationRepository.getById({ tenantId, id: conversationId });
      if (!conversation) {
        throw new AppError('not_found', `conversation ${conversationId} was not found`);
      }
      const limit = Math.min(Number(requestUrl.searchParams.get('limit') ?? '50') || 50, 200);
      const before = parseTimelineCursor(requestUrl.searchParams.get('before'));
      const after = parseTimelineCursor(requestUrl.searchParams.get('after'));
      const includeDeleted = requestUrl.searchParams.get('include_deleted') === 'true';
      const timeline = await repositories.messageRepository.listTimelinePage({ tenantId, conversationId, limit, before: before ?? undefined, after: after ?? undefined, includeDeleted });
      const syncState = await repositories.conversationSyncStateRepository.getByConversationId({ tenantId, conversationId });
      const items = await Promise.all(timeline.items.map(async (message) => {
        const [attachments, receipts, sender] = await Promise.all([
          repositories.attachmentRepository.listByMessage({ tenantId, messageId: message.id }),
          repositories.receiptRepository.listByMessage({ tenantId, messageId: message.id }),
          message.senderParticipantId
            ? repositories.participantRepository.getById({ tenantId, id: message.senderParticipantId })
            : Promise.resolve(null)
        ]);

        return {
          messageId: message.id,
          providerMessageId: message.providerMessageId,
          sentAt: message.providerSentAt,
          mirroredAt: message.mirroredAt,
          ingestSeq: message.ingestSeq,
          fromMe: message.fromMe ?? message.direction === 'outbound',
          direction: message.direction,
          senderParticipantId: message.senderParticipantId,
          senderDisplayName: sender?.displayName ?? sender?.profileName ?? sender?.waBusinessName ?? message.providerSenderRef ?? null,
          providerSenderRef: message.providerSenderRef ?? null,
          messageType: message.messageType,
          text: message.textBody,
          messagePreviewText: message.messagePreviewText ?? message.textBody,
          attachments: attachments.map((attachment) => ({
            id: attachment.id,
            attachmentType: attachment.attachmentType,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            byteSize: attachment.byteSize,
            downloadState: attachment.downloadState,
            downloadUrl: attachment.downloadState === 'available' ? `/attachments/${attachment.id}/blob` : null
          })),
          receipts: await Promise.all(receipts.map(async (receipt) => {
            const participant = receipt.participantId
              ? await repositories.participantRepository.getById({ tenantId, id: receipt.participantId })
              : null;
            return {
              id: receipt.id,
              receiptType: receipt.receiptType,
              participantId: receipt.participantId,
              participantDisplayName: participant?.displayName ?? participant?.profileName ?? participant?.waBusinessName ?? null,
              providerAt: receipt.providerAt,
              observedAt: receipt.observedAt
            };
          })),
          status: message.messageStatus,
          quotedMessageId: message.quotedMessageId,
          replyToProviderMessageId: message.replyToProviderMessageId,
          deletedAt: message.deletedAt ?? null,
          editedAt: message.editedAt ?? null
        };
      }));
      respondJson(response, {
        conversation: {
          conversationId: conversation.id,
          title: conversation.title,
          type: conversation.conversationType
        },
        items,
        pageInfo: {
          nextBeforeCursor: encodeTimelineCursor(timeline.nextBeforeCursor),
          nextAfterCursor: encodeTimelineCursor(timeline.nextAfterCursor),
          hasOlder: timeline.hasOlder,
          hasNewer: timeline.hasNewer
        },
        sync: {
          earliestMirroredAt: syncState?.earliestMirroredProviderSentAt ?? null,
          latestMirroredAt: syncState?.latestMirroredProviderSentAt ?? null,
          olderHistoryPossible: syncState?.olderHistoryPossible ?? true,
          backfillState: syncState?.backfillState ?? 'idle'
        }
      });
      return;
    }

    if (request.method === 'GET' && path.startsWith('/conversations/') && path.endsWith('/sync-status')) {
      const conversationId = path.split('/')[2] ?? '';
      const syncState = await repositories.conversationSyncStateRepository.getByConversationId({ tenantId, conversationId });
      const conversation = await repositories.conversationRepository.getById({ tenantId, id: conversationId });
      if (!conversation) {
        throw new AppError('not_found', `conversation ${conversationId} was not found`);
      }
      respondJson(response, {
        conversationId,
        recentWindow: {
          days: syncState?.recentWindowDays ?? 7,
          status: conversation.recentWindowStatus ?? 'unknown',
          startAt: syncState?.recentWindowStartAt ?? null,
          endAt: syncState?.recentWindowEndAt ?? null
        },
        coverage: {
          earliestMirroredAt: syncState?.earliestMirroredProviderSentAt ?? null,
          latestMirroredAt: syncState?.latestMirroredProviderSentAt ?? null,
          olderHistoryPossible: syncState?.olderHistoryPossible ?? true
        },
        backfill: {
          state: syncState?.backfillState ?? 'idle',
          lastRequestedAt: syncState?.lastBackfillRequestedAt ?? null,
          lastCompletedAt: syncState?.lastBackfillCompletedAt ?? null,
          lastErrorCode: syncState?.lastErrorCode ?? null
        }
      });
      return;
    }

    if (request.method === 'POST' && path.startsWith('/conversations/') && path.endsWith('/backfill')) {
      const conversationId = path.split('/')[2] ?? '';
      const body = await readJsonBody<{ pageSizeDays?: 7 }>(request);
      respondJson(response, await services.conversationBackfill.backfillOlderHistory({ tenantId, conversationId, pageSizeDays: body.pageSizeDays }));
      return;
    }

    if (request.method === 'GET' && request.url?.startsWith('/conversations/') && request.url.endsWith('/messages')) {
      const conversationId = request.url.split('/')[2] ?? '';
      respondJson(response, await repositories.messageRepository.listByConversation({ tenantId, conversationId }));
      return;
    }

    if (request.method === 'POST' && request.url?.startsWith('/conversations/') && request.url.endsWith('/messages/text')) {
      const conversationId = request.url.split('/')[2] ?? '';
      const body = await readJsonBody<{ text: string; clientMessageId?: string }>(request);
      const result = await services.sendPipeline.sendTextMessage({ tenantId, conversationId, text: body.text, clientMessageId: body.clientMessageId });
      const message = await repositories.messageRepository.getById({ tenantId, id: result.messageId });
      respondJson(response, { id: result.messageId, providerMessageId: result.providerMessageId, messageStatus: message?.messageStatus ?? 'sent' });
      return;
    }

    if (request.method === 'GET' && request.url?.startsWith('/conversations/') && request.url.endsWith('/attachments')) {
      const conversationId = request.url.split('/')[2] ?? '';
      const messages = await repositories.messageRepository.listByConversation({ tenantId, conversationId });
      const attachments = (await Promise.all(messages.map((message) => repositories.attachmentRepository.listByMessage({ tenantId, messageId: message.id })))).flat();
      respondJson(response, attachments);
      return;
    }

    if (request.method === 'POST' && request.url?.startsWith('/attachments/') && request.url.endsWith('/download')) {
      const attachmentId = request.url.split('/')[2] ?? '';
      await services.attachmentService.requestAttachmentDownload({ tenantId, attachmentId });
      const attachment = await repositories.attachmentRepository.getById({ tenantId, id: attachmentId });
      respondJson(response, attachment);
      return;
    }

    if (request.method === 'GET' && request.url?.startsWith('/attachments/') && !request.url.endsWith('/blob')) {
      const attachmentId = request.url.split('/')[2] ?? '';
      const attachment = await repositories.attachmentRepository.getById({ tenantId, id: attachmentId });
      if (!attachment) {
        throw new AppError('not_found', `attachment ${attachmentId} was not found`);
      }
      respondJson(response, attachment.downloadState === 'available'
        ? { ...attachment, downloadUrl: `/attachments/${attachment.id}/blob` }
        : attachment);
      return;
    }

    if (request.method === 'GET' && request.url?.startsWith('/attachments/') && request.url.endsWith('/blob')) {
      const attachmentId = request.url.split('/')[2] ?? '';
      const attachment = await repositories.attachmentRepository.getById({ tenantId, id: attachmentId });
      if (!attachment?.storageKey) {
        throw new AppError('precondition_failed', `attachment ${attachmentId} is not available for download`);
      }
      const content = await objectStorage.getObject(attachment.storageKey);
      response.statusCode = 200;
      response.setHeader('content-type', attachment.mimeType ?? 'application/octet-stream');
      response.end(content);
      return;
    }

    if (request.method === 'POST' && request.url === '/clusters') {
      const body = await readJsonBody<{ name: string; description?: string }>(request);
      respondJson(response, await services.clusterService.createCluster({ tenantId, name: body.name, description: body.description }));
      return;
    }

    if (request.method === 'GET' && request.url === '/clusters') {
      respondJson(response, await repositories.clusterRepository.listByTenant({ tenantId }));
      return;
    }

    if (request.method === 'POST' && request.url?.startsWith('/clusters/') && request.url.endsWith('/conversations')) {
      const clusterId = request.url.split('/')[2] ?? '';
      const body = await readJsonBody<{ conversationId: string }>(request);
      respondJson(response, await services.clusterService.addConversationToCluster({ tenantId, clusterId, conversationId: body.conversationId }));
      return;
    }

    if (request.method === 'GET' && request.url?.startsWith('/clusters/') && request.url.endsWith('/timeline')) {
      const clusterId = request.url.split('/')[2] ?? '';
      respondJson(response, await services.clusterService.getClusterTimeline({ tenantId, clusterId }));
      return;
    }

    if (request.method === 'POST' && request.url === '/search/messages') {
      const body = await readJsonBody<{ query: string; scope: { type: 'tenant' | 'conversation' | 'cluster'; conversationId?: string; clusterId?: string } }>(request);
      respondJson(response, await services.searchService.searchMessages({ tenantId, query: body.query, scope: body.scope.type === 'tenant' ? { type: 'tenant' } : body.scope.type === 'conversation' ? { type: 'conversation', conversationId: body.scope.conversationId ?? '' } : { type: 'cluster', clusterId: body.scope.clusterId ?? '' } }));
      return;
    }

    if (request.method === 'POST' && request.url === '/metadata') {
      const body = await readJsonBody<{ targetType: 'message' | 'conversation' | 'participant' | 'attachment' | 'cluster'; targetId: string; namespace: string; key: string; valueJson: Record<string, unknown> }>(request);
      respondJson(response, await services.metadataService.setMetadata({ tenantId, ...body }));
      return;
    }

    if (request.method === 'GET' && request.url?.startsWith('/metadata/')) {
      const [, , targetType, targetId] = request.url.split('/');
      respondJson(response, await services.metadataService.listMetadata({ tenantId, targetType: targetType as 'message' | 'conversation' | 'participant' | 'attachment' | 'cluster', targetId }));
      return;
    }

    if (request.method === 'POST' && request.url === '/mappings') {
      const body = await readJsonBody<{ participantId: string; entityType: string; entityRef: string; label?: string }>(request);
      respondJson(response, await services.participantMatchingService.createEntityMapping({ tenantId, ...body }));
      return;
    }

    if (request.method === 'GET' && request.url === '/mappings') {
      respondJson(response, await services.participantMatchingService.listEntityMappings({ tenantId }));
      return;
    }

    if (request.method === 'POST' && request.url === '/exports/events') {
      const body = await readJsonBody<{ cursorName: string; limit: number }>(request);
      respondJson(response, await services.exportService.exportEvents({ tenantId, cursorName: body.cursorName, limit: body.limit }));
      return;
    }

    if (request.method === 'POST' && request.url?.startsWith('/messages/') && request.url.endsWith('/soft-delete')) {
      const messageId = request.url.split('/')[2] ?? '';
      const body = await readJsonBody<{ reason?: string }>(request);
      await services.deletionRedactionService.softDeleteMessage({ tenantId, messageId, reason: body.reason });
      const record = (await repositories.deletionRecordRepository.listByTenant({ tenantId })).at(-1) ?? null;
      respondJson(response, record);
      return;
    }

    if (request.method === 'GET' && /^\/connections\/[^/]+$/.test(request.url ?? '')) {
      const connectionId = request.url?.split('/')[2] ?? '';
      respondJson(response, await repositories.connectionRepository.getById({ tenantId, id: connectionId }));
      return;
    }

    if (request.method === 'POST' && request.url?.startsWith('/connections/') && request.url.endsWith('/disconnect')) {
      const connectionId = request.url.split('/')[2] ?? '';
      await services.connectionLifecycle.disconnectConnection({ tenantId, connectionId });
      respondJson(response, await repositories.connectionRepository.getById({ tenantId, id: connectionId }));
      return;
    }

    if (request.method === 'POST' && request.url?.startsWith('/connections/') && request.url.endsWith('/reconnect')) {
      const connectionId = request.url.split('/')[2] ?? '';
      await services.connectionLifecycle.reconnectConnection({ tenantId, connectionId });
      await ensureConnectionSubscription(tenantId, connectionId);
      respondJson(response, await syncConnectionStatus(tenantId, connectionId));
      return;
    }

    if (request.method === 'GET' && /^\/conversations\/[^/]+$/.test(request.url ?? '')) {
      const conversationId = request.url?.split('/')[2] ?? '';
      respondJson(response, await repositories.conversationRepository.getById({ tenantId, id: conversationId }));
      return;
    }

    if (request.method === 'POST' && request.url?.startsWith('/conversations/') && request.url.endsWith('/deselect')) {
      const conversationId = request.url.split('/')[2] ?? '';
      const conversation = await repositories.conversationRepository.getById({ tenantId, id: conversationId });
      if (!conversation) {
        throw new AppError('not_found', `conversation ${conversationId} was not found`);
      }
      const changedAt = now();
      await repositories.conversationRepository.markSelected({ tenantId, id: conversationId, isSelected: false, selectionStateChangedAt: changedAt, updatedAt: changedAt });
      await repositories.eventLogRepository.append({ tenantId, eventType: 'conversation.deselected', eventFamily: 'normalized', connectionId: conversation.connectionId, conversationId, messageId: null, clusterId: null, occurredAt: changedAt, payloadJson: { conversationId }, dedupeKey: null });
      respondJson(response, await repositories.conversationRepository.getById({ tenantId, id: conversationId }));
      return;
    }

    if (request.method === 'POST' && request.url === '/conversations/bulk-select') {
      const body = await readJsonBody<{ conversationIds: string[] }>(request);
      for (const conversationId of body.conversationIds) {
        await services.conversationDiscovery.selectConversation({ tenantId, conversationId });
      }
      respondJson(response, { selectedConversationIds: body.conversationIds });
      return;
    }

    if (request.method === 'POST' && request.url === '/conversations/bulk-deselect') {
      const body = await readJsonBody<{ conversationIds: string[] }>(request);
      for (const conversationId of body.conversationIds) {
        const conversation = await repositories.conversationRepository.getById({ tenantId, id: conversationId });
        if (!conversation) {
          continue;
        }
        const changedAt = now();
        await repositories.conversationRepository.markSelected({ tenantId, id: conversationId, isSelected: false, selectionStateChangedAt: changedAt, updatedAt: changedAt });
      }
      respondJson(response, { deselectedConversationIds: body.conversationIds });
      return;
    }

    if (request.method === 'GET' && request.url?.startsWith('/conversations/') && request.url.endsWith('/participants')) {
      const conversationId = request.url.split('/')[2] ?? '';
      respondJson(response, await services.conversationDiscovery.getConversationParticipants({ tenantId, conversationId }));
      return;
    }

    if (request.method === 'POST' && request.url?.startsWith('/conversations/') && request.url.endsWith('/messages/attachment')) {
      const conversationId = request.url.split('/')[2] ?? '';
      const body = await readJsonBody<{ fileName: string; mimeType: string; dataBase64: string; caption?: string; clientMessageId?: string }>(request);
      const result = await services.sendPipeline.sendAttachmentMessage({ tenantId, conversationId, caption: body.caption, clientMessageId: body.clientMessageId, attachmentSource: { fileName: body.fileName, mimeType: body.mimeType, data: Buffer.from(body.dataBase64, 'base64') } });
      const message = await repositories.messageRepository.getById({ tenantId, id: result.messageId });
      respondJson(response, { id: result.messageId, providerMessageId: result.providerMessageId, attachmentId: result.attachmentId, messageStatus: message?.messageStatus ?? 'sent' });
      return;
    }

    if (request.method === 'GET' && /^\/messages\/[^/]+$/.test(request.url ?? '')) {
      const messageId = request.url?.split('/')[2] ?? '';
      respondJson(response, await repositories.messageRepository.getById({ tenantId, id: messageId }));
      return;
    }

    if (request.method === 'GET' && request.url?.startsWith('/messages/') && request.url.endsWith('/receipts')) {
      const messageId = request.url.split('/')[2] ?? '';
      respondJson(response, await repositories.receiptRepository.listByMessage({ tenantId, messageId }));
      return;
    }

    if (request.method === 'GET' && request.url === '/attachments') {
      respondJson(response, await repositories.attachmentRepository.listByTenant({ tenantId }));
      return;
    }

    if (request.method === 'GET' && request.url?.startsWith('/attachments/') && request.url.endsWith('/download-url')) {
      const attachmentId = request.url.split('/')[2] ?? '';
      const attachment = await repositories.attachmentRepository.getById({ tenantId, id: attachmentId });
      if (!attachment || attachment.downloadState !== 'available') {
        throw new AppError('precondition_failed', `attachment ${attachmentId} is not available for download`);
      }
      respondJson(response, { url: `/attachments/${attachmentId}/blob` });
      return;
    }

    if (request.method === 'GET' && /^\/clusters\/[^/]+$/.test(request.url ?? '')) {
      const clusterId = request.url?.split('/')[2] ?? '';
      respondJson(response, await repositories.clusterRepository.getById({ tenantId, id: clusterId }));
      return;
    }

    if (request.method === 'PATCH' && /^\/clusters\/[^/]+$/.test(request.url ?? '')) {
      const clusterId = request.url?.split('/')[2] ?? '';
      const cluster = await repositories.clusterRepository.getById({ tenantId, id: clusterId });
      if (!cluster) {
        throw new AppError('not_found', `cluster ${clusterId} was not found`);
      }
      const body = await readJsonBody<{ name?: string; description?: string | null; archived?: boolean }>(request);
      const next = { ...cluster, name: body.name ?? cluster.name, description: body.description === undefined ? cluster.description : body.description, archived: body.archived ?? cluster.archived, updatedAt: now() };
      await repositories.clusterRepository.update(next);
      respondJson(response, next);
      return;
    }

    if (request.method === 'POST' && request.url?.startsWith('/clusters/') && request.url.endsWith('/archive')) {
      const clusterId = request.url.split('/')[2] ?? '';
      const cluster = await repositories.clusterRepository.getById({ tenantId, id: clusterId });
      if (!cluster) {
        throw new AppError('not_found', `cluster ${clusterId} was not found`);
      }
      const next = { ...cluster, archived: true, updatedAt: now() };
      await repositories.clusterRepository.update(next);
      respondJson(response, next);
      return;
    }

    if (request.method === 'GET' && request.url?.startsWith('/clusters/') && request.url.endsWith('/conversations')) {
      const clusterId = request.url.split('/')[2] ?? '';
      respondJson(response, await services.clusterService.listClusterConversations({ tenantId, clusterId }));
      return;
    }

    if (request.method === 'DELETE' && request.url?.startsWith('/clusters/') && request.url.includes('/conversations/')) {
      const parts = request.url.split('/');
      const clusterId = parts[2] ?? '';
      const conversationId = parts[4] ?? '';
      await repositories.clusterConversationRepository.remove({ tenantId, clusterId, conversationId });
      respondJson(response, { removed: true });
      return;
    }

    if (request.method === 'POST' && request.url === '/search/attachments') {
      const body = await readJsonBody<{ query: string; scope: { type: 'tenant' | 'conversation' | 'cluster'; conversationId?: string; clusterId?: string } }>(request);
      respondJson(response, await services.searchService.searchAttachmentsByName({ tenantId, query: body.query, scope: body.scope.type === 'tenant' ? { type: 'tenant' } : body.scope.type === 'conversation' ? { type: 'conversation', conversationId: body.scope.conversationId ?? '' } : { type: 'cluster', clusterId: body.scope.clusterId ?? '' } }));
      return;
    }

    if (request.method === 'POST' && request.url === '/metadata/delete') {
      const body = await readJsonBody<{ targetType: 'message' | 'conversation' | 'participant' | 'attachment' | 'cluster'; targetId: string; namespace: string; key: string }>(request);
      respondJson(response, await services.metadataService.deleteMetadata({ tenantId, ...body }));
      return;
    }

    if (request.method === 'GET' && request.url?.startsWith('/participants/')) {
      const participantId = request.url.split('/')[2] ?? '';
      respondJson(response, await repositories.participantRepository.getById({ tenantId, id: participantId }));
      return;
    }

    if (request.method === 'POST' && request.url === '/mappings/candidates') {
      const body = await readJsonBody<{ participantId: string; candidateSet: Array<{ entityType: string; entityRef: string; displayName: string | null; phoneE164: string | null }> }>(request);
      respondJson(response, await services.participantMatchingService.listCandidateMatches({ tenantId, participantId: body.participantId, candidateSet: body.candidateSet }));
      return;
    }

    if (request.method === 'POST' && request.url === '/mappings/merge') {
      const body = await readJsonBody<{ sourceMappingId: string; targetMappingId: string }>(request);
      await services.participantMatchingService.mergeParticipantMappings({ tenantId, sourceMappingId: body.sourceMappingId, targetMappingId: body.targetMappingId });
      respondJson(response, { merged: true });
      return;
    }

    if (request.method === 'POST' && request.url?.startsWith('/mappings/') && request.url.endsWith('/delete')) {
      const mappingId = request.url.split('/')[2] ?? '';
      const mapping = await repositories.entityMappingRepository.getById({ tenantId, id: mappingId });
      if (!mapping) {
        throw new AppError('not_found', `mapping ${mappingId} was not found`);
      }
      const next = { ...mapping, mappingStatus: 'deleted' as const, updatedAt: now() };
      await repositories.entityMappingRepository.update(next);
      respondJson(response, next);
      return;
    }

    if (request.method === 'POST' && request.url === '/exports/messages') {
      const body = await readJsonBody<{ afterIngestSeq?: string; limit: number }>(request);
      respondJson(response, await services.exportService.exportMessages({ tenantId, afterIngestSeq: body.afterIngestSeq ? BigInt(body.afterIngestSeq) : BigInt(0), limit: body.limit }));
      return;
    }

    if (request.method === 'POST' && request.url === '/exports/cursors/get-or-create') {
      const body = await readJsonBody<{ cursorName: string }>(request);
      respondJson(response, await services.exportService.getOrCreateCursor({ tenantId, cursorName: body.cursorName }));
      return;
    }

    if (request.method === 'POST' && request.url === '/exports/cursors/advance') {
      const body = await readJsonBody<{ cursorName: string; lastIngestSeq: string }>(request);
      await services.exportService.advanceCursor({ tenantId, cursorName: body.cursorName, lastIngestSeq: BigInt(body.lastIngestSeq) });
      respondJson(response, { advanced: true });
      return;
    }

    if (request.method === 'POST' && request.url?.startsWith('/messages/') && request.url.endsWith('/redact')) {
      const messageId = request.url.split('/')[2] ?? '';
      const body = await readJsonBody<{ reason?: string }>(request);
      await services.deletionRedactionService.redactMessage({ tenantId, messageId, reason: body.reason });
      respondJson(response, (await repositories.deletionRecordRepository.listByTenant({ tenantId })).at(-1) ?? null);
      return;
    }

    if (request.method === 'POST' && request.url?.startsWith('/messages/') && request.url.endsWith('/hard-delete')) {
      const messageId = request.url.split('/')[2] ?? '';
      const body = await readJsonBody<{ reason?: string }>(request);
      await services.deletionRedactionService.hardDeleteMessage({ tenantId, messageId, reason: body.reason });
      respondJson(response, (await repositories.deletionRecordRepository.listByTenant({ tenantId })).at(-1) ?? null);
      return;
    }

    if (request.method === 'POST' && request.url?.startsWith('/attachments/') && request.url.endsWith('/soft-delete')) {
      const attachmentId = request.url.split('/')[2] ?? '';
      const body = await readJsonBody<{ reason?: string }>(request);
      await services.deletionRedactionService.softDeleteAttachment({ tenantId, attachmentId, reason: body.reason });
      respondJson(response, (await repositories.deletionRecordRepository.listByTenant({ tenantId })).at(-1) ?? null);
      return;
    }

    if (request.method === 'POST' && request.url?.startsWith('/attachments/') && request.url.endsWith('/redact')) {
      const attachmentId = request.url.split('/')[2] ?? '';
      const body = await readJsonBody<{ reason?: string }>(request);
      await services.deletionRedactionService.redactAttachment({ tenantId, attachmentId, reason: body.reason });
      respondJson(response, (await repositories.deletionRecordRepository.listByTenant({ tenantId })).at(-1) ?? null);
      return;
    }

    if (request.method === 'POST' && request.url?.startsWith('/attachments/') && request.url.endsWith('/hard-delete')) {
      const attachmentId = request.url.split('/')[2] ?? '';
      const body = await readJsonBody<{ reason?: string }>(request);
      await services.deletionRedactionService.hardDeleteAttachment({ tenantId, attachmentId, reason: body.reason });
      respondJson(response, (await repositories.deletionRecordRepository.listByTenant({ tenantId })).at(-1) ?? null);
      return;
    }

    if (request.method === 'GET' && /^\/deletions\/[^/]+$/.test(request.url ?? '')) {
      const deletionId = request.url?.split('/')[2] ?? '';
      respondJson(response, await repositories.deletionRecordRepository.getById({ tenantId, id: deletionId }));
      return;
    }

    if (request.method === 'GET' && request.url === '/deletions') {
      respondJson(response, await repositories.deletionRecordRepository.listByTenant({ tenantId }));
      return;
    }

    throw new AppError('not_found', `route ${request.method ?? 'GET'} ${request.url ?? '/'} was not found`);
  }

  return {
    server,
    async close() {
      clearInterval(workerTimer);
      for (const unsubscribe of connectionSubscriptions.values()) {
        await unsubscribe();
      }
      if (server.listening) {
        await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
      }
      await objectStorage.dispose();
      await db.close();
    }
  };
}

async function createLocalObjectStorage(rootDir?: string): Promise<LocalObjectStorage> {
  const root = rootDir ?? await mkdtemp(join(tmpdir(), 'yipyap-object-storage-'));
  await mkdir(root, { recursive: true });
  return {
    async putObject(key, body) {
      const filePath = join(root, key);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, body);
    },
    async getObject(key) {
      return Buffer.from(await readFile(join(root, key)));
    },
    async dispose() {
      await rm(root, { recursive: true, force: true });
    }
  };
}

function respondJson(response: ServerResponse, body: unknown, statusCode = 200): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json');
  response.end(stringifyJson(body));
}

function applyCorsHeaders(response: ServerResponse): void {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type,x-tenant-id');
}

async function resetDirectory(pathToReset: string | undefined): Promise<void> {
  if (!pathToReset) {
    return;
  }
  await rm(pathToReset, { recursive: true, force: true });
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return (raw ? JSON.parse(raw) : {}) as T;
}

function getTenantId(request: IncomingMessage): string {
  const value = request.headers['x-tenant-id'];
  return typeof value === 'string' && value.length > 0 ? value : 'tenant_demo';
}

function parseBooleanQuery(value: string | null): boolean | undefined {
  if (value === null) {
    return undefined;
  }
  return value === 'true';
}

function parseConversationTypeFilter(value: string | null): 'direct' | 'group' | 'broadcast' | 'unknown' | 'all' | undefined {
  if (value === null || value === 'all') {
    return 'all';
  }
  if (value === 'direct' || value === 'group' || value === 'broadcast' || value === 'unknown') {
    return value;
  }
  return undefined;
}

function parseRecentWindowStatus(value: string | null): 'unknown' | 'bootstrapping' | 'partial' | 'ready' | 'failed' | undefined {
  if (value === null) {
    return undefined;
  }
  if (value === 'unknown' || value === 'bootstrapping' || value === 'partial' || value === 'ready' || value === 'failed') {
    return value;
  }
  return undefined;
}

function encodeInboxCursor(value: { lastProviderMessageAt: Date | null; lastMessageIngestSeq: bigint | null; conversationId: string }): string {
  return Buffer.from(stringifyJson({
    lastProviderMessageAt: value.lastProviderMessageAt,
    lastMessageIngestSeq: value.lastMessageIngestSeq,
    conversationId: value.conversationId
  }), 'utf8').toString('base64url');
}

function parseInboxCursor(value: string | null): { lastProviderMessageAt: Date | null; lastMessageIngestSeq: bigint | null; conversationId: string } | null {
  if (!value) {
    return null;
  }
  const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
    lastProviderMessageAt: string | null;
    lastMessageIngestSeq: string | null;
    conversationId: string;
  };
  return {
    lastProviderMessageAt: parsed.lastProviderMessageAt ? new Date(parsed.lastProviderMessageAt) : null,
    lastMessageIngestSeq: parsed.lastMessageIngestSeq ? BigInt(parsed.lastMessageIngestSeq) : null,
    conversationId: parsed.conversationId
  };
}

function encodeTimelineCursor(value: { providerSentAt: Date; ingestSeq: bigint } | null): string | null {
  if (!value) {
    return null;
  }
  return Buffer.from(stringifyJson(value), 'utf8').toString('base64url');
}

function parseTimelineCursor(value: string | null): { providerSentAt: Date; ingestSeq: bigint } | null {
  if (!value) {
    return null;
  }
  const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { providerSentAt: string; ingestSeq: string };
  return {
    providerSentAt: new Date(parsed.providerSentAt),
    ingestSeq: BigInt(parsed.ingestSeq)
  };
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, (_key, current) => {
    if (typeof current === 'bigint') {
      return current.toString();
    }
    if (current instanceof Date) {
      return current.toISOString();
    }
    return current;
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
