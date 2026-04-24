import type { PostgresTestHarness } from '../../test-kit/src/postgres-test-harness';
import { sqlString, sqlTimestamp } from './sql';

export interface ConversationSyncStateRecord {
  id: string;
  tenantId: string;
  conversationId: string;
  connectionId: string;
  recentWindowDays: number;
  recentWindowStartAt: Date | null;
  recentWindowEndAt: Date | null;
  earliestMirroredProviderSentAt: Date | null;
  latestMirroredProviderSentAt: Date | null;
  olderHistoryPossible: boolean;
  newerHistoryPossible: boolean;
  bootstrapState: 'not_started' | 'queued' | 'running' | 'partial' | 'ready' | 'failed';
  backfillState: 'idle' | 'queued' | 'running' | 'paused' | 'exhausted' | 'failed';
  lastBackfillAnchorCursor: string | null;
  lastBackfillRequestedAt: Date | null;
  lastBackfillCompletedAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ConversationSyncStateRow {
  id: string;
  tenant_id: string;
  conversation_id: string;
  connection_id: string;
  recent_window_days: number;
  recent_window_start_at: string | null;
  recent_window_end_at: string | null;
  earliest_mirrored_provider_sent_at: string | null;
  latest_mirrored_provider_sent_at: string | null;
  older_history_possible: boolean;
  newer_history_possible: boolean;
  bootstrap_state: ConversationSyncStateRecord['bootstrapState'];
  backfill_state: ConversationSyncStateRecord['backfillState'];
  last_backfill_anchor_cursor: string | null;
  last_backfill_requested_at: string | null;
  last_backfill_completed_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: string;
  updated_at: string;
}

export class PostgresConversationSyncStateRepository {
  constructor(private readonly db: PostgresTestHarness) {}

  async upsert(record: ConversationSyncStateRecord): Promise<ConversationSyncStateRecord> {
    const existing = await this.getByConversationId({
      tenantId: record.tenantId,
      conversationId: record.conversationId
    });

    if (!existing) {
      await this.db.query(`
        insert into conversation_sync_state (
          id,
          tenant_id,
          conversation_id,
          connection_id,
          recent_window_days,
          recent_window_start_at,
          recent_window_end_at,
          earliest_mirrored_provider_sent_at,
          latest_mirrored_provider_sent_at,
          older_history_possible,
          newer_history_possible,
          bootstrap_state,
          backfill_state,
          last_backfill_anchor_cursor,
          last_backfill_requested_at,
          last_backfill_completed_at,
          last_error_code,
          last_error_message,
          created_at,
          updated_at
        ) values (
          ${sqlString(record.id)},
          ${sqlString(record.tenantId)},
          ${sqlString(record.conversationId)},
          ${sqlString(record.connectionId)},
          ${record.recentWindowDays},
          ${sqlTimestamp(record.recentWindowStartAt)},
          ${sqlTimestamp(record.recentWindowEndAt)},
          ${sqlTimestamp(record.earliestMirroredProviderSentAt)},
          ${sqlTimestamp(record.latestMirroredProviderSentAt)},
          ${record.olderHistoryPossible ? 'true' : 'false'},
          ${record.newerHistoryPossible ? 'true' : 'false'},
          ${sqlString(record.bootstrapState)},
          ${sqlString(record.backfillState)},
          ${sqlString(record.lastBackfillAnchorCursor)},
          ${sqlTimestamp(record.lastBackfillRequestedAt)},
          ${sqlTimestamp(record.lastBackfillCompletedAt)},
          ${sqlString(record.lastErrorCode)},
          ${sqlString(record.lastErrorMessage)},
          ${sqlTimestamp(record.createdAt)},
          ${sqlTimestamp(record.updatedAt)}
        )
      `);
      return record;
    }

    const next: ConversationSyncStateRecord = {
      ...existing,
      connectionId: record.connectionId,
      recentWindowDays: record.recentWindowDays,
      recentWindowStartAt: record.recentWindowStartAt,
      recentWindowEndAt: record.recentWindowEndAt,
      earliestMirroredProviderSentAt: record.earliestMirroredProviderSentAt,
      latestMirroredProviderSentAt: record.latestMirroredProviderSentAt,
      olderHistoryPossible: record.olderHistoryPossible,
      newerHistoryPossible: record.newerHistoryPossible,
      bootstrapState: record.bootstrapState,
      backfillState: record.backfillState,
      lastBackfillAnchorCursor: record.lastBackfillAnchorCursor,
      lastBackfillRequestedAt: record.lastBackfillRequestedAt,
      lastBackfillCompletedAt: record.lastBackfillCompletedAt,
      lastErrorCode: record.lastErrorCode,
      lastErrorMessage: record.lastErrorMessage,
      updatedAt: record.updatedAt
    };

    await this.db.query(`
      update conversation_sync_state
      set connection_id = ${sqlString(next.connectionId)},
          recent_window_days = ${next.recentWindowDays},
          recent_window_start_at = ${sqlTimestamp(next.recentWindowStartAt)},
          recent_window_end_at = ${sqlTimestamp(next.recentWindowEndAt)},
          earliest_mirrored_provider_sent_at = ${sqlTimestamp(next.earliestMirroredProviderSentAt)},
          latest_mirrored_provider_sent_at = ${sqlTimestamp(next.latestMirroredProviderSentAt)},
          older_history_possible = ${next.olderHistoryPossible ? 'true' : 'false'},
          newer_history_possible = ${next.newerHistoryPossible ? 'true' : 'false'},
          bootstrap_state = ${sqlString(next.bootstrapState)},
          backfill_state = ${sqlString(next.backfillState)},
          last_backfill_anchor_cursor = ${sqlString(next.lastBackfillAnchorCursor)},
          last_backfill_requested_at = ${sqlTimestamp(next.lastBackfillRequestedAt)},
          last_backfill_completed_at = ${sqlTimestamp(next.lastBackfillCompletedAt)},
          last_error_code = ${sqlString(next.lastErrorCode)},
          last_error_message = ${sqlString(next.lastErrorMessage)},
          updated_at = ${sqlTimestamp(next.updatedAt)}
      where tenant_id = ${sqlString(next.tenantId)}
        and conversation_id = ${sqlString(next.conversationId)}
    `);

    return next;
  }

  async getByConversationId(input: { tenantId: string; conversationId: string }): Promise<ConversationSyncStateRecord | null> {
    const rows = await this.db.query<ConversationSyncStateRow>(`
      select *
      from conversation_sync_state
      where tenant_id = ${sqlString(input.tenantId)}
        and conversation_id = ${sqlString(input.conversationId)}
      limit 1
    `);
    return rows[0] ? mapConversationSyncState(rows[0]) : null;
  }
}

function mapConversationSyncState(row: ConversationSyncStateRow): ConversationSyncStateRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    connectionId: row.connection_id,
    recentWindowDays: row.recent_window_days,
    recentWindowStartAt: toDate(row.recent_window_start_at),
    recentWindowEndAt: toDate(row.recent_window_end_at),
    earliestMirroredProviderSentAt: toDate(row.earliest_mirrored_provider_sent_at),
    latestMirroredProviderSentAt: toDate(row.latest_mirrored_provider_sent_at),
    olderHistoryPossible: row.older_history_possible,
    newerHistoryPossible: row.newer_history_possible,
    bootstrapState: row.bootstrap_state,
    backfillState: row.backfill_state,
    lastBackfillAnchorCursor: row.last_backfill_anchor_cursor,
    lastBackfillRequestedAt: toDate(row.last_backfill_requested_at),
    lastBackfillCompletedAt: toDate(row.last_backfill_completed_at),
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}
