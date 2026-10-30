'use client';

import React, { useState } from 'react';
import { Task, Project } from '@/lib/supabase';
import { deriveKeywordsFromText } from '@/lib/routing';
import { FolderPlus, X, Tag, Sparkles } from 'lucide-react';

interface ConvertToProjectModalProps {
  task: Task | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (projectName: string, color: string, icon: string, keywords: string[]) => void;
}

export const ConvertToProjectModal: React.FC<ConvertToProjectModalProps> = ({
  task,
  isOpen,
  onClose,
  onConfirm,
}) => {
  if (!isOpen || !task) return null;

  const [projectName, setProjectName] = useState(task.title);
  const [selectedColor, setSelectedColor] = useState('#3B82F6');
  const [selectedIcon, setSelectedIcon] = useState('folder');
  const [keywordInput, setKeywordInput] = useState('');
  const [keywords, setKeywords] = useState<string[]>(() =>
    deriveKeywordsFromText(task.title, task.description)
  );

  const colors = [
    '#3B82F6', // Blue
    '#10B981', // Emerald
    '#F59E0B', // Amber
    '#EF4444', // Red
    '#8B5CF6', // Purple
    '#EC4899', // Pink
    '#06B6D4', // Cyan
  ];

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim()) return;
    onConfirm(projectName.trim(), selectedColor, selectedIcon, keywords);
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
              style={{ backgroundColor: selectedColor }}
            >
              <FolderPlus className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Turn Todo into Project</h2>
              <p className="text-xs text-slate-400 truncate max-w-xs">
                From: &quot;{task.title}&quot;
              </p>
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
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Project Name */}
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              Project Name
            </label>
            <input
              type="text"
              required
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Color Selection */}
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              Project Color Accent
            </label>
            <div className="flex items-center gap-2">
              {colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setSelectedColor(c)}
                  className={`h-7 w-7 rounded-full transition-transform ${
                    selectedColor === c ? 'scale-125 ring-2 ring-white' : 'hover:scale-110'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* Auto-Routing Keywords */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                Auto-Routing Keywords & Rules
              </label>
              <span className="text-[10px] text-slate-500">
                New todos with these words route here
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
                placeholder="Add keyword (e.g. sponsor, uniform)..."
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
            <div className="flex flex-wrap gap-1.5 p-2 bg-slate-950/60 rounded-xl border border-slate-800 min-h-[44px]">
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

          {/* Actions */}
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
              Create Project & Move Todo
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
