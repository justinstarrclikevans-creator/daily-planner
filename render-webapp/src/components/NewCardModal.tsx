'use client';

import React, { useState } from 'react';
import { Project, TaskPriority } from '@/lib/supabase';
import { determineProjectForTask } from '@/lib/routing';
import { X, Plus, Trash2, Clock, Flame, Zap, Sprout, Sparkles } from 'lucide-react';

interface NewCardModalProps {
  projects: Project[];
  defaultProjectId?: string;
  onClose: () => void;
  onCreate: (taskData: {
    title: string;
    projectId?: string;
    listName: string;
    estimatedMinutes: number;
    priority: TaskPriority;
    firstFiveMinutes?: string;
    subtasks: { title: string; isCompleted: boolean }[];
  }) => void;
}

export default function NewCardModal({
  projects,
  defaultProjectId,
  onClose,
  onCreate,
}: NewCardModalProps) {
  const [title, setTitle] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    defaultProjectId || 'auto'
  );
  const [estimatedMinutes, setEstimatedMinutes] = useState(15);
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [firstFiveMinutes, setFirstFiveMinutes] = useState('');
  const [subtasks, setSubtasks] = useState<string[]>(['']);

  const handleSubtaskChange = (index: number, val: string) => {
    const updated = [...subtasks];
    updated[index] = val;
    setSubtasks(updated);
  };

  const addSubtaskRow = () => {
    setSubtasks([...subtasks, '']);
  };

  const removeSubtaskRow = (index: number) => {
    setSubtasks(subtasks.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    let chosenProj: Project | undefined;
    if (selectedProjectId === 'auto') {
      chosenProj = determineProjectForTask(title, firstFiveMinutes, projects);
    } else {
      chosenProj = projects.find((p) => p.id === selectedProjectId);
    }

    const validSubtasks = subtasks
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => ({ title: s, isCompleted: false }));

    onCreate({
      title: title.trim(),
      projectId: chosenProj?.id,
      listName: chosenProj?.name || 'Personal',
      estimatedMinutes,
      priority,
      firstFiveMinutes: firstFiveMinutes.trim() || undefined,
      subtasks: validSubtasks,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-lg rounded-3xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-white">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 rounded-full p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 className="text-lg font-bold tracking-tight">Create New Task</h2>
        <p className="mt-1 text-xs text-slate-400">
          Smart routing automatically files the task based on project rules if auto-detect is chosen.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Task Title
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Outreach to soccer sponsors for tournament"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1.5 w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Project & Priority Row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                Project Destination
              </label>
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="mt-1.5 w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="auto">✨ Auto-Detect (Project Rules)</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                Priority
              </label>
              <div className="mt-1.5 grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => setPriority('high')}
                  className={`flex items-center justify-center gap-1 py-1 rounded-lg text-xs font-bold transition-all ${
                    priority === 'high'
                      ? 'bg-rose-500 text-white shadow'
                      : 'text-rose-400 hover:bg-rose-500/10'
                  }`}
                >
                  <Flame className="h-3 w-3" /> High
                </button>
                <button
                  type="button"
                  onClick={() => setPriority('medium')}
                  className={`flex items-center justify-center gap-1 py-1 rounded-lg text-xs font-semibold transition-all ${
                    priority === 'medium'
                      ? 'bg-amber-500 text-slate-950 font-bold shadow'
                      : 'text-amber-400 hover:bg-amber-500/10'
                  }`}
                >
                  <Zap className="h-3 w-3" /> Med
                </button>
                <button
                  type="button"
                  onClick={() => setPriority('low')}
                  className={`flex items-center justify-center gap-1 py-1 rounded-lg text-xs font-semibold transition-all ${
                    priority === 'low'
                      ? 'bg-emerald-600 text-white shadow'
                      : 'text-emerald-400 hover:bg-emerald-500/10'
                  }`}
                >
                  <Sprout className="h-3 w-3" /> Low
                </button>
              </div>
            </div>
          </div>

          {/* Duration Selector */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
              Estimated Duration
            </label>
            <div className="grid grid-cols-6 gap-1.5">
              {[5, 15, 25, 30, 45, 60].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setEstimatedMinutes(mins)}
                  className={`py-1.5 rounded-xl text-xs font-mono font-bold transition-all ${
                    estimatedMinutes === mins
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'bg-slate-950 text-slate-300 hover:bg-slate-800 border border-slate-800'
                  }`}
                >
                  {mins}m
                </button>
              ))}
            </div>
          </div>

          {/* First Five Minutes Prompt */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
              First Step Prompt
            </label>
            <input
              type="text"
              placeholder="e.g. Open the draft email and review first 2 sentences"
              value={firstFiveMinutes}
              onChange={(e) => setFirstFiveMinutes(e.target.value)}
              className="mt-1.5 w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Subtasks */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Subtasks
              </label>
              <button
                type="button"
                onClick={addSubtaskRow}
                className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-semibold"
              >
                <Plus className="h-3.5 w-3.5" /> Add Step
              </button>
            </div>

            <div className="mt-2 space-y-2 max-h-32 overflow-y-auto">
              {subtasks.map((st, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder={`Step ${i + 1}`}
                    value={st}
                    onChange={(e) => handleSubtaskChange(i, e.target.value)}
                    className="flex-1 rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                  {subtasks.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSubtaskRow(i)}
                      className="text-slate-500 hover:text-rose-400 p-1"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Submit Actions */}
          <div className="mt-6 flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 transition-all"
            >
              Create Task
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
