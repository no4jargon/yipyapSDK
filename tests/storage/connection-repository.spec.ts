import { describe, expect, it } from 'vitest';
import { createPostgresTestHarness } from '../../packages/test-kit/src/postgres-test-harness';
import { runMigrations } from '../../packages/storage/src/migrate';
import { PostgresConnectionRepository } from '../../packages/storage/src/connection-repository';

describe('connection repository', () => {
  it('creates and fetches tenant-scoped connections', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      const repository = new PostgresConnectionRepository(harness);

      await repository.create({
        id: 'conn_1',
        tenantId: 'tenant_1',
        workspaceUserRef: 'user_1',
        provider: 'whatsapp_linked',
        status: 'pending',
        statusReason: 'none',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        providerAccountRef: null,
        deviceLabel: null,
        lastConnectedAt: null,
        lastHeartbeatAt: null,
        reauthRequiredAt: null,
        disconnectedAt: null
      });

      await expect(
        repository.getById({ tenantId: 'tenant_1', id: 'conn_1' })
      ).resolves.toMatchObject({
        id: 'conn_1',
        tenantId: 'tenant_1',
        workspaceUserRef: 'user_1',
        provider: 'whatsapp_linked',
        status: 'pending'
      });

      await expect(
        repository.getById({ tenantId: 'tenant_2', id: 'conn_1' })
      ).resolves.toBeNull();
    } finally {
      await harness.close();
    }
  });
});
