import { describe, expect, it } from 'vitest';
import { PostgresEventLogRepository } from '../../packages/event-log/src/event-log-repository';
import { createFakeProviderAdapter } from '../../packages/provider-adapter-interface/src/fake-provider-adapter';
import { SendPipelineService } from '../../packages/query-api/src/send-pipeline-service';
import { runMigrations } from '../../packages/storage/src/migrate';
import { PostgresAttachmentRepository } from '../../packages/storage/src/attachment-repository';
import { PostgresConnectionRepository } from '../../packages/storage/src/connection-repository';
import { PostgresConversationRepository } from '../../packages/storage/src/conversation-repository';
import { PostgresConversationSyncStateRepository } from '../../packages/storage/src/conversation-sync-state-repository';
import { PostgresMessageRepository } from '../../packages/storage/src/message-repository';
import { PostgresParticipantRepository } from '../../packages/storage/src/participant-repository';
import { createPostgresTestHarness } from '../../packages/test-kit/src/postgres-test-harness';

describe('send pipeline service', () => {
  it('sends a text message and persists the outbound canonical message with sent status', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      await seedSendGraph(harness);

      const service = new SendPipelineService({
        connectionRepository: new PostgresConnectionRepository(harness),
        conversationRepository: new PostgresConversationRepository(harness),
        conversationSyncStateRepository: new PostgresConversationSyncStateRepository(harness),
        participantRepository: new PostgresParticipantRepository(harness),
        messageRepository: new PostgresMessageRepository(harness),
        attachmentRepository: new PostgresAttachmentRepository(harness),
        eventLogRepository: new PostgresEventLogRepository(harness),
        providerAdapter: await createFakeProviderAdapter(),
        now: () => new Date('2026-01-11T00:00:00.000Z'),
        createId: (() => {
          let counter = 0;
          return (prefix: string) => `${prefix}_${++counter}`;
        })()
      });

      const sent = await service.sendTextMessage({
        tenantId: 'tenant_1',
        conversationId: 'conv_1',
        text: 'Hello outbound',
        clientMessageId: 'client_text_1'
      });

      expect(sent).toMatchObject({
        providerMessageId: 'sent_text_1',
        messageId: 'message_1'
      });

      await expect(
        new PostgresMessageRepository(harness).getById({
          tenantId: 'tenant_1',
          id: 'message_1'
        })
      ).resolves.toMatchObject({
        providerMessageId: 'sent_text_1',
        messageType: 'text',
        direction: 'outbound',
        textBody: 'Hello outbound',
        normalizedTextBody: 'hello outbound',
        hasAttachments: false,
        messageStatus: 'sent',
        senderParticipantId: 'participant_self_id',
        fromMe: true,
        providerSenderRef: 'participant_self',
        messagePreviewText: 'Hello outbound'
      });

      await expect(
        new PostgresConversationRepository(harness).getById({ tenantId: 'tenant_1', id: 'conv_1' })
      ).resolves.toMatchObject({
        lastProviderMessageAt: new Date('2026-01-08T00:00:00.000Z'),
        lastMessageId: 'message_1',
        lastMessagePreview: 'Hello outbound',
        lastMessageDirection: 'outbound'
      });

      await expect(
        new PostgresEventLogRepository(harness).listByTenant({
          tenantId: 'tenant_1',
          afterIngestSeq: null,
          limit: 10
        })
      ).resolves.toMatchObject([
        { eventType: 'message.sent', eventFamily: 'normalized' }
      ]);
    } finally {
      await harness.close();
    }
  });

  it('sends an attachment message and persists outbound attachment metadata once', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      await seedSendGraph(harness);

      const service = new SendPipelineService({
        connectionRepository: new PostgresConnectionRepository(harness),
        conversationRepository: new PostgresConversationRepository(harness),
        conversationSyncStateRepository: new PostgresConversationSyncStateRepository(harness),
        participantRepository: new PostgresParticipantRepository(harness),
        messageRepository: new PostgresMessageRepository(harness),
        attachmentRepository: new PostgresAttachmentRepository(harness),
        eventLogRepository: new PostgresEventLogRepository(harness),
        providerAdapter: await createFakeProviderAdapter(),
        now: () => new Date('2026-01-11T00:00:00.000Z'),
        createId: (() => {
          let counter = 0;
          return (prefix: string) => `${prefix}_${++counter}`;
        })()
      });

      const sent = await service.sendAttachmentMessage({
        tenantId: 'tenant_1',
        conversationId: 'conv_1',
        attachmentSource: {
          fileName: 'hello.txt',
          mimeType: 'text/plain',
          data: Buffer.from('hello attachment')
        },
        caption: 'greeting',
        clientMessageId: 'client_attachment_1'
      });

      expect(sent).toMatchObject({
        providerMessageId: 'sent_attachment_1',
        messageId: 'message_1',
        attachmentId: 'attachment_2'
      });

      await expect(
        new PostgresMessageRepository(harness).getById({
          tenantId: 'tenant_1',
          id: 'message_1'
        })
      ).resolves.toMatchObject({
        providerMessageId: 'sent_attachment_1',
        messageType: 'document',
        direction: 'outbound',
        textBody: 'greeting',
        hasAttachments: true,
        messageStatus: 'sent',
        fromMe: true,
        providerSenderRef: 'participant_self',
        messagePreviewText: 'greeting'
      });

      await expect(
        new PostgresConversationRepository(harness).getById({ tenantId: 'tenant_1', id: 'conv_1' })
      ).resolves.toMatchObject({
        lastMessageId: 'message_1',
        lastMessagePreview: 'greeting',
        lastMessageType: 'document',
        lastMessageDirection: 'outbound'
      });

      await expect(
        new PostgresAttachmentRepository(harness).listByMessage({
          tenantId: 'tenant_1',
          messageId: 'message_1'
        })
      ).resolves.toMatchObject([
        {
          id: 'attachment_2',
          providerAttachmentId: null,
          attachmentType: 'document',
          fileName: 'hello.txt',
          mimeType: 'text/plain',
          downloadState: 'available'
        }
      ]);

      await expect(
        new PostgresEventLogRepository(harness).listByTenant({
          tenantId: 'tenant_1',
          afterIngestSeq: null,
          limit: 10
        })
      ).resolves.toMatchObject([
        { eventType: 'message.sent', eventFamily: 'normalized' },
        { eventType: 'attachment.discovered', eventFamily: 'normalized' }
      ]);
    } finally {
      await harness.close();
    }
  });
});

async function seedSendGraph(harness: Awaited<ReturnType<typeof createPostgresTestHarness>>): Promise<void> {
  const connectionRepository = new PostgresConnectionRepository(harness);
  const conversationRepository = new PostgresConversationRepository(harness);
  const participantRepository = new PostgresParticipantRepository(harness);

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
    title: 'Direct chat',
    normalizedTitle: 'direct chat',
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

  await participantRepository.upsert({
    id: 'participant_self_id',
    tenantId: 'tenant_1',
    connectionId: 'conn_1',
    providerParticipantId: 'participant_self',
    phoneE164: '+15550000000',
    displayName: 'Self',
    profileName: null,
    waBusinessName: null,
    isSelf: true,
    providerMetadata: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z')
  });
}
