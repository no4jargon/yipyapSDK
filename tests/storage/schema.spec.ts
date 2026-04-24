import { describe, expect, it } from 'vitest';
import { createPostgresTestHarness } from '../../packages/test-kit/src/postgres-test-harness';
import { runMigrations } from '../../packages/storage/src/migrate';

describe('storage schema', () => {
  it('creates the canonical connections table with unique provider refs per tenant', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);

      await harness.query(`
        insert into connections (
          id,
          tenant_id,
          workspace_user_ref,
          provider,
          status,
          status_reason,
          created_at,
          updated_at,
          provider_account_ref
        ) values (
          'conn_1',
          'tenant_1',
          'user_1',
          'whatsapp_linked',
          'pending',
          'none',
          now(),
          now(),
          'acct_1'
        )
      `);

      await expect(
        harness.query(`
          insert into connections (
            id,
            tenant_id,
            workspace_user_ref,
            provider,
            status,
            status_reason,
            created_at,
            updated_at,
            provider_account_ref
          ) values (
            'conn_2',
            'tenant_1',
            'user_2',
            'whatsapp_linked',
            'pending',
            'none',
            now(),
            now(),
            'acct_1'
          )
        `)
      ).rejects.toThrow();
    } finally {
      await harness.close();
    }
  });
});
