import { describe, expect, it } from 'vitest';
import { createPostgresTestHarness } from '../../packages/test-kit/src/postgres-test-harness';
import { runMigrations } from '../../packages/storage/src/migrate';
import { PostgresConnectionRepository } from '../../packages/storage/src/connection-repository';
import { PostgresConversationRepository } from '../../packages/storage/src/conversation-repository';
import { PostgresConversationSyncStateRepository } from '../../packages/storage/src/conversation-sync-state-repository';
import { PostgresParticipantRepository } from '../../packages/storage/src/participant-repository';
import { PostgresConversationMembershipRepository } from '../../packages/storage/src/conversation-membership-repository';
import { PostgresEventLogRepository } from '../../packages/event-log/src/event-log-repository';
import { createFakeProviderAdapter } from '../../packages/provider-adapter-interface/src/fake-provider-adapter';
import { ConversationDiscoveryService } from '../../packages/query-api/src/conversation-discovery-service';

class RecordingImportScheduler {
  readonly scheduled: string[] = [];

  async scheduleConversationImport(input: { conversationId: string }): Promise<void> {
    this.scheduled.push(input.conversationId);
  }
}

describe('conversation discovery service', () => {
  it('discovers conversations, stores participants, and exposes group membership snapshots', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      const connectionRepository = new PostgresConnectionRepository(harness);
      await connectionRepository.create({
        id: 'conn_1',
        tenantId: 'tenant_1',
        workspaceUserRef: 'user_1',
        provider: 'whatsapp_linked',
        status: 'connected',
        statusReason: 'none',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        providerAccountRef: null,
        deviceLabel: null,
        lastConnectedAt: new Date('2026-01-01T00:00:00.000Z'),
        lastHeartbeatAt: null,
        reauthRequiredAt: null,
        disconnectedAt: null
      });

      const scheduler = new RecordingImportScheduler();
      const service = new ConversationDiscoveryService({
        connectionRepository,
        conversationRepository: new PostgresConversationRepository(harness),
        conversationSyncStateRepository: new PostgresConversationSyncStateRepository(harness),
        participantRepository: new PostgresParticipantRepository(harness),
        membershipRepository: new PostgresConversationMembershipRepository(harness),
        eventLogRepository: new PostgresEventLogRepository(harness),
        providerAdapter: await createFakeProviderAdapter(),
        importScheduler: scheduler,
        now: () => new Date('2026-01-02T00:00:00.000Z'),
        createId: (() => {
          let counter = 0;
          return (prefix: string) => `${prefix}_${++counter}`;
        })()
      });

      const discovered = await service.discoverConversations({
        tenantId: 'tenant_1',
        connectionId: 'conn_1'
      });

      expect(discovered).toMatchObject([
        {
          id: 'conv_1',
          providerConversationId: 'conv_direct_1',
          conversationType: 'direct',
          title: 'Direct chat',
          normalizedTitle: 'direct chat',
          isSelected: false
        },
        {
          id: 'conv_2',
          providerConversationId: 'conv_group_1',
          conversationType: 'group',
          title: 'Group chat',
          participantCount: 3,
          isSelected: false
        }
      ]);

      await expect(
        new PostgresConversationSyncStateRepository(harness).getByConversationId({ tenantId: 'tenant_1', conversationId: 'conv_1' })
      ).resolves.toMatchObject({
        bootstrapState: 'not_started',
        backfillState: 'idle'
      });

      await expect(
        service.getConversationParticipants({
          tenantId: 'tenant_1',
          conversationId: 'conv_2'
        })
      ).resolves.toMatchObject([
        { providerParticipantId: 'participant_self', isSelf: true, membershipState: 'active' },
        { providerParticipantId: 'participant_1', isSelf: false, membershipState: 'active' },
        { providerParticipantId: 'participant_2', isSelf: false, membershipState: 'active' }
      ]);

      await expect(
        new PostgresEventLogRepository(harness).listByTenant({
          tenantId: 'tenant_1',
          afterIngestSeq: null,
          limit: 10
        })
      ).resolves.toMatchObject([
        { eventType: 'conversation.discovered' },
        { eventType: 'conversation.discovered' },
        { eventType: 'participant.discovered' },
        { eventType: 'participant.discovered' },
        { eventType: 'participant.discovered' },
        { eventType: 'conversation.membership.updated' }
      ]);

      expect(scheduler.scheduled).toEqual([]);
    } finally {
      await harness.close();
    }
  });

  it('selects a conversation exactly once and schedules history import once', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      const connectionRepository = new PostgresConnectionRepository(harness);
      await connectionRepository.create({
        id: 'conn_1',
        tenantId: 'tenant_1',
        workspaceUserRef: 'user_1',
        provider: 'whatsapp_linked',
        status: 'connected',
        statusReason: 'none',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        providerAccountRef: null,
        deviceLabel: null,
        lastConnectedAt: new Date('2026-01-01T00:00:00.000Z'),
        lastHeartbeatAt: null,
        reauthRequiredAt: null,
        disconnectedAt: null
      });

      const scheduler = new RecordingImportScheduler();
      const service = new ConversationDiscoveryService({
        connectionRepository,
        conversationRepository: new PostgresConversationRepository(harness),
        conversationSyncStateRepository: new PostgresConversationSyncStateRepository(harness),
        participantRepository: new PostgresParticipantRepository(harness),
        membershipRepository: new PostgresConversationMembershipRepository(harness),
        eventLogRepository: new PostgresEventLogRepository(harness),
        providerAdapter: await createFakeProviderAdapter(),
        importScheduler: scheduler,
        now: () => new Date('2026-01-02T00:00:00.000Z'),
        createId: (() => {
          let counter = 0;
          return (prefix: string) => `${prefix}_${++counter}`;
        })()
      });

      await service.discoverConversations({ tenantId: 'tenant_1', connectionId: 'conn_1' });

      await service.selectConversation({
        tenantId: 'tenant_1',
        conversationId: 'conv_1'
      });
      await service.selectConversation({
        tenantId: 'tenant_1',
        conversationId: 'conv_1'
      });

      await expect(
        new PostgresConversationRepository(harness).getById({
          tenantId: 'tenant_1',
          id: 'conv_1'
        })
      ).resolves.toMatchObject({
        isSelected: true,
        selectionStateChangedAt: new Date('2026-01-02T00:00:00.000Z')
      });

      expect(scheduler.scheduled).toEqual(['conv_1']);
    } finally {
      await harness.close();
    }
  });
});
