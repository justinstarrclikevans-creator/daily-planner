'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  supabase,
  Task,
  Project,
  DEFAULT_PROJECTS,
  extractSubtasks,
  serializeSubtasksIntoDescription,
  isTaskScheduledForFuture,
} from '@/lib/supabase';
import DraggableCard from '@/components/DraggableCard';
import ProjectStackWidget from '@/components/ProjectStackWidget';
import FocusBlotter from '@/components/FocusBlotter';
import SprintTimerModal from '@/components/SprintTimerModal';
import NewCardModal from '@/components/NewCardModal';
import {
  Plus,
  Grid,
  RotateCcw,
  Sparkles,
  Layers,
  ZoomIn,
  ZoomOut,
  Maximize2,
  CheckCircle2,
  RefreshCw,
  Folder,
} from 'lucide-react';

export default function DeskPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>(DEFAULT_PROJECTS);
  const [openProjectIds, setOpenProjectIds] = useState<Set<string>>(new Set());
  const [cardPositions, setCardPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [stackPositions, setStackPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [focusBlotterPosition, setFocusBlotterPosition] = useState({
    x: 420,
    y: 380,
    width: 760,
    height: 440,
  });
  const [showFocusBlotter, setShowFocusBlotter] = useState(true);
  const [activeSprintTask, setActiveSprintTask] = useState<Task | null>(null);
  const [isNewCardModalOpen, setIsNewCardModalOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'connected' | 'syncing' | 'offline'>('connected');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [activeFilterProject, setActiveFilterProject] = useState<string | null>(null);

  // Load Initial Data from Supabase
  const loadData = useCallback(async () => {
    setSyncStatus('syncing');
    try {
      // 1. Fetch Projects
      const { data: projData, error: projErr } = await supabase
        .from('projects')
        .select('*')
        .order('name');
      if (!projErr && projData && projData.length > 0) {
        setProjects(projData);
      } else {
        setProjects(DEFAULT_PROJECTS);
      }

      // 2. Fetch Tasks
      const { data: taskData, error: taskErr } = await supabase
        .from('tasks')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (!taskErr && taskData) {
        const parsedTasks: Task[] = taskData.map((row: any) => {
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

        // Filter out future/deferred tasks from the active desk
        const activeToday = parsedTasks.filter((t) => !isTaskScheduledForFuture(t.dueDate));
        setTasks(activeToday);
      }
      setSyncStatus('connected');
    } catch (err) {
      console.error('Error fetching desk data:', err);
      setSyncStatus('offline');
    }
  }, []);

  // Initialize and load saved positions from localStorage
  useEffect(() => {
    loadData();

    // Load saved positions
    try {
      const savedCardPos = localStorage.getItem('desk_card_positions');
      if (savedCardPos) setCardPositions(JSON.parse(savedCardPos));

      const savedStackPos = localStorage.getItem('desk_stack_positions');
      if (savedStackPos) setStackPositions(JSON.parse(savedStackPos));

      const savedOpenProjects = localStorage.getItem('desk_open_projects');
      if (savedOpenProjects) setOpenProjectIds(new Set(JSON.parse(savedOpenProjects)));
    } catch {}

    // Subscribe to real-time changes on tasks
    const channel = supabase
      .channel('desk-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks' },
        () => {
          loadData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData]);

  // Save positions to localStorage when updated
  const updateCardPosition = (taskId: string, x: number, y: number) => {
    setCardPositions((prev) => {
      const updated = { ...prev, [taskId]: { x, y } };
      try {
        localStorage.setItem('desk_card_positions', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const updateStackPosition = (projectId: string, x: number, y: number) => {
    setStackPositions((prev) => {
      const updated = { ...prev, [projectId]: { x, y } };
      try {
        localStorage.setItem('desk_stack_positions', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  // Toggle spreading out or gathering in a project stack
  const toggleProjectOpen = (projectId: string) => {
    setOpenProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
        // Position cards for this project neatly near the stack if unpositioned
        const stackPos = stackPositions[projectId] || getInitialStackPosition(projectId);
        const projectTasks = tasks.filter((t) => isTaskInProject(t, projectId));
        projectTasks.forEach((task, idx) => {
          if (!cardPositions[task.id]) {
            const cardX = stackPos.x + 320 + (idx % 3) * 360;
            const cardY = stackPos.y + Math.floor(idx / 3) * 320;
            updateCardPosition(task.id, cardX, cardY);
          }
        });
      }
      try {
        localStorage.setItem('desk_open_projects', JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  };

  // Helper: check if task belongs to a project
  const isTaskInProject = (task: Task, projectId: string) => {
    if (task.projectId === projectId) return true;
    const proj = projects.find((p) => p.id === projectId);
    return proj ? task.listName.toLowerCase() === proj.name.toLowerCase() : false;
  };

  // Default coordinate helpers
  const getInitialStackPosition = (projectId: string) => {
    const idx = projects.findIndex((p) => p.id === projectId);
    const validIdx = idx >= 0 ? idx : 0;
    return {
      x: 40 + validIdx * 320,
      y: 90,
    };
  };

  const getCardPosition = (taskId: string, projectId: string, idx: number) => {
    if (cardPositions[taskId]) return cardPositions[taskId];
    const stackPos = stackPositions[projectId] || getInitialStackPosition(projectId);
    return {
      x: stackPos.x + 10 + (idx % 2) * 360,
      y: stackPos.y + 260 + Math.floor(idx / 2) * 340,
    };
  };

  // Tidy Desk Action: Auto-arranges all open cards in clean columns under their stacks
  const tidyDesk = () => {
    const newCardPos: Record<string, { x: number; y: number }> = {};
    const newStackPos: Record<string, { x: number; y: number }> = {};

    projects.forEach((proj, pIdx) => {
      const sX = 40 + pIdx * 330;
      const sY = 90;
      newStackPos[proj.id] = { x: sX, y: sY };

      const pTasks = tasks.filter((t) => isTaskInProject(t, proj.id));
      pTasks.forEach((task, tIdx) => {
        newCardPos[task.id] = {
          x: sX,
          y: sY + 260 + tIdx * 340,
        };
      });
    });

    setStackPositions(newStackPos);
    setCardPositions(newCardPos);
    try {
      localStorage.setItem('desk_stack_positions', JSON.stringify(newStackPos));
      localStorage.setItem('desk_card_positions', JSON.stringify(newCardPos));
    } catch {}
  };

  // Toggle Subtask
  const handleToggleSubtask = async (taskId: string, subtaskId: string) => {
    const taskIndex = tasks.findIndex((t) => t.id === taskId);
    if (taskIndex === -1) return;

    const task = tasks[taskIndex];
    const updatedSubtasks = task.subtasks.map((s) =>
      s.id === subtaskId ? { ...s, isCompleted: !s.isCompleted } : s
    );

    const updatedDesc = serializeSubtasksIntoDescription(task.description, updatedSubtasks);

    // Optimistic UI
    const updatedTask = {
      ...task,
      subtasks: updatedSubtasks,
      description: updatedDesc,
    };
    const nextTasks = [...tasks];
    nextTasks[taskIndex] = updatedTask;
    setTasks(nextTasks);

    // Sync to Supabase
    try {
      await supabase
        .from('tasks')
        .update({
          subtasks: updatedSubtasks,
          description: updatedDesc,
          updated_at: new Date().toISOString(),
        })
        .eq('id', taskId);
    } catch (e) {
      console.error('Failed to sync subtask:', e);
    }
  };

  // Mark Task Completed
  const handleCompleteTask = async (taskId: string) => {
    // Optimistic removal from desk
    setTasks((prev) => prev.filter((t) => t.id !== taskId));

    try {
      await supabase
        .from('tasks')
        .update({
          status: 'completed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', taskId);
    } catch (e) {
      console.error('Failed to mark task complete:', e);
    }
  };

  // Defer Task to Later (Tomorrow)
  const handleLaterTask = async (taskId: string) => {
    // Optimistic removal from today's desk
    setTasks((prev) => prev.filter((t) => t.id !== taskId));

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);

    try {
      await supabase
        .from('tasks')
        .update({
          due_date: tomorrow.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', taskId);
    } catch (e) {
      console.error('Failed to defer task to later:', e);
    }
  };

  // Create New Card
  const handleCreateCard = async (taskData: {
    title: string;
    projectId?: string;
    listName: string;
    estimatedMinutes: number;
    firstFiveMinutes?: string;
    subtasks: { title: string; isCompleted: boolean }[];
  }) => {
    const rawDesc = taskData.subtasks.map((s) => `- [ ] ${s.title}`).join('\n');
    const newId = crypto.randomUUID();

    const newTask: Task = {
      id: newId,
      projectId: taskData.projectId,
      title: taskData.title,
      description: rawDesc,
      listName: taskData.listName,
      status: 'pending',
      estimatedMinutes: taskData.estimatedMinutes,
      inPlayQueue: false,
      firstFiveMinutes: taskData.firstFiveMinutes,
      subtasks: taskData.subtasks.map((s) => ({ ...s, id: crypto.randomUUID() })),
      createdAt: new Date().toISOString(),
    };

    setTasks((prev) => [newTask, ...prev]);

    // Position new card in visible view near center
    updateCardPosition(newId, 450, 220);

    // Make sure project stack is open so card is visible
    if (taskData.projectId) {
      setOpenProjectIds((prev) => new Set([...prev, taskData.projectId!]));
    }

    try {
      await supabase.from('tasks').insert({
        id: newId,
        project_id: taskData.projectId,
        title: taskData.title,
        description: rawDesc,
        list_name: taskData.listName,
        status: 'pending',
        estimated_minutes: taskData.estimatedMinutes,
        first_five_minutes: taskData.firstFiveMinutes,
        subtasks: newTask.subtasks,
        source: 'webapp-desk',
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      console.error('Failed to insert new card into Supabase:', e);
    }
  };

  // Determine active cards to render
  const visibleCards = tasks.filter((t) => {
    if (activeFilterProject && t.projectId !== activeFilterProject) return false;
    // Check if its project stack is currently open or if card has explicit position
    const proj = projects.find((p) => isTaskInProject(t, p.id));
    if (proj && openProjectIds.has(proj.id)) return true;
    return false;
  });

  // Calculate active focus cards inside blotter
  const blotterCardsCount = visibleCards.filter((t) => {
    const pos = cardPositions[t.id];
    if (!pos) return false;
    return (
      pos.x >= focusBlotterPosition.x &&
      pos.x <= focusBlotterPosition.x + focusBlotterPosition.width - 200 &&
      pos.y >= focusBlotterPosition.y &&
      pos.y <= focusBlotterPosition.y + focusBlotterPosition.height - 200
    );
  }).length;

  return (
    <div className="relative h-screen w-screen overflow-hidden desk-surface text-slate-100 flex flex-col">
      {/* =========================================================================
          Top Desk Sticky Command Bar
          ========================================================================= */}
      <header className="z-40 flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-slate-950/80 px-6 backdrop-blur-md">
        {/* Brand & Live Sync Pill */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-base font-black shadow-md shadow-indigo-600/30">
              🗂️
            </span>
            <span className="font-black text-base tracking-tight text-white">
              Card Stacks Desk
            </span>
          </div>

          <div className="flex items-center gap-1.5 rounded-full bg-slate-900 border border-white/10 px-2.5 py-0.5 text-[11px] font-semibold">
            <span
              className={`h-2 w-2 rounded-full ${
                syncStatus === 'connected'
                  ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                  : syncStatus === 'syncing'
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-red-500'
              }`}
            />
            <span className="text-slate-300">
              {syncStatus === 'connected'
                ? 'Live Sync'
                : syncStatus === 'syncing'
                ? 'Syncing...'
                : 'Offline'}
            </span>
          </div>

          <div className="hidden lg:flex items-center gap-2 pl-2 text-xs font-medium text-slate-400 border-l border-white/10">
            <span>{tasks.length} Active Cards</span>
            <span>•</span>
            <span>{openProjectIds.size} Stacks Open</span>
          </div>
        </div>

        {/* Project Quick-Filter Chips */}
        <div className="hidden md:flex items-center gap-1.5 overflow-x-auto py-1">
          <button
            type="button"
            onClick={() => setActiveFilterProject(null)}
            className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${
              activeFilterProject === null
                ? 'bg-white/15 text-white'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            All Decks
          </button>
          {projects.map((p) => {
            const count = tasks.filter((t) => isTaskInProject(t, p.id)).length;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  setActiveFilterProject(activeFilterProject === p.id ? null : p.id)
                }
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${
                  activeFilterProject === p.id
                    ? 'bg-white/20 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: p.color }}
                />
                <span>{p.name}</span>
                <span className="text-[10px] opacity-60 font-mono">({count})</span>
              </button>
            );
          })}
        </div>

        {/* Desk Controls & New Card Button */}
        <div className="flex items-center gap-2.5">
          {/* Tidy Desk Button */}
          <button
            type="button"
            onClick={tidyDesk}
            title="Auto-organize open cards into clean columns"
            className="flex items-center gap-1.5 rounded-lg bg-slate-900 border border-white/10 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-800 transition-colors shadow-sm"
          >
            <Grid className="h-3.5 w-3.5 text-indigo-400" />
            <span className="hidden sm:inline">Tidy Desk</span>
          </button>

          {/* Focus Blotter Toggle */}
          <button
            type="button"
            onClick={() => setShowFocusBlotter(!showFocusBlotter)}
            title="Toggle Focus Blotter mat in center of desk"
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors shadow-sm ${
              showFocusBlotter
                ? 'bg-indigo-950/60 border-indigo-500/40 text-indigo-200'
                : 'bg-slate-900 border-white/10 text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 text-amber-400" />
            <span className="hidden sm:inline">Focus Blotter</span>
          </button>

          {/* Refresh Data */}
          <button
            type="button"
            onClick={loadData}
            title="Refresh from Apple Reminders / Supabase"
            className="rounded-lg bg-slate-900 border border-white/10 p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
          </button>

          {/* New Card Modal Button */}
          <button
            type="button"
            onClick={() => setIsNewCardModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 transition-colors shadow-md shadow-indigo-600/30"
          >
            <Plus className="h-4 w-4 stroke-[2.5]" />
            <span>New Card</span>
          </button>
        </div>
      </header>

      {/* =========================================================================
          Freeform Desk Surface (Scrollable / Panning 2D Workspace)
          ========================================================================= */}
      <main className="relative flex-1 overflow-auto">
        <div
          style={{
            transform: `scale(${zoomLevel})`,
            transformOrigin: 'top left',
            width: '2800px',
            height: '2000px',
          }}
          className="relative min-w-[2800px] min-h-[2000px]"
        >
          {/* Today's Focus Desk Blotter Pad (Center Mat) */}
          {showFocusBlotter && (
            <FocusBlotter
              position={focusBlotterPosition}
              activeFocusCount={blotterCardsCount}
            />
          )}

          {/* Project Stack Widgets Sitting on Desk */}
          {projects.map((project) => {
            const projectTasks = tasks.filter((t) => isTaskInProject(t, project.id));
            const pos = stackPositions[project.id] || getInitialStackPosition(project.id);
            const isOpen = openProjectIds.has(project.id);

            return (
              <ProjectStackWidget
                key={project.id}
                project={project}
                tasks={projectTasks}
                isOpen={isOpen}
                position={pos}
                onToggleOpen={toggleProjectOpen}
                onMove={updateStackPosition}
              />
            );
          })}

          {/* Draggable 3x5 Physical Index Cards Spread Out Across Desk */}
          {visibleCards.map((task, idx) => {
            const proj = projects.find((p) => isTaskInProject(task, p.id));
            const pos = getCardPosition(task.id, proj?.id || '', idx);

            return (
              <DraggableCard
                key={task.id}
                task={task}
                project={proj}
                position={pos}
                onMove={updateCardPosition}
                onToggleSubtask={handleToggleSubtask}
                onComplete={handleCompleteTask}
                onLater={handleLaterTask}
                onStartSprint={(t) => setActiveSprintTask(t)}
              />
            );
          })}
        </div>
      </main>

      {/* =========================================================================
          Modals: 5m Sprint Timer & New Card Creator
          ========================================================================= */}
      {activeSprintTask && (
        <SprintTimerModal
          task={activeSprintTask}
          onClose={() => setActiveSprintTask(null)}
          onComplete={handleCompleteTask}
        />
      )}

      {isNewCardModalOpen && (
        <NewCardModal
          projects={projects}
          defaultProjectId={activeFilterProject || undefined}
          onClose={() => setIsNewCardModalOpen(false)}
          onCreate={handleCreateCard}
        />
      )}
    </div>
  );
}
