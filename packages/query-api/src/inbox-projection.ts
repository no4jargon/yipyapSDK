import type { ConversationRecord, PostgresConversationRepository } from '../../storage/src/conversation-repository';
import type { ConversationSyncStateRecord, PostgresConversationSyncStateRepository } from '../../storage/src/conversation-sync-state-repository';
import type { MessageRecord, PostgresMessageRepository } from '../../storage/src/message-repository';

export function deriveMessagePreview(input: {
  messageType: MessageRecord['messageType'];
  textBody: string | null;
  messageStatus: MessageRecord['messageStatus'];
  fileName?: string | null;
  existingPreview?: string | null;
}): string {
  if (input.messageStatus === 'deleted') {
    return '[Message deleted]';
  }
  if (input.messageStatus === 'redacted') {
    return '[Message redacted]';
  }
  if (input.existingPreview) {
    return input.existingPreview;
  }
  if (input.messageType === 'text' && input.textBody) {
    return truncatePreview(input.textBody);
  }
  if ((input.messageType === 'image' || input.messageType === 'video' || input.messageType === 'audio' || input.messageType === 'document') && input.textBody) {
    return truncatePreview(input.textBody);
  }
  if (input.messageType === 'image') {
    return '[Image]';
  }
  if (input.messageType === 'video') {
    return '[Video]';
  }
  if (input.messageType === 'audio') {
    return '[Audio]';
  }
  if (input.messageType === 'document') {
    return input.fileName ? `[Document] ${input.fileName}` : '[Document]';
  }
  if (input.messageType === 'sticker') {
    return '[Sticker]';
  }
  if (input.messageType === 'reaction') {
    return '[Reaction]';
  }
  if (input.messageType === 'system') {
    return input.textBody ? truncatePreview(input.textBody) : '[System]';
  }
  return input.textBody ? truncatePreview(input.textBody) : '[Message]';
}

export async function applyMessageToConversationProjection(input: {
  conversationRepository: PostgresConversationRepository;
  conversationSyncStateRepository: PostgresConversationSyncStateRepository;
  createId: (prefix: string) => string;
  conversation: ConversationRecord;
  message: MessageRecord;
  updatedAt: Date;
  bootstrapState?: ConversationSyncStateRecord['bootstrapState'];
  backfillState?: ConversationSyncStateRecord['backfillState'];
  olderHistoryPossible?: boolean;
  newerHistoryPossible?: boolean;
  lastBackfillAnchorCursor?: string | null;
  lastBackfillRequestedAt?: Date | null;
  lastBackfillCompletedAt?: Date | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
}): Promise<void> {
  const preview = deriveMessagePreview({
    messageType: input.message.messageType,
    textBody: input.message.textBody,
    messageStatus: input.message.messageStatus,
    existingPreview: input.message.messagePreviewText ?? null
  });

  const shouldUpdateConversation = isNewerThanConversation(input.conversation, input.message);
  if (shouldUpdateConversation) {
    await input.conversationRepository.updateInboxSummary({
      tenantId: input.conversation.tenantId,
      id: input.conversation.id,
      lastProviderMessageAt: input.message.providerSentAt,
      lastMirroredMessageAt: input.updatedAt,
      lastMessageId: input.message.id,
      lastMessageIngestSeq: input.message.ingestSeq,
      lastMessagePreview: preview,
      lastMessageType: input.message.messageType,
      lastMessageDirection: input.message.direction,
      recentWindowStatus: 'ready',
      recentWindowAnchorAt: input.conversation.recentWindowAnchorAt ?? null,
      recentWindowCompleteThrough: maxDate(input.conversation.recentWindowCompleteThrough ?? null, input.message.providerSentAt),
      updatedAt: input.updatedAt
    });
  }

  const currentSyncState = await input.conversationSyncStateRepository.getByConversationId({
    tenantId: input.conversation.tenantId,
    conversationId: input.conversation.id
  });

  await input.conversationSyncStateRepository.upsert({
    id: currentSyncState?.id ?? `sync_${input.conversation.id}`,
    tenantId: input.conversation.tenantId,
    conversationId: input.conversation.id,
    connectionId: input.conversation.connectionId,
    recentWindowDays: currentSyncState?.recentWindowDays ?? 7,
    recentWindowStartAt: minDate(currentSyncState?.recentWindowStartAt ?? null, input.message.providerSentAt),
    recentWindowEndAt: maxDate(currentSyncState?.recentWindowEndAt ?? null, input.message.providerSentAt),
    earliestMirroredProviderSentAt: minDate(currentSyncState?.earliestMirroredProviderSentAt ?? null, input.message.providerSentAt),
    latestMirroredProviderSentAt: maxDate(currentSyncState?.latestMirroredProviderSentAt ?? null, input.message.providerSentAt),
    olderHistoryPossible: input.olderHistoryPossible ?? currentSyncState?.olderHistoryPossible ?? true,
    newerHistoryPossible: input.newerHistoryPossible ?? currentSyncState?.newerHistoryPossible ?? false,
    bootstrapState: input.bootstrapState ?? currentSyncState?.bootstrapState ?? 'ready',
    backfillState: input.backfillState ?? currentSyncState?.backfillState ?? 'idle',
    lastBackfillAnchorCursor: input.lastBackfillAnchorCursor ?? currentSyncState?.lastBackfillAnchorCursor ?? null,
    lastBackfillRequestedAt: input.lastBackfillRequestedAt ?? currentSyncState?.lastBackfillRequestedAt ?? null,
    lastBackfillCompletedAt: input.lastBackfillCompletedAt ?? currentSyncState?.lastBackfillCompletedAt ?? null,
    lastErrorCode: input.lastErrorCode ?? currentSyncState?.lastErrorCode ?? null,
    lastErrorMessage: input.lastErrorMessage ?? currentSyncState?.lastErrorMessage ?? null,
    createdAt: currentSyncState?.createdAt ?? input.updatedAt,
    updatedAt: input.updatedAt
  });
}

