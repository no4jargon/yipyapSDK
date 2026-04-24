export const migrationName = '0005_history_imports';

export const migrationSql = `
create table if not exists history_imports (
  id text primary key,
  tenant_id text not null,
  conversation_id text not null,
  import_state text not null,
  anchor_cursor text null,
  scheduled_at timestamptz not null,
  last_started_at timestamptz null,
  last_completed_at timestamptz null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint history_imports_state_check check (import_state in ('not_started', 'running', 'paused', 'completed', 'failed')),
  constraint history_imports_conversation_unique unique (tenant_id, conversation_id)
);

create index if not exists history_imports_tenant_state_idx
  on history_imports (tenant_id, import_state, scheduled_at);
`;
