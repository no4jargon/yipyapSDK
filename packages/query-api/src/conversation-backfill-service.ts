import type { PostgresEventLogRepository } from '../../event-log/src/event-log-repository';
import type { ProviderAdapter, ProviderHistoryMessage } from '../../provider-adapter-interface/src';
import type { PostgresAttachmentRepository } from '../../storage/src/attachment-repository';
import type { PostgresConnectionRepository } from '../../storage/src/connection-repository';
import type { PostgresConversationRepository } from '../../storage/src/conversation-repository';
import type { PostgresConversationSyncStateRepository } from '../../storage/src/conversation-sync-state-repository';
import type { PostgresMessageRepository } from '../../storage/src/message-repository';
import type { PostgresParticipantRepository } from '../../storage/src/participant-repository';
import { applyMessageToConversationProjection, deriveMessagePreview, ensureConversationSyncState } from './inbox-projection';
import { AppError } from './errors';

interface ConversationBackfillServiceDeps {
  connectionRepository: PostgresConnectionRepository;
  conversationRepository: PostgresConversationRepository;
  conversationSyncStateRepository: PostgresConversationSyncStateRepository;
  participantRepository: PostgresParticipantRepository;
  messageRepository: PostgresMessageRepository;
  attachmentRepository: PostgresAttachmentRepository;
  eventLogRepository: PostgresEventLogRepository;
  providerAdapter: ProviderAdapter;
  now: () => Date;
  createId: (prefix: string) => string;
}

export class ConversationBackfillService {
  constructor(private readonly deps: ConversationBackfillServiceDeps) {}

  async backfillOlderHistory(input: {
    tenantId: string;
    conversationId: string;
    pageSizeDays?: 7;
  }): Promise<{
    conversationId: string;
    status: 'idle' | 'running' | 'completed';
    backfillState: 'idle' | 'queued' | 'running' | 'paused' | 'exhausted' | 'failed';
    earliestMirroredAt: Date | null;
    olderHistoryPossible: boolean;
  }> {
    const conversation = await this.deps.conversationRepository.getById({ tenantId: input.tenantId, id: input.conversationId });
    if (!conversation) {
      throw new AppError('not_found', `conversation ${input.conversationId} was not found`);
    }
    const connection = await this.deps.connectionRepository.getById({ tenantId: input.tenantId, id: conversation.connectionId });
    if (!connection) {
      throw new AppError('not_found', `connection ${conversation.connectionId} was not found`);
    }

    const now = this.deps.now();
    await ensureConversationSyncState({
      conversationSyncStateRepository: this.deps.conversationSyncStateRepository,
      createId: this.deps.createId,
      conversation,
      now,
      bootstrapState: 'ready'
    });

    const current = await this.deps.conversationSyncStateRepository.getByConversationId({ tenantId: input.tenantId, conversationId: conversation.id });
    if (!current) {
      throw new AppError('internal_error', `sync state for conversation ${conversation.id} was not initialized`);
    }
    if (current.backfillState === 'running' || current.backfillState === 'queued') {
      return {
        conversationId: conversation.id,
        status: 'running',
        backfillState: current.backfillState,
        earliestMirroredAt: current.earliestMirroredProviderSentAt,
        olderHistoryPossible: current.olderHistoryPossible
      };
    }

    await this.deps.conversationSyncStateRepository.upsert({
      ...current,
      backfillState: 'running',
      lastBackfillRequestedAt: now,
      updatedAt: now
    });

    await this.deps.eventLogRepository.append({
      tenantId: input.tenantId,
      eventType: 'backfill.started',
      eventFamily: 'system',
      connectionId: connection.id,
      conversationId: conversation.id,
      messageId: null,
      clusterId: null,
      occurredAt: now,
      payloadJson: { conversationId: conversation.id },
      dedupeKey: null
    });

    const page = await this.deps.providerAdapter.requestHistoryPage({
      connectionId: connection.id,
      providerConversationId: conversation.providerConversationId,
      pageDirection: 'backward',
      anchor: current.lastBackfillAnchorCursor ? { cursor: current.lastBackfillAnchorCursor } : undefined,
      pageSizeDays: input.pageSizeDays ?? 7
    });

    for (const historyMessage of page.messages) {
      await this.upsertHistoryMessage(input.tenantId, connection.id, conversation, historyMessage, page.nextAnchor?.cursor ?? null, now);
    }

    const updatedState = await this.deps.conversationSyncStateRepository.getByConversationId({ tenantId: input.tenantId, conversationId: conversation.id });
    if (!updatedState) {
      throw new AppError('internal_error', `sync state for conversation ${conversation.id} disappeared`);
    }

    const completedAt = this.deps.now();
    const finalState = await this.deps.conversationSyncStateRepository.upsert({
      ...updatedState,
      backfillState: page.nextAnchor ? 'idle' : 'exhausted',
      lastBackfillAnchorCursor: page.nextAnchor?.cursor ?? null,
      lastBackfillCompletedAt: completedAt,
      olderHistoryPossible: page.nextAnchor !== null,
      updatedAt: completedAt
    });

    await this.deps.eventLogRepository.append({
      tenantId: input.tenantId,
      eventType: 'backfill.completed',
      eventFamily: 'system',
      connectionId: connection.id,
      conversationId: conversation.id,
      messageId: null,
      clusterId: null,
      occurredAt: completedAt,
      payloadJson: { conversationId: conversation.id, messageCount: page.messages.length },
      dedupeKey: null
    });

    return {
      conversationId: conversation.id,
      status: 'completed',
      backfillState: finalState.backfillState,
      earliestMirroredAt: finalState.earliestMirroredProviderSentAt,
      olderHistoryPossible: finalState.olderHistoryPossible
    };
  }

