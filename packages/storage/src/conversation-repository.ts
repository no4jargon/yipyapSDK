import type { PostgresTestHarness } from '../../test-kit/src/postgres-test-harness';
import { sqlJson, sqlString, sqlTimestamp } from './sql';

export interface ConversationRecord {
  id: string;
  tenantId: string;
  connectionId: string;
  providerConversationId: string;
  conversationType: 'direct' | 'group' | 'broadcast' | 'unknown';
  title: string;
  normalizedTitle: string;
  avatarRef: string | null;
  isSelected: boolean;
  selectionStateChangedAt: Date | null;
  lastProviderMessageAt: Date | null;
  lastMirroredMessageAt: Date | null;
  lastMessageId?: string | null;
  lastMessageIngestSeq?: bigint | null;
  lastMessagePreview?: string | null;
  lastMessageType?: 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'reaction' | 'system' | 'unknown' | null;
  lastMessageDirection?: 'inbound' | 'outbound' | 'system' | null;
  inboxVisible?: boolean;
  recentWindowAnchorAt?: Date | null;
  recentWindowCompleteThrough?: Date | null;
  recentWindowStatus?: 'unknown' | 'bootstrapping' | 'partial' | 'ready' | 'failed';
  participantCount: number | null;
  providerMetadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface ConversationRow {
  id: string;
  tenant_id: string;
  connection_id: string;
  provider_conversation_id: string;
  conversation_type: ConversationRecord['conversationType'];
  title: string;
  normalized_title: string;
  avatar_ref: string | null;
  is_selected: boolean;
  selection_state_changed_at: string | null;
  last_provider_message_at: string | null;
  last_mirrored_message_at: string | null;
  last_message_id: string | null;
  last_message_ingest_seq: string | number | bigint | null;
  last_message_preview: string | null;
  last_message_type: NonNullable<ConversationRecord['lastMessageType']> | null;
  last_message_direction: NonNullable<ConversationRecord['lastMessageDirection']> | null;
  inbox_visible: boolean;
  recent_window_anchor_at: string | null;
  recent_window_complete_through: string | null;
  recent_window_status: NonNullable<ConversationRecord['recentWindowStatus']>;
  participant_count: number | null;
  provider_metadata: Record<string, unknown> | string;
  created_at: string;
  updated_at: string;
}

interface InboxRow extends ConversationRow {
  sync_earliest_mirrored_provider_sent_at: string | null;
  sync_latest_mirrored_provider_sent_at: string | null;
  sync_older_history_possible: boolean | null;
  sync_bootstrap_state: 'not_started' | 'queued' | 'running' | 'partial' | 'ready' | 'failed' | null;
  sync_backfill_state: 'idle' | 'queued' | 'running' | 'paused' | 'exhausted' | 'failed' | null;
}

export interface InboxCursor {
  lastProviderMessageAt: Date | null;
  lastMessageIngestSeq: bigint | null;
  conversationId: string;
}

export interface InboxChatRecord {
  conversationId: string;
  providerConversationId: string;
  type: ConversationRecord['conversationType'];
  title: string;
  participantCount: number | null;
  selected: boolean;
  lastMessageAt: Date | null;
  lastMessage: {
    messageId: string | null;
    type: ConversationRecord['lastMessageType'];
    direction: ConversationRecord['lastMessageDirection'];
    fromMe: boolean;
    preview: string | null;
  } | null;
  sync: {
    recentWindowStatus: NonNullable<ConversationRecord['recentWindowStatus']>;
    bootstrapState: 'not_started' | 'queued' | 'running' | 'partial' | 'ready' | 'failed';
    backfillState: 'idle' | 'queued' | 'running' | 'paused' | 'exhausted' | 'failed';
    earliestMirroredAt: Date | null;
    latestMirroredAt: Date | null;
    olderHistoryPossible: boolean;
  };
}

interface HydratedConversationRecord extends ConversationRecord {
  lastMessageId: string | null;
  lastMessageIngestSeq: bigint | null;
  lastMessagePreview: string | null;
  lastMessageType: NonNullable<ConversationRecord['lastMessageType']> | null;
  lastMessageDirection: NonNullable<ConversationRecord['lastMessageDirection']> | null;
  inboxVisible: boolean;
  recentWindowAnchorAt: Date | null;
  recentWindowCompleteThrough: Date | null;
  recentWindowStatus: NonNullable<ConversationRecord['recentWindowStatus']>;
}

export class PostgresConversationRepository {
  constructor(private readonly db: PostgresTestHarness) {}

