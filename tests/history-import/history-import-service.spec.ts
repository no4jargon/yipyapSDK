import { describe, expect, it } from 'vitest';
import { PostgresEventLogRepository } from '../../packages/event-log/src/event-log-repository';
import { HistoryImportService } from '../../packages/history-import/src/history-import-service';
import type {
  ProviderAdapter,
  ProviderAttachmentFetchResult,
  ProviderConversation,
  ProviderHistoryAnchor,
  ProviderHistoryPage,
  ProviderRawEvent,
  ProviderSendResult
} from '../../packages/provider-adapter-interface/src/index';
import { runMigrations } from '../../packages/storage/src/migrate';
import { PostgresAttachmentRepository } from '../../packages/storage/src/attachment-repository';
import { PostgresConnectionRepository } from '../../packages/storage/src/connection-repository';
import { PostgresConversationRepository } from '../../packages/storage/src/conversation-repository';
import { PostgresConversationSyncStateRepository } from '../../packages/storage/src/conversation-sync-state-repository';
import { PostgresHistoryImportRepository } from '../../packages/storage/src/history-import-repository';
import { PostgresMessageRepository } from '../../packages/storage/src/message-repository';
import { PostgresParticipantRepository } from '../../packages/storage/src/participant-repository';
import { createPostgresTestHarness } from '../../packages/test-kit/src/postgres-test-harness';

describe('history import service', () => {
  it('imports history week-by-week, persists resumable anchors, and completes with ordered messages', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      await seedImportGraph(harness);

      const adapter = createPagedHistoryAdapter();
      const service = new HistoryImportService({
        connectionRepository: new PostgresConnectionRepository(harness),
        conversationRepository: new PostgresConversationRepository(harness),
        conversationSyncStateRepository: new PostgresConversationSyncStateRepository(harness),
        participantRepository: new PostgresParticipantRepository(harness),
        messageRepository: new PostgresMessageRepository(harness),
        attachmentRepository: new PostgresAttachmentRepository(harness),
        historyImportRepository: new PostgresHistoryImportRepository(harness),
        eventLogRepository: new PostgresEventLogRepository(harness),
        providerAdapter: adapter,
        now: () => new Date('2026-01-10T00:00:00.000Z'),
        createId: (() => {
          let counter = 0;
          return (prefix: string) => `${prefix}_${++counter}`;
        })()
      });

      await service.scheduleConversationImport({ tenantId: 'tenant_1', conversationId: 'conv_1' });

      await service.runNextScheduledImport({ tenantId: 'tenant_1' });
      await expect(
        new PostgresHistoryImportRepository(harness).getByConversationId({
          tenantId: 'tenant_1',
          conversationId: 'conv_1'
        })
      ).resolves.toMatchObject({
        importState: 'running',
        anchorCursor: 'page_2'
      });

      await service.runNextScheduledImport({ tenantId: 'tenant_1' });

      await expect(
        new PostgresMessageRepository(harness).listByConversation({
          tenantId: 'tenant_1',
          conversationId: 'conv_1'
        })
      ).resolves.toMatchObject([
        {
          providerMessageId: 'hist_page_2_msg_1',
          textBody: 'older page',
          normalizedTextBody: 'older page'
        },
        {
          providerMessageId: 'hist_page_1_msg_1',
          textBody: 'newer page',
          normalizedTextBody: 'newer page'
        },
        {
          providerMessageId: 'hist_page_1_msg_2',
          textBody: 'document page',
          hasAttachments: true
        }
      ]);

      await expect(
        new PostgresAttachmentRepository(harness).listByMessage({
          tenantId: 'tenant_1',
          messageId: 'message_3'
        })
      ).resolves.toMatchObject([
        {
          providerAttachmentId: 'hist_att_1',
          fileName: 'history.pdf',
          downloadState: 'not_requested'
        }
      ]);

      await expect(
        new PostgresHistoryImportRepository(harness).getByConversationId({
          tenantId: 'tenant_1',
          conversationId: 'conv_1'
        })
      ).resolves.toMatchObject({
        importState: 'completed',
        anchorCursor: null,
        lastCompletedAt: new Date('2026-01-10T00:00:00.000Z')
      });

      await expect(
        new PostgresEventLogRepository(harness).listByTenant({
          tenantId: 'tenant_1',
          afterIngestSeq: null,
          limit: 20
        })
      ).resolves.toMatchObject([
        { eventType: 'history_import.started' },
        { eventType: 'message.mirrored' },
        { eventType: 'message.mirrored' },
        { eventType: 'attachment.discovered' },
        { eventType: 'history_import.page_completed' },
        { eventType: 'message.mirrored' },
        { eventType: 'history_import.page_completed' },
        { eventType: 'history_import.completed' }
      ]);

      expect(adapter.requestedAnchors).toEqual([null, 'page_2']);
    } finally {
      await harness.close();
    }
  });

  it('is restart-safe and does not duplicate messages when the same scheduled import runs again', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      await seedImportGraph(harness);

      const adapter = createPagedHistoryAdapter();
      const repository = new PostgresHistoryImportRepository(harness);
      const buildService = () =>
        new HistoryImportService({
          connectionRepository: new PostgresConnectionRepository(harness),
          conversationRepository: new PostgresConversationRepository(harness),
          conversationSyncStateRepository: new PostgresConversationSyncStateRepository(harness),
          participantRepository: new PostgresParticipantRepository(harness),
          messageRepository: new PostgresMessageRepository(harness),
          attachmentRepository: new PostgresAttachmentRepository(harness),
          historyImportRepository: repository,
          eventLogRepository: new PostgresEventLogRepository(harness),
          providerAdapter: adapter,
          now: () => new Date('2026-01-10T00:00:00.000Z'),
          createId: (() => {
            let counter = 0;
            return (prefix: string) => `${prefix}_${++counter}`;
          })()
        });

      await buildService().scheduleConversationImport({ tenantId: 'tenant_1', conversationId: 'conv_1' });
      await buildService().runNextScheduledImport({ tenantId: 'tenant_1' });
      await buildService().runNextScheduledImport({ tenantId: 'tenant_1' });
      await buildService().runNextScheduledImport({ tenantId: 'tenant_1' });

      await expect(
        new PostgresMessageRepository(harness).listByConversation({
          tenantId: 'tenant_1',
          conversationId: 'conv_1'
        })
      ).resolves.toHaveLength(3);

      await expect(
        repository.getByConversationId({
          tenantId: 'tenant_1',
          conversationId: 'conv_1'
        })
      ).resolves.toMatchObject({
        importState: 'completed'
      });
    } finally {
      await harness.close();
    }
  });
});

