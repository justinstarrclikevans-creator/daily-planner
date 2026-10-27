const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { getIncompleteReminders, getRecentCompletedReminders, addReminder } = require('./reminders');
const { getRecentSlackMessages } = require('./slack');
const { getRecentEmails, getTodaysCalendarEvents } = require('./google');
const { getRecentLetterlyNotes } = require('./letterly');
const { extractTodos } = require('./ai');
const { checkUpcomingMeetings, triggerStalePurgeOffer, checkAggressiveMotivationNudges } = require('./sms-handler');
const { syncTaskToSupabase } = require('./supabase');

const STATE_FILE = path.join(__dirname, 'state.json');

const VALID_LISTS = [
    'General',
    'Turn90',
    '843FC',
    'Personal',
    'Nosa',
    'Book (Memoir) and Synapse'
];

function normalizeListName(rawName, source) {
    // All Slack & Huddle todos strictly go to Turn90 (T90)
    if (source === 'slack') return 'Turn90';

    const lower = (rawName || '').trim().toLowerCase();
    if (!lower) return 'General';
    if (lower.includes('turn90') || lower.includes('turn 90') || lower === 't90' || lower.includes('first shift') || lower.includes('reentry')) {
        return 'Turn90';
    }
    if (lower.includes('843') || lower.includes('football')) {
        return '843FC';
    }
    if (lower.includes('nosa') || lower.includes('royvi')) {
        return 'Nosa';
    }
    if (lower.includes('book') || lower.includes('memoir') || lower.includes('synapse')) {
        return 'Book (Memoir) and Synapse';
    }
    if (lower.includes('personal')) {
        return 'Personal';
    }
    if (lower.includes('general')) {
        return 'General';
    }
    // Default to General if not sure what project
    return 'General';
}

function normalizeTitle(str) {
    return (str || '')
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            data.completedTaskTitles = data.completedTaskTitles || [];
            return data;
        }
    } catch (e) {}
    return { completedTaskTitles: [] };
}