  async upsert(conversation: ConversationRecord): Promise<{ record: ConversationRecord; created: boolean }> {
    const existing = await this.getByProviderConversationId({
      tenantId: conversation.tenantId,
      connectionId: conversation.connectionId,
      providerConversationId: conversation.providerConversationId
    });

    const prepared = withConversationDefaults(conversation, existing?.createdAt ?? conversation.createdAt);

    if (!existing) {
      await this.db.query(`
        insert into conversations (
          id,
          tenant_id,
          connection_id,
          provider_conversation_id,
          conversation_type,
          title,
          normalized_title,
          avatar_ref,
          is_selected,
          selection_state_changed_at,
          last_provider_message_at,
          last_mirrored_message_at,
          last_message_id,
          last_message_ingest_seq,
          last_message_preview,
          last_message_type,
          last_message_direction,
          inbox_visible,
          recent_window_anchor_at,
          recent_window_complete_through,
          recent_window_status,
          participant_count,
          provider_metadata,
          created_at,
          updated_at
        ) values (
          ${sqlString(prepared.id)},
          ${sqlString(prepared.tenantId)},
          ${sqlString(prepared.connectionId)},
          ${sqlString(prepared.providerConversationId)},
          ${sqlString(prepared.conversationType)},
          ${sqlString(prepared.title)},
          ${sqlString(prepared.normalizedTitle)},
          ${sqlString(prepared.avatarRef)},
          ${prepared.isSelected ? 'true' : 'false'},
          ${sqlTimestamp(prepared.selectionStateChangedAt)},
          ${sqlTimestamp(prepared.lastProviderMessageAt)},
          ${sqlTimestamp(prepared.lastMirroredMessageAt)},
          ${sqlString(prepared.lastMessageId ?? null)},
          ${prepared.lastMessageIngestSeq === null ? 'null' : prepared.lastMessageIngestSeq.toString()},
          ${sqlString(prepared.lastMessagePreview ?? null)},
          ${sqlString(prepared.lastMessageType ?? null)},
          ${sqlString(prepared.lastMessageDirection ?? null)},
          ${prepared.inboxVisible ? 'true' : 'false'},
          ${sqlTimestamp(prepared.recentWindowAnchorAt ?? null)},
          ${sqlTimestamp(prepared.recentWindowCompleteThrough ?? null)},
          ${sqlString(prepared.recentWindowStatus)},
          ${prepared.participantCount === null ? 'null' : prepared.participantCount},
          ${sqlJson(prepared.providerMetadata)},
          ${sqlTimestamp(prepared.createdAt)},
          ${sqlTimestamp(prepared.updatedAt)}
        )
      `);

      return { record: prepared, created: true };
    }

    const next = withConversationDefaults({
      ...existing,
      conversationType: conversation.conversationType,
      title: conversation.title,
      normalizedTitle: conversation.normalizedTitle,
      avatarRef: conversation.avatarRef,
      participantCount: conversation.participantCount,
      providerMetadata: conversation.providerMetadata,
      isSelected: conversation.isSelected,
      selectionStateChangedAt: conversation.selectionStateChangedAt,
      lastProviderMessageAt: conversation.lastProviderMessageAt,
      lastMirroredMessageAt: conversation.lastMirroredMessageAt,
      lastMessageId: conversation.lastMessageId ?? existing.lastMessageId ?? null,
      lastMessageIngestSeq: conversation.lastMessageIngestSeq ?? existing.lastMessageIngestSeq ?? null,
      lastMessagePreview: conversation.lastMessagePreview ?? existing.lastMessagePreview ?? null,
      lastMessageType: conversation.lastMessageType ?? existing.lastMessageType ?? null,
      lastMessageDirection: conversation.lastMessageDirection ?? existing.lastMessageDirection ?? null,
      inboxVisible: conversation.inboxVisible ?? existing.inboxVisible,
      recentWindowAnchorAt: conversation.recentWindowAnchorAt ?? existing.recentWindowAnchorAt ?? null,
      recentWindowCompleteThrough: conversation.recentWindowCompleteThrough ?? existing.recentWindowCompleteThrough ?? null,
      recentWindowStatus: conversation.recentWindowStatus ?? existing.recentWindowStatus,
      updatedAt: conversation.updatedAt
    }, existing.createdAt);

    await this.db.query(`
      update conversations
      set conversation_type = ${sqlString(next.conversationType)},
          title = ${sqlString(next.title)},
          normalized_title = ${sqlString(next.normalizedTitle)},
          avatar_ref = ${sqlString(next.avatarRef)},
          is_selected = ${next.isSelected ? 'true' : 'false'},
          selection_state_changed_at = ${sqlTimestamp(next.selectionStateChangedAt)},
          last_provider_message_at = ${sqlTimestamp(next.lastProviderMessageAt)},
          last_mirrored_message_at = ${sqlTimestamp(next.lastMirroredMessageAt)},
          last_message_id = ${sqlString(next.lastMessageId ?? null)},
          last_message_ingest_seq = ${next.lastMessageIngestSeq === null ? 'null' : next.lastMessageIngestSeq.toString()},
          last_message_preview = ${sqlString(next.lastMessagePreview ?? null)},
          last_message_type = ${sqlString(next.lastMessageType ?? null)},
          last_message_direction = ${sqlString(next.lastMessageDirection ?? null)},
          inbox_visible = ${next.inboxVisible ? 'true' : 'false'},
          recent_window_anchor_at = ${sqlTimestamp(next.recentWindowAnchorAt ?? null)},
          recent_window_complete_through = ${sqlTimestamp(next.recentWindowCompleteThrough ?? null)},
          recent_window_status = ${sqlString(next.recentWindowStatus)},
          participant_count = ${next.participantCount === null ? 'null' : next.participantCount},
          provider_metadata = ${sqlJson(next.providerMetadata)},
          updated_at = ${sqlTimestamp(next.updatedAt)}
      where tenant_id = ${sqlString(next.tenantId)}
        and id = ${sqlString(next.id)}
    `);

    return { record: next, created: false };
  }

