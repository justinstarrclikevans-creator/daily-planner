'use client';

import React, { useState } from 'react';
import { Task, Project, TaskPriority } from '@/lib/supabase';
import {
  Check,
  Flame,
  Zap,
  Sprout,
  Clock,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Play,
  Calendar,
} from 'lucide-react';

interface TaskRowProps {
  task: Task;
  project?: Project;
  showProjectBadge?: boolean;
  onToggleComplete: (taskId: string) => void;
  onUpdatePriority: (taskId: string, priority: TaskPriority) => void;
  onUpdateDuration: (taskId: string, minutes: number) => void;
  onToggleSubtask: (taskId: string, subtaskId: string) => void;
  onLater: (taskId: string) => void;
  onConvertToProject: (task: Task) => void;
  onStartSprint: (task: Task) => void;
}

export const TaskRow: React.FC<TaskRowProps> = ({
  task,
  project,
  showProjectBadge = false,
  onToggleComplete,
  onUpdatePriority,
  onUpdateDuration,
  onToggleSubtask,
  onLater,
  onConvertToProject,
  onStartSprint,
}) => {
  const [showSubtasks, setShowSubtasks] = useState(false);
  const [showPriorityMenu, setShowPriorityMenu] = useState(false);
  const [showDurationMenu, setShowDurationMenu] = useState(false);

  const durationPresets = [5, 10, 15, 25, 30, 45, 60, 90];

  const completedSubs = task.subtasks ? task.subtasks.filter((s) => s.isCompleted).length : 0;
  const totalSubs = task.subtasks ? task.subtasks.length : 0;

  const priorityConfig = {
    high: {
      label: 'High',
      icon: <Flame className="h-3 w-3 text-rose-400" />,
      badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30 hover:bg-rose-500/25',
    },
    medium: {
      label: 'Med',
      icon: <Zap className="h-3 w-3 text-amber-400" />,
      badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/25',
    },
    low: {
      label: 'Low',
      icon: <Sprout className="h-3 w-3 text-emerald-400" />,
      badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25',
    },
  }[task.priority || 'medium'];

  return (
    <div className="group bg-slate-900/80 hover:bg-slate-900 border border-slate-800/80 hover:border-slate-700/80 rounded-2xl p-3.5 transition-all shadow-sm">
      <div className="flex items-center gap-3">
        {/* Completion Checkbox */}
        <button
          type="button"
          onClick={() => onToggleComplete(task.id)}
          className="h-5 w-5 rounded-lg border border-slate-600 hover:border-indigo-400 flex items-center justify-center text-transparent hover:text-slate-400 transition-colors shrink-0"
        >
          <Check className="h-3.5 w-3.5" />
        </button>

        {/* Task Title & Project Tag */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-100 truncate">{task.title}</span>
            {showProjectBadge && project && (
              <span
                className="text-[10px] font-medium px-2 py-0.5 rounded-full border shrink-0"
                style={{
                  backgroundColor: `${project.color}15`,
                  borderColor: `${project.color}35`,
                  color: project.color,
                }}
              >
                {project.name}
              </span>
            )}
          </div>

          {/* First Five Minutes Prompt if present */}
          {task.firstFiveMinutes && (
            <p className="text-[11px] text-slate-400 italic mt-0.5 truncate">
              ⚡ Start with: {task.firstFiveMinutes}
            </p>
          )}
        </div>

        {/* Priority Selector Pill */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowPriorityMenu(!showPriorityMenu)}
            className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border transition-all ${priorityConfig.badgeClass}`}
          >
            {priorityConfig.icon}
            <span>{priorityConfig.label}</span>
          </button>

          {showPriorityMenu && (
            <div className="absolute right-0 top-7 z-30 w-28 bg-slate-950 border border-slate-800 rounded-xl shadow-2xl p-1 space-y-0.5">
              {(['high', 'medium', 'low'] as TaskPriority[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    onUpdatePriority(task.id, p);
                    setShowPriorityMenu(false);
                  }}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium text-left ${
                    task.priority === p ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/60'
                  }`}
                >
                  {p === 'high' && <Flame className="h-3 w-3 text-rose-400" />}
                  {p === 'medium' && <Zap className="h-3 w-3 text-amber-400" />}
                  {p === 'low' && <Sprout className="h-3 w-3 text-emerald-400" />}
                  <span className="capitalize">{p}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Duration Selector Pill */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowDurationMenu(!showDurationMenu)}
            className="flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
          >
            <Clock className="h-3 w-3 text-indigo-400" />
            <span>{task.estimatedMinutes || 15}m</span>
          </button>

          {showDurationMenu && (
            <div className="absolute right-0 top-7 z-30 w-24 bg-slate-950 border border-slate-800 rounded-xl shadow-2xl p-1 grid grid-cols-2 gap-0.5">
              {durationPresets.map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => {
                    onUpdateDuration(task.id, mins);
                    setShowDurationMenu(false);
                  }}
                  className={`px-2 py-1 rounded-md text-xs font-mono text-center ${
                    task.estimatedMinutes === mins
                      ? 'bg-indigo-600 text-white font-bold'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {mins}m
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Subtask count badge & toggle */}
        {totalSubs > 0 && (
          <button
            type="button"
            onClick={() => setShowSubtasks(!showSubtasks)}
            className="flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded-lg bg-slate-800/50 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700/60 transition-colors"
          >
            {showSubtasks ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <span>
              {completedSubs}/{totalSubs}
            </span>
          </button>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Turn into Project Button */}
          <button
            type="button"
            onClick={() => onConvertToProject(task)}
            title="Turn this todo into a new project"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-indigo-600/30 text-slate-400 hover:text-indigo-300 border border-slate-700/60 transition-colors"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>

          {/* Defer to Later Button */}
          <button
            type="button"
            onClick={() => onLater(task.id)}
            title="Defer to tomorrow morning (Later)"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-amber-600/30 text-slate-400 hover:text-amber-300 border border-slate-700/60 transition-colors"
          >
            <Calendar className="h-3.5 w-3.5" />
          </button>

          {/* Focus Sprint 5m Button */}
          <button
            type="button"
            onClick={() => onStartSprint(task)}
            title="Start 5-minute Focus Sprint"
            className="p-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/30 transition-colors"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
          </button>
        </div>
      </div>

      {/* Expanded Subtasks List */}
      {showSubtasks && task.subtasks && task.subtasks.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-800/80 pl-8 space-y-1.5">
          {task.subtasks.map((sub) => (
            <div key={sub.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={sub.isCompleted}
                onChange={() => onToggleSubtask(task.id, sub.id)}
                className="h-3.5 w-3.5 rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer"
              />
              <span
                className={`text-xs ${
                  sub.isCompleted ? 'line-through text-slate-500' : 'text-slate-300'
                }`}
              >
                {sub.title}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
