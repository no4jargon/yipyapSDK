import type { PostgresEventLogRepository } from '../../event-log/src/event-log-repository';
import type { ProviderAdapter, ProviderHistoryMessage } from '../../provider-adapter-interface/src/index';
import type { PostgresAttachmentRepository } from '../../storage/src/attachment-repository';
import type { PostgresConnectionRepository } from '../../storage/src/connection-repository';
import type { PostgresConversationRepository } from '../../storage/src/conversation-repository';
import type { PostgresConversationSyncStateRepository } from '../../storage/src/conversation-sync-state-repository';
import type { PostgresHistoryImportRepository } from '../../storage/src/history-import-repository';
import type { PostgresMessageRepository } from '../../storage/src/message-repository';
import type { PostgresParticipantRepository } from '../../storage/src/participant-repository';
import { applyMessageToConversationProjection, deriveMessagePreview, ensureConversationSyncState } from '../../query-api/src/inbox-projection';
import { AppError } from '../../query-api/src/errors';
import type { ImportScheduler } from './import-scheduler';

interface HistoryImportServiceDeps {
  connectionRepository: PostgresConnectionRepository;
  conversationRepository: PostgresConversationRepository;
  conversationSyncStateRepository: PostgresConversationSyncStateRepository;
  participantRepository: PostgresParticipantRepository;
  messageRepository: PostgresMessageRepository;
  attachmentRepository: PostgresAttachmentRepository;
  historyImportRepository: PostgresHistoryImportRepository;
  eventLogRepository: PostgresEventLogRepository;
  providerAdapter: ProviderAdapter;
  now: () => Date;
  createId: (prefix: string) => string;
}

export class HistoryImportService implements ImportScheduler {
  constructor(private readonly deps: HistoryImportServiceDeps) {}

  async scheduleConversationImport(input: { tenantId: string; conversationId: string }): Promise<void> {
    const conversation = await this.deps.conversationRepository.getById({
      tenantId: input.tenantId,
      id: input.conversationId
    });
    if (!conversation) {
      throw new AppError('not_found', `conversation ${input.conversationId} was not found`);
    }

    await this.deps.historyImportRepository.schedule({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      now: this.deps.now(),
      id: this.deps.createId('import')
    });
  }

  async runNextScheduledImport(input: { tenantId: string }): Promise<void> {
    const state = await this.deps.historyImportRepository.getNextRunnable({
      tenantId: input.tenantId
    });
    if (!state) {
      return;
    }

    const conversation = await this.deps.conversationRepository.getById({
      tenantId: input.tenantId,
      id: state.conversationId
    });
    if (!conversation) {
      throw new AppError('not_found', `conversation ${state.conversationId} was not found`);
    }
    if (!conversation.isSelected) {
      return;
    }

    const connection = await this.deps.connectionRepository.getById({
      tenantId: input.tenantId,
      id: conversation.connectionId
    });
    if (!connection) {
      throw new AppError('not_found', `connection ${conversation.connectionId} was not found`);
    }

    const now = this.deps.now();
    await ensureConversationSyncState({
      conversationSyncStateRepository: this.deps.conversationSyncStateRepository,
      createId: this.deps.createId,
      conversation,
      now,
      bootstrapState: 'queued'
    });

    if (state.importState === 'not_started') {
      await this.deps.historyImportRepository.update({
        tenantId: input.tenantId,
        conversationId: conversation.id,
        importState: 'running',
        anchorCursor: state.anchorCursor,
        lastStartedAt: now,
        updatedAt: now
      });

      const existingSyncState = await this.deps.conversationSyncStateRepository.getByConversationId({ tenantId: input.tenantId, conversationId: conversation.id });
      if (existingSyncState) {
        await this.deps.conversationSyncStateRepository.upsert({
          ...existingSyncState,
          bootstrapState: 'running',
          updatedAt: now
        });
      }

      await this.deps.eventLogRepository.append({
        tenantId: input.tenantId,
        eventType: 'history_import.started',
        eventFamily: 'normalized',
        connectionId: connection.id,
        conversationId: conversation.id,
        messageId: null,
        clusterId: null,
        occurredAt: now,
        payloadJson: { conversationId: conversation.id },
        dedupeKey: `history:${conversation.id}:started`
      });
    }

    const page = await this.deps.providerAdapter.requestHistoryPage({
      connectionId: connection.id,
      providerConversationId: conversation.providerConversationId,
      pageDirection: 'backward',
      anchor: state.anchorCursor ? { cursor: state.anchorCursor } : undefined,
      pageSizeDays: 7
    });

    for (const historyMessage of page.messages) {
      await this.upsertHistoryMessage(input.tenantId, connection.id, conversation.id, historyMessage, page.nextAnchor?.cursor ?? null);
    }

    const updatedAt = this.deps.now();
    await this.deps.eventLogRepository.append({
      tenantId: input.tenantId,
      eventType: 'history_import.page_completed',
      eventFamily: 'normalized',
      connectionId: connection.id,
      conversationId: conversation.id,
      messageId: null,
      clusterId: null,
      occurredAt: updatedAt,
      payloadJson: {
        messageCount: page.messages.length,
        nextAnchor: page.nextAnchor?.cursor ?? null
      },
      dedupeKey: `history:${conversation.id}:page:${state.anchorCursor ?? 'initial'}`
    });

    if (page.nextAnchor) {
      await this.deps.historyImportRepository.update({
        tenantId: input.tenantId,
        conversationId: conversation.id,
        importState: 'running',
        anchorCursor: page.nextAnchor.cursor,
        updatedAt
      });
      return;
    }

    await this.deps.historyImportRepository.update({
      tenantId: input.tenantId,
      conversationId: conversation.id,
      importState: 'completed',
      anchorCursor: null,
      lastCompletedAt: updatedAt,
      updatedAt
    });

    await this.deps.eventLogRepository.append({
      tenantId: input.tenantId,
      eventType: 'history_import.completed',
      eventFamily: 'normalized',
      connectionId: connection.id,
      conversationId: conversation.id,
      messageId: null,
      clusterId: null,
      occurredAt: updatedAt,
      payloadJson: { conversationId: conversation.id },
      dedupeKey: `history:${conversation.id}:completed`
    });
  }

