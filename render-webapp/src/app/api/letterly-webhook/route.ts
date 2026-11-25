import { NextRequest, NextResponse } from 'next/server';
import { supabaseFetch } from '@/lib/supabaseServer';
import { CANONICAL_NOTE_FOLDERS } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Letterly Actions Webhook -> verbatim-first 5-lane router.
// HARD RULES:
//  - Outbound Slack/email are NEVER sent here. Slack drafts land as 'needs_approval'; email/delegate jobs land
//    as 'queued' so the Mac daemon drafts them and moves them to 'needs_approval' for Justin's 1-tap approval.
//  - Justin's words are stored verbatim (only obvious speech-to-text spelling fixes).

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const WEBHOOK_SECRET = (process.env.LETTERLY_WEBHOOK_SECRET || '').trim();

const L10_FOLDER = 'Turn90 Ops & Dual L10s';
const L10_AGENDA_TITLES: Record<'leadership' | 'program', string> = {
  leadership: 'Leadership L10 — Running Agenda',
  program: 'Program L10 — Running Agenda',
};
const CANONICAL: readonly string[] = CANONICAL_NOTE_FOLDERS;
const DELEGATE_JOB_TYPES = ['email_outreach', 'rerun_coworker', 'task_assist'] as const;
const CODE_REPOS = ['todo', 'turn90', 'synapse', 'liturgy', 'resource'] as const;

type RoutedItem =
  | { lane: 'task'; title: string; verbatimQuote: string }
  | { lane: 'slack_message'; recipients: string[]; messageText: string; verbatimQuote: string }
  | {
      lane: 'delegate';
      jobType: (typeof DELEGATE_JOB_TYPES)[number];
      recipientName: string;
      subject: string;
      prompt: string;
      verbatimQuote: string;
    }
  | {
      lane: 'vault_note';
      folder: string;
      title: string;
      verbatimTranscript: string;
      l10Target: 'leadership' | 'program' | null;
      isTrainingCorpus: boolean;
    }
  | {
      lane: 'code_change';
      targetRepo: (typeof CODE_REPOS)[number];
      executionMode: 'antigravity_claude' | 'claude_direct';
      title: string;
      verbatimSpec: string;
    };

function applyVerbatimSpellingFixes(text: string): string {
  return String(text || '')
    .replace(/\bturn[\s-]+(?:90|ninety)\b/gi, 'Turn90')
    .replace(/\bturn90\b/gi, 'Turn90')
    .replace(/\bL\.?\s+S\.?\s+C\.?\s+M\.?\s+I\b\.?/g, 'LS/CMI')
    .replace(/\bLS\s+CMI\b/g, 'LS/CMI')
    .replace(/\bLSCMI\b/gi, 'LS/CMI')
    .replace(/\bsynapse\b/gi, 'SYNAPSE')
    .replace(/\b8\s+4\s+3(?:\s*F\.?\s*C\b\.?)?/gi, '843FC')
    .replace(/\b843\s+F\.?\s*C\b\.?/gi, '843FC');
}

