'use client';

import React, { useState } from 'react';
import { Project } from '@/lib/supabase';
import { X, Plus, Trash2, Clock, Bolt } from 'lucide-react';

interface NewCardModalProps {
  projects: Project[];
  defaultProjectId?: string;
  onClose: () => void;
  onCreate: (taskData: {
    title: string;
    projectId?: string;
    listName: string;
    estimatedMinutes: number;
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
  const [selectedProjectId, setSelectedProjectId] = useState(
    defaultProjectId || projects[0]?.id || ''
  );
  const [estimatedMinutes, setEstimatedMinutes] = useState(15);
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

    const chosenProj = projects.find((p) => p.id === selectedProjectId);
    const validSubtasks = subtasks
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => ({ title: s, isCompleted: false }));

    onCreate({
      title: title.trim(),
      projectId: chosenProj?.id,
      listName: chosenProj?.name || 'Personal',
      estimatedMinutes,
      firstFiveMinutes: firstFiveMinutes.trim() || undefined,
      subtasks: validSubtasks,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-lg rounded-2xl bg-slate-900 border border-white/10 p-6 shadow-2xl text-white">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 rounded-full p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 className="text-xl font-bold tracking-tight">Create New Index Card</h2>
        <p className="mt-1 text-xs text-slate-400">
          Adds a physical 3x5 card to your desk and syncs to Apple Reminders and Supabase.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
              Task Title
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Call technical contact regarding scoring"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1.5 w-full rounded-lg bg-slate-800 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Project & Duration */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                Project Stack
              </label>
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="mt-1.5 w-full rounded-lg bg-slate-800 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                Estimated Minutes
              </label>
              <div className="relative mt-1.5">
                <input
                  type="number"
                  min="1"
                  max="180"
                  value={estimatedMinutes}
                  onChange={(e) => setEstimatedMinutes(parseInt(e.target.value, 10) || 15)}
                  className="w-full rounded-lg bg-slate-800 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 pl-8"
                />
                <Clock className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              </div>
            </div>
          </div>

          {/* First 5-Minute Kickstart Step */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-300">
              <Bolt className="h-3.5 w-3.5 text-amber-400" />
              First 5-Minute Prompt (Kickstart)
            </label>
            <input
              type="text"
              placeholder="e.g. Open Safari and navigate to reporting dashboard"
              value={firstFiveMinutes}
              onChange={(e) => setFirstFiveMinutes(e.target.value)}
              className="mt-1.5 w-full rounded-lg bg-slate-800 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Subtasks */}
          <div>
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                Front-of-Card Subtasks
              </label>
              <button
                type="button"
                onClick={addSubtaskRow}
                className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-semibold"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Subtask
              </button>
            </div>

            <div className="mt-2 space-y-2 max-h-40 overflow-y-auto pr-1">
              {subtasks.map((st, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder={`Subtask ${i + 1}`}
                    value={st}
                    onChange={(e) => handleSubtaskChange(i, e.target.value)}
                    className="flex-1 rounded-md bg-slate-800 border border-white/10 px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  {subtasks.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSubtaskRow(i)}
                      className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Form Actions */}
          <div className="mt-6 flex items-center justify-end gap-3 border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-bold text-white hover:bg-indigo-500 transition-colors shadow-md shadow-indigo-600/30"
            >
              Create Card
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
