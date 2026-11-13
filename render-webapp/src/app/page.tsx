'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  supabase,
  Task,
  Project,
  Note,
  Subtask,
  TaskPriority,
  CalendarTimelineEvent,
  DEFAULT_PROJECTS,
  buildTaskDescription,
  extractCleanNotes,
  cleanTaskTitle,
} from '@/lib/supabase';
import NotesWorkspace from '@/components/NotesWorkspace';
import {
  Check,
  Plus,
  Calendar as CalendarIcon,
  Folder,
  Sparkles,
  Play,
  Pause,
  RotateCcw,
  Clock,
  Trash2,
  X,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  Pencil,
  Undo2,
  FileText,
  Wand2,
  Menu,
} from 'lucide-react';

type ActiveModal = 'none' | 'transcript_plan' | 'focus_mode';

const DURATION_OPTIONS = [5, 10, 15, 20, 25, 30, 45, 60, 90, 120];
const TIMELINE_START_HOUR = 6; // 6:00 AM
const TIMELINE_END_HOUR = 21; // 9:00 PM
const TIMELINE_HOURS = Array.from(
  { length: TIMELINE_END_HOUR - TIMELINE_START_HOUR + 1 },
  (_, i) => TIMELINE_START_HOUR + i
);
const QUARTERS = [0, 15, 30, 45];
const PX_PER_MINUTE = 2.4; // 144px per hour -> 36px per 15m interval, 12px per 5m
const HOUR_HEIGHT_PX = 60 * PX_PER_MINUTE;
const QUARTER_HEIGHT_PX = 15 * PX_PER_MINUTE;
const DAILY_TARGET_MINUTES = 360;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isTimeboxedDate(iso?: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  return d.getHours() !== 0 || d.getMinutes() !== 0;
}

function isCalendarMeetingTask(task: Task): boolean {
  const desc = (task.description || '').toLowerCase();
  return desc.includes('calendar event') || desc.includes('[calendar]');
}

function formatDurationShort(mins: number): string {
  if (!mins || mins <= 0) return '0m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatTimerClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatHourLabel(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
}

function formatHourMinuteLabel(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${String(minute).padStart(2, '0')} ${period}`;
}

function formatTimeRange(iso: string, durationMinutes: number): string {
  const start = new Date(iso);
  const end = new Date(start.getTime() + Math.max(5, durationMinutes) * 60000);
  const fmt = (d: Date) =>
    d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${fmt(start)} – ${fmt(end)}`;
}

