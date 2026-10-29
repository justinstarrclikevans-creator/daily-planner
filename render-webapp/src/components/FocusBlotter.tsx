'use client';

import React from 'react';
import { Sparkles } from 'lucide-react';

interface FocusBlotterProps {
  position: { x: number; y: number; width: number; height: number };
  activeFocusCount: number;
}

export default function FocusBlotter({ position, activeFocusCount }: FocusBlotterProps) {
  return (
    <div
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        width: `${position.width}px`,
        height: `${position.height}px`,
        pointerEvents: 'none',
      }}
      className="absolute desk-blotter rounded-3xl p-6 transition-all duration-300"
    >
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-400" />
          <span className="text-xs font-black uppercase tracking-widest text-slate-300">
            TODAY&apos;S FOCUS DESK BLOTTER
          </span>
        </div>
        <span className="text-[11px] font-semibold text-slate-400">
          {activeFocusCount === 0
            ? 'Drag priority cards here to focus'
            : `${activeFocusCount} active in focus`}
        </span>
      </div>

      {activeFocusCount === 0 && (
        <div className="flex h-[calc(100%-40px)] flex-col items-center justify-center text-center text-slate-500">
          <p className="text-xs font-medium max-w-sm">
            Drag 1 to 3 cards into this desk blotter to lock in your main priorities for this work session.
          </p>
        </div>
      )}
    </div>
  );
}
