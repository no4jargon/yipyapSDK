import { ServerHttpClient, type HttpClientOptions } from '../../sdk-server-http/src/http-client';

export interface SdkClient {
  createConnection(input: { workspaceUserRef: string }): Promise<{ id: string; status: string }>;
  getConnectionStatus(input: { connectionId: string }): Promise<{ id: string; status: string }>;
  listDiscoveredConversations(input: { connectionId: string }): Promise<Array<{ id: string }>>;
  listInboxChats(input: { connectionId: string; limit?: number; cursor?: string }): Promise<{ items: Array<{ conversationId: string }>; nextCursor: string | null }>;
  selectConversation(input: { conversationId: string }): Promise<{ id: string; isSelected: boolean }>;
  getConversationTimeline(input: { conversationId: string; limit?: number; before?: string; after?: string; includeDeleted?: boolean }): Promise<{ items: Array<{ messageId: string }>; pageInfo: { nextBeforeCursor: string | null; nextAfterCursor: string | null; hasOlder: boolean; hasNewer: boolean } }>;
  getConversationSyncStatus(input: { conversationId: string }): Promise<{ conversationId: string; backfill: { state: string } }>;
  backfillConversation(input: { conversationId: string; pageSizeDays?: 7 }): Promise<{ conversationId: string; backfillState: string }>;
  sendTextMessage(input: { conversationId: string; text: string; clientMessageId?: string }): Promise<{ id: string; messageStatus: string }>;
  requestAttachmentDownload(input: { attachmentId: string }): Promise<{ id: string; downloadState: string }>;
  createCluster(input: { name: string; description?: string }): Promise<{ id: string; name: string }>;
  searchMessages(input: { query: string; scope: { type: string; clusterId?: string; conversationId?: string } }): Promise<Array<{ id: string }>>;
  setMetadata(input: { targetType: string; targetId: string; namespace: string; key: string; valueJson: unknown }): Promise<{ id: string; version: number }>;
  createEntityMapping(input: { participantId: string; entityType: string; entityRef: string; label?: string }): Promise<{ id: string; mappingStatus: string }>;
  exportEvents(input: { cursorName: string; limit: number; afterIngestSeq?: string | number | bigint }): Promise<Array<{ id: string; ingestSeq: string }>>;
  softDeleteMessage(input: { messageId: string; reason?: string }): Promise<{ id: string; status: string }>;
}

export function createSdkClient(options: HttpClientOptions): SdkClient {
  const http = new ServerHttpClient(options);

  return {
    createConnection(input) {
      return http.post('/connections', input);
    },
    getConnectionStatus(input) {
      return http.get(`/connections/${input.connectionId}/status`);
    },
    listDiscoveredConversations(input) {
      return http.get(`/connections/${input.connectionId}/conversations`);
    },
    listInboxChats(input) {
      const query = new URLSearchParams();
      if (input.limit !== undefined) {
        query.set('limit', String(input.limit));
      }
      if (input.cursor) {
        query.set('cursor', input.cursor);
      }
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return http.get(`/connections/${input.connectionId}/inbox/chats${suffix}`);
    },
    selectConversation(input) {
      return http.post(`/conversations/${input.conversationId}/select`, {});
    },
    getConversationTimeline(input) {
      const query = new URLSearchParams();
      if (input.limit !== undefined) {
        query.set('limit', String(input.limit));
      }
      if (input.before) {
        query.set('before', input.before);
      }
      if (input.after) {
        query.set('after', input.after);
      }
      if (input.includeDeleted) {
        query.set('include_deleted', 'true');
      }
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return http.get(`/conversations/${input.conversationId}/timeline${suffix}`);
    },
    getConversationSyncStatus(input) {
      return http.get(`/conversations/${input.conversationId}/sync-status`);
    },
    backfillConversation(input) {
      return http.post(`/conversations/${input.conversationId}/backfill`, { pageSizeDays: input.pageSizeDays });
    },
    sendTextMessage(input) {
      return http.post(`/conversations/${input.conversationId}/messages/text`, {
        text: input.text,
        clientMessageId: input.clientMessageId
      });
    },
    requestAttachmentDownload(input) {
      return http.post(`/attachments/${input.attachmentId}/download`, {});
    },
    createCluster(input) {
      return http.post('/clusters', input);
    },
    searchMessages(input) {
      return http.post('/search/messages', input);
    },
    setMetadata(input) {
      return http.post('/metadata', input);
    },
    createEntityMapping(input) {
      return http.post('/mappings', input);
    },
    exportEvents(input) {
      return http.post('/exports/events', input);
    },
    softDeleteMessage(input) {
      return http.post(`/messages/${input.messageId}/soft-delete`, { reason: input.reason });
    }
  };
}
