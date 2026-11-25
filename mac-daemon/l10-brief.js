// Dual L10 Pre-Meeting Briefs (Program L10 — Tuesdays, Leadership L10 — Wednesdays 12:00–13:30).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { supabase } = require('./supabase');
const { callGeminiWithRetry } = require('./gemini-helper');
const { getRecentSlackMessages } = require('./slack');
const { getL10AgendaNote, insertNote, todayEastern, L10_FOLDER } = require('./vault-notes');

const L10_SCOPES = {
    leadership: {
        label: 'Leadership L10',
        when: 'Wednesdays 12:00–13:30',
        scope: [
            'Org rocks (quarterly priorities) — on/off track',
            'Finance, HR & Gusto (payroll, hiring, benefits)',
            'Goodwill / SC Works / donor & funder partnerships',
            'Strategic ventures & growth bets',
        ],
        people: ['amy', 'katie', 'sean', 'daisy'],
    },
    program: {
        label: 'Program L10',
        when: 'Tuesdays (13:15–14:30 window)',
        scope: [
            '5-center scorecards: Charleston, Columbia, Spartanburg, Reentry Navigation, Prison Program',
            'Apricot / Briefcase 9-item compliance',
            'LS/CMI completions',
            'Classroom & Case Management Training Brief takeaways',
            'SkillCat progress',
        ],
        people: ['matt', 'jenn', 'diyoung', 'tb', 'lashawn', 'stacy', 'casey'],
    },
};

async function fetchOpenTasks(limit = 60) {
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('tasks')
        .select('title, description, due_date, list_name, updated_at')
        .eq('status', 'pending')
        .order('updated_at', { ascending: false })
        .limit(limit);
    if (error) return [];
    return (data || []).map((t) => ({
        title: t.title,
        due: t.due_date,
        notes: String(t.description || '').slice(0, 300),
    }));
}

async function fetchRecentTrainingHighlights() {
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('notes')
        .select('title, content, updated_at')
        .eq('folder', 'Training (Turn90 & SYNAPSE)')
        .order('updated_at', { ascending: false })
        .limit(3);
    if (error) return [];
    return (data || []).map((n) => ({ title: n.title, updated: n.updated_at, content: String(n.content || '').slice(0, 3500) }));
}

async function generateL10Brief(l10Type = 'program') {
    const type = l10Type === 'leadership' ? 'leadership' : 'program';
    const cfg = L10_SCOPES[type];
    const dateStr = todayEastern();

    const sevenDaysAgo = Date.now() / 1000 - 7 * 24 * 60 * 60;
    const [agendaNote, openTasks, slackMessages, trainingHighlights] = await Promise.all([
        getL10AgendaNote(type, { createIfMissing: true }).catch(() => null),
        fetchOpenTasks().catch(() => []),
        getRecentSlackMessages(sevenDaysAgo).catch(() => []),
        type === 'program' ? fetchRecentTrainingHighlights().catch(() => []) : Promise.resolve([]),
    ]);

    const slackDigest = (slackMessages || [])
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, 40)
        .map((m) => ({ channel: m.channel, isHuddle: Boolean(m.isHuddle), text: String(m.text || '').slice(0, 1200) }));

    const prompt = `You are Justin Evans's chief of staff preparing a crisp 1-page ${cfg.label} Pre-Meeting Brief (meeting: ${cfg.when}) for ${dateStr}.
Scope this brief STRICTLY to:
${cfg.scope.map((s) => `- ${s}`).join('\n')}
Open loops to surface by person: ${cfg.people.map((p) => `#${p}`).join(', ')}.

RULES:
- Use only the data below. Do not invent numbers, names, or commitments. If a scorecard number is unknown, write "needs update".
- Quote Justin's running-agenda items EXACTLY as written (they are his verbatim words) — do not paraphrase them.
- No exclamation points. Scannable Markdown, ~1 page.

FORMAT:
# ${cfg.label} Pre-Meeting Brief — ${dateStr}
## Justin's Running Agenda Items (verbatim)
## ${type === 'program' ? 'Scorecard & Compliance Watch' : 'Rocks, Finance & People'}
## ${type === 'program' ? 'Training & Coaching Takeaways' : 'Partnerships & Strategic Ventures'}
## Open Loops by Person
## Issues to IDS (Identify, Discuss, Solve)
## Suggested Headlines / To-Dos

RUNNING AGENDA NOTE ("${agendaNote?.title || 'none yet'}"):
${String(agendaNote?.content || '(empty)').slice(0, 12000)}

OPEN TASKS:
${JSON.stringify(openTasks)}

RECENT SLACK & HUDDLE HIGHLIGHTS (last 7 days):
${JSON.stringify(slackDigest)}

${type === 'program' ? `RECENT TRAINING / SUPERVISION HIGHLIGHTS:\n${JSON.stringify(trainingHighlights)}` : ''}
`;

    const response = await callGeminiWithRetry({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: { temperature: 0.25 },
    });
    let markdown = String(response.text || '').trim();
    const fence = markdown.match(/^```(?:markdown|md)?\s*([\s\S]*?)```$/i);
    if (fence) markdown = fence[1].trim();
    markdown = markdown.replace(/!+(?=\s|$)/g, '.');

    const note = await insertNote({
        title: `${cfg.label} Pre-Meeting Brief — ${dateStr}`,
        content: markdown,
        folder: L10_FOLDER,
        source: 'l10_brief',
    });

    return {
        output_markdown: markdown,
        output_payload: {
            l10Type: type,
            briefDate: dateStr,
            agendaNoteId: agendaNote?.id || null,
            noteId: note?.id || null,
            sourceCounts: {
                openTasks: openTasks.length,
                slackMessages: slackDigest.length,
                trainingHighlights: trainingHighlights.length,
            },
        },
    };
}

module.exports = { generateL10Brief, L10_SCOPES };
