const { callGeminiWithRetry } = require('./gemini-helper');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function extractTodos(slackMessages = [], emails = [], existingTodos = [], completedTodos = [], letterlyNotes = []) {
    // Handle both argument styles (if someone passes object or positional)
    let opts = {};
    if (!Array.isArray(slackMessages) && typeof slackMessages === 'object') {
        opts = slackMessages;
        slackMessages = opts.slackMessages || [];
        emails = opts.emails || [];
        existingTodos = opts.existingTodos || [];
        completedTodos = opts.completedTodos || [];
        letterlyNotes = opts.letterlyNotes || [];
    }

    if (!process.env.GEMINI_API_KEY) {
        console.error("No Gemini API key found for extraction.");
        return [];
    }

    const prompt = `
    You are an intelligent executive assistant for Justin Evans (with a sharp eye for detecting any "failure of nerve"—hesitation on high-leverage moves).
    Justin's Slack User ID is U02AGGN2E1Z (username: jevans).
    
    Review the following inputs:
    1. Slack messages, Huddle transcripts, and Slack Huddle summaries
    2. Unread Emails
    3. Letterly Voice Recordings (fetched via MCP)

    ABSOLUTE BAN ON CALENDAR EVENT DUPLICATION:
    - Do NOT extract calendar meetings, appointments, or scheduled calendar events as todos. Those belong on the calendar, not as todo reminders.
    - If a task title starts with "Meeting with" or refers to attending a scheduled calendar meeting, DO NOT EXTRACT IT.

    ABSOLUTE EMAIL EXCLUSION RULES (NEVER EXTRACT TODOS FROM THESE):
    - SCHOOL EMAILS FOR LONDON, REECE (OR REESE), AND JACKSON: Ignore all school, district (BCSD / Berkeley County / Hanahan Elementary, Middle, High / Lowcountry Virtual / LCV / GeniusSIS / ParentLink / PowerSchool / Blackboard), teacher, attendance, tardy, progress report, yearbook, or school newsletter emails regarding London, Reece, or Jackson. (Note: youth sports/futsal club emails like 843FC or Elite Futsal are NOT school emails and remain valid if actionable.)
    - APP STORE CONNECT & APPLE DEVELOPER: Ignore all App Store Connect, TestFlight, iTunes Connect, build processing, app review status, or developer certificate emails.
    - MARKETING, PROMOTIONAL & COLD SALES EMAILS: Ignore all marketing blasts, newsletters, discounts, credit card pre-approvals, free trials, AppSumo/SaaS review requests, routine shipping tracking notifications, and unsolicited cold B2B sales pitches. Only extract email tasks from real human colleagues/partners or actionable bills, invoices, waivers, and pickups.

    CRITICAL DEDUPLICATION RULES (NEVER RE-ADD COMPLETED OR EXISTING TASKS):
    - Review "Existing Active Todos" AND "Recently Completed Todos".
    - If a task, reminder, or action item has ALREADY BEEN COMPLETED by Justin, DO NOT EXTRACT IT UNDER ANY CIRCUMSTANCES.
    - If a task or action item is ALREADY an active todo, DO NOT extract it.
    - If Justin already took care of an email or Slack request, or finished it previously, DO NOT create a task for it.

    NO PROJECT OR TAG ASSIGNMENTS:
    - DO NOT assign projects, categories, channels, or hashtags (#tag) to any task. Justin will tag and assign tasks manually when he needs to.
    - DO NOT generate time estimates or durations (e.g. [⏱ 15m] or estimatedMinutes).
    - DO NOT generate microsteps, checklist items, or subtasks. Keep it to a single clean actionable task.

    CRITICAL ACTIVE SENTENCE RULE (IMPERATIVE ACTION VOICE):
    - Every task title MUST be written as an active, imperative action sentence starting with a strong action verb (e.g., "Review...", "Call...", "Draft...", "Send...", "Schedule...", "Decide on...", "Build...", "Enroll...").
    - NEVER output vague topics, noun phrases, or passive voice.
      - BAD: "Nigeria campaign simplification" -> GOOD: "Simplify the Nigeria campaign flyers and webpage"
      - BAD: "Marketing vault consideration" -> GOOD: "Decide on purchasing the Marketing Vault"
      - BAD: "Termite inspection" -> GOOD: "Schedule termite inspection"
      - BAD: "Donor tour" -> GOOD: "Prepare materials for upcoming donor tour"
      - BAD: "Participant enrollment" -> GOOD: "Enroll participant in SC Works"
    - Make every title a clear, unambiguous, direct instruction that tells Justin exactly what physical or cognitive step to take immediately.
    - NO exclamation points (!). Never use exclamation marks in reminder titles or notes.

    OUTPUT SCHEMA:
    Output MUST be a raw JSON array of objects (no markdown fences):
    [
      {
        "title": "Active imperative task title starting with action verb (NO hashtags, NO project names, NO time estimates, NO exclamation marks)",
        "description": "Short 1-2 sentence context or quote from the source if helpful, NO checklist steps, subtasks, or exclamation marks",
        "source": "slack" | "email" | "letterly"
      }
    ]

    Recently Completed Todos (NEVER re-extract or duplicate any of these):
    ${JSON.stringify((completedTodos || []).slice(0, 100).map(t => ({ title: t.title || t.name })))}

    Existing Active Todos (NEVER duplicate any of these):
    ${JSON.stringify((existingTodos || []).map(t => ({ title: t.title || t.name })))}

    Slack Messages & Huddle Summaries/Transcripts:
    ${JSON.stringify(slackMessages)}

    Unread Emails:
    ${JSON.stringify(emails)}

    Letterly Recordings (MCP):
    ${JSON.stringify(letterlyNotes)}
    `;

    try {
        const response = await callGeminiWithRetry({
            model: 'gemini-3.8-flash',
            contents: prompt,
            config: {
                temperature: 0.2
            }
        });

        let text = (response.text || '').trim();
        if (text.startsWith('```json')) {
            text = text.replace(/^```json\n?/, '').replace(/\n?```$/, '');
        } else if (text.startsWith('```')) {
            text = text.replace(/^```\n?/, '').replace(/\n?```$/, '');
        }

        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) return [];
        return parsed.map(item => {
            const cleanTitle = (item.title || '')
                .replace(/!+/g, '')
                .replace(/#\w[\w-]*/g, '')
                .replace(/\[⏱\s*\d+m\]/g, '')
                .trim();
            const cleanDesc = (item.description || '')
                .replace(/!+/g, '.')
                .replace(/#\w[\w-]*/g, '')
                .replace(/\[⏱\s*\d+m\]/g, '')
                .split('\n')
                .filter(line => !line.trim().startsWith('- [ ]') && !line.trim().startsWith('- [x]'))
                .join('\n')
                .trim();
            return {
                title: cleanTitle,
                description: cleanDesc,
                listName: 'General',
                projectId: null,
                tags: [],
                subtasks: [],
                estimatedMinutes: null,
                priority: 'none',
                source: item.source || 'other'
            };
        });
    } catch (error) {
        console.error("AI Extraction Error:", error);
        return [];
    }
}

async function generateDailySummary(events, todos) {
    if (!process.env.GEMINI_API_KEY) return null;
    
    const prompt = `
    You are Justin's direct, no-nonsense executive assistant.
    Review today's calendar events and pending todos.
    Call out the highest priority targets and warn against any "failure of nerve" (hesitating or avoiding the hardest high-leverage task).
    Keep it concise (3-5 sentences).
    
    Calendar Events Today:
    ${JSON.stringify(events, null, 2)}
    
    Current Pending Todos:
    ${JSON.stringify(todos.slice(0, 25), null, 2)}
    `;

    try {
        const response = await callGeminiWithRetry({
            model: 'gemini-3.8-flash',
            contents: prompt,
            config: { temperature: 0.4 }
        });
        return response.text.trim();
    } catch (error) {
        console.error("AI Daily Summary Error:", error);
        return null;
    }
}

async function getMostImportantTask(tasks) {
    if (!process.env.GEMINI_API_KEY || tasks.length === 0) return null;
    
    const numberedTasks = tasks.map((t, index) => ({
        index,
        title: t.title,
        description: t.description,
        dueDate: t.dueDate
    }));
    
    const prompt = `
    You are an executive assistant for a user with ADHD. Pick the single most important task to attack right now—especially any task where stalling would be a failure of nerve.
    Prioritize past due or due today tasks.
    
    Return ONLY raw JSON: { "index": number }
    
    Current Tasks:
    ${JSON.stringify(numberedTasks, null, 2)}
    `;

    try {
        const response = await callGeminiWithRetry({
            model: 'gemini-3.8-flash',
            contents: prompt,
            config: { temperature: 0.1 }
        });
        let text = response.text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
        const result = JSON.parse(text);
        if (result && typeof result.index === 'number' && tasks[result.index]) {
            return tasks[result.index];
        }
        return tasks[0];
    } catch (e) {
        return tasks[0];
    }
}

async function getMeetingRelatedTasks(event, tasks) {
    if (!process.env.GEMINI_API_KEY || tasks.length === 0) return [];
    
    const numberedTasks = tasks.map((t, index) => ({
        index,
        title: t.title,
        description: t.description
    }));
    
    const prompt = `
    Look at the upcoming meeting and open tasks. Return a raw JSON array of INDICES of tasks directly relevant to this meeting, or [] if none.
    Meeting: ${JSON.stringify(event)}
    Tasks: ${JSON.stringify(numberedTasks)}
    `;

    try {
        const response = await callGeminiWithRetry({
            model: 'gemini-3.8-flash',
            contents: prompt,
            config: { temperature: 0.1 }
        });
        let text = response.text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
        const indices = JSON.parse(text);
        if (Array.isArray(indices)) {
            return indices.map(i => tasks[i]).filter(Boolean);
        }
        return [];
    } catch (e) {
        return [];
    }
}

// ---------------------------------------------------------------------------
// Verbatim-first Letterly 5-lane triage
// ---------------------------------------------------------------------------

const CANONICAL_FOLDERS = [
    'Training (Turn90 & SYNAPSE)',
    'Turn90 Ops & Dual L10s',
    'SYNAPSE & Book',
    '843FC',
    'Liturgy & Quotes',
    'App Build Backlog',
    'Home & Budget'
];

const LANES = ['task', 'slack_message', 'delegate', 'vault_note', 'code_change'];
const DELEGATE_JOB_TYPES = ['email_outreach', 'rerun_coworker', 'task_assist'];
const CODE_REPOS = ['todo', 'turn90', 'synapse', 'liturgy', 'resource'];

/**
 * Fix ONLY obvious speech-to-text spellings. Never rewrites anything else.
 */
function applyVerbatimSpellingFixes(text) {
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

/** Strip conversational lead-ins from a task title, keeping Justin's own phrasing. */
function stripTaskLeadIns(title) {
    let t = String(title || '').trim();
    const leadIns = [
        /^(?:ok(?:ay)?|so|um+|uh+|alright|and)[,\s]+/i,
        /^(?:hey\s+)?(?:remind me to|reminder to|reminder:)\s+/i,
        /^(?:i\s+)?(?:need to|have to|gotta|got to|should|want to|must)\s+/i,
        /^(?:i'm going to|i am going to|i'm gonna|gonna)\s+/i,
        /^(?:don't forget to|make sure (?:i|to)|make sure that i)\s+/i,
        /^(?:to do:|todo:)\s*/i
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

function splitIntoSentences(text) {
    const cleaned = String(text || '').replace(/\r\n/g, '\n');
    const parts = cleaned
        .split(/(?<=[.?!])\s+|\n+/)
        .map(s => s.trim())
        .filter(Boolean);
    return parts.length ? parts : [cleaned.trim()].filter(Boolean);
}

function collapseWs(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function parseJsonLoose(text) {
    let cleaned = String(text || '').trim();
    const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) cleaned = fence[1].trim();
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        const a = cleaned.indexOf('[');
        const b = cleaned.lastIndexOf(']');
        if (a !== -1 && b > a) {
            try { return JSON.parse(cleaned.slice(a, b + 1)); } catch (e2) {}
        }
    }
    return null;
}

/**
 * Split a single Letterly note into atomic, routed items WITHOUT rewriting Justin's words.
 * Verbatim fields are rebuilt from the original (spelling-fixed) transcript sentences.
 */
async function triageLetterlyNote(note, { existingTodos = [], completedTodos = [] } = {}) {
    const rawContent = String(note?.content || '').trim();
    if (!rawContent) return [];
    const normalized = applyVerbatimSpellingFixes(rawContent);
    const sentences = splitIntoSentences(normalized);
    const fullVerbatim = normalized;

    const fallbackVault = [{
        lane: 'vault_note',
        folder: 'App Build Backlog',
        title: applyVerbatimSpellingFixes(note?.title || `Letterly #${note?.id}`),
        verbatimTranscript: fullVerbatim,
        l10Target: null,
        isTrainingCorpus: false
    }];

    if (!process.env.GEMINI_API_KEY) {
        console.error('[Letterly Triage] No Gemini API key; saving note verbatim to vault only.');
        return fallbackVault;
    }

    const numbered = sentences.map((s, i) => `[${i}] ${s}`).join('\n');

    const prompt = `
You are routing Justin Evans's raw Letterly voice recording into atomic items. Justin is the executive director of Turn90 (reentry nonprofit, 5 centers: Charleston, Columbia, Spartanburg, Reentry Navigation, Prison Program), author of SYNAPSE (training framework + book), and involved with 843FC (soccer club).

ABSOLUTE RULE — VERBATIM FIRST:
- NEVER rewrite, summarize, or paraphrase Justin's words. You only POINT to his sentences by index.
- Every item MUST include "sentenceStart" and "sentenceEnd" (inclusive indices into the numbered sentences below) identifying the exact span of Justin's words it came from.
- Short fields you write (title, messageText, subject, prompt) must reuse Justin's own phrasing as closely as possible.

LANES (pick exactly one per item):
1. "task": a personal to-do for Justin. Fields: title (Justin's own phrasing, drop lead-ins like "remind me to" / "I need to", no "!" no "#", start with the action verb he used).
2. "slack_message": Justin asks to Slack/message/tell/ping a staff member. Fields: recipients (array of first names, e.g. ["Matt"]), messageText (the message to send, in Justin's own words and direct supportive tone, first person, no greeting fluff).
3. "delegate": work for an AI agent. Fields: jobType ("email_outreach" when he wants an email sent to someone; "rerun_coworker" for handing a workflow to a Rerun coworker; "task_assist" for research/drafting), recipientName, subject, prompt.
4. "vault_note": ideas, reflections, training content, quotes, L10 agenda items, budget/home notes. Fields: folder (EXACTLY one of ${JSON.stringify(CANONICAL_FOLDERS)}), title (short, his words), l10Target ("leadership" for org rocks/finance/HR/Gusto/partners/donors/strategy/Amy/Katie/Sean/Daisy items he wants on the Leadership L10; "program" for center scorecards/Apricot/Briefcase/LS/CMI/training/SkillCat/Matt/Jenn/Diyoung/TB/LaShawn/Stacy/Casey items for the Program L10; otherwise null), isTrainingCorpus (true when it is classroom facilitation, case management, SYNAPSE, Pro-Social Modeling, CBT, communication or coaching teaching content).
5. "code_change": Justin describes a change to one of his apps. Fields: targetRepo (one of ${JSON.stringify(CODE_REPOS)}: todo = this ToDo/AI CEO app, turn90 = Turn90 apps/pipelines, synapse = SYNAPSE App, liturgy = Liturgy App, resource = Turn90 Resource App), executionMode ("antigravity_claude" for larger/architectural changes, "claude_direct" for small surgical changes), title.

DEDUPLICATION: Do NOT create "task" items that duplicate these active or completed todos:
Active: ${JSON.stringify((existingTodos || []).slice(0, 150).map(t => t.title || t.name))}
Completed: ${JSON.stringify((completedTodos || []).slice(0, 150).map(t => t.title || t.name))}

If the whole recording is one reflection, return a single vault_note spanning all sentences.

Return ONLY a raw JSON array (no prose), e.g.
[{"lane":"task","sentenceStart":0,"sentenceEnd":0,"title":"Call Goodwill about the SC Works referral"}]

Recording title: ${JSON.stringify(applyVerbatimSpellingFixes(note?.title || ''))}
Numbered sentences:
${numbered}
`;

    let parsed = null;
    try {
        const response = await callGeminiWithRetry({
            model: 'gemini-3.8-flash',
            contents: prompt,
            config: { temperature: 0.15 }
        });
        parsed = parseJsonLoose(response.text || '');
    } catch (error) {
        console.error('[Letterly Triage] Gemini error:', error.message || error);
    }

    if (!Array.isArray(parsed) || parsed.length === 0) return fallbackVault;

    const spanText = (item) => {
        const max = sentences.length - 1;
        let start = Number.isInteger(item.sentenceStart) ? item.sentenceStart : parseInt(item.sentenceStart, 10);
        let end = Number.isInteger(item.sentenceEnd) ? item.sentenceEnd : parseInt(item.sentenceEnd, 10);
        if (Number.isNaN(start) && Number.isNaN(end)) return null;
        if (Number.isNaN(start)) start = end;
        if (Number.isNaN(end)) end = start;
        start = Math.max(0, Math.min(max, start));
        end = Math.max(start, Math.min(max, end));
        return sentences.slice(start, end + 1).join(' ');
    };

    // If the model returned a legacy verbatim string instead of indices, only trust it if it is a true substring.
    const verifiedQuote = (item, legacyField) => {
        const fromSpan = spanText(item);
        if (fromSpan) return fromSpan;
        const legacy = applyVerbatimSpellingFixes(item[legacyField] || '');
        if (legacy && collapseWs(normalized).includes(collapseWs(legacy))) return legacy.trim();
        return fullVerbatim;
    };

    const routed = [];
    for (const item of parsed) {
        if (!item || !LANES.includes(item.lane)) continue;
        switch (item.lane) {
            case 'task': {
                const verbatimQuote = verifiedQuote(item, 'verbatimQuote');
                const title = stripTaskLeadIns(applyVerbatimSpellingFixes(item.title || verbatimQuote));
                if (!title) break;
                routed.push({ lane: 'task', title, verbatimQuote });
                break;
            }
            case 'slack_message': {
                const recipients = (Array.isArray(item.recipients) ? item.recipients : [item.recipients])
                    .map(r => String(r || '').replace(/^[@#]/, '').trim())
                    .filter(Boolean);
                if (recipients.length === 0) break;
                const verbatimQuote = verifiedQuote(item, 'verbatimQuote');
                routed.push({
                    lane: 'slack_message',
                    recipients,
                    messageText: applyVerbatimSpellingFixes(item.messageText || verbatimQuote).replace(/!+/g, '.').trim(),
                    verbatimQuote
                });
                break;
            }
            case 'delegate': {
                const verbatimQuote = verifiedQuote(item, 'verbatimQuote');
                routed.push({
                    lane: 'delegate',
                    jobType: DELEGATE_JOB_TYPES.includes(item.jobType) ? item.jobType : 'task_assist',
                    recipientName: String(item.recipientName || '').trim(),
                    subject: applyVerbatimSpellingFixes(item.subject || '').trim(),
                    prompt: applyVerbatimSpellingFixes(item.prompt || verbatimQuote).trim(),
                    verbatimQuote
                });
                break;
            }
            case 'vault_note': {
                const verbatimTranscript = verifiedQuote(item, 'verbatimTranscript');
                const folder = CANONICAL_FOLDERS.includes(item.folder) ? item.folder : 'App Build Backlog';
                const l10Target = item.l10Target === 'leadership' || item.l10Target === 'program' ? item.l10Target : null;
                routed.push({
                    lane: 'vault_note',
                    folder: l10Target ? 'Turn90 Ops & Dual L10s' : folder,
                    title: applyVerbatimSpellingFixes(item.title || note?.title || 'Letterly Note').trim(),
                    verbatimTranscript,
                    l10Target,
                    isTrainingCorpus: Boolean(item.isTrainingCorpus) || folder === 'Training (Turn90 & SYNAPSE)'
                });
                break;
            }
            case 'code_change': {
                const verbatimSpec = verifiedQuote(item, 'verbatimSpec');
                routed.push({
                    lane: 'code_change',
                    targetRepo: CODE_REPOS.includes(item.targetRepo) ? item.targetRepo : 'todo',
                    executionMode: item.executionMode === 'claude_direct' ? 'claude_direct' : 'antigravity_claude',
                    title: applyVerbatimSpellingFixes(item.title || 'Code change from Letterly').replace(/!+/g, '').trim(),
                    verbatimSpec
                });
                break;
            }
            default:
                break;
        }
    }

    return routed.length ? routed : fallbackVault;
}

module.exports = {
    extractTodos,
    generateDailySummary,
    getMostImportantTask,
    getMeetingRelatedTasks,
    triageLetterlyNote,
    applyVerbatimSpellingFixes,
    stripTaskLeadIns,
    CANONICAL_FOLDERS
};
