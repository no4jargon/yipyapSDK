export const migrationName = '0004_messages_attachments_receipts';

export const migrationSql = `
create table if not exists messages (
  id text primary key,
  tenant_id text not null,
  connection_id text not null,
  conversation_id text not null,
  provider_message_id text not null,
  sender_participant_id text null,
  message_type text not null,
  direction text not null,
  text_body text null,
  normalized_text_body text null,
  quoted_message_id text null,
  reply_to_provider_message_id text null,
  provider_sent_at timestamptz not null,
  mirrored_at timestamptz not null,
  ingest_seq bigint not null unique,
  message_status text not null,
  has_attachments boolean not null default false,
  provider_metadata jsonb not null default '{}'::jsonb,
  raw_payload_ref text null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint messages_type_check check (message_type in ('text', 'image', 'video', 'audio', 'document', 'sticker', 'reaction', 'system', 'unknown')),
  constraint messages_direction_check check (direction in ('inbound', 'outbound', 'system')),
  constraint messages_status_check check (message_status in ('pending', 'sent', 'server_ack', 'delivered', 'read', 'failed', 'deleted', 'redacted')),
  constraint messages_conversation_provider_unique unique (conversation_id, provider_message_id)
);

create index if not exists messages_tenant_conversation_sent_idx
  on messages (tenant_id, conversation_id, provider_sent_at, ingest_seq);

create table if not exists attachments (
  id text primary key,
  tenant_id text not null,
  message_id text not null,
  provider_attachment_id text null,
  attachment_type text not null,
  file_name text null,
  mime_type text null,
  byte_size bigint null,
  checksum_sha256 text null,
  storage_key text null,
  download_state text not null,
  provider_url_ref text null,
  preview_ref text null,
  download_requested_at timestamptz null,
  download_completed_at timestamptz null,
  provider_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint attachments_type_check check (attachment_type in ('image', 'video', 'audio', 'document', 'sticker', 'unknown')),
  constraint attachments_state_check check (download_state in ('not_requested', 'pending', 'available', 'failed', 'deleted', 'redacted')),
  constraint attachments_message_provider_unique unique (message_id, provider_attachment_id)
);

create index if not exists attachments_tenant_message_idx
  on attachments (tenant_id, message_id);

create table if not exists receipts (
  id text primary key,
  tenant_id text not null,
  message_id text not null,
  receipt_type text not null,
  participant_id text null,
  provider_at timestamptz not null,
  observed_at timestamptz not null,
  created_at timestamptz not null,
  constraint receipts_type_check check (receipt_type in ('server_ack', 'delivered', 'read')),
  constraint receipts_message_type_participant_unique unique (message_id, receipt_type, participant_id)
);

create index if not exists receipts_tenant_message_idx
  on receipts (tenant_id, message_id, provider_at);
`;
