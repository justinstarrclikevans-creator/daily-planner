'use client';

import React, { useState, useEffect } from 'react';
import { Project } from '@/lib/supabase';
import { Settings, X, Tag, Sparkles } from 'lucide-react';

interface ProjectSettingsModalProps {
  project: Project | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (projectId: string, updates: Partial<Project>) => void;
}

export const ProjectSettingsModal: React.FC<ProjectSettingsModalProps> = ({
  project,
  isOpen,
  onClose,
  onSave,
}) => {
  if (!isOpen || !project) return null;

  const [name, setName] = useState(project.name);
  const [goal, setGoal] = useState(project.goal || '');
  const [instructions, setInstructions] = useState(project.instructions || '');
  const [keywordInput, setKeywordInput] = useState('');
  const [keywords, setKeywords] = useState<string[]>(project.keywords || []);

  useEffect(() => {
    setName(project.name);
    setGoal(project.goal || '');
    setInstructions(project.instructions || '');
    setKeywords(project.keywords || []);
  }, [project]);

  const handleAddKeyword = () => {
    const trimmed = keywordInput.trim().toLowerCase();
    if (trimmed && !keywords.includes(trimmed)) {
      setKeywords([...keywords, trimmed]);
      setKeywordInput('');
    }
  };

  const handleRemoveKeyword = (kw: string) => {
    setKeywords(keywords.filter((k) => k !== kw));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(project.id, {
      name,
      goal,
      instructions,
      keywords,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="h-9 w-9 rounded-xl flex items-center justify-center text-white shadow-lg"
              style={{ backgroundColor: project.color }}
            >
              <Settings className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Project Routing & Rules</h2>
              <p className="text-xs text-slate-400">Configure how new todos auto-route to {project.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              Project Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              Project Goal / Mission
            </label>
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Auto-Routing Keywords */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                Auto-Routing Keywords
              </label>
              <span className="text-[10px] text-slate-500">
                Matches in task titles/notes route here
              </span>
            </div>

            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddKeyword();
                  }
                }}
                placeholder="Add keyword or trigger phrase..."
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={handleAddKeyword}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white transition-colors"
              >
                Add
              </button>
            </div>

            {/* Keyword Pills */}
            <div className="flex flex-wrap gap-1.5 p-2 bg-slate-950/60 rounded-xl border border-slate-800 max-h-32 overflow-y-auto">
              {keywords.map((kw) => (
                <span
                  key={kw}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 text-[11px]"
                >
                  <Tag className="h-2.5 w-2.5" />
                  <span>{kw}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveKeyword(kw)}
                    className="hover:text-white"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              AI Routing Guidance / Instructions
            </label>
            <textarea
              rows={2}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. Focus on case notes, participant employment, and partner meetings..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 transition-all"
            >
              Save Project Rules
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
