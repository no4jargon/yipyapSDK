import type { PostgresEventLogRepository } from '../../event-log/src/event-log-repository';
import type { ProviderAdapter, ProviderAttachmentSource } from '../../provider-adapter-interface/src/index';
import type { PostgresAttachmentRepository } from '../../storage/src/attachment-repository';
import type { PostgresConnectionRepository } from '../../storage/src/connection-repository';
import type { PostgresConversationRepository } from '../../storage/src/conversation-repository';
import type { PostgresConversationSyncStateRepository } from '../../storage/src/conversation-sync-state-repository';
import type { PostgresMessageRepository } from '../../storage/src/message-repository';
import type { PostgresParticipantRepository } from '../../storage/src/participant-repository';
import { applyMessageToConversationProjection, deriveMessagePreview } from './inbox-projection';
import { AppError } from './errors';

interface SendPipelineServiceDeps {
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

export class SendPipelineService {
  constructor(private readonly deps: SendPipelineServiceDeps) {}

  async sendTextMessage(input: {
    tenantId: string;
    conversationId: string;
    text: string;
    clientMessageId?: string;
  }): Promise<{ messageId: string; providerMessageId: string }> {
    const context = await this.getContext(input.tenantId, input.conversationId);
    const providerResult = await this.deps.providerAdapter.sendTextMessage({
      connectionId: context.connection.id,
      providerConversationId: context.conversation.providerConversationId,
      text: input.text,
      clientMessageId: input.clientMessageId
    });

    const occurredAt = this.deps.now();
    const event = await this.deps.eventLogRepository.append({
      tenantId: input.tenantId,
      eventType: 'message.sent',
      eventFamily: 'normalized',
      connectionId: context.connection.id,
      conversationId: context.conversation.id,
      messageId: null,
      clusterId: null,
      occurredAt,
      payloadJson: {
        providerMessageId: providerResult.providerMessageId,
        clientMessageId: input.clientMessageId ?? null
      },
      dedupeKey: input.clientMessageId ? `send:text:${context.conversation.id}:${input.clientMessageId}` : null
    });

    const message = await this.deps.messageRepository.upsert({
      id: this.deps.createId('message'),
      tenantId: input.tenantId,
      connectionId: context.connection.id,
      conversationId: context.conversation.id,
      providerMessageId: providerResult.providerMessageId,
      senderParticipantId: context.selfParticipant.id,
      providerSenderRef: context.selfParticipant.providerParticipantId,
      fromMe: true,
      messageType: 'text',
      direction: 'outbound',
      textBody: input.text,
      normalizedTextBody: normalizeText(input.text),
      quotedMessageId: null,
      replyToProviderMessageId: null,
      providerSentAt: providerResult.providerTimestamp,
      mirroredAt: occurredAt,
      ingestSeq: event.ingestSeq,
      messageStatus: 'sent',
      hasAttachments: false,
      messagePreviewText: deriveMessagePreview({
        messageType: 'text',
        textBody: input.text,
        messageStatus: 'sent'
      }),
      providerMetadata: {},
      rawPayloadRef: null,
      createdAt: occurredAt,
      updatedAt: occurredAt
    });

    await applyMessageToConversationProjection({
      conversationRepository: this.deps.conversationRepository,
      conversationSyncStateRepository: this.deps.conversationSyncStateRepository,
      createId: this.deps.createId,
      conversation: context.conversation,
      message: message.record,
      updatedAt: occurredAt,
      bootstrapState: 'ready'
    });

    return {
      messageId: message.record.id,
      providerMessageId: providerResult.providerMessageId
    };
  }

