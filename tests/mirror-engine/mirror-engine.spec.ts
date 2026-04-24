import { describe, expect, it } from 'vitest';
import { PostgresEventLogRepository } from '../../packages/event-log/src/event-log-repository';
import { MirrorEngine } from '../../packages/mirror-engine/src/mirror-engine';
import type { ProviderRawEvent } from '../../packages/provider-adapter-interface/src/index';
import { runMigrations } from '../../packages/storage/src/migrate';
import { PostgresAttachmentRepository } from '../../packages/storage/src/attachment-repository';
import { PostgresConnectionRepository } from '../../packages/storage/src/connection-repository';
import { PostgresConversationRepository } from '../../packages/storage/src/conversation-repository';
import { PostgresConversationSyncStateRepository } from '../../packages/storage/src/conversation-sync-state-repository';
import { PostgresMessageRepository } from '../../packages/storage/src/message-repository';
import { PostgresParticipantRepository } from '../../packages/storage/src/participant-repository';
import { PostgresReceiptRepository } from '../../packages/storage/src/receipt-repository';
import { createPostgresTestHarness } from '../../packages/test-kit/src/postgres-test-harness';

describe('mirror engine', () => {
  it('persists raw provider events and normalizes incoming text, attachments, and receipts', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      const eventLogRepository = new PostgresEventLogRepository(harness);
      const engine = new MirrorEngine({
        connectionRepository: new PostgresConnectionRepository(harness),
        conversationRepository: new PostgresConversationRepository(harness),
        conversationSyncStateRepository: new PostgresConversationSyncStateRepository(harness),
        participantRepository: new PostgresParticipantRepository(harness),
        messageRepository: new PostgresMessageRepository(harness),
        attachmentRepository: new PostgresAttachmentRepository(harness),
        receiptRepository: new PostgresReceiptRepository(harness),
        eventLogRepository,
        now: () => new Date('2026-01-09T00:00:00.000Z'),
        createId: (() => {
          let counter = 0;
          return (prefix: string) => `${prefix}_${++counter}`;
        })()
      });

      await seedConnectionGraph(harness);

      await engine.ingestProviderEvent({
        tenantId: 'tenant_1',
        event: {
          family: 'provider_raw',
          type: 'message.received',
          connectionId: 'conn_1',
          occurredAt: new Date('2026-01-09T01:00:00.000Z'),
          payload: {
            providerConversationId: 'conv_direct_1',
            providerMessageId: 'provider_msg_1',
            senderId: 'participant_1',
            messageType: 'text',
            textBody: 'Hello mirror engine'
          }
        }
      });

      await engine.ingestProviderEvent({
        tenantId: 'tenant_1',
        event: {
          family: 'provider_raw',
          type: 'message.received',
          connectionId: 'conn_1',
          occurredAt: new Date('2026-01-09T01:05:00.000Z'),
          payload: {
            providerConversationId: 'conv_direct_1',
            providerMessageId: 'provider_msg_2',
            senderId: 'participant_1',
            messageType: 'document',
            textBody: 'Spec attachment',
            attachmentRef: 'provider_attachment_1',
            fileName: 'spec.pdf',
            mimeType: 'application/pdf',
            byteSize: 128
          }
        }
      });

      await engine.ingestProviderEvent({
        tenantId: 'tenant_1',
        event: {
          family: 'provider_raw',
          type: 'receipt.updated',
          connectionId: 'conn_1',
          occurredAt: new Date('2026-01-09T01:06:00.000Z'),
          payload: {
            providerConversationId: 'conv_direct_1',
            providerMessageId: 'provider_msg_1',
            receiptType: 'read',
            participantId: 'participant_self',
            providerAt: '2026-01-09T01:06:00.000Z'
          }
        }
      });

      await expect(
        new PostgresMessageRepository(harness).listByConversation({
          tenantId: 'tenant_1',
          conversationId: 'conv_1'
        })
      ).resolves.toMatchObject([
        {
          providerMessageId: 'provider_msg_1',
          senderParticipantId: 'participant_1_id',
          providerSenderRef: 'participant_1',
          messageType: 'text',
          direction: 'inbound',
          textBody: 'Hello mirror engine',
          normalizedTextBody: 'hello mirror engine',
          hasAttachments: false,
          messageStatus: 'delivered',
          messagePreviewText: 'Hello mirror engine'
        },
        {
          providerMessageId: 'provider_msg_2',
          senderParticipantId: 'participant_1_id',
          providerSenderRef: 'participant_1',
          messageType: 'document',
          direction: 'inbound',
          textBody: 'Spec attachment',
          hasAttachments: true,
          messageStatus: 'delivered'
        }
      ]);

      await expect(
        new PostgresConversationRepository(harness).getById({ tenantId: 'tenant_1', id: 'conv_1' })
      ).resolves.toMatchObject({
        lastProviderMessageAt: new Date('2026-01-09T01:05:00.000Z'),
        lastMessageId: 'message_2',
        lastMessagePreview: 'Spec attachment',
        lastMessageDirection: 'inbound'
      });

      await expect(
        new PostgresAttachmentRepository(harness).listByMessage({
          tenantId: 'tenant_1',
          messageId: 'message_2'
        })
      ).resolves.toMatchObject([
        {
          providerAttachmentId: 'provider_attachment_1',
          attachmentType: 'document',
          fileName: 'spec.pdf',
          mimeType: 'application/pdf',
          byteSize: BigInt(128),
          downloadState: 'not_requested'
        }
      ]);

      await expect(
        new PostgresReceiptRepository(harness).listByMessage({
          tenantId: 'tenant_1',
          messageId: 'message_1'
        })
      ).resolves.toMatchObject([
        {
          receiptType: 'read',
          participantId: 'participant_self_id'
        }
      ]);

      await expect(
        eventLogRepository.listByTenant({
          tenantId: 'tenant_1',
          afterIngestSeq: null,
          limit: 20
        })
      ).resolves.toMatchObject([
        { eventFamily: 'provider_raw', eventType: 'message.received' },
        { eventFamily: 'normalized', eventType: 'message.mirrored' },
        { eventFamily: 'provider_raw', eventType: 'message.received' },
        { eventFamily: 'normalized', eventType: 'message.mirrored' },
        { eventFamily: 'normalized', eventType: 'attachment.discovered' },
        { eventFamily: 'provider_raw', eventType: 'receipt.updated' },
        { eventFamily: 'normalized', eventType: 'receipt.observed' }
      ]);
    } finally {
      await harness.close();
    }
  });

  it('dedupes duplicate raw provider events and avoids duplicate messages or attachments', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      const eventLogRepository = new PostgresEventLogRepository(harness);
      const engine = new MirrorEngine({
        connectionRepository: new PostgresConnectionRepository(harness),
        conversationRepository: new PostgresConversationRepository(harness),
        conversationSyncStateRepository: new PostgresConversationSyncStateRepository(harness),
        participantRepository: new PostgresParticipantRepository(harness),
        messageRepository: new PostgresMessageRepository(harness),
        attachmentRepository: new PostgresAttachmentRepository(harness),
        receiptRepository: new PostgresReceiptRepository(harness),
        eventLogRepository,
        now: () => new Date('2026-01-09T00:00:00.000Z'),
        createId: (() => {
          let counter = 0;
          return (prefix: string) => `${prefix}_${++counter}`;
        })()
      });

      await seedConnectionGraph(harness);

      const duplicateEvent: ProviderRawEvent = {
        family: 'provider_raw',
        type: 'message.received',
        connectionId: 'conn_1',
        occurredAt: new Date('2026-01-09T01:05:00.000Z'),
        payload: {
          providerConversationId: 'conv_direct_1',
          providerMessageId: 'provider_msg_dup_1',
          senderId: 'participant_1',
          messageType: 'document',
          textBody: 'Repeated attachment',
          attachmentRef: 'provider_attachment_dup_1',
          fileName: 'dup.pdf',
          mimeType: 'application/pdf',
          byteSize: 32,
          dedupeKey: 'raw:dup:1'
        }
      };

      await engine.ingestProviderEvent({ tenantId: 'tenant_1', event: duplicateEvent });
      await engine.ingestProviderEvent({ tenantId: 'tenant_1', event: duplicateEvent });

      await expect(
        new PostgresMessageRepository(harness).listByConversation({
          tenantId: 'tenant_1',
          conversationId: 'conv_1'
        })
      ).resolves.toHaveLength(1);

      await expect(
        new PostgresAttachmentRepository(harness).listByMessage({
          tenantId: 'tenant_1',
          messageId: 'message_1'
        })
      ).resolves.toHaveLength(1);

      const rawEvents = (await eventLogRepository.listByTenant({
        tenantId: 'tenant_1',
        afterIngestSeq: null,
        limit: 20
      })).filter((event) => event.eventFamily === 'provider_raw');

      expect(rawEvents).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });
});

async function seedConnectionGraph(harness: Awaited<ReturnType<typeof createPostgresTestHarness>>): Promise<void> {
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

  await participantRepository.upsert({
    id: 'participant_1_id',
    tenantId: 'tenant_1',
    connectionId: 'conn_1',
    providerParticipantId: 'participant_1',
    phoneE164: '+15550000001',
    displayName: 'Alice',
    profileName: null,
    waBusinessName: null,
    isSelf: false,
    providerMetadata: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z')
  });
}
