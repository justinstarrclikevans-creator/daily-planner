const { execFileSync } = require('child_process');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { supabase } = require('./supabase');

function fetchAppleNotes() {
    const script = `
const Notes = Application("Notes");
const all = Notes.notes();
const out = [];
for (let i = 0; i < all.length; i++) {
    const n = all[i];
    let folder = "Notes";
    try { folder = n.container().name(); } catch (e) {}
    let created = null;
    let updated = null;
    try { created = n.creationDate().toISOString(); } catch (e) {}
    try { updated = n.modificationDate().toISOString(); } catch (e) {}
    out.push({
        id: String(n.id()),
        title: String(n.name() || "Untitled Note"),
        plaintext: String(n.plaintext() || ""),
        folder: String(folder || "Notes"),
        created_at: created,
        updated_at: updated
    });
}
JSON.stringify(out);
`;
    const raw = execFileSync('osascript', ['-l', 'JavaScript', '-e', script], {
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024
    }).trim();
    return JSON.parse(raw || '[]');
}

function deleteAppleNoteById(noteId) {
    const script = `
const Notes = Application("Notes");
const matches = Notes.notes.whose({ id: ${JSON.stringify(noteId)} })();
if (matches.length > 0) {
    Notes.delete(matches[0]);
    "deleted";
} else {
    "not_found";
}
`;
    return execFileSync('osascript', ['-l', 'JavaScript', '-e', script], {
        encoding: 'utf8'
    }).trim();
}

function cleanBody(title, plaintext) {
    const text = (plaintext || '').replace(/\r\n/g, '\n');
    const lines = text.split('\n');
    if (lines.length > 0 && lines[0].trim() === (title || '').trim()) {
        lines.shift();
        while (lines.length > 0 && lines[0].trim() === '') {
            lines.shift();
        }
    }
    return lines.join('\n').trim();
}

async function main() {
    if (!supabase) {
        console.error('Supabase client is not configured.');
        process.exit(1);
    }

    // 1. Verify public.notes table exists before touching Apple Notes
    const { error: tableErr } = await supabase.from('notes').select('id').limit(1);
    if (tableErr) {
        console.error('Supabase public.notes table is not ready:', tableErr.message);
        console.error('Please run the notes SQL in Supabase SQL Editor first. No Apple Notes were modified.');
        process.exit(2);
    }

    const appleNotes = fetchAppleNotes();
    console.log(`Found ${appleNotes.length} notes in Apple Notes.`);

    let imported = 0;
    let skipped = 0;
    let deleted = 0;
    let failed = 0;

    for (const note of appleNotes) {
        const { data: existing } = await supabase
            .from('notes')
            .select('id')
            .eq('apple_note_id', note.id)
            .limit(1);

        let savedId = existing && existing[0] ? existing[0].id : null;

        if (!savedId) {
            const content = cleanBody(note.title, note.plaintext);
            const payload = {
                title: (note.title || '').trim() || 'Untitled Note',
                content,
                folder: (note.folder || '').trim() || 'Notes',
                apple_note_id: note.id,
                source: 'apple-notes',
                created_at: note.created_at || new Date().toISOString(),
                updated_at: note.updated_at || new Date().toISOString()
            };

            const { data: inserted, error: insErr } = await supabase
                .from('notes')
                .insert([payload])
                .select('id');

            if (insErr || !inserted || !inserted[0]) {
                failed++;
                console.error(`Failed to import "${note.title}":`, insErr ? insErr.message : 'unknown error');
                continue;
            }
            savedId = inserted[0].id;
            imported++;
        } else {
            skipped++;
        }

        // Only delete from Apple Notes after confirming savedId exists in Supabase
        if (savedId) {
            const delRes = deleteAppleNoteById(note.id);
            if (delRes === 'deleted') {
                deleted++;
            } else {
                console.warn(`Could not delete "${note.title}" (${note.id}): ${delRes}`);
            }
        }
    }

    const remaining = fetchAppleNotes().length;
    const { count: supaCount } = await supabase.from('notes').select('id', { count: 'exact', head: true });
    console.log({ imported, skipped, deleted, failed, supabaseNotesCount: supaCount, remainingAppleNotes: remaining });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
