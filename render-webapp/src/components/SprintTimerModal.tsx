'use client';

import React, { useState, useEffect } from 'react';
import { Task } from '@/lib/supabase';
import { Play, Pause, RotateCcw, Check, X, Bolt } from 'lucide-react';

interface SprintTimerModalProps {
  task: Task;
  onClose: () => void;
  onComplete: (taskId: string) => void;
}

export default function SprintTimerModal({ task, onClose, onComplete }: SprintTimerModalProps) {
  const initialSeconds = Math.max(300, (task.estimatedMinutes || 5) * 60);
  const [secondsLeft, setSecondsLeft] = useState(300); // 5 minutes default sprint
  const [isRunning, setIsRunning] = useState(true);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isRunning && secondsLeft > 0) {
      interval = setInterval(() => {
        setSecondsLeft((prev) => prev - 1);
      }, 1000);
    } else if (secondsLeft === 0) {
      setIsRunning(false);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRunning, secondsLeft]);

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const progressPercent = ((300 - secondsLeft) / 300) * 100;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-md rounded-2xl bg-slate-900 border border-purple-500/30 p-6 shadow-2xl text-white">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 rounded-full p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="text-center">
          <span className="inline-block rounded-full bg-purple-500/20 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-purple-300">
            5-Minute Focus Sprint
          </span>
          <h2 className="mt-2 text-xl font-bold line-clamp-1">{task.title}</h2>
          {task.firstFiveMinutes && (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300 border border-amber-500/20">
              <Bolt className="h-3.5 w-3.5 text-amber-400" />
              <span>{task.firstFiveMinutes}</span>
            </div>
          )}
        </div>

        {/* Circular Countdown Timer */}
        <div className="my-8 flex justify-center">
          <div className="relative flex h-48 w-48 items-center justify-center rounded-full border-4 border-slate-800 bg-slate-950">
            <svg className="absolute inset-0 h-full w-full -rotate-90">
              <circle
                cx="96"
                cy="96"
                r="88"
                className="stroke-purple-600 transition-all duration-500"
                strokeWidth="8"
                strokeDasharray="552"
                strokeDashoffset={552 - (552 * progressPercent) / 100}
                fill="none"
                strokeLinecap="round"
              />
            </svg>
            <div className="text-center">
              <span className="font-mono text-5xl font-black tracking-tight">
                {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
              </span>
              <span className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mt-1">
                {isRunning ? 'FOCUSING' : secondsLeft === 0 ? 'SPRINT DONE' : 'PAUSED'}
              </span>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => setSecondsLeft(300)}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
            title="Reset to 5m"
          >
            <RotateCcw className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={() => setIsRunning(!isRunning)}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-purple-600 text-white hover:bg-purple-500 transition-all shadow-lg shadow-purple-600/30 scale-100 hover:scale-105"
          >
            {isRunning ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 fill-current ml-1" />}
          </button>

          <button
            type="button"
            onClick={() => {
              onComplete(task.id);
              onClose();
            }}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-600 text-white hover:bg-emerald-500 transition-colors shadow-lg shadow-emerald-600/30"
            title="Complete task now"
          >
            <Check className="h-5 w-5 stroke-[3]" />
          </button>
        </div>
      </div>
    </div>
  );
}
