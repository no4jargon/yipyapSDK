import type { PostgresEventLogRepository } from '../../event-log/src/event-log-repository';
import type { ProviderAdapter } from '../../provider-adapter-interface/src';
import type { PostgresAttachmentRepository } from '../../storage/src/attachment-repository';
import type { PostgresConnectionRepository } from '../../storage/src/connection-repository';
import type { PostgresConversationRepository } from '../../storage/src/conversation-repository';
import type { PostgresMessageRepository } from '../../storage/src/message-repository';
import { AppError } from '../../query-api/src/errors';

interface ObjectStorageLike {
  putObject(key: string, body: Buffer): Promise<void>;
}

interface AttachmentServiceDeps {
  connectionRepository: PostgresConnectionRepository;
  conversationRepository: PostgresConversationRepository;
  messageRepository: PostgresMessageRepository;
  attachmentRepository: PostgresAttachmentRepository;
  eventLogRepository: PostgresEventLogRepository;
  providerAdapter: ProviderAdapter;
  objectStorage: ObjectStorageLike;
  now: () => Date;
  createId: (prefix: string) => string;
  createStorageKey: (attachmentId: string) => string;
}

export class AttachmentService {
  constructor(private readonly deps: AttachmentServiceDeps) {}

  async requestAttachmentDownload(input: { tenantId: string; attachmentId: string }): Promise<void> {
    const attachment = await this.deps.attachmentRepository.getById({
      tenantId: input.tenantId,
      id: input.attachmentId
    });
    if (!attachment) {
      throw new AppError('not_found', `attachment ${input.attachmentId} was not found`);
    }

    if (attachment.downloadState === 'available' || attachment.downloadState === 'pending') {
      return;
    }

    const now = this.deps.now();
    await this.deps.attachmentRepository.upsert({
      ...attachment,
      downloadState: 'pending',
      downloadRequestedAt: now,
      updatedAt: now
    });

    const message = await this.requireMessage(attachment.tenantId, attachment.messageId);
    await this.deps.eventLogRepository.append({
      tenantId: input.tenantId,
      eventType: 'attachment.download.requested',
      eventFamily: 'normalized',
      connectionId: message.connectionId,
      conversationId: message.conversationId,
      messageId: message.id,
      clusterId: null,
      occurredAt: now,
      payloadJson: { attachmentId: attachment.id },
      dedupeKey: `attachment:download:requested:${attachment.id}`
    });
  }

  async processNextPendingDownload(input: { tenantId: string }): Promise<void> {
    const attachment = await this.deps.attachmentRepository.getNextPending(input);
    if (!attachment) {
      return;
    }
    if (!attachment.providerAttachmentId) {
      throw new AppError('precondition_failed', `attachment ${attachment.id} has no provider attachment ref`);
    }

    const message = await this.requireMessage(input.tenantId, attachment.messageId);
    const conversation = await this.deps.conversationRepository.getById({ tenantId: input.tenantId, id: message.conversationId });
    if (!conversation) {
      throw new AppError('not_found', `conversation ${message.conversationId} was not found`);
    }
    const connection = await this.deps.connectionRepository.getById({ tenantId: input.tenantId, id: message.connectionId });
    if (!connection) {
      throw new AppError('not_found', `connection ${message.connectionId} was not found`);
    }

    const fetched = await this.deps.providerAdapter.fetchAttachment({
      connectionId: connection.id,
      providerAttachmentRef: attachment.providerAttachmentId
    });
    const storageKey = this.deps.createStorageKey(attachment.id);
    await this.deps.objectStorage.putObject(storageKey, fetched.data);

    const now = this.deps.now();
    await this.deps.attachmentRepository.upsert({
      ...attachment,
      fileName: fetched.fileName,
      mimeType: fetched.mimeType,
      byteSize: BigInt(fetched.data.byteLength),
      storageKey,
      downloadState: 'available',
      downloadCompletedAt: now,
      updatedAt: now
    });

    await this.deps.eventLogRepository.append({
      tenantId: input.tenantId,
      eventType: 'attachment.download.completed',
      eventFamily: 'normalized',
      connectionId: connection.id,
      conversationId: conversation.id,
      messageId: message.id,
      clusterId: null,
      occurredAt: now,
      payloadJson: { attachmentId: attachment.id, storageKey },
      dedupeKey: `attachment:download:completed:${attachment.id}`
    });
  }

  private async requireMessage(tenantId: string, messageId: string) {
    const message = await this.deps.messageRepository.getById({ tenantId, id: messageId });
    if (!message) {
      throw new AppError('not_found', `message ${messageId} was not found`);
    }
    return message;
  }
}
