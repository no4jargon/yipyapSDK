import type { PostgresClusterConversationRepository } from '../../storage/src/cluster-conversation-repository';
import type { PostgresClusterRepository } from '../../storage/src/cluster-repository';
import type { PostgresConversationRepository } from '../../storage/src/conversation-repository';
import type { PostgresMessageRepository } from '../../storage/src/message-repository';
import { AppError } from '../../query-api/src/errors';

interface ClusterServiceDeps {
  clusterRepository: PostgresClusterRepository;
  clusterConversationRepository: PostgresClusterConversationRepository;
  conversationRepository: PostgresConversationRepository;
  messageRepository: PostgresMessageRepository;
  now: () => Date;
  createId: (prefix: string) => string;
}

export class ClusterService {
  constructor(private readonly deps: ClusterServiceDeps) {}

  async createCluster(input: { tenantId: string; name: string; description?: string }) {
    return this.deps.clusterRepository.create({
      id: this.deps.createId('cluster'),
      tenantId: input.tenantId,
      name: input.name,
      description: input.description ?? null,
      clusterType: 'manual',
      archived: false,
      createdAt: this.deps.now(),
      updatedAt: this.deps.now()
    });
  }

  async addConversationToCluster(input: { tenantId: string; clusterId: string; conversationId: string }) {
    const cluster = await this.deps.clusterRepository.getById({ tenantId: input.tenantId, id: input.clusterId });
    if (!cluster) {
      throw new AppError('not_found', `cluster ${input.clusterId} was not found`);
    }
    const conversation = await this.deps.conversationRepository.getById({ tenantId: input.tenantId, id: input.conversationId });
    if (!conversation) {
      throw new AppError('not_found', `conversation ${input.conversationId} was not found`);
    }

    return this.deps.clusterConversationRepository.add({
      id: this.deps.createId('cluster_conversation'),
      tenantId: input.tenantId,
      clusterId: input.clusterId,
      conversationId: input.conversationId,
      addedAt: this.deps.now()
    });
  }

  async listClusterConversations(input: { tenantId: string; clusterId: string }) {
    return this.deps.clusterConversationRepository.listByCluster(input);
  }

  async getClusterTimeline(input: { tenantId: string; clusterId: string }) {
    const memberships = await this.deps.clusterConversationRepository.listByCluster(input);
    const messages = await Promise.all(
      memberships.map((membership) =>
        this.deps.messageRepository.listByConversation({
          tenantId: input.tenantId,
          conversationId: membership.conversationId
        })
      )
    );

    return messages
      .flat()
      .sort((left, right) => {
        const sentCompare = left.providerSentAt.getTime() - right.providerSentAt.getTime();
        if (sentCompare !== 0) {
          return sentCompare;
        }
        if (left.ingestSeq === right.ingestSeq) {
          return 0;
        }
        return left.ingestSeq < right.ingestSeq ? -1 : 1;
      });
  }
}
