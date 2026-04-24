export const migrationName = '0001_initial';

export const migrationSql = `
create table if not exists schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists connections (
  id text primary key,
  tenant_id text not null,
  workspace_user_ref text not null,
  provider text not null,
  status text not null,
  status_reason text not null,
  provider_account_ref text null,
  device_label text null,
  last_connected_at timestamptz null,
  last_heartbeat_at timestamptz null,
  reauth_required_at timestamptz null,
  disconnected_at timestamptz null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint connections_provider_check check (provider in ('whatsapp_linked')),
  constraint connections_status_check check (
    status in (
      'pending',
      'qr_ready',
      'connecting',
      'connected',
      'degraded',
      'reconnecting',
      'disconnected',
      'reauth_required',
      'failed'
    )
  ),
  constraint connections_status_reason_check check (
    status_reason in (
      'none',
      'network_loss',
      'logged_out',
      'auth_invalid',
      'provider_reject',
      'protocol_change_suspected',
      'manual_disconnect',
      'unknown'
    )
  )
);

create unique index if not exists connections_tenant_provider_account_ref_unique
  on connections (tenant_id, provider_account_ref)
  where provider_account_ref is not null;

create index if not exists connections_tenant_workspace_user_ref_idx
  on connections (tenant_id, workspace_user_ref);
`;
