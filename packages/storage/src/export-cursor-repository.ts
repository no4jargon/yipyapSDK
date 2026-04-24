import type { PostgresTestHarness } from '../../test-kit/src/postgres-test-harness';
import { sqlString, sqlTimestamp } from './sql';

export interface ExportCursorRecord {
  id: string;
  tenantId: string;
  cursorName: string;
  lastIngestSeq: bigint;
  createdAt: Date;
  updatedAt: Date;
}

interface ExportCursorRow {
  id: string;
  tenant_id: string;
  cursor_name: string;
  last_ingest_seq: string | number | bigint;
  created_at: string;
  updated_at: string;
}

export class PostgresExportCursorRepository {
  constructor(private readonly db: PostgresTestHarness) {}

  async getByName(input: { tenantId: string; cursorName: string }): Promise<ExportCursorRecord | null> {
    const rows = await this.db.query<ExportCursorRow>(`select * from export_cursors where tenant_id = ${sqlString(input.tenantId)} and cursor_name = ${sqlString(input.cursorName)} limit 1`);
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async create(record: ExportCursorRecord): Promise<ExportCursorRecord> {
    await this.db.query(`insert into export_cursors (id, tenant_id, cursor_name, last_ingest_seq, created_at, updated_at) values (${sqlString(record.id)}, ${sqlString(record.tenantId)}, ${sqlString(record.cursorName)}, ${record.lastIngestSeq.toString()}, ${sqlTimestamp(record.createdAt)}, ${sqlTimestamp(record.updatedAt)})`);
    return record;
  }

  async update(record: ExportCursorRecord): Promise<void> {
    await this.db.query(`update export_cursors set last_ingest_seq = ${record.lastIngestSeq.toString()}, updated_at = ${sqlTimestamp(record.updatedAt)} where tenant_id = ${sqlString(record.tenantId)} and id = ${sqlString(record.id)}`);
  }
}

function mapRow(row: ExportCursorRow): ExportCursorRecord {
  return { id: row.id, tenantId: row.tenant_id, cursorName: row.cursor_name, lastIngestSeq: BigInt(row.last_ingest_seq), createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at) };
}
