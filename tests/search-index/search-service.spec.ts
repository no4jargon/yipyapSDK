import { describe, expect, it } from 'vitest';
import { SearchService } from '../../packages/search-index/src/search-service';
import { runMigrations } from '../../packages/storage/src/migrate';
import { PostgresAttachmentRepository } from '../../packages/storage/src/attachment-repository';
import { PostgresClusterConversationRepository } from '../../packages/storage/src/cluster-conversation-repository';
import { PostgresClusterRepository } from '../../packages/storage/src/cluster-repository';
import { PostgresConnectionRepository } from '../../packages/storage/src/connection-repository';
import { PostgresConversationRepository } from '../../packages/storage/src/conversation-repository';
import { PostgresMessageRepository } from '../../packages/storage/src/message-repository';
import { createPostgresTestHarness } from '../../packages/test-kit/src/postgres-test-harness';

describe('search service', () => {
  it('searches message text within tenant and cluster scopes', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      await seedSearchGraph(harness);

      const service = new SearchService({
        messageRepository: new PostgresMessageRepository(harness),
        attachmentRepository: new PostgresAttachmentRepository(harness),
        clusterConversationRepository: new PostgresClusterConversationRepository(harness)
      });

      await expect(
        service.searchMessages({
          tenantId: 'tenant_1',
          query: 'budget',
          scope: { type: 'tenant' }
        })
      ).resolves.toMatchObject([
        { id: 'message_1' },
        { id: 'message_3' }
      ]);

      await expect(
        service.searchMessages({
          tenantId: 'tenant_1',
          query: 'budget',
          scope: { type: 'cluster', clusterId: 'cluster_1' }
        })
      ).resolves.toMatchObject([
        { id: 'message_3' }
      ]);
    } finally {
      await harness.close();
    }
  });

  it('searches attachment file names within conversation scope', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      await seedSearchGraph(harness);

      const service = new SearchService({
        messageRepository: new PostgresMessageRepository(harness),
        attachmentRepository: new PostgresAttachmentRepository(harness),
        clusterConversationRepository: new PostgresClusterConversationRepository(harness)
      });

      await expect(
        service.searchAttachmentsByName({
          tenantId: 'tenant_1',
          query: 'invoice',
          scope: { type: 'conversation', conversationId: 'conv_1' }
        })
      ).resolves.toMatchObject([
        { id: 'attachment_1', fileName: 'invoice-jan.pdf' }
      ]);
    } finally {
      await harness.close();
    }
  });
});

