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
  onAddSubtasks?: (taskId: string, titles: string[]) => void;
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
  onAddSubtasks,
  onLater,
  onConvertToProject,
  onStartSprint,
}) => {
  const [showSubtasks, setShowSubtasks] = useState(false);
  const [showPriorityMenu, setShowPriorityMenu] = useState(false);
  const [showDurationMenu, setShowDurationMenu] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [singleSubtaskText, setSingleSubtaskText] = useState('');
  const [isBatchAdding, setIsBatchAdding] = useState(false);
  const [batchSubtaskText, setBatchSubtaskText] = useState('');

  const durationPresets = [5, 10, 15, 25, 30, 45, 60, 90];

  const handleComplete = () => {
    if (isCompleting) return;
    setIsCompleting(true);
    // Slow down for 550ms so user experiences the satisfying completion feedback
    setTimeout(() => {
      onToggleComplete(task.id);
    }, 550);
  };

  const isVisuallyDone = isCompleting || task.status === 'completed';

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
    <div
      className={`group border rounded-2xl p-3.5 transition-all duration-300 shadow-sm ${
        isCompleting
          ? 'bg-emerald-950/20 border-emerald-500/40 opacity-70 scale-[0.99] translate-x-1'
          : 'bg-slate-900/80 hover:bg-slate-900 border-slate-800/80 hover:border-slate-700/80'
      }`}
    >
      <div className="flex items-center gap-3">
        {/* Completion Checkbox with animation */}
        <button
          type="button"
          onClick={handleComplete}
          disabled={isCompleting}
          aria-label={isVisuallyDone ? 'Mark task incomplete' : 'Mark task complete'}
          className={`h-5 w-5 rounded-lg border flex items-center justify-center transition-all duration-300 shrink-0 ${
            isVisuallyDone
              ? 'bg-emerald-500 border-emerald-400 text-white scale-110 shadow-sm shadow-emerald-500/50'
              : 'border-slate-600 hover:border-emerald-400 text-transparent hover:text-slate-400'
          }`}
        >
          <Check className={`h-3.5 w-3.5 transition-transform duration-200 ${isCompleting ? 'scale-110 stroke-[3]' : ''}`} />
        </button>

        {/* Task Title & Project Tag */}
        <div className="flex-1 min-w-0 transition-opacity duration-300">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-semibold truncate transition-all duration-300 ${
                isVisuallyDone
                  ? 'line-through text-slate-500 opacity-60'
                  : 'text-slate-100'
              }`}
            >
              {task.title}
            </span>
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
        <button
          type="button"
          onClick={() => setShowSubtasks(!showSubtasks)}
          className={`flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded-lg border transition-colors ${
            totalSubs > 0
              ? 'bg-slate-800/50 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border-slate-700/60'
              : 'text-slate-500 hover:text-slate-300 border-transparent hover:border-slate-800'
          }`}
          title={totalSubs > 0 ? 'Toggle subtasks' : 'Add subtasks'}
        >
          {showSubtasks ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <span>
            {totalSubs > 0 ? `${completedSubs}/${totalSubs}` : '+ Steps'}
          </span>
        </button>

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
      {showSubtasks && (
        <div className="mt-3 pt-3 border-t border-slate-800/80 pl-8 space-y-2">
          {task.subtasks && task.subtasks.map((sub) => (
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

          {/* Inline Add Subtask Form with Batch Multi-line Paste support */}
          {onAddSubtasks && (
            <div className="pt-1.5">
              {isBatchAdding ? (
                <div className="space-y-1.5">
                  <textarea
                    rows={3}
                    placeholder="Paste multiple subtasks (one per line)..."
                    value={batchSubtaskText}
                    onChange={(e) => setBatchSubtaskText(e.target.value)}
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">
                      {batchSubtaskText.split('\n').filter((l) => l.trim()).length} steps detected
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsBatchAdding(false)}
                        className="text-[11px] text-slate-400 hover:text-white"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const lines = batchSubtaskText
                            .split('\n')
                            .map((l) => l.replace(/^[-•*\d.)]+\s*/, '').trim())
                            .filter(Boolean);
                          if (lines.length > 0) {
                            onAddSubtasks(task.id, lines);
                            setBatchSubtaskText('');
                            setIsBatchAdding(false);
                          }
                        }}
                        className="rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-500"
                      >
                        Add Steps
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Add step (or paste multiple lines)..."
                    value={singleSubtaskText}
                    onChange={(e) => setSingleSubtaskText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const lines = singleSubtaskText
                          .split('\n')
                          .map((l) => l.replace(/^[-•*\d.)]+\s*/, '').trim())
                          .filter(Boolean);
                        if (lines.length > 0) {
                          onAddSubtasks(task.id, lines);
                          setSingleSubtaskText('');
                        }
                      }
                    }}
                    onPaste={(e) => {
                      const text = e.clipboardData.getData('text');
                      if (text.includes('\n')) {
                        e.preventDefault();
                        const lines = text
                          .split('\n')
                          .map((l) => l.replace(/^[-•*\d.)]+\s*/, '').trim())
                          .filter(Boolean);
                        if (lines.length > 0) {
                          onAddSubtasks(task.id, lines);
                          setSingleSubtaskText('');
                        }
                      }
                    }}
                    className="flex-1 rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const lines = singleSubtaskText
                        .split('\n')
                        .map((l) => l.replace(/^[-•*\d.)]+\s*/, '').trim())
                        .filter(Boolean);
                      if (lines.length > 0) {
                        onAddSubtasks(task.id, lines);
                        setSingleSubtaskText('');
                      }
                    }}
                    className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold px-2 py-1"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsBatchAdding(true)}
                    className="text-[11px] text-slate-500 hover:text-slate-300 font-medium whitespace-nowrap"
                  >
                    Paste Multi
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
