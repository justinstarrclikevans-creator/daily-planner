'use client';

import React, { useState, useRef } from 'react';
import { Project, Task } from '@/lib/supabase';
import { GripHorizontal, Layers, ChevronDown, ChevronUp, Clock } from 'lucide-react';

interface ProjectStackWidgetProps {
  project: Project;
  tasks: Task[];
  isOpen: boolean;
  position: { x: number; y: number };
  onToggleOpen: (projectId: string) => void;
  onMove: (projectId: string, x: number, y: number) => void;
}

export default function ProjectStackWidget({
  project,
  tasks,
  isOpen,
  position,
  onToggleOpen,
  onMove,
}: ProjectStackWidgetProps) {
  const [isDragging, setIsDragging] = useState(false);
  const offsetRef = useRef({ x: 0, y: 0 });

  const activeTasks = tasks.filter(t => t.status !== 'completed');
  const totalMinutes = activeTasks.reduce((acc, t) => acc + (t.estimatedMinutes || 5), 0);
  const topTask = activeTasks[0];

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, a')) return;

    setIsDragging(true);
    offsetRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const newX = Math.max(10, e.clientX - offsetRef.current.x);
    const newY = Math.max(70, e.clientY - offsetRef.current.y);
    onMove(project.id, newX, newY);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  return (
    <div
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        zIndex: isDragging ? 40 : 5,
      }}
      className="absolute w-[300px] select-none"
    >
      {/* 3D Visual Card Depth Layers behind stack */}
      {activeTasks.length >= 3 && (
        <div
          className="absolute inset-0 rounded-2xl bg-slate-800/80 border border-white/5 translate-x-2 translate-y-2.5 shadow-lg"
          style={{ transform: 'rotate(1.5deg) translate(5px, 6px)' }}
        />
      )}
      {activeTasks.length >= 2 && (
        <div
          className="absolute inset-0 rounded-2xl bg-slate-800/90 border border-white/5 translate-x-1 translate-y-1 shadow-md"
          style={{ transform: 'rotate(-1deg) translate(-3px, 3px)' }}
        />
      )}

      {/* Main Front Stack Tray */}
      <div
        className={`relative rounded-2xl bg-slate-900 border transition-all duration-150 ${
          isDragging
            ? 'shadow-2xl scale-[1.02] ring-2 ring-indigo-500/50'
            : 'shadow-xl hover:border-white/20'
        }`}
        style={{ borderColor: `${project.color}60` }}
      >
        {/* Top Header & Drag Handle */}
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="drag-handle flex items-center justify-between p-3.5 border-b border-white/10"
        >
          <div className="flex items-center gap-2.5">
            <span
              className="h-3.5 w-3.5 rounded-full shadow-sm"
              style={{ backgroundColor: project.color }}
            />
            <h4 className="font-black text-sm text-white tracking-wide">
              {project.name}
            </h4>
          </div>

          <div className="flex items-center gap-2">
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider"
              style={{
                backgroundColor: `${project.color}25`,
                color: project.color,
              }}
            >
              {activeTasks.length} {activeTasks.length === 1 ? 'Card' : 'Cards'}
            </span>
            <GripHorizontal className="h-4 w-4 text-slate-500" />
          </div>
        </div>

        {/* Stack Preview Details */}
        <div className="p-3.5 text-xs text-slate-300 space-y-2.5">
          <div className="flex items-center justify-between text-slate-400 font-medium">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3 w-3" />
              <span>{totalMinutes}m total estimated</span>
            </div>
            <span>{project.goal ? project.goal.slice(0, 24) + '...' : ''}</span>
          </div>

          {/* Top Card Peek */}
          {topTask ? (
            <div className="rounded-lg bg-slate-800/90 p-2.5 border border-white/5">
              <span className="text-[10px] font-black tracking-wider uppercase text-slate-400 block mb-1">
                TOP OF DECK
              </span>
              <p className="font-semibold text-slate-200 line-clamp-1">
                {topTask.title}
              </p>
            </div>
          ) : (
            <div className="rounded-lg bg-emerald-950/30 p-2.5 border border-emerald-500/20 text-emerald-400 text-center font-medium">
              ✨ Stack Cleared! No active cards.
            </div>
          )}

          {/* Spread / Gather Action Button */}
          {activeTasks.length > 0 && (
            <button
              type="button"
              onClick={() => onToggleOpen(project.id)}
              className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg font-bold text-xs transition-all shadow-sm ${
                isOpen
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10'
                  : 'text-white hover:opacity-90'
              }`}
              style={{ backgroundColor: isOpen ? undefined : project.color }}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>{isOpen ? 'Gather In Stack' : 'Spread Out Across Desk'}</span>
              {isOpen ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