function stripTaskLeadIns(title: string): string {
  let t = String(title || '').trim();
  const leadIns = [
    /^(?:ok(?:ay)?|so|um+|uh+|alright|and)[,\s]+/i,
    /^(?:hey\s+)?(?:remind me to|reminder to|reminder:)\s+/i,
    /^(?:i\s+)?(?:need to|have to|gotta|got to|should|want to|must)\s+/i,
    /^(?:i'm going to|i am going to|i'm gonna|gonna)\s+/i,
    /^(?:don't forget to|make sure (?:i|to)|make sure that i)\s+/i,
    /^(?:to do:|todo:)\s*/i,
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of leadIns) {
      const next = t.replace(re, '');
      if (next !== t) {
        t = next.trim();
        changed = true;
      }
    }
  }
  t = t.replace(/!+/g, '').replace(/#\w[\w-]*/g, '').replace(/\s+/g, ' ').trim();
  if (t) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t.replace(/[.,;:]+$/, '');
}

function splitIntoSentences(text: string): string[] {
  const parts = String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/(?<=[.?!])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [String(text || '').trim()].filter(Boolean);
}

function todayEastern(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function parseJsonLoose(text: string): unknown {
  let cleaned = String(text || '').trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const a = cleaned.indexOf('[');
    const b = cleaned.lastIndexOf(']');
    if (a !== -1 && b > a) {
      try {
        return JSON.parse(cleaned.slice(a, b + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function triage(noteId: string, title: string, rawContent: string): Promise<RoutedItem[]> {
  const normalized = applyVerbatimSpellingFixes(rawContent);
  const sentences = splitIntoSentences(normalized);
  const fallback: RoutedItem[] = [
    {
      lane: 'vault_note',
      folder: 'App Build Backlog',
      title: applyVerbatimSpellingFixes(title || `Letterly #${noteId}`),
      verbatimTranscript: normalized,
      l10Target: null,
      isTrainingCorpus: false,
    },
  ];
  if (!GEMINI_API_KEY) return fallback;

  const numbered = sentences.map((s, i) => `[${i}] ${s}`).join('\n');
  const prompt = `You are routing Justin Evans's raw Letterly voice recording into atomic items. Justin is the executive director of Turn90 (reentry nonprofit, 5 centers: Charleston, Columbia, Spartanburg, Reentry Navigation, Prison Program), author of SYNAPSE (training framework + book), and involved with 843FC (soccer club).

ABSOLUTE RULE — VERBATIM FIRST:
- NEVER rewrite, summarize, or paraphrase Justin's words. You only POINT to his sentences by index.
- Every item MUST include "sentenceStart" and "sentenceEnd" (inclusive indices into the numbered sentences below).
- Short fields you write (title, messageText, subject, prompt) must reuse Justin's own phrasing as closely as possible.

LANES (pick exactly one per item):
1. "task": personal to-do for Justin. Fields: title (his own phrasing, drop lead-ins like "remind me to" / "I need to", no "!" no "#").
2. "slack_message": Justin asks to Slack/message/tell/ping a staff member. Fields: recipients (array of first names), messageText (in Justin's own words and direct supportive tone, first person).
3. "delegate": work for an AI agent. Fields: jobType ("email_outreach" | "rerun_coworker" | "task_assist"), recipientName, subject, prompt.
4. "vault_note": ideas, reflections, training content, quotes, L10 agenda items, budget/home notes. Fields: folder (EXACTLY one of ${JSON.stringify(CANONICAL)}), title, l10Target ("leadership" for org rocks/finance/HR/Gusto/partners/donors/strategy/Amy/Katie/Sean/Daisy; "program" for center scorecards/Apricot/Briefcase/LS/CMI/training/SkillCat/Matt/Jenn/Diyoung/TB/LaShawn/Stacy/Casey; else null), isTrainingCorpus (true for classroom facilitation, case management, SYNAPSE, Pro-Social Modeling, CBT, communication or coaching content).
5. "code_change": a change to one of his apps. Fields: targetRepo (${JSON.stringify(CODE_REPOS)}), executionMode ("antigravity_claude" | "claude_direct"), title.

If the whole recording is one reflection, return a single vault_note spanning all sentences.
Return ONLY a raw JSON array.

Recording title: ${JSON.stringify(applyVerbatimSpellingFixes(title))}
Numbered sentences:
${numbered}`;

  let parsed: unknown = null;
  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.15 },
        }),
      }
    );
    if (geminiRes.ok) {
      const json = await geminiRes.json();
      parsed = parseJsonLoose(json.candidates?.[0]?.content?.parts?.[0]?.text || '');
    }
  } catch {
    parsed = null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return fallback;

  const spanText = (item: Record<string, unknown>): string => {
    const max = sentences.length - 1;
    let start = parseInt(String(item.sentenceStart ?? ''), 10);
    let end = parseInt(String(item.sentenceEnd ?? ''), 10);
    if (Number.isNaN(start) && Number.isNaN(end)) return normalized;
    if (Number.isNaN(start)) start = end;
    if (Number.isNaN(end)) end = start;
    start = Math.max(0, Math.min(max, start));
    end = Math.max(start, Math.min(max, end));
    return sentences.slice(start, end + 1).join(' ');
  };

  const routed: RoutedItem[] = [];
  for (const raw of parsed as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object') continue;
    const quote = spanText(raw);
    switch (raw.lane) {
      case 'task': {
        const t = stripTaskLeadIns(applyVerbatimSpellingFixes(String(raw.title || quote)));
        if (t) routed.push({ lane: 'task', title: t, verbatimQuote: quote });
        break;
      }
      case 'slack_message': {
        const recips = (Array.isArray(raw.recipients) ? raw.recipients : [raw.recipients])
          .map((r) => String(r || '').replace(/^[@#]/, '').trim())
          .filter(Boolean);
        if (recips.length)
          routed.push({
            lane: 'slack_message',
            recipients: recips,
            messageText: applyVerbatimSpellingFixes(String(raw.messageText || quote)).replace(/!+/g, '.').trim(),
            verbatimQuote: quote,
          });
        break;
      }
      case 'delegate': {
        const jt = DELEGATE_JOB_TYPES.includes(raw.jobType as (typeof DELEGATE_JOB_TYPES)[number])
          ? (raw.jobType as (typeof DELEGATE_JOB_TYPES)[number])
          : 'task_assist';
        routed.push({
          lane: 'delegate',
          jobType: jt,
          recipientName: String(raw.recipientName || '').trim(),
          subject: applyVerbatimSpellingFixes(String(raw.subject || '')).trim(),
          prompt: applyVerbatimSpellingFixes(String(raw.prompt || quote)).trim(),
          verbatimQuote: quote,
        });
        break;
      }
      case 'vault_note': {
        const folder = CANONICAL.includes(String(raw.folder)) ? String(raw.folder) : 'App Build Backlog';
        const l10 = raw.l10Target === 'leadership' || raw.l10Target === 'program' ? raw.l10Target : null;
        routed.push({
          lane: 'vault_note',
          folder: l10 ? L10_FOLDER : folder,
          title: applyVerbatimSpellingFixes(String(raw.title || title || 'Letterly Note')).trim(),
          verbatimTranscript: quote,
          l10Target: l10,
          isTrainingCorpus: Boolean(raw.isTrainingCorpus) || folder === 'Training (Turn90 & SYNAPSE)',
        });
        break;
      }
      case 'code_change': {
        const repo = CODE_REPOS.includes(raw.targetRepo as (typeof CODE_REPOS)[number])
          ? (raw.targetRepo as (typeof CODE_REPOS)[number])
          : 'todo';
        routed.push({
          lane: 'code_change',
          targetRepo: repo,
          executionMode: raw.executionMode === 'claude_direct' ? 'claude_direct' : 'antigravity_claude',
          title: applyVerbatimSpellingFixes(String(raw.title || 'Code change from Letterly')).replace(/!+/g, '').trim(),
          verbatimSpec: quote,
        });
        break;
      }
      default:
        break;
    }
  }
  return routed.length ? routed : fallback;
}

async function sbJson<T = unknown>(path: string, options: RequestInit = {}): Promise<T | null> {
  const res = await supabaseFetch(path, options);
  if (!res || !res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function insertRow(table: string, row: Record<string, unknown>) {
  return sbJson<Record<string, unknown>[]>(`/${table}`, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
}

async function insertNote(title: string, content: string, folder: string) {
  const now = new Date().toISOString();
  const rows = await insertRow('notes', {
    id: crypto.randomUUID(),
    title: title.slice(0, 180) || 'Letterly Note',
    content,
    folder,
    source: 'letterly',
    created_at: now,
    updated_at: now,
  });
  return rows?.[0] || null;
}

async function insertAgentJob(row: Record<string, unknown>) {
  const now = new Date().toISOString();
  const rows = await insertRow('agent_jobs', {
    id: crypto.randomUUID(),
    venture_id: null,
    project_id: null,
    source_task_id: null,
    prompt: '',
    output_markdown: '',
    output_payload: {},
    revision_feedback: '',
    execution_result: {},
    execution_error: '',
    created_at: now,
    updated_at: now,
    ...row,
  });
  return rows?.[0] || null;
}

async function appendToL10Agenda(l10Type: 'leadership' | 'program', verbatim: string, dateStr: string, marker: string) {
  const title = L10_AGENDA_TITLES[l10Type];
  const existing = await sbJson<{ id: string; content: string }[]>(
    `/notes?select=id,content&title=eq.${encodeURIComponent(title)}&folder=eq.${encodeURIComponent(L10_FOLDER)}&order=updated_at.desc&limit=1`
  );
  let note = existing?.[0] || null;
  if (!note) {
    const header =
      l10Type === 'leadership'
        ? '# Leadership L10 — Running Agenda\n_Wednesdays 12:00–13:30 · Verbatim items captured from Letterly_\n'
        : '# Program L10 — Running Agenda\n_Tuesdays · Verbatim items captured from Letterly_\n';
    const created = await insertNote(title, header, L10_FOLDER);
    if (!created) return null;
    note = { id: String(created.id), content: String(created.content || header) };
  }
  if (String(note.content || '').includes(marker)) return note.id;
  const line = `- **[${dateStr} — Letterly Verbatim]:** ${verbatim} ${marker}`;
  const nextContent = `${String(note.content || '').replace(/\s+$/, '')}\n${line}\n`;
  await supabaseFetch(`/notes?id=eq.${encodeURIComponent(note.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ content: nextContent, updated_at: new Date().toISOString() }),
  });
  return note.id;
}

async function isAlreadyRouted(noteId: string): Promise<boolean> {
  const marker = encodeURIComponent(`*[Letterly #${noteId}]*`);
  const [jobs, notes, tasks] = await Promise.all([
    sbJson<unknown[]>(`/agent_jobs?select=id&output_payload->>letterlyNoteId=eq.${encodeURIComponent(noteId)}&limit=1`),
    sbJson<unknown[]>(`/notes?select=id&content=ilike.${marker}&limit=1`),
    sbJson<unknown[]>(`/tasks?select=id&description=ilike.${marker}&limit=1`),
  ]);
  return [jobs, notes, tasks].some((r) => Array.isArray(r) && r.length > 0);
}

function normalizeTitle(s: string) {
  return String(s || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'letterly-webhook',
    accepts: 'POST { id, title, transcription | text | content }',
    secretRequired: Boolean(WEBHOOK_SECRET),
  });
}

export async function POST(req: NextRequest) {
  try {
    if (WEBHOOK_SECRET) {
      const provided =
        req.headers.get('x-letterly-secret') ||
        req.headers.get('x-webhook-secret') ||
        new URL(req.url).searchParams.get('secret') ||
        '';
      if (provided !== WEBHOOK_SECRET) {
        return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
      }
    }

    const body = await req.json().catch(() => ({}));
    const note = (body && typeof body === 'object' && body.note && typeof body.note === 'object' ? body.note : body) as Record<
      string,
      unknown
    >;
    const rawContent = String(note.transcription || note.text || note.content || '').trim();
    if (!rawContent) {
      return NextResponse.json({ ok: false, error: 'No transcription/text/content in payload.' }, { status: 400 });
    }
    const noteId = String(note.id ?? note.note_id ?? `wh-${Date.now()}`);
    const title = String(note.title || `Letterly #${noteId}`);
    const marker = `[Letterly #${noteId}]`;
    const dateStr = todayEastern();

    if (note.id != null && (await isAlreadyRouted(noteId))) {
      return NextResponse.json({ ok: true, duplicate: true, noteId });
    }

    const items = await triage(noteId, title, rawContent);
    const results: Record<string, unknown>[] = [];

    for (const item of items) {
      if (item.lane === 'task') {
        const existing = await sbJson<{ id: string }[]>(
          `/tasks?select=id,title&title=ilike.${encodeURIComponent(item.title.replace(/[*%,()]/g, ' '))}&limit=1`
        );
        if (existing && existing.length > 0) {
          results.push({ lane: 'task', title: item.title, skipped: 'duplicate' });
          continue;
        }
        const now = new Date().toISOString();
        const rows = await insertRow('tasks', {
          id: crypto.randomUUID(),
          title: item.title,
          description: `Verbatim (Letterly): "${item.verbatimQuote}"\n${marker}`,
          list_name: 'General',
          status: 'pending',
          source: 'letterly',
          estimated_minutes: 5,
          subtasks: [],
          in_play_queue: false,
          created_at: now,
          updated_at: now,
        });
        results.push({ lane: 'task', title: item.title, id: rows?.[0]?.id || null, normalized: normalizeTitle(item.title) });
      } else if (item.lane === 'slack_message') {
        for (const recipient of item.recipients) {
          // Strict 1-tap approval. The daemon resolves the Slack user at approval time; nothing is sent before.
          const job = await insertAgentJob({
            agent_role: 'outreach',
            job_type: 'slack_message',
            title: `Slack ${recipient}: ${item.messageText.slice(0, 60)}${item.messageText.length > 60 ? '…' : ''}`,
            prompt: item.verbatimQuote,
            status: 'needs_approval',
            output_markdown: `**Slack DM to:** ${recipient}\n\n---\n\n${item.messageText}\n\n---\n_Verbatim (Letterly #${noteId}):_ "${item.verbatimQuote}"`,
            output_payload: {
              isSlack: true,
              recipientName: recipient,
              recipientQuery: recipient,
              slackUserId: null,
              slackChannelId: null,
              messageText: item.messageText,
              verbatimQuote: item.verbatimQuote,
              letterlyNoteId: noteId,
            },
          });
          results.push({ lane: 'slack_message', recipient, jobId: job?.id || null });
        }
      } else if (item.lane === 'delegate') {
        const jobTitle =
          item.jobType === 'email_outreach'
            ? `Email ${item.recipientName || 'contact'}${item.subject ? `: ${item.subject}` : ''}`
            : item.subject || item.prompt.slice(0, 80);
        const payload: Record<string, unknown> = { verbatimQuote: item.verbatimQuote, letterlyNoteId: noteId };
        if (item.jobType === 'email_outreach') {
          payload.toName = item.recipientName;
          payload.isEmail = true;
        }
        if (item.jobType === 'rerun_coworker' && item.recipientName) payload.coworkerName = item.recipientName;
        const job = await insertAgentJob({
          agent_role: item.jobType === 'email_outreach' ? 'outreach' : item.jobType === 'rerun_coworker' ? 'rerun' : 'ceo',
          job_type: item.jobType,
          title: jobTitle,
          prompt: `${item.prompt}\n\nJustin's verbatim words (Letterly #${noteId}): "${item.verbatimQuote}"`,
          status: 'queued', // daemon drafts -> 'needs_approval' (1-tap) before any send
          output_payload: payload,
        });
        results.push({ lane: 'delegate', jobType: item.jobType, jobId: job?.id || null });
      } else if (item.lane === 'vault_note') {
        if (item.l10Target) {
          const id = await appendToL10Agenda(item.l10Target, item.verbatimTranscript, dateStr, marker);
          results.push({ lane: 'vault_note', l10Target: item.l10Target, noteId: id });
        } else {
          const saved = await insertNote(
            item.title,
            `${item.verbatimTranscript}\n\n---\n_Source: ${marker} · ${dateStr} · verbatim${
              item.isTrainingCorpus ? ' · training corpus' : ''
            }_`,
            item.folder
          );
          results.push({ lane: 'vault_note', folder: item.folder, noteId: saved?.id || null });
        }
        // Training-Agent transcript files live on the Mac; the daemon mirrors them from these notes.
        if (item.isTrainingCorpus) results.push({ lane: 'training_corpus', pendingLocalWrite: true });
      } else if (item.lane === 'code_change') {
        const job = await insertAgentJob({
          agent_role: 'ceo',
          job_type: 'code_change',
          title: item.title,
          prompt: item.verbatimSpec,
          status: 'queued',
          output_payload: {
            targetRepo: item.targetRepo,
            executionMode: item.executionMode,
            verbatimSpec: item.verbatimSpec,
            letterlyNoteId: noteId,
            pushOnApprove: false,
          },
        });
        await insertNote(
          `Code Change: ${item.title}`,
          `**Repo:** ${item.targetRepo} · **Mode:** ${
            item.executionMode === 'claude_direct' ? 'Direct Claude Code' : 'Antigravity → Claude Code'
          }\n**Agent Job:** ${job?.id || 'not queued'}\n\n---\n\n${item.verbatimSpec}\n\n---\n_Source: ${marker} · verbatim_`,
          'App Build Backlog'
        );
        results.push({ lane: 'code_change', jobId: job?.id || null });
      }
    }

    return NextResponse.json({ ok: true, noteId, routed: results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
