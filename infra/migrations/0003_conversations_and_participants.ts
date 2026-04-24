export const migrationName = '0003_conversations_and_participants';

export const migrationSql = `
create table if not exists conversations (
  id text primary key,
  tenant_id text not null,
  connection_id text not null,
  provider_conversation_id text not null,
  conversation_type text not null,
  title text not null,
  normalized_title text not null,
  avatar_ref text null,
  is_selected boolean not null default false,
  selection_state_changed_at timestamptz null,
  last_provider_message_at timestamptz null,
  last_mirrored_message_at timestamptz null,
  participant_count integer null,
  provider_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint conversations_type_check check (
    conversation_type in ('direct', 'group', 'broadcast', 'unknown')
  ),
  constraint conversations_connection_provider_unique unique (connection_id, provider_conversation_id)
);

create index if not exists conversations_tenant_connection_idx
  on conversations (tenant_id, connection_id);

create table if not exists participants (
  id text primary key,
  tenant_id text not null,
  connection_id text not null,
  provider_participant_id text not null,
  phone_e164 text null,
  display_name text null,
  profile_name text null,
  wa_business_name text null,
  is_self boolean not null default false,
  provider_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint participants_connection_provider_unique unique (connection_id, provider_participant_id)
);

create index if not exists participants_tenant_connection_idx
  on participants (tenant_id, connection_id);

create table if not exists conversation_membership_snapshots (
  id text primary key,
  tenant_id text not null,
  conversation_id text not null,
  participant_id text not null,
  membership_state text not null,
  observed_at timestamptz not null,
  provider_metadata jsonb not null default '{}'::jsonb,
  constraint membership_state_check check (
    membership_state in ('active', 'left', 'removed', 'unknown')
  )
);

create index if not exists conversation_membership_snapshots_conversation_idx
  on conversation_membership_snapshots (tenant_id, conversation_id, observed_at);
`;
