import type { ConnectionRecord } from '../../core-types/src/index';
import type { PostgresTestHarness } from '../../test-kit/src/postgres-test-harness';
import { sqlString, sqlTimestamp } from './sql';

interface GetByIdInput {
  tenantId: string;
  id: string;
}

interface UpdateInput {
  tenantId: string;
  id: string;
  patch: Partial<Omit<ConnectionRecord, 'id' | 'tenantId' | 'workspaceUserRef' | 'provider' | 'createdAt'>> & {
    updatedAt: Date;
  };
}

interface ConnectionRow {
  id: string;
  tenant_id: string;
  workspace_user_ref: string;
  provider: ConnectionRecord['provider'];
  status: ConnectionRecord['status'];
  status_reason: ConnectionRecord['statusReason'];
  provider_account_ref: string | null;
  device_label: string | null;
  last_connected_at: string | null;
  last_heartbeat_at: string | null;
  reauth_required_at: string | null;
  disconnected_at: string | null;
  created_at: string;
  updated_at: string;
}

export class PostgresConnectionRepository {
  constructor(private readonly db: PostgresTestHarness) {}

  async listByTenant(input: { tenantId: string; workspaceUserRef?: string }): Promise<ConnectionRecord[]> {
    const workspaceFilter = input.workspaceUserRef
      ? ` and workspace_user_ref = ${sqlString(input.workspaceUserRef)}`
      : '';
    const rows = await this.db.query<ConnectionRow>(`
      select
        id,
        tenant_id,
        workspace_user_ref,
        provider,
        status,
        status_reason,
        provider_account_ref,
        device_label,
        last_connected_at,
        last_heartbeat_at,
        reauth_required_at,
        disconnected_at,
        created_at,
        updated_at
      from connections
      where tenant_id = ${sqlString(input.tenantId)}${workspaceFilter}
      order by created_at asc
    `);

    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      workspaceUserRef: row.workspace_user_ref,
      provider: row.provider,
      status: row.status,
      statusReason: row.status_reason,
      providerAccountRef: row.provider_account_ref,
      deviceLabel: row.device_label,
      lastConnectedAt: toDate(row.last_connected_at),
      lastHeartbeatAt: toDate(row.last_heartbeat_at),
      reauthRequiredAt: toDate(row.reauth_required_at),
      disconnectedAt: toDate(row.disconnected_at),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    }));
  }

  async create(connection: ConnectionRecord): Promise<void> {
    await this.db.query(`
      insert into connections (
        id,
        tenant_id,
        workspace_user_ref,
        provider,
        status,
        status_reason,
        provider_account_ref,
        device_label,
        last_connected_at,
        last_heartbeat_at,
        reauth_required_at,
        disconnected_at,
        created_at,
        updated_at
      ) values (
        ${sqlString(connection.id)},
        ${sqlString(connection.tenantId)},
        ${sqlString(connection.workspaceUserRef)},
        ${sqlString(connection.provider)},
        ${sqlString(connection.status)},
        ${sqlString(connection.statusReason)},
        ${sqlString(connection.providerAccountRef)},
        ${sqlString(connection.deviceLabel)},
        ${sqlTimestamp(connection.lastConnectedAt)},
        ${sqlTimestamp(connection.lastHeartbeatAt)},
        ${sqlTimestamp(connection.reauthRequiredAt)},
        ${sqlTimestamp(connection.disconnectedAt)},
        ${sqlTimestamp(connection.createdAt)},
        ${sqlTimestamp(connection.updatedAt)}
      )
    `);
  }

  async update(input: UpdateInput): Promise<void> {
    const current = await this.getById({ tenantId: input.tenantId, id: input.id });
    if (!current) {
      return;
    }

    const next: ConnectionRecord = {
      ...current,
      ...input.patch
    };

    await this.db.query(`
      update connections
      set status = ${sqlString(next.status)},
          status_reason = ${sqlString(next.statusReason)},
          provider_account_ref = ${sqlString(next.providerAccountRef)},
          device_label = ${sqlString(next.deviceLabel)},
          last_connected_at = ${sqlTimestamp(next.lastConnectedAt)},
          last_heartbeat_at = ${sqlTimestamp(next.lastHeartbeatAt)},
          reauth_required_at = ${sqlTimestamp(next.reauthRequiredAt)},
          disconnected_at = ${sqlTimestamp(next.disconnectedAt)},
          updated_at = ${sqlTimestamp(next.updatedAt)}
      where tenant_id = ${sqlString(input.tenantId)}
        and id = ${sqlString(input.id)}
    `);
  }

  async getById(input: GetByIdInput): Promise<ConnectionRecord | null> {
    const rows = await this.db.query<ConnectionRow>(`
      select
        id,
        tenant_id,
        workspace_user_ref,
        provider,
        status,
        status_reason,
        provider_account_ref,
        device_label,
        last_connected_at,
        last_heartbeat_at,
        reauth_required_at,
        disconnected_at,
        created_at,
        updated_at
      from connections
      where tenant_id = ${sqlString(input.tenantId)}
        and id = ${sqlString(input.id)}
      limit 1
    `);

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceUserRef: row.workspace_user_ref,
      provider: row.provider,
      status: row.status,
      statusReason: row.status_reason,
      providerAccountRef: row.provider_account_ref,
      deviceLabel: row.device_label,
      lastConnectedAt: toDate(row.last_connected_at),
      lastHeartbeatAt: toDate(row.last_heartbeat_at),
      reauthRequiredAt: toDate(row.reauth_required_at),
      disconnectedAt: toDate(row.disconnected_at),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
}

function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}
