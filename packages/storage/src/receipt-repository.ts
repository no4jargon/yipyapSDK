import type { PostgresTestHarness } from '../../test-kit/src/postgres-test-harness';
import { sqlString, sqlTimestamp } from './sql';

export interface ReceiptRecord {
  id: string;
  tenantId: string;
  messageId: string;
  receiptType: 'server_ack' | 'delivered' | 'read';
  participantId: string | null;
  providerAt: Date;
  observedAt: Date;
  createdAt: Date;
}

interface ReceiptRow {
  id: string;
  tenant_id: string;
  message_id: string;
  receipt_type: ReceiptRecord['receiptType'];
  participant_id: string | null;
  provider_at: string;
  observed_at: string;
  created_at: string;
}

export class PostgresReceiptRepository {
  constructor(private readonly db: PostgresTestHarness) {}

  async upsert(receipt: ReceiptRecord): Promise<{ record: ReceiptRecord; created: boolean }> {
    const rows = await this.db.query<ReceiptRow>(`
      insert into receipts (id, tenant_id, message_id, receipt_type, participant_id, provider_at, observed_at, created_at)
      values (
        ${sqlString(receipt.id)}, ${sqlString(receipt.tenantId)}, ${sqlString(receipt.messageId)}, ${sqlString(receipt.receiptType)}, ${sqlString(receipt.participantId)}, ${sqlTimestamp(receipt.providerAt)}, ${sqlTimestamp(receipt.observedAt)}, ${sqlTimestamp(receipt.createdAt)}
      )
      on conflict (message_id, receipt_type, participant_id) do update
      set provider_at = excluded.provider_at,
          observed_at = excluded.observed_at
      returning *
    `);
    const record = mapReceipt(rows[0]);
    return { record, created: record.id === receipt.id };
  }

  async listByMessage(input: { tenantId: string; messageId: string }): Promise<ReceiptRecord[]> {
    const rows = await this.db.query<ReceiptRow>(`
      select * from receipts
      where tenant_id = ${sqlString(input.tenantId)} and message_id = ${sqlString(input.messageId)}
      order by provider_at asc
    `);
    return rows.map(mapReceipt);
  }
}

function mapReceipt(row: ReceiptRow): ReceiptRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    messageId: row.message_id,
    receiptType: row.receipt_type,
    participantId: row.participant_id,
    providerAt: new Date(row.provider_at),
    observedAt: new Date(row.observed_at),
    createdAt: new Date(row.created_at)
  };
}
