export const connectionBootstrapStatuses = [
  'pending',
  'qr_ready',
  'connecting',
  'connected',
  'reauth_required',
  'failed'
] as const;

export type ConnectionBootstrapStatus =
  (typeof connectionBootstrapStatuses)[number];

export const providerEventFamilies = ['provider_raw'] as const;
export type ProviderEventFamily = (typeof providerEventFamilies)[number];

export const supportedHistoryPageDirections = ['backward'] as const;
export type ProviderHistoryPageDirection =
  (typeof supportedHistoryPageDirections)[number];

export interface ProviderConversationParticipant {
  providerParticipantId: string;
  displayName: string | null;
  phoneE164: string | null;
  isSelf: boolean;
}

export interface ProviderConversation {
  providerConversationId: string;
  conversationType: 'direct' | 'group' | 'broadcast' | 'unknown';
  title: string;
  participants?: ProviderConversationParticipant[];
}

export interface ProviderRawEvent {
  family: ProviderEventFamily;
  type: string;
  connectionId: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
}

export interface ProviderHistoryAnchor {
  cursor: string;
}

export interface ProviderHistoryMessage {
  providerMessageId: string;
  providerConversationId: string;
  senderId: string;
  sentAt: Date;
  messageType: 'text' | 'image' | 'document' | 'unknown';
  textBody?: string;
  attachmentRef?: string;
  fileName?: string;
}

export interface ProviderHistoryPage {
  messages: ProviderHistoryMessage[];
  nextAnchor: ProviderHistoryAnchor | null;
}

export interface ProviderAttachmentSource {
  fileName: string;
  mimeType: string;
  data: Buffer;
}

export interface ProviderSendResult {
  providerMessageId: string;
  providerTimestamp: Date;
}

export interface ProviderAttachmentFetchResult {
  mimeType: string;
  fileName: string;
  data: Buffer;
}

export interface ProviderAdapter {
  createSession(input: { connectionId: string }): Promise<void>;
  getConnectionBootstrapState(connectionId: string): Promise<{
    status: ConnectionBootstrapStatus;
    qrPayload?: string;
  }>;
  connect(connectionId: string): Promise<void>;
  disconnect(connectionId: string): Promise<void>;
  listDiscoveredConversations(connectionId: string): Promise<ProviderConversation[]>;
  subscribe(
    connectionId: string,
    onEvent: (event: ProviderRawEvent) => Promise<void>
  ): Promise<() => Promise<void>>;
  requestHistoryPage(input: {
    connectionId: string;
    providerConversationId: string;
    pageDirection: ProviderHistoryPageDirection;
    anchor?: ProviderHistoryAnchor;
    pageSizeDays: 7;
  }): Promise<ProviderHistoryPage>;
  sendTextMessage(input: {
    connectionId: string;
    providerConversationId: string;
    text: string;
    clientMessageId?: string;
  }): Promise<ProviderSendResult>;
  sendAttachmentMessage(input: {
    connectionId: string;
    providerConversationId: string;
    attachmentSource: ProviderAttachmentSource;
    caption?: string;
    clientMessageId?: string;
  }): Promise<ProviderSendResult>;
  fetchAttachment(input: {
    connectionId: string;
    providerAttachmentRef: string;
  }): Promise<ProviderAttachmentFetchResult>;
}