export default function ProjectPlannerWorkspace() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>(DEFAULT_PROJECTS);
  const [calendarEvents, setCalendarEvents] = useState<CalendarTimelineEvent[]>([]);
  const [syncStatus, setSyncStatus] = useState<'connected' | 'syncing' | 'error'>('syncing');

  // Navigation & Filters
  const [activeWorkspace, setActiveWorkspace] = useState<'tasks' | 'notes'>('tasks');
  const [mobileTab, setMobileTab] = useState<'tasks' | 'schedule' | 'notes'>('tasks');
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [schedulingTaskId, setSchedulingTaskId] = useState<string | null>(null);
  const [scheduleDayChoice, setScheduleDayChoice] = useState<'today' | 'tomorrow'>('today');
  const [scheduleTimeChoice, setScheduleTimeChoice] = useState<string>('09:00');
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string>('all'); // 'all' | 'general' | project.id
  const [taskSearch, setTaskSearch] = useState<string>('');
  const [showCalendarPane, setShowCalendarPane] = useState<boolean>(true);
  const [timelineDayBucket, setTimelineDayBucket] = useState<'today' | 'tomorrow' | 'later'>('today');

  // Project Creation / Inline Editing
  const [newProjectName, setNewProjectName] = useState<string>('');
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectTitle, setEditingProjectTitle] = useState<string>('');
  const [editingInstructionsId, setEditingInstructionsId] = useState<string | null>(null);
  const [editingInstructionsText, setEditingInstructionsText] = useState<string>('');

  // Inline Task Creation per Project Group
  const [addingInProjectId, setAddingInProjectId] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState<string>('');

  // Task Detail Modal / Inspector
  const [inspectingTaskId, setInspectingTaskId] = useState<string | null>(null);
  const [newSubtaskText, setNewSubtaskText] = useState<string>('');

  // Transcript Planner & Focus Mode
  const [activeModal, setActiveModal] = useState<ActiveModal>('none');
  const [transcriptText, setTranscriptText] = useState<string>('');
  const [isPlanningTranscript, setIsPlanningTranscript] = useState<boolean>(false);
  const [transcriptStatusMsg, setTranscriptStatusMsg] = useState<string | null>(null);

  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const [focusRunning, setFocusRunning] = useState<boolean>(false);
  const [focusElapsedSeconds, setFocusElapsedSeconds] = useState<number>(0);
  const [focusSubtaskInput, setFocusSubtaskInput] = useState<string>('');

  // Drag & Drop State
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  // Calendar Block Resize State (5-minute precision down to 5m)
  const [resizingState, setResizingState] = useState<{
    taskId: string;
    startY: number;
    initialMinutes: number;
    previewMinutes: number;
  } | null>(null);

  // Calendar Block Move State (Drag up/down in 5-minute increments)
  const [movingState, setMovingState] = useState<{
    taskId: string;
    startY: number;
    initialStartMs: number;
    previewStartMs: number;
    moved: boolean;
  } | null>(null);

  // Current Time for Timeline Red Line
  const [now, setNow] = useState<Date>(new Date());
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const loadData = useCallback(async () => {
    setSyncStatus('syncing');
    try {
      const res = await fetch('/api/desk', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.projects && Array.isArray(json.projects) && json.projects.length > 0) {
        setProjects(json.projects);
      }
      if (json.tasks && Array.isArray(json.tasks)) {
        setTasks(
          json.tasks.map((t: Task) => ({
            ...t,
            title: cleanTaskTitle(t.title),
            tags: [],
          }))
        );
      }
      if (json.calendarEvents && Array.isArray(json.calendarEvents)) {
        setCalendarEvents(json.calendarEvents);
      }
      setSyncStatus('connected');
    } catch (err) {
      console.warn('Sync fetch error:', err);
      setSyncStatus('error');
    }
  }, []);

  const loadNotes = useCallback(async () => {
    try {
      const res = await fetch('/api/notes', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.notes)) {
          setNotes(json.notes);
          return;
        }
      }
      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .order('updated_at', { ascending: false });
      if (!error && Array.isArray(data)) {
        setNotes(data as Note[]);
      }
    } catch (err) {
      console.warn('Notes fetch error, trying direct Supabase client:', err);
      const { data } = await supabase
        .from('notes')
        .select('*')
        .order('updated_at', { ascending: false });
      if (Array.isArray(data)) {
        setNotes(data as Note[]);
      }
    }
  }, []);

  useEffect(() => {
    loadData();
    loadNotes();
    const channel = supabase
      .channel('planner-realtime-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        loadData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, () => {
        loadNotes();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData, loadNotes]);

  // Core API Patch Helper (handles both Tasks and Calendar Timeline Events)
  const patchTask = useCallback(
    async (taskId: string, updates: Partial<Task> & Record<string, any>) => {
      if (String(taskId).startsWith('cal-event-')) {
        const rawCalId = String(taskId).replace(/^cal-event-/, '');
        setCalendarEvents((prev) => {
          const nextDue =
            updates.due_date !== undefined
              ? updates.due_date
              : updates.dueDate !== undefined
              ? updates.dueDate
              : undefined;
          if (nextDue === null) {
            return prev.filter(
              (ev) => ev.id !== rawCalId && `cal-event-${ev.id}` !== taskId
            );
          }
          return prev.map((ev) => {
            if (ev.id !== rawCalId && `cal-event-${ev.id}` !== taskId) return ev;
            const nextStart = nextDue !== undefined ? nextDue : ev.start;
            const nextMins =
              updates.estimated_minutes !== undefined
                ? updates.estimated_minutes
                : updates.estimatedMinutes !== undefined
                ? updates.estimatedMinutes
                : ev.durationMinutes;
            const nextEnd = new Date(
              new Date(nextStart).getTime() + Math.max(5, nextMins) * 60000
            ).toISOString();
            return {
              ...ev,
              title: updates.title !== undefined ? updates.title : ev.title,
              start: nextStart,
              end: nextEnd,
              durationMinutes: Math.max(5, nextMins),
            };
          });
        });
      } else {
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            return {
              ...t,
              ...updates,
              projectId:
                updates.project_id !== undefined
                  ? updates.project_id
                  : updates.projectId !== undefined
                  ? updates.projectId
                  : t.projectId,
              dueDate:
                updates.due_date !== undefined
                  ? updates.due_date
                  : updates.dueDate !== undefined
                  ? updates.dueDate
                  : t.dueDate,
              inPlayQueue:
                updates.in_play_queue !== undefined
                  ? updates.in_play_queue
                  : updates.inPlayQueue !== undefined
                  ? updates.inPlayQueue
                  : t.inPlayQueue,
              estimatedMinutes:
                updates.estimated_minutes !== undefined
                  ? updates.estimated_minutes
                  : updates.estimatedMinutes !== undefined
                  ? updates.estimatedMinutes
                  : t.estimatedMinutes,
              actualSeconds:
                updates.actual_seconds !== undefined
                  ? updates.actual_seconds
                  : updates.actualSeconds !== undefined
                  ? updates.actualSeconds
                  : t.actualSeconds,
              tags: [],
            };
          })
        );
      }

      try {
        await fetch('/api/desk', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: taskId, ...updates }),
        });
      } catch (err) {
        console.error('Failed to patch task:', err);
      }
    },
    []
  );

  // Project Helpers
  const generalProject = useMemo(
    () =>
      projects.find((p) => p.slug === 'general' || p.name.toLowerCase() === 'general') ||
      DEFAULT_PROJECTS[0],
    [projects]
  );

  const customProjects = useMemo(
    () => projects.filter((p) => p.id !== generalProject.id),
    [projects, generalProject]
  );

  const getTaskProject = useCallback(
    (task: Task): Project => {
      if (task.projectId) {
        const found = projects.find((p) => p.id === task.projectId);
        if (found) return found;
      }
      return generalProject;
    },
    [projects, generalProject]
  );

  const handleCreateProject = useCallback(
    async (name: string, instructions: string = '') => {
      const clean = name.trim();
      if (!clean) return null;

      const existing = projects.find(
        (p) => p.name.toLowerCase() === clean.toLowerCase()
      );
      if (existing) return existing;

      try {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: clean, instructions }),
        });
        const json = await res.json();
        if (json.projects && Array.isArray(json.projects)) {
          setProjects(json.projects);
        } else if (json.project) {
          setProjects((prev) => [...prev, json.project]);
        }
        setNewProjectName('');
        return json.project || null;
      } catch (err) {
        console.error('Error creating project:', err);
        return null;
      }
    },
    [projects]
  );

  const handleRenameProject = useCallback(async (projectId: string, newName: string) => {
    const clean = newName.trim();
    setEditingProjectId(null);
    if (!clean) return;

    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, name: clean } : p))
    );
    try {
      await fetch('/api/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: projectId, name: clean }),
      });
    } catch (err) {
      console.error('Error renaming project:', err);
    }
  }, []);

  const handleSaveProjectInstructions = useCallback(
    async (projectId: string, instructions: string) => {
      setEditingInstructionsId(null);
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, instructions } : p))
      );
      try {
        await fetch('/api/projects', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: projectId, instructions }),
        });
      } catch (err) {
        console.error('Error updating project instructions:', err);
      }
    },
    []
  );

  const handleAssignTaskProject = useCallback(
    async (task: Task, targetProjectId: string | null) => {
      const normalizedId =
        !targetProjectId || targetProjectId === generalProject.id ? null : targetProjectId;
      await patchTask(task.id, { project_id: normalizedId });
    },
    [generalProject.id, patchTask]
  );

  // Date Helpers
  const todayStart = useMemo(() => startOfDay(now), [now]);
  const tomorrowStart = useMemo(() => addDays(todayStart, 1), [todayStart]);
  const dayAfterStart = useMemo(() => addDays(todayStart, 2), [todayStart]);

  const activeTimelineDate = useMemo(() => {
    if (timelineDayBucket === 'tomorrow') return tomorrowStart;
    if (timelineDayBucket === 'later') return dayAfterStart;
    return todayStart;
  }, [timelineDayBucket, todayStart, tomorrowStart, dayAfterStart]);

  // Focus Mode Timer
  useEffect(() => {
    if (!focusRunning || !focusTaskId) return;
    const interval = setInterval(() => {
      setFocusElapsedSeconds((prev) => {
        const next = prev + 1;
        if (next % 10 === 0) {
          patchTask(focusTaskId, { actual_seconds: next });
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [focusRunning, focusTaskId, patchTask]);

  // Change Duration (down to 5m)
  const handleSetDuration = useCallback(
    async (task: Task, mins: number) => {
      const clamped = Math.max(5, mins);
      const nextDesc = buildTaskDescription({
        cleanNotes: extractCleanNotes(task.description),
        estimatedMinutes: clamped,
        inPlayQueue: task.inPlayQueue,
        subtasks: task.subtasks,
        tags: [],
      });
      await patchTask(task.id, {
        estimated_minutes: clamped,
        description: nextDesc,
      });
    },
    [patchTask]
  );

  // Calendar Resize Listener
  useEffect(() => {
    if (!resizingState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - resizingState.startY;
      const deltaMinutes = deltaY / PX_PER_MINUTE;
      const rawTarget = resizingState.initialMinutes + deltaMinutes;
      const snapped = Math.max(5, Math.min(360, Math.round(rawTarget / 5) * 5));
      setResizingState((prev) =>
        prev ? { ...prev, previewMinutes: snapped } : null
      );
    };

    const handleMouseUp = () => {
      const task = tasks.find((t) => t.id === resizingState.taskId);
      const finalMins = resizingState.previewMinutes;
      const targetId = resizingState.taskId;
      setResizingState(null);
      if (task && finalMins !== task.estimatedMinutes) {
        handleSetDuration(task, finalMins);
      } else if (String(targetId).startsWith('cal-event-')) {
        patchTask(targetId, { estimated_minutes: finalMins });
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingState, tasks, handleSetDuration, patchTask]);

  const scheduleTaskAtSlot = useCallback(
    async (task: Task, hour: number, minute: number = 0) => {
      const slotDate = new Date(
        activeTimelineDate.getFullYear(),
        activeTimelineDate.getMonth(),
        activeTimelineDate.getDate(),
        hour,
        minute,
        0,
        0
      );
      const isTodayTarget = timelineDayBucket === 'today';
      const nextDesc = buildTaskDescription({
        cleanNotes: extractCleanNotes(task.description),
        estimatedMinutes: task.estimatedMinutes || 15,
        inPlayQueue: isTodayTarget,
        subtasks: task.subtasks,
        tags: [],
      });
      await patchTask(task.id, {
        due_date: slotDate.toISOString(),
        in_play_queue: isTodayTarget,
        description: nextDesc,
      });
    },
    [activeTimelineDate, timelineDayBucket, patchTask]
  );

  // Move a scheduled/missed task back to its Project's Open List
  const moveTaskBackToOpen = useCallback(
    async (task: Task) => {
      if (String(task.id).startsWith('cal-event-')) {
        await patchTask(task.id, { due_date: null });
        return;
      }
      const nextDesc = buildTaskDescription({
        cleanNotes: extractCleanNotes(task.description),
        estimatedMinutes: task.estimatedMinutes || 15,
        inPlayQueue: false,
        subtasks: task.subtasks,
        tags: [],
      });
      await patchTask(task.id, {
        due_date: null,
        in_play_queue: false,
        description: nextDesc,
      });
    },
    [patchTask]
  );

  // Calendar Move Listener
  useEffect(() => {
    if (!movingState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - movingState.startY;
      if (Math.abs(deltaY) < 4 && !movingState.moved) return;

      const deltaMinutes = Math.round(deltaY / PX_PER_MINUTE / 5) * 5;
      const candidateDate = new Date(movingState.initialStartMs + deltaMinutes * 60000);
      const minStart = new Date(
        activeTimelineDate.getFullYear(),
        activeTimelineDate.getMonth(),
        activeTimelineDate.getDate(),
        TIMELINE_START_HOUR,
        0,
        0,
        0
      ).getTime();
      const maxStart = new Date(
        activeTimelineDate.getFullYear(),
        activeTimelineDate.getMonth(),
        activeTimelineDate.getDate(),
        TIMELINE_END_HOUR,
        45,
        0,
        0
      ).getTime();
      const clampedMs = Math.max(minStart, Math.min(maxStart, candidateDate.getTime()));

      setMovingState((prev) =>
        prev ? { ...prev, previewStartMs: clampedMs, moved: true } : null
      );
    };

    const handleMouseUp = () => {
      const currentMove = movingState;
      setMovingState(null);
      if (!currentMove) return;

      if (!currentMove.moved) {
        setInspectingTaskId(currentMove.taskId);
        return;
      }

      const d = new Date(currentMove.previewStartMs);
      const existingTask = tasks.find((t) => t.id === currentMove.taskId);
      if (existingTask) {
        scheduleTaskAtSlot(existingTask, d.getHours(), d.getMinutes());
      } else if (String(currentMove.taskId).startsWith('cal-event-')) {
        patchTask(currentMove.taskId, { due_date: d.toISOString() });
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [movingState, activeTimelineDate, tasks, scheduleTaskAtSlot, patchTask]);

  // Toggle Complete
  const handleToggleComplete = useCallback(
    async (task: Task) => {
      const nextStatus = task.status === 'completed' ? 'pending' : 'completed';
      await patchTask(task.id, { status: nextStatus });
    },
    [patchTask]
  );

  // Create Task inside a Project Group
  const handleCreateTaskInProject = useCallback(
    async (projectId: string) => {
      const raw = newTaskTitle.trim();
      if (!raw) {
        setAddingInProjectId(null);
        return;
      }

      let duration = 15;
      const durMatch = raw.match(/\b(\d+)m\b/i);
      if (durMatch && durMatch[1]) {
        duration = Math.max(5, parseInt(durMatch[1], 10));
      }

      const titleClean = cleanTaskTitle(raw.replace(/\b\d+m\b/gi, '').trim());
      const normalizedProjId = projectId === generalProject.id ? null : projectId;

      const desc = buildTaskDescription({
        cleanNotes: '',
        estimatedMinutes: duration,
        inPlayQueue: false,
        subtasks: [],
        tags: [],
      });

      const tempId = crypto.randomUUID();
      const created: Task = {
        id: tempId,
        projectId: normalizedProjId,
        title: titleClean,
        description: desc,
        listName: 'General',
        status: 'pending',
        dueDate: null,
        estimatedMinutes: duration,
        priority: 'medium',
        inPlayQueue: false,
        subtasks: [],
        tags: [],
        createdAt: new Date().toISOString(),
      };

      setTasks((prev) => [created, ...prev]);
      setNewTaskTitle('');
      setAddingInProjectId(null);

      try {
        await fetch('/api/desk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: tempId,
            project_id: normalizedProjId,
            title: titleClean,
            description: desc,
            list_name: 'General',
            status: 'pending',
            due_date: null,
            estimated_minutes: duration,
            priority: 'medium',
            in_play_queue: false,
            tags: [],
          }),
        });
      } catch (err) {
        console.error('Error creating task:', err);
      }
    },
    [newTaskTitle, generalProject.id]
  );

  // Quick-add directly at a 15-minute calendar slot
  const handleQuickAddAtSlot = useCallback(
    async (hour: number, minute: number) => {
      const slotDate = new Date(
        activeTimelineDate.getFullYear(),
        activeTimelineDate.getMonth(),
        activeTimelineDate.getDate(),
        hour,
        minute,
        0,
        0
      );
      const due = slotDate.toISOString();
      const targetProjId =
        selectedProjectFilter !== 'all' &&
        selectedProjectFilter !== 'general' &&
        selectedProjectFilter !== generalProject.id
          ? selectedProjectFilter
          : null;

      const desc = buildTaskDescription({
        cleanNotes: '',
        estimatedMinutes: 15,
        inPlayQueue: timelineDayBucket === 'today',
        subtasks: [],
        tags: [],
      });

      const tempId = crypto.randomUUID();
      const created: Task = {
        id: tempId,
        projectId: targetProjId,
        title: 'New scheduled task',
        description: desc,
        listName: 'General',
        status: 'pending',
        dueDate: due,
        estimatedMinutes: 15,
        priority: 'medium',
        inPlayQueue: timelineDayBucket === 'today',
        subtasks: [],
        tags: [],
        createdAt: new Date().toISOString(),
      };

      setTasks((prev) => [created, ...prev]);
      setInspectingTaskId(tempId);

      try {
        await fetch('/api/desk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: tempId,
            project_id: targetProjId,
            title: created.title,
            description: desc,
            list_name: 'General',
            status: 'pending',
            due_date: due,
            estimated_minutes: 15,
            priority: 'medium',
            in_play_queue: timelineDayBucket === 'today',
            tags: [],
          }),
        });
      } catch (err) {
        console.error('Error creating slot task:', err);
      }
    },
    [activeTimelineDate, timelineDayBucket, selectedProjectFilter, generalProject.id]
  );

  // Delete Task or Calendar Event
  const handleDeleteTask = useCallback(async (taskId: string) => {
    if (String(taskId).startsWith('cal-event-')) {
      const rawCalId = String(taskId).replace(/^cal-event-/, '');
      setCalendarEvents((prev) =>
        prev.filter((ev) => ev.id !== rawCalId && `cal-event-${ev.id}` !== taskId)
      );
    } else {
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    }
    setInspectingTaskId(null);
    try {
      await fetch(`/api/desk?id=${encodeURIComponent(taskId)}`, {
        method: 'DELETE',
      });
    } catch (e) {
      console.error('Error deleting task:', e);
    }
  }, []);

  // Subtasks
  const handleToggleSubtask = useCallback(
    async (task: Task, subtaskId: string) => {
      const nextSubs = (task.subtasks || []).map((s) =>
        s.id === subtaskId ? { ...s, isCompleted: !s.isCompleted } : s
      );
      const nextDesc = buildTaskDescription({
        cleanNotes: extractCleanNotes(task.description),
        estimatedMinutes: task.estimatedMinutes,
        inPlayQueue: task.inPlayQueue,
        subtasks: nextSubs,
        tags: [],
      });
      await patchTask(task.id, {
        subtasks: nextSubs,
        description: nextDesc,
      });
    },
    [patchTask]
  );

  const handleAddSubtask = useCallback(
    async (task: Task, title: string) => {
      const clean = title.trim();
      if (!clean) return;
      const nextSubs: Subtask[] = [
        ...(task.subtasks || []),
        { id: crypto.randomUUID(), title: clean, isCompleted: false },
      ];
      const nextDesc = buildTaskDescription({
        cleanNotes: extractCleanNotes(task.description),
        estimatedMinutes: task.estimatedMinutes,
        inPlayQueue: task.inPlayQueue,
        subtasks: nextSubs,
        tags: [],
      });
      await patchTask(task.id, {
        subtasks: nextSubs,
        description: nextDesc,
      });
    },
    [patchTask]
  );

  // Apply AI Plan from Pasted Transcript (or Auto-Classify by Project Instructions)
  const runTranscriptPlanner = useCallback(
    async (mode: 'plan_day' | 'classify_only') => {
      setIsPlanningTranscript(true);
      setTranscriptStatusMsg(null);
      try {
        const res = await fetch('/api/plan-transcript', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript: transcriptText,
            mode,
            projects,
            tasks,
            calendarEvents,
            currentTimeIso: now.toISOString(),
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || 'Failed to run planner');
        }

        // 1. Create any new projects mentioned
        const updatedProjectList = [...projects];
        for (const np of json.newProjects || []) {
          if (!np?.name) continue;
          const exists = updatedProjectList.find(
            (p) => p.name.toLowerCase() === String(np.name).toLowerCase()
          );
          if (!exists) {
            const createdProj = await handleCreateProject(np.name, np.instructions || '');
            if (createdProj) updatedProjectList.push(createdProj);
          }
        }

        const resolveProjectId = (projName?: string | null): string | null | undefined => {
          if (!projName) return undefined;
          const lower = projName.toLowerCase().trim();
          if (lower === 'general') return null;
          const found = updatedProjectList.find((p) => p.name.toLowerCase() === lower);
          return found ? found.id : undefined;
        };

        // 2. Apply task updates (project assignment, timebox slot, or unscheduling back to open)
        for (const upd of json.taskUpdates || []) {
          const targetTask = tasks.find((t) => t.id === upd.taskId);
          if (!targetTask) continue;
          const patchPayload: Record<string, any> = {};
          const resolvedProjId = resolveProjectId(upd.projectName);
          if (resolvedProjId !== undefined) {
            patchPayload.project_id = resolvedProjId;
          }
          if (upd.dueDate !== undefined) {
            patchPayload.due_date = upd.dueDate;
            patchPayload.in_play_queue = Boolean(upd.dueDate);
          }
          if (upd.estimatedMinutes) {
            patchPayload.estimated_minutes = Math.max(5, Number(upd.estimatedMinutes));
          }
          if (Object.keys(patchPayload).length > 0) {
            await patchTask(targetTask.id, patchPayload);
          }
        }

        // 3. Create any brand-new tasks extracted from transcript
        for (const nt of json.newTasks || []) {
          if (!nt?.title) continue;
          const newId = crypto.randomUUID();
          const projId = resolveProjectId(nt.projectName) ?? null;
          const mins = Math.max(5, Number(nt.estimatedMinutes || 15));
          const titleClean = cleanTaskTitle(nt.title);
          const desc = buildTaskDescription({
            cleanNotes: '',
            estimatedMinutes: mins,
            inPlayQueue: Boolean(nt.dueDate),
            subtasks: [],
            tags: [],
          });
          const createdTask: Task = {
            id: newId,
            projectId: projId,
            title: titleClean,
            description: desc,
            listName: 'General',
            status: 'pending',
            dueDate: nt.dueDate || null,
            estimatedMinutes: mins,
            priority: 'medium',
            inPlayQueue: Boolean(nt.dueDate),
            subtasks: [],
            tags: [],
            createdAt: new Date().toISOString(),
          };
          setTasks((prev) => [createdTask, ...prev]);
          await fetch('/api/desk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: newId,
              project_id: projId,
              title: titleClean,
              description: desc,
              list_name: 'General',
              status: 'pending',
              due_date: nt.dueDate || null,
              estimated_minutes: mins,
              priority: 'medium',
              in_play_queue: Boolean(nt.dueDate),
              tags: [],
            }),
          });
        }

        setTranscriptStatusMsg(json.summary || 'Schedule updated.');
        if (mode === 'plan_day') {
          setTranscriptText('');
          setActiveModal('none');
        }
      } catch (err: any) {
        setTranscriptStatusMsg(`Error: ${err.message}`);
      } finally {
        setIsPlanningTranscript(false);
      }
    },
    [transcriptText, projects, tasks, calendarEvents, now, handleCreateProject, patchTask]
  );

  // Auto-Slot Unscheduled Today/Open Tasks into Free 15m/5m Calendar Gaps
  const handleAutoTimeboxToday = useCallback(async () => {
    const candidates = tasks.filter(
      (t) => t.status !== 'completed' && !isTimeboxedDate(t.dueDate)
    );
    if (candidates.length === 0) return;

    const slotted = tasks.filter(
      (t) =>
        t.status !== 'completed' &&
        isTimeboxedDate(t.dueDate) &&
        t.dueDate &&
        isSameCalendarDay(new Date(t.dueDate), activeTimelineDate)
    );

    const occupied: { start: number; end: number }[] = [
      ...slotted.map((t) => {
        const s = new Date(t.dueDate!).getTime();
        return {
          start: s,
          end: s + Math.max(5, t.estimatedMinutes || 15) * 60000,
        };
      }),
      ...calendarEvents
        .filter((ev) => isSameCalendarDay(new Date(ev.start), activeTimelineDate))
        .map((ev) => {
          const s = new Date(ev.start).getTime();
          return {
            start: s,
            end: s + Math.max(5, ev.durationMinutes || 30) * 60000,
          };
        }),
    ];

    const isToday = isSameCalendarDay(activeTimelineDate, todayStart);
    const currentRoundedQuarter = Math.ceil(now.getMinutes() / 15) * 15;
    let probe = new Date(
      activeTimelineDate.getFullYear(),
      activeTimelineDate.getMonth(),
      activeTimelineDate.getDate(),
      isToday ? Math.max(8, now.getHours()) : 8,
      isToday && now.getHours() >= 8 ? currentRoundedQuarter : 0,
      0,
      0
    ).getTime();

    const dayEnd = new Date(
      activeTimelineDate.getFullYear(),
      activeTimelineDate.getMonth(),
      activeTimelineDate.getDate(),
      20,
      30,
      0,
      0
    ).getTime();

    for (const task of candidates.slice(0, 6)) {
      const durMs = Math.max(5, task.estimatedMinutes || 15) * 60000;
      while (probe + durMs <= dayEnd) {
        const probeEnd = probe + durMs;
        const conflict = occupied.some((r) => probe < r.end && probeEnd > r.start);
        if (!conflict) {
          occupied.push({ start: probe, end: probeEnd });
          const d = new Date(probe);
          await scheduleTaskAtSlot(task, d.getHours(), d.getMinutes());
          probe = Math.ceil(probeEnd / (5 * 60000)) * (5 * 60000);
          break;
        }
        probe += 5 * 60000;
      }
    }
  }, [tasks, calendarEvents, activeTimelineDate, todayStart, now, scheduleTaskAtSlot]);

  // Open Tasks Filtered by Search
  const openTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (t.status === 'completed') return false;
      if (taskSearch.trim()) {
        const q = taskSearch.toLowerCase();
        return (
          t.title.toLowerCase().includes(q) ||
          (t.description || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [tasks, taskSearch]);

  // Ordered Project Groups: General first, then user-created projects
  const orderedProjects = useMemo(
    () => [generalProject, ...customProjects],
    [generalProject, customProjects]
  );

  const visibleProjectGroups = useMemo(() => {
    if (selectedProjectFilter === 'all') return orderedProjects;
    if (selectedProjectFilter === 'general') return [generalProject];
    return orderedProjects.filter((p) => p.id === selectedProjectFilter);
  }, [selectedProjectFilter, orderedProjects, generalProject]);

  // Inspector Task (supports both tasks and calendar events)
  const inspectingTask = useMemo(() => {
    if (!inspectingTaskId) return null;
    const fromTasks = tasks.find((t) => t.id === inspectingTaskId);
    if (fromTasks) return fromTasks;
    const rawCalId = String(inspectingTaskId).replace(/^cal-event-/, '');
    const ev = calendarEvents.find(
      (c) => c.id === rawCalId || `cal-event-${c.id}` === inspectingTaskId
    );
    if (ev) {
      return {
        id: `cal-event-${ev.id}`,
        projectId: null,
        title: ev.title,
        description: `[Calendar Event] ${ev.location ? `Location: ${ev.location}` : ''}`.trim(),
        listName: 'General',
        status: 'pending' as const,
        dueDate: ev.start,
        source: 'calendar',
        estimatedMinutes: Math.max(5, ev.durationMinutes || 30),
        priority: 'medium' as const,
        inPlayQueue: false,
        subtasks: [],
        tags: [],
      };
    }
    return null;
  }, [tasks, calendarEvents, inspectingTaskId]);

  // Focus Mode Queue
  const focusQueue = useMemo(() => {
    const scheduledToday = openTasks.filter(
      (t) => t.dueDate && isTimeboxedDate(t.dueDate) && isSameCalendarDay(new Date(t.dueDate), todayStart)
    );
    return scheduledToday.length > 0 ? scheduledToday : openTasks;
  }, [openTasks, todayStart]);

  const activeFocusTask = useMemo(() => {
    if (focusTaskId) {
      const explicit = tasks.find((t) => t.id === focusTaskId);
      if (explicit) return explicit;
    }
    return focusQueue[0] || null;
  }, [tasks, focusTaskId, focusQueue]);

  const openFocusMode = useCallback(
    (task?: Task) => {
      const target = task || focusQueue[0] || null;
      if (target) {
        setFocusTaskId(target.id);
        setFocusElapsedSeconds(target.actualSeconds || 0);
        setFocusRunning(true);
      } else {
        setFocusTaskId(null);
        setFocusElapsedSeconds(0);
        setFocusRunning(false);
      }
      setActiveModal('focus_mode');
    },
    [focusQueue]
  );

  // Calendar Timeline Positioned Blocks
  const timeboxedTimelineBlocks = useMemo(() => {
    const taskBlocks = tasks.filter((t) => {
      if (!t.dueDate || !isTimeboxedDate(t.dueDate)) return false;
      const d = new Date(t.dueDate);
      if (isNaN(d.getTime())) return false;
      return isSameCalendarDay(d, activeTimelineDate);
    });

    const calendarBlocks: Task[] = calendarEvents
      .filter((ev) => {
        if (!ev.start) return false;
        const d = new Date(ev.start);
        if (isNaN(d.getTime())) return false;
        return isSameCalendarDay(d, activeTimelineDate);
      })
      .map((ev) => ({
        id: `cal-event-${ev.id}`,
        projectId: null,
        title: ev.title,
        description: `[Calendar Event] ${ev.location ? `Location: ${ev.location}` : ''}`.trim(),
        listName: 'General',
        status: 'pending',
        dueDate: ev.start,
        source: 'calendar',
        estimatedMinutes: Math.max(5, ev.durationMinutes || 30),
        priority: 'medium',
        inPlayQueue: false,
        subtasks: [],
        tags: [],
      }));

    const raw = [...calendarBlocks, ...taskBlocks];
    const sorted = [...raw].sort((a, b) => {
      const sA = new Date(a.dueDate!).getTime();
      const sB = new Date(b.dueDate!).getTime();
      if (sA !== sB) return sA - sB;
      return (b.estimatedMinutes || 15) - (a.estimatedMinutes || 15);
    });

    type PositionedTask = Task & { colIndex: number; totalCols: number };
    const positioned: PositionedTask[] = [];
    const columnsEndMs: number[] = [];
    let cluster: { task: Task; startMs: number; endMs: number; colIndex: number }[] = [];
    let clusterMaxEnd = -1;

    const flushCluster = () => {
      if (cluster.length === 0) return;
      const maxCols = Math.max(...cluster.map((c) => c.colIndex)) + 1;
      for (const item of cluster) {
        positioned.push({
          ...item.task,
          colIndex: item.colIndex,
          totalCols: maxCols,
        });
      }
      cluster = [];
      columnsEndMs.length = 0;
      clusterMaxEnd = -1;
    };

    for (const t of sorted) {
      const d = new Date(t.dueDate!);
      const startMs = d.getTime();
      const durMins = Math.max(5, t.estimatedMinutes || 15);
      const endMs = startMs + durMins * 60000;

      if (cluster.length > 0 && startMs >= clusterMaxEnd) {
        flushCluster();
      }

      let assignedCol = columnsEndMs.findIndex((colEnd) => colEnd <= startMs);
      if (assignedCol === -1) {
        assignedCol = columnsEndMs.length;
        columnsEndMs.push(endMs);
      } else {
        columnsEndMs[assignedCol] = endMs;
      }

      cluster.push({ task: t, startMs, endMs, colIndex: assignedCol });
      if (endMs > clusterMaxEnd) clusterMaxEnd = endMs;
    }
    flushCluster();

    return positioned;
  }, [tasks, calendarEvents, activeTimelineDate]);

  // Scheduled Minutes Today
  const todayScheduledMinutes = useMemo(
    () =>
      tasks
        .filter(
          (t) =>
            t.status !== 'completed' &&
            t.dueDate &&
            isTimeboxedDate(t.dueDate) &&
            isSameCalendarDay(new Date(t.dueDate), todayStart)
        )
        .reduce((acc, t) => acc + (t.estimatedMinutes || 15), 0),
    [tasks, todayStart]
  );

  // Render Task Card inside Project Group
  const renderTaskCard = (task: Task) => {
    const taskProj = getTaskProject(task);
    const timeboxed = isTimeboxedDate(task.dueDate);
    const displayMinutes =
      resizingState?.taskId === task.id
        ? resizingState.previewMinutes
        : task.estimatedMinutes || 15;

    return (
      <div
        key={task.id}
        draggable
        onDragStart={(e) => {
          setDraggedTaskId(task.id);
          e.dataTransfer.setData('text/plain', task.id);
        }}
        onDragEnd={() => {
          setDraggedTaskId(null);
          setDragOverTarget(null);
        }}
        onClick={() => setInspectingTaskId(task.id)}
        className="group relative rounded-xl border bg-[#1B1E26] hover:bg-[#212530] border-white/[0.07] hover:border-white/[0.15] p-3 transition-all cursor-pointer select-none shadow-sm"
      >
        <div className="flex items-start gap-2.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleToggleComplete(task);
            }}
            className="mt-0.5 h-4 w-4 rounded-full border border-slate-500 hover:border-emerald-400 flex items-center justify-center transition-colors shrink-0"
            title="Complete task"
          />

          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium leading-snug text-slate-100 break-words">
              {task.title}
            </p>
            {extractCleanNotes(task.description) && (
              <p className="text-[11px] text-slate-400 mt-1 line-clamp-1">
                {extractCleanNotes(task.description)}
              </p>
            )}
          </div>

          <div
            className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex items-center gap-1 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              title="Schedule onto calendar"
              onClick={() => {
                setScheduleDayChoice('today');
                if (task.dueDate) {
                  const d = new Date(task.dueDate);
                  if (!Number.isNaN(d.getTime())) {
                    const hh = String(d.getHours()).padStart(2, '0');
                    const mm = String(d.getMinutes()).padStart(2, '0');
                    setScheduleTimeChoice(`${hh}:${mm}`);
                  }
                } else {
                  setScheduleTimeChoice('09:00');
                }
                setSchedulingTaskId(task.id);
              }}
              className="p-1.5 md:p-1 rounded-md bg-white/[0.06] hover:bg-indigo-500/30 text-slate-300 hover:text-indigo-300"
            >
              <CalendarIcon className="h-3.5 w-3.5 md:h-3 md:w-3" />
            </button>
            <button
              type="button"
              title="Enter Focus Mode"
              onClick={() => openFocusMode(task)}
              className="p-1.5 md:p-1 rounded-md bg-white/[0.06] hover:bg-indigo-500/30 text-slate-300 hover:text-indigo-300"
            >
              <Play className="h-3.5 w-3.5 md:h-3 md:w-3 fill-current" />
            </button>
          </div>
        </div>

        {/* Footer: Project Selector + Scheduled Slot Badge (with Move back to Open) + Duration */}
        <div
          className="mt-2.5 pl-6 flex items-center justify-between gap-2 text-[11px]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            {/* Project Assignment Selector */}
            <div className="relative inline-flex items-center">
              <select
                aria-label="Assign project"
                value={taskProj.id}
                onChange={(e) => handleAssignTaskProject(task, e.target.value)}
                className="appearance-none bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 rounded-md pl-4 pr-2.5 py-0.5 text-[11px] font-medium cursor-pointer focus:outline-none border border-transparent hover:border-white/10"
              >
                {orderedProjects.map((proj) => (
                  <option key={proj.id} value={proj.id} className="bg-[#1B1E26] text-white">
                    {proj.name}
                  </option>
                ))}
              </select>
              <span
                className="absolute left-1.5 h-1.5 w-1.5 rounded-full pointer-events-none"
                style={{ backgroundColor: taskProj.color }}
              />
            </div>

            {timeboxed && task.dueDate && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 text-[10px] font-medium">
                <Clock className="h-2.5 w-2.5" />
                <span>{formatTimeRange(task.dueDate, displayMinutes)}</span>
                <button
                  type="button"
                  onClick={() => moveTaskBackToOpen(task)}
                  title="Move back to open list"
                  className="ml-0.5 text-indigo-300 hover:text-white"
                >
                  <Undo2 className="h-2.5 w-2.5" />
                </button>
              </span>
            )}
          </div>

          {/* 5-minute precision duration control */}
          <div className="flex items-center gap-0.5 bg-white/[0.03] rounded-md px-1 py-0.5 border border-white/[0.05]">
            <button
              type="button"
              title="Shorten by 5m"
              onClick={() => handleSetDuration(task, Math.max(5, displayMinutes - 5))}
              className="px-1 text-[10px] text-slate-500 hover:text-white font-bold"
            >
              −
            </button>
            <select
              aria-label="Planned duration"
              value={displayMinutes}
              onChange={(e) => handleSetDuration(task, parseInt(e.target.value, 10))}
              className="appearance-none bg-transparent text-slate-300 hover:text-white px-1 text-[11px] font-mono cursor-pointer focus:outline-none text-center"
            >
              {Array.from(new Set([...DURATION_OPTIONS, displayMinutes]))
                .sort((a, b) => a - b)
                .map((m) => (
                  <option key={m} value={m} className="bg-[#1B1E26] text-white">
                    {formatDurationShort(m)}
                  </option>
                ))}
            </select>
            <button
              type="button"
              title="Extend by 5m"
              onClick={() => handleSetDuration(task, displayMinutes + 5)}
              className="px-1 text-[10px] text-slate-500 hover:text-white font-bold"
            >
              +
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-[100dvh] w-screen flex flex-col md:flex-row bg-[#111318] text-slate-100 font-sans overflow-hidden pb-[calc(4.25rem+env(safe-area-inset-bottom))] md:pb-0">
      {/* 1. LEFT NAVIGATION RAIL & USER PROJECTS (Desktop) */}
      <aside className="hidden md:flex w-64 bg-[#151820] border-r border-white/[0.06] flex-col justify-between shrink-0 select-none">
        <div className="p-3.5 space-y-5 overflow-y-auto">
          {/* Header & Sync */}
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-lg bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center text-white font-bold text-xs shadow">
                P
              </div>
              <span className="text-sm font-semibold tracking-tight text-white">
                Day Planner
              </span>
            </div>
            <button
              type="button"
              onClick={loadData}
              title="Refresh tasks & calendar"
              className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/[0.05] hover:bg-white/[0.1] text-[10px] text-slate-400"
            >
              <RefreshCw
                className={`h-2.5 w-2.5 ${
                  syncStatus === 'syncing'
                    ? 'animate-spin text-indigo-400'
                    : syncStatus === 'connected'
                    ? 'text-emerald-400'
                    : 'text-amber-400'
                }`}
              />
              <span>{syncStatus === 'connected' ? 'Synced' : syncStatus}</span>
            </button>
          </div>

          {/* Workspace Switcher: Tasks vs Notes */}
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#111318] border border-white/[0.06]">
            <button
              type="button"
              onClick={() => setActiveWorkspace('tasks')}
              className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeWorkspace === 'tasks'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Tasks ({openTasks.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveWorkspace('notes')}
              className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeWorkspace === 'notes'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              <span>Notes ({notes.length})</span>
            </button>
          </div>

          {/* Primary Actions: Paste Transcript + Auto-Classify + Focus */}
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => {
                setTranscriptStatusMsg(null);
                setActiveModal('transcript_plan');
              }}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition-colors"
            >
              <FileText className="h-3.5 w-3.5" />
              <span>Paste Transcript / Plan Day</span>
            </button>

            {customProjects.length > 0 && (
              <button
                type="button"
                disabled={isPlanningTranscript}
                onClick={() => runTranscriptPlanner('classify_only')}
                className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.09] text-slate-300 text-xs font-medium transition-colors disabled:opacity-50"
                title="Use project instructions to classify tasks in General"
              >
                <Wand2 className="h-3.5 w-3.5 text-amber-400" />
                <span>
                  {isPlanningTranscript ? 'Classifying...' : 'Classify General by Rules'}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => openFocusMode()}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 transition-colors"
            >
              <span className="flex items-center gap-2">
                <Play className="h-3.5 w-3.5 text-emerald-400 fill-current" />
                <span>Focus Mode</span>
              </span>
            </button>
          </div>

          {/* Projects List + Type to Create Project */}
          <div className="space-y-1.5 pt-2 border-t border-white/[0.06]">
            <div className="px-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Projects
              </span>
              <span className="text-[10px] text-slate-500">{openTasks.length} open</span>
            </div>

            <button
              type="button"
              onClick={() => setSelectedProjectFilter('all')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                selectedProjectFilter === 'all'
                  ? 'bg-white/[0.08] text-white font-medium'
                  : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
              }`}
            >
              <span className="flex items-center gap-2">
                <Folder className="h-3.5 w-3.5 text-slate-400" />
                <span>All Open Tasks</span>
              </span>
              <span className="text-[10px] text-slate-500">{openTasks.length}</span>
            </button>

            {orderedProjects.map((proj) => {
              const count = openTasks.filter(
                (t) => getTaskProject(t).id === proj.id
              ).length;
              const isSelected = selectedProjectFilter === proj.id;
              return (
                <button
                  key={proj.id}
                  type="button"
                  onClick={() =>
                    setSelectedProjectFilter(isSelected ? 'all' : proj.id)
                  }
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                    isSelected
                      ? 'bg-white/[0.08] text-white font-medium'
                      : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: proj.color }}
                    />
                    <span className="truncate">{proj.name}</span>
                  </span>
                  <span className="text-[10px] text-slate-500">{count}</span>
                </button>
              );
            })}

            {/* Type to Create a New Project */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCreateProject(newProjectName);
              }}
              className="pt-1.5"
            >
              <div className="flex items-center gap-1.5 bg-[#1B1E26] border border-white/[0.06] focus-within:border-indigo-500/60 rounded-lg px-2 py-1">
                <Plus className="h-3 w-3 text-slate-500 shrink-0" />
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="New project name..."
                  className="w-full bg-transparent text-xs text-white placeholder:text-slate-500 focus:outline-none"
                />
              </div>
            </form>
          </div>
        </div>

        {/* Bottom Panel Toggle & Daemon Status */}
        <div className="p-3 border-t border-white/[0.06] space-y-2 text-[11px] text-slate-500">
          <button
            type="button"
            onClick={() => setShowCalendarPane((v) => !v)}
            className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 text-xs"
          >
            <span className="flex items-center gap-2">
              <CalendarIcon className="h-3.5 w-3.5 text-indigo-400" />
              <span>Calendar Timeline</span>
            </span>
            <span className="text-[10px] text-slate-400">
              {showCalendarPane ? 'On' : 'Off'}
            </span>
          </button>
          <p className="text-[10px] text-slate-500 px-1">
            All new tasks land in General until you create and assign projects.
          </p>
        </div>
      </aside>

      {activeWorkspace === 'notes' ? (
        <NotesWorkspace
          notes={notes}
          onRefresh={loadNotes}
          onNotesChange={setNotes}
        />
      ) : (
        <>
          {/* 2. CENTER WORKSPACE: OPEN TASKS GROUPED BY PROJECT */}
          <main
            className={`${
              mobileTab === 'tasks' ? 'flex' : 'hidden md:flex'
            } flex-1 min-h-0 flex-col overflow-hidden bg-[#111318]`}
          >
        {/* Top Bar */}
        <header className="px-4 md:px-5 py-3 md:py-3.5 border-b border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-base font-bold text-white flex items-center gap-2">
                <span>Open Tasks by Project</span>
                <span className="text-xs font-normal text-slate-400">
                  {now.toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </h1>
              <p className="hidden sm:block text-[11px] text-slate-500 mt-0.5">
                Click any project title to rename it, add classification instructions, or drag tasks onto the calendar.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setTranscriptStatusMsg(null);
                setActiveModal('transcript_plan');
              }}
              className="sm:hidden flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold shrink-0"
            >
              <FileText className="h-3.5 w-3.5" />
              <span>Plan</span>
            </button>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="relative flex-1 sm:w-64 sm:flex-none">
              <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-2.5 md:top-2" />
              <input
                type="text"
                value={taskSearch}
                onChange={(e) => setTaskSearch(e.target.value)}
                placeholder="Search open tasks..."
                className="w-full bg-[#1B1E26] border border-white/[0.06] rounded-lg pl-8 pr-3 py-1.5 text-base md:text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/50"
              />
            </div>

            <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400 bg-[#1B1E26] px-2.5 py-1.5 rounded-lg border border-white/[0.06] shrink-0">
              {todayScheduledMinutes > DAILY_TARGET_MINUTES && (
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
              )}
              <span className="hidden sm:inline">Scheduled Today:</span>
              <strong className="text-white">
                {formatDurationShort(todayScheduledMinutes)}
              </strong>
            </div>
          </div>
        </header>

        {transcriptStatusMsg && (
          <div className="mx-5 mt-3 px-3.5 py-2 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-xs text-indigo-200 flex items-center justify-between">
            <span>{transcriptStatusMsg}</span>
            <button
              type="button"
              onClick={() => setTranscriptStatusMsg(null)}
              className="text-indigo-300 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Scrollable Project Groups */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {visibleProjectGroups.map((proj) => {
            const projTasks = openTasks.filter(
              (t) => getTaskProject(t).id === proj.id
            );
            const isGeneral = proj.id === generalProject.id;
            const isDropHovered = dragOverTarget === `proj-${proj.id}`;

            return (
              <section
                key={proj.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverTarget(`proj-${proj.id}`);
                }}
                onDragLeave={() => setDragOverTarget(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverTarget(null);
                  const id = e.dataTransfer.getData('text/plain') || draggedTaskId;
                  const task = tasks.find((t) => t.id === id);
                  if (task) handleAssignTaskProject(task, proj.id);
                }}
                className={`rounded-2xl border p-4 transition-colors ${
                  isDropHovered
                    ? 'bg-indigo-950/20 border-indigo-500/50'
                    : 'bg-[#151820]/80 border-white/[0.06]'
                }`}
              >
                {/* Project Group Header (Inline Editable Title + Instructions) */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: proj.color }}
                      />
                      {editingProjectId === proj.id ? (
                        <input
                          autoFocus
                          type="text"
                          value={editingProjectTitle}
                          onChange={(e) => setEditingProjectTitle(e.target.value)}
                          onBlur={() => handleRenameProject(proj.id, editingProjectTitle)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter')
                              handleRenameProject(proj.id, editingProjectTitle);
                            if (e.key === 'Escape') setEditingProjectId(null);
                          }}
                          className="bg-[#1B1E26] border border-indigo-500/60 rounded px-2 py-0.5 text-sm font-bold text-white focus:outline-none"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            if (!isGeneral) {
                              setEditingProjectId(proj.id);
                              setEditingProjectTitle(proj.name);
                            }
                          }}
                          className={`text-sm font-bold text-white flex items-center gap-1.5 ${
                            !isGeneral ? 'hover:text-indigo-300 cursor-text' : 'cursor-default'
                          }`}
                          title={isGeneral ? 'Default list for unassigned tasks' : 'Click to rename project'}
                        >
                          <span>{proj.name}</span>
                          {!isGeneral && (
                            <Pencil className="h-3 w-3 text-slate-500 hover:text-indigo-300" />
                          )}
                        </button>
                      )}
                      <span className="text-xs font-mono text-slate-500">
                        ({projTasks.length})
                      </span>
                    </div>

                    {/* Project Classification Instructions */}
                    {!isGeneral && (
                      <div>
                        {editingInstructionsId === proj.id ? (
                          <input
                            autoFocus
                            type="text"
                            value={editingInstructionsText}
                            onChange={(e) => setEditingInstructionsText(e.target.value)}
                            onBlur={() =>
                              handleSaveProjectInstructions(proj.id, editingInstructionsText)
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter')
                                handleSaveProjectInstructions(proj.id, editingInstructionsText);
                              if (e.key === 'Escape') setEditingInstructionsId(null);
                            }}
                            placeholder="Classification instructions (e.g. Tasks mentioning Turn90, First Shift, Apricot)..."
                            className="w-full max-w-xl bg-[#1B1E26] border border-indigo-500/50 rounded px-2.5 py-1 text-[11px] text-slate-200 focus:outline-none"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingInstructionsId(proj.id);
                              setEditingInstructionsText(proj.instructions || '');
                            }}
                            className="text-[11px] text-slate-500 hover:text-slate-300 text-left"
                          >
                            {proj.instructions
                              ? `Rules: ${proj.instructions}`
                              : '+ Add classification instructions for this project...'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setAddingInProjectId(proj.id);
                      setNewTaskTitle('');
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs text-slate-300 shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add Task</span>
                  </button>
                </div>

                {/* Inline Add Task Input */}
                {addingInProjectId === proj.id && (
                  <div className="mb-3 rounded-xl bg-[#1B1E26] border border-indigo-500/50 p-2.5 flex items-center gap-2">
                    <input
                      autoFocus
                      type="text"
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateTaskInProject(proj.id);
                        if (e.key === 'Escape') {
                          setAddingInProjectId(null);
                          setNewTaskTitle('');
                        }
                      }}
                      placeholder={`Add task to ${proj.name} (e.g. Follow up with team 20m)...`}
                      className="flex-1 bg-transparent text-xs text-white placeholder:text-slate-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleCreateTaskInProject(proj.id)}
                      className="px-2.5 py-1 rounded bg-indigo-600 text-white text-[11px] font-semibold"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAddingInProjectId(null);
                        setNewTaskTitle('');
                      }}
                      className="px-2 py-1 text-[11px] text-slate-400 hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Task Cards Grid */}
                {projTasks.length > 0 ? (
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5">
                    {projTasks.map((t) => renderTaskCard(t))}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500 py-3 px-2 border border-dashed border-white/[0.05] rounded-xl text-center">
                    No open tasks in {proj.name}. Drag a task here or click Add Task.
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </main>

      {/* 3. RIGHT 15-MINUTE INTERACTIVE CALENDAR TIMELINE */}
      {(showCalendarPane || mobileTab === 'schedule') && (
        <aside
          className={`${
            mobileTab === 'schedule'
              ? 'flex w-full flex-1 min-h-0 overflow-hidden'
              : 'hidden'
          } ${
            showCalendarPane ? 'md:flex md:w-[370px] md:flex-none md:min-h-0' : 'md:hidden'
          } bg-[#151820] border-l border-white/[0.06] flex-col shrink-0 select-none`}
        >
          <div className="p-3.5 border-b border-white/[0.06] space-y-2.5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                  <CalendarIcon className="h-3.5 w-3.5 text-indigo-400" />
                  <span>Day Schedule ({timeboxedTimelineBlocks.length})</span>
                </h3>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  Drag to move • Drag bottom to resize (5m) • Click ↩ to move back to Open
                </p>
              </div>

              <button
                type="button"
                onClick={handleAutoTimeboxToday}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 text-[11px] font-semibold transition-colors shrink-0"
                title="Auto-slot open tasks into free gaps"
              >
                <Sparkles className="h-3 w-3" />
                <span>Auto-Slot</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-black/30 border border-white/[0.05]">
              {(
                [
                  { id: 'today', label: 'Today' },
                  { id: 'tomorrow', label: 'Tomorrow' },
                  {
                    id: 'later',
                    label: dayAfterStart.toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'numeric',
                      day: 'numeric',
                    }),
                  },
                ] as const
              ).map((tab) => {
                const isActive = timelineDayBucket === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setTimelineDayBucket(tab.id)}
                    className={`py-1 px-2 rounded-md text-[11px] font-semibold transition-all ${
                      isActive
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div ref={timelineScrollRef} className="flex-1 overflow-y-auto relative px-2 py-3">
            <div
              className="relative"
              style={{ height: `${TIMELINE_HOURS.length * HOUR_HEIGHT_PX}px` }}
            >
              {/* 15-Minute Grid Slots */}
              {TIMELINE_HOURS.map((hour) => (
                <div
                  key={hour}
                  className="relative"
                  style={{ height: `${HOUR_HEIGHT_PX}px` }}
                >
                  {QUARTERS.map((minute) => {
                    const dropKey = `slot-${hour}-${minute}`;
                    const isHovered = dragOverTarget === dropKey;
                    return (
                      <div
                        key={minute}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragOverTarget(dropKey);
                        }}
                        onDragLeave={() => setDragOverTarget(null)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragOverTarget(null);
                          const id =
                            e.dataTransfer.getData('text/plain') || draggedTaskId;
                          const task = tasks.find((t) => t.id === id);
                          if (task) {
                            scheduleTaskAtSlot(task, hour, minute);
                          } else if (id && String(id).startsWith('cal-event-')) {
                            const slotDate = new Date(
                              activeTimelineDate.getFullYear(),
                              activeTimelineDate.getMonth(),
                              activeTimelineDate.getDate(),
                              hour,
                              minute,
                              0,
                              0
                            );
                            patchTask(id, { due_date: slotDate.toISOString() });
                          }
                        }}
                        onClick={() => {
                          if (!movingState && !resizingState) {
                            handleQuickAddAtSlot(hour, minute);
                          }
                        }}
                        style={{ height: `${QUARTER_HEIGHT_PX}px` }}
                        className={`group/slot relative flex items-center pl-14 pr-2 transition-colors cursor-pointer ${
                          minute === 0
                            ? 'border-t border-white/[0.09]'
                            : minute === 30
                            ? 'border-t border-dashed border-white/[0.05]'
                            : 'border-t border-dotted border-white/[0.03]'
                        } ${isHovered ? 'bg-indigo-500/20' : 'hover:bg-white/[0.03]'}`}
                      >
                        <div className="absolute left-0 top-0 -translate-y-2 w-12 text-right pr-2 pointer-events-none">
                          {minute === 0 ? (
                            <span className="text-[10px] font-mono font-semibold text-slate-400">
                              {formatHourLabel(hour)}
                            </span>
                          ) : (
                            <span
                              className={`text-[9px] font-mono transition-opacity ${
                                isHovered
                                  ? 'opacity-100 text-indigo-300 font-bold'
                                  : 'opacity-40 group-hover/slot:opacity-90 text-slate-600'
                              }`}
                            >
                              :{String(minute).padStart(2, '0')}
                            </span>
                          )}
                        </div>

                        {isHovered ? (
                          <span className="text-[10px] font-mono text-indigo-300 px-1.5 py-0.5 rounded bg-indigo-950/90 border border-indigo-500/40">
                            Drop at {formatHourMinuteLabel(hour, minute)}
                          </span>
                        ) : (
                          <span className="opacity-0 group-hover/slot:opacity-100 text-[10px] text-slate-500 font-mono transition-opacity pointer-events-none">
                            + Add at {formatHourMinuteLabel(hour, minute)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}

              {/* Current Time Line */}
              {now.getHours() >= TIMELINE_START_HOUR &&
                now.getHours() <= TIMELINE_END_HOUR && (
                  <div
                    className="absolute left-12 right-1 h-[1.5px] bg-rose-500 z-20 pointer-events-none flex items-center"
                    style={{
                      top: `${
                        ((now.getHours() - TIMELINE_START_HOUR) * 60 +
                          now.getMinutes()) *
                        PX_PER_MINUTE
                      }px`,
                    }}
                  >
                    <span className="h-2 w-2 rounded-full bg-rose-500 -ml-1" />
                  </div>
                )}

              {/* Positioned & Interactive Calendar Blocks */}
              {timeboxedTimelineBlocks.map((t) => {
                if (!t.dueDate) return null;
                const isBeingMoved = movingState?.taskId === t.id;
                const effectiveDueIso = isBeingMoved
                  ? new Date(movingState.previewStartMs).toISOString()
                  : t.dueDate;
                const d = new Date(effectiveDueIso);
                const startHour = d.getHours();
                const startMin = d.getMinutes();
                if (
                  startHour < TIMELINE_START_HOUR ||
                  startHour > TIMELINE_END_HOUR
                ) {
                  return null;
                }

                const minutesFromTimelineStart =
                  (startHour - TIMELINE_START_HOUR) * 60 + startMin;
                const topPx = minutesFromTimelineStart * PX_PER_MINUTE;

                const effectiveMinutes =
                  resizingState?.taskId === t.id
                    ? resizingState.previewMinutes
                    : Math.max(5, t.estimatedMinutes || 15);
                const heightPx = Math.max(16, effectiveMinutes * PX_PER_MINUTE);

                const taskProj = getTaskProject(t);
                const isMeeting = isCalendarMeetingTask(t);
                const isBeingResized = resizingState?.taskId === t.id;
                const totalCols = Math.max(1, t.totalCols || 1);
                const colIndex = Math.max(0, t.colIndex || 0);
                const leftCalc = `calc(54px + ((100% - 60px) * ${colIndex} / ${totalCols}))`;
                const widthCalc = `calc(((100% - 60px) / ${totalCols}) - 3px)`;

                return (
                  <div
                    key={t.id}
                    onMouseDown={(e) => {
                      if (e.button !== 0 || resizingState) return;
                      const targetEl = e.target as HTMLElement;
                      if (targetEl.closest('button')) return;
                      e.stopPropagation();
                      e.preventDefault();
                      const initialMs = new Date(t.dueDate!).getTime();
                      setMovingState({
                        taskId: t.id,
                        startY: e.clientY,
                        initialStartMs: initialMs,
                        previewStartMs: initialMs,
                        moved: false,
                      });
                    }}
                    style={{
                      top: `${topPx}px`,
                      height: `${heightPx}px`,
                      left: leftCalc,
                      width: widthCalc,
                      borderLeftWidth: '3px',
                      borderLeftColor: isMeeting ? '#38BDF8' : taskProj.color,
                    }}
                    className={`group/block absolute z-10 hover:z-40 rounded-lg border px-2 flex flex-col justify-between overflow-hidden transition-shadow cursor-grab active:cursor-grabbing ${
                      draggedTaskId && draggedTaskId !== t.id
                        ? 'pointer-events-none opacity-80'
                        : ''
                    } ${
                      isMeeting
                        ? 'bg-sky-950/90 hover:bg-sky-900/95 border-sky-500/40 text-sky-100 shadow-md'
                        : 'bg-[#1E2230]/95 hover:bg-[#252A3B] border-indigo-500/35 text-slate-100 shadow-md'
                    } ${
                      isBeingResized || isBeingMoved
                        ? 'ring-2 ring-indigo-400 z-50 shadow-2xl'
                        : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5 min-w-0 pt-0.5">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isMeeting) {
                              handleDeleteTask(t.id);
                            } else {
                              handleToggleComplete(t);
                            }
                          }}
                          className={`h-3 w-3 rounded-full border flex items-center justify-center shrink-0 ${
                            t.status === 'completed'
                              ? 'bg-emerald-500 border-emerald-500 text-slate-950'
                              : 'border-slate-400 hover:border-white'
                          }`}
                        >
                          {t.status === 'completed' && (
                            <Check className="h-2 w-2 stroke-[3]" />
                          )}
                        </button>
                        <span
                          className={`text-[11px] font-semibold truncate ${
                            t.status === 'completed' ? 'line-through opacity-60' : ''
                          }`}
                        >
                          {t.title}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[9px] font-mono text-indigo-300 bg-black/30 px-1 rounded">
                          {isBeingMoved
                            ? formatHourMinuteLabel(startHour, startMin)
                            : `${effectiveMinutes}m`}
                        </span>
                        {!isMeeting && (
                          <button
                            type="button"
                            title="Move back to open list"
                            onClick={(e) => {
                              e.stopPropagation();
                              moveTaskBackToOpen(t);
                            }}
                            className="opacity-0 group-hover/block:opacity-100 text-slate-300 hover:text-amber-300 p-0.5"
                          >
                            <Undo2 className="h-2.5 w-2.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          title="Focus on this task"
                          onClick={(e) => {
                            e.stopPropagation();
                            openFocusMode(t);
                          }}
                          className="opacity-0 group-hover/block:opacity-100 text-slate-300 hover:text-emerald-300 p-0.5"
                        >
                          <Play className="h-2.5 w-2.5 fill-current" />
                        </button>
                      </div>
                    </div>

                    {effectiveMinutes >= 20 && (
                      <div className="text-[9px] font-mono text-slate-400 pb-1 truncate">
                        {formatTimeRange(effectiveDueIso, effectiveMinutes)} •{' '}
                        {isMeeting ? 'Calendar' : taskProj.name}
                      </div>
                    )}

                    {/* Bottom Resize Handle (5m precision) */}
                    <div
                      title="Drag up or down to resize duration (down to 5m)"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setResizingState({
                          taskId: t.id,
                          startY: e.clientY,
                          initialMinutes: Math.max(5, t.estimatedMinutes || 15),
                          previewMinutes: Math.max(5, t.estimatedMinutes || 15),
                        });
                      }}
                      className="absolute bottom-0 left-0 right-0 h-2.5 cursor-ns-resize flex items-center justify-center bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover/block:opacity-100 hover:!opacity-100"
                    >
                      <div className="w-8 h-[2px] rounded-full bg-indigo-300/80" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      )}
        </>
      )}

      {/* 4. PASTE TRANSCRIPT / PLAN MY DAY MODAL */}
      {activeModal === 'transcript_plan' && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setActiveModal('none')}
        >
          <div
            className="w-full max-w-2xl rounded-2xl bg-[#181B23] border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <FileText className="h-5 w-5 text-indigo-400" />
                <div>
                  <h2 className="text-base font-bold text-white">
                    Plan or Adjust Day from Letterly Transcript
                  </h2>
                  <p className="text-xs text-slate-400">
                    Paste your voice transcript to build today&apos;s schedule, create/assign projects, or move missed tasks back to open.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal('none')}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div className="rounded-xl bg-[#12141A] border border-white/[0.06] p-2.5">
                  <div className="text-slate-500">Projects</div>
                  <div className="text-sm font-bold text-white mt-0.5">
                    {orderedProjects.length}
                  </div>
                </div>
                <div className="rounded-xl bg-[#12141A] border border-white/[0.06] p-2.5">
                  <div className="text-slate-500">Open Tasks</div>
                  <div className="text-sm font-bold text-white mt-0.5">
                    {openTasks.length}
                  </div>
                </div>
                <div className="rounded-xl bg-[#12141A] border border-white/[0.06] p-2.5">
                  <div className="text-slate-500">Calendar Events Today</div>
                  <div className="text-sm font-bold text-sky-300 mt-0.5">
                    {
                      calendarEvents.filter((ev) =>
                        isSameCalendarDay(new Date(ev.start), todayStart)
                      ).length
                    }
                  </div>
                </div>
              </div>

              <textarea
                rows={8}
                autoFocus
                value={transcriptText}
                onChange={(e) => setTranscriptText(e.target.value)}
                placeholder={`Paste your Letterly transcript here...\n\nExamples:\n• "Create a Turn90 project for anything about First Shift or Apricot. Before my 10am meeting I want to knock out..."\n• "My 1pm appointment ran 45 minutes over. Move the task I missed back to open and push the rest of my afternoon back."`}
                className="w-full rounded-xl bg-[#12141A] border border-white/[0.08] focus:border-indigo-500/60 p-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none leading-relaxed"
              />

              {transcriptStatusMsg && (
                <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                  {transcriptStatusMsg}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-white/[0.06] flex items-center justify-end gap-2 bg-[#14171F]">
              <button
                type="button"
                onClick={() => setActiveModal('none')}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isPlanningTranscript || !transcriptText.trim()}
                onClick={() => runTranscriptPlanner('plan_day')}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-2 disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>
                  {isPlanningTranscript ? 'Building Schedule...' : 'Build / Update Schedule'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. TASK DETAIL INSPECTOR MODAL */}
      {inspectingTask && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setInspectingTaskId(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-[#181B23] border border-white/10 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-2">
                {!isCalendarMeetingTask(inspectingTask) && (
                  <select
                    value={getTaskProject(inspectingTask).id}
                    onChange={(e) =>
                      handleAssignTaskProject(inspectingTask, e.target.value)
                    }
                    className="bg-white/[0.06] text-xs font-medium text-slate-200 rounded-lg px-2.5 py-1 focus:outline-none"
                  >
                    {orderedProjects.map((proj) => (
                      <option key={proj.id} value={proj.id} className="bg-[#181B23]">
                        {proj.name}
                      </option>
                    ))}
                  </select>
                )}

                <select
                  value={inspectingTask.estimatedMinutes || 15}
                  onChange={(e) =>
                    handleSetDuration(
                      inspectingTask,
                      parseInt(e.target.value, 10)
                    )
                  }
                  className="bg-white/[0.06] text-xs font-mono text-slate-300 rounded-lg px-2.5 py-1 focus:outline-none"
                >
                  {DURATION_OPTIONS.map((m) => (
                    <option key={m} value={m} className="bg-[#181B23]">
                      Planned: {formatDurationShort(m)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const target = inspectingTask;
                    setInspectingTaskId(null);
                    openFocusMode(target);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center gap-1"
                >
                  <Play className="h-3 w-3 fill-current" />
                  <span>Focus</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteTask(inspectingTask.id)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setInspectingTaskId(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => handleToggleComplete(inspectingTask)}
                  className={`mt-1 h-5 w-5 rounded-full border flex items-center justify-center shrink-0 ${
                    inspectingTask.status === 'completed'
                      ? 'bg-emerald-500 border-emerald-500 text-slate-950'
                      : 'border-slate-500'
                  }`}
                >
                  {inspectingTask.status === 'completed' && (
                    <Check className="h-3 w-3 stroke-[3]" />
                  )}
                </button>
                <input
                  type="text"
                  value={inspectingTask.title}
                  onChange={(e) =>
                    patchTask(inspectingTask.id, { title: e.target.value })
                  }
                  className="w-full bg-transparent text-base font-semibold text-white focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                {isTimeboxedDate(inspectingTask.dueDate) && (
                  <button
                    type="button"
                    onClick={() => moveTaskBackToOpen(inspectingTask)}
                    className="px-3 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs font-medium flex items-center gap-1.5"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    <span>Move back to Open</span>
                  </button>
                )}

                <select
                  value={
                    isTimeboxedDate(inspectingTask.dueDate) &&
                    inspectingTask.dueDate
                      ? `${new Date(inspectingTask.dueDate).getHours()}:${
                          Math.floor(
                            new Date(inspectingTask.dueDate).getMinutes() / 15
                          ) * 15
                        }`
                      : ''
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!val) {
                      moveTaskBackToOpen(inspectingTask);
                    } else {
                      const [h, m] = val.split(':').map(Number);
                      scheduleTaskAtSlot(inspectingTask, h, m);
                    }
                  }}
                  className="bg-white/[0.05] text-xs text-slate-300 rounded-lg px-2.5 py-1 focus:outline-none"
                >
                  <option value="" className="bg-[#181B23]">
                    🕒 Timebox (15m slot)...
                  </option>
                  {TIMELINE_HOURS.flatMap((h) =>
                    QUARTERS.map((m) => (
                      <option
                        key={`${h}:${m}`}
                        value={`${h}:${m}`}
                        className="bg-[#181B23]"
                      >
                        {formatHourMinuteLabel(h, m)}
                      </option>
                    ))
                  )}
                </select>
              </div>

              {/* Subtasks */}
              {!isCalendarMeetingTask(inspectingTask) && (
                <div className="space-y-2 pt-2 border-t border-white/[0.06]">
                  <div className="text-xs font-semibold text-slate-400">
                    Subtasks
                  </div>
                  <div className="space-y-1.5">
                    {(inspectingTask.subtasks || []).map((sub) => (
                      <div
                        key={sub.id}
                        onClick={() =>
                          handleToggleSubtask(inspectingTask, sub.id)
                        }
                        className="flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-white/[0.04] cursor-pointer text-xs"
                      >
                        <div
                          className={`h-4 w-4 rounded border flex items-center justify-center ${
                            sub.isCompleted
                              ? 'bg-indigo-500 border-indigo-500 text-white'
                              : 'border-slate-600'
                          }`}
                        >
                          {sub.isCompleted && (
                            <Check className="h-2.5 w-2.5 stroke-[3]" />
                          )}
                        </div>
                        <span
                          className={
                            sub.isCompleted
                              ? 'line-through text-slate-500'
                              : 'text-slate-200'
                          }
                        >
                          {sub.title}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      value={newSubtaskText}
                      onChange={(e) => setNewSubtaskText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleAddSubtask(inspectingTask, newSubtaskText);
                          setNewSubtaskText('');
                        }
                      }}
                      placeholder="Add a subtask..."
                      className="flex-1 bg-[#12141A] border border-white/[0.07] rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        handleAddSubtask(inspectingTask, newSubtaskText);
                        setNewSubtaskText('');
                      }}
                      className="px-3 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] text-xs font-medium"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}

              {/* Notes */}
              <div className="space-y-1.5 pt-2 border-t border-white/[0.06]">
                <div className="text-xs font-semibold text-slate-400">
                  Notes
                </div>
                <textarea
                  rows={3}
                  defaultValue={extractCleanNotes(inspectingTask.description)}
                  onBlur={(e) => {
                    const nextDesc = buildTaskDescription({
                      cleanNotes: e.target.value,
                      estimatedMinutes: inspectingTask.estimatedMinutes,
                      inPlayQueue: inspectingTask.inPlayQueue,
                      subtasks: inspectingTask.subtasks,
                      tags: [],
                    });
                    patchTask(inspectingTask.id, { description: nextDesc });
                  }}
                  placeholder="Add notes..."
                  className="w-full bg-[#12141A] border border-white/[0.07] rounded-xl p-3 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. FOCUS MODE MODAL */}
      {activeModal === 'focus_mode' && (
        <div className="fixed inset-0 z-50 bg-[#0B0D12]/95 backdrop-blur-md flex flex-col items-center justify-center p-6">
          <button
            type="button"
            onClick={() => {
              setFocusRunning(false);
              setActiveModal('none');
            }}
            className="absolute top-6 right-6 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs text-slate-300"
          >
            <X className="h-4 w-4" />
            <span>Exit Focus</span>
          </button>

          {activeFocusTask ? (
            <div className="w-full max-w-xl text-center space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.06] text-xs font-medium text-slate-300">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: getTaskProject(activeFocusTask).color,
                  }}
                />
                <span>{getTaskProject(activeFocusTask).name}</span>
              </div>

              <h1 className="text-3xl font-bold text-white leading-tight">
                {activeFocusTask.title}
              </h1>

              <div className="py-4">
                <div className="text-6xl font-mono font-bold tracking-tight text-white">
                  {formatTimerClock(focusElapsedSeconds)}
                </div>
                <div className="text-xs text-slate-400 mt-2 font-mono">
                  Planned: {formatDurationShort(activeFocusTask.estimatedMinutes || 15)}
                </div>
              </div>

              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setFocusRunning((r) => !r)}
                  className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm flex items-center gap-2"
                >
                  {focusRunning ? (
                    <>
                      <Pause className="h-4 w-4 fill-current" />
                      <span>Pause</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 fill-current" />
                      <span>Resume</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setFocusElapsedSeconds(0);
                    patchTask(activeFocusTask.id, { actual_seconds: 0 });
                  }}
                  className="p-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-slate-300"
                  title="Reset Timer"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    setFocusRunning(false);
                    await patchTask(activeFocusTask.id, {
                      status: 'completed',
                      actual_seconds: focusElapsedSeconds,
                    });
                    const remaining = focusQueue.filter(
                      (t) => t.id !== activeFocusTask.id
                    );
                    if (remaining.length > 0) {
                      setFocusTaskId(remaining[0].id);
                      setFocusElapsedSeconds(remaining[0].actualSeconds || 0);
                      setFocusRunning(true);
                    } else {
                      setActiveModal('none');
                    }
                  }}
                  className="px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm flex items-center gap-2"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Complete</span>
                </button>
              </div>

              <div className="mt-6 rounded-2xl bg-[#151820] border border-white/[0.08] p-4 text-left space-y-2.5">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Subtasks
                </div>
                {(activeFocusTask.subtasks || []).map((sub) => (
                  <div
                    key={sub.id}
                    onClick={() => handleToggleSubtask(activeFocusTask, sub.id)}
                    className="flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-white/[0.04] cursor-pointer text-sm"
                  >
                    <div
                      className={`h-4 w-4 rounded border flex items-center justify-center ${
                        sub.isCompleted
                          ? 'bg-emerald-500 border-emerald-500 text-slate-950'
                          : 'border-slate-500'
                      }`}
                    >
                      {sub.isCompleted && <Check className="h-3 w-3 stroke-[3]" />}
                    </div>
                    <span
                      className={
                        sub.isCompleted
                          ? 'line-through text-slate-500'
                          : 'text-slate-200'
                      }
                    >
                      {sub.title}
                    </span>
                  </div>
                ))}

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    value={focusSubtaskInput}
                    onChange={(e) => setFocusSubtaskInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && focusSubtaskInput.trim()) {
                        handleAddSubtask(activeFocusTask, focusSubtaskInput);
                        setFocusSubtaskInput('');
                      }
                    }}
                    placeholder="Add a micro-step..."
                    className="flex-1 bg-[#0E1015] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (focusSubtaskInput.trim()) {
                        handleAddSubtask(activeFocusTask, focusSubtaskInput);
                        setFocusSubtaskInput('');
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] text-xs font-medium text-white"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center space-y-3">
              <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto" />
              <p className="text-lg font-semibold text-white">No open tasks!</p>
              <button
                type="button"
                onClick={() => setActiveModal('none')}
                className="px-4 py-2 rounded-xl bg-white/[0.08] text-xs text-white"
              >
                Return to Planner
              </button>
            </div>
          )}
        </div>
      )}

      {/* 6. MOBILE BOTTOM TAB BAR (< md) */}
      <nav
        aria-label="Mobile Navigation"
        className="md:hidden fixed bottom-0 inset-x-0 border-t border-white/[0.08] bg-[#151820]/95 backdrop-blur-md px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] grid grid-cols-4 gap-1 z-40"
      >
        <button
          type="button"
          onClick={() => {
            setMobileTab('tasks');
            setActiveWorkspace('tasks');
          }}
          className={`flex flex-col items-center justify-center py-1.5 rounded-xl text-[11px] font-medium transition-colors ${
            mobileTab === 'tasks'
              ? 'text-indigo-400 bg-indigo-500/10'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <CheckCircle2 className="h-5 w-5 mb-0.5" />
          <span>Tasks ({openTasks.length})</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setMobileTab('schedule');
            setActiveWorkspace('tasks');
          }}
          className={`flex flex-col items-center justify-center py-1.5 rounded-xl text-[11px] font-medium transition-colors ${
            mobileTab === 'schedule'
              ? 'text-indigo-400 bg-indigo-500/10'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <CalendarIcon className="h-5 w-5 mb-0.5" />
          <span>Schedule ({timeboxedTimelineBlocks.length})</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setMobileTab('notes');
            setActiveWorkspace('notes');
          }}
          className={`flex flex-col items-center justify-center py-1.5 rounded-xl text-[11px] font-medium transition-colors ${
            mobileTab === 'notes'
              ? 'text-indigo-400 bg-indigo-500/10'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileText className="h-5 w-5 mb-0.5" />
          <span>Notes ({notes.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileMenuOpen(true)}
          className="flex flex-col items-center justify-center py-1.5 rounded-xl text-[11px] font-medium text-slate-400 hover:text-slate-200 transition-colors"
        >
          <Menu className="h-5 w-5 mb-0.5" />
          <span>Projects</span>
        </button>
      </nav>

      {/* 7. MOBILE SLIDE-OVER PROJECTS & PLAN DRAWER */}
      {mobileMenuOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="w-80 max-w-[85vw] h-full bg-[#151820] border-r border-white/[0.08] p-4 flex flex-col justify-between overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-lg bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center text-white font-bold text-xs shadow">
                    P
                  </div>
                  <span className="text-sm font-semibold text-white">Day Planner</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setTranscriptStatusMsg(null);
                    setActiveModal('transcript_plan');
                  }}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span>Paste Transcript / Plan Day</span>
                </button>

                {customProjects.length > 0 && (
                  <button
                    type="button"
                    disabled={isPlanningTranscript}
                    onClick={() => {
                      setMobileMenuOpen(false);
                      runTranscriptPlanner('classify_only');
                    }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/[0.05] text-slate-200 text-xs font-medium"
                  >
                    <Wand2 className="h-3.5 w-3.5 text-amber-400" />
                    <span>Classify General by Rules</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    openFocusMode();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.04] text-slate-200 text-xs font-medium"
                >
                  <Play className="h-3.5 w-3.5 text-emerald-400 fill-current" />
                  <span>Focus Mode</span>
                </button>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-white/[0.06]">
                <div className="px-1 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Projects
                  </span>
                  <span className="text-[10px] text-slate-500">{openTasks.length} open</span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedProjectFilter('all');
                    setMobileTab('tasks');
                    setActiveWorkspace('tasks');
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs ${
                    selectedProjectFilter === 'all'
                      ? 'bg-white/[0.08] text-white font-medium'
                      : 'text-slate-300 hover:bg-white/[0.04]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Folder className="h-3.5 w-3.5 text-slate-400" />
                    <span>All Open Tasks</span>
                  </span>
                  <span className="text-[10px] text-slate-500">{openTasks.length}</span>
                </button>

                {orderedProjects.map((proj) => {
                  const count = openTasks.filter((t) => getTaskProject(t).id === proj.id).length;
                  return (
                    <button
                      key={proj.id}
                      type="button"
                      onClick={() => {
                        setSelectedProjectFilter(proj.id);
                        setMobileTab('tasks');
                        setActiveWorkspace('tasks');
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs ${
                        selectedProjectFilter === proj.id
                          ? 'bg-white/[0.08] text-white font-medium'
                          : 'text-slate-300 hover:bg-white/[0.04]'
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: proj.color }}
                        />
                        <span className="truncate">{proj.name}</span>
                      </span>
                      <span className="text-[10px] text-slate-500">{count}</span>
                    </button>
                  );
                })}

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newProjectName.trim()) {
                      handleCreateProject(newProjectName);
                    }
                  }}
                  className="pt-2 flex items-center gap-1.5"
                >
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="+ New project..."
                    className="flex-1 bg-[#1B1E26] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-base md:text-xs text-white placeholder:text-slate-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!newProjectName.trim()}
                    className="px-2.5 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold disabled:opacity-40"
                  >
                    Add
                  </button>
                </form>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                loadData();
                loadNotes();
              }}
              className="mt-4 w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-white/[0.05] text-xs text-slate-300"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
              <span>Sync Now</span>
            </button>
          </div>
        </div>
      )}

      {/* 8. TAP-TO-SCHEDULE MODAL (Touch-friendly alternative to drag-and-drop) */}
      {schedulingTaskId && (() => {
        const targetTask = tasks.find((t) => t.id === schedulingTaskId);
        if (!targetTask) return null;
        return (
          <div
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={() => setSchedulingTaskId(null)}
          >
            <div
              className="w-full sm:max-w-sm bg-[#171A23] border border-white/[0.08] rounded-t-2xl sm:rounded-2xl p-5 space-y-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-white">Schedule Task</h3>
                  <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
                    {targetTask.title}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSchedulingTaskId(null)}
                  className="p-1 text-slate-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {(['today', 'tomorrow'] as const).map((day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setScheduleDayChoice(day)}
                    className={`py-2 rounded-xl text-xs font-semibold capitalize border transition-colors ${
                      scheduleDayChoice === day
                        ? 'bg-indigo-600 text-white border-indigo-500'
                        : 'bg-[#111318] text-slate-300 border-white/[0.08]'
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-slate-400">
                  Start Time
                </label>
                <input
                  type="time"
                  value={scheduleTimeChoice}
                  onChange={(e) => setScheduleTimeChoice(e.target.value)}
                  className="w-full bg-[#111318] border border-white/[0.08] rounded-xl px-3 py-2 text-base md:text-sm text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                {targetTask.dueDate && (
                  <button
                    type="button"
                    onClick={async () => {
                      await moveTaskBackToOpen(targetTask);
                      setSchedulingTaskId(null);
                    }}
                    className="px-3 py-2.5 rounded-xl bg-white/[0.06] text-xs text-slate-300 hover:text-white"
                  >
                    Move to Open
                  </button>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    const [hhStr, mmStr] = (scheduleTimeChoice || '09:00').split(':');
                    const hh = parseInt(hhStr, 10) || 9;
                    const mm = parseInt(mmStr, 10) || 0;
                    const base = new Date();
                    if (scheduleDayChoice === 'tomorrow') {
                      base.setDate(base.getDate() + 1);
                    }
                    base.setHours(hh, mm, 0, 0);
                    const isTodayTarget = scheduleDayChoice === 'today';
                    const nextDesc = buildTaskDescription({
                      cleanNotes: extractCleanNotes(targetTask.description),
                      estimatedMinutes: targetTask.estimatedMinutes || 15,
                      inPlayQueue: isTodayTarget,
                      subtasks: targetTask.subtasks,
                      tags: [],
                    });
                    await patchTask(targetTask.id, {
                      due_date: base.toISOString(),
                      in_play_queue: isTodayTarget,
                      description: nextDesc,
                    });
                    setTimelineDayBucket(scheduleDayChoice);
                    setSchedulingTaskId(null);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
                >
                  Save to Schedule
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
