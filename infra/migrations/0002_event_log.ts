export const migrationName = '0002_event_log';

export const migrationSql = `
create sequence if not exists event_log_ingest_seq;

create table if not exists event_log (
  id text primary key,
  tenant_id text not null,
  event_type text not null,
  event_family text not null,
  connection_id text null,
  conversation_id text null,
  message_id text null,
  cluster_id text null,
  ingest_seq bigint not null default nextval('event_log_ingest_seq'),
  occurred_at timestamptz not null,
  payload_json jsonb not null,
  dedupe_key text null unique,
  constraint event_log_event_family_check check (
    event_family in ('provider_raw', 'normalized', 'system')
  ),
  constraint event_log_ingest_seq_unique unique (ingest_seq)
);

create index if not exists event_log_tenant_ingest_seq_idx
  on event_log (tenant_id, ingest_seq);
`;
