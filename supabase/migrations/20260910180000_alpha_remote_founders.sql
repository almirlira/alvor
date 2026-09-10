create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.alpha_state (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key text not null,
  value jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, key)
);

create table if not exists public.feedback_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null default 'Fundador',
  area text not null default 'geral',
  task_id text,
  ease int not null check (ease between 1 and 7),
  outcome text not null check (outcome in ('completed', 'help', 'blocked', 'skipped')),
  comment text,
  details jsonb not null default '{}'::jsonb,
  screen text,
  priority text not null default 'media' check (priority in ('baixa', 'media', 'alta')),
  status text not null default 'aberta' check (status in ('aberta', 'em_analise', 'resolvida')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  event text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.alpha_state enable row level security;
alter table public.feedback_notes enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
using (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "workspaces_select_member" on public.workspaces;
create policy "workspaces_select_member"
on public.workspaces for select
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = workspaces.id
      and wm.user_id = auth.uid()
  )
);

drop policy if exists "workspace_members_select_self" on public.workspace_members;
create policy "workspace_members_select_self"
on public.workspace_members for select
using (user_id = auth.uid());

drop policy if exists "alpha_state_select_member" on public.alpha_state;
create policy "alpha_state_select_member"
on public.alpha_state for select
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = alpha_state.workspace_id
      and wm.user_id = auth.uid()
  )
);

drop policy if exists "feedback_notes_select_member" on public.feedback_notes;
create policy "feedback_notes_select_member"
on public.feedback_notes for select
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = feedback_notes.workspace_id
      and wm.user_id = auth.uid()
  )
);

drop policy if exists "feedback_notes_insert_member" on public.feedback_notes;
create policy "feedback_notes_insert_member"
on public.feedback_notes for insert
with check (
  author_id = auth.uid()
  and exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = feedback_notes.workspace_id
      and wm.user_id = auth.uid()
  )
);

drop policy if exists "feedback_notes_update_author" on public.feedback_notes;
create policy "feedback_notes_update_author"
on public.feedback_notes for update
using (author_id = auth.uid())
with check (author_id = auth.uid());

drop policy if exists "audit_events_select_member" on public.audit_events;
create policy "audit_events_select_member"
on public.audit_events for select
using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = audit_events.workspace_id
      and wm.user_id = auth.uid()
  )
);
