import { describe, expect, it } from 'vitest';
import { createPostgresTestHarness } from '../../packages/test-kit/src/postgres-test-harness';
import { runMigrations } from '../../packages/storage/src/migrate';
import { PostgresConnectionRepository } from '../../packages/storage/src/connection-repository';
import { PostgresEventLogRepository } from '../../packages/event-log/src/event-log-repository';
import { createFakeProviderAdapter } from '../../packages/provider-adapter-interface/src/fake-provider-adapter';
import { ConnectionLifecycleService } from '../../packages/query-api/src/connection-lifecycle-service';

describe('connection lifecycle service', () => {
  it('creates a connection, persists qr_ready state, and emits lifecycle events', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      const service = new ConnectionLifecycleService({
        connectionRepository: new PostgresConnectionRepository(harness),
        eventLogRepository: new PostgresEventLogRepository(harness),
        providerAdapter: await createFakeProviderAdapter(),
        now: () => new Date('2026-01-01T00:00:00.000Z'),
        createId: (() => {
          let counter = 0;
          return (prefix: string) => `${prefix}_${++counter}`;
        })()
      });

      const connection = await service.createConnection({
        tenantId: 'tenant_1',
        workspaceUserRef: 'user_1'
      });

      expect(connection).toMatchObject({
        id: 'conn_1',
        tenantId: 'tenant_1',
        workspaceUserRef: 'user_1',
        provider: 'whatsapp_linked',
        status: 'qr_ready',
        statusReason: 'none'
      });

      await expect(
        service.getConnectionStatus({ tenantId: 'tenant_1', connectionId: connection.id })
      ).resolves.toEqual({
        status: 'qr_ready',
        statusReason: 'none'
      });

      await expect(
        service.getConnectionQr({ tenantId: 'tenant_1', connectionId: connection.id })
      ).resolves.toEqual({
        qrPayload: 'fake-qr:conn_1'
      });

      await expect(
        new PostgresEventLogRepository(harness).listByTenant({
          tenantId: 'tenant_1',
          afterIngestSeq: null,
          limit: 10
        })
      ).resolves.toMatchObject([
        { eventType: 'connection.created', ingestSeq: 1n },
        { eventType: 'connection.qr_ready', ingestSeq: 2n }
      ]);
    } finally {
      await harness.close();
    }
  });

  it('disconnects and reconnects a connection, persisting status transitions and events', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      const service = new ConnectionLifecycleService({
        connectionRepository: new PostgresConnectionRepository(harness),
        eventLogRepository: new PostgresEventLogRepository(harness),
        providerAdapter: await createFakeProviderAdapter(),
        now: (() => {
          const timestamps = [
            new Date('2026-01-01T00:00:00.000Z'),
            new Date('2026-01-01T00:05:00.000Z'),
            new Date('2026-01-01T00:10:00.000Z'),
            new Date('2026-01-01T00:15:00.000Z'),
            new Date('2026-01-01T00:20:00.000Z'),
            new Date('2026-01-01T00:25:00.000Z')
          ];
          let index = 0;
          return () => timestamps[index++] ?? timestamps.at(-1)!;
        })(),
        createId: (() => {
          let counter = 0;
          return (prefix: string) => `${prefix}_${++counter}`;
        })()
      });

      const connection = await service.createConnection({
        tenantId: 'tenant_1',
        workspaceUserRef: 'user_1'
      });

      await service.disconnectConnection({
        tenantId: 'tenant_1',
        connectionId: connection.id
      });

      await expect(
        service.getConnectionStatus({ tenantId: 'tenant_1', connectionId: connection.id })
      ).resolves.toEqual({
        status: 'disconnected',
        statusReason: 'manual_disconnect'
      });

      await service.reconnectConnection({
        tenantId: 'tenant_1',
        connectionId: connection.id
      });

      await expect(
        service.getConnectionStatus({ tenantId: 'tenant_1', connectionId: connection.id })
      ).resolves.toEqual({
        status: 'connected',
        statusReason: 'none'
      });

      await expect(
        new PostgresEventLogRepository(harness).listByTenant({
          tenantId: 'tenant_1',
          afterIngestSeq: null,
          limit: 10
        })
      ).resolves.toMatchObject([
        { eventType: 'connection.created', ingestSeq: 1n },
        { eventType: 'connection.qr_ready', ingestSeq: 2n },
        { eventType: 'connection.disconnected', ingestSeq: 3n },
        { eventType: 'connection.reconnecting', ingestSeq: 4n },
        { eventType: 'connection.connected', ingestSeq: 5n }
      ]);
    } finally {
      await harness.close();
    }
  });

  it('rejects QR fetch outside QR-capable states', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      const service = new ConnectionLifecycleService({
        connectionRepository: new PostgresConnectionRepository(harness),
        eventLogRepository: new PostgresEventLogRepository(harness),
        providerAdapter: await createFakeProviderAdapter(),
        now: () => new Date('2026-01-01T00:00:00.000Z'),
        createId: (() => {
          let counter = 0;
          return (prefix: string) => `${prefix}_${++counter}`;
        })()
      });

      const connection = await service.createConnection({
        tenantId: 'tenant_1',
        workspaceUserRef: 'user_1'
      });

      await service.reconnectConnection({
        tenantId: 'tenant_1',
        connectionId: connection.id
      });

      await expect(
        service.getConnectionQr({ tenantId: 'tenant_1', connectionId: connection.id })
      ).rejects.toMatchObject({ code: 'precondition_failed' });
    } finally {
      await harness.close();
    }
  });
});
