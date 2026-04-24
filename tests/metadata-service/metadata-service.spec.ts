import { describe, expect, it } from 'vitest';
import { MetadataService } from '../../packages/metadata-service/src/metadata-service';
import { runMigrations } from '../../packages/storage/src/migrate';
import { PostgresClusterRepository } from '../../packages/storage/src/cluster-repository';
import { PostgresConnectionRepository } from '../../packages/storage/src/connection-repository';
import { PostgresConversationRepository } from '../../packages/storage/src/conversation-repository';
import { PostgresMessageRepository } from '../../packages/storage/src/message-repository';
import { PostgresMetadataRepository } from '../../packages/storage/src/metadata-repository';
import { createPostgresTestHarness } from '../../packages/test-kit/src/postgres-test-harness';

describe('metadata service', () => {
  it('sets, versions, lists, and logically deletes metadata for supported targets', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      await seedMetadataGraph(harness);

      const service = new MetadataService({
        messageRepository: new PostgresMessageRepository(harness),
        conversationRepository: new PostgresConversationRepository(harness),
        clusterRepository: new PostgresClusterRepository(harness),
        metadataRepository: new PostgresMetadataRepository(harness),
        now: () => new Date('2026-01-12T00:00:00.000Z'),
        createId: (() => {
          let counter = 0;
          return (prefix: string) => `${prefix}_${++counter}`;
        })(),
        maxValueBytes: 32768
      });

      await service.setMetadata({
        tenantId: 'tenant_1',
        targetType: 'message',
        targetId: 'message_1',
        namespace: 'crm',
        key: 'status',
        valueJson: { state: 'open' }
      });
      await service.setMetadata({
        tenantId: 'tenant_1',
        targetType: 'message',
        targetId: 'message_1',
        namespace: 'crm',
        key: 'status',
        valueJson: { state: 'closed' }
      });
      await service.setMetadata({
        tenantId: 'tenant_1',
        targetType: 'cluster',
        targetId: 'cluster_1',
        namespace: 'ops',
        key: 'owner',
        valueJson: { team: 'alpha' }
      });
      await service.deleteMetadata({
        tenantId: 'tenant_1',
        targetType: 'message',
        targetId: 'message_1',
        namespace: 'crm',
        key: 'status'
      });

      await expect(
        service.getMetadata({
          tenantId: 'tenant_1',
          targetType: 'message',
          targetId: 'message_1',
          namespace: 'crm',
          key: 'status'
        })
      ).resolves.toMatchObject([
        { version: 1, deleted: false, valueJson: { state: 'open' } },
        { version: 2, deleted: false, valueJson: { state: 'closed' } },
        { version: 3, deleted: true, valueJson: null }
      ]);

      await expect(
        service.listMetadata({
          tenantId: 'tenant_1',
          targetType: 'cluster',
          targetId: 'cluster_1'
        })
      ).resolves.toMatchObject([
        {
          namespace: 'ops',
          key: 'owner',
          version: 1,
          deleted: false,
          valueJson: { team: 'alpha' }
        }
      ]);
    } finally {
      await harness.close();
    }
  });

  it('rejects metadata values larger than the configured size limit', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      await seedMetadataGraph(harness);

      const service = new MetadataService({
        messageRepository: new PostgresMessageRepository(harness),
        conversationRepository: new PostgresConversationRepository(harness),
        clusterRepository: new PostgresClusterRepository(harness),
        metadataRepository: new PostgresMetadataRepository(harness),
        now: () => new Date('2026-01-12T00:00:00.000Z'),
        createId: (prefix: string) => `${prefix}_1`,
        maxValueBytes: 10
      });

      await expect(
        service.setMetadata({
          tenantId: 'tenant_1',
          targetType: 'message',
          targetId: 'message_1',
          namespace: 'crm',
          key: 'note',
          valueJson: { text: 'this value is too large' }
        })
      ).rejects.toMatchObject({ code: 'invalid_argument' });
    } finally {
      await harness.close();
    }
  });
});

async function seedMetadataGraph(harness: Awaited<ReturnType<typeof createPostgresTestHarness>>): Promise<void> {
  const connectionRepository = new PostgresConnectionRepository(harness);
  const conversationRepository = new PostgresConversationRepository(harness);
  const messageRepository = new PostgresMessageRepository(harness);
  const clusterRepository = new PostgresClusterRepository(harness);

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

  await conversationRepository.upsert({
    id: 'conv_1',
    tenantId: 'tenant_1',
    connectionId: 'conn_1',
    providerConversationId: 'provider_conv_1',
    conversationType: 'direct',
    title: 'Metadata chat',
    normalizedTitle: 'metadata chat',
    avatarRef: null,
    isSelected: true,
    selectionStateChangedAt: new Date('2026-01-01T00:00:00.000Z'),
    lastProviderMessageAt: null,
    lastMirroredMessageAt: null,
    participantCount: 2,
    providerMetadata: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z')
  });

  await messageRepository.upsert({
    id: 'message_1',
    tenantId: 'tenant_1',
    connectionId: 'conn_1',
    conversationId: 'conv_1',
    providerMessageId: 'provider_message_1',
    senderParticipantId: null,
    messageType: 'text',
    direction: 'inbound',
    textBody: 'hello',
    normalizedTextBody: 'hello',
    quotedMessageId: null,
    replyToProviderMessageId: null,
    providerSentAt: new Date('2026-01-02T00:00:00.000Z'),
    mirroredAt: new Date('2026-01-02T00:00:00.000Z'),
    ingestSeq: BigInt(1),
    messageStatus: 'delivered',
    hasAttachments: false,
    providerMetadata: {},
    rawPayloadRef: null,
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z')
  });

  await clusterRepository.create({
    id: 'cluster_1',
    tenantId: 'tenant_1',
    name: 'Metadata cluster',
    description: null,
    clusterType: 'manual',
    archived: false,
    createdAt: new Date('2026-01-03T00:00:00.000Z'),
    updatedAt: new Date('2026-01-03T00:00:00.000Z')
  });
}
