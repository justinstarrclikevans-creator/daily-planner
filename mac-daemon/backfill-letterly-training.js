#!/usr/bin/env node
// Backfill Justin's Letterly training-related recordings into the Training-Agent corpus + Supabase notes.
// 100% verbatim (only obvious speech-to-text spelling fixes). Idempotent via the "[Letterly #<id>]" marker.
//
// Usage:
//   node backfill-letterly-training.js            # run backfill
//   node backfill-letterly-training.js --dry-run  # list matching notes only, write nothing
//   node backfill-letterly-training.js --max-pages=5
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { listLetterlyNotesPage, getLetterlyNoteFull } = require('./letterly');
const { applyVerbatimSpellingFixes } = require('./ai');
const { insertNote, noteMarkerExists, writeTrainingTranscript, todayEastern } = require('./vault-notes');

const TRAINING_FOLDER = 'Training (Turn90 & SYNAPSE)';
const PAGE_SIZE = 50;

const TRAINING_PATTERNS = [
    /\btrain(?:ing|er|ers|ed)?\b/i,
    /\bfacilitat\w*/i,
    /\bclassroom\b/i,
    /\bclass(?:es)?\b/i,
    /\bcase\s*manag\w*/i,
    /\bsynapse\b/i,
    /\bcommunicat\w*/i,
    /\bpro[\s-]?social\b/i,
    /\bmodel(?:ing|ling)\b/i,
    /\bcbt\b/i,
    /\bcognitive\b/i,
    /\bcoach(?:ing|es)?\b/i,
    /\brole[\s-]?play\w*/i,
    /\blesson plan\w*/i,
];

function parseArgs(argv) {
    const args = { dryRun: false, maxPages: 200 };
    for (const a of argv.slice(2)) {
        if (a === '--dry-run') args.dryRun = true;
        const m = a.match(/^--max-pages=(\d+)$/);
        if (m) args.maxPages = parseInt(m[1], 10);
    }
    return args;
}

function isTrainingRelated(text) {
    const t = String(text || '');
    return TRAINING_PATTERNS.some((re) => re.test(t));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
    const { dryRun, maxPages } = parseArgs(process.argv);
    console.log(`[Backfill] Starting Letterly training backfill${dryRun ? ' (dry run)' : ''}...`);

    const seenIds = new Set();
    const candidates = [];
    for (let page = 1; page <= maxPages; page++) {
        let notes = [];
        try {
            ({ notes } = await listLetterlyNotesPage(page, PAGE_SIZE));
        } catch (e) {
            console.error(`[Backfill] list_notes page ${page} failed:`, e.message);
            break;
        }
        const fresh = notes.filter((n) => n.id != null && !seenIds.has(String(n.id)));
        if (fresh.length === 0) break;
        for (const n of fresh) {
            seenIds.add(String(n.id));
            if (isTrainingRelated(`${n.title}\n${n.preview}`)) candidates.push(n);
        }
        console.log(`[Backfill] Page ${page}: ${notes.length} notes (${candidates.length} training candidates so far)`);
        if (notes.length < PAGE_SIZE) break;
        await sleep(300);
    }

    console.log(`[Backfill] Scanned ${seenIds.size} notes; ${candidates.length} look training-related.`);
    if (dryRun) {
        for (const c of candidates) console.log(`  - #${c.id} ${c.title}`);
        return;
    }

    let saved = 0;
    let skipped = 0;
    let failed = 0;
    for (const n of candidates) {
        const marker = `[Letterly #${n.id}]`;
        try {
            if (await noteMarkerExists(marker, TRAINING_FOLDER)) {
                skipped++;
                continue;
            }
            const full = await getLetterlyNoteFull(n.id);
            await sleep(400);
            const raw = full || n.preview;
            if (!raw || !String(raw).trim()) {
                failed++;
                continue;
            }
            // Re-check relevance against the full transcript (preview may be truncated)
            if (!isTrainingRelated(`${n.title}\n${raw}`)) {
                skipped++;
                continue;
            }
            const verbatim = applyVerbatimSpellingFixes(String(raw).trim());
            const title = applyVerbatimSpellingFixes(n.title || `Letterly #${n.id}`);
            const dateStr = todayEastern(new Date(n.created || n.updated || Date.now()));

            const filePath = writeTrainingTranscript({ id: n.id, title, verbatimText: verbatim, dateStr });
            const note = await insertNote({
                title,
                content: `${verbatim}\n\n---\n_Source: ${marker} · ${dateStr} · verbatim training transcript_`,
                folder: TRAINING_FOLDER,
                source: 'letterly',
            });
            if (note) {
                saved++;
                console.log(`[Backfill] Saved #${n.id} "${title}" -> ${filePath || '(file write failed)'}`);
            } else {
                failed++;
            }
        } catch (e) {
            failed++;
            console.error(`[Backfill] Failed #${n.id}:`, e.message);
        }
    }
    console.log(`[Backfill] Done. Saved ${saved}, skipped ${skipped} (already present / not training), failed ${failed}.`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[Backfill] Fatal:', e.message);
        process.exit(1);
    });
