export const migrationName = '0009_deletion_records';

export const migrationSql = `
create table if not exists deletion_records (
  id text primary key,
  tenant_id text not null,
  target_type text not null,
  target_id text not null,
  operation_type text not null,
  reason text null,
  requested_by_ref text null,
  requested_at timestamptz not null,
  completed_at timestamptz null,
  status text not null,
  constraint deletion_target_type_check check (
    target_type in ('message', 'attachment', 'conversation', 'participant', 'cluster')
  ),
  constraint deletion_operation_type_check check (
    operation_type in ('soft_delete', 'hard_delete', 'redact')
  ),
  constraint deletion_status_check check (
    status in ('pending', 'completed', 'failed')
  )
);

create index if not exists deletion_records_tenant_requested_idx
  on deletion_records (tenant_id, requested_at);
`;
