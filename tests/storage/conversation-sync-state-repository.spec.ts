import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../packages/storage/src/migrate';
import { PostgresConnectionRepository } from '../../packages/storage/src/connection-repository';
import { PostgresConversationRepository } from '../../packages/storage/src/conversation-repository';
import { PostgresConversationSyncStateRepository } from '../../packages/storage/src/conversation-sync-state-repository';
import { createPostgresTestHarness } from '../../packages/test-kit/src/postgres-test-harness';

describe('conversation sync state repository', () => {
  it('upserts and updates per-conversation inbox/backfill sync coverage state', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      await seedConversation(harness);

      const repository = new PostgresConversationSyncStateRepository(harness);
      const createdAt = new Date('2026-04-22T00:00:00.000Z');
      await repository.upsert({
        id: 'sync_1',
        tenantId: 'tenant_1',
        conversationId: 'conv_1',
        connectionId: 'conn_1',
        recentWindowDays: 7,
        recentWindowStartAt: new Date('2026-04-15T00:00:00.000Z'),
        recentWindowEndAt: new Date('2026-04-22T00:00:00.000Z'),
        earliestMirroredProviderSentAt: new Date('2026-04-18T00:00:00.000Z'),
        latestMirroredProviderSentAt: new Date('2026-04-22T00:00:00.000Z'),
        olderHistoryPossible: true,
        newerHistoryPossible: false,
        bootstrapState: 'partial',
        backfillState: 'idle',
        lastBackfillAnchorCursor: null,
        lastBackfillRequestedAt: null,
        lastBackfillCompletedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        createdAt,
        updatedAt: createdAt
      });

      await repository.upsert({
        id: 'sync_ignored',
        tenantId: 'tenant_1',
        conversationId: 'conv_1',
        connectionId: 'conn_1',
        recentWindowDays: 7,
        recentWindowStartAt: new Date('2026-04-15T00:00:00.000Z'),
        recentWindowEndAt: new Date('2026-04-22T00:00:00.000Z'),
        earliestMirroredProviderSentAt: new Date('2026-04-10T00:00:00.000Z'),
        latestMirroredProviderSentAt: new Date('2026-04-22T12:00:00.000Z'),
        olderHistoryPossible: false,
        newerHistoryPossible: false,
        bootstrapState: 'ready',
        backfillState: 'exhausted',
        lastBackfillAnchorCursor: 'older-page',
        lastBackfillRequestedAt: new Date('2026-04-22T12:10:00.000Z'),
        lastBackfillCompletedAt: new Date('2026-04-22T12:11:00.000Z'),
        lastErrorCode: null,
        lastErrorMessage: null,
        createdAt: new Date('2026-04-22T12:10:00.000Z'),
        updatedAt: new Date('2026-04-22T12:11:00.000Z')
      });

      await expect(repository.getByConversationId({ tenantId: 'tenant_1', conversationId: 'conv_1' })).resolves.toMatchObject({
        id: 'sync_1',
        bootstrapState: 'ready',
        backfillState: 'exhausted',
        earliestMirroredProviderSentAt: new Date('2026-04-10T00:00:00.000Z'),
        latestMirroredProviderSentAt: new Date('2026-04-22T12:00:00.000Z'),
        olderHistoryPossible: false,
        lastBackfillAnchorCursor: 'older-page'
      });
    } finally {
      await harness.close();
    }
  });
});

async function seedConversation(harness: Awaited<ReturnType<typeof createPostgresTestHarness>>): Promise<void> {
  await new PostgresConnectionRepository(harness).create({
    id: 'conn_1',
    tenantId: 'tenant_1',
    workspaceUserRef: 'user_1',
    provider: 'whatsapp_linked',
    status: 'connected',
    statusReason: 'none',
    createdAt: new Date('2026-04-22T00:00:00.000Z'),
    updatedAt: new Date('2026-04-22T00:00:00.000Z'),
    providerAccountRef: null,
    deviceLabel: null,
    lastConnectedAt: new Date('2026-04-22T00:00:00.000Z'),
    lastHeartbeatAt: null,
    reauthRequiredAt: null,
    disconnectedAt: null
  });

  await new PostgresConversationRepository(harness).upsert({
    id: 'conv_1',
    tenantId: 'tenant_1',
    connectionId: 'conn_1',
    providerConversationId: 'conv_provider_1',
    conversationType: 'direct',
    title: 'Alice',
    normalizedTitle: 'alice',
    avatarRef: null,
    isSelected: false,
    selectionStateChangedAt: null,
    lastProviderMessageAt: null,
    lastMirroredMessageAt: null,
    participantCount: 2,
    providerMetadata: {},
    createdAt: new Date('2026-04-22T00:00:00.000Z'),
    updatedAt: new Date('2026-04-22T00:00:00.000Z')
  });
}
