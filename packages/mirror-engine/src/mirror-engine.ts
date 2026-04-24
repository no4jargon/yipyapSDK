import type { PostgresEventLogRepository } from '../../event-log/src/event-log-repository';
import type { ProviderRawEvent } from '../../provider-adapter-interface/src/index';
import type { PostgresAttachmentRepository } from '../../storage/src/attachment-repository';
import type { PostgresConnectionRepository } from '../../storage/src/connection-repository';
import type { PostgresConversationRepository } from '../../storage/src/conversation-repository';
import type { PostgresConversationSyncStateRepository } from '../../storage/src/conversation-sync-state-repository';
import type { PostgresMessageRepository } from '../../storage/src/message-repository';
import type { PostgresParticipantRepository } from '../../storage/src/participant-repository';
import type { PostgresReceiptRepository } from '../../storage/src/receipt-repository';
import { applyMessageToConversationProjection, deriveMessagePreview } from '../../query-api/src/inbox-projection';
import { AppError } from '../../query-api/src/errors';

interface MirrorEngineDeps {
  connectionRepository: PostgresConnectionRepository;
  conversationRepository: PostgresConversationRepository;
  conversationSyncStateRepository: PostgresConversationSyncStateRepository;
  participantRepository: PostgresParticipantRepository;
  messageRepository: PostgresMessageRepository;
  attachmentRepository: PostgresAttachmentRepository;
  receiptRepository: PostgresReceiptRepository;
  eventLogRepository: PostgresEventLogRepository;
  now: () => Date;
  createId: (prefix: string) => string;
}

export class MirrorEngine {
  constructor(private readonly deps: MirrorEngineDeps) {}

  async ingestProviderEvent(input: { tenantId: string; event: ProviderRawEvent }): Promise<void> {
    const dedupeKey = getRawDedupeKey(input.event);
    const rawEvent = await this.deps.eventLogRepository.append({
      tenantId: input.tenantId,
      eventType: input.event.type,
      eventFamily: 'provider_raw',
      connectionId: input.event.connectionId,
      conversationId: null,
      messageId: null,
      clusterId: null,
      occurredAt: input.event.occurredAt,
      payloadJson: input.event.payload,
      dedupeKey
    });

    if (input.event.type === 'message.received') {
      await this.ingestMessageReceived(input.tenantId, input.event, rawEvent.id, rawEvent.ingestSeq, dedupeKey);
      return;
    }

    if (input.event.type === 'receipt.updated') {
      await this.ingestReceiptUpdated(input.tenantId, input.event, rawEvent.id, dedupeKey);
      return;
    }
  }

  private async ingestMessageReceived(
    tenantId: string,
    event: ProviderRawEvent,
    rawPayloadRef: string,
    rawIngestSeq: bigint,
    dedupeKey: string
  ): Promise<void> {
    const providerConversationId = asString(event.payload.providerConversationId);
    const providerMessageId = asString(event.payload.providerMessageId);
    const senderId = asOptionalString(event.payload.senderId);
    const conversation = await this.requireConversation(tenantId, event.connectionId, providerConversationId);
    const sender = senderId
      ? await this.deps.participantRepository.getByProviderParticipantId({ tenantId, connectionId: event.connectionId, providerParticipantId: senderId })
      : null;

    const createdAt = this.deps.now();
    const message = await this.deps.messageRepository.upsert({
      id: this.deps.createId('message'),
      tenantId,
      connectionId: event.connectionId,
      conversationId: conversation.id,
      providerMessageId,
      senderParticipantId: sender?.id ?? null,
      providerSenderRef: senderId,
      fromMe: false,
      messageType: mapMessageType(asString(event.payload.messageType)),
      direction: 'inbound',
      textBody: asOptionalString(event.payload.textBody),
      normalizedTextBody: normalizeBody(asOptionalString(event.payload.textBody)),
      quotedMessageId: null,
      replyToProviderMessageId: null,
      providerSentAt: event.occurredAt,
      mirroredAt: createdAt,
      ingestSeq: rawIngestSeq,
      messageStatus: 'delivered',
      hasAttachments: Boolean(event.payload.attachmentRef),
      messagePreviewText: deriveMessagePreview({
        messageType: mapMessageType(asString(event.payload.messageType)),
        textBody: asOptionalString(event.payload.textBody),
        messageStatus: 'delivered',
        fileName: asOptionalString(event.payload.fileName)
      }),
      providerMetadata: {},
      rawPayloadRef,
      createdAt,
      updatedAt: createdAt
    });

    await applyMessageToConversationProjection({
      conversationRepository: this.deps.conversationRepository,
      conversationSyncStateRepository: this.deps.conversationSyncStateRepository,
      createId: this.deps.createId,
      conversation,
      message: message.record,
      updatedAt: createdAt,
      bootstrapState: 'ready'
    });

    await this.deps.eventLogRepository.append({
      tenantId,
      eventType: 'message.mirrored',
      eventFamily: 'normalized',
      connectionId: event.connectionId,
      conversationId: conversation.id,
      messageId: message.record.id,
      clusterId: null,
      occurredAt: createdAt,
      payloadJson: { providerMessageId },
      dedupeKey: `${dedupeKey}:normalized:message`
    });

    if (!event.payload.attachmentRef) {
      return;
    }

    const attachment = await this.deps.attachmentRepository.upsert({
      id: this.deps.createId('attachment'),
      tenantId,
      messageId: message.record.id,
      providerAttachmentId: asString(event.payload.attachmentRef),
      attachmentType: mapAttachmentType(message.record.messageType),
      fileName: asOptionalString(event.payload.fileName),
      mimeType: asOptionalString(event.payload.mimeType),
      byteSize: asOptionalNumber(event.payload.byteSize) === null ? null : BigInt(asOptionalNumber(event.payload.byteSize)!),
      checksumSha256: null,
      storageKey: null,
      downloadState: 'not_requested',
      providerUrlRef: null,
      previewRef: null,
      downloadRequestedAt: null,
      downloadCompletedAt: null,
      providerMetadata: {},
      createdAt,
      updatedAt: createdAt
    });

    await this.deps.eventLogRepository.append({
      tenantId,
      eventType: 'attachment.discovered',
      eventFamily: 'normalized',
      connectionId: event.connectionId,
      conversationId: conversation.id,
      messageId: message.record.id,
      clusterId: null,
      occurredAt: createdAt,
      payloadJson: { attachmentId: attachment.record.id },
      dedupeKey: `${dedupeKey}:normalized:attachment`
    });
  }

