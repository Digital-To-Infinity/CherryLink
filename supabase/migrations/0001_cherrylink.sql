-- CherryLink v0.1: run against a NEW independent Supabase project.
-- Server/worker connect with trusted PostgreSQL credentials; client uses Supabase Auth only.
create extension if not exists pgcrypto;
create type cl_role as enum ('ADMIN','EDITOR');
create type cl_platform as enum ('FACEBOOK','INSTAGRAM');
create type cl_account_status as enum ('CONNECTED','RECONNECT_REQUIRED','DISCONNECTED');
create type cl_delivery_status as enum ('DRAFT','SCHEDULED','PREPARING','READY','PUBLISHING','PUBLISHED','RETRY_WAIT','FAILED','ACTION_REQUIRED','UNKNOWN','CANCELLED');
create type cl_job_status as enum ('QUEUED','RUNNING','DONE','CANCELLED','UNKNOWN');

create table workspaces(
  id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 2 and 120),
  timezone text not null default 'Asia/Kolkata',settings jsonb not null default '{}',created_at timestamptz not null default now()
);
create table workspace_members(
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,role cl_role not null default 'EDITOR',created_at timestamptz not null default now(),
  unique(workspace_id,user_id)
);
create index workspace_members_user_idx on workspace_members(user_id);
create table social_accounts(
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id) on delete cascade,
  platform cl_platform not null,provider_account_id text not null,name text not null,username text,account_type text,
  connection_status cl_account_status not null default 'CONNECTED',token_reference uuid,
  permission_metadata jsonb not null default '{}',token_expiry timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(workspace_id,platform,provider_account_id),unique(id,workspace_id),unique(id,platform)
);
create index social_accounts_workspace_idx on social_accounts(workspace_id,platform);
create table social_account_credentials(
  id uuid primary key default gen_random_uuid(),social_account_id uuid not null unique references social_accounts(id) on delete cascade,
  encrypted_token text not null,token_kind text not null,created_at timestamptz not null default now(),rotated_at timestamptz not null default now()
);
alter table social_accounts add constraint social_accounts_token_reference_fk foreign key(token_reference) references social_account_credentials(id) deferrable initially deferred;
create table oauth_states(
  state_hash text primary key,workspace_id uuid not null references workspaces(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,platform cl_platform not null,
  expires_at timestamptz not null,consumed_at timestamptz,created_at timestamptz not null default now()
);
create index oauth_states_expiry_idx on oauth_states(expires_at);
create table media_assets(
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id) on delete cascade,
  storage_path text not null unique,original_filename text not null,mime_type text not null,
  size_bytes bigint not null check(size_bytes>0),width integer,height integer,duration_seconds numeric(10,2),
  checksum_sha256 text not null,processing_status text not null default 'READY',metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),unique(id,workspace_id)
);
create index media_workspace_idx on media_assets(workspace_id,created_at desc);
create table posts(
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id),media_asset_id uuid,caption text not null default '',scheduled_at_utc timestamptz,
  timezone text not null default 'Asia/Kolkata',lifecycle_status text not null default 'DRAFT',
  content_origin text not null default 'HUMAN_UPLOAD',approval_status text not null default 'NOT_REQUIRED',
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  foreign key(media_asset_id,workspace_id) references media_assets(id,workspace_id),unique(id,workspace_id)
);
create index posts_workspace_schedule_idx on posts(workspace_id,scheduled_at_utc);
create table post_targets(
  id uuid primary key default gen_random_uuid(),post_id uuid not null references posts(id) on delete cascade,
  workspace_id uuid not null, social_account_id uuid not null,platform cl_platform not null,
  content_type text not null check(content_type in ('TEXT','IMAGE','REEL')),
  caption_override text,scheduled_at_utc timestamptz not null,publishing_status cl_delivery_status not null default 'SCHEDULED',
  provider_container_id text,provider_post_id text,provider_permalink text,published_at timestamptz,
  last_error_code text,last_error_message text,request_stage text not null default 'NOT_STARTED',
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  foreign key(post_id,workspace_id) references posts(id,workspace_id),
  foreign key(social_account_id,workspace_id) references social_accounts(id,workspace_id),
  foreign key(social_account_id,platform) references social_accounts(id,platform),
  unique(post_id,social_account_id)
);
create index post_targets_schedule_idx on post_targets(scheduled_at_utc,publishing_status);
create index post_targets_account_idx on post_targets(social_account_id,publishing_status);
create table publication_jobs(
  id uuid primary key default gen_random_uuid(),post_target_id uuid not null unique references post_targets(id) on delete cascade,
  status cl_job_status not null default 'QUEUED',available_at timestamptz not null,locked_until timestamptz,
  worker_id text,attempt_count integer not null default 0,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index publication_jobs_due_idx on publication_jobs(available_at,id) where status='QUEUED';
create index publication_jobs_leases_idx on publication_jobs(locked_until) where status='RUNNING';
create table publication_attempts(
  id uuid primary key default gen_random_uuid(),post_target_id uuid not null references post_targets(id) on delete cascade,
  attempt_number integer not null,started_at timestamptz not null default now(),finished_at timestamptz,
  provider_operation text,provider_request_reference text,safe_error_code text,outcome text not null default 'STARTED',
  unique(post_target_id,attempt_number)
);
create index attempts_target_idx on publication_attempts(post_target_id,started_at desc);
create table publication_events(
  id bigint generated always as identity primary key,post_target_id uuid not null references post_targets(id) on delete cascade,
  old_status cl_delivery_status,new_status cl_delivery_status not null,reason text,created_at timestamptz not null default now()
);
create table audit_logs(
  id bigint generated always as identity primary key,workspace_id uuid not null references workspaces(id) on delete cascade,
  actor_id uuid,entity_type text not null,entity_id text not null,action text not null,created_at timestamptz not null default now(),metadata jsonb not null default '{}'
);
create index audit_workspace_idx on audit_logs(workspace_id,created_at desc);
create table worker_heartbeats(worker_id text primary key,last_seen_at timestamptz not null default now(),status text not null default 'ACTIVE',details jsonb not null default '{}');

create or replace function cl_capture_transition() returns trigger language plpgsql as $$
begin
  if tg_op='UPDATE' and old.publishing_status='PUBLISHED' and new.publishing_status <> 'PUBLISHED' then
    raise exception 'A published delivery cannot return to a nonpublished state';
  end if;
  if tg_op='INSERT' or new.publishing_status is distinct from old.publishing_status then
    insert into publication_events(post_target_id,old_status,new_status,reason)
    values(new.id,case when tg_op='INSERT' then null else old.publishing_status end,new.publishing_status,new.last_error_code);
  end if;
  return new;
end $$;
create trigger cl_target_transition after insert or update of publishing_status on post_targets for each row execute function cl_capture_transition();

-- All application mutations run through the API (which checks membership); direct clients may only read rows belonging to their workspace.
create schema if not exists cherrylink_private;
revoke all on schema cherrylink_private from public;
grant usage on schema cherrylink_private to authenticated;
create or replace function cherrylink_private.cl_is_member(target_workspace uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from workspace_members m where m.workspace_id=target_workspace and m.user_id=auth.uid())
$$;
create or replace function cherrylink_private.cl_is_admin(target_workspace uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from workspace_members m where m.workspace_id=target_workspace and m.user_id=auth.uid() and m.role='ADMIN')
$$;
revoke all on function cherrylink_private.cl_is_member(uuid) from public;
revoke all on function cherrylink_private.cl_is_admin(uuid) from public;
grant execute on function cherrylink_private.cl_is_member(uuid) to authenticated;
grant execute on function cherrylink_private.cl_is_admin(uuid) to authenticated;

alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table social_accounts enable row level security;
alter table social_account_credentials enable row level security;
alter table oauth_states enable row level security;
alter table media_assets enable row level security;
alter table posts enable row level security;
alter table post_targets enable row level security;
alter table publication_jobs enable row level security;
alter table publication_attempts enable row level security;
alter table publication_events enable row level security;
alter table audit_logs enable row level security;
alter table worker_heartbeats enable row level security;

create policy workspaces_read on workspaces for select to authenticated using(cherrylink_private.cl_is_member(id));
create policy workspace_members_read on workspace_members for select to authenticated using(cherrylink_private.cl_is_member(workspace_id));
create policy accounts_read on social_accounts for select to authenticated using(cherrylink_private.cl_is_member(workspace_id));
create policy media_read on media_assets for select to authenticated using(cherrylink_private.cl_is_member(workspace_id));
create policy posts_read on posts for select to authenticated using(cherrylink_private.cl_is_member(workspace_id));
create policy targets_read on post_targets for select to authenticated using(cherrylink_private.cl_is_member(workspace_id));
-- NO direct-client access to credentials, OAuth states, jobs, attempts, logs or heartbeats.
revoke all on social_account_credentials,oauth_states,publication_jobs,publication_attempts,publication_events,worker_heartbeats from anon,authenticated;
-- Private bucket, server alone signs URLs and uploads content.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values('cherrylink-media','cherrylink-media',false,157286400,array['image/jpeg','image/png','video/mp4'])
on conflict (id) do nothing;
