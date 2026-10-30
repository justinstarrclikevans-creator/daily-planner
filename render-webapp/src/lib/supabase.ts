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
  priority: TaskPriority;
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
  keywords?: string[];
  instructions?: string;
  scheduleRule?: string;
  customActiveDays?: number[];
};

export const DEFAULT_PROJECTS: Project[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'General',
    slug: 'general',
    color: '#6366F1',
    icon: 'folder',
    goal: 'General workflows & inbox tasks',
    keywords: ['general', 'workflow', 'review', 'inbox', 'admin', 'daily'],
    instructions: 'General unclassified workflows, routine administrative tasks, and inbox items',
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Turn90',
    slug: 'turn90',
    color: '#EF4444',
    icon: 'briefcase',
    goal: 'Turn90 re-entry operations & case management',
    keywords: [
      'turn90',
      'turn 90',
      't90',
      'reentry',
      're-entry',
      'first shift',
      'case notes',
      'employer',
      'participant',
      'curriculum',
      'briefcase',
      'apricot',
      'matt',
      'amy',
      'tammy',
      'vr training',
      'columbia',
    ],
    instructions: 'Turn90 re-entry employment, participant casework, partner employers, and staff coordination',
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    name: '843FC',
    slug: '843fc',
    color: '#10B981',
    icon: 'trophy',
    goal: '843FC soccer club, leagues & tournaments',
    keywords: [
      '843',
      '843fc',
      'soccer',
      'football',
      'crowded',
      'fourth wall',
      'merch',
      'tournament',
      'rec',
      'drills',
      'kevin',
      'albertine',
      'coaching',
      'futsal',
      'uniforms',
    ],
    instructions: '843FC soccer training drills, youth tournaments, merchandise sales, and donor outreach',
  },
  {
    id: '44444444-4444-4444-4444-444444444444',
    name: 'Personal',
    slug: 'personal',
    color: '#8B5CF6',
    icon: 'user',
    goal: 'Personal health, life, and family',
    keywords: [
      'personal',
      'flea',
      'cats',
      'health',
      'dentist',
      'doctor',
      'family',
      'errand',
      'groceries',
      'yoga',
      'medication',
      'cardio',
      'workout',
      'home',
    ],
    instructions: 'Personal life, health appointments, routines, pet care, and domestic tasks',
  },
  {
    id: '55555555-5555-5555-5555-555555555555',
    name: 'Nosa',
    slug: 'nosa',
    color: '#F59E0B',
    icon: 'sparkles',
    goal: 'Nosa product development & roadmap',
    keywords: ['nosa', 'royvi', 'app feature', 'nigeria'],
    instructions: 'Nosa application features, design, testing, and deployment',
  },
  {
    id: '66666666-6666-6666-6666-666666666666',
    name: 'Book (Memoir) and Synapse',
    slug: 'book-memoir-and-synapse',
    color: '#3B82F6',
    icon: 'book',
    goal: 'Memoir writing & Synapse AI coaching engine',
    keywords: [
      'book',
      'memoir',
      'synapse',
      'cbt',
      'ai engine',
      'chapter',
      'writing',
      'interview skills',
      'sandler',
      'coaching app',
    ],
    instructions: 'Memoir manuscript, Synapse AI coaching engine development, and CBT training audio',
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

export function matchTaskToProject(task: { projectId?: string | null; listName?: string | null; title?: string; description?: string | null }, projects: Project[]): Project {
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

  // Check title & description against keywords
  const text = `${task.title || ''} ${task.description || ''}`.toLowerCase();
  for (const p of projects) {
    if (p.keywords && p.keywords.length > 0) {
      for (const kw of p.keywords) {
        if (text.includes(kw.toLowerCase())) {
          return p;
        }
      }
    }
  }

  const general = projects.find((p) => p.slug === 'general' || p.name.toLowerCase() === 'general');
  return general || projects[0] || DEFAULT_PROJECTS[0];
}

export function getFallbackTasks(projects: Project[]): Task[] {
  return (fallbackRaw as any[]).map((item, idx) => {
    const id = item.appleReminderId || `fallback-${idx}`;
    const subtasks = extractSubtasks(item.notes);

    let estimatedMinutes = 15;
    const durMatch = (item.notes || '').match(/\[⏱\s*(\d+)m\]/);
    if (durMatch && durMatch[1]) {
      estimatedMinutes = parseInt(durMatch[1], 10);
    }

    // Determine initial priority
    let priority: TaskPriority = 'medium';
    const notesLower = (item.notes || '').toLowerCase();
    const titleLower = (item.title || '').toLowerCase();
    if (notesLower.includes('[🔥 high]') || notesLower.includes('priority: high') || titleLower.includes('deadline') || titleLower.includes('open enrollment') || titleLower.includes('court') || titleLower.includes('urgent')) {
      priority = 'high';
    } else if (notesLower.includes('[🌱 low]') || notesLower.includes('priority: low')) {
      priority = 'low';
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
      priority,
      inPlayQueue: false,
      subtasks,
      createdAt: new Date().toISOString(),
    };
    const matched = matchTaskToProject(task, projects);
    task.projectId = matched.id;
    task.listName = matched.name;
    return task;
  });
}
