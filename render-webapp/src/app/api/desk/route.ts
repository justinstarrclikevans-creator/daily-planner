import { NextRequest, NextResponse } from 'next/server';
import {
  DEFAULT_PROJECTS,
  getFallbackTasks,
  getFallbackCalendarEvents,
  extractSubtasks,
  extractHashtags,
  cleanTaskTitle,
  Task,
  TaskPriority,
} from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://huwattmqwiqhcfhtqely.supabase.co';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'sb_secret_21i-I_QCc5xA_dPeVQPKsg_iV7ZzjQm';

let inMemoryTasks: Task[] | null = null;
let inMemoryProjects: any[] | null = null;

async function supabaseFetch(path: string, options: RequestInit = {}) {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);
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
      supabaseFetch('/tasks?select=*&order=created_at.desc&limit=500'),
    ]);

    let projects = inMemoryProjects || DEFAULT_PROJECTS;
    if (projRes && projRes.ok) {
      const data = await projRes.json();
      if (Array.isArray(data) && data.length > 0) {
        projects = data;
        inMemoryProjects = projects;
      }
    }

    const calendarEvents = getFallbackCalendarEvents();

    let tasks: Task[] = [];
    if (taskRes && taskRes.ok) {
      const data = await taskRes.json();
      if (Array.isArray(data) && data.length > 0) {
        tasks = data
          .filter((row: any) => !(row.description || '').includes('[Calendar Event]'))
          .map((row: any) => {
            let subs = row.subtasks;
            if (!subs || !Array.isArray(subs) || subs.length === 0) {
              subs = extractSubtasks(row.description);
            }
            let prio: TaskPriority = 'medium';
            if (row.priority === 'high' || row.priority === 'low') {
              prio = row.priority;
            } else if ((row.description || '').toLowerCase().includes('[🔥 high]')) {
              prio = 'high';
            } else if ((row.description || '').toLowerCase().includes('[🌱 low]')) {
              prio = 'low';
            }

            let estMins = row.estimated_minutes || 15;
            const durMatch = (row.description || '').match(/\[⏱\s*(\d+)m\]/);
            if (durMatch && durMatch[1]) {
              estMins = parseInt(durMatch[1], 10);
            }

            const extractedTags = Array.from(
              new Set([
                ...(Array.isArray(row.tags) ? row.tags : []),
                ...extractHashtags(row.title),
                ...extractHashtags(row.description),
              ])
            );

            const inQueue =
              Boolean(row.in_play_queue) || (row.description || '').includes('[▶️ Queue]');

            return {
              id: row.id,
              projectId: null,
              title: cleanTaskTitle(row.title),
              description: row.description || '',
              listName: 'General',
              status: row.status === 'completed' ? 'completed' : 'pending',
              dueDate: row.due_date || null,
              source: row.source || 'daemon',
              appleReminderId: row.apple_reminder_id,
              estimatedMinutes: estMins,
              actualSeconds: row.actual_seconds || 0,
              priority: prio,
              inPlayQueue: inQueue,
              subtasks: subs,
              tags: extractedTags,
              createdAt: row.created_at,
              completedAt: row.updated_at || null,
            };
          });
        inMemoryTasks = tasks;
      }
    }

    if (tasks.length === 0) {
      if (!inMemoryTasks) {
        inMemoryTasks = getFallbackTasks(projects);
      }
      return NextResponse.json({
        projects,
        tasks: inMemoryTasks,
        calendarEvents,
        source: 'fallback',
      });
    }

    return NextResponse.json({ projects, tasks, calendarEvents, source: 'supabase' });
  } catch (error: any) {
    console.error('Error in /api/desk GET:', error);
    if (!inMemoryTasks) {
      inMemoryTasks = getFallbackTasks(inMemoryProjects || DEFAULT_PROJECTS);
    }
    return NextResponse.json({
      projects: inMemoryProjects || DEFAULT_PROJECTS,
      tasks: inMemoryTasks,
      calendarEvents: getFallbackCalendarEvents(),
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

    const dbPayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (updates.title !== undefined) dbPayload.title = cleanTaskTitle(updates.title);
    if (updates.description !== undefined) dbPayload.description = updates.description;
    if (updates.status !== undefined) dbPayload.status = updates.status;
    if (updates.due_date !== undefined) dbPayload.due_date = updates.due_date;
    if (updates.dueDate !== undefined) dbPayload.due_date = updates.dueDate;
    if (updates.in_play_queue !== undefined) dbPayload.in_play_queue = updates.in_play_queue;
    if (updates.inPlayQueue !== undefined) dbPayload.in_play_queue = updates.inPlayQueue;
    if (updates.estimated_minutes !== undefined) dbPayload.estimated_minutes = updates.estimated_minutes;
    if (updates.estimatedMinutes !== undefined) dbPayload.estimated_minutes = updates.estimatedMinutes;
    if (updates.priority !== undefined) dbPayload.priority = updates.priority;
    if (updates.subtasks !== undefined) dbPayload.subtasks = updates.subtasks;
    if (updates.list_name !== undefined) dbPayload.list_name = updates.list_name;
    if (updates.actual_seconds !== undefined) dbPayload.actual_seconds = updates.actual_seconds;

    supabaseFetch(`/tasks?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(dbPayload),
    }).catch(() => null);

    if (!inMemoryTasks) {
      inMemoryTasks = getFallbackTasks(inMemoryProjects || DEFAULT_PROJECTS);
    }
    const idx = inMemoryTasks.findIndex((t) => t.id === id);
    if (idx !== -1) {
      const current = inMemoryTasks[idx];
      const nextDesc = updates.description !== undefined ? updates.description : current.description;
      const nextTags =
        updates.tags !== undefined
          ? updates.tags
          : Array.from(
              new Set([
                ...(current.tags || []),
                ...extractHashtags(nextDesc),
              ])
            );

      inMemoryTasks[idx] = {
        ...current,
        title: updates.title !== undefined ? cleanTaskTitle(updates.title) : current.title,
        description: nextDesc,
        status: updates.status !== undefined ? updates.status : current.status,
        dueDate:
          updates.due_date !== undefined
            ? updates.due_date
            : updates.dueDate !== undefined
            ? updates.dueDate
            : current.dueDate,
        inPlayQueue:
          updates.in_play_queue !== undefined
            ? updates.in_play_queue
            : updates.inPlayQueue !== undefined
            ? updates.inPlayQueue
            : current.inPlayQueue,
        estimatedMinutes:
          updates.estimated_minutes !== undefined
            ? updates.estimated_minutes
            : updates.estimatedMinutes !== undefined
            ? updates.estimatedMinutes
            : current.estimatedMinutes,
        priority: updates.priority !== undefined ? updates.priority : current.priority,
        subtasks: updates.subtasks !== undefined ? updates.subtasks : current.subtasks,
        tags: nextTags,
        actualSeconds:
          updates.actual_seconds !== undefined ? updates.actual_seconds : current.actualSeconds,
      };
    }

    return NextResponse.json({ success: true, task: idx !== -1 ? inMemoryTasks[idx] : null });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!inMemoryProjects) {
      inMemoryProjects = DEFAULT_PROJECTS;
    }

    const cleanedTitle = cleanTaskTitle(body.title || '');
    const tags = Array.isArray(body.tags)
      ? body.tags
      : extractHashtags(`${body.title || ''} ${body.description || ''}`);

    const newTask: Task = {
      id: body.id || crypto.randomUUID(),
      projectId: body.project_id || DEFAULT_PROJECTS[0].id,
      title: cleanedTitle,
      description: body.description || '',
      listName: 'General',
      status: body.status || 'pending',
      dueDate: body.due_date !== undefined ? body.due_date : null,
      estimatedMinutes: body.estimated_minutes || body.estimatedMinutes || 15,
      actualSeconds: 0,
      priority: body.priority || 'medium',
      inPlayQueue: Boolean(body.in_play_queue),
      subtasks: body.subtasks || extractSubtasks(body.description),
      tags,
      createdAt: new Date().toISOString(),
    };

    supabaseFetch('/tasks', {
      method: 'POST',
      body: JSON.stringify({
        id: newTask.id,
        project_id: newTask.projectId,
        title: newTask.title,
        description: newTask.description,
        list_name: 'General',
        status: newTask.status,
        due_date: newTask.dueDate,
        estimated_minutes: newTask.estimatedMinutes,
        priority: newTask.priority,
        in_play_queue: newTask.inPlayQueue,
        subtasks: newTask.subtasks,
        created_at: newTask.createdAt,
      }),
    }).catch(() => null);

    if (!inMemoryTasks) {
      inMemoryTasks = getFallbackTasks(inMemoryProjects);
    }
    inMemoryTasks.unshift(newTask);

    return NextResponse.json({ success: true, task: newTask });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    supabaseFetch(`/tasks?id=eq.${id}`, {
      method: 'DELETE',
    }).catch(() => null);

    if (inMemoryTasks) {
      inMemoryTasks = inMemoryTasks.filter((t) => t.id !== id);
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
