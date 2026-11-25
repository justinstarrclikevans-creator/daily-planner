// Verbatim-first Letterly 5-lane router.
// Used by sync.js (15-minute + hourly loop) and backfill-letterly-training.js.
//
// HARD RULES:
//  - Outbound Slack + email are NEVER sent from here. They only become agent_jobs
//    that land in "Needs You" (status 'needs_approval') for Justin's 1-tap approval.
//  - Justin's words are stored verbatim (speech-to-text spelling fixes only).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { triageLetterlyNote } = require('./ai');
const { resolveSlackRecipient } = require('./slack');
const { getIncompleteReminders, getRecentCompletedReminders, addReminder } = require('./reminders');
const { supabase, syncTaskToSupabase } = require('./supabase');
const {
    insertNote,
    appendToL10Agenda,
    writeTrainingTranscript,
    todayEastern,
} = require('./vault-notes');

const STATE_FILE = path.join(__dirname, 'state.json');
const MAX_PROCESSED_IDS = 2000;

let isRouting = false;

function readState() {
    try {
        if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (e) {}
    return {};
}

function getProcessedIds() {
    const state = readState();
    return new Set((state.processedLetterlyNoteIds || []).map(String));
}

/** Re-read state from disk right before writing so concurrent sync writers are not clobbered. */
function markNoteProcessed(noteId, timestamp) {
    const state = readState();
    const ids = (state.processedLetterlyNoteIds || []).map(String);
    if (!ids.includes(String(noteId))) ids.push(String(noteId));
    state.processedLetterlyNoteIds = ids.slice(-MAX_PROCESSED_IDS);
    if (timestamp && (!state.lastLetterlySync || timestamp > state.lastLetterlySync)) {
        state.lastLetterlySync = timestamp;
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function normalizeTitle(str) {
    return String(str || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function quoteForNotes(text) {
    // Keep Justin's words exactly as spoken (addReminder escapes quotes for AppleScript).
    return String(text || '').trim();
}

async function insertAgentJob(row) {
    if (!supabase) return null;
    const nowIso = new Date().toISOString();
    const payload = {
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
        created_at: nowIso,
        updated_at: nowIso,
        ...row,
    };
    const { data, error } = await supabase.from('agent_jobs').insert([payload]).select();
    if (error) {
        console.error('[Letterly Router] Failed inserting agent job:', error.message);
        return null;
    }
    return Array.isArray(data) ? data[0] : payload;
}

async function routeTask(item, note, ctx) {
    const norm = normalizeTitle(item.title);
    if (!norm) return { lane: 'task', skipped: 'empty' };
    if (ctx.activeTitles.has(norm) || ctx.completedTitles.has(norm)) {
        console.log(`[Letterly Router] Task already exists/completed, skipping: "${item.title}"`);
        return { lane: 'task', skipped: 'duplicate', title: item.title };
    }
    const description = `Verbatim (Letterly): "${quoteForNotes(item.verbatimQuote)}"\n[Letterly #${note.id}]`;
    const ok = await addReminder('General', item.title, description, 'none');
    if (ok) ctx.activeTitles.add(norm);
    await syncTaskToSupabase({
        title: item.title,
        description,
        listName: 'General',
        projectId: null,
        tags: [],
        subtasks: [],
        estimatedMinutes: null,
        priority: 'none',
        source: 'letterly',
    });
    console.log(`[Letterly Router] Task added: "${item.title}"`);
    return { lane: 'task', title: item.title, reminderAdded: ok };
}

async function routeSlackMessage(item, note) {
    const results = [];
    for (const recipient of item.recipients) {
        const resolved = await resolveSlackRecipient(recipient).catch((e) => ({ ok: false, error: e.message }));
        const recipientName = resolved.displayName || recipient;
        const output_markdown =
            `**Slack DM to:** ${recipientName}${resolved.ok ? '' : ' _(recipient not resolved — edit before approving)_'}\n\n---\n\n${item.messageText}\n\n---\n` +
            `_Verbatim (Letterly #${note.id}):_ "${item.verbatimQuote}"`;
        const job = await insertAgentJob({
            agent_role: 'outreach',
            job_type: 'slack_message',
            title: `Slack ${recipientName}: ${item.messageText.slice(0, 60)}${item.messageText.length > 60 ? '…' : ''}`,
            prompt: item.verbatimQuote,
            // Strict 1-tap approval: never auto-send.
            status: 'needs_approval',
            output_markdown,
            output_payload: {
                isSlack: true,
                recipientName,
                recipientQuery: recipient,
                slackUserId: resolved.userId || null,
                slackChannelId: resolved.channelId || null,
                slackHandle: resolved.handle || '',
                resolveError: resolved.ok ? null : resolved.error || 'unresolved',
                messageText: item.messageText,
                verbatimQuote: item.verbatimQuote,
                letterlyNoteId: note.id,
            },
        });
        console.log(`[Letterly Router] Slack draft for ${recipientName} -> Needs You (1-tap approval).`);
        results.push({ lane: 'slack_message', recipientName, jobId: job?.id || null });
    }
    return results;
}

async function routeDelegate(item, note) {
    const title =
        item.jobType === 'email_outreach'
            ? `Email ${item.recipientName || 'contact'}${item.subject ? `: ${item.subject}` : ''}`
            : item.subject || item.prompt.slice(0, 80);
    const outputPayload = { verbatimQuote: item.verbatimQuote, letterlyNoteId: note.id };
    if (item.jobType === 'email_outreach') {
        // Recipient email is filled in by Justin on the approval card; never sent before approval.
        outputPayload.toName = item.recipientName || '';
        outputPayload.isEmail = true;
    }
    if (item.jobType === 'rerun_coworker' && item.recipientName) {
        outputPayload.coworkerName = item.recipientName;
    }
    const job = await insertAgentJob({
        agent_role: item.jobType === 'email_outreach' ? 'outreach' : item.jobType === 'rerun_coworker' ? 'rerun' : 'ceo',
        job_type: item.jobType,
        title,
        prompt: `${item.prompt}\n\nJustin's verbatim words (Letterly #${note.id}): "${item.verbatimQuote}"`,
        // agent-worker drafts it, then moves it to 'needs_approval' (1-tap approval before any send).
        status: 'queued',
        output_payload: outputPayload,
    });
    console.log(`[Letterly Router] Delegated ${item.jobType}: "${title}"`);
    return { lane: 'delegate', jobType: item.jobType, jobId: job?.id || null };
}

async function routeVaultNote(item, note) {
    const dateStr = todayEastern(note.timestamp ? new Date(note.timestamp) : new Date());
    const marker = `[Letterly #${note.id}]`;
    const result = { lane: 'vault_note', folder: item.folder, l10Target: item.l10Target };

    if (item.l10Target === 'leadership' || item.l10Target === 'program') {
        const updated = await appendToL10Agenda(item.l10Target, item.verbatimTranscript, { dateStr, marker });
        result.noteId = updated?.id || null;
    } else {
        const saved = await insertNote({
            title: item.title,
            content: `${item.verbatimTranscript}\n\n---\n_Source: ${marker} · ${dateStr} · verbatim${item.isTrainingCorpus ? ' · training corpus' : ''}_`,
            folder: item.folder,
            source: 'letterly',
        });
        result.noteId = saved?.id || null;
    }

    if (item.folder === 'Training (Turn90 & SYNAPSE)' || item.isTrainingCorpus) {
        result.transcriptPath = writeTrainingTranscript({
            id: note.id,
            title: item.title,
            verbatimText: item.verbatimTranscript,
            dateStr,
        });
    }
    return result;
}

async function routeCodeChange(item, note) {
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
            letterlyNoteId: note.id,
            pushOnApprove: false,
        },
    });
    await insertNote({
        title: `Code Change: ${item.title}`,
        content:
            `**Repo:** ${item.targetRepo} · **Mode:** ${item.executionMode === 'claude_direct' ? 'Direct Claude Code' : 'Antigravity → Claude Code'}\n` +
            `**Agent Job:** ${job?.id || 'not queued'}\n\n---\n\n${item.verbatimSpec}\n\n---\n_Source: [Letterly #${note.id}] · verbatim_`,
        folder: 'App Build Backlog',
        source: 'letterly',
    });
    console.log(`[Letterly Router] Code change queued for ${item.targetRepo}: "${item.title}"`);
    return { lane: 'code_change', jobId: job?.id || null };
}

/**
 * True if this Letterly note was already routed by either the daemon or the
 * render-webapp /api/letterly-webhook (shared `[Letterly #id]` marker / letterlyNoteId).
 */
async function isLetterlyNoteRoutedInSupabase(noteId) {
    if (!supabase || noteId == null) return false;
    const marker = `%[Letterly #${String(noteId).replace(/[%_]/g, '')}]%`;
    try {
        const [jobs, notes, tasks] = await Promise.all([
            supabase.from('agent_jobs').select('id').eq('output_payload->>letterlyNoteId', String(noteId)).limit(1),
            supabase.from('notes').select('id').ilike('content', marker).limit(1),
            supabase.from('tasks').select('id').ilike('description', marker).limit(1),
        ]);
        return [jobs, notes, tasks].some((r) => !r.error && Array.isArray(r.data) && r.data.length > 0);
    } catch (e) {
        return false;
    }
}

/**
 * When the render-webapp webhook routed a note first, it cannot write local files.
 * Mirror any training-corpus vault notes for this Letterly id into the Training-Agent transcripts folder.
 */
async function mirrorTrainingTranscriptsFromSupabase(note) {
    if (!supabase) return 0;
    const marker = `[Letterly #${note.id}]`;
    const { data, error } = await supabase
        .from('notes')
        .select('id, title, content, folder')
        .ilike('content', `%${marker.replace(/[%_]/g, '')}%`)
        .limit(20);
    if (error || !Array.isArray(data)) return 0;
    let written = 0;
    for (const row of data) {
        const content = String(row.content || '');
        const isTraining = row.folder === 'Training (Turn90 & SYNAPSE)' || content.includes('· training corpus');
        if (!isTraining) continue;
        const footerIdx = content.lastIndexOf('\n\n---\n_Source:');
        const verbatimText = (footerIdx > -1 ? content.slice(0, footerIdx) : content).trim();
        if (!verbatimText) continue;
        if (writeTrainingTranscript({ id: note.id, title: row.title, verbatimText })) written++;
    }
    return written;
}

/**
 * Process an array of Letterly notes `{ id, title, content, timestamp }` through the 5-lane router.
 * Returns a summary of routed items per note.
 */
async function processLetterlyNotes(notes = [], { force = false } = {}) {
    if (!Array.isArray(notes) || notes.length === 0) return [];
    if (isRouting) {
        console.log('[Letterly Router] Already routing; skipping overlapping run.');
        return [];
    }
    isRouting = true;
    const summary = [];
    try {
        const processed = getProcessedIds();
        const pending = notes.filter((n) => n && n.id != null && (force || !processed.has(String(n.id))));
        if (pending.length === 0) return [];

        const [active, completed] = await Promise.all([
            getIncompleteReminders().catch(() => []),
            getRecentCompletedReminders().catch(() => []),
        ]);
        const state = readState();
        const ctx = {
            activeTitles: new Set(active.map((t) => normalizeTitle(t.title))),
            completedTitles: new Set([
                ...completed.map((t) => normalizeTitle(t.title)),
                ...(state.completedTaskTitles || []),
            ]),
        };

        // Oldest first so L10 agenda lines stay chronological
        pending.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        for (const note of pending) {
            try {
                if (!force && (await isLetterlyNoteRoutedInSupabase(note.id))) {
                    console.log(`[Letterly Router] #${note.id} already routed (webhook/earlier run); skipping.`);
                    await mirrorTrainingTranscriptsFromSupabase(note);
                    markNoteProcessed(note.id, note.timestamp);
                    continue;
                }
                console.log(`[Letterly Router] Triage Letterly #${note.id}: "${note.title}"`);
                const items = await triageLetterlyNote(note, { existingTodos: active, completedTodos: completed });
                const routed = [];
                for (const item of items) {
                    try {
                        if (item.lane === 'task') routed.push(await routeTask(item, note, ctx));
                        else if (item.lane === 'slack_message') routed.push(...(await routeSlackMessage(item, note)));
                        else if (item.lane === 'delegate') routed.push(await routeDelegate(item, note));
                        else if (item.lane === 'vault_note') routed.push(await routeVaultNote(item, note));
                        else if (item.lane === 'code_change') routed.push(await routeCodeChange(item, note));
                    } catch (itemErr) {
                        console.error(`[Letterly Router] Failed routing ${item.lane} for #${note.id}:`, itemErr.message);
                        routed.push({ lane: item.lane, error: itemErr.message });
                    }
                }
                markNoteProcessed(note.id, note.timestamp);
                summary.push({ noteId: note.id, title: note.title, routed });
            } catch (noteErr) {
                console.error(`[Letterly Router] Failed processing #${note.id}:`, noteErr.message);
            }
        }
    } finally {
        isRouting = false;
    }
    return summary;
}

module.exports = { processLetterlyNotes, getProcessedIds, markNoteProcessed, isLetterlyNoteRoutedInSupabase };