  async updateInboxSummary(input: {
    tenantId: string;
    id: string;
    lastProviderMessageAt: Date | null;
    lastMirroredMessageAt: Date | null;
    lastMessageId: string | null;
    lastMessageIngestSeq: bigint | null;
    lastMessagePreview: string | null;
    lastMessageType: NonNullable<ConversationRecord['lastMessageType']> | null;
    lastMessageDirection: NonNullable<ConversationRecord['lastMessageDirection']> | null;
    recentWindowStatus?: NonNullable<ConversationRecord['recentWindowStatus']>;
    recentWindowAnchorAt?: Date | null;
    recentWindowCompleteThrough?: Date | null;
    updatedAt: Date;
  }): Promise<void> {
    const clauses = [
      `last_provider_message_at = ${sqlTimestamp(input.lastProviderMessageAt)}`,
      `last_mirrored_message_at = ${sqlTimestamp(input.lastMirroredMessageAt)}`,
      `last_message_id = ${sqlString(input.lastMessageId)}`,
      `last_message_ingest_seq = ${input.lastMessageIngestSeq === null ? 'null' : input.lastMessageIngestSeq.toString()}`,
      `last_message_preview = ${sqlString(input.lastMessagePreview)}`,
      `last_message_type = ${sqlString(input.lastMessageType)}`,
      `last_message_direction = ${sqlString(input.lastMessageDirection)}`,
      `updated_at = ${sqlTimestamp(input.updatedAt)}`
    ];

    if (input.recentWindowStatus !== undefined) {
      clauses.push(`recent_window_status = ${sqlString(input.recentWindowStatus)}`);
    }
    if (input.recentWindowAnchorAt !== undefined) {
      clauses.push(`recent_window_anchor_at = ${sqlTimestamp(input.recentWindowAnchorAt)}`);
    }
    if (input.recentWindowCompleteThrough !== undefined) {
      clauses.push(`recent_window_complete_through = ${sqlTimestamp(input.recentWindowCompleteThrough)}`);
    }

    await this.db.query(`
      update conversations
      set ${clauses.join(',\n          ')}
      where tenant_id = ${sqlString(input.tenantId)}
        and id = ${sqlString(input.id)}
    `);
  }

