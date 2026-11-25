// Daily Classroom & Case Management Training Brief (Turn90 & SYNAPSE).
// Reads REAL local feedback sources only; never fabricates dates; never shows numeric classroom scores.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { callGeminiWithRetry } = require('./gemini-helper');
const { insertNote, ensureDir, todayEastern, TRAINER_DAILY_BRIEFS_DIR } = require('./vault-notes');

const SQLITE_DB_PATH = '/Users/justinevans/Desktop/Turn90/docs/lscmi/audio-interview-app/data/app_database.sqlite';
const DROPBOX_FEEDBACK_DIR = '/Users/justinevans/Library/CloudStorage/Dropbox/Classroom Feedback';
const CASE_FEEDBACK_CACHE = '/Users/justinevans/Desktop/Turn90/pipelines/supervision-report/case_feedback_cache.json';
const TRAINING_FOLDER = 'Training (Turn90 & SYNAPSE)';

const MAX_FIELD_CHARS = 2500;

function clip(str, max = MAX_FIELD_CHARS) {
    const s = String(str || '').trim();
    return s.length > max ? `${s.slice(0, max)}… [truncated]` : s;
}

function sqliteJson(sql) {
    if (!fs.existsSync(SQLITE_DB_PATH)) return [];
    try {
        const out = execFileSync('sqlite3', ['-json', '-readonly', SQLITE_DB_PATH, sql], {
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
            timeout: 30000,
        });
        const trimmed = (out || '').trim();
        return trimmed ? JSON.parse(trimmed) : [];
    } catch (e) {
        console.error('[Training Brief] sqlite3 query failed:', e.message.split('\n')[0]);
        return [];
    }
}

function fetchClassroomEvaluations(days) {
    // Deliberately exclude every numeric score column — classroom scores are never shown.
    const cols = `id, location, session_title, facilitator_name, class_date, created_at, class_headcount,
        detected_session_type, summary_markdown, coaching_feedback`;
    const statusFilter = `(status IS NULL OR status = 'published')`;
    let rows = sqliteJson(
        `SELECT ${cols} FROM class_facilitation_evaluations
         WHERE ${statusFilter} AND date(COALESCE(class_date, created_at)) >= date('now', '-${Number(days)} days')
         ORDER BY COALESCE(class_date, created_at) DESC LIMIT 12;`
    );
    let windowLabel = `last ${days} days`;
    if (rows.length === 0) {
        rows = sqliteJson(
            `SELECT ${cols} FROM class_facilitation_evaluations WHERE ${statusFilter}
             ORDER BY COALESCE(class_date, created_at) DESC LIMIT 8;`
        );
        windowLabel = 'most recent 8 evaluations (none in window — actual session dates shown)';
    }
    return {
        windowLabel,
        rows: rows.map((r) => ({
            sessionDate: r.class_date || (r.created_at || '').slice(0, 10) || 'unknown date',
            location: r.location,
            sessionTitle: r.session_title,
            facilitator: r.facilitator_name,
            headcount: r.class_headcount,
            sessionType: r.detected_session_type,
            summary: clip(stripScores(r.summary_markdown)),
            coachingFeedback: clip(stripScores(r.coaching_feedback)),
        })),
    };
}

function fetchCaseManagementEvaluations(days) {
    const cols = `id, location, session_title, cm_name, session_type, created_at, summary_markdown, feedback,
        next_session_recommendations, referrals_detected, apricot_notes`;
    let rows = sqliteJson(
        `SELECT ${cols} FROM case_management_evaluations
         WHERE date(created_at) >= date('now', '-${Number(days)} days')
         ORDER BY created_at DESC LIMIT 10;`
    );
    let windowLabel = `last ${days} days`;
    if (rows.length === 0) {
        rows = sqliteJson(`SELECT ${cols} FROM case_management_evaluations ORDER BY created_at DESC LIMIT 5;`);
        windowLabel = 'most recent 5 evaluations (none in window — actual session dates shown)';
    }
    return {
        windowLabel,
        rows: rows.map((r) => ({
            sessionDate: (r.created_at || '').slice(0, 10) || 'unknown date',
            location: r.location,
            sessionTitle: r.session_title,
            caseManager: r.cm_name,
            sessionType: r.session_type,
            summary: clip(stripScores(r.summary_markdown)),
            feedback: clip(stripScores(r.feedback)),
            nextSessionRecommendations: clip(r.next_session_recommendations, 1200),
            referralsDetected: clip(r.referrals_detected, 600),
            apricotNotes: clip(r.apricot_notes, 1200),
        })),
    };
}

/** Remove numeric score lines (e.g. "Total Score: 87/100", "Score: 4.5") so no scores reach the model. */
function stripScores(text) {
    return String(text || '')
        .split('\n')
        .filter((line) => !/\bscore\b[^\n]*\d/i.test(line) && !/\b\d{1,3}\s*\/\s*100\b/.test(line))
        .join('\n')
        .replace(/\b\d{1,3}(?:\.\d+)?\s*\/\s*(?:100|10|5)\b/g, '')
        .trim();
}

