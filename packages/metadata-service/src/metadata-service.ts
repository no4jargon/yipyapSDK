import type { PostgresClusterRepository } from '../../storage/src/cluster-repository';
import type { PostgresConversationRepository } from '../../storage/src/conversation-repository';
import type { PostgresMessageRepository } from '../../storage/src/message-repository';
import type { PostgresMetadataRepository } from '../../storage/src/metadata-repository';
import { AppError } from '../../query-api/src/errors';

interface MetadataServiceDeps {
  messageRepository: PostgresMessageRepository;
  conversationRepository: PostgresConversationRepository;
  clusterRepository: PostgresClusterRepository;
  metadataRepository: PostgresMetadataRepository;
  now: () => Date;
  createId: (prefix: string) => string;
  maxValueBytes: number;
}

export class MetadataService {
  constructor(private readonly deps: MetadataServiceDeps) {}

  async setMetadata(input: {
    tenantId: string;
    targetType: 'message' | 'conversation' | 'participant' | 'attachment' | 'cluster';
    targetId: string;
    namespace: string;
    key: string;
    valueJson: Record<string, unknown>;
  }) {
    await this.assertTargetExists(input.tenantId, input.targetType, input.targetId);
    const serialized = JSON.stringify(input.valueJson);
    if (Buffer.byteLength(serialized, 'utf8') > this.deps.maxValueBytes) {
      throw new AppError('invalid_argument', 'metadata value exceeds configured size limit');
    }

    const history = await this.deps.metadataRepository.listByKey(input);
    return this.deps.metadataRepository.create({
      id: this.deps.createId('metadata'),
      tenantId: input.tenantId,
      targetType: input.targetType,
      targetId: input.targetId,
      namespace: input.namespace,
      key: input.key,
      valueJson: input.valueJson,
      version: history.length + 1,
      deleted: false,
      createdAt: this.deps.now()
    });
  }

  async deleteMetadata(input: {
    tenantId: string;
    targetType: 'message' | 'conversation' | 'participant' | 'attachment' | 'cluster';
    targetId: string;
    namespace: string;
    key: string;
  }) {
    await this.assertTargetExists(input.tenantId, input.targetType, input.targetId);
    const history = await this.deps.metadataRepository.listByKey(input);
    return this.deps.metadataRepository.create({
      id: this.deps.createId('metadata'),
      tenantId: input.tenantId,
      targetType: input.targetType,
      targetId: input.targetId,
      namespace: input.namespace,
      key: input.key,
      valueJson: null,
      version: history.length + 1,
      deleted: true,
      createdAt: this.deps.now()
    });
  }

  async getMetadata(input: {
    tenantId: string;
    targetType: 'message' | 'conversation' | 'participant' | 'attachment' | 'cluster';
    targetId: string;
    namespace: string;
    key: string;
  }) {
    return this.deps.metadataRepository.listByKey(input);
  }

  async listMetadata(input: {
    tenantId: string;
    targetType: 'message' | 'conversation' | 'participant' | 'attachment' | 'cluster';
    targetId: string;
  }) {
    return this.deps.metadataRepository.listByTarget(input);
  }

  private async assertTargetExists(
    tenantId: string,
    targetType: 'message' | 'conversation' | 'participant' | 'attachment' | 'cluster',
    targetId: string
  ): Promise<void> {
    if (targetType === 'message') {
      const message = await this.deps.messageRepository.getById({ tenantId, id: targetId });
      if (!message) {
        throw new AppError('not_found', `message ${targetId} was not found`);
      }
      return;
    }

    if (targetType === 'conversation') {
      const conversation = await this.deps.conversationRepository.getById({ tenantId, id: targetId });
      if (!conversation) {
        throw new AppError('not_found', `conversation ${targetId} was not found`);
      }
      return;
    }

    if (targetType === 'cluster') {
      const cluster = await this.deps.clusterRepository.getById({ tenantId, id: targetId });
      if (!cluster) {
        throw new AppError('not_found', `cluster ${targetId} was not found`);
      }
      return;
    }

    throw new AppError('unsupported', `metadata target type ${targetType} is not supported yet`);
  }
}
