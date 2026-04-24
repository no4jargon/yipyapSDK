import type { PostgresTestHarness } from '../../test-kit/src/postgres-test-harness';
import { sqlJson, sqlString, sqlTimestamp } from './sql';

export interface AttachmentRecord {
  id: string;
  tenantId: string;
  messageId: string;
  providerAttachmentId: string | null;
  attachmentType: 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'unknown';
  fileName: string | null;
  mimeType: string | null;
  byteSize: bigint | null;
  checksumSha256: string | null;
  storageKey: string | null;
  downloadState: 'not_requested' | 'pending' | 'available' | 'failed' | 'deleted' | 'redacted';
  providerUrlRef: string | null;
  previewRef: string | null;
  downloadRequestedAt: Date | null;
  downloadCompletedAt: Date | null;
  providerMetadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface AttachmentRow {
  id: string; tenant_id: string; message_id: string; provider_attachment_id: string | null;
  attachment_type: AttachmentRecord['attachmentType']; file_name: string | null; mime_type: string | null;
  byte_size: string | number | bigint | null; checksum_sha256: string | null; storage_key: string | null;
  download_state: AttachmentRecord['downloadState']; provider_url_ref: string | null; preview_ref: string | null;
  download_requested_at: string | null; download_completed_at: string | null; provider_metadata: Record<string, unknown> | string;
  created_at: string; updated_at: string;
}

export class PostgresAttachmentRepository {
  constructor(private readonly db: PostgresTestHarness) {}

  async upsert(attachment: AttachmentRecord): Promise<{ record: AttachmentRecord; created: boolean }> {
    const existing = await this.getByProviderAttachmentId({
      tenantId: attachment.tenantId,
      messageId: attachment.messageId,
      providerAttachmentId: attachment.providerAttachmentId
    });
    if (!existing) {
      await this.db.query(`
        insert into attachments (
          id, tenant_id, message_id, provider_attachment_id, attachment_type, file_name, mime_type, byte_size,
          checksum_sha256, storage_key, download_state, provider_url_ref, preview_ref, download_requested_at,
          download_completed_at, provider_metadata, created_at, updated_at
        ) values (
          ${sqlString(attachment.id)}, ${sqlString(attachment.tenantId)}, ${sqlString(attachment.messageId)}, ${sqlString(attachment.providerAttachmentId)}, ${sqlString(attachment.attachmentType)}, ${sqlString(attachment.fileName)}, ${sqlString(attachment.mimeType)}, ${attachment.byteSize === null ? 'null' : attachment.byteSize.toString()},
          ${sqlString(attachment.checksumSha256)}, ${sqlString(attachment.storageKey)}, ${sqlString(attachment.downloadState)}, ${sqlString(attachment.providerUrlRef)}, ${sqlString(attachment.previewRef)}, ${sqlTimestamp(attachment.downloadRequestedAt)},
          ${sqlTimestamp(attachment.downloadCompletedAt)}, ${sqlJson(attachment.providerMetadata)}, ${sqlTimestamp(attachment.createdAt)}, ${sqlTimestamp(attachment.updatedAt)}
        )
      `);
      return { record: attachment, created: true };
    }

    const next: AttachmentRecord = { ...existing, ...attachment, id: existing.id, createdAt: existing.createdAt };
    await this.db.query(`
      update attachments
      set attachment_type = ${sqlString(next.attachmentType)},
          file_name = ${sqlString(next.fileName)},
          mime_type = ${sqlString(next.mimeType)},
          byte_size = ${next.byteSize === null ? 'null' : next.byteSize.toString()},
          checksum_sha256 = ${sqlString(next.checksumSha256)},
          storage_key = ${sqlString(next.storageKey)},
          download_state = ${sqlString(next.downloadState)},
          provider_url_ref = ${sqlString(next.providerUrlRef)},
          preview_ref = ${sqlString(next.previewRef)},
          download_requested_at = ${sqlTimestamp(next.downloadRequestedAt)},
          download_completed_at = ${sqlTimestamp(next.downloadCompletedAt)},
          provider_metadata = ${sqlJson(next.providerMetadata)},
          updated_at = ${sqlTimestamp(next.updatedAt)}
      where tenant_id = ${sqlString(next.tenantId)} and id = ${sqlString(next.id)}
    `);
    return { record: next, created: false };
  }

  async getByProviderAttachmentId(input: { tenantId: string; messageId: string; providerAttachmentId: string | null }): Promise<AttachmentRecord | null> {
    const comparator = input.providerAttachmentId === null ? 'provider_attachment_id is null' : `provider_attachment_id = ${sqlString(input.providerAttachmentId)}`;
    const rows = await this.db.query<AttachmentRow>(`
      select * from attachments where tenant_id = ${sqlString(input.tenantId)} and message_id = ${sqlString(input.messageId)} and ${comparator} limit 1
    `);
    return rows[0] ? mapAttachment(rows[0]) : null;
  }

  async listByMessage(input: { tenantId: string; messageId: string }): Promise<AttachmentRecord[]> {
    const rows = await this.db.query<AttachmentRow>(`
      select * from attachments where tenant_id = ${sqlString(input.tenantId)} and message_id = ${sqlString(input.messageId)} order by created_at asc
    `);
    return rows.map(mapAttachment);
  }

  async getById(input: { tenantId: string; id: string }): Promise<AttachmentRecord | null> {
    const rows = await this.db.query<AttachmentRow>(`
      select * from attachments where tenant_id = ${sqlString(input.tenantId)} and id = ${sqlString(input.id)} limit 1
    `);
    return rows[0] ? mapAttachment(rows[0]) : null;
  }

  async getNextPending(input: { tenantId: string }): Promise<AttachmentRecord | null> {
    const rows = await this.db.query<AttachmentRow>(`
      select * from attachments
      where tenant_id = ${sqlString(input.tenantId)} and download_state = 'pending'
      order by download_requested_at asc nulls last, created_at asc
      limit 1
    `);
    return rows[0] ? mapAttachment(rows[0]) : null;
  }

  async listByTenant(input: { tenantId: string }): Promise<AttachmentRecord[]> {
    const rows = await this.db.query<AttachmentRow>(`
      select * from attachments where tenant_id = ${sqlString(input.tenantId)} order by created_at asc
    `);
    return rows.map(mapAttachment);
  }
}

function mapAttachment(row: AttachmentRow): AttachmentRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    messageId: row.message_id,
    providerAttachmentId: row.provider_attachment_id,
    attachmentType: row.attachment_type,
    fileName: row.file_name,
    mimeType: row.mime_type,
    byteSize: row.byte_size === null ? null : BigInt(row.byte_size),
    checksumSha256: row.checksum_sha256,
    storageKey: row.storage_key,
    downloadState: row.download_state,
    providerUrlRef: row.provider_url_ref,
    previewRef: row.preview_ref,
    downloadRequestedAt: row.download_requested_at ? new Date(row.download_requested_at) : null,
    downloadCompletedAt: row.download_completed_at ? new Date(row.download_completed_at) : null,
    providerMetadata: typeof row.provider_metadata === 'string' ? JSON.parse(row.provider_metadata) as Record<string, unknown> : row.provider_metadata,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}
