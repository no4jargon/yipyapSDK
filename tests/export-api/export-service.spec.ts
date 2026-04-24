import { describe, expect, it } from 'vitest';
import { ExportService } from '../../packages/export-api/src/export-service';
import { EventStreamService } from '../../packages/event-stream-api/src/event-stream-service';
import { PostgresEventLogRepository } from '../../packages/event-log/src/event-log-repository';
import { runMigrations } from '../../packages/storage/src/migrate';
import { PostgresConnectionRepository } from '../../packages/storage/src/connection-repository';
import { PostgresConversationRepository } from '../../packages/storage/src/conversation-repository';
import { PostgresExportCursorRepository } from '../../packages/storage/src/export-cursor-repository';
import { PostgresMessageRepository } from '../../packages/storage/src/message-repository';
import { createPostgresTestHarness } from '../../packages/test-kit/src/postgres-test-harness';

describe('export service', () => {
  it('exports events and messages in ingest order and advances resumable cursors', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      await seedExportGraph(harness);

      const service = new ExportService({
        eventLogRepository: new PostgresEventLogRepository(harness),
        messageRepository: new PostgresMessageRepository(harness),
        exportCursorRepository: new PostgresExportCursorRepository(harness),
        createId: (() => {
          let counter = 0;
          return (prefix: string) => `${prefix}_${++counter}`;
        })()
      });

      const cursor = await service.getOrCreateCursor({ tenantId: 'tenant_1', cursorName: 'worker-a' });
      expect(cursor).toMatchObject({ cursorName: 'worker-a', lastIngestSeq: BigInt(0) });

      await expect(
        service.exportEvents({ tenantId: 'tenant_1', cursorName: 'worker-a', limit: 10 })
      ).resolves.toMatchObject([
        { eventType: 'conversation.discovered', ingestSeq: BigInt(1) },
        { eventType: 'message.mirrored', ingestSeq: BigInt(2) },
        { eventType: 'message.mirrored', ingestSeq: BigInt(3) }
      ]);

      await service.advanceCursor({ tenantId: 'tenant_1', cursorName: 'worker-a', lastIngestSeq: BigInt(1) });

      await expect(
        service.exportEvents({ tenantId: 'tenant_1', cursorName: 'worker-a', limit: 10 })
      ).resolves.toMatchObject([
        { eventType: 'message.mirrored', ingestSeq: BigInt(2) },
        { eventType: 'message.mirrored', ingestSeq: BigInt(3) }
      ]);

      await expect(
        service.exportMessages({ tenantId: 'tenant_1', afterIngestSeq: BigInt(0), limit: 10 })
      ).resolves.toMatchObject([
        { id: 'message_1', ingestSeq: BigInt(2) },
        { id: 'message_2', ingestSeq: BigInt(3) }
      ]);
    } finally {
      await harness.close();
    }
  });

  it('streams normalized events to in-process subscribers in append order', async () => {
    const stream = new EventStreamService();
    const seen: string[] = [];

    const unsubscribe = stream.subscribeNormalizedEvents(async (event) => {
      seen.push(event.eventType);
    });

    await stream.publish({ eventType: 'message.mirrored', eventFamily: 'normalized', ingestSeq: BigInt(1) });
    await stream.publish({ eventType: 'attachment.discovered', eventFamily: 'normalized', ingestSeq: BigInt(2) });
    await stream.publish({ eventType: 'provider.raw', eventFamily: 'provider_raw', ingestSeq: BigInt(3) });
    await unsubscribe();

    expect(seen).toEqual(['message.mirrored', 'attachment.discovered']);
  });
});

async function seedExportGraph(harness: Awaited<ReturnType<typeof createPostgresTestHarness>>): Promise<void> {
  const connectionRepository = new PostgresConnectionRepository(harness);
  const conversationRepository = new PostgresConversationRepository(harness);
  const messageRepository = new PostgresMessageRepository(harness);
  const eventLogRepository = new PostgresEventLogRepository(harness);

  await connectionRepository.create({
    id: 'conn_1', tenantId: 'tenant_1', workspaceUserRef: 'user_1', provider: 'whatsapp_linked', status: 'connected', statusReason: 'none',
    createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'), providerAccountRef: null, deviceLabel: null,
    lastConnectedAt: new Date('2026-01-01T00:00:00.000Z'), lastHeartbeatAt: null, reauthRequiredAt: null, disconnectedAt: null
  });

  await conversationRepository.upsert({
    id: 'conv_1', tenantId: 'tenant_1', connectionId: 'conn_1', providerConversationId: 'provider_conv_1', conversationType: 'direct',
    title: 'Export chat', normalizedTitle: 'export chat', avatarRef: null, isSelected: true, selectionStateChangedAt: new Date('2026-01-01T00:00:00.000Z'),
    lastProviderMessageAt: null, lastMirroredMessageAt: null, participantCount: 2, providerMetadata: {}, createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z')
  });

  await eventLogRepository.append({ tenantId: 'tenant_1', eventType: 'conversation.discovered', eventFamily: 'normalized', connectionId: 'conn_1', conversationId: 'conv_1', messageId: null, clusterId: null, occurredAt: new Date('2026-01-02T00:00:00.000Z'), payloadJson: {}, dedupeKey: 'e1' });
  const messageEvent = await eventLogRepository.append({ tenantId: 'tenant_1', eventType: 'message.mirrored', eventFamily: 'normalized', connectionId: 'conn_1', conversationId: 'conv_1', messageId: 'message_1', clusterId: null, occurredAt: new Date('2026-01-03T00:00:00.000Z'), payloadJson: {}, dedupeKey: 'e2' });
  const messageEvent2 = await eventLogRepository.append({ tenantId: 'tenant_1', eventType: 'message.mirrored', eventFamily: 'normalized', connectionId: 'conn_1', conversationId: 'conv_1', messageId: 'message_2', clusterId: null, occurredAt: new Date('2026-01-04T00:00:00.000Z'), payloadJson: {}, dedupeKey: 'e3' });

  await messageRepository.upsert({ id: 'message_1', tenantId: 'tenant_1', connectionId: 'conn_1', conversationId: 'conv_1', providerMessageId: 'pm1', senderParticipantId: null, messageType: 'text', direction: 'inbound', textBody: 'first', normalizedTextBody: 'first', quotedMessageId: null, replyToProviderMessageId: null, providerSentAt: new Date('2026-01-03T00:00:00.000Z'), mirroredAt: new Date('2026-01-03T00:00:00.000Z'), ingestSeq: messageEvent.ingestSeq, messageStatus: 'delivered', hasAttachments: false, providerMetadata: {}, rawPayloadRef: null, createdAt: new Date('2026-01-03T00:00:00.000Z'), updatedAt: new Date('2026-01-03T00:00:00.000Z') });
  await messageRepository.upsert({ id: 'message_2', tenantId: 'tenant_1', connectionId: 'conn_1', conversationId: 'conv_1', providerMessageId: 'pm2', senderParticipantId: null, messageType: 'text', direction: 'inbound', textBody: 'second', normalizedTextBody: 'second', quotedMessageId: null, replyToProviderMessageId: null, providerSentAt: new Date('2026-01-04T00:00:00.000Z'), mirroredAt: new Date('2026-01-04T00:00:00.000Z'), ingestSeq: messageEvent2.ingestSeq, messageStatus: 'delivered', hasAttachments: false, providerMetadata: {}, rawPayloadRef: null, createdAt: new Date('2026-01-04T00:00:00.000Z'), updatedAt: new Date('2026-01-04T00:00:00.000Z') });
}
