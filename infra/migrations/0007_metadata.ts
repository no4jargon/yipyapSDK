export const migrationName = '0007_metadata';

export const migrationSql = `
create table if not exists metadata_records (
  id text primary key,
  tenant_id text not null,
  target_type text not null,
  target_id text not null,
  namespace text not null,
  key text not null,
  value_json jsonb null,
  version integer not null,
  deleted boolean not null default false,
  created_at timestamptz not null,
  constraint metadata_target_type_check check (
    target_type in ('message', 'conversation', 'participant', 'attachment', 'cluster')
  ),
  constraint metadata_version_unique unique (tenant_id, target_type, target_id, namespace, key, version)
);

create index if not exists metadata_target_lookup_idx
  on metadata_records (tenant_id, target_type, target_id, namespace, key, version);
`;
