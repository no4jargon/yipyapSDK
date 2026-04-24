import { describe, expect, it } from 'vitest';
import { DeletionRedactionService } from '../../packages/deletion-redaction-service/src/deletion-redaction-service';
import { SearchService } from '../../packages/search-index/src/search-service';
import { runMigrations } from '../../packages/storage/src/migrate';
import { PostgresAttachmentRepository } from '../../packages/storage/src/attachment-repository';
import { PostgresClusterConversationRepository } from '../../packages/storage/src/cluster-conversation-repository';
import { PostgresConnectionRepository } from '../../packages/storage/src/connection-repository';
import { PostgresConversationRepository } from '../../packages/storage/src/conversation-repository';
import { PostgresDeletionRecordRepository } from '../../packages/storage/src/deletion-record-repository';
import { PostgresMessageRepository } from '../../packages/storage/src/message-repository';
import { createPostgresTestHarness } from '../../packages/test-kit/src/postgres-test-harness';

describe('deletion redaction service', () => {
  it('soft deletes a message, records audit state, and excludes it from search results', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      await seedDeletionGraph(harness);

      const service = new DeletionRedactionService({
        messageRepository: new PostgresMessageRepository(harness),
        conversationRepository: new PostgresConversationRepository(harness),
        attachmentRepository: new PostgresAttachmentRepository(harness),
        deletionRecordRepository: new PostgresDeletionRecordRepository(harness),
        now: () => new Date('2026-01-12T00:00:00.000Z'),
        createId: (() => {
          let counter = 0;
          return (prefix: string) => `${prefix}_${++counter}`;
        })()
      });

      await service.softDeleteMessage({ tenantId: 'tenant_1', messageId: 'message_1', reason: 'user request' });

      await expect(
        new PostgresMessageRepository(harness).getById({ tenantId: 'tenant_1', id: 'message_1' })
      ).resolves.toMatchObject({
        messageStatus: 'deleted',
        textBody: 'budget secret',
        normalizedTextBody: 'budget secret'
      });

      await expect(
        new PostgresConversationRepository(harness).getById({ tenantId: 'tenant_1', id: 'conv_1' })
      ).resolves.toMatchObject({
        lastMessageId: null,
        lastMessagePreview: null
      });

      await expect(
        new PostgresDeletionRecordRepository(harness).listByTenant({ tenantId: 'tenant_1' })
      ).resolves.toMatchObject([
        {
          targetType: 'message',
          targetId: 'message_1',
          operationType: 'soft_delete',
          status: 'completed',
          reason: 'user request'
        }
      ]);

      const search = new SearchService({
        messageRepository: new PostgresMessageRepository(harness),
        attachmentRepository: new PostgresAttachmentRepository(harness),
        clusterConversationRepository: new PostgresClusterConversationRepository(harness)
      });

      await expect(
        search.searchMessages({
          tenantId: 'tenant_1',
          query: 'budget',
          scope: { type: 'tenant' }
        })
      ).resolves.toMatchObject([]);
    } finally {
      await harness.close();
    }
  });

  it('redacts a message, preserves the shell, and removes text from search', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      await seedDeletionGraph(harness);

      const service = new DeletionRedactionService({
        messageRepository: new PostgresMessageRepository(harness),
        conversationRepository: new PostgresConversationRepository(harness),
        attachmentRepository: new PostgresAttachmentRepository(harness),
        deletionRecordRepository: new PostgresDeletionRecordRepository(harness),
        now: () => new Date('2026-01-12T00:00:00.000Z'),
        createId: (() => {
          let counter = 0;
          return (prefix: string) => `${prefix}_${++counter}`;
        })()
      });

      await service.redactMessage({ tenantId: 'tenant_1', messageId: 'message_1', reason: 'privacy' });

      await expect(
        new PostgresMessageRepository(harness).getById({ tenantId: 'tenant_1', id: 'message_1' })
      ).resolves.toMatchObject({
        id: 'message_1',
        messageStatus: 'redacted',
        textBody: '[redacted]',
        normalizedTextBody: null
      });

      await expect(
        new PostgresConversationRepository(harness).getById({ tenantId: 'tenant_1', id: 'conv_1' })
      ).resolves.toMatchObject({
        lastMessageId: 'message_1',
        lastMessagePreview: '[Message redacted]'
      });

      const search = new SearchService({
        messageRepository: new PostgresMessageRepository(harness),
        attachmentRepository: new PostgresAttachmentRepository(harness),
        clusterConversationRepository: new PostgresClusterConversationRepository(harness)
      });

      await expect(
        search.searchMessages({
          tenantId: 'tenant_1',
          query: 'budget',
          scope: { type: 'tenant' }
        })
      ).resolves.toMatchObject([]);
    } finally {
      await harness.close();
    }
  });

  it('hard deletes an attachment, removes storage linkage, and preserves an audit record', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      await seedDeletionGraph(harness);

      const service = new DeletionRedactionService({
        messageRepository: new PostgresMessageRepository(harness),
        conversationRepository: new PostgresConversationRepository(harness),
        attachmentRepository: new PostgresAttachmentRepository(harness),
        deletionRecordRepository: new PostgresDeletionRecordRepository(harness),
        now: () => new Date('2026-01-12T00:00:00.000Z'),
        createId: (() => {
          let counter = 0;
          return (prefix: string) => `${prefix}_${++counter}`;
        })()
      });

      await service.hardDeleteAttachment({ tenantId: 'tenant_1', attachmentId: 'attachment_1', reason: 'gdpr' });

      await expect(
        new PostgresAttachmentRepository(harness).getById({ tenantId: 'tenant_1', id: 'attachment_1' })
      ).resolves.toMatchObject({
        downloadState: 'deleted',
        storageKey: null,
        providerUrlRef: null,
        previewRef: null,
        fileName: null
      });

      await expect(
        new PostgresDeletionRecordRepository(harness).listByTenant({ tenantId: 'tenant_1' })
      ).resolves.toMatchObject([
        {
          targetType: 'attachment',
          targetId: 'attachment_1',
          operationType: 'hard_delete',
          status: 'completed',
          reason: 'gdpr'
        }
      ]);
    } finally {
      await harness.close();
    }
  });
});

