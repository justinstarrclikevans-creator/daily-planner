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

    PRIORITY RULES:
    - "high": matches urgent deadlines, client/exec blockers, payroll, high-leverage moves where hesitating is a failure of nerve.
    - "low": casual ideas, someday exploration.
    - "medium": all standard operational tasks.

    OUTPUT SCHEMA:
    Output MUST be a raw JSON array of objects (no markdown fences):
    [
      {
        "title": "Clean, punchy task title (NO hashtags, NO time estimates)",
        "description": "Short 1-2 sentence context or quote from the source if helpful, NO checklist steps or subtasks",
        "source": "slack" | "email" | "letterly",
        "listName": "${rules.defaultList || 'General'}",
        "priority": "high" | "medium" | "low"
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
            const prio = (item.priority && ['high', 'medium', 'low'].includes(String(item.priority).toLowerCase()))
                ? String(item.priority).toLowerCase()
                : 'medium';
            const cleanTitle = (item.title || '')
                .replace(/#\w[\w-]*/g, '')
                .replace(/\[⏱\s*\d+m\]/g, '')
                .trim();
            const cleanDesc = (item.description || '')
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
                priority: prio,
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

module.exports = {
    extractTodos,
    generateDailySummary,
    getMostImportantTask,
    getMeetingRelatedTasks
};
