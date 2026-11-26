import { NextRequest, NextResponse } from 'next/server';
import { supabaseFetch, isMissingRelationResponse } from '@/lib/supabaseServer';
import {
  getEasternDateKey,
  type DailyProcessGoal,
  type InnerWhyData,
  type SynapseAnchorState,
} from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const ROW_ID = 'synapse_anchor';
const HISTORY_LIMIT = 30;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function emptyState(): SynapseAnchorState {
  return { innerWhy: null, currentGoal: null, goalHistory: [], skippedReviewDateKey: null };
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function clampRating(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(5, Math.max(1, Math.round(n)));
}

function normalizeInnerWhy(raw: unknown): InnerWhyData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    necessity: asString(r.necessity),
    aptitude: asString(r.aptitude),
    motive: asString(r.motive),
    enjoyment: asString(r.enjoyment),
    statement: asString(r.statement),
    updatedAt: asString(r.updatedAt),
  };
}

function normalizeGoal(raw: unknown): DailyProcessGoal | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const text = asString(r.text).trim();
  const dateKey = asString(r.dateKey);
  if (!text || !DATE_KEY_RE.test(dateKey)) return null;
  const goal: DailyProcessGoal = { text, dateKey, createdAt: asString(r.createdAt) };
  const rating = r.rating == null ? undefined : clampRating(r.rating);
  if (rating) {
    goal.rating = rating;
    if (asString(r.ratedAt)) goal.ratedAt = asString(r.ratedAt);
  }
  return goal;
}

/** Dedupe by dateKey (first occurrence wins), sort newest first, cap length. */
function normalizeHistory(list: DailyProcessGoal[]): DailyProcessGoal[] {
  const seen = new Set<string>();
  const out: DailyProcessGoal[] = [];
  for (const g of list) {
    if (seen.has(g.dateKey)) continue;
    seen.add(g.dateKey);
    out.push(g);
  }
  return out.sort((a, b) => b.dateKey.localeCompare(a.dateKey)).slice(0, HISTORY_LIMIT);
}

function normalizeState(raw: unknown): SynapseAnchorState {
  if (!raw || typeof raw !== 'object') return emptyState();
  const r = raw as Record<string, unknown>;
  const history = Array.isArray(r.goalHistory)
    ? r.goalHistory.map(normalizeGoal).filter((g): g is DailyProcessGoal => Boolean(g))
    : [];
  const skipped = asString(r.skippedReviewDateKey);
  return {
    innerWhy: normalizeInnerWhy(r.innerWhy),
    currentGoal: normalizeGoal(r.currentGoal),
    goalHistory: normalizeHistory(history),
    skippedReviewDateKey: DATE_KEY_RE.test(skipped) ? skipped : null,
  };
}

async function readState(): Promise<
  { ok: true; state: SynapseAnchorState } | { ok: false; status: number; error: string; needsMigration: boolean }
> {
  const res = await supabaseFetch(`/agent_settings?id=eq.${ROW_ID}&limit=1`);
  if (!res) return { ok: false, status: 502, error: 'Supabase unreachable', needsMigration: false };
  if (!res.ok) {
    const errText = await res.text();
    return {
      ok: false,
      status: res.status,
      error: errText,
      needsMigration: isMissingRelationResponse(res.status, errText),
    };
  }
  const rows = await res.json();
  return { ok: true, state: normalizeState(Array.isArray(rows) ? rows[0]?.daemon_capabilities : null) };
}

