-- ==========================================================
-- Supabase Schema for ToDo & Project Companion
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
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

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
    status text not null default 'pending', -- 'pending', 'completed'
    due_date timestamptz,
    source text not null default 'ios', -- 'ios', 'gmail', 'slack', 'imessage'
    apple_reminder_id text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Indexes for performance
create index if not exists idx_tasks_project_id on public.tasks(project_id);
create index if not exists idx_tasks_status on public.tasks(status);
create index if not exists idx_tasks_list_name on public.tasks(list_name);
create index if not exists idx_ideas_project_id on public.ideas(project_id);

-- Enable Realtime for live updates on iPhone & Mac
alter publication supabase_realtime add table public.projects;
alter publication supabase_realtime add table public.ideas;
alter publication supabase_realtime add table public.tasks;

-- Enable Row Level Security (RLS)
alter table public.projects enable row level security;
alter table public.ideas enable row level security;
alter table public.tasks enable row level security;

-- For personal single-user app: allow authenticated & anon users with your project API key
create policy "Allow all operations for anon/authenticated" on public.projects
    for all using (true) with check (true);

create policy "Allow all operations for anon/authenticated" on public.ideas
    for all using (true) with check (true);

create policy "Allow all operations for anon/authenticated" on public.tasks
    for all using (true) with check (true);

-- Seed Default Projects
insert into public.projects (name, slug, color, icon, goal)
values 
    ('First Shift', 'first-shift', '#EF4444', 'briefcase.fill', 'Deliver top tier re-entry employment and participant case management.'),
    ('Albertine Initiative', 'albertine', '#3B82F6', 'video.fill', 'Community outreach and media initiatives in North Charleston.'),
    ('Football / 843', 'football-843', '#10B981', 'sportscourt.fill', 'Rec training, coaching drills, and local youth football leagues.'),
    ('Personal', 'personal', '#8B5CF6', 'person.fill', 'Personal life, health, appointments, and family errands.')
on conflict (slug) do nothing;
