import type {
  ProviderAdapter,
  ProviderAttachmentFetchResult,
  ProviderConversation,
  ProviderHistoryAnchor,
  ProviderHistoryMessage,
  ProviderRawEvent,
  ProviderSendResult
} from './index';

interface SessionState {
  status: 'pending' | 'qr_ready' | 'connecting' | 'connected' | 'reauth_required' | 'failed';
  qrPayload?: string;
}

const discoveredConversations: ProviderConversation[] = [
  {
    providerConversationId: 'conv_direct_1',
    conversationType: 'direct',
    title: 'Direct chat'
  },
  {
    providerConversationId: 'conv_group_1',
    conversationType: 'group',
    title: 'Group chat',
    participants: [
      {
        providerParticipantId: 'participant_self',
        displayName: 'Self',
        phoneE164: '+15550000000',
        isSelf: true
      },
      {
        providerParticipantId: 'participant_1',
        displayName: 'Alice',
        phoneE164: '+15550000001',
        isSelf: false
      },
      {
        providerParticipantId: 'participant_2',
        displayName: 'Bob',
        phoneE164: '+15550000002',
        isSelf: false
      }
    ]
  }
];

const historyByConversation = new Map<string, ProviderHistoryMessage[]>([
  [
    'conv_direct_1',
    [
      {
        providerMessageId: 'hist_direct_2',
        providerConversationId: 'conv_direct_1',
        senderId: 'participant_2',
        sentAt: new Date('2026-01-07T10:00:00.000Z'),
        messageType: 'text',
        textBody: 'history newer'
      },
      {
        providerMessageId: 'hist_direct_1',
        providerConversationId: 'conv_direct_1',
        senderId: 'participant_1',
        sentAt: new Date('2026-01-02T10:00:00.000Z'),
        messageType: 'document',
        textBody: 'history older',
        attachmentRef: 'att_hist_1',
        fileName: 'history.txt'
      }
    ]
  ],
  ['conv_group_1', []]
]);

const attachmentData = new Map<string, ProviderAttachmentFetchResult>([
  [
    'att_hist_1',
    {
      mimeType: 'text/plain',
      fileName: 'history.txt',
      data: Buffer.from('history attachment')
    }
  ]
]);

export async function createFakeProviderAdapter(): Promise<ProviderAdapter> {
  const sessions = new Map<string, SessionState>();
  const subscribers = new Map<string, Set<(event: ProviderRawEvent) => Promise<void>>>();
  let sentTextCount = 0;
  let sentAttachmentCount = 0;

  return {
    async createSession(input: { connectionId: string }): Promise<void> {
      sessions.set(input.connectionId, {
        status: 'qr_ready',
        qrPayload: `fake-qr:${input.connectionId}`
      });
    },

    async getConnectionBootstrapState(connectionId: string) {
      const session = sessions.get(connectionId);
      if (!session) {
        return { status: 'pending' as const };
      }

      return session.qrPayload
        ? { status: session.status, qrPayload: session.qrPayload }
        : { status: session.status };
    },

    async connect(connectionId: string): Promise<void> {
      sessions.set(connectionId, { status: 'connected' });
    },

    async disconnect(connectionId: string): Promise<void> {
      sessions.set(connectionId, { status: 'pending' });
    },

    async listDiscoveredConversations(): Promise<ProviderConversation[]> {
      return discoveredConversations.map((conversation) => ({ ...conversation }));
    },

    async subscribe(connectionId: string, onEvent: (event: ProviderRawEvent) => Promise<void>) {
      const current = subscribers.get(connectionId) ?? new Set();
      current.add(onEvent);
      subscribers.set(connectionId, current);

      return async () => {
        const active = subscribers.get(connectionId);
        active?.delete(onEvent);
      };
    },

    async requestHistoryPage(input: {
      providerConversationId: string;
      anchor?: ProviderHistoryAnchor;
      pageSizeDays: 7;
    }) {
      if (input.pageSizeDays !== 7) {
        throw new Error('fake adapter only supports seven-day history pages');
      }

      const messages = historyByConversation.get(input.providerConversationId) ?? [];
      return {
        messages: messages.map((message) => ({ ...message })),
        nextAnchor: null
      };
    },

    async sendTextMessage(input: {
      connectionId: string;
      providerConversationId: string;
      text: string;
      clientMessageId?: string;
    }): Promise<ProviderSendResult> {
      sentTextCount += 1;
      const result = {
        providerMessageId: `sent_text_${sentTextCount}`,
        providerTimestamp: new Date('2026-01-08T00:00:00.000Z')
      };

      await emit(subscribers, input.connectionId, {
        family: 'provider_raw',
        type: 'message.sent',
        connectionId: input.connectionId,
        occurredAt: result.providerTimestamp,
        payload: {
          providerConversationId: input.providerConversationId,
          providerMessageId: result.providerMessageId,
          text: input.text,
          clientMessageId: input.clientMessageId ?? null
        }
      });

      return result;
    },

    async sendAttachmentMessage(input: {
      connectionId: string;
      providerConversationId: string;
      attachmentSource: { fileName: string; mimeType: string; data: Buffer };
      caption?: string;
      clientMessageId?: string;
    }): Promise<ProviderSendResult> {
      sentAttachmentCount += 1;
      const result = {
        providerMessageId: `sent_attachment_${sentAttachmentCount}`,
        providerTimestamp: new Date('2026-01-08T00:00:01.000Z')
      };

      await emit(subscribers, input.connectionId, {
        family: 'provider_raw',
        type: 'attachment.sent',
        connectionId: input.connectionId,
        occurredAt: result.providerTimestamp,
        payload: {
          providerConversationId: input.providerConversationId,
          providerMessageId: result.providerMessageId,
          fileName: input.attachmentSource.fileName,
          mimeType: input.attachmentSource.mimeType,
          caption: input.caption ?? null,
          clientMessageId: input.clientMessageId ?? null
        }
      });

      return result;
    },

    async fetchAttachment(input: {
      providerAttachmentRef: string;
    }): Promise<ProviderAttachmentFetchResult> {
      const attachment = attachmentData.get(input.providerAttachmentRef);
      if (!attachment) {
        throw new Error(`unknown attachment: ${input.providerAttachmentRef}`);
      }

      return {
        mimeType: attachment.mimeType,
        fileName: attachment.fileName,
        data: Buffer.from(attachment.data)
      };
    }
  };
}

async function emit(
  subscribers: Map<string, Set<(event: ProviderRawEvent) => Promise<void>>>,
  connectionId: string,
  event: ProviderRawEvent
): Promise<void> {
  const handlers = subscribers.get(connectionId);
  if (!handlers) {
    return;
  }

  for (const handler of handlers) {
    await handler(event);
  }
}
