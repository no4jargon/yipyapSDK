import { describe, expect, it } from 'vitest';
import { PostgresEventLogRepository } from '../../packages/event-log/src/event-log-repository';
import { createFakeProviderAdapter } from '../../packages/provider-adapter-interface/src/fake-provider-adapter';
import { AttachmentService } from '../../packages/attachment-service/src/attachment-service';
import { runMigrations } from '../../packages/storage/src/migrate';
import { PostgresAttachmentRepository } from '../../packages/storage/src/attachment-repository';
import { PostgresConnectionRepository } from '../../packages/storage/src/connection-repository';
import { PostgresConversationRepository } from '../../packages/storage/src/conversation-repository';
import { PostgresMessageRepository } from '../../packages/storage/src/message-repository';
import { createFakeObjectStorageHarness } from '../../packages/test-kit/src/fake-object-storage-harness';
import { createPostgresTestHarness } from '../../packages/test-kit/src/postgres-test-harness';

describe('attachment service', () => {
  it('requests an attachment download, fetches it once, stores the blob, and marks it available', async () => {
    const harness = await createPostgresTestHarness();
    const objectStorage = await createFakeObjectStorageHarness();

    try {
      await runMigrations(harness);
      await seedAttachmentGraph(harness);
      const providerAdapter = await createFakeProviderAdapter();

      const service = new AttachmentService({
        connectionRepository: new PostgresConnectionRepository(harness),
        conversationRepository: new PostgresConversationRepository(harness),
        messageRepository: new PostgresMessageRepository(harness),
        attachmentRepository: new PostgresAttachmentRepository(harness),
        eventLogRepository: new PostgresEventLogRepository(harness),
        providerAdapter,
        objectStorage,
        now: (() => {
          const values = [
            new Date('2026-01-12T00:00:00.000Z'),
            new Date('2026-01-12T00:01:00.000Z'),
            new Date('2026-01-12T00:02:00.000Z')
          ];
          let index = 0;
          return () => values[Math.min(index++, values.length - 1)];
        })(),
        createId: (() => {
          let counter = 0;
          return (prefix: string) => `${prefix}_${++counter}`;
        })(),
        createStorageKey: (attachmentId: string) => `attachments/${attachmentId}`
      });

      await service.requestAttachmentDownload({
        tenantId: 'tenant_1',
        attachmentId: 'attachment_1'
      });

      await expect(
        new PostgresAttachmentRepository(harness).getById({
          tenantId: 'tenant_1',
          id: 'attachment_1'
        })
      ).resolves.toMatchObject({
        downloadState: 'pending',
        downloadRequestedAt: new Date('2026-01-12T00:00:00.000Z')
      });

      await service.processNextPendingDownload({ tenantId: 'tenant_1' });
      await service.requestAttachmentDownload({
        tenantId: 'tenant_1',
        attachmentId: 'attachment_1'
      });

      const attachment = await new PostgresAttachmentRepository(harness).getById({
        tenantId: 'tenant_1',
        id: 'attachment_1'
      });

      expect(attachment).toMatchObject({
        downloadState: 'available',
        storageKey: 'attachments/attachment_1',
        fileName: 'history.txt',
        mimeType: 'text/plain',
        byteSize: BigInt(18),
        downloadCompletedAt: new Date('2026-01-12T00:01:00.000Z')
      });

      const blob = await objectStorage.getObject('attachments/attachment_1');
      expect(blob.toString('utf8')).toBe('history attachment');

      await expect(
        new PostgresEventLogRepository(harness).listByTenant({
          tenantId: 'tenant_1',
          afterIngestSeq: null,
          limit: 10
        })
      ).resolves.toMatchObject([
        { eventType: 'attachment.download.requested' },
        { eventType: 'attachment.download.completed' }
      ]);
    } finally {
      await objectStorage.dispose();
      await harness.close();
    }
  });
});

async function seedAttachmentGraph(harness: Awaited<ReturnType<typeof createPostgresTestHarness>>): Promise<void> {
  const connectionRepository = new PostgresConnectionRepository(harness);
  const conversationRepository = new PostgresConversationRepository(harness);
  const messageRepository = new PostgresMessageRepository(harness);
  const attachmentRepository = new PostgresAttachmentRepository(harness);

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
    providerConversationId: 'conv_direct_1',
    conversationType: 'direct',
    title: 'Docs',
    normalizedTitle: 'docs',
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
    providerMessageId: 'provider_msg_1',
    senderParticipantId: null,
    messageType: 'document',
    direction: 'inbound',
    textBody: null,
    normalizedTextBody: null,
    quotedMessageId: null,
    replyToProviderMessageId: null,
    providerSentAt: new Date('2026-01-02T00:00:00.000Z'),
    mirroredAt: new Date('2026-01-02T00:00:00.000Z'),
    ingestSeq: BigInt(1),
    messageStatus: 'delivered',
    hasAttachments: true,
    providerMetadata: {},
    rawPayloadRef: null,
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z')
  });

  await attachmentRepository.upsert({
    id: 'attachment_1',
    tenantId: 'tenant_1',
    messageId: 'message_1',
    providerAttachmentId: 'att_hist_1',
    attachmentType: 'document',
    fileName: 'spec.pdf',
    mimeType: 'application/pdf',
    byteSize: null,
    checksumSha256: null,
    storageKey: null,
    downloadState: 'not_requested',
    providerUrlRef: null,
    previewRef: null,
    downloadRequestedAt: null,
    downloadCompletedAt: null,
    providerMetadata: {},
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z')
  });
}
