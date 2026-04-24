import { describe, expect, it } from 'vitest';
import { createPostgresTestHarness } from '../../packages/test-kit/src/postgres-test-harness';
import { runMigrations } from '../../packages/storage/src/migrate';

describe('event log schema', () => {
  it('creates the canonical event_log table with a unique ingest sequence', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);

      await harness.query(`
        insert into event_log (
          id,
          tenant_id,
          event_type,
          event_family,
          connection_id,
          conversation_id,
          message_id,
          cluster_id,
          ingest_seq,
          occurred_at,
          payload_json,
          dedupe_key
        ) values (
          'evt_1',
          'tenant_1',
          'connection.created',
          'normalized',
          'conn_1',
          null,
          null,
          null,
          1,
          now(),
          '{"status":"pending"}',
          'dedupe_1'
        )
      `);

      await expect(
        harness.query(`
          insert into event_log (
            id,
            tenant_id,
            event_type,
            event_family,
            connection_id,
            conversation_id,
            message_id,
            cluster_id,
            ingest_seq,
            occurred_at,
            payload_json,
            dedupe_key
          ) values (
            'evt_2',
            'tenant_1',
            'connection.qr_ready',
            'normalized',
            'conn_1',
            null,
            null,
            null,
            1,
            now(),
            '{"qr":"abc"}',
            'dedupe_2'
          )
        `)
      ).rejects.toThrow();
    } finally {
      await harness.close();
    }
  });
});