function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function runHourlySync() {
    console.log(`[${new Date().toLocaleString()}] Starting Hourly Sync (Emails, Slack/Huddles, Calendar, Letterly MCP)...`);
    const state = loadState();
    state.completedTaskTitles = state.completedTaskTitles || [];
    
    try {
        const [slack, emails, events, letterlyNotes, incompleteTodos, completedTodos] = await Promise.all([
            getRecentSlackMessages(state.lastSlackSync),
            getRecentEmails(state.lastEmailSync),
            getTodaysCalendarEvents(),
            getRecentLetterlyNotes(state.lastLetterlySync),
            getIncompleteReminders(),
            getRecentCompletedReminders()
        ]);

        // Permanently record all completed reminder titles into persistent state
        for (const comp of completedTodos) {
            const norm = normalizeTitle(comp.title);
            if (norm && !state.completedTaskTitles.includes(norm)) {
                state.completedTaskTitles.push(norm);
            }
        }
        if (state.completedTaskTitles.length > 500) {
            state.completedTaskTitles = state.completedTaskTitles.slice(-500);
        }
        saveState(state);

        if (slack.length > 0 || emails.length > 0 || letterlyNotes.length > 0) {
            console.log(`New inputs found (Slack: ${slack.length}, Emails: ${emails.length}, Letterly: ${letterlyNotes.length}). Active Apple Reminders: ${incompleteTodos.length}, Completed: ${completedTodos.length}.`);
            
            console.log("Extracting todos, ideas & brainstorming via Gemini (with strict completed deduplication)...");
            const combinedCompleted = [
                ...completedTodos,
                ...state.completedTaskTitles.map(t => ({ title: t, listName: '' }))
            ];

            const aiExtractedItems = await extractTodos({
                slackMessages: slack,
                emails: emails,
                existingTodos: incompleteTodos,
                completedTodos: combinedCompleted,
                letterlyNotes: letterlyNotes
            });
            
            if (aiExtractedItems.length > 0) {
                console.log(`AI extracted ${aiExtractedItems.length} candidate items. Validating deduplication before adding...`);

                // Sets for O(1) deduplication matching
                const activeTitlesSet = new Set(incompleteTodos.map(t => normalizeTitle(t.title)));
                const completedTitlesSet = new Set([
                    ...completedTodos.map(t => normalizeTitle(t.title)),
                    ...state.completedTaskTitles
                ]);
                const calendarEventSummaries = new Set(events.map(ev => normalizeTitle(ev.summary)));

                for (const item of aiExtractedItems) {
                    const normTitle = normalizeTitle(item.title);
                    if (!normTitle) continue;

                    // 1. Skip if already completed
                    if (completedTitlesSet.has(normTitle)) {
                        console.log(`[Deduplication] Task "${item.title}" was already completed previously. Skipping.`);
                        continue;
                    }

                    // 2. Skip if already an active reminder
                    if (activeTitlesSet.has(normTitle)) {
                        console.log(`[Deduplication] Task "${item.title}" is already an active reminder. Skipping.`);
                        continue;
                    }

                    // 3. Skip if this is a calendar meeting/appointment
                    const lowerTitle = (item.title || '').toLowerCase();
                    if (lowerTitle.startsWith('meeting with') ||
                        lowerTitle.startsWith('meeting:') ||
                        calendarEventSummaries.has(normTitle) ||
                        events.some(ev => normalizeTitle(ev.summary).includes(normTitle) || normTitle.includes(normalizeTitle(ev.summary)))) {
                        console.log(`[Deduplication] Item "${item.title}" is a calendar meeting/event. Skipping.`);
                        continue;
                    }

                    const targetList = normalizeListName(item.listName, item.source);
                    const mins = item.estimatedMinutes || 5;
                    const noteLines = [`[⏱ ${mins}m]`];

                    if (Array.isArray(item.subtasks) && item.subtasks.length > 0) {
                        for (const sub of item.subtasks) {
                            const cleanedSub = String(sub).trim();
                            if (cleanedSub) {
                                noteLines.push(`- [ ] ${cleanedSub}`);
                            }
                        }
                    } else if (item.description && item.description.trim()) {
                        noteLines.push(item.description.trim());
                    }

                    const finalNotes = noteLines.join('\n');
                    const ok = await addReminder(targetList, item.title, finalNotes);
                    if (!ok) {
                        console.error(`Failed to push reminder to list (${targetList}):`, item.title);
                    } else {
                        console.log(`Added to [${targetList}]: ${item.title} (${(item.subtasks || []).length} subtasks)`);
                        activeTitlesSet.add(normTitle);
                    }

                    item.listName = targetList;
                    item.description = finalNotes;
                    item.estimatedMinutes = mins;
                    await syncTaskToSupabase(item);
                }
            }
            
            if (slack.length > 0) {
                state.lastSlackSync = Math.max(...slack.map(s => s.timestamp));
            }
            if (emails.length > 0) {
                if (typeof state.lastEmailSync !== 'object' || state.lastEmailSync === null) {
                    state.lastEmailSync = {};
                }
                for (const e of emails) {
                    if (e.account) {
                        state.lastEmailSync[e.account] = Math.max(state.lastEmailSync[e.account] || 0, e.timestamp);
                    }
                }
            }
            if (letterlyNotes.length > 0) {
                state.lastLetterlySync = Math.max(...letterlyNotes.map(n => n.timestamp));
            }
            saveState(state);
        } else {
            console.log("No new Slack messages, emails, or Letterly recordings since last hourly check.");
        }

        // Sync open Apple Reminders to cloud if configured
        await syncAllRemindersToCloud();

        // Check meeting context & motivation criteria
        await checkUpcomingMeetings();
        await checkAggressiveMotivationNudges();

        console.log(`[${new Date().toLocaleString()}] Hourly Sync cycle completed.`);
    } catch (e) {
        console.error("Hourly Sync Error:", e);
    }
}

async function syncAllRemindersToCloud() {
    try {
        const reminders = await getIncompleteReminders();
        for (const r of reminders) {
            await syncTaskToSupabase(r, r.id);
        }
    } catch (e) {
        console.error("Error syncing reminders to cloud:", e.message);
    }
}

// Check everything once an hour at the top of every hour
cron.schedule('0 * * * *', () => runHourlySync());

// Also check motivation criteria (1-hour app unopened / no tasks completed) every 15 minutes
cron.schedule('*/15 * * * *', () => checkAggressiveMotivationNudges());

// Friday 4:00 PM Stale Task notification
cron.schedule('0 16 * * 5', triggerStalePurgeOffer);

console.log("Sync daemon started (v2 Hourly Architecture).");
console.log("- Checking Emails (fallback: General), Slack & Huddle Summaries (target: Turn90), and Letterly MCP once an hour");
console.log("- Inbound iMessage checking disabled; outbound angry motivation messages enabled (1h unopened / no completions)");

module.exports = {
    runHourlySync
};
