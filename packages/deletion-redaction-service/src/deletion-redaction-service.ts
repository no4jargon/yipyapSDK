import type { PostgresAttachmentRepository } from '../../storage/src/attachment-repository';
import type { PostgresConversationRepository } from '../../storage/src/conversation-repository';
import type { PostgresDeletionRecordRepository } from '../../storage/src/deletion-record-repository';
import type { PostgresMessageRepository } from '../../storage/src/message-repository';
import { refreshConversationProjectionFromLatestVisibleMessage } from '../../query-api/src/inbox-projection';
import { AppError } from '../../query-api/src/errors';

interface DeletionRedactionServiceDeps {
  messageRepository: PostgresMessageRepository;
  conversationRepository: PostgresConversationRepository;
  attachmentRepository: PostgresAttachmentRepository;
  deletionRecordRepository: PostgresDeletionRecordRepository;
  now: () => Date;
  createId: (prefix: string) => string;
}

export class DeletionRedactionService {
  constructor(private readonly deps: DeletionRedactionServiceDeps) {}

  async softDeleteMessage(input: { tenantId: string; messageId: string; reason?: string }): Promise<void> {
    const message = await this.requireMessage(input.tenantId, input.messageId);
    const now = this.deps.now();
    await this.deps.messageRepository.upsert({
      ...message,
      messageStatus: 'deleted',
      updatedAt: now
    });
    await refreshConversationProjectionFromLatestVisibleMessage({
      conversationRepository: this.deps.conversationRepository,
      messageRepository: this.deps.messageRepository,
      tenantId: input.tenantId,
      conversationId: message.conversationId,
      updatedAt: now
    });
    await this.record({
      tenantId: input.tenantId,
      targetType: 'message',
      targetId: input.messageId,
      operationType: 'soft_delete',
      reason: input.reason ?? null,
      now
    });
  }

  async redactMessage(input: { tenantId: string; messageId: string; reason?: string }): Promise<void> {
    const message = await this.requireMessage(input.tenantId, input.messageId);
    const now = this.deps.now();
    await this.deps.messageRepository.upsert({
      ...message,
      textBody: '[redacted]',
      normalizedTextBody: null,
      messageStatus: 'redacted',
      providerMetadata: {},
      rawPayloadRef: null,
      updatedAt: now
    });
    await refreshConversationProjectionFromLatestVisibleMessage({
      conversationRepository: this.deps.conversationRepository,
      messageRepository: this.deps.messageRepository,
      tenantId: input.tenantId,
      conversationId: message.conversationId,
      updatedAt: now
    });
    await this.record({
      tenantId: input.tenantId,
      targetType: 'message',
      targetId: input.messageId,
      operationType: 'redact',
      reason: input.reason ?? null,
      now
    });
  }

  async hardDeleteMessage(input: { tenantId: string; messageId: string; reason?: string }): Promise<void> {
    const message = await this.requireMessage(input.tenantId, input.messageId);
    const now = this.deps.now();
    await this.deps.messageRepository.upsert({
      ...message,
      textBody: null,
      normalizedTextBody: null,
      rawPayloadRef: null,
      providerMetadata: {},
      messageStatus: 'deleted',
      updatedAt: now
    });
    await refreshConversationProjectionFromLatestVisibleMessage({
      conversationRepository: this.deps.conversationRepository,
      messageRepository: this.deps.messageRepository,
      tenantId: input.tenantId,
      conversationId: message.conversationId,
      updatedAt: now
    });
    await this.record({
      tenantId: input.tenantId,
      targetType: 'message',
      targetId: input.messageId,
      operationType: 'hard_delete',
      reason: input.reason ?? null,
      now
    });
  }

  async softDeleteAttachment(input: { tenantId: string; attachmentId: string; reason?: string }): Promise<void> {
    const attachment = await this.requireAttachment(input.tenantId, input.attachmentId);
    const now = this.deps.now();
    await this.deps.attachmentRepository.upsert({
      ...attachment,
      downloadState: 'deleted',
      updatedAt: now
    });
    await this.record({
      tenantId: input.tenantId,
      targetType: 'attachment',
      targetId: input.attachmentId,
      operationType: 'soft_delete',
      reason: input.reason ?? null,
      now
    });
  }

  async redactAttachment(input: { tenantId: string; attachmentId: string; reason?: string }): Promise<void> {
    const attachment = await this.requireAttachment(input.tenantId, input.attachmentId);
    const now = this.deps.now();
    await this.deps.attachmentRepository.upsert({
      ...attachment,
      fileName: '[redacted]',
      storageKey: null,
      providerUrlRef: null,
      previewRef: null,
      downloadState: 'redacted',
      updatedAt: now
    });
    await this.record({
      tenantId: input.tenantId,
      targetType: 'attachment',
      targetId: input.attachmentId,
      operationType: 'redact',
      reason: input.reason ?? null,
      now
    });
  }

  async hardDeleteAttachment(input: { tenantId: string; attachmentId: string; reason?: string }): Promise<void> {
    const attachment = await this.requireAttachment(input.tenantId, input.attachmentId);
    const now = this.deps.now();
    await this.deps.attachmentRepository.upsert({
      ...attachment,
      fileName: null,
      storageKey: null,
      providerUrlRef: null,
      previewRef: null,
      downloadState: 'deleted',
      updatedAt: now
    });
    await this.record({
      tenantId: input.tenantId,
      targetType: 'attachment',
      targetId: input.attachmentId,
      operationType: 'hard_delete',
      reason: input.reason ?? null,
      now
    });
  }

  private async requireMessage(tenantId: string, messageId: string) {
    const message = await this.deps.messageRepository.getById({ tenantId, id: messageId });
    if (!message) {
      throw new AppError('not_found', `message ${messageId} was not found`);
    }
    return message;
  }

  private async requireAttachment(tenantId: string, attachmentId: string) {
    const attachment = await this.deps.attachmentRepository.getById({ tenantId, id: attachmentId });
    if (!attachment) {
      throw new AppError('not_found', `attachment ${attachmentId} was not found`);
    }
    return attachment;
  }

  private async record(input: {
    tenantId: string;
    targetType: 'message' | 'attachment';
    targetId: string;
    operationType: 'soft_delete' | 'hard_delete' | 'redact';
    reason: string | null;
    now: Date;
  }): Promise<void> {
    await this.deps.deletionRecordRepository.create({
      id: this.deps.createId('deletion'),
      tenantId: input.tenantId,
      targetType: input.targetType,
      targetId: input.targetId,
      operationType: input.operationType,
      reason: input.reason,
      requestedByRef: null,
      requestedAt: input.now,
      completedAt: input.now,
      status: 'completed'
    });
  }
}
