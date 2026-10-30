'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  supabase,
  Task,
  Project,
  TaskPriority,
  DEFAULT_PROJECTS,
  matchTaskToProject,
  serializeSubtasksIntoDescription,
  isTaskScheduledForFuture,
} from '@/lib/supabase';
import { determineProjectForTask, createProjectFromTask } from '@/lib/routing';
import { ProjectSidebar } from '@/components/ProjectSidebar';
import { FilterToolbar, DurationFilter } from '@/components/FilterToolbar';
import { TaskRow } from '@/components/TaskRow';
import { BuildMyDayModal } from '@/components/BuildMyDayModal';
import { ConvertToProjectModal } from '@/components/ConvertToProjectModal';
import { ProjectSettingsModal } from '@/components/ProjectSettingsModal';
import SprintTimerModal from '@/components/SprintTimerModal';
import NewCardModal from '@/components/NewCardModal';
import {
  Sparkles,
  Plus,
  RefreshCw,
  Layers,
  Settings,
  CheckCircle2,
  Inbox,
  Flame,
} from 'lucide-react';

export default function WorkspacePage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>(DEFAULT_PROJECTS);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // Filters
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | 'all'>('all');
  const [durationFilter, setDurationFilter] = useState<DurationFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [isBuildMyDayOpen, setIsBuildMyDayOpen] = useState(false);
  const [isNewTaskOpen, setIsNewTaskOpen] = useState(false);
  const [isConvertToProjectOpen, setIsConvertToProjectOpen] = useState(false);
  const [taskToConvert, setTaskToConvert] = useState<Task | null>(null);
  const [isProjectSettingsOpen, setIsProjectSettingsOpen] = useState(false);
  const [projectToEdit, setProjectToEdit] = useState<Project | null>(null);
  const [activeSprintTask, setActiveSprintTask] = useState<Task | null>(null);

  const [syncStatus, setSyncStatus] = useState<'connected' | 'syncing' | 'error'>('syncing');

  // Load Data
  const loadData = useCallback(async () => {
    setSyncStatus('syncing');
    try {
      const res = await fetch('/api/desk', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const currentProjects =
        json.projects && json.projects.length > 0 ? json.projects : DEFAULT_PROJECTS;
      setProjects(currentProjects);

      if (json.tasks && Array.isArray(json.tasks)) {
        const mapped = json.tasks
          .filter((t: Task) => t.status !== 'completed' && !isTaskScheduledForFuture(t.dueDate))
          .map((t: Task) => {
            const matchedProj = matchTaskToProject(t, currentProjects);
            return {
              ...t,
              projectId: t.projectId || matchedProj.id,
              listName: t.listName || matchedProj.name,
              priority: t.priority || 'medium',
              estimatedMinutes: t.estimatedMinutes || 15,
            };
          });
        setTasks(mapped);
      }

      setSyncStatus('connected');
    } catch (err) {
      console.warn('API fetch failed, falling back:', err);
      setSyncStatus('error');
    }
  }, []);

  useEffect(() => {
    loadData();

    // Supabase Real-time updates subscription
    const channel = supabase
      .channel('tasks-workspace-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        loadData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData]);

  // Selected project object
  const activeProject = useMemo(() => {
    if (!selectedProjectId) return null;
    return projects.find((p) => p.id === selectedProjectId) || null;
  }, [projects, selectedProjectId]);

  // Filtered Tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      // 1. Project filter
      if (selectedProjectId && task.projectId !== selectedProjectId) {
        return false;
      }

      // 2. Priority filter
      if (priorityFilter !== 'all' && task.priority !== priorityFilter) {
        return false;
      }

      // 3. Duration filter
      if (durationFilter === 'quick' && task.estimatedMinutes > 15) {
        return false;
      }
      if (durationFilter === 'medium' && (task.estimatedMinutes < 15 || task.estimatedMinutes > 30)) {
        return false;
      }
      if (durationFilter === 'deep' && task.estimatedMinutes <= 30) {
        return false;
      }

      // 4. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const inTitle = task.title.toLowerCase().includes(q);
        const inSubs = task.subtasks?.some((s) => s.title.toLowerCase().includes(q));
        if (!inTitle && !inSubs) return false;
      }

      return true;
    });
  }, [tasks, selectedProjectId, priorityFilter, durationFilter, searchQuery]);

  // Task Handlers
  const handleToggleComplete = async (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));

    try {
      await fetch('/api/desk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: taskId,
          status: 'completed',
          updated_at: new Date().toISOString(),
        }),
      });
    } catch (e) {
      console.error('Failed to complete task:', e);
    }
  };

  const handleUpdatePriority = async (taskId: string, priority: TaskPriority) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, priority } : t))
    );

    try {
      await fetch('/api/desk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: taskId,
          priority,
          updated_at: new Date().toISOString(),
        }),
      });
    } catch (e) {
      console.error('Failed to update priority:', e);
    }
  };

  const handleUpdateDuration = async (taskId: string, minutes: number) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, estimatedMinutes: minutes } : t))
    );

    try {
      await fetch('/api/desk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: taskId,
          estimated_minutes: minutes,
          updated_at: new Date().toISOString(),
        }),
      });
    } catch (e) {
      console.error('Failed to update duration:', e);
    }
  };

  const handleToggleSubtask = async (taskId: string, subtaskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const updatedSubtasks = task.subtasks.map((s) =>
      s.id === subtaskId ? { ...s, isCompleted: !s.isCompleted } : s
    );

    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, subtasks: updatedSubtasks } : t))
    );

    const serialized = serializeSubtasksIntoDescription(task.description, updatedSubtasks);

    try {
      await fetch('/api/desk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: taskId,
          description: serialized,
          updated_at: new Date().toISOString(),
        }),
      });
    } catch (e) {
      console.error('Failed to update subtasks:', e);
    }
  };

  const handleLaterTask = async (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);

    try {
      await fetch('/api/desk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: taskId,
          due_date: tomorrow.toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });
    } catch (e) {
      console.error('Failed to defer task:', e);
    }
  };

  // Convert Todo to Project
  const handleOpenConvertToProject = (task: Task) => {
    setTaskToConvert(task);
    setIsConvertToProjectOpen(true);
  };

  const handleConfirmConvertToProject = async (
    name: string,
    color: string,
    icon: string,
    keywords: string[]
  ) => {
    if (!taskToConvert) return;

    const { project: newProject, updatedTask } = createProjectFromTask(
      taskToConvert,
      name,
      color,
      icon
    );
    newProject.keywords = keywords;

    // 1. Add to local projects
    setProjects((prev) => [...prev, newProject]);

    // 2. Update task in local state
    setTasks((prev) =>
      prev.map((t) => (t.id === taskToConvert.id ? { ...t, projectId: newProject.id, listName: newProject.name } : t))
    );

    // 3. Switch to new project
    setSelectedProjectId(newProject.id);

    // 4. Persist to API
    try {
      await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProject),
      });

      await fetch('/api/desk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: taskToConvert.id,
          project_id: newProject.id,
          list_name: newProject.name,
          updated_at: new Date().toISOString(),
        }),
      });
    } catch (e) {
      console.error('Failed to persist new project:', e);
    }
  };

  // Save Project Rules
  const handleSaveProjectRules = async (projectId: string, updates: Partial<Project>) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, ...updates } : p))
    );

    try {
      await fetch('/api/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: projectId, ...updates }),
      });
    } catch (e) {
      console.error('Failed to update project rules:', e);
    }
  };

  // Create New Task
  const handleCreateTask = async (taskData: {
    title: string;
    projectId?: string;
    listName: string;
    estimatedMinutes: number;
    priority: TaskPriority;
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
      priority: taskData.priority,
      inPlayQueue: false,
      firstFiveMinutes: taskData.firstFiveMinutes,
      subtasks: taskData.subtasks.map((s) => ({ id: crypto.randomUUID(), ...s })),
      createdAt: new Date().toISOString(),
    };

    setTasks((prev) => [newTask, ...prev]);

    try {
      await fetch('/api/desk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newId,
          project_id: taskData.projectId,
          title: taskData.title,
          description: rawDesc,
          list_name: taskData.listName,
          status: 'pending',
          estimated_minutes: taskData.estimatedMinutes,
          priority: taskData.priority,
          first_five_minutes: taskData.firstFiveMinutes,
        }),
      });
    } catch (e) {
      console.error('Failed to create task:', e);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-950 text-white overflow-hidden font-sans">
      {/* Top Main Navigation Header */}
      <header className="h-14 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md px-5 flex items-center justify-between shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center text-white shadow-md shadow-indigo-600/30">
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
              Daily Planner Workspace
            </h1>
          </div>
        </div>

        {/* Center / Right Quick Actions */}
        <div className="flex items-center gap-3">
          {/* Sync Status Badge */}
          <div
            onClick={loadData}
            title="Click to Refresh"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800/80 border border-slate-700/60 text-[11px] text-slate-300 cursor-pointer hover:bg-slate-800 transition-colors"
          >
            <RefreshCw
              className={`h-3 w-3 ${syncStatus === 'syncing' ? 'animate-spin text-indigo-400' : 'text-emerald-400'}`}
            />
            <span className="capitalize">{syncStatus}</span>
          </div>

          {/* Build My Day Button */}
          <button
            type="button"
            onClick={() => setIsBuildMyDayOpen(true)}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Build My Day</span>
          </button>

          {/* New Task Button */}
          <button
            type="button"
            onClick={() => setIsNewTaskOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold border border-slate-700 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Task</span>
          </button>
        </div>
      </header>

      {/* Main Dual-Pane Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Project Sidebar */}
        <ProjectSidebar
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelectProject={setSelectedProjectId}
          tasks={tasks}
          onNewProject={() => {
            const tempTask: Task = {
              id: crypto.randomUUID(),
              title: 'New Project Task',
              listName: 'Personal',
              status: 'pending',
              estimatedMinutes: 15,
              priority: 'medium',
              inPlayQueue: false,
              subtasks: [],
            };
            handleOpenConvertToProject(tempTask);
          }}
          onEditProjectRules={(proj) => {
            setProjectToEdit(proj);
            setIsProjectSettingsOpen(true);
          }}
        />

        {/* Right Main Task Workspace */}
        <main className="flex-1 flex flex-col bg-slate-950 overflow-hidden">
          {/* Active Project Banner */}
          <div className="p-5 border-b border-slate-800 bg-slate-900/40 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {activeProject ? (
                  <>
                    <div
                      className="h-9 w-9 rounded-xl flex items-center justify-center text-white font-bold shadow-md"
                      style={{ backgroundColor: activeProject.color }}
                    >
                      {activeProject.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-white flex items-center gap-2">
                        {activeProject.name}
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">{activeProject.goal}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="h-9 w-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                      <Inbox className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-white">All Active Tasks</h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Overview of high, medium, and quick tasks across all projects
                      </p>
                    </div>
                  </>
                )}
              </div>

              {activeProject && (
                <button
                  type="button"
                  onClick={() => {
                    setProjectToEdit(activeProject);
                    setIsProjectSettingsOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 hover:text-white transition-colors border border-slate-700"
                >
                  <Settings className="h-3.5 w-3.5" />
                  <span>Configure Routing Rules</span>
                </button>
              )}
            </div>

            {/* Filter Toolbar */}
            <div className="mt-4">
              <FilterToolbar
                priorityFilter={priorityFilter}
                onPriorityChange={setPriorityFilter}
                durationFilter={durationFilter}
                onDurationChange={setDurationFilter}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                matchedCount={filteredTasks.length}
              />
            </div>
          </div>

          {/* Scrollable Tasks List */}
          <div className="flex-1 overflow-y-auto p-5 space-y-2">
            {filteredTasks.length === 0 ? (
              <div className="p-12 text-center rounded-2xl bg-slate-900/30 border border-slate-800/80 my-8">
                <CheckCircle2 className="h-10 w-10 text-slate-600 mx-auto mb-3" />
                <h3 className="text-sm font-bold text-white">No tasks match your criteria</h3>
                <p className="text-xs text-slate-400 mt-1 mb-4">
                  All tasks in this view are completed, or filters are excluding them.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setPriorityFilter('all');
                    setDurationFilter('all');
                    setSearchQuery('');
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white transition-colors"
                >
                  Reset Filters
                </button>
              </div>
            ) : (
              filteredTasks.map((task) => {
                const proj = projects.find((p) => p.id === task.projectId);
                return (
                  <TaskRow
                    key={task.id}
                    task={task}
                    project={proj}
                    showProjectBadge={selectedProjectId === null}
                    onToggleComplete={handleToggleComplete}
                    onUpdatePriority={handleUpdatePriority}
                    onUpdateDuration={handleUpdateDuration}
                    onToggleSubtask={handleToggleSubtask}
                    onLater={handleLaterTask}
                    onConvertToProject={handleOpenConvertToProject}
                    onStartSprint={setActiveSprintTask}
                  />
                );
              })
            )}
          </div>
        </main>
      </div>

      {/* Build My Day Modal */}
      <BuildMyDayModal
        tasks={tasks}
        isOpen={isBuildMyDayOpen}
        onClose={() => setIsBuildMyDayOpen(false)}
        onStartFocusTask={(task) => setActiveSprintTask(task)}
      />

      {/* New Task Modal */}
      {isNewTaskOpen && (
        <NewCardModal
          projects={projects}
          defaultProjectId={selectedProjectId || undefined}
          onClose={() => setIsNewTaskOpen(false)}
          onCreate={handleCreateTask}
        />
      )}

      {/* Convert Todo to Project Modal */}
      <ConvertToProjectModal
        task={taskToConvert}
        isOpen={isConvertToProjectOpen}
        onClose={() => {
          setIsConvertToProjectOpen(false);
          setTaskToConvert(null);
        }}
        onConfirm={handleConfirmConvertToProject}
      />

      {/* Project Routing & Rules Settings Modal */}
      <ProjectSettingsModal
        project={projectToEdit}
        isOpen={isProjectSettingsOpen}
        onClose={() => {
          setIsProjectSettingsOpen(false);
          setProjectToEdit(null);
        }}
        onSave={handleSaveProjectRules}
      />

      {/* 5-Minute Sprint Timer Modal */}
      {activeSprintTask && (
        <SprintTimerModal
          task={activeSprintTask}
          onClose={() => setActiveSprintTask(null)}
          onComplete={(taskId) => {
            handleToggleComplete(taskId);
            setActiveSprintTask(null);
          }}
        />
      )}
    </div>
  );
}
