import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_PROJECTS, getFallbackTasks, extractSubtasks } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://huwattmqwiqhcfhtqely.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_secret_21i-I_QCc5xA_dPeVQPKsg_iV7ZzjQm';

async function supabaseFetch(path: string, options: RequestInit = {}) {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  return fetch(url, { ...options, headers });
}

export async function GET() {
  try {
    const [projRes, taskRes] = await Promise.all([
      supabaseFetch('/projects?select=*&order=name.asc'),
      supabaseFetch('/tasks?select=*&order=created_at.desc'),
    ]);

    let projects = DEFAULT_PROJECTS;
    if (projRes.ok) {
      const data = await projRes.json();
      if (Array.isArray(data) && data.length > 0) {
        projects = data;
      }
    }

    let tasks: any[] = [];
    if (taskRes.ok) {
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

    // If Supabase returned zero tasks, use the fallback tasks
    if (tasks.length === 0) {
      tasks = getFallbackTasks(projects);
      return NextResponse.json({ projects, tasks, source: 'fallback' });
    }

    return NextResponse.json({ projects, tasks, source: 'supabase' });
  } catch (error: any) {
    console.error('Error in /api/desk GET:', error);
    const fallbackTasks = getFallbackTasks(DEFAULT_PROJECTS);
    return NextResponse.json({
      projects: DEFAULT_PROJECTS,
      tasks: fallbackTasks,
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

    const res = await supabaseFetch(`/tasks?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: errText }, { status: res.status });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await supabaseFetch('/tasks', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: errText }, { status: res.status });
    }

    return NextResponse.json({ success: true, task: body });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
