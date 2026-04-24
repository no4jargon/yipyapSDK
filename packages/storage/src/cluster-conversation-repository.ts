import type { PostgresTestHarness } from '../../test-kit/src/postgres-test-harness';
import { sqlString, sqlTimestamp } from './sql';

export interface ClusterConversationRecord {
  id: string;
  tenantId: string;
  clusterId: string;
  conversationId: string;
  addedAt: Date;
}

interface ClusterConversationRow {
  id: string;
  tenant_id: string;
  cluster_id: string;
  conversation_id: string;
  added_at: string;
}

export class PostgresClusterConversationRepository {
  constructor(private readonly db: PostgresTestHarness) {}

  async add(record: ClusterConversationRecord): Promise<ClusterConversationRecord> {
    const existing = await this.getByClusterAndConversation({
      tenantId: record.tenantId,
      clusterId: record.clusterId,
      conversationId: record.conversationId
    });
    if (existing) {
      return existing;
    }

    await this.db.query(`
      insert into cluster_conversation_memberships (id, tenant_id, cluster_id, conversation_id, added_at)
      values (
        ${sqlString(record.id)},
        ${sqlString(record.tenantId)},
        ${sqlString(record.clusterId)},
        ${sqlString(record.conversationId)},
        ${sqlTimestamp(record.addedAt)}
      )
    `);
    return record;
  }

  async listByCluster(input: { tenantId: string; clusterId: string }): Promise<ClusterConversationRecord[]> {
    const rows = await this.db.query<ClusterConversationRow>(`
      select * from cluster_conversation_memberships
      where tenant_id = ${sqlString(input.tenantId)} and cluster_id = ${sqlString(input.clusterId)}
      order by added_at asc
    `);
    return rows.map(mapMembership);
  }

  async getByClusterAndConversation(input: { tenantId: string; clusterId: string; conversationId: string }): Promise<ClusterConversationRecord | null> {
    const rows = await this.db.query<ClusterConversationRow>(`
      select * from cluster_conversation_memberships
      where tenant_id = ${sqlString(input.tenantId)}
        and cluster_id = ${sqlString(input.clusterId)}
        and conversation_id = ${sqlString(input.conversationId)}
      limit 1
    `);
    return rows[0] ? mapMembership(rows[0]) : null;
  }

  async remove(input: { tenantId: string; clusterId: string; conversationId: string }): Promise<void> {
    await this.db.query(`
      delete from cluster_conversation_memberships
      where tenant_id = ${sqlString(input.tenantId)}
        and cluster_id = ${sqlString(input.clusterId)}
        and conversation_id = ${sqlString(input.conversationId)}
    `);
  }
}

function mapMembership(row: ClusterConversationRow): ClusterConversationRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clusterId: row.cluster_id,
    conversationId: row.conversation_id,
    addedAt: new Date(row.added_at)
  };
}
