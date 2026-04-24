import type { ConnectionRecord } from '../../core-types/src/index';
import type { PostgresEventLogRepository } from '../../event-log/src/event-log-repository';
import type { ProviderAdapter } from '../../provider-adapter-interface/src/index';
import type { PostgresConnectionRepository } from '../../storage/src/connection-repository';
import { AppError } from './errors';

interface CreateConnectionInput {
  tenantId: string;
  workspaceUserRef: string;
}

interface TenantScopedConnectionInput {
  tenantId: string;
  connectionId: string;
}

interface ConnectionLifecycleServiceDeps {
  connectionRepository: PostgresConnectionRepository;
  eventLogRepository: PostgresEventLogRepository;
  providerAdapter: ProviderAdapter;
  now: () => Date;
  createId: (prefix: string) => string;
}

export class ConnectionLifecycleService {
  constructor(private readonly deps: ConnectionLifecycleServiceDeps) {}

  async createConnection(input: CreateConnectionInput): Promise<ConnectionRecord> {
    const createdAt = this.deps.now();
    const connection: ConnectionRecord = {
      id: this.deps.createId('conn'),
      tenantId: input.tenantId,
      workspaceUserRef: input.workspaceUserRef,
      provider: 'whatsapp_linked',
      status: 'pending',
      statusReason: 'none',
      createdAt,
      updatedAt: createdAt,
      providerAccountRef: null,
      deviceLabel: null,
      lastConnectedAt: null,
      lastHeartbeatAt: null,
      reauthRequiredAt: null,
      disconnectedAt: null
    };

    await this.deps.connectionRepository.create(connection);
    await this.appendLifecycleEvent(connection, 'connection.created', {
      status: connection.status,
      workspaceUserRef: connection.workspaceUserRef
    }, createdAt);

    await this.deps.providerAdapter.createSession({ connectionId: connection.id });
    const bootstrap = await this.deps.providerAdapter.getConnectionBootstrapState(connection.id);
    const updatedAt = this.deps.now();

    const next = mapBootstrapStatus(connection, bootstrap.status, updatedAt, bootstrap.qrPayload);
    await this.deps.connectionRepository.update({
      tenantId: connection.tenantId,
      id: connection.id,
      patch: {
        status: next.status,
        statusReason: next.statusReason,
        updatedAt: next.updatedAt,
        lastConnectedAt: next.lastConnectedAt,
        reauthRequiredAt: next.reauthRequiredAt,
        disconnectedAt: next.disconnectedAt,
        providerAccountRef: next.providerAccountRef,
        deviceLabel: next.deviceLabel,
        lastHeartbeatAt: next.lastHeartbeatAt
      }
    });

    await this.appendLifecycleEvent(connection, `connection.${next.status}`, {
      status: next.status,
      qrPayload: bootstrap.qrPayload ?? null
    }, updatedAt);

    return next;
  }

  async getConnectionStatus(input: TenantScopedConnectionInput): Promise<{
    status: ConnectionRecord['status'];
    statusReason: ConnectionRecord['statusReason'];
  }> {
    const connection = await this.getRequiredConnection(input);
    return {
      status: connection.status,
      statusReason: connection.statusReason
    };
  }

  async getConnectionQr(input: TenantScopedConnectionInput): Promise<{ qrPayload: string }> {
    const connection = await this.getRequiredConnection(input);
    if (connection.status !== 'qr_ready' && connection.status !== 'pending') {
      throw new AppError(
        'precondition_failed',
        `connection ${connection.id} does not have a QR available in status ${connection.status}`
      );
    }

    const bootstrap = await this.deps.providerAdapter.getConnectionBootstrapState(connection.id);
    if (bootstrap.status !== 'qr_ready' || !bootstrap.qrPayload) {
      throw new AppError('precondition_failed', `connection ${connection.id} does not have a QR payload`);
    }

    return { qrPayload: bootstrap.qrPayload };
  }