  private async upsertHistoryMessage(
    tenantId: string,
    connectionId: string,
    conversation: NonNullable<Awaited<ReturnType<PostgresConversationRepository['getById']>>>,
    historyMessage: ProviderHistoryMessage,
    nextAnchorCursor: string | null,
    now: Date
  ): Promise<void> {
    const sender = await this.deps.participantRepository.getByProviderParticipantId({
      tenantId,
      connectionId,
      providerParticipantId: historyMessage.senderId
    });

    const mirroredEvent = await this.deps.eventLogRepository.append({
      tenantId,
      eventType: 'message.mirrored',
      eventFamily: 'normalized',
      connectionId,
      conversationId: conversation.id,
      messageId: null,
      clusterId: null,
      occurredAt: now,
      payloadJson: { providerMessageId: historyMessage.providerMessageId, source: 'backfill' },
      dedupeKey: `backfill:${conversation.id}:message:${historyMessage.providerMessageId}`
    });

    const existingMessage = await this.deps.messageRepository.getByProviderMessageId({
      tenantId,
      conversationId: conversation.id,
      providerMessageId: historyMessage.providerMessageId
    });
    const messageType = mapMessageType(historyMessage.messageType);
    const message = await this.deps.messageRepository.upsert({
      id: existingMessage?.id ?? this.deps.createId('message'),
      tenantId,
      connectionId,
      conversationId: conversation.id,
      providerMessageId: historyMessage.providerMessageId,
      senderParticipantId: sender?.id ?? null,
      providerSenderRef: historyMessage.senderId,
      fromMe: false,
      messageType,
      direction: 'inbound',
      textBody: historyMessage.textBody ?? null,
      normalizedTextBody: normalizeOptionalText(historyMessage.textBody),
      quotedMessageId: null,
      replyToProviderMessageId: null,
      providerSentAt: historyMessage.sentAt,
      mirroredAt: now,
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
      createdAt: now,
      updatedAt: now
    });

    await applyMessageToConversationProjection({
      conversationRepository: this.deps.conversationRepository,
      conversationSyncStateRepository: this.deps.conversationSyncStateRepository,
      createId: this.deps.createId,
      conversation,
      message: message.record,
      updatedAt: now,
      bootstrapState: 'ready',
      backfillState: 'running',
      olderHistoryPossible: nextAnchorCursor !== null,
      lastBackfillAnchorCursor: nextAnchorCursor,
      lastBackfillRequestedAt: now
    });

    if (!historyMessage.attachmentRef) {
      return;
    }

    await this.deps.attachmentRepository.upsert({
      id: this.deps.createId('attachment'),
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
      createdAt: now,
      updatedAt: now
    });

    await this.deps.eventLogRepository.append({
      tenantId,
      eventType: 'attachment.discovered',
      eventFamily: 'normalized',
      connectionId,
      conversationId: conversation.id,
      messageId: message.record.id,
      clusterId: null,
      occurredAt: now,
      payloadJson: { providerAttachmentId: historyMessage.attachmentRef },
      dedupeKey: `backfill:${conversation.id}:attachment:${historyMessage.attachmentRef}`
    });
  }
}

function normalizeOptionalText(value: string | undefined): string | null {
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
