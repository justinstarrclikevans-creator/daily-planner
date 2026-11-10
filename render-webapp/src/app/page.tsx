'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  supabase,
  Task,
  Subtask,
  TaskPriority,
  SUNSAMA_CHANNELS,
  SunsamaChannel,
  getChannelForTask,
  buildTaskDescription,
  extractCleanNotes,
  cleanTaskTitle,
} from '@/lib/supabase';
import {
  Check,
  Plus,
  Calendar as CalendarIcon,
  Inbox,
  Sparkles,
  Sun,
  Moon,
  Play,
  Pause,
  RotateCcw,
  Clock,
  ChevronRight,
  ChevronDown,
  Hash,
  Trash2,
  X,
  ArrowRight,
  RefreshCw,
  Search,
  Columns,
  CheckCircle2,
  AlertTriangle,
  Flame,
} from 'lucide-react';

type ActiveModal = 'none' | 'morning_plan' | 'evening_shutdown' | 'focus_mode';

const DURATION_OPTIONS = [5, 10, 15, 20, 25, 30, 45, 60, 90];
const TIMELINE_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const DAILY_TARGET_MINUTES = 360; // 6 hours realistic daily capacity

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

function formatTimeRange(iso: string, durationMinutes: number): string {
  const start = new Date(iso);
  const end = new Date(start.getTime() + Math.max(5, durationMinutes) * 60000);
  const fmt = (d: Date) =>
    d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${fmt(start)} – ${fmt(end)}`;
}

export default function SunsamaWorkspace() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [syncStatus, setSyncStatus] = useState<'connected' | 'syncing' | 'error'>('syncing');

  // Sunsama Panel Toggles & Filters
  const [showBacklogDrawer, setShowBacklogDrawer] = useState<boolean>(true);
  const [showCalendarPane, setShowCalendarPane] = useState<boolean>(true);
  const [selectedChannelTag, setSelectedChannelTag] = useState<string>('all');
  const [backlogSearch, setBacklogSearch] = useState<string>('');

  // Inline Quick-Add Inputs per Column
  const [addingInColumn, setAddingInColumn] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState<string>('');

  // Task Detail Modal / Inspector
  const [inspectingTaskId, setInspectingTaskId] = useState<string | null>(null);
  const [newSubtaskText, setNewSubtaskText] = useState<string>('');

  // Ritual & Focus Overlays
  const [activeModal, setActiveModal] = useState<ActiveModal>('none');
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const [focusRunning, setFocusRunning] = useState<boolean>(false);
  const [focusElapsedSeconds, setFocusElapsedSeconds] = useState<number>(0);

  // Drag & Drop State
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  // Current Time for Timeline Red Line
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  // Focus Mode Timer
  useEffect(() => {
    if (!focusRunning || !focusTaskId) return;
    const interval = setInterval(() => {
      setFocusElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [focusRunning, focusTaskId]);

  const loadData = useCallback(async () => {
    setSyncStatus('syncing');
    try {
      const res = await fetch('/api/desk', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.tasks && Array.isArray(json.tasks)) {
        setTasks(json.tasks);
      }
      setSyncStatus('connected');
    } catch (err) {
      console.warn('Sync fetch error:', err);
      setSyncStatus('error');
    }
  }, []);

  useEffect(() => {
    loadData();
    const channel = supabase
      .channel('sunsama-realtime-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        loadData();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData]);

  // Core API Patch Helper
  const patchTask = useCallback(async (taskId: string, updates: Partial<Task> & Record<string, any>) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        return {
          ...t,
          ...updates,
          dueDate: updates.due_date !== undefined ? updates.due_date : updates.dueDate !== undefined ? updates.dueDate : t.dueDate,
          inPlayQueue: updates.in_play_queue !== undefined ? updates.in_play_queue : updates.inPlayQueue !== undefined ? updates.inPlayQueue : t.inPlayQueue,
          estimatedMinutes: updates.estimated_minutes !== undefined ? updates.estimated_minutes : updates.estimatedMinutes !== undefined ? updates.estimatedMinutes : t.estimatedMinutes,
        };
      })
    );

    try {
      await fetch('/api/desk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId, ...updates }),
      });
    } catch (err) {
      console.error('Failed to patch task:', err);
    }
  }, []);

  // Channel Filtered Tasks
  const channelFilteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (selectedChannelTag === 'all') return true;
      const ch = getChannelForTask(t);
      return ch.tag === selectedChannelTag;
    });
  }, [tasks, selectedChannelTag]);

  // Date Buckets: Backlog, Today, Tomorrow, Next Day
  const todayStart = useMemo(() => startOfDay(now), [now]);
  const tomorrowStart = useMemo(() => addDays(todayStart, 1), [todayStart]);
  const dayAfterStart = useMemo(() => addDays(todayStart, 2), [todayStart]);

  const classifyTaskBucket = useCallback(
    (task: Task): 'backlog' | 'today' | 'tomorrow' | 'later' => {
      if (!task.dueDate) {
        return task.inPlayQueue ? 'today' : 'backlog';
      }
      const d = new Date(task.dueDate);
      if (isNaN(d.getTime())) {
        return task.inPlayQueue ? 'today' : 'backlog';
      }
      const dayStart = startOfDay(d);
      if (dayStart.getTime() <= todayStart.getTime()) {
        return 'today';
      }
      if (isSameCalendarDay(dayStart, tomorrowStart)) {
        return 'tomorrow';
      }
      return 'later';
    },
    [todayStart, tomorrowStart]
  );

  const sortTasks = useCallback((list: Task[]) => {
    return [...list].sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === 'pending' ? -1 : 1;
      }
      const pRank = (p: TaskPriority) => (p === 'high' ? 3 : p === 'medium' ? 2 : 1);
      if (pRank(a.priority) !== pRank(b.priority)) {
        return pRank(b.priority) - pRank(a.priority);
      }
      const tbA = isTimeboxedDate(a.dueDate);
      const tbB = isTimeboxedDate(b.dueDate);
      if (tbA !== tbB) return tbA ? -1 : 1;
      if (tbA && tbB && a.dueDate && b.dueDate) {
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      }
      return (a.estimatedMinutes || 15) - (b.estimatedMinutes || 15);
    });
  }, []);

  const backlogTasks = useMemo(() => {
    return sortTasks(
      channelFilteredTasks.filter((t) => {
        if (t.status === 'completed') return false;
        if (classifyTaskBucket(t) !== 'backlog') return false;
        if (backlogSearch.trim()) {
          const q = backlogSearch.toLowerCase();
          return (
            t.title.toLowerCase().includes(q) ||
            (t.description || '').toLowerCase().includes(q)
          );
        }
        return true;
      })
    );
  }, [channelFilteredTasks, classifyTaskBucket, backlogSearch, sortTasks]);

  const todayTasks = useMemo(() => {
    return sortTasks(
      channelFilteredTasks.filter((t) => classifyTaskBucket(t) === 'today')
    );
  }, [channelFilteredTasks, classifyTaskBucket, sortTasks]);

  const tomorrowTasks = useMemo(() => {
    return sortTasks(
      channelFilteredTasks.filter(
        (t) => t.status !== 'completed' && classifyTaskBucket(t) === 'tomorrow'
      )
    );
  }, [channelFilteredTasks, classifyTaskBucket, sortTasks]);

  const laterTasks = useMemo(() => {
    return sortTasks(
      channelFilteredTasks.filter(
        (t) => t.status !== 'completed' && classifyTaskBucket(t) === 'later'
      )
    );
  }, [channelFilteredTasks, classifyTaskBucket, sortTasks]);

  // Workload Metrics for Today & Tomorrow
  const todayPendingMinutes = useMemo(
    () =>
      todayTasks
        .filter((t) => t.status !== 'completed')
        .reduce((acc, t) => acc + (t.estimatedMinutes || 15), 0),
    [todayTasks]
  );

  const todayCompletedMinutes = useMemo(
    () =>
      todayTasks
        .filter((t) => t.status === 'completed')
        .reduce((acc, t) => acc + (t.estimatedMinutes || 15), 0),
    [todayTasks]
  );

  const todayTotalPlannedMinutes = todayPendingMinutes + todayCompletedMinutes;

  const tomorrowPlannedMinutes = useMemo(
    () => tomorrowTasks.reduce((acc, t) => acc + (t.estimatedMinutes || 15), 0),
    [tomorrowTasks]
  );

  const laterPlannedMinutes = useMemo(
    () => laterTasks.reduce((acc, t) => acc + (t.estimatedMinutes || 15), 0),
    [laterTasks]
  );

  // Actions: Move Task between Backlog / Today / Tomorrow / Later / Timebox Hour
  const moveTaskToBucket = useCallback(
    async (task: Task, bucket: 'backlog' | 'today' | 'tomorrow' | 'later') => {
      let nextDue: string | null = null;
      let nextQueue = false;

      if (bucket === 'today') {
        nextDue = todayStart.toISOString();
        nextQueue = true;
      } else if (bucket === 'tomorrow') {
        nextDue = tomorrowStart.toISOString();
        nextQueue = false;
      } else if (bucket === 'later') {
        nextDue = dayAfterStart.toISOString();
        nextQueue = false;
      } else {
        nextDue = null;
        nextQueue = false;
      }

      const nextDesc = buildTaskDescription({
        cleanNotes: extractCleanNotes(task.description),
        estimatedMinutes: task.estimatedMinutes || 15,
        inPlayQueue: nextQueue,
        subtasks: task.subtasks,
        tags: task.tags,
      });

      await patchTask(task.id, {
        due_date: nextDue,
        in_play_queue: nextQueue,
        description: nextDesc,
      });
    },
    [todayStart, tomorrowStart, dayAfterStart, patchTask]
  );

  const scheduleTaskAtHour = useCallback(
    async (task: Task, hour: number, minute: number = 0) => {
      const slotDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        hour,
        minute,
        0,
        0
      );
      const nextDesc = buildTaskDescription({
        cleanNotes: extractCleanNotes(task.description),
        estimatedMinutes: task.estimatedMinutes || 15,
        inPlayQueue: true,
        subtasks: task.subtasks,
        tags: task.tags,
      });
      await patchTask(task.id, {
        due_date: slotDate.toISOString(),
        in_play_queue: true,
        description: nextDesc,
      });
    },
    [now, patchTask]
  );

  const clearTaskTimebox = useCallback(
    async (task: Task) => {
      const nextDue = todayStart.toISOString();
      await patchTask(task.id, {
        due_date: nextDue,
        in_play_queue: true,
      });
    },
    [todayStart, patchTask]
  );

  // Auto-Timebox Unslotted Today Tasks around Already Timeboxed Items
  const handleAutoTimeboxToday = useCallback(async () => {
    const unslotted = todayTasks.filter(
      (t) => t.status !== 'completed' && !isTimeboxedDate(t.dueDate)
    );
    if (unslotted.length === 0) return;

    const slotted = todayTasks.filter(
      (t) => t.status !== 'completed' && isTimeboxedDate(t.dueDate) && t.dueDate
    );

    const occupied: { start: number; end: number }[] = slotted.map((t) => {
      const s = new Date(t.dueDate!).getTime();
      return {
        start: s,
        end: s + Math.max(5, t.estimatedMinutes || 15) * 60000,
      };
    });

    const startCursor = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      Math.max(8, now.getHours()),
      0,
      0,
      0
    ).getTime();
    const dayEnd = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      20,
      0,
      0,
      0
    ).getTime();

    let probe = startCursor;

    for (const task of unslotted) {
      const durMs = Math.max(5, task.estimatedMinutes || 15) * 60000;
      while (probe + durMs <= dayEnd) {
        const probeEnd = probe + durMs;
        const conflict = occupied.some(
          (r) => probe < r.end && probeEnd > r.start
        );
        if (!conflict) {
          occupied.push({ start: probe, end: probeEnd });
          const d = new Date(probe);
          await scheduleTaskAtHour(task, d.getHours(), d.getMinutes());
          probe = probeEnd + 5 * 60000; // 5m buffer
          break;
        }
        probe += 15 * 60000;
      }
    }
  }, [todayTasks, now, scheduleTaskAtHour]);

  // Toggle Complete
  const handleToggleComplete = useCallback(
    async (task: Task) => {
      const nextStatus = task.status === 'completed' ? 'pending' : 'completed';
      await patchTask(task.id, { status: nextStatus });
    },
    [patchTask]
  );

  // Change Channel Tag
  const handleSetChannel = useCallback(
    async (task: Task, channelTag: string) => {
      const otherTags = (task.tags || []).filter(
        (t) => !SUNSAMA_CHANNELS.some((c) => c.tag === t.toLowerCase())
      );
      const nextTags =
        channelTag === 'general' ? otherTags : [...otherTags, channelTag];
      const nextDesc = buildTaskDescription({
        cleanNotes: extractCleanNotes(task.description),
        estimatedMinutes: task.estimatedMinutes || 15,
        inPlayQueue: task.inPlayQueue,
        subtasks: task.subtasks,
        tags: nextTags,
      });
      await patchTask(task.id, {
        tags: nextTags,
        description: nextDesc,
      });
    },
    [patchTask]
  );

  // Change Duration
  const handleSetDuration = useCallback(
    async (task: Task, mins: number) => {
      const nextDesc = buildTaskDescription({
        cleanNotes: extractCleanNotes(task.description),
        estimatedMinutes: mins,
        inPlayQueue: task.inPlayQueue,
        subtasks: task.subtasks,
        tags: task.tags,
      });
      await patchTask(task.id, {
        estimated_minutes: mins,
        description: nextDesc,
      });
    },
    [patchTask]
  );

  // Inline Create Task in any Column
  const handleCreateTaskInBucket = useCallback(
    async (bucket: 'backlog' | 'today' | 'tomorrow' | 'later') => {
      const raw = newTaskTitle.trim();
      if (!raw) {
        setAddingInColumn(null);
        return;
      }

      // Parse inline #channel or 15m if typed (Sunsama quick-entry syntax)
      let duration = 15;
      const durMatch = raw.match(/\b(\d+)m\b/i);
      if (durMatch && durMatch[1]) {
        duration = parseInt(durMatch[1], 10);
      }

      const inlineTags = (raw.match(/#([a-zA-Z0-9_\-]+)/g) || []).map((t) =>
        t.substring(1).toLowerCase()
      );
      if (
        selectedChannelTag !== 'all' &&
        selectedChannelTag !== 'general' &&
        !inlineTags.includes(selectedChannelTag)
      ) {
        inlineTags.push(selectedChannelTag);
      }

      const titleClean = cleanTaskTitle(raw.replace(/\b\d+m\b/gi, '').trim());
      let due: string | null = null;
      let inQueue = false;
      if (bucket === 'today') {
        due = todayStart.toISOString();
        inQueue = true;
      } else if (bucket === 'tomorrow') {
        due = tomorrowStart.toISOString();
      } else if (bucket === 'later') {
        due = dayAfterStart.toISOString();
      }

      const desc = buildTaskDescription({
        cleanNotes: '',
        estimatedMinutes: duration,
        inPlayQueue: inQueue,
        subtasks: [],
        tags: inlineTags,
      });

      const tempId = crypto.randomUUID();
      const created: Task = {
        id: tempId,
        title: titleClean,
        description: desc,
        listName: 'General',
        status: 'pending',
        dueDate: due,
        estimatedMinutes: duration,
        priority: 'medium',
        inPlayQueue: inQueue,
        subtasks: [],
        tags: inlineTags,
        createdAt: new Date().toISOString(),
      };

      setTasks((prev) => [created, ...prev]);
      setNewTaskTitle('');
      setAddingInColumn(null);

      try {
        await fetch('/api/desk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: tempId,
            title: titleClean,
            description: desc,
            list_name: 'General',
            status: 'pending',
            due_date: due,
            estimated_minutes: duration,
            priority: 'medium',
            in_play_queue: inQueue,
            tags: inlineTags,
          }),
        });
      } catch (err) {
        console.error('Error creating task:', err);
      }
    },
    [
      newTaskTitle,
      selectedChannelTag,
      todayStart,
      tomorrowStart,
      dayAfterStart,
    ]
  );

  // Delete Task
  const handleDeleteTask = useCallback(async (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setInspectingTaskId(null);
    try {
      await fetch(`/api/desk?id=${encodeURIComponent(taskId)}`, {
        method: 'DELETE',
      });
    } catch (e) {
      console.error('Error deleting task:', e);
    }
  }, []);

  // Subtask Toggle & Add
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
        tags: task.tags,
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
        tags: task.tags,
      });
      await patchTask(task.id, {
        subtasks: nextSubs,
        description: nextDesc,
      });
    },
    [patchTask]
  );

  // Evening Shutdown Rollover
  const handleShutdownRollover = useCallback(
    async (target: 'tomorrow' | 'backlog') => {
      const incompleteToday = todayTasks.filter((t) => t.status !== 'completed');
      for (const t of incompleteToday) {
        await moveTaskToBucket(t, target);
      }
      setActiveModal('none');
    },
    [todayTasks, moveTaskToBucket]
  );

  const inspectingTask = useMemo(
    () => tasks.find((t) => t.id === inspectingTaskId) || null,
    [tasks, inspectingTaskId]
  );

  const activeFocusTask = useMemo(
    () => tasks.find((t) => t.id === focusTaskId) || todayTasks.find((t) => t.status !== 'completed') || null,
    [tasks, focusTaskId, todayTasks]
  );

  // Render a Sunsama Task Card
  const renderTaskCard = (
    task: Task,
    currentBucket: 'backlog' | 'today' | 'tomorrow' | 'later'
  ) => {
    const channel = getChannelForTask(task);
    const isDone = task.status === 'completed';
    const timeboxed = isTimeboxedDate(task.dueDate);
    const completedSubs = (task.subtasks || []).filter((s) => s.isCompleted).length;
    const totalSubs = (task.subtasks || []).length;

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
        className={`group relative rounded-xl border p-3.5 transition-all cursor-pointer select-none ${
          isDone
            ? 'bg-[#14161B]/60 border-white/[0.04] opacity-60'
            : 'bg-[#1B1E26] hover:bg-[#212530] border-white/[0.07] hover:border-white/[0.14] shadow-sm'
        }`}
      >
        {/* Top Row: Checkbox + Title + Quick Hover Actions */}
        <div className="flex items-start gap-2.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleToggleComplete(task);
            }}
            className={`mt-0.5 h-4 w-4 rounded-full border flex items-center justify-center transition-colors shrink-0 ${
              isDone
                ? 'bg-emerald-500 border-emerald-500 text-slate-950'
                : 'border-slate-500 hover:border-indigo-400'
            }`}
          >
            {isDone && <Check className="h-2.5 w-2.5 stroke-[3]" />}
          </button>

          <div className="flex-1 min-w-0">
            <p
              className={`text-[13px] font-medium leading-snug break-words ${
                isDone ? 'line-through text-slate-500' : 'text-slate-100'
              }`}
            >
              {task.title}
            </p>
          </div>

          {/* Hover Quick Actions */}
          <div
            className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {currentBucket === 'backlog' ? (
              <button
                type="button"
                title="Move to Today"
                onClick={() => moveTaskToBucket(task, 'today')}
                className="px-2 py-0.5 rounded-md bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 text-[10px] font-semibold flex items-center gap-1"
              >
                <Sun className="h-2.5 w-2.5" />
                <span>Today</span>
              </button>
            ) : (
              <button
                type="button"
                title="Focus on this task"
                onClick={() => {
                  setFocusTaskId(task.id);
                  setFocusElapsedSeconds(task.actualSeconds || 0);
                  setFocusRunning(true);
                  setActiveModal('focus_mode');
                }}
                className="p-1 rounded-md bg-white/[0.06] hover:bg-indigo-500/30 text-slate-300 hover:text-indigo-300"
              >
                <Play className="h-3 w-3 fill-current" />
              </button>
            )}

            {currentBucket === 'today' && (
              <button
                type="button"
                title="Defer to Tomorrow"
                onClick={() => moveTaskToBucket(task, 'tomorrow')}
                className="p-1 rounded-md bg-white/[0.06] hover:bg-amber-500/20 text-slate-400 hover:text-amber-300"
              >
                <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Subtasks Progress / Inline Checklist */}
        {totalSubs > 0 && (
          <div className="mt-2.5 pl-6 space-y-1">
            {task.subtasks.slice(0, 3).map((sub) => (
              <div
                key={sub.id}
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleSubtask(task, sub.id);
                }}
                className="flex items-center gap-2 text-[11px] text-slate-400 hover:text-slate-200"
              >
                <div
                  className={`h-3 w-3 rounded border flex items-center justify-center shrink-0 ${
                    sub.isCompleted
                      ? 'bg-indigo-500 border-indigo-500 text-white'
                      : 'border-slate-600'
                  }`}
                >
                  {sub.isCompleted && <Check className="h-2 w-2 stroke-[3]" />}
                </div>
                <span className={`truncate ${sub.isCompleted ? 'line-through text-slate-600' : ''}`}>
                  {sub.title}
                </span>
              </div>
            ))}
            {totalSubs > 3 && (
              <div className="text-[10px] text-slate-500">
                +{totalSubs - 3} more steps ({completedSubs}/{totalSubs})
              </div>
            )}
          </div>
        )}

        {/* Sunsama Card Footer: Channel Tag + Timebox Badge + Planned Time */}
        <div
          className="mt-3 pl-6 flex items-center justify-between gap-2 text-[11px]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            {/* Channel Selector Pill */}
            <div className="relative inline-flex items-center">
              <select
                aria-label="Channel tag"
                value={channel.tag}
                onChange={(e) => handleSetChannel(task, e.target.value)}
                className="appearance-none bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 rounded-md pl-4 pr-2 py-0.5 text-[11px] font-medium cursor-pointer focus:outline-none border border-transparent hover:border-white/10"
              >
                {SUNSAMA_CHANNELS.map((ch) => (
                  <option key={ch.tag} value={ch.tag} className="bg-[#1B1E26] text-white">
                    #{ch.label}
                  </option>
                ))}
              </select>
              <span
                className="absolute left-1.5 h-1.5 w-1.5 rounded-full pointer-events-none"
                style={{ backgroundColor: channel.color }}
              />
            </div>

            {/* Timeboxed Clock Badge */}
            {timeboxed && task.dueDate && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 text-[10px] font-medium">
                <Clock className="h-2.5 w-2.5" />
                {new Date(task.dueDate).toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
            )}

            {task.priority === 'high' && (
              <span className="inline-flex items-center text-rose-400" title="High Priority">
                <Flame className="h-3 w-3 fill-current" />
              </span>
            )}
          </div>

          {/* Planned Time Dropdown (Sunsama 0:15 style) */}
          <select
            aria-label="Planned duration"
            value={task.estimatedMinutes || 15}
            onChange={(e) => handleSetDuration(task, parseInt(e.target.value, 10))}
            className="appearance-none bg-transparent hover:bg-white/[0.06] text-slate-400 hover:text-slate-200 rounded px-1.5 py-0.5 text-[11px] font-mono cursor-pointer focus:outline-none text-right"
          >
            {DURATION_OPTIONS.map((m) => (
              <option key={m} value={m} className="bg-[#1B1E26] text-white">
                {formatDurationShort(m)}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  };

  return (
    <div className="h-screen w-screen flex bg-[#111318] text-slate-100 font-sans overflow-hidden">
      {/* 1. LEFT SUNSAMA NAVIGATION RAIL & CHANNELS */}
      <aside className="w-56 bg-[#151820] border-r border-white/[0.06] flex flex-col justify-between shrink-0 select-none">
        <div className="p-3.5 space-y-5 overflow-y-auto">
          {/* Brand & Live Daemon Sync Status */}
          <div className="flex items-center justify-between px-1.5">
            <div className="flex items-center gap-2.5">
              <div className="h-6 w-6 rounded-lg bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center text-white font-bold text-xs shadow">
                S
              </div>
              <span className="text-sm font-semibold tracking-tight text-white">
                Sunsama
              </span>
            </div>
            <button
              type="button"
              onClick={loadData}
              title="Sync with Mac Daemon & Supabase"
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

          {/* Primary Sunsama Navigation & Daily Rituals */}
          <nav className="space-y-1">
            <button
              type="button"
              onClick={() => setActiveModal('none')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeModal === 'none'
                  ? 'bg-white/[0.08] text-white'
                  : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
              }`}
            >
              <span className="flex items-center gap-2">
                <Columns className="h-3.5 w-3.5 text-indigo-400" />
                <span>Daily Kanban</span>
              </span>
              <span className="text-[10px] text-slate-500">
                {todayTasks.filter((t) => t.status !== 'completed').length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveModal('morning_plan')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeModal === 'morning_plan'
                  ? 'bg-indigo-500/20 text-indigo-300'
                  : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
              }`}
            >
              <span className="flex items-center gap-2">
                <Sun className="h-3.5 w-3.5 text-amber-400" />
                <span>Plan My Day</span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                const first = todayTasks.find((t) => t.status !== 'completed');
                if (first) {
                  setFocusTaskId(first.id);
                  setFocusElapsedSeconds(first.actualSeconds || 0);
                }
                setActiveModal('focus_mode');
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeModal === 'focus_mode'
                  ? 'bg-indigo-500/20 text-indigo-300'
                  : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
              }`}
            >
              <span className="flex items-center gap-2">
                <Play className="h-3.5 w-3.5 text-emerald-400" />
                <span>Focus Mode</span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveModal('evening_shutdown')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeModal === 'evening_shutdown'
                  ? 'bg-purple-500/20 text-purple-300'
                  : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
              }`}
            >
              <span className="flex items-center gap-2">
                <Moon className="h-3.5 w-3.5 text-purple-400" />
                <span>Daily Shutdown</span>
              </span>
            </button>
          </nav>

          {/* Workspace Pane Toggles */}
          <div className="space-y-1 pt-2 border-t border-white/[0.06]">
            <div className="px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Panels
            </div>
            <button
              type="button"
              onClick={() => setShowBacklogDrawer((v) => !v)}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                showBacklogDrawer
                  ? 'bg-white/[0.06] text-slate-200'
                  : 'text-slate-500 hover:bg-white/[0.04]'
              }`}
            >
              <span className="flex items-center gap-2">
                <Inbox className="h-3.5 w-3.5" />
                <span>Backlog Drawer</span>
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/[0.06]">
                {backlogTasks.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setShowCalendarPane((v) => !v)}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                showCalendarPane
                  ? 'bg-white/[0.06] text-slate-200'
                  : 'text-slate-500 hover:bg-white/[0.04]'
              }`}
            >
              <span className="flex items-center gap-2">
                <CalendarIcon className="h-3.5 w-3.5" />
                <span>Calendar Timeline</span>
              </span>
              <span className="text-[10px] text-slate-500">
                {showCalendarPane ? 'On' : 'Off'}
              </span>
            </button>
          </div>

          {/* Channels List (#turn90, #843fc, etc.) */}
          <div className="space-y-1 pt-2 border-t border-white/[0.06]">
            <div className="px-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Channels
              </span>
              {selectedChannelTag !== 'all' && (
                <button
                  type="button"
                  onClick={() => setSelectedChannelTag('all')}
                  className="text-[10px] text-indigo-400 hover:underline"
                >
                  All
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setSelectedChannelTag('all')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                selectedChannelTag === 'all'
                  ? 'bg-white/[0.08] text-white font-medium'
                  : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
              }`}
            >
              <span className="flex items-center gap-2">
                <Hash className="h-3 w-3 text-slate-400" />
                <span>All Channels</span>
              </span>
              <span className="text-[10px] text-slate-500">
                {tasks.filter((t) => t.status !== 'completed').length}
              </span>
            </button>

            {SUNSAMA_CHANNELS.map((ch) => {
              const count = tasks.filter(
                (t) => t.status !== 'completed' && getChannelForTask(t).tag === ch.tag
              ).length;
              const isSelected = selectedChannelTag === ch.tag;
              return (
                <button
                  key={ch.tag}
                  type="button"
                  onClick={() =>
                    setSelectedChannelTag(isSelected ? 'all' : ch.tag)
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
                      style={{ backgroundColor: ch.color }}
                    />
                    <span className="truncate">#{ch.label}</span>
                  </span>
                  {count > 0 && (
                    <span className="text-[10px] text-slate-500">{count}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer Daemon Note */}
        <div className="p-3 border-t border-white/[0.06] text-[11px] text-slate-500">
          <div className="flex items-center gap-1.5 text-slate-400 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span>Mac Daemon Sync Active</span>
          </div>
          <p className="mt-0.5 text-[10px] text-slate-500">
            Gmail, Slack & Letterly tasks flow into Backlog automatically.
          </p>
        </div>
      </aside>

      {/* 2. CENTER SUNSAMA MULTI-COLUMN KANBAN WORKSPACE */}
      <main className="flex-1 flex overflow-x-auto overflow-y-hidden bg-[#111318]">
        {/* COLUMN A: BACKLOG DRAWER (Toggleable) */}
        {showBacklogDrawer && (
          <section
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverTarget('backlog');
            }}
            onDragLeave={() => setDragOverTarget(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverTarget(null);
              const id = e.dataTransfer.getData('text/plain') || draggedTaskId;
              const task = tasks.find((t) => t.id === id);
              if (task) moveTaskToBucket(task, 'backlog');
            }}
            className={`w-80 shrink-0 border-r border-white/[0.06] bg-[#14171F] flex flex-col transition-colors ${
              dragOverTarget === 'backlog' ? 'bg-indigo-950/20' : ''
            }`}
          >
            {/* Column Header */}
            <div className="p-4 border-b border-white/[0.06] space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Inbox className="h-4 w-4 text-slate-400" />
                  <h2 className="text-sm font-semibold text-white">Backlog</h2>
                  <span className="text-xs text-slate-500 font-mono">
                    {backlogTasks.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowBacklogDrawer(false)}
                  className="text-slate-500 hover:text-slate-300"
                  title="Hide Backlog"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Search Backlog */}
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={backlogSearch}
                  onChange={(e) => setBacklogSearch(e.target.value)}
                  placeholder="Filter backlog tasks..."
                  className="w-full bg-[#1B1E26] border border-white/[0.06] rounded-lg pl-8 pr-3 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/50"
                />
              </div>
            </div>

            {/* Inline Add Task to Backlog */}
            <div className="px-3.5 pt-3">
              {addingInColumn === 'backlog' ? (
                <div className="rounded-xl bg-[#1B1E26] border border-indigo-500/50 p-2.5">
                  <input
                    autoFocus
                    type="text"
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateTaskInBucket('backlog');
                      if (e.key === 'Escape') {
                        setAddingInColumn(null);
                        setNewTaskTitle('');
                      }
                    }}
                    placeholder="Task title (e.g. Review report #turn90 15m)..."
                    className="w-full bg-transparent text-xs text-white placeholder:text-slate-500 focus:outline-none"
                  />
                  <div className="mt-2 flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setAddingInColumn(null);
                        setNewTaskTitle('');
                      }}
                      className="px-2 py-1 text-[10px] text-slate-400 hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCreateTaskInBucket('backlog')}
                      className="px-2.5 py-1 rounded bg-indigo-600 text-white text-[10px] font-semibold"
                    >
                      Add
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setAddingInColumn('backlog');
                    setNewTaskTitle('');
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add task</span>
                </button>
              )}
            </div>

            {/* Backlog Cards List */}
            <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5">
              {backlogTasks.map((t) => renderTaskCard(t, 'backlog'))}
              {backlogTasks.length === 0 && (
                <div className="text-center py-12 px-4 text-xs text-slate-500">
                  No tasks in Backlog.
                </div>
              )}
            </div>
          </section>
        )}

        {/* COLUMN B: TODAY */}
        <section
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverTarget('today');
          }}
          onDragLeave={() => setDragOverTarget(null)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOverTarget(null);
            const id = e.dataTransfer.getData('text/plain') || draggedTaskId;
            const task = tasks.find((t) => t.id === id);
            if (task) moveTaskToBucket(task, 'today');
          }}
          className={`flex-1 min-w-[330px] max-w-[440px] border-r border-white/[0.06] flex flex-col transition-colors ${
            dragOverTarget === 'today' ? 'bg-indigo-950/15' : ''
          }`}
        >
          {/* Sunsama Day Column Header + Workload Bar */}
          <div className="p-4 border-b border-white/[0.06] space-y-2">
            <div className="flex items-baseline justify-between">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <span>Today</span>
                  <span className="text-xs font-normal text-slate-400">
                    {now.toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </h2>
              </div>

              <div className="flex items-center gap-2 text-[11px] font-mono">
                {todayTotalPlannedMinutes > DAILY_TARGET_MINUTES && (
                  <span title="Over 6h daily workload target">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                  </span>
                )}
                <span className="text-slate-400">
                  {formatDurationShort(todayCompletedMinutes)} /{' '}
                  <strong
                    className={
                      todayTotalPlannedMinutes > DAILY_TARGET_MINUTES
                        ? 'text-amber-400'
                        : 'text-slate-200'
                    }
                  >
                    {formatDurationShort(todayTotalPlannedMinutes)}
                  </strong>
                </span>
              </div>
            </div>

            {/* Sunsama Thin Workload Capacity Bar */}
            <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden flex">
              <div
                className="bg-emerald-500 transition-all"
                style={{
                  width: `${Math.min(
                    100,
                    (todayCompletedMinutes / Math.max(DAILY_TARGET_MINUTES, todayTotalPlannedMinutes, 60)) * 100
                  )}%`,
                }}
              />
              <div
                className={`${
                  todayTotalPlannedMinutes > DAILY_TARGET_MINUTES
                    ? 'bg-amber-500'
                    : 'bg-indigo-500'
                } transition-all`}
                style={{
                  width: `${Math.min(
                    100,
                    (todayPendingMinutes / Math.max(DAILY_TARGET_MINUTES, todayTotalPlannedMinutes, 60)) * 100
                  )}%`,
                }}
              />
            </div>
          </div>

          {/* Inline "+ Add task" for Today */}
          <div className="px-4 pt-3">
            {addingInColumn === 'today' ? (
              <div className="rounded-xl bg-[#1B1E26] border border-indigo-500/50 p-2.5">
                <input
                  autoFocus
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateTaskInBucket('today');
                    if (e.key === 'Escape') {
                      setAddingInColumn(null);
                      setNewTaskTitle('');
                    }
                  }}
                  placeholder="Add task to Today (e.g. Call Jenn #turn90 15m)..."
                  className="w-full bg-transparent text-xs text-white placeholder:text-slate-500 focus:outline-none"
                />
                <div className="mt-2 flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setAddingInColumn(null);
                      setNewTaskTitle('');
                    }}
                    className="px-2 py-1 text-[10px] text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCreateTaskInBucket('today')}
                    className="px-2.5 py-1 rounded bg-indigo-600 text-white text-[10px] font-semibold"
                  >
                    Add to Today
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAddingInColumn('today');
                  setNewTaskTitle('');
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add task</span>
              </button>
            )}
          </div>

          {/* Today's Task Cards */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
            {todayTasks.map((t) => renderTaskCard(t, 'today'))}
            {todayTasks.length === 0 && (
              <div className="rounded-2xl border border-dashed border-white/[0.07] p-8 text-center my-4 space-y-2">
                <Sun className="h-6 w-6 text-amber-400/70 mx-auto" />
                <p className="text-xs font-medium text-slate-300">
                  Your Today board is light
                </p>
                <p className="text-[11px] text-slate-500">
                  Drag tasks from your Backlog or click Plan My Day to build a realistic schedule.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveModal('morning_plan')}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-xs font-medium"
                >
                  <Sparkles className="h-3 w-3" />
                  <span>Plan My Day</span>
                </button>
              </div>
            )}
          </div>
        </section>

        {/* COLUMN C: TOMORROW */}
        <section
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverTarget('tomorrow');
          }}
          onDragLeave={() => setDragOverTarget(null)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOverTarget(null);
            const id = e.dataTransfer.getData('text/plain') || draggedTaskId;
            const task = tasks.find((t) => t.id === id);
            if (task) moveTaskToBucket(task, 'tomorrow');
          }}
          className={`flex-1 min-w-[300px] max-w-[380px] border-r border-white/[0.06] flex flex-col transition-colors ${
            dragOverTarget === 'tomorrow' ? 'bg-indigo-950/15' : ''
          }`}
        >
          <div className="p-4 border-b border-white/[0.06] space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-base font-bold text-slate-200 flex items-center gap-2">
                <span>Tomorrow</span>
                <span className="text-xs font-normal text-slate-500">
                  {tomorrowStart.toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </h2>
              <span className="text-[11px] font-mono text-slate-400">
                {formatDurationShort(tomorrowPlannedMinutes)}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full bg-indigo-500/60 transition-all"
                style={{
                  width: `${Math.min(
                    100,
                    (tomorrowPlannedMinutes / DAILY_TARGET_MINUTES) * 100
                  )}%`,
                }}
              />
            </div>
          </div>

          <div className="px-4 pt-3">
            {addingInColumn === 'tomorrow' ? (
              <div className="rounded-xl bg-[#1B1E26] border border-indigo-500/50 p-2.5">
                <input
                  autoFocus
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateTaskInBucket('tomorrow');
                    if (e.key === 'Escape') {
                      setAddingInColumn(null);
                      setNewTaskTitle('');
                    }
                  }}
                  placeholder="Add task to Tomorrow..."
                  className="w-full bg-transparent text-xs text-white placeholder:text-slate-500 focus:outline-none"
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAddingInColumn('tomorrow');
                  setNewTaskTitle('');
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add task</span>
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
            {tomorrowTasks.map((t) => renderTaskCard(t, 'tomorrow'))}
          </div>
        </section>

        {/* COLUMN D: UPCOMING / DAY AFTER TOMORROW */}
        <section
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverTarget('later');
          }}
          onDragLeave={() => setDragOverTarget(null)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOverTarget(null);
            const id = e.dataTransfer.getData('text/plain') || draggedTaskId;
            const task = tasks.find((t) => t.id === id);
            if (task) moveTaskToBucket(task, 'later');
          }}
          className={`flex-1 min-w-[280px] max-w-[360px] flex flex-col transition-colors ${
            dragOverTarget === 'later' ? 'bg-indigo-950/15' : ''
          }`}
        >
          <div className="p-4 border-b border-white/[0.06] space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-base font-bold text-slate-300 flex items-center gap-2">
                <span>
                  {dayAfterStart.toLocaleDateString('en-US', {
                    weekday: 'long',
                  })}
                </span>
                <span className="text-xs font-normal text-slate-500">
                  {dayAfterStart.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </h2>
              <span className="text-[11px] font-mono text-slate-400">
                {formatDurationShort(laterPlannedMinutes)}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full bg-indigo-500/40 transition-all"
                style={{
                  width: `${Math.min(
                    100,
                    (laterPlannedMinutes / DAILY_TARGET_MINUTES) * 100
                  )}%`,
                }}
              />
            </div>
          </div>

          <div className="px-4 pt-3">
            {addingInColumn === 'later' ? (
              <div className="rounded-xl bg-[#1B1E26] border border-indigo-500/50 p-2.5">
                <input
                  autoFocus
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateTaskInBucket('later');
                    if (e.key === 'Escape') {
                      setAddingInColumn(null);
                      setNewTaskTitle('');
                    }
                  }}
                  placeholder="Add task..."
                  className="w-full bg-transparent text-xs text-white placeholder:text-slate-500 focus:outline-none"
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAddingInColumn('later');
                  setNewTaskTitle('');
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add task</span>
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
            {laterTasks.map((t) => renderTaskCard(t, 'later'))}
          </div>
        </section>
      </main>

      {/* 3. RIGHT SUNSAMA 24-HOUR CALENDAR & TIMEBOX TIMELINE */}
      {showCalendarPane && (
        <aside className="w-80 bg-[#151820] border-l border-white/[0.06] flex flex-col shrink-0 select-none">
          {/* Calendar Header */}
          <div className="p-4 border-b border-white/[0.06] flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <CalendarIcon className="h-3.5 w-3.5 text-indigo-400" />
                <span>Calendar</span>
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Drag tasks onto any hour to timebox
              </p>
            </div>

            <button
              type="button"
              onClick={handleAutoTimeboxToday}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 text-[11px] font-semibold transition-colors"
              title="Automatically slot un-timeboxed Today tasks into free calendar hours"
            >
              <Sparkles className="h-3 w-3" />
              <span>Auto-Slot</span>
            </button>
          </div>

          {/* Hourly Grid (7 AM - 8 PM) */}
          <div className="flex-1 overflow-y-auto px-3 py-2 divide-y divide-white/[0.05]">
            {TIMELINE_HOURS.map((hour) => {
              const isCurrentHour = now.getHours() === hour;
              const slottedHere = todayTasks.filter((t) => {
                if (!isTimeboxedDate(t.dueDate) || !t.dueDate) return false;
                return new Date(t.dueDate).getHours() === hour;
              });

              const dropKey = `hour-${hour}`;

              return (
                <div
                  key={hour}
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
                    if (task) scheduleTaskAtHour(task, hour, 0);
                  }}
                  className={`relative min-h-[60px] py-2 flex items-start gap-2.5 transition-colors ${
                    dragOverTarget === dropKey ? 'bg-indigo-500/15 rounded-lg' : ''
                  }`}
                >
                  {/* Hour Label */}
                  <div className="w-12 text-right pr-1 shrink-0">
                    <span
                      className={`text-[10px] font-mono ${
                        isCurrentHour
                          ? 'text-rose-400 font-bold'
                          : 'text-slate-500'
                      }`}
                    >
                      {formatHourLabel(hour)}
                    </span>
                  </div>

                  {/* Current Time Red Line */}
                  {isCurrentHour && (
                    <div
                      className="absolute left-12 right-1 h-[1.5px] bg-rose-500 z-10 pointer-events-none flex items-center"
                      style={{
                        top: `${Math.min(95, Math.max(5, (now.getMinutes() / 60) * 100))}%`,
                      }}
                    >
                      <span className="h-2 w-2 rounded-full bg-rose-500 -ml-1" />
                    </div>
                  )}

                  {/* Slotted Events & Timeboxed Tasks */}
                  <div className="flex-1 space-y-1.5 min-w-0">
                    {slottedHere.map((t) => {
                      const ch = getChannelForTask(t);
                      const isMeeting = isCalendarMeetingTask(t);
                      return (
                        <div
                          key={t.id}
                          onClick={() => setInspectingTaskId(t.id)}
                          className={`group rounded-lg px-2.5 py-1.5 border text-xs cursor-pointer flex items-center justify-between gap-2 ${
                            isMeeting
                              ? 'bg-sky-500/15 border-sky-500/30 text-sky-100'
                              : 'bg-indigo-500/15 border-indigo-500/30 text-slate-100'
                          }`}
                          style={
                            !isMeeting
                              ? {
                                  borderLeftWidth: '3px',
                                  borderLeftColor: ch.color,
                                }
                              : undefined
                          }
                        >
                          <div className="min-w-0 flex-1">
                            <p
                              className={`text-[11px] font-semibold truncate ${
                                t.status === 'completed'
                                  ? 'line-through opacity-60'
                                  : ''
                              }`}
                            >
                              {t.title}
                            </p>
                            {t.dueDate && (
                              <p className="text-[10px] text-slate-400 font-mono">
                                {formatTimeRange(
                                  t.dueDate,
                                  t.estimatedMinutes || 15
                                )}
                              </p>
                            )}
                          </div>

                          <button
                            type="button"
                            title="Remove from timeline"
                            onClick={(e) => {
                              e.stopPropagation();
                              clearTaskTimebox(t);
                            }}
                            className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-white p-0.5"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      )}

      {/* 4. TASK DETAIL MODAL (SUNSAMA TASK INSPECTOR) */}
      {inspectingTask && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setInspectingTaskId(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-[#181B23] border border-white/10 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top Bar */}
            <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <select
                  value={getChannelForTask(inspectingTask).tag}
                  onChange={(e) =>
                    handleSetChannel(inspectingTask, e.target.value)
                  }
                  className="bg-white/[0.06] text-xs font-medium text-slate-200 rounded-lg px-2.5 py-1 focus:outline-none"
                >
                  {SUNSAMA_CHANNELS.map((c) => (
                    <option key={c.tag} value={c.tag} className="bg-[#181B23]">
                      #{c.label}
                    </option>
                  ))}
                </select>

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
                  onClick={() => handleDeleteTask(inspectingTask.id)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
                  title="Delete Task"
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

            {/* Body */}
            <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
              {/* Editable Title */}
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

              {/* Stage / Timebox Controls */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {(['backlog', 'today', 'tomorrow', 'later'] as const).map(
                  (b) => {
                    const active = classifyTaskBucket(inspectingTask) === b;
                    return (
                      <button
                        key={b}
                        type="button"
                        onClick={() => moveTaskToBucket(inspectingTask, b)}
                        className={`px-3 py-1 rounded-lg text-xs font-medium capitalize ${
                          active
                            ? 'bg-indigo-600 text-white'
                            : 'bg-white/[0.05] text-slate-400 hover:text-white'
                        }`}
                      >
                        {b}
                      </button>
                    );
                  }
                )}

                <select
                  value={
                    isTimeboxedDate(inspectingTask.dueDate) &&
                    inspectingTask.dueDate
                      ? new Date(inspectingTask.dueDate).getHours()
                      : ''
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!val) {
                      clearTaskTimebox(inspectingTask);
                    } else {
                      scheduleTaskAtHour(inspectingTask, parseInt(val, 10), 0);
                    }
                  }}
                  className="bg-white/[0.05] text-xs text-slate-300 rounded-lg px-2.5 py-1 focus:outline-none"
                >
                  <option value="" className="bg-[#181B23]">
                    🕒 Timebox hour...
                  </option>
                  {TIMELINE_HOURS.map((h) => (
                    <option key={h} value={h} className="bg-[#181B23]">
                      {formatHourLabel(h)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Subtasks Checklist */}
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

              {/* Clean Notes */}
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
                      tags: inspectingTask.tags,
                    });
                    patchTask(inspectingTask.id, { description: nextDesc });
                  }}
                  placeholder="Add notes or context..."
                  className="w-full bg-[#12141A] border border-white/[0.07] rounded-xl p-3 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. SUNSAMA MORNING PLANNING RITUAL MODAL */}
      {activeModal === 'morning_plan' && (
        <div className="fixed inset-0 z-50 bg-[#0E1015]/95 backdrop-blur-md flex items-center justify-center p-6">
          <div className="w-full max-w-3xl rounded-2xl bg-[#161922] border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-6 border-b border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                  <Sun className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">
                    Plan Your Day
                  </h2>
                  <p className="text-xs text-slate-400">
                    Pull high-leverage tasks from your Backlog into Today and timebox them onto your calendar.
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

            <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left: Unplanned Backlog */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Backlog ({backlogTasks.length})
                </h3>
                <div className="space-y-2">
                  {backlogTasks.map((t) => (
                    <div
                      key={t.id}
                      className="p-3 rounded-xl bg-[#1E222D] border border-white/[0.06] flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-white truncate">
                          {t.title}
                        </p>
                        <span className="text-[10px] text-slate-400">
                          #{getChannelForTask(t).label} • {t.estimatedMinutes}m
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => moveTaskToBucket(t, 'today')}
                        className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold shrink-0"
                      >
                        + Today
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: Today's Lineup */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-400">
                    Committed to Today (
                    {todayTasks.filter((t) => t.status !== 'completed').length})
                  </h3>
                  <span className="text-xs font-mono text-slate-300">
                    {formatDurationShort(todayPendingMinutes)} / 6h target
                  </span>
                </div>
                <div className="space-y-2">
                  {todayTasks
                    .filter((t) => t.status !== 'completed')
                    .map((t) => (
                      <div
                        key={t.id}
                        className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-white truncate">
                            {t.title}
                          </p>
                          <span className="text-[10px] text-indigo-300">
                            #{getChannelForTask(t).label} •{' '}
                            {t.estimatedMinutes}m
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => moveTaskToBucket(t, 'backlog')}
                          className="text-[11px] text-slate-400 hover:text-white"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            <div className="p-5 border-t border-white/[0.06] flex items-center justify-between bg-[#13161E]">
              <button
                type="button"
                onClick={async () => {
                  await handleAutoTimeboxToday();
                  setActiveModal('none');
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold"
              >
                <Sparkles className="h-4 w-4" />
                <span>Auto-Timebox Today & Finish Planning</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveModal('none')}
                className="px-4 py-2 rounded-xl bg-white/[0.06] text-xs font-semibold text-slate-300"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. SUNSAMA EVENING SHUTDOWN RITUAL MODAL */}
      {activeModal === 'evening_shutdown' && (
        <div className="fixed inset-0 z-50 bg-[#0E1015]/95 backdrop-blur-md flex items-center justify-center p-6">
          <div className="w-full max-w-lg rounded-2xl bg-[#161922] border border-white/10 shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center">
                  <Moon className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">
                    Daily Shutdown Ritual
                  </h2>
                  <p className="text-xs text-slate-400">
                    Wrap up your workday and roll unfinished tasks to Tomorrow.
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

            <div className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                  <div className="text-[10px] font-bold uppercase text-slate-400">
                    Completed Today
                  </div>
                  <div className="text-2xl font-bold text-emerald-400 mt-1">
                    {todayTasks.filter((t) => t.status === 'completed').length}{' '}
                    tasks
                  </div>
                  <div className="text-xs text-slate-500">
                    {formatDurationShort(todayCompletedMinutes)} total work
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                  <div className="text-[10px] font-bold uppercase text-slate-400">
                    Remaining on Today
                  </div>
                  <div className="text-2xl font-bold text-amber-400 mt-1">
                    {todayTasks.filter((t) => t.status !== 'completed').length}{' '}
                    tasks
                  </div>
                  <div className="text-xs text-slate-500">
                    {formatDurationShort(todayPendingMinutes)} remaining
                  </div>
                </div>
              </div>

              <div className="space-y-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => handleShutdownRollover('tomorrow')}
                  className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold"
                >
                  Roll Remaining Tasks to Tomorrow & Shut Down
                </button>
                <button
                  type="button"
                  onClick={() => handleShutdownRollover('backlog')}
                  className="w-full py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-slate-300 text-xs font-semibold"
                >
                  Return Remaining Tasks to Backlog
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 7. SUNSAMA FOCUS MODE OVERLAY */}
      {activeModal === 'focus_mode' && activeFocusTask && (
        <div className="fixed inset-0 z-50 bg-[#0D0F14] flex flex-col items-center justify-center p-6">
          <button
            type="button"
            onClick={() => {
              setFocusRunning(false);
              setActiveModal('none');
            }}
            className="absolute top-6 right-6 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-xs text-slate-300"
          >
            <X className="h-4 w-4" />
            <span>Exit Focus</span>
          </button>

          <div className="w-full max-w-xl text-center space-y-6">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.06] text-xs text-indigo-300 font-medium">
              #{getChannelForTask(activeFocusTask).label}
            </span>

            <h1 className="text-2xl font-bold text-white leading-snug">
              {activeFocusTask.title}
            </h1>

            {/* Giant Zen Timer */}
            <div className="text-6xl font-mono font-bold tracking-tight text-indigo-400">
              {formatTimerClock(focusElapsedSeconds)}
              <span className="text-lg text-slate-500 font-normal ml-3">
                / {activeFocusTask.estimatedMinutes || 15}m
              </span>
            </div>

            {/* Timer Controls */}
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setFocusRunning((r) => !r)}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold shadow-lg shadow-indigo-600/30"
              >
                {focusRunning ? (
                  <>
                    <Pause className="h-4 w-4" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-current" />
                    <span>Start Timer</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={async () => {
                  setFocusRunning(false);
                  await handleToggleComplete(activeFocusTask);
                  setActiveModal('none');
                }}
                className="flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>Complete Task</span>
              </button>
            </div>

            {/* Subtasks in Focus Mode */}
            {(activeFocusTask.subtasks || []).length > 0 && (
              <div className="mt-6 text-left bg-[#151821] border border-white/[0.07] rounded-2xl p-4 space-y-2">
                {activeFocusTask.subtasks.map((sub) => (
                  <div
                    key={sub.id}
                    onClick={() => handleToggleSubtask(activeFocusTask, sub.id)}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.04] cursor-pointer text-sm"
                  >
                    <div
                      className={`h-4 w-4 rounded border flex items-center justify-center ${
                        sub.isCompleted
                          ? 'bg-indigo-500 border-indigo-500 text-white'
                          : 'border-slate-500'
                      }`}
                    >
                      {sub.isCompleted && (
                        <Check className="h-3 w-3 stroke-[3]" />
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
            )}
          </div>
        </div>
      )}
    </div>
  );
}