  async disconnectConnection(input: TenantScopedConnectionInput): Promise<void> {
    const connection = await this.getRequiredConnection(input);
    const now = this.deps.now();

    await this.deps.providerAdapter.disconnect(connection.id);
    await this.deps.connectionRepository.update({
      tenantId: connection.tenantId,
      id: connection.id,
      patch: {
        status: 'disconnected',
        statusReason: 'manual_disconnect',
        disconnectedAt: now,
        updatedAt: now
      }
    });

    await this.appendLifecycleEvent(connection, 'connection.disconnected', {
      status: 'disconnected',
      statusReason: 'manual_disconnect'
    }, now);
  }

  async reconnectConnection(input: TenantScopedConnectionInput): Promise<void> {
    const connection = await this.getRequiredConnection(input);
    const reconnectingAt = this.deps.now();

    await this.deps.providerAdapter.createSession({ connectionId: connection.id });
    await this.deps.connectionRepository.update({
      tenantId: connection.tenantId,
      id: connection.id,
      patch: {
        status: 'reconnecting',
        statusReason: 'none',
        disconnectedAt: null,
        updatedAt: reconnectingAt
      }
    });

    await this.appendLifecycleEvent(connection, 'connection.reconnecting', {
      status: 'reconnecting'
    }, reconnectingAt);

    await this.deps.providerAdapter.connect(connection.id);
    const bootstrap = await this.deps.providerAdapter.getConnectionBootstrapState(connection.id);
    const connectedAt = this.deps.now();
    const next = mapBootstrapStatus(connection, bootstrap.status, connectedAt, bootstrap.qrPayload);

    await this.deps.connectionRepository.update({
      tenantId: connection.tenantId,
      id: connection.id,
      patch: {
        status: next.status,
        statusReason: next.statusReason,
        lastConnectedAt: next.lastConnectedAt,
        disconnectedAt: next.disconnectedAt,
        reauthRequiredAt: next.reauthRequiredAt,
        updatedAt: next.updatedAt
      }
    });

    await this.appendLifecycleEvent(connection, `connection.${next.status}`, {
      status: next.status
    }, connectedAt);
  }

  private async getRequiredConnection(
    input: TenantScopedConnectionInput
  ): Promise<ConnectionRecord> {
    const connection = await this.deps.connectionRepository.getById({
      tenantId: input.tenantId,
      id: input.connectionId
    });

    if (!connection) {
      throw new AppError('not_found', `connection ${input.connectionId} was not found`);
    }

    return connection;
  }

  private async appendLifecycleEvent(
    connection: ConnectionRecord,
    eventType: string,
    payloadJson: Record<string, unknown>,
    occurredAt: Date
  ): Promise<void> {
    await this.deps.eventLogRepository.append({
      tenantId: connection.tenantId,
      eventType,
      eventFamily: 'normalized',
      connectionId: connection.id,
      conversationId: null,
      messageId: null,
      clusterId: null,
      occurredAt,
      payloadJson,
      dedupeKey: null
    });
  }
}

function mapBootstrapStatus(
  connection: ConnectionRecord,
  status: 'pending' | 'qr_ready' | 'connecting' | 'connected' | 'reauth_required' | 'failed',
  updatedAt: Date,
  qrPayload?: string
): ConnectionRecord {
  if (status === 'connected') {
    return {
      ...connection,
      status: 'connected',
      statusReason: 'none',
      lastConnectedAt: updatedAt,
      disconnectedAt: null,
      reauthRequiredAt: null,
      updatedAt
    };
  }

  if (status === 'reauth_required') {
    return {
      ...connection,
      status: 'reauth_required',
      statusReason: 'auth_invalid',
      reauthRequiredAt: updatedAt,
      updatedAt
    };
  }

  if (status === 'failed') {
    return {
      ...connection,
      status: 'failed',
      statusReason: 'unknown',
      updatedAt
    };
  }

  if (status === 'connecting') {
    return {
      ...connection,
      status: 'connecting',
      statusReason: 'none',
      updatedAt
    };
  }

  if (status === 'qr_ready') {
    return {
      ...connection,
      status: 'qr_ready',
      statusReason: 'none',
      updatedAt,
      providerMetadataPlaceholder: qrPayload
    } as ConnectionRecord;
  }

  return {
    ...connection,
    status: 'pending',
    statusReason: 'none',
    updatedAt
  };
}