export async function GET() {
  try {
    const result = await readState();
    if (result.ok) return NextResponse.json({ state: result.state });
    if (result.needsMigration) {
      return NextResponse.json({ state: emptyState(), needsMigration: true });
    }
    return NextResponse.json({ state: emptyState(), error: result.error }, { status: result.status });
  } catch (e) {
    return NextResponse.json({ state: emptyState(), error: String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;

    // Read current row first so partial updates never clobber sibling fields.
    const current = await readState();
    if (!current.ok) {
      return NextResponse.json(
        { error: current.error, needsMigration: current.needsMigration },
        { status: current.needsMigration ? 424 : current.status }
      );
    }

    const state = current.state;
    const nowIso = new Date().toISOString();

    // 1. Inner Why
    if (body.innerWhy && typeof body.innerWhy === 'object') {
      const w = body.innerWhy as Record<string, unknown>;
      state.innerWhy = {
        necessity: asString(w.necessity).trim(),
        aptitude: asString(w.aptitude).trim(),
        motive: asString(w.motive).trim(),
        enjoyment: asString(w.enjoyment).trim(),
        statement: asString(w.statement).trim(),
        updatedAt: nowIso,
      };
    }

    // 2. Set / update a daily process goal
    if (body.setGoal && typeof body.setGoal === 'object') {
      const sg = body.setGoal as Record<string, unknown>;
      const trimmed = asString(sg.text).trim();
      if (!trimmed) {
        return NextResponse.json({ error: 'Process goal text is required' }, { status: 400 });
      }
      const requestedKey = asString(sg.dateKey);
      const targetDateKey = DATE_KEY_RE.test(requestedKey) ? requestedKey : getEasternDateKey();

      let sameDayExisting: DailyProcessGoal | null = null;
      if (state.currentGoal) {
        if (state.currentGoal.dateKey === targetDateKey) {
          sameDayExisting = state.currentGoal;
        } else {
          const prev = state.currentGoal;
          state.goalHistory = normalizeHistory([
            prev,
            ...state.goalHistory.filter((g) => g.dateKey !== prev.dateKey),
          ]);
        }
      }
      if (!sameDayExisting) {
        sameDayExisting = state.goalHistory.find((g) => g.dateKey === targetDateKey) || null;
      }

      state.currentGoal = {
        text: trimmed,
        dateKey: targetDateKey,
        createdAt: sameDayExisting?.createdAt || nowIso,
        ...(sameDayExisting?.rating && sg.preserveRating !== false
          ? { rating: sameDayExisting.rating, ratedAt: sameDayExisting.ratedAt }
          : {}),
      };
      // The current goal is the source of truth for its day; drop any stale history copy.
      state.goalHistory = state.goalHistory.filter((g) => g.dateKey !== targetDateKey);
    }

    // 3. Rate a goal (1..5)
    if (body.rateGoal && typeof body.rateGoal === 'object') {
      const rg = body.rateGoal as Record<string, unknown>;
      const dateKey = asString(rg.dateKey);
      const rating = clampRating(rg.rating);
      if (!DATE_KEY_RE.test(dateKey) || !rating) {
        return NextResponse.json({ error: 'rateGoal requires a valid dateKey and rating' }, { status: 400 });
      }
      const applyRating = (g: DailyProcessGoal): DailyProcessGoal =>
        g.dateKey === dateKey ? { ...g, rating, ratedAt: nowIso } : g;

      if (state.currentGoal?.dateKey === dateKey) {
        state.currentGoal = applyRating(state.currentGoal);
      }
      state.goalHistory = state.goalHistory.map(applyRating);
    }

    // 4. Dismiss a past-goal review prompt
    if (typeof body.skipReviewDateKey === 'string' && DATE_KEY_RE.test(body.skipReviewDateKey)) {
      state.skippedReviewDateKey = body.skipReviewDateKey;
    }

    const nextState = normalizeState(state);

    const res = await supabaseFetch('/agent_settings?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ id: ROW_ID, daemon_capabilities: nextState, updated_at: nowIso }),
    });

    if (!res || !res.ok) {
      const errText = res ? await res.text() : 'Supabase unreachable';
      return NextResponse.json(
        { error: errText, needsMigration: res ? isMissingRelationResponse(res.status, errText) : false },
        { status: res?.status || 502 }
      );
    }

    return NextResponse.json({ success: true, state: nextState });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
