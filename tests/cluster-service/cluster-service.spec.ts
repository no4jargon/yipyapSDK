import { describe, expect, it } from 'vitest';
import { ClusterService } from '../../packages/cluster-service/src/cluster-service';
import { runMigrations } from '../../packages/storage/src/migrate';
import { PostgresClusterRepository } from '../../packages/storage/src/cluster-repository';
import { PostgresClusterConversationRepository } from '../../packages/storage/src/cluster-conversation-repository';
import { PostgresConnectionRepository } from '../../packages/storage/src/connection-repository';
import { PostgresConversationRepository } from '../../packages/storage/src/conversation-repository';
import { PostgresMessageRepository } from '../../packages/storage/src/message-repository';
import { createPostgresTestHarness } from '../../packages/test-kit/src/postgres-test-harness';

describe('cluster service', () => {
  it('creates a cluster, adds conversations, and returns a merged ordered timeline', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      await seedClusterGraph(harness);

      const service = new ClusterService({
        clusterRepository: new PostgresClusterRepository(harness),
        clusterConversationRepository: new PostgresClusterConversationRepository(harness),
        conversationRepository: new PostgresConversationRepository(harness),
        messageRepository: new PostgresMessageRepository(harness),
        now: () => new Date('2026-01-12T00:00:00.000Z'),
        createId: (() => {
          let counter = 0;
          return (prefix: string) => `${prefix}_${++counter}`;
        })()
      });

      const cluster = await service.createCluster({
        tenantId: 'tenant_1',
        name: 'Priority chats',
        description: 'Important threads'
      });

      await service.addConversationToCluster({
        tenantId: 'tenant_1',
        clusterId: cluster.id,
        conversationId: 'conv_1'
      });
      await service.addConversationToCluster({
        tenantId: 'tenant_1',
        clusterId: cluster.id,
        conversationId: 'conv_2'
      });

      await expect(
        service.listClusterConversations({
          tenantId: 'tenant_1',
          clusterId: cluster.id
        })
      ).resolves.toMatchObject([
        { conversationId: 'conv_1' },
        { conversationId: 'conv_2' }
      ]);

      await expect(
        service.getClusterTimeline({
          tenantId: 'tenant_1',
          clusterId: cluster.id
        })
      ).resolves.toMatchObject([
        { id: 'message_1', conversationId: 'conv_1' },
        { id: 'message_3', conversationId: 'conv_2' },
        { id: 'message_2', conversationId: 'conv_1' }
      ]);
    } finally {
      await harness.close();
    }
  });

  it('allows the same conversation to belong to multiple clusters', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      await seedClusterGraph(harness);

      const service = new ClusterService({
        clusterRepository: new PostgresClusterRepository(harness),
        clusterConversationRepository: new PostgresClusterConversationRepository(harness),
        conversationRepository: new PostgresConversationRepository(harness),
        messageRepository: new PostgresMessageRepository(harness),
        now: () => new Date('2026-01-12T00:00:00.000Z'),
        createId: (() => {
          let counter = 0;
          return (prefix: string) => `${prefix}_${++counter}`;
        })()
      });

      const clusterA = await service.createCluster({ tenantId: 'tenant_1', name: 'A' });
      const clusterB = await service.createCluster({ tenantId: 'tenant_1', name: 'B' });

      await service.addConversationToCluster({ tenantId: 'tenant_1', clusterId: clusterA.id, conversationId: 'conv_1' });
      await service.addConversationToCluster({ tenantId: 'tenant_1', clusterId: clusterB.id, conversationId: 'conv_1' });

      await expect(
        service.listClusterConversations({ tenantId: 'tenant_1', clusterId: clusterA.id })
      ).resolves.toMatchObject([{ conversationId: 'conv_1' }]);
      await expect(
        service.listClusterConversations({ tenantId: 'tenant_1', clusterId: clusterB.id })
      ).resolves.toMatchObject([{ conversationId: 'conv_1' }]);
    } finally {
      await harness.close();
    }
  });
});

async function seedClusterGraph(harness: Awaited<ReturnType<typeof createPostgresTestHarness>>): Promise<void> {
  const connectionRepository = new PostgresConnectionRepository(harness);
  const conversationRepository = new PostgresConversationRepository(harness);
  const messageRepository = new PostgresMessageRepository(harness);

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

  for (const conversation of [
    { id: 'conv_1', providerConversationId: 'provider_conv_1', title: 'One' },
    { id: 'conv_2', providerConversationId: 'provider_conv_2', title: 'Two' }
  ]) {
    await conversationRepository.upsert({
      id: conversation.id,
      tenantId: 'tenant_1',
      connectionId: 'conn_1',
      providerConversationId: conversation.providerConversationId,
      conversationType: 'direct',
      title: conversation.title,
      normalizedTitle: conversation.title.toLowerCase(),
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
  }

  await messageRepository.upsert({
    id: 'message_1',
    tenantId: 'tenant_1',
    connectionId: 'conn_1',
    conversationId: 'conv_1',
    providerMessageId: 'provider_message_1',
    senderParticipantId: null,
    messageType: 'text',
    direction: 'inbound',
    textBody: 'one-early',
    normalizedTextBody: 'one-early',
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

  await messageRepository.upsert({
    id: 'message_2',
    tenantId: 'tenant_1',
    connectionId: 'conn_1',
    conversationId: 'conv_1',
    providerMessageId: 'provider_message_2',
    senderParticipantId: null,
    messageType: 'text',
    direction: 'inbound',
    textBody: 'one-late',
    normalizedTextBody: 'one-late',
    quotedMessageId: null,
    replyToProviderMessageId: null,
    providerSentAt: new Date('2026-01-04T00:00:00.000Z'),
    mirroredAt: new Date('2026-01-04T00:00:00.000Z'),
    ingestSeq: BigInt(2),
    messageStatus: 'delivered',
    hasAttachments: false,
    providerMetadata: {},
    rawPayloadRef: null,
    createdAt: new Date('2026-01-04T00:00:00.000Z'),
    updatedAt: new Date('2026-01-04T00:00:00.000Z')
  });

  await messageRepository.upsert({
    id: 'message_3',
    tenantId: 'tenant_1',
    connectionId: 'conn_1',
    conversationId: 'conv_2',
    providerMessageId: 'provider_message_3',
    senderParticipantId: null,
    messageType: 'text',
    direction: 'inbound',
    textBody: 'two-middle',
    normalizedTextBody: 'two-middle',
    quotedMessageId: null,
    replyToProviderMessageId: null,
    providerSentAt: new Date('2026-01-03T00:00:00.000Z'),
    mirroredAt: new Date('2026-01-03T00:00:00.000Z'),
    ingestSeq: BigInt(3),
    messageStatus: 'delivered',
    hasAttachments: false,
    providerMetadata: {},
    rawPayloadRef: null,
    createdAt: new Date('2026-01-03T00:00:00.000Z'),
    updatedAt: new Date('2026-01-03T00:00:00.000Z')
  });
}
