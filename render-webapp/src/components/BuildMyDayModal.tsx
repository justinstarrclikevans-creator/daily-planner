'use client';

import React, { useState, useMemo } from 'react';
import { Task } from '@/lib/supabase';
import { buildDaySchedule } from '@/lib/dayPlanner';
import {
  Sparkles,
  Clock,
  Flame,
  Zap,
  Check,
  X,
  Play,
  Calendar,
  AlertCircle,
} from 'lucide-react';

interface BuildMyDayModalProps {
  tasks: Task[];
  isOpen: boolean;
  onClose: () => void;
  onStartFocusTask: (task: Task) => void;
}

export const BuildMyDayModal: React.FC<BuildMyDayModalProps> = ({
  tasks,
  isOpen,
  onClose,
  onStartFocusTask,
}) => {
  const [availableMinutes, setAvailableMinutes] = useState<number>(120); // default 2 hours

  const presets = [
    { label: '1 Hour', minutes: 60 },
    { label: '2 Hours', minutes: 120 },
    { label: '3 Hours', minutes: 180 },
    { label: '4 Hours', minutes: 240 },
    { label: 'Full Day (6h)', minutes: 360 },
  ];

  const plan = useMemo(() => {
    return buildDaySchedule(tasks, availableMinutes);
  }, [tasks, availableMinutes]);

  if (!isOpen) return null;

  const formatHoursMinutes = (totalMins: number) => {
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (hours === 0) return `${mins}m`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Build My Day</h2>
              <p className="text-xs text-slate-400">
                Fit your highest-priority tasks into your schedule today
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Time Budget Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5">
              How much time do you have to work today?
            </label>
            <div className="grid grid-cols-5 gap-2">
              {presets.map((p) => (
                <button
                  key={p.minutes}
                  type="button"
                  onClick={() => setAvailableMinutes(p.minutes)}
                  className={`py-2 px-1 rounded-xl text-xs font-semibold transition-all text-center ${
                    availableMinutes === p.minutes
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 ring-2 ring-indigo-400/50'
                      : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Custom slider */}
            <div className="mt-3 flex items-center gap-3">
              <Clock className="h-4 w-4 text-slate-400" />
              <input
                type="range"
                min="15"
                max="480"
                step="15"
                value={availableMinutes}
                onChange={(e) => setAvailableMinutes(parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <span className="text-xs font-mono font-bold text-indigo-400 min-w-[55px] text-right">
                {formatHoursMinutes(availableMinutes)}
              </span>
            </div>
          </div>

          {/* Schedule Breakdown Summary Banner */}
          <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
            <div className="space-y-1">
              <div className="text-xs text-slate-400">Scheduled Time Budget</div>
              <div className="text-lg font-bold text-white flex items-center gap-2">
                <span>{formatHoursMinutes(plan.totalMinutes)}</span>
                <span className="text-xs font-normal text-slate-500">
                  of {formatHoursMinutes(plan.availableMinutes)} available
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {plan.highPriorityCount > 0 && (
                <span className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  <Flame className="h-3.5 w-3.5 text-rose-400" />
                  {plan.highPriorityCount} High
                </span>
              )}
              {plan.mediumPriorityCount > 0 && (
                <span className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  <Zap className="h-3.5 w-3.5 text-amber-400" />
                  {plan.mediumPriorityCount} Med
                </span>
              )}
              <span className="text-xs font-mono text-slate-400 px-2 py-1 bg-slate-800 rounded-lg">
                {plan.scheduledTasks.length} Tasks
              </span>
            </div>
          </div>

          {/* Scheduled Plan List */}
          <div>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
              Your Focus Schedule for Today
            </h3>

            {plan.scheduledTasks.length === 0 ? (
              <div className="p-8 text-center bg-slate-950/40 rounded-2xl border border-slate-800/60">
                <AlertCircle className="h-8 w-8 text-slate-500 mx-auto mb-2" />
                <p className="text-xs text-slate-400">
                  No tasks fit within the selected time window. Try increasing your available time.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {plan.scheduledTasks.map((task, index) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between p-3 rounded-xl bg-slate-950/40 border border-slate-800/80 hover:border-slate-700 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="h-6 w-6 rounded-lg bg-slate-800 text-indigo-400 font-mono text-xs font-bold flex items-center justify-center shrink-0">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-white truncate">
                            {task.title}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                            {task.listName}
                          </span>
                        </div>
                        {task.firstFiveMinutes && (
                          <p className="text-[11px] text-slate-400 truncate mt-0.5">
                            ⚡ {task.firstFiveMinutes}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {task.priority === 'high' && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400">
                          High
                        </span>
                      )}
                      <span className="text-xs font-mono text-slate-300 bg-slate-800 px-2 py-0.5 rounded">
                        {task.estimatedMinutes}m
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <div className="text-xs text-slate-400">
            {plan.remainingMinutes > 0 && (
              <span>+{plan.remainingMinutes}m buffer for breaks & email</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              Close
            </button>
            {plan.scheduledTasks.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onStartFocusTask(plan.scheduledTasks[0]);
                  onClose();
                }}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 transition-all"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Start Day with Task #1</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
