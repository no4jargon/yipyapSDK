export const migrationName = '0006_clusters';

export const migrationSql = `
create table if not exists clusters (
  id text primary key,
  tenant_id text not null,
  name text not null,
  description text null,
  cluster_type text not null,
  archived boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint clusters_type_check check (cluster_type in ('manual'))
);

create table if not exists cluster_conversation_memberships (
  id text primary key,
  tenant_id text not null,
  cluster_id text not null,
  conversation_id text not null,
  added_at timestamptz not null,
  constraint cluster_conversation_unique unique (cluster_id, conversation_id)
);

create index if not exists cluster_memberships_tenant_cluster_idx
  on cluster_conversation_memberships (tenant_id, cluster_id, added_at);
`;