async function seedDeletionGraph(harness: Awaited<ReturnType<typeof createPostgresTestHarness>>): Promise<void> {
  const connectionRepository = new PostgresConnectionRepository(harness);
  const conversationRepository = new PostgresConversationRepository(harness);
  const messageRepository = new PostgresMessageRepository(harness);
  const attachmentRepository = new PostgresAttachmentRepository(harness);

  await connectionRepository.create({
    id: 'conn_1', tenantId: 'tenant_1', workspaceUserRef: 'user_1', provider: 'whatsapp_linked', status: 'connected', statusReason: 'none',
    createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'), providerAccountRef: null, deviceLabel: null,
    lastConnectedAt: new Date('2026-01-01T00:00:00.000Z'), lastHeartbeatAt: null, reauthRequiredAt: null, disconnectedAt: null
  });

  await conversationRepository.upsert({
    id: 'conv_1', tenantId: 'tenant_1', connectionId: 'conn_1', providerConversationId: 'provider_conv_1', conversationType: 'direct', title: 'Delete chat', normalizedTitle: 'delete chat', avatarRef: null, isSelected: true,
    selectionStateChangedAt: new Date('2026-01-01T00:00:00.000Z'), lastProviderMessageAt: new Date('2026-01-02T00:00:00.000Z'), lastMirroredMessageAt: new Date('2026-01-02T00:00:00.000Z'), lastMessageId: 'message_1', lastMessageIngestSeq: BigInt(1), lastMessagePreview: 'budget secret', lastMessageType: 'text', lastMessageDirection: 'inbound', participantCount: 2, providerMetadata: {}, createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-02T00:00:00.000Z')
  });

  await messageRepository.upsert({
    id: 'message_1', tenantId: 'tenant_1', connectionId: 'conn_1', conversationId: 'conv_1', providerMessageId: 'pm1', senderParticipantId: null, providerSenderRef: 'alice', fromMe: false, messageType: 'text', direction: 'inbound', textBody: 'budget secret', normalizedTextBody: 'budget secret', quotedMessageId: null, replyToProviderMessageId: null,
    providerSentAt: new Date('2026-01-02T00:00:00.000Z'), mirroredAt: new Date('2026-01-02T00:00:00.000Z'), ingestSeq: BigInt(1), messageStatus: 'delivered', hasAttachments: true, messagePreviewText: 'budget secret', providerMetadata: {}, rawPayloadRef: null, createdAt: new Date('2026-01-02T00:00:00.000Z'), updatedAt: new Date('2026-01-02T00:00:00.000Z')
  });

  await attachmentRepository.upsert({
    id: 'attachment_1', tenantId: 'tenant_1', messageId: 'message_1', providerAttachmentId: 'att_1', attachmentType: 'document', fileName: 'budget.pdf', mimeType: 'application/pdf', byteSize: BigInt(4), checksumSha256: null, storageKey: 'attachments/attachment_1', downloadState: 'available', providerUrlRef: 'provider://att_1', previewRef: 'preview://att_1', downloadRequestedAt: null, downloadCompletedAt: new Date('2026-01-02T00:00:00.000Z'), providerMetadata: {}, createdAt: new Date('2026-01-02T00:00:00.000Z'), updatedAt: new Date('2026-01-02T00:00:00.000Z')
  });
}
