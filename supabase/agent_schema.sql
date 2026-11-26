-- ==========================================================
-- AI CEO & Autonomous Agent Workforce Schema (Idempotent)
-- Run this in your Supabase SQL Editor:
-- https://app.supabase.com/project/_/sql
-- ==========================================================

-- 1. Agent Ventures (Links a Business Idea / Initiative to a Project)
create table if not exists public.agent_ventures (
    id uuid primary key default gen_random_uuid(),
    project_id uuid references public.projects(id) on delete set null,
    name text not null,
    slug text not null unique,
    idea_prompt text not null default '',
    target_audience text not null default '',
    icp_query text not null default '',
    stage text not null default 'planning',
    autopilot_enabled boolean not null default true,
    strategy_markdown text not null default '',
    rerun_webhook_url text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 2. Agent Jobs (Autonomous Queue + "Needs You" Approval Inbox)
create table if not exists public.agent_jobs (
    id uuid primary key default gen_random_uuid(),
    venture_id uuid references public.agent_ventures(id) on delete cascade,
    project_id uuid references public.projects(id) on delete set null,
    source_task_id uuid references public.tasks(id) on delete set null,
    agent_role text not null default 'ceo',
    job_type text not null default 'plan_venture',
    title text not null,
    prompt text not null default '',
    status text not null default 'queued',
    output_markdown text not null default '',
    output_payload jsonb not null default '{}'::jsonb,
    revision_feedback text not null default '',
    execution_result jsonb not null default '{}'::jsonb,
    execution_error text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    executed_at timestamptz
);

-- 3. Agent Settings (Rerun Coworkers, Auto-Send Preferences & Daemon Capabilities)
create table if not exists public.agent_settings (
    id text primary key default 'default',
    default_rerun_webhook_url text not null default '',
    rerun_coworkers jsonb not null default '[]'::jsonb,
    default_from_email text not null default '',
    auto_send_on_approve boolean not null default true,
    daemon_heartbeat_at timestamptz,
    daemon_capabilities jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

-- Indexes for Agent Queue & Venture lookups
create index if not exists idx_agent_jobs_status on public.agent_jobs(status);
create index if not exists idx_agent_jobs_venture_id on public.agent_jobs(venture_id);
create index if not exists idx_agent_jobs_created_at on public.agent_jobs(created_at desc);
create index if not exists idx_agent_ventures_project_id on public.agent_ventures(project_id);

-- Safely Enable Realtime
do $$
begin
    alter publication supabase_realtime add table public.agent_ventures;
exception when others then null;
end $$;

do $$
begin
    alter publication supabase_realtime add table public.agent_jobs;
exception when others then null;
end $$;

do $$
begin
    alter publication supabase_realtime add table public.agent_settings;
exception when others then null;
end $$;

-- Enable Row Level Security (RLS)
alter table public.agent_ventures enable row level security;
alter table public.agent_jobs enable row level security;
alter table public.agent_settings enable row level security;

-- Permissive Policies matching existing ToDo Webapp tables
drop policy if exists "Allow all operations for anon/authenticated" on public.agent_ventures;
create policy "Allow all operations for anon/authenticated" on public.agent_ventures
    for all using (true) with check (true);

drop policy if exists "Allow all operations for anon/authenticated" on public.agent_jobs;
create policy "Allow all operations for anon/authenticated" on public.agent_jobs
    for all using (true) with check (true);

drop policy if exists "Allow all operations for anon/authenticated" on public.agent_settings;
create policy "Allow all operations for anon/authenticated" on public.agent_settings
    for all using (true) with check (true);

-- Seed Default Agent Settings
insert into public.agent_settings (id)
values ('default')
on conflict (id) do nothing;
