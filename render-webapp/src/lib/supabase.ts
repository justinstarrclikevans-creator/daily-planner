import { createClient } from '@supabase/supabase-js';
import fallbackRaw from './fallback-todos.json';
import fallbackCalendarRaw from './fallback-calendar.json';
import taggingRules from './tagging-rules.json';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://irlqhowgimaxmnpiocmp.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_jpHLDOeJ9TqWdA-esBVqyA_v3u9C7Ay';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Subtask = {
  id: string;
  title: string;
  isCompleted: boolean;
};

export type TaskPriority = 'high' | 'medium' | 'low';

export type Task = {
  id: string;
  projectId?: string | null;
  title: string;
  description?: string | null;
  listName: string;
  status: 'pending' | 'completed';
  dueDate?: string | null;
  source?: string;
  appleReminderId?: string | null;
  estimatedMinutes: number;
  actualSeconds?: number;
  priority: TaskPriority;
  inPlayQueue: boolean;
  firstFiveMinutes?: string | null;
  subtasks: Subtask[];
  tags?: string[];
  createdAt?: string;
  completedAt?: string | null;
};

export type Project = {
  id: string;
  name: string;
  slug: string;
  color: string;
  icon: string;
  goal: string;
  keywords?: string[];
  instructions?: string;
  scheduleRule?: string;
  customActiveDays?: number[];
};

export type SunsamaChannel = {
  tag: string;
  label: string;
  color: string;
  isCustom?: boolean;
};

export const CHANNEL_COLORS = [
  '#6366F1', // indigo
  '#EF4444', // red
  '#10B981', // emerald
  '#F59E0B', // amber
  '#8B5CF6', // violet
  '#3B82F6', // blue
  '#EC4899', // pink
  '#14B8A6', // teal
  '#F97316', // orange
  '#06B6D4', // cyan
];

export const SUNSAMA_CHANNELS: SunsamaChannel[] = [
  { tag: 'general', label: 'general', color: '#64748B' },
  ...taggingRules.projects.map((p, idx) => ({
    tag: p.tag.toLowerCase(),
    label: p.label,
    color: CHANNEL_COLORS[idx % CHANNEL_COLORS.length],
  })),
];

export const DEFAULT_PROJECTS: Project[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'General',
    slug: 'general',
    color: '#6366F1',
    icon: 'folder',
    goal: 'General workflows & inbox tasks',
    keywords: ['general', 'workflow', 'review', 'inbox', 'admin', 'daily'],
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Turn90',
    slug: 'turn90',
    color: '#EF4444',
    icon: 'briefcase',
    goal: 'Turn90 re-entry operations & case management',
    keywords: ['turn90', 'turn 90', 't90', 'reentry', 'first shift', 'apricot', 'skillcat'],
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    name: '843FC',
    slug: '843fc',
    color: '#10B981',
    icon: 'trophy',
    goal: '843FC soccer club, leagues & tournaments',
    keywords: ['843', '843fc', 'soccer', 'football', 'futsal'],
  },
  {
    id: '44444444-4444-4444-4444-444444444444',
    name: 'Personal',
    slug: 'personal',
    color: '#8B5CF6',
    icon: 'user',
    goal: 'Personal health, life, and family',
    keywords: ['personal', 'cats', 'health', 'family', 'home'],
  },
  {
    id: '55555555-5555-5555-5555-555555555555',
    name: 'Nosa',
    slug: 'nosa',
    color: '#F59E0B',
    icon: 'sparkles',
    goal: 'Nosa product development & roadmap',
    keywords: ['nosa', 'royvi', 'claire'],
  },
  {
    id: '66666666-6666-6666-6666-666666666666',
    name: 'Book (Memoir) and Synapse',
    slug: 'book-memoir-and-synapse',
    color: '#3B82F6',
    icon: 'book',
    goal: 'Memoir writing & Synapse AI coaching engine',
    keywords: ['book', 'memoir', 'synapse'],
  },
];

export function extractSubtasks(description?: string | null): Subtask[] {
  if (!description) return [];
  const lines = description.split('\n');
  const items: Subtask[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- [ ] ')) {
      items.push({ id: crypto.randomUUID(), title: trimmed.substring(6).trim(), isCompleted: false });
    } else if (trimmed.toLowerCase().startsWith('- [x] ')) {
      items.push({ id: crypto.randomUUID(), title: trimmed.substring(6).trim(), isCompleted: true });
    }
  }
  return items;
}

