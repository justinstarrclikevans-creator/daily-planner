import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_PROJECTS, getFallbackTasks, extractSubtasks, matchTaskToProject } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://huwattmqwiqhcfhtqely.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_secret_21i-I_QCc5xA_dPeVQPKsg_iV7ZzjQm';

let inMemoryTasks: any[] | null = null;

async function supabaseFetch(path: string, options: RequestInit = {}) {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
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

export async function GET() {
  try {
    const [projRes, taskRes] = await Promise.all([
      supabaseFetch('/projects?select=*&order=name.asc'),
      supabaseFetch('/tasks?select=*&order=created_at.desc'),
    ]);

    let projects = DEFAULT_PROJECTS;
    if (projRes && projRes.ok) {
      const data = await projRes.json();
      if (Array.isArray(data) && data.length > 0) {
        projects = data;
      }
    }

    let tasks: any[] = [];
    if (taskRes && taskRes.ok) {
      const data = await taskRes.json();
      if (Array.isArray(data) && data.length > 0) {
        tasks = data
          .filter((t: any) => t.status !== 'completed')
          .map((row: any) => {
            let subs = row.subtasks;
            if (!subs || !Array.isArray(subs) || subs.length === 0) {
              subs = extractSubtasks(row.description);
            }
            return {
              id: row.id,
              projectId: row.project_id,
              title: row.title,
              description: row.description,
              listName: row.list_name || 'Personal',
              status: row.status || 'pending',
              dueDate: row.due_date,
              source: row.source,
              appleReminderId: row.apple_reminder_id,
              estimatedMinutes: row.estimated_minutes || 5,
              inPlayQueue: row.in_play_queue || false,
              firstFiveMinutes: row.first_five_minutes,
              subtasks: subs,
              createdAt: row.created_at,
            };
          });
      }
    }

    // Fallback if Supabase is offline or empty
    if (tasks.length === 0) {
      if (!inMemoryTasks) {
        inMemoryTasks = getFallbackTasks(projects);
      }
      const activeOnly = inMemoryTasks.filter((t: any) => t.status !== 'completed');
      return NextResponse.json({ projects, tasks: activeOnly, source: 'fallback' });
    }

    return NextResponse.json({ projects, tasks, source: 'supabase' });
  } catch (error: any) {
    console.error('Error in /api/desk GET:', error);
    if (!inMemoryTasks) {
      inMemoryTasks = getFallbackTasks(DEFAULT_PROJECTS);
    }
    const activeOnly = inMemoryTasks.filter((t: any) => t.status !== 'completed');
    return NextResponse.json({
      projects: DEFAULT_PROJECTS,
      tasks: activeOnly,
      source: 'fallback_error',
      error: error.message,
    });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, ...updates } = body;
    if (!id) {
      return NextResponse.json({ error: 'Missing task id' }, { status: 400 });
    }

    // Attempt Supabase update in background
    supabaseFetch(`/tasks?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }).catch(() => null);

    // Update in-memory tasks so completions/deferrals take effect immediately
    if (!inMemoryTasks) {
      inMemoryTasks = getFallbackTasks(DEFAULT_PROJECTS);
    }
    const idx = inMemoryTasks.findIndex((t: any) => t.id === id);
    if (idx !== -1) {
      inMemoryTasks[idx] = {
        ...inMemoryTasks[idx],
        ...updates,
        status: updates.status || inMemoryTasks[idx].status,
        dueDate: updates.due_date !== undefined ? updates.due_date : inMemoryTasks[idx].dueDate,
      };
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Attempt Supabase insert in background
    supabaseFetch('/tasks', {
      method: 'POST',
      body: JSON.stringify(body),
    }).catch(() => null);

    if (!inMemoryTasks) {
      inMemoryTasks = getFallbackTasks(DEFAULT_PROJECTS);
    }

    const newTask = {
      id: body.id || crypto.randomUUID(),
      title: body.title,
      description: body.description || '',
      listName: body.list_name || 'Personal',
      status: body.status || 'pending',
      dueDate: body.due_date || null,
      estimatedMinutes: body.estimated_minutes || 5,
      inPlayQueue: false,
      firstFiveMinutes: body.first_five_minutes || null,
      subtasks: body.subtasks || extractSubtasks(body.description),
      createdAt: new Date().toISOString(),
    };
    const matched = matchTaskToProject(newTask, DEFAULT_PROJECTS);
    (newTask as any).projectId = body.project_id || matched.id;
    inMemoryTasks.unshift(newTask);

    return NextResponse.json({ success: true, task: newTask });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
