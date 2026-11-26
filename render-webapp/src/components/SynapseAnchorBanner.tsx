'use client';

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import {
  getEasternDateKey,
  type DailyProcessGoal,
  type InnerWhyData,
  type SynapseAnchorState,
} from '@/lib/supabase';

type Props = {
  state: SynapseAnchorState;
  onSave: (patchPayload: Record<string, unknown>, optimisticState: SynapseAnchorState) => Promise<void>;
};

type WhyDraft = Omit<InnerWhyData, 'updatedAt'>;

const EMPTY_WHY_DRAFT: WhyDraft = { necessity: '', aptitude: '', motive: '', enjoyment: '', statement: '' };

const NAME_PROMPTS: { key: keyof Omit<WhyDraft, 'statement'>; letter: string; title: string; prompt: string }[] = [
  { key: 'necessity', letter: 'N', title: 'Necessity', prompt: 'Why does this matter now?' },
  { key: 'aptitude', letter: 'A', title: 'Aptitude', prompt: 'When have you done it before?' },
  { key: 'motive', letter: 'M', title: 'Motive', prompt: 'Who or what is it for?' },
  { key: 'enjoyment', letter: 'E', title: 'Enjoyment', prompt: 'What do you love about it?' },
];

const HISTORY_LIMIT = 30;

/** Eastern calendar day before `dateKey` (YYYY-MM-DD), DST-safe. */
function previousDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

function sortHistory(list: DailyProcessGoal[]): DailyProcessGoal[] {
  const seen = new Set<string>();
  return list
    .filter((g) => (seen.has(g.dateKey) ? false : (seen.add(g.dateKey), true)))
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
    .slice(0, HISTORY_LIMIT);
}

/** Client mirror of the server's setGoal mutation, used for optimistic UI. */
function applySetGoal(state: SynapseAnchorState, text: string, dateKey: string): SynapseAnchorState {
  const nowIso = new Date().toISOString();
  let history = state.goalHistory;
  let sameDay: DailyProcessGoal | null = null;
  if (state.currentGoal) {
    if (state.currentGoal.dateKey === dateKey) {
      sameDay = state.currentGoal;
    } else {
      const prev = state.currentGoal;
      history = sortHistory([prev, ...history.filter((g) => g.dateKey !== prev.dateKey)]);
    }
  }
  if (!sameDay) sameDay = history.find((g) => g.dateKey === dateKey) || null;
  return {
    ...state,
    currentGoal: {
      text,
      dateKey,
      createdAt: sameDay?.createdAt || nowIso,
      ...(sameDay?.rating ? { rating: sameDay.rating, ratedAt: sameDay.ratedAt } : {}),
    },
    goalHistory: history.filter((g) => g.dateKey !== dateKey),
  };
}

/** Client mirror of the server's rateGoal mutation. */
function applyRating(state: SynapseAnchorState, dateKey: string, rating: number): SynapseAnchorState {
  const ratedAt = new Date().toISOString();
  const rate = (g: DailyProcessGoal) => (g.dateKey === dateKey ? { ...g, rating, ratedAt } : g);
  return {
    ...state,
    currentGoal: state.currentGoal ? rate(state.currentGoal) : null,
    goalHistory: state.goalHistory.map(rate),
  };
}

function Kicker({ children, className }: { children: React.ReactNode; className: string }) {
  return <p className={`text-xs font-extrabold uppercase tracking-wider ${className}`}>{children}</p>;
}

