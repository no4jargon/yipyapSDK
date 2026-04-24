import type { PostgresTestHarness } from '../../test-kit/src/postgres-test-harness';
import { sqlString, sqlTimestamp } from './sql';

export interface EntityMappingRecord {
  id: string;
  tenantId: string;
  participantId: string;
  entityType: string;
  entityRef: string;
  label: string | null;
  mappingStatus: 'active' | 'merged' | 'deleted';
  mergedIntoMappingId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface EntityMappingRow {
  id: string;
  tenant_id: string;
  participant_id: string;
  entity_type: string;
  entity_ref: string;
  label: string | null;
  mapping_status: EntityMappingRecord['mappingStatus'];
  merged_into_mapping_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export class PostgresEntityMappingRepository {
  constructor(private readonly db: PostgresTestHarness) {}

  async create(record: EntityMappingRecord): Promise<EntityMappingRecord> {
    await this.db.query(`
      insert into entity_mappings (id, tenant_id, participant_id, entity_type, entity_ref, label, mapping_status, merged_into_mapping_id, notes, created_at, updated_at)
      values (
        ${sqlString(record.id)}, ${sqlString(record.tenantId)}, ${sqlString(record.participantId)}, ${sqlString(record.entityType)}, ${sqlString(record.entityRef)}, ${sqlString(record.label)},
        ${sqlString(record.mappingStatus)}, ${sqlString(record.mergedIntoMappingId)}, ${sqlString(record.notes)}, ${sqlTimestamp(record.createdAt)}, ${sqlTimestamp(record.updatedAt)}
      )
    `);
    return record;
  }

  async getById(input: { tenantId: string; id: string }): Promise<EntityMappingRecord | null> {
    const rows = await this.db.query<EntityMappingRow>(`select * from entity_mappings where tenant_id = ${sqlString(input.tenantId)} and id = ${sqlString(input.id)} limit 1`);
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async listByTenant(input: { tenantId: string }): Promise<EntityMappingRecord[]> {
    const rows = await this.db.query<EntityMappingRow>(`select * from entity_mappings where tenant_id = ${sqlString(input.tenantId)} order by created_at asc`);
    return rows.map(mapRow);
  }

  async update(record: EntityMappingRecord): Promise<void> {
    await this.db.query(`
      update entity_mappings
      set participant_id = ${sqlString(record.participantId)},
          entity_type = ${sqlString(record.entityType)},
          entity_ref = ${sqlString(record.entityRef)},
          label = ${sqlString(record.label)},
          mapping_status = ${sqlString(record.mappingStatus)},
          merged_into_mapping_id = ${sqlString(record.mergedIntoMappingId)},
          notes = ${sqlString(record.notes)},
          updated_at = ${sqlTimestamp(record.updatedAt)}
      where tenant_id = ${sqlString(record.tenantId)} and id = ${sqlString(record.id)}
    `);
  }
}

function mapRow(row: EntityMappingRow): EntityMappingRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    participantId: row.participant_id,
    entityType: row.entity_type,
    entityRef: row.entity_ref,
    label: row.label,
    mappingStatus: row.mapping_status,
    mergedIntoMappingId: row.merged_into_mapping_id,
    notes: row.notes,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}