export async function ensureConversationSyncState(input: {
  conversationSyncStateRepository: PostgresConversationSyncStateRepository;
  createId: (prefix: string) => string;
  conversation: ConversationRecord;
  now: Date;
  bootstrapState?: ConversationSyncStateRecord['bootstrapState'];
  backfillState?: ConversationSyncStateRecord['backfillState'];
}): Promise<void> {
  const existing = await input.conversationSyncStateRepository.getByConversationId({
    tenantId: input.conversation.tenantId,
    conversationId: input.conversation.id
  });
  if (existing) {
    return;
  }
  await input.conversationSyncStateRepository.upsert({
    id: `sync_${input.conversation.id}`,
    tenantId: input.conversation.tenantId,
    conversationId: input.conversation.id,
    connectionId: input.conversation.connectionId,
    recentWindowDays: 7,
    recentWindowStartAt: null,
    recentWindowEndAt: null,
    earliestMirroredProviderSentAt: null,
    latestMirroredProviderSentAt: null,
    olderHistoryPossible: true,
    newerHistoryPossible: false,
    bootstrapState: input.bootstrapState ?? 'not_started',
    backfillState: input.backfillState ?? 'idle',
    lastBackfillAnchorCursor: null,
    lastBackfillRequestedAt: null,
    lastBackfillCompletedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: input.now,
    updatedAt: input.now
  });
}

export async function refreshConversationProjectionFromLatestVisibleMessage(input: {
  conversationRepository: PostgresConversationRepository;
  messageRepository: PostgresMessageRepository;
  tenantId: string;
  conversationId: string;
  updatedAt: Date;
}): Promise<void> {
  const conversation = await input.conversationRepository.getById({ tenantId: input.tenantId, id: input.conversationId });
  if (!conversation) {
    return;
  }
  const latest = await input.messageRepository.getLatestVisibleByConversation({ tenantId: input.tenantId, conversationId: input.conversationId });
  if (!latest) {
    await input.conversationRepository.updateInboxSummary({
      tenantId: input.tenantId,
      id: input.conversationId,
      lastProviderMessageAt: null,
      lastMirroredMessageAt: conversation.lastMirroredMessageAt,
      lastMessageId: null,
      lastMessageIngestSeq: null,
      lastMessagePreview: null,
      lastMessageType: null,
      lastMessageDirection: null,
      updatedAt: input.updatedAt
    });
    return;
  }
  await input.conversationRepository.updateInboxSummary({
    tenantId: input.tenantId,
    id: input.conversationId,
    lastProviderMessageAt: latest.providerSentAt,
    lastMirroredMessageAt: conversation.lastMirroredMessageAt,
    lastMessageId: latest.id,
    lastMessageIngestSeq: latest.ingestSeq,
    lastMessagePreview: deriveMessagePreview({
      messageType: latest.messageType,
      textBody: latest.textBody,
      messageStatus: latest.messageStatus,
      existingPreview: latest.messagePreviewText ?? null
    }),
    lastMessageType: latest.messageType,
    lastMessageDirection: latest.direction,
    updatedAt: input.updatedAt
  });
}

function isNewerThanConversation(conversation: ConversationRecord, message: MessageRecord): boolean {
  if (!conversation.lastProviderMessageAt) {
    return true;
  }
  if (message.providerSentAt.getTime() > conversation.lastProviderMessageAt.getTime()) {
    return true;
  }
  if (message.providerSentAt.getTime() < conversation.lastProviderMessageAt.getTime()) {
    return false;
  }
  if (!conversation.lastMessageIngestSeq) {
    return true;
  }
  return message.ingestSeq >= conversation.lastMessageIngestSeq;
}

function truncatePreview(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 140);
}

function minDate(left: Date | null, right: Date | null): Date | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return left.getTime() <= right.getTime() ? left : right;
}

function maxDate(left: Date | null, right: Date | null): Date | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return left.getTime() >= right.getTime() ? left : right;
}
