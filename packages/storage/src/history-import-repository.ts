import type { PostgresTestHarness } from '../../test-kit/src/postgres-test-harness';
import { sqlString, sqlTimestamp } from './sql';

export interface HistoryImportRecord {
  id: string;
  tenantId: string;
  conversationId: string;
  importState: 'not_started' | 'running' | 'paused' | 'completed' | 'failed';
  anchorCursor: string | null;
  scheduledAt: Date;
  lastStartedAt: Date | null;
  lastCompletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface HistoryImportRow {
  id: string;
  tenant_id: string;
  conversation_id: string;
  import_state: HistoryImportRecord['importState'];
  anchor_cursor: string | null;
  scheduled_at: string;
  last_started_at: string | null;
  last_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export class PostgresHistoryImportRepository {
  constructor(private readonly db: PostgresTestHarness) {}

  async getByConversationId(input: { tenantId: string; conversationId: string }): Promise<HistoryImportRecord | null> {
    const rows = await this.db.query<HistoryImportRow>(`
      select * from history_imports
      where tenant_id = ${sqlString(input.tenantId)}
        and conversation_id = ${sqlString(input.conversationId)}
      limit 1
    `);

    return rows[0] ? mapRow(rows[0]) : null;
  }

  async schedule(input: { tenantId: string; conversationId: string; now: Date; id: string }): Promise<HistoryImportRecord> {
    const existing = await this.getByConversationId(input);
    if (existing) {
      if (existing.importState === 'completed') {
        return existing;
      }

      await this.db.query(`
        update history_imports
        set import_state = 'not_started',
            scheduled_at = ${sqlTimestamp(input.now)},
            updated_at = ${sqlTimestamp(input.now)}
        where tenant_id = ${sqlString(input.tenantId)}
          and conversation_id = ${sqlString(input.conversationId)}
      `);

      return (await this.getByConversationId(input)) as HistoryImportRecord;
    }

    await this.db.query(`
      insert into history_imports (
        id,
        tenant_id,
        conversation_id,
        import_state,
        anchor_cursor,
        scheduled_at,
        last_started_at,
        last_completed_at,
        created_at,
        updated_at
      ) values (
        ${sqlString(input.id)},
        ${sqlString(input.tenantId)},
        ${sqlString(input.conversationId)},
        'not_started',
        null,
        ${sqlTimestamp(input.now)},
        null,
        null,
        ${sqlTimestamp(input.now)},
        ${sqlTimestamp(input.now)}
      )
    `);

    return (await this.getByConversationId(input)) as HistoryImportRecord;
  }

  async getNextRunnable(input: { tenantId: string }): Promise<HistoryImportRecord | null> {
    const rows = await this.db.query<HistoryImportRow>(`
      select * from history_imports
      where tenant_id = ${sqlString(input.tenantId)}
        and import_state in ('not_started', 'running')
      order by scheduled_at asc
      limit 1
    `);

    return rows[0] ? mapRow(rows[0]) : null;
  }

  async update(input: {
    tenantId: string;
    conversationId: string;
    importState: HistoryImportRecord['importState'];
    anchorCursor: string | null;
    lastStartedAt?: Date | null;
    lastCompletedAt?: Date | null;
    updatedAt: Date;
  }): Promise<void> {
    const current = await this.getByConversationId({
      tenantId: input.tenantId,
      conversationId: input.conversationId
    });
    if (!current) {
      return;
    }

    await this.db.query(`
      update history_imports
      set import_state = ${sqlString(input.importState)},
          anchor_cursor = ${sqlString(input.anchorCursor)},
          last_started_at = ${sqlTimestamp(input.lastStartedAt === undefined ? current.lastStartedAt : input.lastStartedAt)},
          last_completed_at = ${sqlTimestamp(input.lastCompletedAt === undefined ? current.lastCompletedAt : input.lastCompletedAt)},
          updated_at = ${sqlTimestamp(input.updatedAt)}
      where tenant_id = ${sqlString(input.tenantId)}
        and conversation_id = ${sqlString(input.conversationId)}
    `);
  }
}

function mapRow(row: HistoryImportRow): HistoryImportRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    importState: row.import_state,
    anchorCursor: row.anchor_cursor,
    scheduledAt: new Date(row.scheduled_at),
    lastStartedAt: row.last_started_at ? new Date(row.last_started_at) : null,
    lastCompletedAt: row.last_completed_at ? new Date(row.last_completed_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}
