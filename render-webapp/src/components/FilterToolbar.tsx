'use client';

import React from 'react';
import { TaskPriority } from '@/lib/supabase';
import { Search, Flame, Zap, Sprout, Clock, X } from 'lucide-react';

export type DurationFilter = 'all' | 'quick' | 'medium' | 'deep';

interface FilterToolbarProps {
  priorityFilter: TaskPriority | 'all';
  onPriorityChange: (p: TaskPriority | 'all') => void;
  durationFilter: DurationFilter;
  onDurationChange: (d: DurationFilter) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  matchedCount: number;
}

export const FilterToolbar: React.FC<FilterToolbarProps> = ({
  priorityFilter,
  onPriorityChange,
  durationFilter,
  onDurationChange,
  searchQuery,
  onSearchChange,
  matchedCount,
}) => {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-900/60 border border-slate-800 rounded-2xl backdrop-blur-sm">
      {/* Priority Filters */}
      <div className="flex items-center gap-1 bg-slate-950/60 p-1 rounded-xl border border-slate-800">
        <span className="text-[10px] font-bold text-slate-500 uppercase px-2">Priority:</span>
        <button
          type="button"
          onClick={() => onPriorityChange('all')}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
            priorityFilter === 'all'
              ? 'bg-slate-700 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          All
        </button>
        <button
          type="button"
          onClick={() => onPriorityChange('high')}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
            priorityFilter === 'high'
              ? 'bg-rose-500 text-white shadow-md shadow-rose-500/20'
              : 'text-rose-400 hover:bg-rose-500/10'
          }`}
        >
          <Flame className="h-3 w-3" />
          High
        </button>
        <button
          type="button"
          onClick={() => onPriorityChange('medium')}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
            priorityFilter === 'medium'
              ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/20'
              : 'text-amber-400 hover:bg-amber-500/10'
          }`}
        >
          <Zap className="h-3 w-3" />
          Medium
        </button>
        <button
          type="button"
          onClick={() => onPriorityChange('low')}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
            priorityFilter === 'low'
              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
              : 'text-emerald-400 hover:bg-emerald-500/10'
          }`}
        >
          <Sprout className="h-3 w-3" />
          Low
        </button>
      </div>

      {/* Duration / Time Filters */}
      <div className="flex items-center gap-1 bg-slate-950/60 p-1 rounded-xl border border-slate-800">
        <span className="text-[10px] font-bold text-slate-500 uppercase px-2">Time:</span>
        <button
          type="button"
          onClick={() => onDurationChange('all')}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
            durationFilter === 'all'
              ? 'bg-slate-700 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          All
        </button>
        <button
          type="button"
          onClick={() => onDurationChange('quick')}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
            durationFilter === 'quick'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Clock className="h-3 w-3 text-indigo-400" />
          ≤15m
        </button>
        <button
          type="button"
          onClick={() => onDurationChange('medium')}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
            durationFilter === 'medium'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Clock className="h-3 w-3 text-indigo-400" />
          15–30m
        </button>
        <button
          type="button"
          onClick={() => onDurationChange('deep')}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
            durationFilter === 'deep'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Clock className="h-3 w-3 text-indigo-400" />
          &gt;30m
        </button>
      </div>

      {/* Search Bar */}
      <div className="relative min-w-[200px] flex-1 max-w-xs">
        <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Filter tasks..."
          className="w-full bg-slate-950/80 border border-slate-800 rounded-xl pl-8 pr-7 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Results Count Badge */}
      <div className="text-[11px] font-mono text-slate-400 px-2">
        Showing <span className="font-bold text-white">{matchedCount}</span> tasks
      </div>
    </div>
  );
};
