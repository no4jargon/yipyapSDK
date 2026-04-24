import { randomUUID } from 'node:crypto';
import type { PostgresTestHarness } from '../../test-kit/src/postgres-test-harness';
import { sqlJson, sqlString, sqlTimestamp } from '../../storage/src/sql';

export type EventFamily = 'provider_raw' | 'normalized' | 'system';

export interface EventLogRecord {
  id: string;
  tenantId: string;
  eventType: string;
  eventFamily: EventFamily;
  connectionId: string | null;
  conversationId: string | null;
  messageId: string | null;
  clusterId: string | null;
  ingestSeq: bigint;
  occurredAt: Date;
  payloadJson: Record<string, unknown>;
  dedupeKey: string | null;
}

export interface AppendEventInput {
  tenantId: string;
  eventType: string;
  eventFamily: EventFamily;
  connectionId: string | null;
  conversationId: string | null;
  messageId: string | null;
  clusterId: string | null;
  occurredAt: Date;
  payloadJson: Record<string, unknown>;
  dedupeKey: string | null;
}

export interface ListByTenantInput {
  tenantId: string;
  afterIngestSeq: bigint | null;
  limit: number;
}

interface EventLogRow {
  id: string;
  tenant_id: string;
  event_type: string;
  event_family: EventFamily;
  connection_id: string | null;
  conversation_id: string | null;
  message_id: string | null;
  cluster_id: string | null;
  ingest_seq: string | number | bigint;
  occurred_at: string;
  payload_json: Record<string, unknown> | string;
  dedupe_key: string | null;
}

export class PostgresEventLogRepository {
  constructor(private readonly db: PostgresTestHarness) {}

  async append(input: AppendEventInput): Promise<EventLogRecord> {
    const rows = await this.db.query<EventLogRow>(`
      insert into event_log (
        id,
        tenant_id,
        event_type,
        event_family,
        connection_id,
        conversation_id,
        message_id,
        cluster_id,
        occurred_at,
        payload_json,
        dedupe_key
      ) values (
        ${sqlString(randomUUID())},
        ${sqlString(input.tenantId)},
        ${sqlString(input.eventType)},
        ${sqlString(input.eventFamily)},
        ${sqlString(input.connectionId)},
        ${sqlString(input.conversationId)},
        ${sqlString(input.messageId)},
        ${sqlString(input.clusterId)},
        ${sqlTimestamp(input.occurredAt)},
        ${sqlJson(input.payloadJson)},
        ${sqlString(input.dedupeKey)}
      )
      on conflict (dedupe_key) do update
      set dedupe_key = excluded.dedupe_key
      returning
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
    `);

    return mapEventLogRow(rows[0]);
  }

  async listByTenant(input: ListByTenantInput): Promise<EventLogRecord[]> {
    const comparator = input.afterIngestSeq === null
      ? 'true'
      : `ingest_seq > ${input.afterIngestSeq.toString()}`;

    const rows = await this.db.query<EventLogRow>(`
      select
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
      from event_log
      where tenant_id = ${sqlString(input.tenantId)}
        and ${comparator}
      order by ingest_seq asc
      limit ${input.limit}
    `);

    return rows.map(mapEventLogRow);
  }
}

function mapEventLogRow(row: EventLogRow): EventLogRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    eventType: row.event_type,
    eventFamily: row.event_family,
    connectionId: row.connection_id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    clusterId: row.cluster_id,
    ingestSeq: BigInt(row.ingest_seq),
    occurredAt: new Date(row.occurred_at),
    payloadJson:
      typeof row.payload_json === 'string'
        ? (JSON.parse(row.payload_json) as Record<string, unknown>)
        : row.payload_json,
    dedupeKey: row.dedupe_key
  };
}
