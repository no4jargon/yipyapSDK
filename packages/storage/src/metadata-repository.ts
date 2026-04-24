import type { PostgresTestHarness } from '../../test-kit/src/postgres-test-harness';
import { sqlJson, sqlString, sqlTimestamp } from './sql';

export interface MetadataRecord {
  id: string;
  tenantId: string;
  targetType: 'message' | 'conversation' | 'participant' | 'attachment' | 'cluster';
  targetId: string;
  namespace: string;
  key: string;
  valueJson: Record<string, unknown> | null;
  version: number;
  deleted: boolean;
  createdAt: Date;
}

interface MetadataRow {
  id: string;
  tenant_id: string;
  target_type: MetadataRecord['targetType'];
  target_id: string;
  namespace: string;
  key: string;
  value_json: Record<string, unknown> | string | null;
  version: number;
  deleted: boolean;
  created_at: string;
}

export class PostgresMetadataRepository {
  constructor(private readonly db: PostgresTestHarness) {}

  async create(record: MetadataRecord): Promise<MetadataRecord> {
    await this.db.query(`
      insert into metadata_records (id, tenant_id, target_type, target_id, namespace, key, value_json, version, deleted, created_at)
      values (
        ${sqlString(record.id)},
        ${sqlString(record.tenantId)},
        ${sqlString(record.targetType)},
        ${sqlString(record.targetId)},
        ${sqlString(record.namespace)},
        ${sqlString(record.key)},
        ${sqlJson(record.valueJson)},
        ${record.version},
        ${record.deleted ? 'true' : 'false'},
        ${sqlTimestamp(record.createdAt)}
      )
    `);
    return record;
  }

  async listByTarget(input: { tenantId: string; targetType: MetadataRecord['targetType']; targetId: string }): Promise<MetadataRecord[]> {
    const rows = await this.db.query<MetadataRow>(`
      select * from metadata_records
      where tenant_id = ${sqlString(input.tenantId)}
        and target_type = ${sqlString(input.targetType)}
        and target_id = ${sqlString(input.targetId)}
      order by namespace asc, key asc, version asc
    `);
    return rows.map(mapMetadata);
  }

  async listByKey(input: { tenantId: string; targetType: MetadataRecord['targetType']; targetId: string; namespace: string; key: string }): Promise<MetadataRecord[]> {
    const rows = await this.db.query<MetadataRow>(`
      select * from metadata_records
      where tenant_id = ${sqlString(input.tenantId)}
        and target_type = ${sqlString(input.targetType)}
        and target_id = ${sqlString(input.targetId)}
        and namespace = ${sqlString(input.namespace)}
        and key = ${sqlString(input.key)}
      order by version asc
    `);
    return rows.map(mapMetadata);
  }
}

function mapMetadata(row: MetadataRow): MetadataRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    targetType: row.target_type,
    targetId: row.target_id,
    namespace: row.namespace,
    key: row.key,
    valueJson: row.value_json === null ? null : typeof row.value_json === 'string' ? JSON.parse(row.value_json) as Record<string, unknown> : row.value_json,
    version: row.version,
    deleted: row.deleted,
    createdAt: new Date(row.created_at)
  };
}