  private async upsertHistoryMessage(
    tenantId: string,
    connectionId: string,
    conversationId: string,
    historyMessage: ProviderHistoryMessage,
    nextAnchorCursor: string | null
  ): Promise<void> {
    const sender = await this.deps.participantRepository.getByProviderParticipantId({
      tenantId,
      connectionId,
      providerParticipantId: historyMessage.senderId
    });
    const mirroredAt = this.deps.now();
    const mirroredEvent = await this.deps.eventLogRepository.append({
      tenantId,
      eventType: 'message.mirrored',
      eventFamily: 'normalized',
      connectionId,
      conversationId,
      messageId: null,
      clusterId: null,
      occurredAt: mirroredAt,
      payloadJson: { providerMessageId: historyMessage.providerMessageId },
      dedupeKey: `history:${conversationId}:message:${historyMessage.providerMessageId}`
    });

    const existingMessage = await this.deps.messageRepository.getByProviderMessageId({
      tenantId,
      conversationId,
      providerMessageId: historyMessage.providerMessageId
    });

    const messageType = mapMessageType(historyMessage.messageType);
    const message = await this.deps.messageRepository.upsert({
      id: existingMessage?.id ?? await this.createUniqueMessageId(tenantId),
      tenantId,
      connectionId,
      conversationId,
      providerMessageId: historyMessage.providerMessageId,
      senderParticipantId: sender?.id ?? null,
      providerSenderRef: historyMessage.senderId,
      fromMe: false,
      messageType,
      direction: 'inbound',
      textBody: historyMessage.textBody ?? null,
      normalizedTextBody: normalizeText(historyMessage.textBody),
      quotedMessageId: null,
      replyToProviderMessageId: null,
      providerSentAt: historyMessage.sentAt,
      mirroredAt,
      ingestSeq: mirroredEvent.ingestSeq,
      messageStatus: 'delivered',
      hasAttachments: Boolean(historyMessage.attachmentRef),
      messagePreviewText: deriveMessagePreview({
        messageType,
        textBody: historyMessage.textBody ?? null,
        messageStatus: 'delivered',
        fileName: historyMessage.fileName ?? null
      }),
      providerMetadata: {},
      rawPayloadRef: null,
      createdAt: mirroredAt,
      updatedAt: mirroredAt
    });

    const conversation = await this.deps.conversationRepository.getById({ tenantId, id: conversationId });
    if (conversation) {
      await applyMessageToConversationProjection({
        conversationRepository: this.deps.conversationRepository,
        conversationSyncStateRepository: this.deps.conversationSyncStateRepository,
        createId: this.deps.createId,
        conversation,
        message: message.record,
        updatedAt: mirroredAt,
        bootstrapState: nextAnchorCursor ? 'partial' : 'ready',
        olderHistoryPossible: nextAnchorCursor !== null,
        lastBackfillAnchorCursor: nextAnchorCursor,
        lastBackfillCompletedAt: nextAnchorCursor ? null : mirroredAt
      });
    }

    if (!historyMessage.attachmentRef) {
      return;
    }

    const existingAttachment = await this.deps.attachmentRepository.getByProviderAttachmentId({
      tenantId,
      messageId: message.record.id,
      providerAttachmentId: historyMessage.attachmentRef
    });

    await this.deps.attachmentRepository.upsert({
      id: existingAttachment?.id ?? this.deps.createId('attachment'),
      tenantId,
      messageId: message.record.id,
      providerAttachmentId: historyMessage.attachmentRef,
      attachmentType: mapAttachmentType(historyMessage.messageType),
      fileName: historyMessage.fileName ?? null,
      mimeType: null,
      byteSize: null,
      checksumSha256: null,
      storageKey: null,
      downloadState: 'not_requested',
      providerUrlRef: null,
      previewRef: null,
      downloadRequestedAt: null,
      downloadCompletedAt: null,
      providerMetadata: {},
      createdAt: mirroredAt,
      updatedAt: mirroredAt
    });

    await this.deps.eventLogRepository.append({
      tenantId,
      eventType: 'attachment.discovered',
      eventFamily: 'normalized',
      connectionId,
      conversationId,
      messageId: message.record.id,
      clusterId: null,
      occurredAt: mirroredAt,
      payloadJson: { providerAttachmentId: historyMessage.attachmentRef },
      dedupeKey: `history:${conversationId}:attachment:${historyMessage.attachmentRef}`
    });
  }

  private async createUniqueMessageId(tenantId: string): Promise<string> {
    let candidate = this.deps.createId('message');

    while (await this.deps.messageRepository.getById({ tenantId, id: candidate })) {
      candidate = this.deps.createId('message');
    }

    return candidate;
  }
}

function normalizeText(value: string | undefined): string | null {
  return value ? value.trim().replace(/\s+/g, ' ').toLowerCase() : null;
}

function mapMessageType(value: ProviderHistoryMessage['messageType']) {
  if (value === 'text' || value === 'image' || value === 'document') {
    return value;
  }
  return 'unknown';
}

function mapAttachmentType(value: ProviderHistoryMessage['messageType']) {
  if (value === 'image' || value === 'document') {
    return value;
  }
  return 'unknown';
}