  private async ingestReceiptUpdated(
    tenantId: string,
    event: ProviderRawEvent,
    rawPayloadRef: string,
    dedupeKey: string
  ): Promise<void> {
    const providerConversationId = asString(event.payload.providerConversationId);
    const providerMessageId = asString(event.payload.providerMessageId);
    const conversation = await this.requireConversation(tenantId, event.connectionId, providerConversationId);
    const message = await this.deps.messageRepository.getByProviderMessageId({ tenantId, conversationId: conversation.id, providerMessageId });
    if (!message) {
      throw new AppError('not_found', `message ${providerMessageId} was not found`);
    }

    const providerParticipantId = asOptionalString(event.payload.participantId);
    const participant = providerParticipantId
      ? await this.deps.participantRepository.getByProviderParticipantId({ tenantId, connectionId: event.connectionId, providerParticipantId })
      : null;
    const observedAt = this.deps.now();
    await this.deps.receiptRepository.upsert({
      id: this.deps.createId('receipt'),
      tenantId,
      messageId: message.id,
      receiptType: mapReceiptType(asString(event.payload.receiptType)),
      participantId: participant?.id ?? null,
      providerAt: new Date(asString(event.payload.providerAt)),
      observedAt,
      createdAt: observedAt
    });

    await this.deps.eventLogRepository.append({
      tenantId,
      eventType: 'receipt.observed',
      eventFamily: 'normalized',
      connectionId: event.connectionId,
      conversationId: conversation.id,
      messageId: message.id,
      clusterId: null,
      occurredAt: observedAt,
      payloadJson: { providerMessageId, rawPayloadRef },
      dedupeKey: `${dedupeKey}:normalized:receipt`
    });
  }

  private async requireConversation(tenantId: string, connectionId: string, providerConversationId: string) {
    const conversation = await this.deps.conversationRepository.getByProviderConversationId({ tenantId, connectionId, providerConversationId });
    if (!conversation) {
      throw new AppError('not_found', `conversation ${providerConversationId} was not found`);
    }
    return conversation;
  }
}

function getRawDedupeKey(event: ProviderRawEvent): string {
  const explicit = asOptionalString(event.payload.dedupeKey);
  if (explicit) {
    return explicit;
  }
  const providerConversationId = asOptionalString(event.payload.providerConversationId) ?? 'none';
  const providerMessageId = asOptionalString(event.payload.providerMessageId) ?? 'none';
  const receiptType = asOptionalString(event.payload.receiptType) ?? 'none';
  return `${event.connectionId}:${event.type}:${providerConversationId}:${providerMessageId}:${receiptType}`;
}

function normalizeBody(value: string | null): string | null {
  return value === null ? null : value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function asString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new AppError('invalid_argument', 'expected string payload field');
  }
  return value;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function mapMessageType(value: string): 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'reaction' | 'system' | 'unknown' {
  if (value === 'text' || value === 'image' || value === 'video' || value === 'audio' || value === 'document' || value === 'sticker' || value === 'reaction' || value === 'system') {
    return value;
  }
  return 'unknown';
}

function mapAttachmentType(messageType: string): 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'unknown' {
  if (messageType === 'image' || messageType === 'video' || messageType === 'audio' || messageType === 'document' || messageType === 'sticker') {
    return messageType;
  }
  return 'unknown';
}

function mapReceiptType(value: string): 'server_ack' | 'delivered' | 'read' {
  if (value === 'server_ack' || value === 'delivered' || value === 'read') {
    return value;
  }
  throw new AppError('invalid_argument', `unsupported receipt type ${value}`);
}