export function extractHashtags(text?: string | null): string[] {
  if (!text) return [];
  const matches = text.match(/#([a-zA-Z0-9_\-]+)/g) || [];
  return Array.from(new Set(matches.map((m) => m.substring(1).toLowerCase())));
}

export function cleanTaskTitle(title: string): string {
  return (title || '')
    .replace(/!+/g, '')
    .replace(/\s*#[a-zA-Z0-9_\-]+/g, '')
    .replace(/\[⏱\s*\d+m\]/g, '')
    .trim() || title;
}

export type CalendarTimelineEvent = {
  id: string;
  title: string;
  start: string;
  end?: string;
  durationMinutes: number;
  location?: string;
  calendarName?: string;
};

export function getChannelForTask(
  task: Task,
  channels: SunsamaChannel[] = SUNSAMA_CHANNELS
): SunsamaChannel {
  const tags = [
    ...(task.tags || []),
    ...extractHashtags(task.title),
    ...extractHashtags(task.description),
  ].map((t) => t.toLowerCase());

  for (const ch of channels) {
    if (ch.tag !== 'general' && tags.includes(ch.tag)) {
      return ch;
    }
  }

  const general = channels.find((c) => c.tag === 'general');
  return general || channels[0] || SUNSAMA_CHANNELS[0];
}

export function buildTaskDescription(params: {
  cleanNotes?: string;
  estimatedMinutes?: number;
  inPlayQueue?: boolean;
  subtasks?: Subtask[];
  tags?: string[];
}): string {
  const headerTokens: string[] = [];
  if (params.estimatedMinutes && params.estimatedMinutes > 0) {
    headerTokens.push(`[⏱ ${params.estimatedMinutes}m]`);
  }
  if (params.inPlayQueue) {
    headerTokens.push('[▶️ Queue]');
  }
  if (params.tags && params.tags.length > 0) {
    for (const raw of params.tags) {
      const clean = raw.replace(/^#/, '').trim().toLowerCase();
      if (clean) headerTokens.push(`#${clean}`);
    }
  }

  const lines: string[] = [];
  if (headerTokens.length > 0) {
    lines.push(headerTokens.join(' '));
  }
  if (params.cleanNotes && params.cleanNotes.trim()) {
    lines.push(params.cleanNotes.trim());
  }
  if (params.subtasks && params.subtasks.length > 0) {
    for (const s of params.subtasks) {
      lines.push(`- [${s.isCompleted ? 'x' : ' '}] ${s.title}`);
    }
  }
  return lines.join('\n').trim();
}

export function extractCleanNotes(description?: string | null): string {
  if (!description) return '';
  const lines = description
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (t.startsWith('- [ ] ') || t.toLowerCase().startsWith('- [x] ')) return false;
      if (t.startsWith('⚡ First 5 Minutes:')) return false;
      return true;
    })
    .map((line) =>
      line
        .replace(/\[⏱\s*\d+m\]/g, '')
        .replace(/\[▶️\s*Queue\]/g, '')
        .replace(/#[a-zA-Z0-9_\-]+/g, '')
        .trim()
    )
    .filter(Boolean);
  return lines.join('\n').trim();
}

export function serializeSubtasksIntoDescription(originalDesc: string | null | undefined, subtasks: Subtask[]): string {
  const base = originalDesc || '';
  const lines = base.split('\n').filter((l) => !l.trim().startsWith('- [ ] ') && !l.trim().toLowerCase().startsWith('- [x] '));
  const subtaskLines = subtasks.map((s) => `- [${s.isCompleted ? 'x' : ' '}] ${s.title}`);
  return [...lines, ...subtaskLines].join('\n').trim();
}

export function isTaskScheduledForFuture(dueDate?: string | null): boolean {
  if (!dueDate) return false;
  const due = new Date(dueDate);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDueDate = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  return startOfDueDate > startOfToday;
}

export function matchTaskToProject(
  task: { projectId?: string | null; listName?: string | null; title?: string; description?: string | null },
  projects: Project[]
): Project {
  if (task.projectId) {
    const byId = projects.find((p) => p.id === task.projectId);
    if (byId) return byId;
  }
  const general = projects.find((p) => p.slug === 'general' || p.name.toLowerCase() === 'general');
  return general || projects[0] || DEFAULT_PROJECTS[0];
}

export function getFallbackCalendarEvents(): CalendarTimelineEvent[] {
  return (fallbackCalendarRaw as any[]).map((ev, idx) => ({
    id: ev.id || `cal-${idx}`,
    title: ev.title || ev.summary || 'Calendar Event',
    start: ev.start,
    end: ev.end,
    durationMinutes: ev.durationMinutes || 30,
    location: ev.location || '',
    calendarName: ev.calendarName || 'Calendar',
  }));
}

export function getFallbackTasks(projects: Project[]): Task[] {
  return (fallbackRaw as any[])
    .filter((item) => !(item.notes || '').includes('[Calendar Event]'))
    .map((item, idx) => {
      const id = item.appleReminderId || `fallback-${idx}`;
      const subtasks = extractSubtasks(item.notes);

      let estimatedMinutes = 15;
      const durMatch = (item.notes || '').match(/\[⏱\s*(\d+)m\]/);
      if (durMatch && durMatch[1]) {
        estimatedMinutes = parseInt(durMatch[1], 10);
      }

      let priority: TaskPriority = 'medium';
      const notesLower = (item.notes || '').toLowerCase();
      if (notesLower.includes('[🔥 high]') || notesLower.includes('priority: high')) {
        priority = 'high';
      } else if (notesLower.includes('[🌱 low]') || notesLower.includes('priority: low')) {
        priority = 'low';
      }

      const fullText = `${item.title || ''} ${item.notes || ''}`;
      const extractedTags = extractHashtags(fullText);
      const inPlayQueue = (item.notes || '').includes('[▶️ Queue]');

      const task: Task = {
        id,
        projectId: null,
        title: cleanTaskTitle(item.title),
        description: item.notes || '',
        listName: 'General',
        status: 'pending',
        dueDate: item.dueDate || null,
        appleReminderId: item.appleReminderId || id,
        estimatedMinutes,
        priority,
        inPlayQueue,
        subtasks,
        tags: extractedTags,
        createdAt: new Date().toISOString(),
      };
      return task;
    });
}