  async getByProviderConversationId(input: {
    tenantId: string;
    connectionId: string;
    providerConversationId: string;
  }): Promise<ConversationRecord | null> {
    const rows = await this.db.query<ConversationRow>(`
      select *
      from conversations
      where tenant_id = ${sqlString(input.tenantId)}
        and connection_id = ${sqlString(input.connectionId)}
        and provider_conversation_id = ${sqlString(input.providerConversationId)}
      limit 1
    `);

    return rows[0] ? mapConversation(rows[0]) : null;
  }

  async getById(input: { tenantId: string; id: string }): Promise<ConversationRecord | null> {
    const rows = await this.db.query<ConversationRow>(`
      select *
      from conversations
      where tenant_id = ${sqlString(input.tenantId)}
        and id = ${sqlString(input.id)}
      limit 1
    `);

    return rows[0] ? mapConversation(rows[0]) : null;
  }

  async listByConnection(input: { tenantId: string; connectionId: string }): Promise<ConversationRecord[]> {
    const rows = await this.db.query<ConversationRow>(`
      select *
      from conversations
      where tenant_id = ${sqlString(input.tenantId)}
        and connection_id = ${sqlString(input.connectionId)}
      order by created_at asc
    `);

    return rows.map(mapConversation);
  }

  async listInboxChats(input: {
    tenantId: string;
    connectionId: string;
    limit: number;
    cursor?: InboxCursor | null;
    conversationType?: ConversationRecord['conversationType'] | 'all';
    isSelected?: boolean;
    recentWindowStatus?: NonNullable<ConversationRecord['recentWindowStatus']>;
  }): Promise<InboxChatRecord[]> {
    const conditions = [
      `c.tenant_id = ${sqlString(input.tenantId)}`,
      `c.connection_id = ${sqlString(input.connectionId)}`,
      'c.inbox_visible = true'
    ];

    if (input.conversationType && input.conversationType !== 'all') {
      conditions.push(`c.conversation_type = ${sqlString(input.conversationType)}`);
    }
    if (typeof input.isSelected === 'boolean') {
      conditions.push(`c.is_selected = ${input.isSelected ? 'true' : 'false'}`);
    }
    if (input.recentWindowStatus) {
      conditions.push(`c.recent_window_status = ${sqlString(input.recentWindowStatus)}`);
    }
    if (input.cursor) {
      const cursorTimestamp = input.cursor.lastProviderMessageAt === null
        ? `'-infinity'::timestamptz`
        : sqlTimestamp(input.cursor.lastProviderMessageAt);
      const cursorSeq = input.cursor.lastMessageIngestSeq === null ? '0' : input.cursor.lastMessageIngestSeq.toString();
      conditions.push(`(
        coalesce(c.last_provider_message_at, '-infinity'::timestamptz) < ${cursorTimestamp}
        or (
          coalesce(c.last_provider_message_at, '-infinity'::timestamptz) = ${cursorTimestamp}
          and coalesce(c.last_message_ingest_seq, 0) < ${cursorSeq}
        )
        or (
          coalesce(c.last_provider_message_at, '-infinity'::timestamptz) = ${cursorTimestamp}
          and coalesce(c.last_message_ingest_seq, 0) = ${cursorSeq}
          and c.id > ${sqlString(input.cursor.conversationId)}
        )
      )`);
    }

    const rows = await this.db.query<InboxRow>(`
      select
        c.*,
        s.earliest_mirrored_provider_sent_at as sync_earliest_mirrored_provider_sent_at,
        s.latest_mirrored_provider_sent_at as sync_latest_mirrored_provider_sent_at,
        s.older_history_possible as sync_older_history_possible,
        s.bootstrap_state as sync_bootstrap_state,
        s.backfill_state as sync_backfill_state
      from conversations c
      left join conversation_sync_state s
        on s.tenant_id = c.tenant_id
       and s.conversation_id = c.id
      where ${conditions.join('\n        and ')}
      order by c.last_provider_message_at desc nulls last, c.last_message_ingest_seq desc nulls last, c.id asc
      limit ${input.limit}
    `);

    return rows.map(mapInboxConversation);
  }