function createPagedHistoryAdapter(): ProviderAdapter & { requestedAnchors: Array<string | null> } {
  const requestedAnchors: Array<string | null> = [];

  return {
    requestedAnchors,
    async createSession(): Promise<void> {},
    async getConnectionBootstrapState() {
      return { status: 'connected' as const };
    },
    async connect(): Promise<void> {},
    async disconnect(): Promise<void> {},
    async listDiscoveredConversations(): Promise<ProviderConversation[]> {
      return [];
    },
    async subscribe(): Promise<() => Promise<void>> {
      return async () => {};
    },
    async requestHistoryPage(input: {
      connectionId: string;
      providerConversationId: string;
      pageDirection: 'backward';
      anchor?: ProviderHistoryAnchor;
      pageSizeDays: 7;
    }): Promise<ProviderHistoryPage> {
      requestedAnchors.push(input.anchor?.cursor ?? null);

      if (!input.anchor) {
        return {
          messages: [
            {
              providerMessageId: 'hist_page_1_msg_1',
              providerConversationId: 'conv_direct_1',
              senderId: 'participant_1',
              sentAt: new Date('2026-01-08T10:00:00.000Z'),
              messageType: 'text',
              textBody: 'newer page'
            },
            {
              providerMessageId: 'hist_page_1_msg_2',
              providerConversationId: 'conv_direct_1',
              senderId: 'participant_1',
              sentAt: new Date('2026-01-09T10:00:00.000Z'),
              messageType: 'document',
              textBody: 'document page',
              attachmentRef: 'hist_att_1',
              fileName: 'history.pdf'
            }
          ],
          nextAnchor: { cursor: 'page_2' }
        };
      }

      if (input.anchor.cursor === 'page_2') {
        return {
          messages: [
            {
              providerMessageId: 'hist_page_2_msg_1',
              providerConversationId: 'conv_direct_1',
              senderId: 'participant_1',
              sentAt: new Date('2026-01-01T10:00:00.000Z'),
              messageType: 'text',
              textBody: 'older page'
            }
          ],
          nextAnchor: null
        };
      }

      throw new Error(`unexpected anchor ${input.anchor.cursor}`);
    },
    async sendTextMessage(): Promise<ProviderSendResult> {
      throw new Error('not implemented in test adapter');
    },
    async sendAttachmentMessage(): Promise<ProviderSendResult> {
      throw new Error('not implemented in test adapter');
    },
    async fetchAttachment(): Promise<ProviderAttachmentFetchResult> {
      throw new Error('not implemented in test adapter');
    }
  };
}

async function seedImportGraph(harness: Awaited<ReturnType<typeof createPostgresTestHarness>>): Promise<void> {
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
