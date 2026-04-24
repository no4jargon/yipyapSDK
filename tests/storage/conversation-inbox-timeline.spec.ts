import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../packages/storage/src/migrate';
import { PostgresConnectionRepository } from '../../packages/storage/src/connection-repository';
import { PostgresConversationRepository } from '../../packages/storage/src/conversation-repository';
import { PostgresConversationSyncStateRepository } from '../../packages/storage/src/conversation-sync-state-repository';
import { PostgresMessageRepository } from '../../packages/storage/src/message-repository';
import { createPostgresTestHarness } from '../../packages/test-kit/src/postgres-test-harness';

describe('conversation inbox and timeline queries', () => {
  it('returns inbox chats ordered by latest provider activity with summary preview fields', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      await seedInboxGraph(harness);

      const conversations = new PostgresConversationRepository(harness);
      const syncStates = new PostgresConversationSyncStateRepository(harness);

      await syncStates.upsert({
        id: 'sync_1',
        tenantId: 'tenant_1',
        conversationId: 'conv_1',
        connectionId: 'conn_1',
        recentWindowDays: 7,
        recentWindowStartAt: new Date('2026-04-15T00:00:00.000Z'),
        recentWindowEndAt: new Date('2026-04-22T00:00:00.000Z'),
        earliestMirroredProviderSentAt: new Date('2026-04-20T10:00:00.000Z'),
        latestMirroredProviderSentAt: new Date('2026-04-22T10:00:00.000Z'),
        olderHistoryPossible: true,
        newerHistoryPossible: false,
        bootstrapState: 'ready',
        backfillState: 'idle',
        lastBackfillAnchorCursor: null,
        lastBackfillRequestedAt: null,
        lastBackfillCompletedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        createdAt: new Date('2026-04-22T00:00:00.000Z'),
        updatedAt: new Date('2026-04-22T00:00:00.000Z')
      });

      await syncStates.upsert({
        id: 'sync_2',
        tenantId: 'tenant_1',
        conversationId: 'conv_2',
        connectionId: 'conn_1',
        recentWindowDays: 7,
        recentWindowStartAt: new Date('2026-04-15T00:00:00.000Z'),
        recentWindowEndAt: new Date('2026-04-22T00:00:00.000Z'),
        earliestMirroredProviderSentAt: new Date('2026-04-21T10:00:00.000Z'),
        latestMirroredProviderSentAt: new Date('2026-04-22T11:00:00.000Z'),
        olderHistoryPossible: false,
        newerHistoryPossible: false,
        bootstrapState: 'partial',
        backfillState: 'idle',
        lastBackfillAnchorCursor: null,
        lastBackfillRequestedAt: null,
        lastBackfillCompletedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        createdAt: new Date('2026-04-22T00:00:00.000Z'),
        updatedAt: new Date('2026-04-22T00:00:00.000Z')
      });

      await expect(conversations.listInboxChats({ tenantId: 'tenant_1', connectionId: 'conn_1', limit: 10 })).resolves.toEqual([
        expect.objectContaining({
          conversationId: 'conv_2',
          title: 'Team',
          lastMessageAt: new Date('2026-04-22T11:00:00.000Z'),
          lastMessage: expect.objectContaining({ preview: 'Newest group reply', direction: 'inbound' }),
          sync: expect.objectContaining({ bootstrapState: 'partial', olderHistoryPossible: false })
        }),
        expect.objectContaining({
          conversationId: 'conv_1',
          title: 'Alice',
          lastMessageAt: new Date('2026-04-22T10:00:00.000Z'),
          lastMessage: expect.objectContaining({ preview: 'Outbound hello', direction: 'outbound' }),
          sync: expect.objectContaining({ bootstrapState: 'ready', olderHistoryPossible: true })
        })
      ]);
    } finally {
      await harness.close();
    }
  });

  it('returns timeline pages with stable cursors and excludes soft-deleted messages by default', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      await seedInboxGraph(harness);
      const messages = new PostgresMessageRepository(harness);

      const firstPage = await messages.listTimelinePage({
        tenantId: 'tenant_1',
        conversationId: 'conv_1',
        limit: 2
      });

      expect(firstPage.items.map((item) => item.providerMessageId)).toEqual(['conv1_msg_1', 'conv1_msg_2']);
      expect(firstPage.hasOlder).toBe(false);
      expect(firstPage.nextBeforeCursor).toEqual({
        providerSentAt: new Date('2026-04-22T08:00:00.000Z'),
        ingestSeq: BigInt(1)
      });

      const secondPage = await messages.listTimelinePage({
        tenantId: 'tenant_1',
        conversationId: 'conv_1',
        limit: 2,
        before: firstPage.nextBeforeCursor ?? undefined
      });

      expect(secondPage.items.map((item) => item.providerMessageId)).toEqual([]);
      expect(secondPage.hasOlder).toBe(false);

      const includeDeleted = await messages.listTimelinePage({
        tenantId: 'tenant_1',
        conversationId: 'conv_1',
        limit: 10,
        includeDeleted: true
      });

      expect(includeDeleted.items.map((item) => item.providerMessageId)).toEqual(['conv1_msg_1', 'conv1_msg_2', 'conv1_msg_3']);
    } finally {
      await harness.close();
    }
  });
});

