import { describe, expect, it } from 'vitest';
import { createPostgresTestHarness } from '../../packages/test-kit/src/postgres-test-harness';
import { runMigrations } from '../../packages/storage/src/migrate';
import { PostgresEventLogRepository } from '../../packages/event-log/src/event-log-repository';

describe('event log repository', () => {
  it('appends normalized events with globally increasing ingest sequences and replays in ingest order', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      const repository = new PostgresEventLogRepository(harness);

      const first = await repository.append({
        tenantId: 'tenant_1',
        eventType: 'connection.created',
        eventFamily: 'normalized',
        connectionId: 'conn_1',
        conversationId: null,
        messageId: null,
        clusterId: null,
        occurredAt: new Date('2026-01-01T00:00:00.000Z'),
        payloadJson: { status: 'pending' },
        dedupeKey: null
      });

      const second = await repository.append({
        tenantId: 'tenant_1',
        eventType: 'connection.qr_ready',
        eventFamily: 'normalized',
        connectionId: 'conn_1',
        conversationId: null,
        messageId: null,
        clusterId: null,
        occurredAt: new Date('2026-01-01T00:00:05.000Z'),
        payloadJson: { qr: 'abc' },
        dedupeKey: null
      });

      expect(first.ingestSeq).toBe(1n);
      expect(second.ingestSeq).toBe(2n);

      await expect(
        repository.listByTenant({ tenantId: 'tenant_1', afterIngestSeq: null, limit: 10 })
      ).resolves.toMatchObject([
        {
          eventType: 'connection.created',
          ingestSeq: 1n
        },
        {
          eventType: 'connection.qr_ready',
          ingestSeq: 2n
        }
      ]);
    } finally {
      await harness.close();
    }
  });

  it('dedupes events when the same dedupe key is reused', async () => {
    const harness = await createPostgresTestHarness();

    try {
      await runMigrations(harness);
      const repository = new PostgresEventLogRepository(harness);

      const first = await repository.append({
        tenantId: 'tenant_1',
        eventType: 'message.mirrored',
        eventFamily: 'normalized',
        connectionId: 'conn_1',
        conversationId: 'conv_1',
        messageId: 'msg_1',
        clusterId: null,
        occurredAt: new Date('2026-01-01T00:00:00.000Z'),
        payloadJson: { providerMessageId: 'provider_1' },
        dedupeKey: 'tenant_1:provider_1'
      });

      const duplicate = await repository.append({
        tenantId: 'tenant_1',
        eventType: 'message.mirrored',
        eventFamily: 'normalized',
        connectionId: 'conn_1',
        conversationId: 'conv_1',
        messageId: 'msg_1',
        clusterId: null,
        occurredAt: new Date('2026-01-01T00:00:01.000Z'),
        payloadJson: { providerMessageId: 'provider_1' },
        dedupeKey: 'tenant_1:provider_1'
      });

      expect(duplicate.id).toBe(first.id);
      expect(duplicate.ingestSeq).toBe(first.ingestSeq);

      const events = await repository.listByTenant({
        tenantId: 'tenant_1',
        afterIngestSeq: null,
        limit: 10
      });

      expect(events).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });
});
