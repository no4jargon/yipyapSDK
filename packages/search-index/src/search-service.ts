import type { PostgresAttachmentRepository } from '../../storage/src/attachment-repository';
import type { PostgresClusterConversationRepository } from '../../storage/src/cluster-conversation-repository';
import type { PostgresMessageRepository } from '../../storage/src/message-repository';

interface SearchServiceDeps {
  messageRepository: PostgresMessageRepository;
  attachmentRepository: PostgresAttachmentRepository;
  clusterConversationRepository: PostgresClusterConversationRepository;
}

type SearchScope =
  | { type: 'tenant' }
  | { type: 'conversation'; conversationId: string }
  | { type: 'cluster'; clusterId: string };

export class SearchService {
  constructor(private readonly deps: SearchServiceDeps) {}

  async searchMessages(input: { tenantId: string; query: string; scope: SearchScope }) {
    const conversationIds = await this.getConversationIds(input.tenantId, input.scope);
    const messages = await this.deps.messageRepository.listByTenant({ tenantId: input.tenantId });
    const needle = normalize(input.query);
    return messages.filter((message) => {
      if (conversationIds !== null && !conversationIds.has(message.conversationId)) {
        return false;
      }
      if (message.messageStatus === 'deleted' || message.messageStatus === 'redacted') {
        return false;
      }
      return normalize(message.normalizedTextBody ?? message.textBody)?.includes(needle) ?? false;
    });
  }

  async searchAttachmentsByName(input: { tenantId: string; query: string; scope: SearchScope }) {
    const conversationIds = await this.getConversationIds(input.tenantId, input.scope);
    const messages = await this.deps.messageRepository.listByTenant({ tenantId: input.tenantId });
    const messageConversation = new Map(messages.map((message) => [message.id, message.conversationId]));
    const needle = normalize(input.query);
    const attachments = await this.deps.attachmentRepository.listByTenant({ tenantId: input.tenantId });
    return attachments.filter((attachment) => {
      const conversationId = messageConversation.get(attachment.messageId);
      if (!conversationId) {
        return false;
      }
      if (conversationIds !== null && !conversationIds.has(conversationId)) {
        return false;
      }
      if (attachment.downloadState === 'deleted' || attachment.downloadState === 'redacted') {
        return false;
      }
      return normalize(attachment.fileName)?.includes(needle) ?? false;
    });
  }

  private async getConversationIds(tenantId: string, scope: SearchScope): Promise<Set<string> | null> {
    if (scope.type === 'tenant') {
      return null;
    }
    if (scope.type === 'conversation') {
      return new Set([scope.conversationId]);
    }
    const memberships = await this.deps.clusterConversationRepository.listByCluster({ tenantId, clusterId: scope.clusterId });
    return new Set(memberships.map((membership) => membership.conversationId));
  }
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}
