'use client';

import React, { useState, useRef } from 'react';
import { Task, Project } from '@/lib/supabase';
import { GripHorizontal, Clock, CheckCircle2, Circle, Play, Check, Bolt } from 'lucide-react';

interface DraggableCardProps {
  task: Task;
  project?: Project;
  position: { x: number; y: number };
  onMove: (taskId: string, x: number, y: number) => void;
  onToggleSubtask: (taskId: string, subtaskId: string) => void;
  onComplete: (taskId: string) => void;
  onLater: (taskId: string) => void;
  onStartSprint: (task: Task) => void;
}

export default function DraggableCard({
  task,
  project,
  position,
  onMove,
  onToggleSubtask,
  onComplete,
  onLater,
  onStartSprint,
}: DraggableCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isDoneAnimating, setIsDoneAnimating] = useState(false);
  const [isLaterAnimating, setIsLaterAnimating] = useState(false);
  const offsetRef = useRef({ x: 0, y: 0 });

  const projectColor = project?.color || '#6366F1';
  const completedSubtasks = task.subtasks.filter(s => s.isCompleted).length;
  const totalSubtasks = task.subtasks.length;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only allow primary mouse button
    if (e.button !== 0) return;
    // Don't drag if clicking buttons, checkboxes, or links
    if ((e.target as HTMLElement).closest('button, input, select, textarea, a')) return;

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
    onMove(task.id, newX, newY);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  const triggerComplete = () => {
    setIsDoneAnimating(true);
    setTimeout(() => {
      onComplete(task.id);
    }, 280);
  };

  const triggerLater = () => {
    setIsLaterAnimating(true);
    setTimeout(() => {
      onLater(task.id);
    }, 280);
  };

  return (
    <div
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        zIndex: isDragging ? 50 : 10,
        borderColor: projectColor,
      }}
      className={`absolute w-[340px] select-none rounded-xl bg-[#fefcf6] shadow-md transition-shadow transition-transform duration-75 ${
        isDragging ? 'shadow-2xl scale-[1.02] ring-2 ring-indigo-500/40' : 'hover:shadow-xl'
      } ${isDoneAnimating ? 'opacity-0 scale-95 duration-300' : ''} ${
        isLaterAnimating ? 'opacity-0 -translate-x-20 duration-300' : ''
      }`}
    >
      {/* Top Project Color Accent Bar & Drag Handle */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="drag-handle flex items-center justify-between rounded-t-xl px-4 py-2.5"
        style={{ backgroundColor: `${projectColor}15`, borderBottom: `2px solid ${projectColor}` }}
      >
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: projectColor }}
          />
          <span
            className="text-[11px] font-black uppercase tracking-wider"
            style={{ color: projectColor }}
          >
            {project?.name || task.listName}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded bg-black/5 px-2 py-0.5 text-[11px] font-bold text-gray-700">
            <Clock className="h-3 w-3" />
            <span>{task.estimatedMinutes}m</span>
          </div>
          <GripHorizontal className="h-4 w-4 text-gray-400" />
        </div>
      </div>

      {/* Card Body with Lined Index Card Styling */}
      <div className="index-card-pattern p-4 pt-3 text-gray-900 rounded-b-xl min-h-[160px]">
        {/* Task Title */}
        <h3 className="font-bold text-[16px] leading-snug text-gray-900 pl-4">
          {task.title}
        </h3>

        {/* First 5-Minute Kickstart Step */}
        {task.firstFiveMinutes && (
          <div className="mt-2.5 ml-4 flex items-start gap-1.5 rounded-md bg-amber-500/10 p-2 text-xs font-medium text-amber-900 border border-amber-500/20">
            <Bolt className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
            <span>
              <strong className="font-bold">Start:</strong> {task.firstFiveMinutes}
            </span>
          </div>
        )}

        {/* Clean Notes Excerpt (if any) */}
        {task.description && !task.description.startsWith('- [') && (
          <p className="mt-2 ml-4 text-xs text-gray-600 line-clamp-2 leading-relaxed">
            {task.description.split('\n')[0]}
          </p>
        )}

        {/* Subtasks Checklist on Card Face */}
        {totalSubtasks > 0 && (
          <div className="mt-3.5 ml-4 border-t border-blue-900/10 pt-2.5">
            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-gray-500">
              <span>Subtasks ({completedSubtasks}/{totalSubtasks})</span>
              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${(completedSubtasks / totalSubtasks) * 100}%`,
                    backgroundColor: projectColor,
                  }}
                />
              </div>
            </div>

            <div className="mt-2 space-y-1.5">
              {task.subtasks.map((subtask) => (
                <button
                  key={subtask.id}
                  type="button"
                  onClick={() => onToggleSubtask(task.id, subtask.id)}
                  className="flex w-full items-start gap-2 text-left text-xs transition-colors hover:text-black group"
                >
                  {subtask.isCompleted ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
                  ) : (
                    <Circle className="h-4 w-4 shrink-0 text-gray-400 group-hover:text-gray-600 mt-0.5" />
                  )}
                  <span
                    className={`leading-tight ${
                      subtask.isCompleted
                        ? 'line-through text-gray-400 font-normal'
                        : 'text-gray-800 font-medium'
                    }`}
                  >
                    {subtask.title}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Card Footer Actions */}
        <div className="mt-4 flex items-center justify-between border-t border-black/5 pt-2.5">
          <div className="flex items-center gap-1.5">
            {/* Later Button */}
            <button
              type="button"
              onClick={triggerLater}
              title="Defer to tomorrow"
              className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors border border-blue-200/60"
            >
              <Clock className="h-3 w-3" />
              Later
            </button>

            {/* Focus Sprint Button */}
            <button
              type="button"
              onClick={() => onStartSprint(task)}
              title="Start 5m Focus Sprint"
              className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 transition-colors border border-purple-200/60"
            >
              <Play className="h-3 w-3 fill-current" />
              Sprint
            </button>
          </div>

          {/* Done Button */}
          <button
            type="button"
            onClick={triggerComplete}
            title="Mark completed"
            className="flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors shadow-sm"
          >
            <Check className="h-3.5 w-3.5 stroke-[3]" />
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
