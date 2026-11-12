import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_PROJECTS, Project } from '@/lib/supabase';
import { fetchProjectsFromSheet, saveProjectsToSheet } from '@/lib/sheets';

export const dynamic = 'force-dynamic';

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let inMemoryProjects: Project[] | null = null;

async function supabaseFetch(path: string, options: RequestInit = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const headers: Record<string, string> = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (e) {
    clearTimeout(timeoutId);
    return null;
  }
}

async function ensureProjectsLoaded(): Promise<Project[]> {
  if (!inMemoryProjects) {
    const res = await supabaseFetch('/projects?select=*&order=created_at.asc');
    if (res && res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        inMemoryProjects = data;
        return inMemoryProjects;
      }
    }
    const sheetProjects = await fetchProjectsFromSheet();
    if (sheetProjects.length > 0) {
      inMemoryProjects = sheetProjects;
      return inMemoryProjects;
    }
    inMemoryProjects = [...DEFAULT_PROJECTS];
  }
  return inMemoryProjects;
}

export async function GET() {
  try {
    const projects = await ensureProjectsLoaded();
    return NextResponse.json({ projects });
  } catch (e) {
    return NextResponse.json({ projects: inMemoryProjects || [...DEFAULT_PROJECTS] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const current = await ensureProjectsLoaded();

    const name = String(body.name || '').trim();
    if (!name) {
      return NextResponse.json({ error: 'Project name is required' }, { status: 400 });
    }

    const existing = current.find(
      (p) => p.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      return NextResponse.json({ success: true, project: existing });
    }

    const palette = ['#6366F1', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#3B82F6', '#EC4899', '#14B8A6'];
    const newProject: Project = {
      id: body.id || crypto.randomUUID(),
      name,
      slug: body.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      color: body.color || palette[current.length % palette.length],
      icon: body.icon || 'folder',
      goal: body.goal || '',
      keywords: body.keywords || [],
      instructions: body.instructions || '',
    };

    const next = [...current, newProject];
    inMemoryProjects = next;

    supabaseFetch('/projects', {
      method: 'POST',
      body: JSON.stringify({
        id: newProject.id,
        name: newProject.name,
        slug: newProject.slug,
        color: newProject.color,
        icon: newProject.icon,
        goal: newProject.goal,
        instructions: newProject.instructions,
      }),
    }).catch(() => null);

    await saveProjectsToSheet(next);

    return NextResponse.json({ success: true, project: newProject, projects: next });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, ...updates } = body;
    if (!id) return NextResponse.json({ error: 'Missing project id' }, { status: 400 });

    const current = await ensureProjectsLoaded();
    const idx = current.findIndex((p) => p.id === id);
    if (idx === -1) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const updatedProject: Project = {
      ...current[idx],
      ...(updates.name !== undefined ? {
        name: String(updates.name).trim() || current[idx].name,
        slug: String(updates.name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || current[idx].slug,
      } : {}),
      ...(updates.color !== undefined ? { color: updates.color } : {}),
      ...(updates.goal !== undefined ? { goal: updates.goal } : {}),
      ...(updates.instructions !== undefined ? { instructions: updates.instructions } : {}),
    };

    const next = [...current];
    next[idx] = updatedProject;
    inMemoryProjects = next;

    supabaseFetch(`/projects?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: updatedProject.name,
        slug: updatedProject.slug,
        color: updatedProject.color,
        goal: updatedProject.goal,
        instructions: updatedProject.instructions,
        updated_at: new Date().toISOString(),
      }),
    }).catch(() => null);

    await saveProjectsToSheet(next);

    return NextResponse.json({ success: true, project: updatedProject, projects: next });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing project id' }, { status: 400 });

    const current = await ensureProjectsLoaded();
    const target = current.find((p) => p.id === id);
    if (target && (target.slug === 'general' || target.name.toLowerCase() === 'general')) {
      return NextResponse.json({ error: 'Cannot delete General project' }, { status: 400 });
    }

    const next = current.filter((p) => p.id !== id);
    inMemoryProjects = next;

    supabaseFetch(`/projects?id=eq.${id}`, {
      method: 'DELETE',
    }).catch(() => null);

    await saveProjectsToSheet(next);

    return NextResponse.json({ success: true, projects: next });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
