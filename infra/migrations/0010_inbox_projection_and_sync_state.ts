export const migrationName = '0010_inbox_projection_and_sync_state';

export const migrationSql = `
alter table conversations
  add column if not exists last_message_id text null,
  add column if not exists last_message_ingest_seq bigint null,
  add column if not exists last_message_preview text null,
  add column if not exists last_message_type text null,
  add column if not exists last_message_direction text null,
  add column if not exists inbox_visible boolean not null default true,
  add column if not exists recent_window_anchor_at timestamptz null,
  add column if not exists recent_window_complete_through timestamptz null,
  add column if not exists recent_window_status text not null default 'unknown';

create index if not exists conversations_inbox_order_idx
  on conversations (tenant_id, connection_id, inbox_visible, last_provider_message_at desc, last_message_ingest_seq desc, id asc);

create index if not exists conversations_recent_status_idx
  on conversations (tenant_id, connection_id, recent_window_status, last_provider_message_at desc);

alter table messages
  add column if not exists from_me boolean not null default false,
  add column if not exists provider_sender_ref text null,
  add column if not exists message_preview_text text null,
  add column if not exists deleted_at timestamptz null,
  add column if not exists edited_at timestamptz null;

create index if not exists messages_tenant_conversation_sent_desc_idx
  on messages (tenant_id, conversation_id, provider_sent_at desc, ingest_seq desc);

create table if not exists conversation_sync_state (
  id text primary key,
  tenant_id text not null,
  conversation_id text not null,
  connection_id text not null,
  recent_window_days integer not null,
  recent_window_start_at timestamptz null,
  recent_window_end_at timestamptz null,
  earliest_mirrored_provider_sent_at timestamptz null,
  latest_mirrored_provider_sent_at timestamptz null,
  older_history_possible boolean not null default true,
  newer_history_possible boolean not null default false,
  bootstrap_state text not null,
  backfill_state text not null,
  last_backfill_anchor_cursor text null,
  last_backfill_requested_at timestamptz null,
  last_backfill_completed_at timestamptz null,
  last_error_code text null,
  last_error_message text null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint conversation_sync_state_unique unique (tenant_id, conversation_id),
  constraint conversation_sync_state_bootstrap_check check (bootstrap_state in ('not_started', 'queued', 'running', 'partial', 'ready', 'failed')),
  constraint conversation_sync_state_backfill_check check (backfill_state in ('idle', 'queued', 'running', 'paused', 'exhausted', 'failed'))
);

create index if not exists conversation_sync_state_tenant_connection_bootstrap_idx
  on conversation_sync_state (tenant_id, connection_id, bootstrap_state, updated_at);

create index if not exists conversation_sync_state_tenant_connection_backfill_idx
  on conversation_sync_state (tenant_id, connection_id, backfill_state, updated_at);
`;