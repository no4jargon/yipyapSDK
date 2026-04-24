import type { PostgresTestHarness } from '../../test-kit/src/postgres-test-harness';
import { sqlString, sqlTimestamp } from './sql';

export interface ClusterRecord {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  clusterType: 'manual';
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface ClusterRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  cluster_type: 'manual';
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export class PostgresClusterRepository {
  constructor(private readonly db: PostgresTestHarness) {}

  async create(cluster: ClusterRecord): Promise<ClusterRecord> {
    await this.db.query(`
      insert into clusters (id, tenant_id, name, description, cluster_type, archived, created_at, updated_at)
      values (
        ${sqlString(cluster.id)},
        ${sqlString(cluster.tenantId)},
        ${sqlString(cluster.name)},
        ${sqlString(cluster.description)},
        ${sqlString(cluster.clusterType)},
        ${cluster.archived ? 'true' : 'false'},
        ${sqlTimestamp(cluster.createdAt)},
        ${sqlTimestamp(cluster.updatedAt)}
      )
    `);
    return cluster;
  }

  async getById(input: { tenantId: string; id: string }): Promise<ClusterRecord | null> {
    const rows = await this.db.query<ClusterRow>(`
      select * from clusters where tenant_id = ${sqlString(input.tenantId)} and id = ${sqlString(input.id)} limit 1
    `);
    return rows[0] ? mapCluster(rows[0]) : null;
  }

  async listByTenant(input: { tenantId: string }): Promise<ClusterRecord[]> {
    const rows = await this.db.query<ClusterRow>(`
      select * from clusters where tenant_id = ${sqlString(input.tenantId)} order by created_at asc
    `);
    return rows.map(mapCluster);
  }

  async update(record: ClusterRecord): Promise<void> {
    await this.db.query(`
      update clusters
      set name = ${sqlString(record.name)},
          description = ${sqlString(record.description)},
          archived = ${record.archived ? 'true' : 'false'},
          updated_at = ${sqlTimestamp(record.updatedAt)}
      where tenant_id = ${sqlString(record.tenantId)} and id = ${sqlString(record.id)}
    `);
  }
}

function mapCluster(row: ClusterRow): ClusterRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description,
    clusterType: row.cluster_type,
    archived: row.archived,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}