  async markSelected(input: {
    tenantId: string;
    id: string;
    isSelected: boolean;
    selectionStateChangedAt: Date;
    updatedAt: Date;
  }): Promise<void> {
    await this.db.query(`
      update conversations
      set is_selected = ${input.isSelected ? 'true' : 'false'},
          selection_state_changed_at = ${sqlTimestamp(input.selectionStateChangedAt)},
          updated_at = ${sqlTimestamp(input.updatedAt)}
      where tenant_id = ${sqlString(input.tenantId)}
        and id = ${sqlString(input.id)}
    `);
  }
}

function mapConversation(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    connectionId: row.connection_id,
    providerConversationId: row.provider_conversation_id,
    conversationType: row.conversation_type,
    title: row.title,
    normalizedTitle: row.normalized_title,
    avatarRef: row.avatar_ref,
    isSelected: row.is_selected,
    selectionStateChangedAt: toDate(row.selection_state_changed_at),
    lastProviderMessageAt: toDate(row.last_provider_message_at),
    lastMirroredMessageAt: toDate(row.last_mirrored_message_at),
    lastMessageId: row.last_message_id,
    lastMessageIngestSeq: row.last_message_ingest_seq === null ? null : BigInt(row.last_message_ingest_seq),
    lastMessagePreview: row.last_message_preview,
    lastMessageType: row.last_message_type,
    lastMessageDirection: row.last_message_direction,
    inboxVisible: row.inbox_visible,
    recentWindowAnchorAt: toDate(row.recent_window_anchor_at),
    recentWindowCompleteThrough: toDate(row.recent_window_complete_through),
    recentWindowStatus: row.recent_window_status,
    participantCount: row.participant_count,
    providerMetadata:
      typeof row.provider_metadata === 'string'
        ? (JSON.parse(row.provider_metadata) as Record<string, unknown>)
        : row.provider_metadata,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

function mapInboxConversation(row: InboxRow): InboxChatRecord {
  const conversation = mapConversation(row);
  return {
    conversationId: conversation.id,
    providerConversationId: conversation.providerConversationId,
    type: conversation.conversationType,
    title: conversation.title,
    participantCount: conversation.participantCount,
    selected: conversation.isSelected,
    lastMessageAt: conversation.lastProviderMessageAt,
    lastMessage: conversation.lastMessageId
      ? {
          messageId: conversation.lastMessageId ?? null,
          type: conversation.lastMessageType ?? null,
          direction: conversation.lastMessageDirection ?? null,
          fromMe: conversation.lastMessageDirection === 'outbound',
          preview: conversation.lastMessagePreview ?? null
        }
      : null,
    sync: {
      recentWindowStatus: conversation.recentWindowStatus ?? 'unknown',
      bootstrapState: row.sync_bootstrap_state ?? bootstrapStateFromConversationStatus(conversation.recentWindowStatus ?? 'unknown'),
      backfillState: row.sync_backfill_state ?? 'idle',
      earliestMirroredAt: toDate(row.sync_earliest_mirrored_provider_sent_at),
      latestMirroredAt: toDate(row.sync_latest_mirrored_provider_sent_at),
      olderHistoryPossible: row.sync_older_history_possible ?? true
    }
  };
}

function withConversationDefaults(conversation: ConversationRecord, createdAt: Date): HydratedConversationRecord {
  return {
    ...conversation,
    lastMessageId: conversation.lastMessageId ?? null,
    lastMessageIngestSeq: conversation.lastMessageIngestSeq ?? null,
    lastMessagePreview: conversation.lastMessagePreview ?? null,
    lastMessageType: conversation.lastMessageType ?? null,
    lastMessageDirection: conversation.lastMessageDirection ?? null,
    inboxVisible: conversation.inboxVisible ?? true,
    recentWindowAnchorAt: conversation.recentWindowAnchorAt ?? null,
    recentWindowCompleteThrough: conversation.recentWindowCompleteThrough ?? null,
    recentWindowStatus: conversation.recentWindowStatus ?? 'unknown',
    createdAt
  };
}

function bootstrapStateFromConversationStatus(status: NonNullable<ConversationRecord['recentWindowStatus']>): InboxChatRecord['sync']['bootstrapState'] {
  if (status === 'bootstrapping') {
    return 'running';
  }
  if (status === 'partial') {
    return 'partial';
  }
  if (status === 'ready') {
    return 'ready';
  }
  if (status === 'failed') {
    return 'failed';
  }
  return 'not_started';
}

function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}
