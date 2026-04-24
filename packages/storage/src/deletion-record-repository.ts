import type { PostgresTestHarness } from '../../test-kit/src/postgres-test-harness';
import { sqlString, sqlTimestamp } from './sql';

export interface DeletionRecord {
  id: string;
  tenantId: string;
  targetType: 'message' | 'attachment' | 'conversation' | 'participant' | 'cluster';
  targetId: string;
  operationType: 'soft_delete' | 'hard_delete' | 'redact';
  reason: string | null;
  requestedByRef: string | null;
  requestedAt: Date;
  completedAt: Date | null;
  status: 'pending' | 'completed' | 'failed';
}

interface DeletionRow {
  id: string;
  tenant_id: string;
  target_type: DeletionRecord['targetType'];
  target_id: string;
  operation_type: DeletionRecord['operationType'];
  reason: string | null;
  requested_by_ref: string | null;
  requested_at: string;
  completed_at: string | null;
  status: DeletionRecord['status'];
}

export class PostgresDeletionRecordRepository {
  constructor(private readonly db: PostgresTestHarness) {}

  async create(record: DeletionRecord): Promise<DeletionRecord> {
    await this.db.query(`
      insert into deletion_records (
        id, tenant_id, target_type, target_id, operation_type, reason, requested_by_ref, requested_at, completed_at, status
      ) values (
        ${sqlString(record.id)}, ${sqlString(record.tenantId)}, ${sqlString(record.targetType)}, ${sqlString(record.targetId)}, ${sqlString(record.operationType)}, ${sqlString(record.reason)}, ${sqlString(record.requestedByRef)}, ${sqlTimestamp(record.requestedAt)}, ${sqlTimestamp(record.completedAt)}, ${sqlString(record.status)}
      )
    `);
    return record;
  }

  async getById(input: { tenantId: string; id: string }): Promise<DeletionRecord | null> {
    const rows = await this.db.query<DeletionRow>(`
      select * from deletion_records where tenant_id = ${sqlString(input.tenantId)} and id = ${sqlString(input.id)} limit 1
    `);
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async listByTenant(input: { tenantId: string }): Promise<DeletionRecord[]> {
    const rows = await this.db.query<DeletionRow>(`
      select * from deletion_records where tenant_id = ${sqlString(input.tenantId)} order by requested_at asc
    `);
    return rows.map(mapRow);
  }
}

function mapRow(row: DeletionRow): DeletionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    targetType: row.target_type,
    targetId: row.target_id,
    operationType: row.operation_type,
    reason: row.reason,
    requestedByRef: row.requested_by_ref,
    requestedAt: new Date(row.requested_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    status: row.status
  };
}
