-- Temporary encrypted credentials for Unified Login asset verification when Meta returns no Page linkage.
create table connection_sessions(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id) on delete cascade,
 actor_id uuid not null references auth.users(id),platform cl_platform not null,
 encrypted_token text not null,token_kind text not null,permission_metadata jsonb not null default '{}',
 expires_at timestamptz not null default now()+interval '15 minutes',consumed_at timestamptz
);
create index connection_sessions_expiry_idx on connection_sessions(expires_at);
alter table connection_sessions enable row level security;
revoke all on connection_sessions from anon,authenticated;
