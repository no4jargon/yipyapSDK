export const migrationName = '0008_mappings_and_cursors';

export const migrationSql = `
create table if not exists entity_mappings (
  id text primary key,
  tenant_id text not null,
  participant_id text not null,
  entity_type text not null,
  entity_ref text not null,
  label text null,
  mapping_status text not null,
  merged_into_mapping_id text null,
  notes text null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint entity_mappings_status_check check (mapping_status in ('active', 'merged', 'deleted'))
);

create index if not exists entity_mappings_tenant_idx
  on entity_mappings (tenant_id, participant_id, created_at);

create table if not exists export_cursors (
  id text primary key,
  tenant_id text not null,
  cursor_name text not null,
  last_ingest_seq bigint not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint export_cursor_unique unique (tenant_id, cursor_name)
);
`;
