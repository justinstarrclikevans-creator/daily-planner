-- ==========================================================
-- Supabase Schema for ToDo & Project Companion (Idempotent)
-- Run this in your Supabase SQL Editor:
-- https://app.supabase.com/project/_/sql
-- ==========================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. Projects Table
create table if not exists public.projects (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text not null unique,
    color text not null default '#6366F1',
    icon text not null default 'folder',
    goal text default '',
    instructions text default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Ensure instructions column exists on existing installations
alter table public.projects add column if not exists instructions text default '';

-- 2. Ideas Table (Voice Brain Dumps & Concepts)
create table if not exists public.ideas (
    id uuid primary key default gen_random_uuid(),
    project_id uuid references public.projects(id) on delete cascade,
    raw_transcript text not null,
    summary text not null,
    tags text[] default '{}',
    created_at timestamptz not null default now()
);

-- 3. Tasks Table (Bidirectionally synced with Apple Reminders)
create table if not exists public.tasks (
    id uuid primary key default gen_random_uuid(),
    project_id uuid references public.projects(id) on delete set null,
    title text not null,
    description text default '',
    list_name text not null default 'Personal',
    status text not null default 'pending',
    due_date timestamptz,
    source text not null default 'ios',
    apple_reminder_id text,
    estimated_minutes integer default 15,
    actual_seconds integer default 0,
    in_play_queue boolean default false,
    subtasks jsonb default '[]'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Idempotent column upgrades for existing deployments
alter table public.tasks add column if not exists estimated_minutes integer default 15;
alter table public.tasks add column if not exists actual_seconds integer default 0;
alter table public.tasks add column if not exists in_play_queue boolean default false;
alter table public.tasks add column if not exists subtasks jsonb default '[]'::jsonb;
alter table public.tasks add column if not exists first_five_minutes text default null;

-- 4. Routines Table (Tiimo-Style Reusable Multi-Step Bundles)
create table if not exists public.routines (
    id uuid primary key default gen_random_uuid(),
    project_id uuid references public.projects(id) on delete set null,
    title text not null,
    description text default '',
    color text not null default '#6366F1',
    icon text not null default 'sparkles',
    items jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Indexes for performance
create index if not exists idx_tasks_project_id on public.tasks(project_id);
create index if not exists idx_tasks_status on public.tasks(status);
create index if not exists idx_tasks_list_name on public.tasks(list_name);
create index if not exists idx_ideas_project_id on public.ideas(project_id);
create index if not exists idx_routines_project_id on public.routines(project_id);

-- Safely Enable Realtime (ignores error if already added)
do $$
begin
    alter publication supabase_realtime add table public.projects;
exception when others then null;
end $$;

do $$
begin
    alter publication supabase_realtime add table public.ideas;
exception when others then null;
end $$;

do $$
begin
    alter publication supabase_realtime add table public.tasks;
exception when others then null;
end $$;

do $$
begin
    alter publication supabase_realtime add table public.routines;
exception when others then null;
end $$;

-- Enable Row Level Security (RLS)
alter table public.projects enable row level security;
alter table public.ideas enable row level security;
alter table public.tasks enable row level security;
alter table public.routines enable row level security;

-- Policies (Drop first to avoid "policy already exists" error)
drop policy if exists "Allow all operations for anon/authenticated" on public.projects;
create policy "Allow all operations for anon/authenticated" on public.projects
    for all using (true) with check (true);

drop policy if exists "Allow all operations for anon/authenticated" on public.ideas;
create policy "Allow all operations for anon/authenticated" on public.ideas
    for all using (true) with check (true);

drop policy if exists "Allow all operations for anon/authenticated" on public.tasks;
create policy "Allow all operations for anon/authenticated" on public.tasks
    for all using (true) with check (true);

drop policy if exists "Allow all operations for anon/authenticated" on public.routines;
create policy "Allow all operations for anon/authenticated" on public.routines
    for all using (true) with check (true);

-- Seed Default Projects
insert into public.projects (name, slug, color, icon, goal)
values 
    ('First Shift', 'first-shift', '#EF4444', 'briefcase.fill', 'Deliver top tier re-entry employment and participant case management.'),
    ('Albertine Initiative', 'albertine', '#3B82F6', 'video.fill', 'Community outreach and media initiatives in North Charleston.'),
    ('Football / 843', 'football-843', '#10B981', 'sportscourt.fill', 'Rec training, coaching drills, and local youth football leagues.'),
    ('Personal', 'personal', '#8B5CF6', 'person.fill', 'Personal life, health, appointments, and family errands.')
on conflict (slug) do nothing;

-- Seed Default Routines (Tiimo-Style)
insert into public.routines (title, description, color, icon, items)
values
    (
        'First Shift: Morning Intake & Casework Kickoff',
        'Review participant notes, complete Apricot updates, and check volunteer coach pairings.',
        '#EF4444',
        'briefcase.fill',
        '[
            {"title": "Review Antoine Turner intake notes & Google Meet log", "estimated_minutes": 10, "first_five_minutes": "Open the intake doc and read line 1."},
            {"title": "Fill out Apricot employment update form", "estimated_minutes": 15, "first_five_minutes": "Log into Apricot portal and find participant profile."},
            {"title": "Send PIC volunteer coaching check-in email", "estimated_minutes": 10, "first_five_minutes": "Open Gmail draft and type opening 2 sentences."}
        ]'::jsonb
    ),
    (
        'Football / 843: Practice & Drill Prep',
        'Ensure field permits, equipment, and drills are locked in before practice.',
        '#10B981',
        'sportscourt.fill',
        '[
            {"title": "Check field permit status & confirm practice slot", "estimated_minutes": 5, "first_five_minutes": "Check Parks & Rec confirmation email."},
            {"title": "Prep cones, footballs & coaching drill sheet", "estimated_minutes": 15, "first_five_minutes": "Grab gear bag from trunk and inspect inventory."},
            {"title": "Send parent/coach reminder text on group chat", "estimated_minutes": 5, "first_five_minutes": "Draft text with start time and field number."}
        ]'::jsonb
    ),
    (
        'Executive Daily Shutdown & Stale Purge',
        'Clear mental cache, sweep completed items, and set tomorrow up for zero friction.',
        '#6366F1',
        'moon.stars.fill',
        '[
            {"title": "Clear browser tabs & review scratch notes", "estimated_minutes": 5, "first_five_minutes": "Close finished tabs and save keepers to project notes."},
            {"title": "Review Play Queue and bump unstarted tasks to tomorrow", "estimated_minutes": 5, "first_five_minutes": "Open ToDo Companion and tap Bump to Tomorrow."},
            {"title": "Pin top 3 priority tasks for tomorrow morning", "estimated_minutes": 5, "first_five_minutes": "Tap +Queue on tomorrow morning’s primary focus."}
        ]'::jsonb
    ),
    (
        'Momentum Kickstart (Beat Executive Dysfunction)',
        'Three micro-sprints designed to destroy task paralysis in under 25 minutes.',
        '#F59E0B',
        'bolt.fill',
        '[
            {"title": "2-minute physical desk & environment reset", "estimated_minutes": 5, "first_five_minutes": "Pick up 3 stray items and throw away trash."},
            {"title": "5-minute triage of incoming Slack & Gmail", "estimated_minutes": 5, "first_five_minutes": "Scan subject lines without opening reply rabbit holes."},
            {"title": "15-minute deep focus sprint on #1 priority", "estimated_minutes": 15, "first_five_minutes": "Start the timer and work on line 1 for 60 seconds."}
        ]'::jsonb
    )
on conflict do nothing;