function readDocxText(filePath) {
    const py = [
        'import sys, zipfile, xml.etree.ElementTree as ET',
        "W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'",
        'z=zipfile.ZipFile(sys.argv[1])',
        "root=ET.fromstring(z.read('word/document.xml'))",
        'out=[]',
        "for p in root.iter(W+'p'):",
        "    t=''.join((n.text or '') for n in p.iter(W+'t'))",
        '    if t.strip(): out.append(t)',
        "sys.stdout.write('\\n'.join(out))",
    ].join('\n');
    try {
        return execFileSync('python3', ['-I', '-c', py, filePath], { encoding: 'utf8', timeout: 3000, maxBuffer: 16 * 1024 * 1024 });
    } catch (e) {
        console.error(`[Training Brief] Failed reading ${path.basename(filePath)}:`, e.message.split('\n')[0]);
        return '';
    }
}

function fetchDropboxClassroomFeedback(limit = 4) {
    // Disabled by default in background PM2 daemon because macOS CloudStorage/FileProvider can block headless stat/open syscalls.
    if (process.env.INCLUDE_DROPBOX_FEEDBACK !== '1') return [];
    try {
        if (!fs.existsSync(DROPBOX_FEEDBACK_DIR)) return [];
        const files = fs
            .readdirSync(DROPBOX_FEEDBACK_DIR)
            .filter((f) => f.toLowerCase().endsWith('.docx') && !f.startsWith('~$'))
            .map((f) => {
                const full = path.join(DROPBOX_FEEDBACK_DIR, f);
                const st = fs.statSync(full);
                return { name: f, full, mtime: st.mtimeMs, blocks: st.blocks, size: st.size };
            })
            // Skip macOS FileProvider `dataless` cloud-evicted files (blocks === 0 && size > 0) so we never block on Dropbox hydration
            .filter((f) => f.size > 0 && f.blocks > 0)
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, limit);
        return files
            .map((f) => ({ file: f.name, text: clip(stripScores(readDocxText(f.full)), 4000) }))
            .filter((f) => f.text);
    } catch (e) {
        console.error('[Training Brief] Dropbox feedback read failed:', e.message);
        return [];
    }
}

function fetchCaseFeedbackCache(limit = 15) {
    try {
        if (!fs.existsSync(CASE_FEEDBACK_CACHE)) return [];
        const data = JSON.parse(fs.readFileSync(CASE_FEEDBACK_CACHE, 'utf8'));
        const entries = Array.isArray(data) ? data.map((v, i) => [String(i), v]) : Object.entries(data || {});
        // Prefer entries mentioning the most recent note dates
        const dated = entries.map(([k, v]) => {
            const text = typeof v === 'string' ? v : JSON.stringify(v);
            const m = text.match(/(\d{4}-\d{2}-\d{2})/);
            return { key: k, text: clip(text, 700), date: m ? m[1] : '' };
        });
        dated.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        return dated.slice(0, limit).map(({ text, date }) => ({ noteDate: date || 'undated', text }));
    } catch (e) {
        console.error('[Training Brief] case_feedback_cache read failed:', e.message);
        return [];
    }
}

function parseJsonLoose(text) {
    let cleaned = String(text || '').trim();
    const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) cleaned = fence[1].trim();
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        const a = cleaned.indexOf('{');
        const b = cleaned.lastIndexOf('}');
        if (a !== -1 && b > a) {
            try { return JSON.parse(cleaned.slice(a, b + 1)); } catch (e2) {}
        }
    }
    return null;
}

/** Final guard: remove any numeric score that slipped into classroom content. */
function scrubClassroomScores(markdown) {
    return String(markdown || '')
        .replace(/\b\d{1,3}(?:\.\d+)?\s*\/\s*(?:100|10|5)\b/g, '')
        .replace(/\b(?:total |overall |facilitation )?score(?:d)?\s*(?:of|:)?\s*\d{1,3}(?:\.\d+)?%?/gi, '')
        .replace(/[ \t]{2,}/g, ' ');
}

