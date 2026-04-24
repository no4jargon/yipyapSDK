import type { PostgresTestHarness } from '../../test-kit/src/postgres-test-harness';
import { sqlJson, sqlString, sqlTimestamp } from './sql';

export interface MessageRecord {
  id: string;
  tenantId: string;
  connectionId: string;
  conversationId: string;
  providerMessageId: string;
  senderParticipantId: string | null;
  providerSenderRef?: string | null;
  fromMe?: boolean;
  messageType: 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'reaction' | 'system' | 'unknown';
  direction: 'inbound' | 'outbound' | 'system';
  textBody: string | null;
  normalizedTextBody: string | null;
  quotedMessageId: string | null;
  replyToProviderMessageId: string | null;
  providerSentAt: Date;
  mirroredAt: Date;
  ingestSeq: bigint;
  messageStatus: 'pending' | 'sent' | 'server_ack' | 'delivered' | 'read' | 'failed' | 'deleted' | 'redacted';
  hasAttachments: boolean;
  messagePreviewText?: string | null;
  providerMetadata: Record<string, unknown>;
  rawPayloadRef: string | null;
  deletedAt?: Date | null;
  editedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MessageRow {
  id: string;
  tenant_id: string;
  connection_id: string;
  conversation_id: string;
  provider_message_id: string;
  sender_participant_id: string | null;
  provider_sender_ref: string | null;
  from_me: boolean;
  message_type: MessageRecord['messageType'];
  direction: MessageRecord['direction'];
  text_body: string | null;
  normalized_text_body: string | null;
  quoted_message_id: string | null;
  reply_to_provider_message_id: string | null;
  provider_sent_at: string;
  mirrored_at: string;
  ingest_seq: string | number | bigint;
  message_status: MessageRecord['messageStatus'];
  has_attachments: boolean;
  message_preview_text: string | null;
  provider_metadata: Record<string, unknown> | string;
  raw_payload_ref: string | null;
  deleted_at: string | null;
  edited_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageTimelineCursor {
  providerSentAt: Date;
  ingestSeq: bigint;
}

export interface MessageTimelinePage {
  items: MessageRecord[];
  nextBeforeCursor: MessageTimelineCursor | null;
  nextAfterCursor: MessageTimelineCursor | null;
  hasOlder: boolean;
  hasNewer: boolean;
}

export class PostgresMessageRepository {
  constructor(private readonly db: PostgresTestHarness) {}

  async upsert(message: MessageRecord): Promise<{ record: MessageRecord; created: boolean }> {
    const existing = await this.getByProviderMessageId({
      tenantId: message.tenantId,
      conversationId: message.conversationId,
      providerMessageId: message.providerMessageId
    });

    const prepared = withMessageDefaults(message, existing?.createdAt ?? message.createdAt);

    if (!existing) {
      await this.db.query(`
        insert into messages (
          id, tenant_id, connection_id, conversation_id, provider_message_id, sender_participant_id,
          provider_sender_ref, from_me, message_type, direction, text_body, normalized_text_body, quoted_message_id,
          reply_to_provider_message_id, provider_sent_at, mirrored_at, ingest_seq, message_status,
          has_attachments, message_preview_text, provider_metadata, raw_payload_ref, deleted_at, edited_at, created_at, updated_at
        ) values (
          ${sqlString(prepared.id)}, ${sqlString(prepared.tenantId)}, ${sqlString(prepared.connectionId)}, ${sqlString(prepared.conversationId)}, ${sqlString(prepared.providerMessageId)}, ${sqlString(prepared.senderParticipantId)},
          ${sqlString(prepared.providerSenderRef ?? null)}, ${prepared.fromMe ? 'true' : 'false'}, ${sqlString(prepared.messageType)}, ${sqlString(prepared.direction)}, ${sqlString(prepared.textBody)}, ${sqlString(prepared.normalizedTextBody)}, ${sqlString(prepared.quotedMessageId)},
          ${sqlString(prepared.replyToProviderMessageId)}, ${sqlTimestamp(prepared.providerSentAt)}, ${sqlTimestamp(prepared.mirroredAt)}, ${prepared.ingestSeq.toString()}, ${sqlString(prepared.messageStatus)},
          ${prepared.hasAttachments ? 'true' : 'false'}, ${sqlString(prepared.messagePreviewText ?? null)}, ${sqlJson(prepared.providerMetadata)}, ${sqlString(prepared.rawPayloadRef)}, ${sqlTimestamp(prepared.deletedAt ?? null)}, ${sqlTimestamp(prepared.editedAt ?? null)}, ${sqlTimestamp(prepared.createdAt)}, ${sqlTimestamp(prepared.updatedAt)}
        )
      `);
      return { record: prepared, created: true };
    }

    const next: MessageRecord = withMessageDefaults({
      ...existing,
      senderParticipantId: message.senderParticipantId,
      providerSenderRef: message.providerSenderRef ?? existing.providerSenderRef ?? null,
      fromMe: message.fromMe ?? existing.fromMe ?? false,
      messageType: message.messageType,
      direction: message.direction,
      textBody: message.textBody,
      normalizedTextBody: message.normalizedTextBody,
      quotedMessageId: message.quotedMessageId,
      replyToProviderMessageId: message.replyToProviderMessageId,
      providerSentAt: message.providerSentAt,
      mirroredAt: message.mirroredAt,
      messageStatus: message.messageStatus,
      hasAttachments: message.hasAttachments,
      messagePreviewText: message.messagePreviewText ?? existing.messagePreviewText ?? null,
      providerMetadata: message.providerMetadata,
      rawPayloadRef: message.rawPayloadRef,
      deletedAt: message.deletedAt ?? existing.deletedAt ?? null,
      editedAt: message.editedAt ?? existing.editedAt ?? null,
      updatedAt: message.updatedAt
    }, existing.createdAt);

    await this.db.query(`
      update messages
      set sender_participant_id = ${sqlString(next.senderParticipantId)},
          provider_sender_ref = ${sqlString(next.providerSenderRef ?? null)},
          from_me = ${next.fromMe ? 'true' : 'false'},
          message_type = ${sqlString(next.messageType)},
          direction = ${sqlString(next.direction)},
          text_body = ${sqlString(next.textBody)},
          normalized_text_body = ${sqlString(next.normalizedTextBody)},
          quoted_message_id = ${sqlString(next.quotedMessageId)},
          reply_to_provider_message_id = ${sqlString(next.replyToProviderMessageId)},
          provider_sent_at = ${sqlTimestamp(next.providerSentAt)},
          mirrored_at = ${sqlTimestamp(next.mirroredAt)},
          message_status = ${sqlString(next.messageStatus)},
          has_attachments = ${next.hasAttachments ? 'true' : 'false'},
          message_preview_text = ${sqlString(next.messagePreviewText ?? null)},
          provider_metadata = ${sqlJson(next.providerMetadata)},
          raw_payload_ref = ${sqlString(next.rawPayloadRef)},
          deleted_at = ${sqlTimestamp(next.deletedAt ?? null)},
          edited_at = ${sqlTimestamp(next.editedAt ?? null)},
          updated_at = ${sqlTimestamp(next.updatedAt)}
      where tenant_id = ${sqlString(next.tenantId)}
        and id = ${sqlString(next.id)}
    `);

    return { record: next, created: false };
  }

  async getByProviderMessageId(input: { tenantId: string; conversationId: string; providerMessageId: string }): Promise<MessageRecord | null> {
    const rows = await this.db.query<MessageRow>(`
      select * from messages
      where tenant_id = ${sqlString(input.tenantId)}
        and conversation_id = ${sqlString(input.conversationId)}
        and provider_message_id = ${sqlString(input.providerMessageId)}
      limit 1
    `);
    return rows[0] ? mapMessage(rows[0]) : null;
  }

  async listByConversation(input: { tenantId: string; conversationId: string }): Promise<MessageRecord[]> {
    const rows = await this.db.query<MessageRow>(`
      select * from messages
      where tenant_id = ${sqlString(input.tenantId)}
        and conversation_id = ${sqlString(input.conversationId)}
      order by provider_sent_at asc, ingest_seq asc
    `);
    return rows.map(mapMessage);
  }

  async listTimelinePage(input: {
    tenantId: string;
    conversationId: string;
    limit: number;
    before?: MessageTimelineCursor;
    after?: MessageTimelineCursor;
    includeDeleted?: boolean;
  }): Promise<MessageTimelinePage> {
    const visibility = input.includeDeleted ? 'true' : `message_status <> 'deleted'`;

    if (input.after) {
      const rows = await this.db.query<MessageRow>(`
        select * from messages
        where tenant_id = ${sqlString(input.tenantId)}
          and conversation_id = ${sqlString(input.conversationId)}
          and ${visibility}
          and (
            provider_sent_at > ${sqlTimestamp(input.after.providerSentAt)}
            or (provider_sent_at = ${sqlTimestamp(input.after.providerSentAt)} and ingest_seq > ${input.after.ingestSeq.toString()})
          )
        order by provider_sent_at asc, ingest_seq asc
        limit ${input.limit + 1}
      `);
      const hasNewer = rows.length > input.limit;
      const pageRows = hasNewer ? rows.slice(0, input.limit) : rows;
      const items = pageRows.map(mapMessage);
      return {
        items,
        nextBeforeCursor: items.length > 0 ? toCursor(items[0]) : null,
        nextAfterCursor: hasNewer && items.length > 0 ? toCursor(items[items.length - 1]) : null,
        hasOlder: true,
        hasNewer
      };
    }

    const olderFilter = input.before
      ? `and (
          provider_sent_at < ${sqlTimestamp(input.before.providerSentAt)}
          or (provider_sent_at = ${sqlTimestamp(input.before.providerSentAt)} and ingest_seq < ${input.before.ingestSeq.toString()})
        )`
      : '';

    const rows = await this.db.query<MessageRow>(`
      select * from messages
      where tenant_id = ${sqlString(input.tenantId)}
        and conversation_id = ${sqlString(input.conversationId)}
        and ${visibility}
        ${olderFilter}
      order by provider_sent_at desc, ingest_seq desc
      limit ${input.limit + 1}
    `);

    const hasOlder = rows.length > input.limit;
    const pageRows = hasOlder ? rows.slice(0, input.limit) : rows;
    const items = pageRows.reverse().map(mapMessage);
    return {
      items,
      nextBeforeCursor: items.length > 0 ? toCursor(items[0]) : null,
      nextAfterCursor: null,
      hasOlder,
      hasNewer: input.before !== undefined
    };
  }

  async getLatestVisibleByConversation(input: { tenantId: string; conversationId: string; includeDeleted?: boolean }): Promise<MessageRecord | null> {
    const visibility = input.includeDeleted ? 'true' : `message_status <> 'deleted'`;
    const rows = await this.db.query<MessageRow>(`
      select * from messages
      where tenant_id = ${sqlString(input.tenantId)}
        and conversation_id = ${sqlString(input.conversationId)}
        and ${visibility}
      order by provider_sent_at desc, ingest_seq desc
      limit 1
    `);
    return rows[0] ? mapMessage(rows[0]) : null;
  }

  async getById(input: { tenantId: string; id: string }): Promise<MessageRecord | null> {
    const rows = await this.db.query<MessageRow>(`
      select * from messages
      where tenant_id = ${sqlString(input.tenantId)} and id = ${sqlString(input.id)}
      limit 1
    `);
    return rows[0] ? mapMessage(rows[0]) : null;
  }

  async listByTenant(input: { tenantId: string; afterIngestSeq?: bigint | null }): Promise<MessageRecord[]> {
    const comparator = input.afterIngestSeq === undefined || input.afterIngestSeq === null
      ? 'true'
      : `ingest_seq > ${input.afterIngestSeq.toString()}`;
    const rows = await this.db.query<MessageRow>(`
      select * from messages
      where tenant_id = ${sqlString(input.tenantId)} and ${comparator}
      order by ingest_seq asc
    `);
    return rows.map(mapMessage);
  }
}

function mapMessage(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    connectionId: row.connection_id,
    conversationId: row.conversation_id,
    providerMessageId: row.provider_message_id,
    senderParticipantId: row.sender_participant_id,
    providerSenderRef: row.provider_sender_ref,
    fromMe: row.from_me,
    messageType: row.message_type,
    direction: row.direction,
    textBody: row.text_body,
    normalizedTextBody: row.normalized_text_body,
    quotedMessageId: row.quoted_message_id,
    replyToProviderMessageId: row.reply_to_provider_message_id,
    providerSentAt: new Date(row.provider_sent_at),
    mirroredAt: new Date(row.mirrored_at),
    ingestSeq: BigInt(row.ingest_seq),
    messageStatus: row.message_status,
    hasAttachments: row.has_attachments,
    messagePreviewText: row.message_preview_text,
    providerMetadata: typeof row.provider_metadata === 'string' ? JSON.parse(row.provider_metadata) as Record<string, unknown> : row.provider_metadata,
    rawPayloadRef: row.raw_payload_ref,
    deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
    editedAt: row.edited_at ? new Date(row.edited_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

function withMessageDefaults(message: MessageRecord, createdAt: Date): MessageRecord {
  return {
    ...message,
    providerSenderRef: message.providerSenderRef ?? null,
    fromMe: message.fromMe ?? message.direction === 'outbound',
    messagePreviewText: message.messagePreviewText ?? null,
    deletedAt: message.deletedAt ?? null,
    editedAt: message.editedAt ?? null,
    createdAt
  };
}

function toCursor(message: MessageRecord): MessageTimelineCursor {
  return {
    providerSentAt: message.providerSentAt,
    ingestSeq: message.ingestSeq
  };
}