async function seedInboxGraph(harness: Awaited<ReturnType<typeof createPostgresTestHarness>>): Promise<void> {
  const connections = new PostgresConnectionRepository(harness);
  const conversations = new PostgresConversationRepository(harness);
  const messages = new PostgresMessageRepository(harness);

  await connections.create({
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

  await conversations.upsert({
    id: 'conv_1',
    tenantId: 'tenant_1',
    connectionId: 'conn_1',
    providerConversationId: 'alice@s.whatsapp.net',
    conversationType: 'direct',
    title: 'Alice',
    normalizedTitle: 'alice',
    avatarRef: null,
    isSelected: true,
    selectionStateChangedAt: new Date('2026-04-22T00:00:00.000Z'),
    lastProviderMessageAt: new Date('2026-04-22T10:00:00.000Z'),
    lastMirroredMessageAt: new Date('2026-04-22T10:00:00.000Z'),
    lastMessageId: 'message_2',
    lastMessageIngestSeq: BigInt(2),
    lastMessagePreview: 'Outbound hello',
    lastMessageType: 'text',
    lastMessageDirection: 'outbound',
    participantCount: 2,
    providerMetadata: {},
    createdAt: new Date('2026-04-22T00:00:00.000Z'),
    updatedAt: new Date('2026-04-22T10:00:00.000Z')
  });

  await conversations.upsert({
    id: 'conv_2',
    tenantId: 'tenant_1',
    connectionId: 'conn_1',
    providerConversationId: 'team@g.us',
    conversationType: 'group',
    title: 'Team',
    normalizedTitle: 'team',
    avatarRef: null,
    isSelected: false,
    selectionStateChangedAt: null,
    lastProviderMessageAt: new Date('2026-04-22T11:00:00.000Z'),
    lastMirroredMessageAt: new Date('2026-04-22T11:00:00.000Z'),
    lastMessageId: 'message_4',
    lastMessageIngestSeq: BigInt(4),
    lastMessagePreview: 'Newest group reply',
    lastMessageType: 'text',
    lastMessageDirection: 'inbound',
    participantCount: 3,
    providerMetadata: {},
    createdAt: new Date('2026-04-22T00:00:00.000Z'),
    updatedAt: new Date('2026-04-22T11:00:00.000Z')
  });

  await messages.upsert({
    id: 'message_1',
    tenantId: 'tenant_1',
    connectionId: 'conn_1',
    conversationId: 'conv_1',
    providerMessageId: 'conv1_msg_1',
    senderParticipantId: null,
    providerSenderRef: 'alice',
    fromMe: false,
    messageType: 'text',
    direction: 'inbound',
    textBody: 'Oldest message',
    normalizedTextBody: 'oldest message',
    quotedMessageId: null,
    replyToProviderMessageId: null,
    providerSentAt: new Date('2026-04-22T08:00:00.000Z'),
    mirroredAt: new Date('2026-04-22T08:00:00.000Z'),
    ingestSeq: BigInt(1),
    messageStatus: 'delivered',
    hasAttachments: false,
    messagePreviewText: 'Oldest message',
    providerMetadata: {},
    rawPayloadRef: null,
    createdAt: new Date('2026-04-22T08:00:00.000Z'),
    updatedAt: new Date('2026-04-22T08:00:00.000Z')
  });

  await messages.upsert({
    id: 'message_2',
    tenantId: 'tenant_1',
    connectionId: 'conn_1',
    conversationId: 'conv_1',
    providerMessageId: 'conv1_msg_2',
    senderParticipantId: null,
    providerSenderRef: 'participant_self',
    fromMe: true,
    messageType: 'text',
    direction: 'outbound',
    textBody: 'Outbound hello',
    normalizedTextBody: 'outbound hello',
    quotedMessageId: null,
    replyToProviderMessageId: null,
    providerSentAt: new Date('2026-04-22T09:00:00.000Z'),
    mirroredAt: new Date('2026-04-22T09:00:00.000Z'),
    ingestSeq: BigInt(2),
    messageStatus: 'sent',
    hasAttachments: false,
    messagePreviewText: 'Outbound hello',
    providerMetadata: {},
    rawPayloadRef: null,
    createdAt: new Date('2026-04-22T09:00:00.000Z'),
    updatedAt: new Date('2026-04-22T09:00:00.000Z')
  });

  await messages.upsert({
    id: 'message_3',
    tenantId: 'tenant_1',
    connectionId: 'conn_1',
    conversationId: 'conv_1',
    providerMessageId: 'conv1_msg_3',
    senderParticipantId: null,
    providerSenderRef: 'alice',
    fromMe: false,
    messageType: 'text',
    direction: 'inbound',
    textBody: 'Soft deleted message',
    normalizedTextBody: 'soft deleted message',
    quotedMessageId: null,
    replyToProviderMessageId: null,
    providerSentAt: new Date('2026-04-22T10:00:00.000Z'),
    mirroredAt: new Date('2026-04-22T10:00:00.000Z'),
    ingestSeq: BigInt(3),
    messageStatus: 'deleted',
    hasAttachments: false,
    messagePreviewText: '[Message deleted]',
    providerMetadata: {},
    rawPayloadRef: null,
    createdAt: new Date('2026-04-22T10:00:00.000Z'),
    updatedAt: new Date('2026-04-22T10:00:00.000Z')
  });

  await messages.upsert({
    id: 'message_4',
    tenantId: 'tenant_1',
    connectionId: 'conn_1',
    conversationId: 'conv_2',
    providerMessageId: 'conv2_msg_1',
    senderParticipantId: null,
    providerSenderRef: 'bob',
    fromMe: false,
    messageType: 'text',
    direction: 'inbound',
    textBody: 'Newest group reply',
    normalizedTextBody: 'newest group reply',
    quotedMessageId: null,
    replyToProviderMessageId: null,
    providerSentAt: new Date('2026-04-22T11:00:00.000Z'),
    mirroredAt: new Date('2026-04-22T11:00:00.000Z'),
    ingestSeq: BigInt(4),
    messageStatus: 'delivered',
    hasAttachments: false,
    messagePreviewText: 'Newest group reply',
    providerMetadata: {},
    rawPayloadRef: null,
    createdAt: new Date('2026-04-22T11:00:00.000Z'),
    updatedAt: new Date('2026-04-22T11:00:00.000Z')
  });
}
