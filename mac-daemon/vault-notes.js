// Shared helpers for "One Brain" vault notes (Supabase `notes`) + Training-Agent corpus files.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { supabase } = require('./supabase');

const TRAINER_REFERENCES_DIR = '/Users/justinevans/Desktop/Training-Agent/.agents/skills/turn90-synapse-trainer/references';
const TRAINER_TRANSCRIPTS_DIR = path.join(TRAINER_REFERENCES_DIR, 'transcripts');
const TRAINER_DAILY_BRIEFS_DIR = path.join(TRAINER_REFERENCES_DIR, 'daily-briefs');

const L10_FOLDER = 'Turn90 Ops & Dual L10s';
const L10_AGENDA_TITLES = {
    leadership: 'Leadership L10 — Running Agenda',
    program: 'Program L10 — Running Agenda',
};

function slugify(input, max = 60) {
    return (
        String(input || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, max)
            .replace(/-$/, '') || 'note'
    );
}

/** YYYY-MM-DD in America/New_York. */
function todayEastern(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}

async function insertNote({ title, content, folder, source = 'letterly' }) {
    if (!supabase) return null;
    const now = new Date().toISOString();
    const payload = {
        id: crypto.randomUUID(),
        title: String(title || 'Untitled Note').trim().slice(0, 180) || 'Untitled Note',
        content: String(content || ''),
        folder: String(folder || 'Notes').trim() || 'Notes',
        source,
        created_at: now,
        updated_at: now,
    };
    const { data, error } = await supabase.from('notes').insert([payload]).select();
    if (error) {
        console.error('[Vault Notes] Insert failed:', error.message);
        return null;
    }
    return Array.isArray(data) ? data[0] : payload;
}

async function findNoteByTitle(title, folder = null) {
    if (!supabase) return null;
    let q = supabase.from('notes').select('*').eq('title', title);
    if (folder) q = q.eq('folder', folder);
    const { data, error } = await q.order('updated_at', { ascending: false }).limit(1);
    if (error || !Array.isArray(data) || data.length === 0) return null;
    return data[0];
}

/** Returns true if any note already contains the given marker (e.g. "[Letterly #123]"). */
async function noteMarkerExists(marker, folder = null) {
    if (!supabase || !marker) return false;
    let q = supabase.from('notes').select('id').ilike('content', `%${marker.replace(/[%_]/g, '\\$&')}%`);
    if (folder) q = q.eq('folder', folder);
    const { data, error } = await q.limit(1);
    return !error && Array.isArray(data) && data.length > 0;
}

async function getL10AgendaNote(l10Type, { createIfMissing = true } = {}) {
    const title = L10_AGENDA_TITLES[l10Type];
    if (!title) return null;
    const existing = await findNoteByTitle(title, L10_FOLDER);
    if (existing || !createIfMissing) return existing;
    const header =
        l10Type === 'leadership'
            ? '# Leadership L10 — Running Agenda\n_Wednesdays 12:00–13:30 · Verbatim items captured from Letterly_\n'
            : '# Program L10 — Running Agenda\n_Tuesdays · Verbatim items captured from Letterly_\n';
    return insertNote({ title, content: header, folder: L10_FOLDER, source: 'letterly' });
}

/** Append a verbatim line to the running L10 agenda note (creating the note if needed). */
async function appendToL10Agenda(l10Type, verbatimText, { dateStr = todayEastern(), marker = '' } = {}) {
    if (!supabase) return null;
    const note = await getL10AgendaNote(l10Type, { createIfMissing: true });
    if (!note) return null;
    if (marker && String(note.content || '').includes(marker)) return note;
    const line = `- **[${dateStr} — Letterly Verbatim]:** ${verbatimText}${marker ? ` ${marker}` : ''}`;
    const nextContent = `${String(note.content || '').replace(/\s+$/, '')}\n${line}\n`;
    const { data, error } = await supabase
        .from('notes')
        .update({ content: nextContent, updated_at: new Date().toISOString() })
        .eq('id', note.id)
        .select();
    if (error) {
        console.error('[Vault Notes] L10 agenda append failed:', error.message);
        return null;
    }
    return Array.isArray(data) ? data[0] : note;
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

/** Write a 100% verbatim training transcript into the Training-Agent references corpus. */
function writeTrainingTranscript({ id, title, verbatimText, dateStr = todayEastern() }) {
    try {
        ensureDir(TRAINER_TRANSCRIPTS_DIR);
        const filePath = path.join(TRAINER_TRANSCRIPTS_DIR, `letterly-${id}-${slugify(title)}.md`);
        const body = `# ${title}\n\n- Source: Letterly #${id}\n- Captured: ${dateStr}\n- Fidelity: verbatim (speech-to-text spelling fixes only)\n\n---\n\n${verbatimText}\n`;
        fs.writeFileSync(filePath, body);
        return filePath;
    } catch (e) {
        console.error('[Vault Notes] Failed writing training transcript:', e.message);
        return null;
    }
}

module.exports = {
    TRAINER_REFERENCES_DIR,
    TRAINER_TRANSCRIPTS_DIR,
    TRAINER_DAILY_BRIEFS_DIR,
    L10_FOLDER,
    L10_AGENDA_TITLES,
    slugify,
    todayEastern,
    insertNote,
    findNoteByTitle,
    noteMarkerExists,
    getL10AgendaNote,
    appendToL10Agenda,
    ensureDir,
    writeTrainingTranscript,
};
