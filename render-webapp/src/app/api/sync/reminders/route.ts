import { NextRequest, NextResponse } from 'next/server';
import {
  cleanTaskTitle,
  extractHashtags,
  extractSubtasks,
  Task,
  TaskPriority,
  CalendarTimelineEvent,
  DEFAULT_PROJECTS,
} from '@/lib/supabase';
import { updateInMemoryDeskTasks, updateInMemoryCalendarEvents } from '@/app/api/desk/route';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const reminders = body.reminders || body.tasks || [];
    const events = body.events || body.calendarEvents || [];

    if (!Array.isArray(reminders)) {
      return NextResponse.json({ error: 'Expected reminders array' }, { status: 400 });
    }

    const formattedTasks: Task[] = reminders
      .filter((r: any) => !(r.description || r.notes || '').includes('[Calendar Event]'))
      .map((r: any, idx: number) => {
        const desc = r.description || r.notes || '';
        let subs = r.subtasks;
        if (!subs || !Array.isArray(subs) || subs.length === 0) {
          subs = extractSubtasks(desc);
        }

        let prio: TaskPriority = 'medium';
        if (r.priority === 'high' || r.priority === 'low') {
          prio = r.priority;
        } else if (desc.toLowerCase().includes('[🔥 high]')) {
          prio = 'high';
        } else if (desc.toLowerCase().includes('[🌱 low]')) {
          prio = 'low';
        }

        let estMins = r.estimatedMinutes || r.estimated_minutes || 15;
        const durMatch = desc.match(/\[⏱\s*(\d+)m\]/);
        if (durMatch && durMatch[1]) {
          estMins = parseInt(durMatch[1], 10);
        }

        const extractedTags = Array.from(
          new Set([
            ...(Array.isArray(r.tags) ? r.tags : []),
            ...extractHashtags(r.title),
            ...extractHashtags(desc),
          ])
        );

        return {
          id: r.id || r.appleReminderId || `reminder-${idx}`,
          projectId: r.projectId || null,
          title: cleanTaskTitle(r.title),
          description: desc,
          listName: r.listName || 'General',
          status: (r.status === 'completed' || r.isCompleted) ? 'completed' : 'pending',
          dueDate: r.dueDate || null,
          source: 'apple_reminders',
          appleReminderId: r.id || r.appleReminderId,
          estimatedMinutes: estMins,
          actualSeconds: r.actualSeconds || 0,
          priority: prio,
          inPlayQueue: Boolean(r.inPlayQueue),
          subtasks: subs,
          tags: extractedTags,
          createdAt: r.createdAt || new Date().toISOString(),
          completedAt: r.completedAt || null,
        };
      });

    const activeOnly = formattedTasks.filter((t) => t.status !== 'completed');
    updateInMemoryDeskTasks(activeOnly);

    if (Array.isArray(events) && events.length > 0) {
      const formattedEvents: CalendarTimelineEvent[] = events
        .filter((ev: any) => ev && ev.title && ev.start)
        .map((ev: any, idx: number) => ({
          id: ev.id || `cal-${idx}`,
          title: ev.title || ev.summary || 'Calendar Event',
          start: ev.start,
          end: ev.end,
          durationMinutes: ev.durationMinutes || 30,
          location: ev.location || '',
          calendarName: ev.calendarName || 'Calendar',
        }));
      updateInMemoryCalendarEvents(formattedEvents);
    }

    return NextResponse.json({
      success: true,
      tasksCount: activeOnly.length,
      eventsCount: events.length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
