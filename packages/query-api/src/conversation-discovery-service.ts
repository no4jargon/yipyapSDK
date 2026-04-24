import { normalizeTitle } from '../../core-types/src/index';
import type { PostgresEventLogRepository } from '../../event-log/src/event-log-repository';
import type { ImportScheduler } from '../../history-import/src/import-scheduler';
import type { ProviderAdapter } from '../../provider-adapter-interface/src/index';
import type { PostgresConnectionRepository } from '../../storage/src/connection-repository';
import type { PostgresConversationMembershipRepository } from '../../storage/src/conversation-membership-repository';
import type { PostgresConversationRepository } from '../../storage/src/conversation-repository';
import type { PostgresConversationSyncStateRepository } from '../../storage/src/conversation-sync-state-repository';
import type { PostgresParticipantRepository } from '../../storage/src/participant-repository';
import { ensureConversationSyncState } from './inbox-projection';
import { AppError } from './errors';

interface TenantScopedConnectionInput {
  tenantId: string;
  connectionId: string;
}

interface TenantScopedConversationInput {
  tenantId: string;
  conversationId: string;
}

interface ConversationDiscoveryServiceDeps {
  connectionRepository: PostgresConnectionRepository;
  conversationRepository: PostgresConversationRepository;
  conversationSyncStateRepository: PostgresConversationSyncStateRepository;
  participantRepository: PostgresParticipantRepository;
  membershipRepository: PostgresConversationMembershipRepository;
  eventLogRepository: PostgresEventLogRepository;
  providerAdapter: ProviderAdapter;
  importScheduler: ImportScheduler;
  now: () => Date;
  createId: (prefix: string) => string;
}

export class ConversationDiscoveryService {
  constructor(private readonly deps: ConversationDiscoveryServiceDeps) {}

  async discoverConversations(input: TenantScopedConnectionInput) {
    const connection = await this.deps.connectionRepository.getById({
      tenantId: input.tenantId,
      id: input.connectionId
    });

    if (!connection) {
      throw new AppError('not_found', `connection ${input.connectionId} was not found`);
    }

    const observedAt = this.deps.now();
    const discovered = await this.deps.providerAdapter.listDiscoveredConversations(connection.id);
    const saved = [];

    for (const providerConversation of discovered) {
      const upserted = await this.deps.conversationRepository.upsert({
        id:
          (await this.deps.conversationRepository.getByProviderConversationId({
            tenantId: input.tenantId,
            connectionId: connection.id,
            providerConversationId: providerConversation.providerConversationId
          }))?.id ?? this.deps.createId('conv'),
        tenantId: input.tenantId,
        connectionId: connection.id,
        providerConversationId: providerConversation.providerConversationId,
        conversationType: providerConversation.conversationType,
        title: providerConversation.title,
        normalizedTitle: normalizeTitle(providerConversation.title),
        avatarRef: null,
        isSelected: false,
        selectionStateChangedAt: null,
        lastProviderMessageAt: null,
        lastMirroredMessageAt: null,
        participantCount: providerConversation.participants?.length ?? null,
        providerMetadata: {},
        createdAt: observedAt,
        updatedAt: observedAt
      });

      saved.push(upserted.record);

      await ensureConversationSyncState({
        conversationSyncStateRepository: this.deps.conversationSyncStateRepository,
        createId: this.deps.createId,
        conversation: upserted.record,
        now: observedAt,
        bootstrapState: 'not_started'
      });

      if (upserted.created) {
        await this.appendEvent(input.tenantId, 'conversation.discovered', upserted.record.id, {
          providerConversationId: upserted.record.providerConversationId,
          conversationType: upserted.record.conversationType
        }, observedAt);
      }
    }

    for (const providerConversation of discovered) {
      if (!providerConversation.participants || providerConversation.participants.length === 0) {
        continue;
      }

      const conversation = saved.find(
        (item) => item.providerConversationId === providerConversation.providerConversationId
      );
      if (!conversation) {
        continue;
      }

      const memberships = [];
      for (const providerParticipant of providerConversation.participants) {
        const upserted = await this.deps.participantRepository.upsert({
          id:
            (await this.deps.participantRepository.getByProviderParticipantId({
              tenantId: input.tenantId,
              connectionId: connection.id,
              providerParticipantId: providerParticipant.providerParticipantId
            }))?.id ?? this.deps.createId('participant'),
          tenantId: input.tenantId,
          connectionId: connection.id,
          providerParticipantId: providerParticipant.providerParticipantId,
          phoneE164: providerParticipant.phoneE164,
          displayName: providerParticipant.displayName,
          profileName: null,
          waBusinessName: null,
          isSelf: providerParticipant.isSelf,
          providerMetadata: {},
          createdAt: observedAt,
          updatedAt: observedAt
        });

        if (upserted.created) {
          await this.appendEvent(input.tenantId, 'participant.discovered', conversation.id, {
            participantId: upserted.record.id,
            providerParticipantId: upserted.record.providerParticipantId
          }, observedAt);
        }

        memberships.push({
          id: this.deps.createId('membership'),
          participantId: upserted.record.id,
          membershipState: 'active' as const,
          providerMetadata: {}
        });
      }

      await this.deps.membershipRepository.replaceForConversation({
        tenantId: input.tenantId,
        conversationId: conversation.id,
        observedAt,
        memberships
      });

      await this.appendEvent(input.tenantId, 'conversation.membership.updated', conversation.id, {
        participantCount: memberships.length
      }, observedAt);
    }

    return this.deps.conversationRepository.listByConnection({
      tenantId: input.tenantId,
      connectionId: connection.id
    });
  }

  async getConversationParticipants(input: TenantScopedConversationInput) {
    const conversation = await this.deps.conversationRepository.getById({
      tenantId: input.tenantId,
      id: input.conversationId
    });

    if (!conversation) {
      throw new AppError('not_found', `conversation ${input.conversationId} was not found`);
    }

    return this.deps.membershipRepository.listParticipantsByConversation({
      tenantId: input.tenantId,
      conversationId: input.conversationId
    });
  }

  async selectConversation(input: TenantScopedConversationInput): Promise<void> {
    const conversation = await this.deps.conversationRepository.getById({
      tenantId: input.tenantId,
      id: input.conversationId
    });

    if (!conversation) {
      throw new AppError('not_found', `conversation ${input.conversationId} was not found`);
    }

    if (conversation.isSelected) {
      return;
    }

    const now = this.deps.now();
    await this.deps.conversationRepository.markSelected({
      tenantId: input.tenantId,
      id: conversation.id,
      isSelected: true,
      selectionStateChangedAt: now,
      updatedAt: now
    });

    await this.appendEvent(input.tenantId, 'conversation.selected', conversation.id, {
      conversationId: conversation.id
    }, now);

    await this.deps.importScheduler.scheduleConversationImport({
      tenantId: input.tenantId,
      conversationId: conversation.id
    });
  }

  private async appendEvent(
    tenantId: string,
    eventType: string,
    conversationId: string,
    payloadJson: Record<string, unknown>,
    occurredAt: Date
  ): Promise<void> {
    await this.deps.eventLogRepository.append({
      tenantId,
      eventType,
      eventFamily: 'normalized',
      connectionId: null,
      conversationId,
      messageId: null,
      clusterId: null,
      occurredAt,
      payloadJson,
      dedupeKey: null
    });
  }
}