  async sendAttachmentMessage(input: {
    tenantId: string;
    conversationId: string;
    attachmentSource: ProviderAttachmentSource;
    caption?: string;
    clientMessageId?: string;
  }): Promise<{ messageId: string; providerMessageId: string; attachmentId: string }> {
    const context = await this.getContext(input.tenantId, input.conversationId);
    const providerResult = await this.deps.providerAdapter.sendAttachmentMessage({
      connectionId: context.connection.id,
      providerConversationId: context.conversation.providerConversationId,
      attachmentSource: input.attachmentSource,
      caption: input.caption,
      clientMessageId: input.clientMessageId
    });

    const occurredAt = this.deps.now();
    const messageEvent = await this.deps.eventLogRepository.append({
      tenantId: input.tenantId,
      eventType: 'message.sent',
      eventFamily: 'normalized',
      connectionId: context.connection.id,
      conversationId: context.conversation.id,
      messageId: null,
      clusterId: null,
      occurredAt,
      payloadJson: {
        providerMessageId: providerResult.providerMessageId,
        clientMessageId: input.clientMessageId ?? null
      },
      dedupeKey: input.clientMessageId ? `send:attachment:${context.conversation.id}:${input.clientMessageId}` : null
    });

    const attachmentMessageType = inferAttachmentMessageType(input.attachmentSource.mimeType);
    const message = await this.deps.messageRepository.upsert({
      id: this.deps.createId('message'),
      tenantId: input.tenantId,
      connectionId: context.connection.id,
      conversationId: context.conversation.id,
      providerMessageId: providerResult.providerMessageId,
      senderParticipantId: context.selfParticipant.id,
      providerSenderRef: context.selfParticipant.providerParticipantId,
      fromMe: true,
      messageType: attachmentMessageType,
      direction: 'outbound',
      textBody: input.caption ?? null,
      normalizedTextBody: normalizeOptionalText(input.caption),
      quotedMessageId: null,
      replyToProviderMessageId: null,
      providerSentAt: providerResult.providerTimestamp,
      mirroredAt: occurredAt,
      ingestSeq: messageEvent.ingestSeq,
      messageStatus: 'sent',
      hasAttachments: true,
      messagePreviewText: deriveMessagePreview({
        messageType: attachmentMessageType,
        textBody: input.caption ?? null,
        messageStatus: 'sent',
        fileName: input.attachmentSource.fileName
      }),
      providerMetadata: {},
      rawPayloadRef: null,
      createdAt: occurredAt,
      updatedAt: occurredAt
    });

    await applyMessageToConversationProjection({
      conversationRepository: this.deps.conversationRepository,
      conversationSyncStateRepository: this.deps.conversationSyncStateRepository,
      createId: this.deps.createId,
      conversation: context.conversation,
      message: message.record,
      updatedAt: occurredAt,
      bootstrapState: 'ready'
    });

    const attachment = await this.deps.attachmentRepository.upsert({
      id: this.deps.createId('attachment'),
      tenantId: input.tenantId,
      messageId: message.record.id,
      providerAttachmentId: null,
      attachmentType: inferAttachmentType(input.attachmentSource.mimeType),
      fileName: input.attachmentSource.fileName,
      mimeType: input.attachmentSource.mimeType,
      byteSize: BigInt(input.attachmentSource.data.byteLength),
      checksumSha256: null,
      storageKey: null,
      downloadState: 'available',
      providerUrlRef: null,
      previewRef: null,
      downloadRequestedAt: null,
      downloadCompletedAt: occurredAt,
      providerMetadata: {},
      createdAt: occurredAt,
      updatedAt: occurredAt
    });

    await this.deps.eventLogRepository.append({
      tenantId: input.tenantId,
      eventType: 'attachment.discovered',
      eventFamily: 'normalized',
      connectionId: context.connection.id,
      conversationId: context.conversation.id,
      messageId: message.record.id,
      clusterId: null,
      occurredAt,
      payloadJson: {
        attachmentId: attachment.record.id,
        providerMessageId: providerResult.providerMessageId
      },
      dedupeKey: input.clientMessageId ? `send:attachment:event:${context.conversation.id}:${input.clientMessageId}` : null
    });

    return {
      messageId: message.record.id,
      providerMessageId: providerResult.providerMessageId,
      attachmentId: attachment.record.id
    };
  }

  private async getContext(tenantId: string, conversationId: string) {
    const conversation = await this.deps.conversationRepository.getById({ tenantId, id: conversationId });
    if (!conversation) {
      throw new AppError('not_found', `conversation ${conversationId} was not found`);
    }

    const connection = await this.deps.connectionRepository.getById({
      tenantId,
      id: conversation.connectionId
    });
    if (!connection) {
      throw new AppError('not_found', `connection ${conversation.connectionId} was not found`);
    }

    const selfParticipant = await this.deps.participantRepository.getByProviderParticipantId({
      tenantId,
      connectionId: connection.id,
      providerParticipantId: 'participant_self'
    });
    if (!selfParticipant) {
      throw new AppError('not_found', `self participant for connection ${connection.id} was not found`);
    }

    return { conversation, connection, selfParticipant };
  }
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeOptionalText(value: string | undefined): string | null {
  return value ? normalizeText(value) : null;
}

function inferAttachmentMessageType(mimeType: string): 'image' | 'video' | 'audio' | 'document' {
  if (mimeType.startsWith('image/')) {
    return 'image';
  }
  if (mimeType.startsWith('video/')) {
    return 'video';
  }
  if (mimeType.startsWith('audio/')) {
    return 'audio';
  }
  return 'document';
}

function inferAttachmentType(mimeType: string): 'image' | 'video' | 'audio' | 'document' {
  return inferAttachmentMessageType(mimeType);
}