function GoalRatingFieldset({
  legend,
  value,
  disabled,
  onRate,
}: {
  legend: string;
  value?: number;
  disabled?: boolean;
  onRate: (rating: number) => void;
}) {
  const groupId = useId();
  return (
    <fieldset disabled={disabled} className="min-w-0 border-0 p-0 m-0">
      <legend className="text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between w-full">
        <span>{legend}</span>
        <span className="text-[11px] font-normal text-slate-400">1 Missed · 5 Nailed it</span>
      </legend>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => {
          const id = `${groupId}-rating-${n}`;
          const selected = value === n;
          return (
            <div key={n} className="relative flex flex-1">
              <input
                type="radio"
                id={id}
                name={`${groupId}-rating`}
                value={n}
                checked={selected}
                onChange={() => onRate(n)}
                className="visually-hidden peer"
              />
              <label
                htmlFor={id}
                className={`min-h-[48px] sm:min-h-[44px] flex-1 rounded-xl border flex items-center justify-center gap-1 text-sm font-bold cursor-pointer select-none peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-sky-400 peer-disabled:cursor-not-allowed peer-disabled:opacity-60 transition-colors ${
                  selected
                    ? 'bg-sky-400 text-slate-950 border-sky-300 ring-2 ring-sky-200/70'
                    : 'bg-white/[0.04] text-slate-200 border-white/[0.12] hover:bg-white/[0.08] hover:border-sky-400/50'
                }`}
              >
                {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />}
                <span>{n}</span>
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

export default function SynapseAnchorBanner({ state, onSave }: Props) {
  // Re-check the Eastern date every minute so the card rolls over at midnight.
  const [todayKey, setTodayKey] = useState<string>(() => getEasternDateKey());
  useEffect(() => {
    const id = setInterval(() => setTodayKey(getEasternDateKey()), 60_000);
    return () => clearInterval(id);
  }, []);
  const yesterdayKey = useMemo(() => previousDateKey(todayKey), [todayKey]);

  const todaysGoal = state.currentGoal?.dateKey === todayKey ? state.currentGoal : null;

  const goalToReview = useMemo<DailyProcessGoal | null>(() => {
    const needsReview = (g: DailyProcessGoal) =>
      g.dateKey < todayKey && !g.rating && state.skippedReviewDateKey !== g.dateKey;
    if (state.currentGoal && needsReview(state.currentGoal)) return state.currentGoal;
    return state.goalHistory.find(needsReview) || null;
  }, [state, todayKey]);

  // ---------- My Why dialog ----------
  const whyDialogRef = useRef<HTMLDialogElement>(null);
  const whyStatementRef = useRef<HTMLTextAreaElement>(null);
  const [whyDraft, setWhyDraft] = useState<WhyDraft>(EMPTY_WHY_DRAFT);
  const [whyError, setWhyError] = useState<string | null>(null);
  const [whyStatementTouched, setWhyStatementTouched] = useState(false);
  const [isSavingWhy, setIsSavingWhy] = useState(false);

  const openWhyDialog = useCallback(() => {
    const w = state.innerWhy;
    setWhyDraft(
      w
        ? {
            necessity: w.necessity,
            aptitude: w.aptitude,
            motive: w.motive,
            enjoyment: w.enjoyment,
            statement: w.statement,
          }
        : EMPTY_WHY_DRAFT
    );
    setWhyError(null);
    setWhyStatementTouched(false);
    const dialog = whyDialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      // React's autoFocus runs at mount (while closed), so focus explicitly on open.
      requestAnimationFrame(() => whyStatementRef.current?.focus());
    }
  }, [state.innerWhy]);

  // Light-dismiss fallback for browsers without `closedby` support.
  useEffect(() => {
    const dialog = whyDialogRef.current;
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return;
    const handleClick = (event: MouseEvent) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!inside) dialog.close();
    };
    dialog.addEventListener('click', handleClick);
    return () => dialog.removeEventListener('click', handleClick);
  }, []);

  const validateWhyStatement = (value: string) =>
    value.trim() ? null : 'Write your why in one line before saving.';

  const handleWhySubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const error = validateWhyStatement(whyDraft.statement);
    setWhyStatementTouched(true);
    setWhyError(error);
    if (error) {
      whyStatementRef.current?.focus();
      return;
    }
    const innerWhy: InnerWhyData = {
      necessity: whyDraft.necessity.trim(),
      aptitude: whyDraft.aptitude.trim(),
      motive: whyDraft.motive.trim(),
      enjoyment: whyDraft.enjoyment.trim(),
      statement: whyDraft.statement.trim(),
      updatedAt: new Date().toISOString(),
    };
    setIsSavingWhy(true);
    try {
      await onSave({ innerWhy }, { ...state, innerWhy });
      whyDialogRef.current?.close();
    } catch {
      setWhyError('Could not save your why. Check your connection and try again.');
    } finally {
      setIsSavingWhy(false);
    }
  };

  // ---------- Daily process goal ----------
  const goalInputRef = useRef<HTMLInputElement>(null);
  const [goalDraft, setGoalDraft] = useState('');
  const [goalTouched, setGoalTouched] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);
  const [isEditingGoal, setIsEditingGoal] = useState(false);
  const [isSavingGoal, setIsSavingGoal] = useState(false);
  const [isSavingRating, setIsSavingRating] = useState(false);
  const [showProcessGuide, setShowProcessGuide] = useState(false);

  const validateGoal = (value: string) => (value.trim() ? null : 'Write one action you control today.');

  const startEditingGoal = () => {
    setGoalDraft(todaysGoal?.text || '');
    setGoalError(null);
    setGoalTouched(false);
    setIsEditingGoal(true);
    requestAnimationFrame(() => goalInputRef.current?.focus());
  };

  const cancelEditingGoal = () => {
    setIsEditingGoal(false);
    setGoalError(null);
    setGoalTouched(false);
  };

  const handleGoalSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const error = validateGoal(goalDraft);
    setGoalTouched(true);
    setGoalError(error);
    if (error) {
      goalInputRef.current?.focus();
      return;
    }
    const text = goalDraft.trim();
    setIsSavingGoal(true);
    try {
      await onSave({ setGoal: { text, dateKey: todayKey } }, applySetGoal(state, text, todayKey));
      setIsEditingGoal(false);
      setGoalDraft('');
      setGoalTouched(false);
    } catch {
      setGoalError('Could not save your goal. Check your connection and try again.');
    } finally {
      setIsSavingGoal(false);
    }
  };

  const handleRate = async (dateKey: string, rating: number) => {
    setIsSavingRating(true);
    try {
      await onSave({ rateGoal: { dateKey, rating } }, applyRating(state, dateKey, rating));
    } catch {
      // State is reverted by the parent; nothing else to do here.
    } finally {
      setIsSavingRating(false);
    }
  };

  const handleSkipReview = async (dateKey: string) => {
    try {
      await onSave({ skipReviewDateKey: dateKey }, { ...state, skippedReviewDateKey: dateKey });
    } catch {
      // Reverted by the parent.
    }
  };

  const whyStatement = state.innerWhy?.statement?.trim();
  const showGoalForm = !todaysGoal || isEditingGoal;

  return (
    <section aria-label="Daily Why and Process Goal" className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
      {/* ---------- MY WHY ---------- */}
      <div className="rounded-2xl bg-pink-500/[0.08] border border-pink-500/35 p-4 flex flex-col justify-between gap-3">
        <div className="flex items-center justify-between gap-2">
          <Kicker className="text-pink-400">My Why</Kicker>
          <button
            type="button"
            onClick={openWhyDialog}
            className="min-h-[36px] px-3 py-1.5 rounded-xl bg-pink-500/15 hover:bg-pink-500/25 text-xs font-semibold text-pink-200"
          >
            {whyStatement ? 'Edit' : 'Set My Why'}
          </button>
        </div>
        {whyStatement ? (
          <p className="text-base sm:text-[1.0625rem] font-bold text-white leading-[1.45] [text-wrap:pretty] break-words">
            {state.innerWhy?.statement}
          </p>
        ) : (
          <p className="text-sm text-slate-300 leading-[1.5]">
            Anchor your day in one sentence using SYNAPSE&apos;s NAME framework (Necessity, Aptitude, Motive,
            Enjoyment).
          </p>
        )}
      </div>

      {/* ---------- DAILY PROCESS GOAL ---------- */}
      <div className="rounded-2xl bg-sky-500/[0.08] border border-sky-500/35 p-4 flex flex-col justify-between gap-3">
        {/* A. Review a past, unrated goal */}
        {goalToReview && (
          <div className="rounded-xl bg-[#111318]/90 border border-sky-400/30 p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-extrabold uppercase tracking-wider text-sky-300">
                {goalToReview.dateKey === yesterdayKey
                  ? "Yesterday's Process Goal"
                  : `Previous Process Goal (${goalToReview.dateKey})`}
              </p>
              <button
                type="button"
                onClick={() => handleSkipReview(goalToReview.dateKey)}
                className="min-h-[32px] px-2.5 py-1 text-xs text-slate-400 hover:text-white"
              >
                Skip
              </button>
            </div>
            <p className="text-sm font-bold text-white [text-wrap:pretty]">{goalToReview.text}</p>
            <GoalRatingFieldset
              legend="How did you do?"
              value={goalToReview.rating}
              disabled={isSavingRating}
              onRate={(n) => handleRate(goalToReview.dateKey, n)}
            />
          </div>
        )}

        {/* B. Set / edit today's goal */}
        {showGoalForm && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Kicker className="text-sky-400">Daily Process Goal</Kicker>
              <button
                type="button"
                aria-expanded={showProcessGuide}
                aria-controls="process-vs-outcome-guide"
                onClick={() => setShowProcessGuide((v) => !v)}
                className="min-h-[32px] px-2.5 py-1 rounded-lg text-xs font-semibold text-sky-300 hover:text-sky-100 hover:bg-sky-500/15"
              >
                Process vs Outcome?
              </button>
            </div>
            <div
              id="process-vs-outcome-guide"
              hidden={!showProcessGuide}
              className="rounded-xl bg-[#111318]/80 border border-white/[0.08] p-3 text-xs text-slate-300 leading-[1.55] space-y-1.5"
            >
              <p>
                <strong className="text-white">Outcome goals</strong> are results you cannot fully control (winning a
                match, getting a promotion).
              </p>
              <p>
                <strong className="text-white">Process goals</strong> are daily actions you 100% control (studying or
                focusing 30 minutes without distractions, taking a calm breath before responding).
              </p>
              <p>Life and sports are the same: how you practice today determines how you play tomorrow.</p>
            </div>
            <form onSubmit={handleGoalSubmit} noValidate aria-label="Set daily process goal" className="space-y-2">
              <label htmlFor="today-process-goal-input" className="block text-xs font-semibold text-slate-200">
                Today I will... <span aria-hidden="true">*</span>
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  ref={goalInputRef}
                  id="today-process-goal-input"
                  name="processGoal"
                  type="text"
                  required
                  value={goalDraft}
                  onChange={(e) => {
                    setGoalDraft(e.target.value);
                    setGoalTouched(true);
                    if (goalError) setGoalError(validateGoal(e.target.value));
                  }}
                  onBlur={() => {
                    if (goalTouched) setGoalError(validateGoal(goalDraft));
                  }}
                  aria-invalid={Boolean(goalError)}
                  aria-describedby={goalError ? 'process-goal-error' : undefined}
                  placeholder="e.g. Give 100% focus for 30m before checking Slack"
                  className="flex-1 min-h-[48px] sm:min-h-[42px] bg-[#111318] border border-white/[0.12] rounded-xl px-3.5 py-2 text-base sm:text-sm text-white placeholder:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
                />
                <button
                  type="submit"
                  disabled={isSavingGoal}
                  className="min-h-[48px] sm:min-h-[42px] px-4 py-2 rounded-xl bg-sky-400 hover:bg-sky-300 text-slate-950 text-sm font-extrabold shrink-0 disabled:opacity-60"
                >
                  {isSavingGoal ? 'Saving...' : todaysGoal ? 'Update Goal' : 'Set Goal'}
                </button>
                {isEditingGoal && todaysGoal && (
                  <button
                    type="button"
                    onClick={cancelEditingGoal}
                    className="min-h-[48px] sm:min-h-[42px] px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 text-sm font-semibold shrink-0"
                  >
                    Cancel
                  </button>
                )}
              </div>
              {goalError && (
                <p id="process-goal-error" role="alert" className="text-xs font-semibold text-rose-300">
                  {goalError}
                </p>
              )}
            </form>
          </div>
        )}

        {/* C. Today's goal + check-in */}
        {todaysGoal && !isEditingGoal && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Kicker className="text-sky-400">Today&apos;s Process Goal</Kicker>
                {todaysGoal.rating && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-400/15 border border-sky-400/30 text-[11px] font-semibold text-sky-200">
                    <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                    {`Checked in: ${todaysGoal.rating}/5`}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={startEditingGoal}
                className="min-h-[36px] px-3 py-1.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 text-xs font-semibold text-sky-200 shrink-0"
              >
                Edit
              </button>
            </div>
            <p className="text-base sm:text-[1.0625rem] font-bold text-white leading-[1.45] [text-wrap:pretty] break-words">
              {todaysGoal.text}
            </p>
            <GoalRatingFieldset
              legend="Goal check-in"
              value={todaysGoal.rating}
              disabled={isSavingRating}
              onRate={(n) => handleRate(todaysGoal.dateKey, n)}
            />
          </div>
        )}
      </div>

      {/* ---------- My Why NAME builder dialog ---------- */}
      <dialog
        ref={whyDialogRef}
        {...({ closedby: 'any' } as Record<string, unknown>)}
        aria-labelledby="why-dialog-title"
        className="m-auto w-[min(92vw,38rem)] max-h-[88dvh] rounded-2xl bg-[#161922] text-slate-100 border border-pink-500/35 p-0 shadow-2xl overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="space-y-1">
            <h1 id="why-dialog-title" className="text-lg font-bold text-white">
              My Why
            </h1>
            <p className="text-sm text-slate-400 leading-[1.5] [text-wrap:pretty]">
              Life and sports are the same: how you practice determines how you play — in sports, school, work, and
              everything else. Build your why with NAME.
            </p>
          </div>
          <button
            type="button"
            onClick={() => whyDialogRef.current?.close()}
            aria-label="Close My Why dialog"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-slate-300 shrink-0"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleWhySubmit} noValidate aria-labelledby="why-dialog-title" className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {NAME_PROMPTS.map(({ key, letter, title, prompt }) => {
              const id = `why-${key}-input`;
              return (
                <div key={key} className="space-y-1.5">
                  <label htmlFor={id} className="block text-xs font-semibold text-slate-200">
                    <span className="text-pink-400 font-extrabold">{letter}</span> — {title}
                    <span className="block font-normal text-slate-400">{prompt}</span>
                  </label>
                  <textarea
                    id={id}
                    name={key}
                    rows={2}
                    value={whyDraft[key]}
                    onChange={(e) => setWhyDraft((d) => ({ ...d, [key]: e.target.value }))}
                    className="w-full bg-[#111318] border border-white/[0.1] rounded-xl px-3 py-2 text-base sm:text-sm text-white placeholder:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pink-400"
                  />
                </div>
              );
            })}
          </div>

          <div className="rounded-xl bg-pink-500/[0.1] border border-pink-500/40 p-3.5 space-y-1.5">
            <label htmlFor="why-statement-input" className="block text-sm font-bold text-pink-100">
              My Why in one line <span aria-hidden="true">*</span>
            </label>
            <textarea
              ref={whyStatementRef}
              id="why-statement-input"
              name="statement"
              rows={2}
              required
              autoFocus
              value={whyDraft.statement}
              onChange={(e) => {
                const value = e.target.value;
                setWhyDraft((d) => ({ ...d, statement: value }));
                setWhyStatementTouched(true);
                if (whyError) setWhyError(validateWhyStatement(value));
              }}
              onBlur={() => {
                if (whyStatementTouched) setWhyError(validateWhyStatement(whyDraft.statement));
              }}
              aria-invalid={Boolean(whyError)}
              aria-describedby={whyError ? 'why-statement-error' : undefined}
              placeholder="e.g. I show up fully so my family and team can count on me."
              className="w-full bg-[#111318] border border-pink-500/30 rounded-xl px-3 py-2 text-base font-semibold text-white placeholder:text-slate-500 placeholder:font-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-pink-400"
            />
            {whyError && (
              <p id="why-statement-error" role="alert" className="text-xs font-semibold text-rose-300">
                {whyError}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => whyDialogRef.current?.close()}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-sm font-semibold text-slate-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSavingWhy}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-pink-500 hover:bg-pink-400 text-white text-sm font-extrabold disabled:opacity-60"
            >
              {isSavingWhy ? 'Saving...' : 'Save My Why'}
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
