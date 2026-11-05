const { callGeminiWithRetry } = require('./gemini-helper');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

function getTaggingRules() {
    try {
        const rulesPath = path.join(__dirname, 'tagging-rules.json');
        if (fs.existsSync(rulesPath)) {
            return JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
        }
    } catch (e) {
        console.error("Failed to read tagging-rules.json:", e.message);
    }
    return {
        defaultList: "General",
        spaces: [],
        people: [],
        projects: [],
        priorityRules: { high: [], low: [] }
    };
}

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

    const rules = getTaggingRules();
    
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

    CRITICAL DEDUPLICATION RULES (NEVER RE-ADD COMPLETED OR EXISTING TASKS):
    - Review "Existing Active Todos" AND "Recently Completed Todos".
    - If a task, reminder, or action item has ALREADY BEEN COMPLETED by Justin, DO NOT EXTRACT IT UNDER ANY CIRCUMSTANCES.
    - If a task or action item is ALREADY an active todo, DO NOT extract it.
    - If Justin already took care of an email or Slack request, or finished it previously, DO NOT create a task for it.

    CRITICAL UNIFIED "GENERAL" LIST ARCHITECTURE:
    - ALL tasks belong to listName: "${rules.defaultList || 'General'}".
    - DO NOT generate hashtags (#tag) in the title or anywhere else. Justin will add tags himself.
    - DO NOT generate time estimates or durations (e.g. [⏱ 15m] or estimatedMinutes). Justin will add times himself.
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
        "title": "Active imperative task title starting with action verb (NO hashtags, NO time estimates, NO exclamation marks)",
        "description": "Short 1-2 sentence context or quote from the source if helpful, NO checklist steps, subtasks, or exclamation marks",
        "source": "slack" | "email" | "letterly",
        "listName": "${rules.defaultList || 'General'}"
      }
    ]

    Recently Completed Todos (NEVER re-extract or duplicate any of these):
    ${JSON.stringify((completedTodos || []).slice(0, 100).map(t => ({ title: t.title || t.name, listName: t.listName })))}

    Existing Active Todos (NEVER duplicate any of these):
    ${JSON.stringify((existingTodos || []).map(t => ({ title: t.title || t.name, listName: t.listName })))}

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
                .replace(/\[⏱\s*\d+m\]/g, '')
                .split('\n')
                .filter(line => !line.trim().startsWith('- [ ]') && !line.trim().startsWith('- [x]'))
                .join('\n')
                .trim();
            return {
                title: cleanTitle,
                description: cleanDesc,
                listName: rules.defaultList || 'General',
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
        listName: t.listName,
        description: t.description,
        dueDate: t.dueDate
    }));
    
    const prompt = `
    You are an executive assistant for a user with ADHD. Pick the single most important task to attack right now—especially any task where stalling would be a failure of nerve.
    Prioritize:
    1. Past due or due today.
    2. Project priority: "Turn90" > "843FC" > "Book (Memoir) and Synapse" > "Personal" > "Nosa" > "General".
    
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
        listName: t.listName,
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

function fallbackFormatCalendarEvent(ev) {
    let summary = (ev.summary || '').trim();
    if (!summary) return null;

    let title = summary;
    title = title.replace(/^(hold\s*[-:]?\s*|meeting\s*[-:]?\s*)/i, '').trim();

    const low = title.toLowerCase();
    const actionVerbs = ['attend', 'join', 'lead', 'host', 'tour', 'call', 'review', 'prepare', 'conduct', 'drive', 'meet', 'visit', 'present', 'work on', 'process', 'organize'];
    const startsWithVerb = actionVerbs.some(v => low.startsWith(v + ' ') || low === v);

    if (!startsWithVerb) {
        if (low.includes('l10') || low.includes('meeting') || low.includes('huddle') || low.includes('sync')) {
            title = `Attend ${title} meeting`;
        } else if (low.includes('tour')) {
            title = `Host ${title}`;
        } else if (low.includes('training') || low.includes('workshop')) {
            title = `Attend ${title}`;
        } else if (low.includes('application') || low.includes('review') || low.includes('audit')) {
            title = `Process ${title}`;
        } else {
            title = `Attend ${title}`;
        }
    }

    title = title.replace(/!+/g, '').trim();
    title = title.charAt(0).toUpperCase() + title.slice(1);

    let notes = (ev.description || '').replace(/!+/g, '.').trim();
    if (notes.includes('Notice: This message may contain confidential')) {
        notes = notes.split('Notice: This message may contain confidential')[0].trim();
    }
    if (ev.location) {
        notes = notes ? `Location: ${ev.location}\n\n${notes}` : `Location: ${ev.location}`;
    }

    return {
        id: ev.id,
        title,
        notes,
        start: ev.start,
        priority: 'none'
    };
}

async function convertCalendarEventsToReminders(events = []) {
    if (!Array.isArray(events) || events.length === 0) return [];

    const validEvents = events.filter(e => e && e.summary && e.start);
    if (validEvents.length === 0) return [];

    if (!process.env.GEMINI_API_KEY) {
        return validEvents.map(fallbackFormatCalendarEvent).filter(Boolean);
    }

    const prompt = `
    You are Justin's executive assistant.
    Convert the following calendar events into scheduled reminder tasks for Justin's to-do list.

    CRITICAL ACTIVE SENTENCE RULE:
    - Every reminder title MUST be an active, imperative action sentence starting with a strong action verb (e.g. "Attend...", "Host...", "Lead...", "Conduct...", "Process...", "Meet with...", "Deliver...").
    - NEVER leave it as a passive topic or noun phrase.
      - "Charleston School of Law Tour" -> "Host Charleston School of Law tour"
      - "HOLD - SCThrive Applications" -> "Process SCThrive applications (SNAP, TANF, Medicaid)"
      - "Recruitment / Community Engagement L10" -> "Attend Recruitment / Community Engagement L10 meeting"
      - "Program Training" -> "Attend Program Training session"
      - "Tour Turn90" -> "Lead Turn90 tour" (or "Attend Turn90 tour")
    - Keep the title clean: NO hashtags, NO durations, NO bracketed times, NO exclamation points (!).
    - Keep notes clean: include relevant details (location, attendees, or agenda), but STRIP any boilerplate email confidentiality footers, legal notices, or exclamation points.

    Calendar Events:
    ${JSON.stringify(validEvents.map(e => ({ id: e.id, summary: e.summary, start: e.start, description: e.description, location: e.location })))}

    OUTPUT SCHEMA:
    Output MUST be a raw JSON array of objects (no markdown fences):
    [
      {
        "id": "event_id",
        "title": "Active imperative title starting with a verb (NO exclamation points)",
        "notes": "Clean description/location context, without disclaimer boilerplate or exclamation points",
        "start": "ISO start time"
      }
    ]
    `;

    try {
        const response = await callGeminiWithRetry({
            model: 'gemini-3.8-flash',
            contents: prompt,
            config: { temperature: 0.1 }
        });

        let text = response.text.trim();
        if (text.startsWith('```json')) {
            text = text.replace(/^```json\n?/, '').replace(/\n?```$/, '');
        } else if (text.startsWith('```')) {
            text = text.replace(/^```\n?/, '').replace(/\n?```$/, '');
        }

        const parsed = JSON.parse(text);
        if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed.map(item => ({
                id: item.id,
                title: (item.title || '').replace(/!+/g, '').replace(/#\w[\w-]*/g, '').replace(/\[⏱\s*\d+m\]/g, '').trim(),
                notes: (item.notes || '').replace(/!+/g, '.').trim(),
                start: item.start,
                priority: 'none'
            }));
        }
    } catch (err) {
        console.warn("[Calendar Sync] Gemini conversion warning, using fallback formatter:", err.message);
    }

    return validEvents.map(fallbackFormatCalendarEvent).filter(Boolean);
}

module.exports = {
    extractTodos,
    generateDailySummary,
    getMostImportantTask,
    getMeetingRelatedTasks,
    convertCalendarEventsToReminders
};