async function seedSearchGraph(harness: Awaited<ReturnType<typeof createPostgresTestHarness>>): Promise<void> {
  const connectionRepository = new PostgresConnectionRepository(harness);
  const conversationRepository = new PostgresConversationRepository(harness);
  const messageRepository = new PostgresMessageRepository(harness);
  const attachmentRepository = new PostgresAttachmentRepository(harness);
  const clusterRepository = new PostgresClusterRepository(harness);
  const clusterConversationRepository = new PostgresClusterConversationRepository(harness);

  await connectionRepository.create({
    id: 'conn_1', tenantId: 'tenant_1', workspaceUserRef: 'user_1', provider: 'whatsapp_linked', status: 'connected', statusReason: 'none',
    createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'), providerAccountRef: null, deviceLabel: null,
    lastConnectedAt: new Date('2026-01-01T00:00:00.000Z'), lastHeartbeatAt: null, reauthRequiredAt: null, disconnectedAt: null
  });

  for (const conversation of [
    { id: 'conv_1', providerConversationId: 'provider_conv_1', title: 'Finance' },
    { id: 'conv_2', providerConversationId: 'provider_conv_2', title: 'Ops' }
  ]) {
    await conversationRepository.upsert({
      id: conversation.id, tenantId: 'tenant_1', connectionId: 'conn_1', providerConversationId: conversation.providerConversationId,
      conversationType: 'direct', title: conversation.title, normalizedTitle: conversation.title.toLowerCase(), avatarRef: null, isSelected: true,
      selectionStateChangedAt: new Date('2026-01-01T00:00:00.000Z'), lastProviderMessageAt: null, lastMirroredMessageAt: null, participantCount: 2,
      providerMetadata: {}, createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z')
    });
  }

  await messageRepository.upsert({ id: 'message_1', tenantId: 'tenant_1', connectionId: 'conn_1', conversationId: 'conv_1', providerMessageId: 'pm1', senderParticipantId: null, messageType: 'text', direction: 'inbound', textBody: 'Budget review', normalizedTextBody: 'budget review', quotedMessageId: null, replyToProviderMessageId: null, providerSentAt: new Date('2026-01-02T00:00:00.000Z'), mirroredAt: new Date('2026-01-02T00:00:00.000Z'), ingestSeq: BigInt(1), messageStatus: 'delivered', hasAttachments: true, providerMetadata: {}, rawPayloadRef: null, createdAt: new Date('2026-01-02T00:00:00.000Z'), updatedAt: new Date('2026-01-02T00:00:00.000Z') });
  await messageRepository.upsert({ id: 'message_2', tenantId: 'tenant_1', connectionId: 'conn_1', conversationId: 'conv_1', providerMessageId: 'pm2', senderParticipantId: null, messageType: 'text', direction: 'inbound', textBody: 'Hiring plan', normalizedTextBody: 'hiring plan', quotedMessageId: null, replyToProviderMessageId: null, providerSentAt: new Date('2026-01-03T00:00:00.000Z'), mirroredAt: new Date('2026-01-03T00:00:00.000Z'), ingestSeq: BigInt(2), messageStatus: 'delivered', hasAttachments: false, providerMetadata: {}, rawPayloadRef: null, createdAt: new Date('2026-01-03T00:00:00.000Z'), updatedAt: new Date('2026-01-03T00:00:00.000Z') });
  await messageRepository.upsert({ id: 'message_3', tenantId: 'tenant_1', connectionId: 'conn_1', conversationId: 'conv_2', providerMessageId: 'pm3', senderParticipantId: null, messageType: 'text', direction: 'inbound', textBody: 'Budget approved', normalizedTextBody: 'budget approved', quotedMessageId: null, replyToProviderMessageId: null, providerSentAt: new Date('2026-01-04T00:00:00.000Z'), mirroredAt: new Date('2026-01-04T00:00:00.000Z'), ingestSeq: BigInt(3), messageStatus: 'delivered', hasAttachments: false, providerMetadata: {}, rawPayloadRef: null, createdAt: new Date('2026-01-04T00:00:00.000Z'), updatedAt: new Date('2026-01-04T00:00:00.000Z') });

  await attachmentRepository.upsert({ id: 'attachment_1', tenantId: 'tenant_1', messageId: 'message_1', providerAttachmentId: 'att_1', attachmentType: 'document', fileName: 'invoice-jan.pdf', mimeType: 'application/pdf', byteSize: BigInt(4), checksumSha256: null, storageKey: null, downloadState: 'available', providerUrlRef: null, previewRef: null, downloadRequestedAt: null, downloadCompletedAt: new Date('2026-01-02T00:00:00.000Z'), providerMetadata: {}, createdAt: new Date('2026-01-02T00:00:00.000Z'), updatedAt: new Date('2026-01-02T00:00:00.000Z') });

  await clusterRepository.create({ id: 'cluster_1', tenantId: 'tenant_1', name: 'Ops cluster', description: null, clusterType: 'manual', archived: false, createdAt: new Date('2026-01-05T00:00:00.000Z'), updatedAt: new Date('2026-01-05T00:00:00.000Z') });
  await clusterConversationRepository.add({ id: 'membership_1', tenantId: 'tenant_1', clusterId: 'cluster_1', conversationId: 'conv_2', addedAt: new Date('2026-01-05T00:00:00.000Z') });
}
