import { createClient } from '@supabase/supabase-js';
import fallbackRaw from './fallback-todos.json';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://huwattmqwiqhcfhtqely.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_secret_21i-I_QCc5xA_dPeVQPKsg_iV7ZzjQm';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Subtask = {
  id: string;
  title: string;
  isCompleted: boolean;
};

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
  inPlayQueue: boolean;
  firstFiveMinutes?: string | null;
  subtasks: Subtask[];
  createdAt?: string;
};

export type Project = {
  id: string;
  name: string;
  slug: string;
  color: string;
  icon: string;
  goal: string;
  scheduleRule?: string;
  customActiveDays?: number[];
};

export const DEFAULT_PROJECTS: Project[] = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'General', slug: 'general', color: '#6366F1', icon: 'folder', goal: 'General workflows & todos' },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Turn90', slug: 'turn90', color: '#EF4444', icon: 'briefcase', goal: 'Turn90 re-entry operations' },
  { id: '33333333-3333-3333-3333-333333333333', name: '843FC', slug: '843fc', color: '#10B981', icon: 'trophy', goal: '843FC soccer club & tournaments' },
  { id: '44444444-4444-4444-4444-444444444444', name: 'Personal', slug: 'personal', color: '#8B5CF6', icon: 'user', goal: 'Personal life & health' },
  { id: '55555555-5555-5555-5555-555555555555', name: 'Nosa', slug: 'nosa', color: '#F59E0B', icon: 'sparkles', goal: 'Nosa product roadmap' },
  { id: '66666666-6666-6666-6666-666666666666', name: 'Book (Memoir) and Synapse', slug: 'book-memoir-and-synapse', color: '#3B82F6', icon: 'book', goal: 'Memoir writing & Synapse' }
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

export function serializeSubtasksIntoDescription(originalDesc: string | null | undefined, subtasks: Subtask[]): string {
  const base = originalDesc || '';
  const lines = base.split('\n').filter(l => !l.trim().startsWith('- [ ] ') && !l.trim().toLowerCase().startsWith('- [x] '));
  const subtaskLines = subtasks.map(s => `- [${s.isCompleted ? 'x' : ' '}] ${s.title}`);
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

export function matchTaskToProject(task: Task, projects: Project[]): Project {
  if (task.projectId) {
    const byId = projects.find((p) => p.id === task.projectId);
    if (byId) return byId;
  }

  const listName = (task.listName || '').toLowerCase().trim();
  for (const p of projects) {
    const pName = p.name.toLowerCase();
    const pSlug = p.slug.toLowerCase();
    if (
      listName === pName ||
      listName === pSlug ||
      listName.includes(pName) ||
      pName.includes(listName) ||
      (pSlug === '843fc' && listName.includes('843')) ||
      (pSlug === 'turn90' && (listName.includes('turn') || listName.includes('reentry'))) ||
      (pSlug === 'book-memoir-and-synapse' &&
        (listName.includes('book') || listName.includes('memoir') || listName.includes('synapse')))
    ) {
      return p;
    }
  }

  const general = projects.find((p) => p.slug === 'general' || p.name.toLowerCase() === 'general');
  return general || projects[0] || DEFAULT_PROJECTS[0];
}

export function getFallbackTasks(projects: Project[]): Task[] {
  return (fallbackRaw as any[]).map((item, idx) => {
    const id = item.appleReminderId || `fallback-${idx}`;
    const subtasks = extractSubtasks(item.notes);

    let estimatedMinutes = 5;
    const durMatch = (item.notes || '').match(/\[⏱\s*(\d+)m\]/);
    if (durMatch && durMatch[1]) {
      estimatedMinutes = parseInt(durMatch[1], 10);
    }

    const task: Task = {
      id,
      title: item.title,
      description: item.notes || '',
      listName: item.listName || 'Personal',
      status: 'pending',
      dueDate: item.dueDate || null,
      appleReminderId: item.appleReminderId || id,
      estimatedMinutes,
      inPlayQueue: false,
      subtasks,
      createdAt: new Date().toISOString(),
    };
    const matched = matchTaskToProject(task, projects);
    task.projectId = matched.id;
    return task;
  });
}