async function generateDailyTrainingBrief({ days = 7 } = {}) {
    const dateStr = todayEastern();
    const classroom = fetchClassroomEvaluations(days);
    const caseMgmt = fetchCaseManagementEvaluations(days);
    const dropbox = fetchDropboxClassroomFeedback(4);
    const caseCache = fetchCaseFeedbackCache(15);

    const sourceCounts = {
        classroomEvaluations: classroom.rows.length,
        caseManagementEvaluations: caseMgmt.rows.length,
        dropboxFeedbackDocs: dropbox.length,
        caseFeedbackCacheEntries: caseCache.length,
    };
    console.log('[Training Brief] Sources:', JSON.stringify(sourceCounts));

    const prompt = `You are the Turn90 & SYNAPSE training lead writing Justin Evans's Daily Classroom & Case Management Training Brief for ${dateStr}.
Turn90 runs 5 centers: Charleston, Columbia, Spartanburg, Reentry Navigation, Prison Program.

GROUNDING RULES (non-negotiable):
- Use ONLY the source data below. Never invent sessions, people, quotes, or dates. When citing a session, use its actual sessionDate/location/facilitator.
- NEVER include numeric scores, percentages, ratings or rankings for classroom facilitation. Describe quality qualitatively only.
- Be specific and practical; reference what actually happened.

FORMAT "briefMarkdown" EXACTLY with these sections:
# Daily Classroom & Case Management Training Brief — ${dateStr}
_Sources: (one line listing what data window was used, e.g. "${classroom.windowLabel}" for classroom, "${caseMgmt.windowLabel}" for case management)_
## Cross-Center Training Focus Today
(1 focus, 2-3 sentences, tied to evidence)
## Classroom Facilitation Trends
### What Went Well
### Do's & Don'ts
### SYNAPSE Practices
### Pro-Social Modeling vs. Role-Play
### Talk-Time
### How to Improve
## Case Management & Briefcase Trends
### 6-Part Session Template
(how well sessions followed the 6-part CM session template; gaps)
### 9 Waitlist Items (Briefcase)
(which of the 9 Briefcase/Apricot waitlist items are being missed or done well)
## Suggested Micro-Drills for Turn90 & SYNAPSE Training
(3-5 numbered 5-10 minute drills)

Also propose 1-3 OPTIONAL Slack coaching check-ins to specific staff mentioned in the data (facilitators or case managers), written in Justin's supportive, direct voice (first person, short, specific, no exclamation points, no scores).

Return ONLY JSON:
{
  "briefMarkdown": "...",
  "proposedSlackCheckins": [{ "recipientName": "First name", "messageText": "..." }]
}

CLASSROOM FACILITATION EVALUATIONS (${classroom.windowLabel}):
${JSON.stringify(classroom.rows)}

CASE MANAGEMENT EVALUATIONS (${caseMgmt.windowLabel}):
${JSON.stringify(caseMgmt.rows)}

DROPBOX CLASSROOM FEEDBACK DOCS (newest ${dropbox.length}):
${JSON.stringify(dropbox)}

CASE FEEDBACK CACHE (Apricot/Briefcase notes, newest ${caseCache.length}):
${JSON.stringify(caseCache)}
`;

    let briefMarkdown = '';
    let proposedSlackCheckins = [];
    const totalSources = Object.values(sourceCounts).reduce((a, b) => a + b, 0);

    if (totalSources === 0) {
        briefMarkdown = `# Daily Classroom & Case Management Training Brief — ${dateStr}\n\n_No local feedback sources were readable today (SQLite DB, Dropbox Classroom Feedback, case feedback cache). Nothing was generated to avoid fabricating content._`;
    } else {
        const response = await callGeminiWithRetry({
            model: 'gemini-3.8-flash',
            contents: prompt,
            config: { temperature: 0.3 },
        });
        const parsed = parseJsonLoose(response.text || '');
        briefMarkdown = String(parsed?.briefMarkdown || response.text || '').trim();
        proposedSlackCheckins = Array.isArray(parsed?.proposedSlackCheckins)
            ? parsed.proposedSlackCheckins
                  .filter((c) => c && c.recipientName && c.messageText)
                  .slice(0, 3)
                  .map((c) => ({
                      recipientName: String(c.recipientName).trim(),
                      messageText: scrubClassroomScores(String(c.messageText).replace(/!+/g, '.').trim()),
                      selected: false,
                  }))
            : [];
    }

    briefMarkdown = scrubClassroomScores(briefMarkdown);

    // Write Markdown copy to Training-Agent references
    let filePath = null;
    try {
        ensureDir(TRAINER_DAILY_BRIEFS_DIR);
        filePath = path.join(TRAINER_DAILY_BRIEFS_DIR, `${dateStr}-training-brief.md`);
        fs.writeFileSync(filePath, `${briefMarkdown}\n`);
    } catch (e) {
        console.error('[Training Brief] Failed writing markdown file:', e.message);
    }

    const note = await insertNote({
        title: `Daily Training Brief — ${dateStr}`,
        content: briefMarkdown,
        folder: TRAINING_FOLDER,
        source: 'training_brief',
    });

    return {
        output_markdown: briefMarkdown,
        output_payload: {
            briefDate: dateStr,
            sourceCounts,
            classroomWindow: classroom.windowLabel,
            caseManagementWindow: caseMgmt.windowLabel,
            filePath,
            noteId: note?.id || null,
            proposedSlackCheckins,
        },
    };
}

module.exports = {
    generateDailyTrainingBrief,
    TRAINING_FOLDER,
    _internals: { fetchClassroomEvaluations, fetchCaseManagementEvaluations, fetchDropboxClassroomFeedback, fetchCaseFeedbackCache, scrubClassroomScores },
};
