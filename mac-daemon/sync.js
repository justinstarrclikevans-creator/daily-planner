const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { getIncompleteReminders, getRecentCompletedReminders, addReminder } = require('./reminders');
const { exec } = require('child_process');
const { getRecentSlackMessages } = require('./slack');
const { getRecentEmails, getTodaysCalendarEvents } = require('./google');
const { getRecentLetterlyNotes } = require('./letterly');
const { extractTodos } = require('./ai');
const { syncTaskToSupabase } = require('./supabase');

const STATE_FILE = path.join(__dirname, 'state.json');

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
    console.log(`[${new Date().toLocaleString()}] Starting Hourly Sync (Emails, Slack/Huddles, Letterly MCP)...`);
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
            
            console.log("Extracting todos via Gemini (no project assignments, no calendar todos)...");
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

                    const targetList = 'General';
                    const priority = 'none';

                    // Clean title without hashtags, project names, time brackets, or exclamation points
                    const cleanTitle = (item.title || '')
                        .replace(/!+/g, '')
                        .replace(/#\w[\w-]*/g, '')
                        .replace(/\[⏱\s*\d+m\]/g, '')
                        .trim();

                    // Clean notes: brief context only, NO hashtags, NO time estimates, NO subtasks, NO exclamation points
                    let cleanNotes = (item.description || '')
                        .replace(/!+/g, '.')
                        .replace(/#\w[\w-]*/g, '')
                        .replace(/\[⏱\s*\d+m\]/g, '')
                        .trim();
                    cleanNotes = cleanNotes
                        .split('\n')
                        .filter(line => !line.trim().startsWith('- [ ]') && !line.trim().startsWith('- [x]'))
                        .join('\n')
                        .trim();

                    const ok = await addReminder(targetList, cleanTitle, cleanNotes, priority);
                    if (!ok) {
                        console.error(`Failed to push reminder to list (${targetList}):`, cleanTitle);
                    } else {
                        console.log(`Added to [${targetList}]: ${cleanTitle}`);
                        activeTitlesSet.add(normTitle);
                    }

                    item.title = cleanTitle;
                    item.listName = targetList;
                    item.projectId = null;
                    item.tags = [];
                    item.description = cleanNotes;
                    item.estimatedMinutes = null;
                    item.subtasks = [];
                    item.priority = priority;
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

        // Sync open Apple Reminders + Calendar timeline feed to Render webapp & cloud
        await syncAllRemindersToCloud(events);

        console.log(`[${new Date().toLocaleString()}] Hourly Sync cycle completed.`);
    } catch (e) {
        console.error("Hourly Sync Error:", e);
    }
}

async function syncAllRemindersToCloud(events = []) {
    try {
        const reminders = await getIncompleteReminders();

        try {
            const fallbackPath = path.join(__dirname, '../render-webapp/src/lib/fallback-todos.json');
            const calendarFallbackPath = path.join(__dirname, '../render-webapp/src/lib/fallback-calendar.json');

            const fallbackPayload = reminders
                .filter(r => !(r.description || '').includes('[Calendar Event]'))
                .map(r => ({
                    title: r.title,
                    notes: r.description || '',
                    listName: 'General',
                    priority: r.priority || 'medium',
                    dueDate: r.dueDate || null,
                    appleReminderId: r.id
                }));

            const calendarPayload = (events || [])
                .filter(ev => ev && ev.summary && ev.start && !ev.isAllDay)
                .map(ev => ({
                    id: ev.id,
                    title: ev.summary,
                    start: ev.start,
                    end: ev.end,
                    durationMinutes: ev.durationMinutes || 30,
                    location: ev.location || '',
                    calendarName: ev.calendarName || 'Calendar'
                }));

            const nextTodosJson = JSON.stringify(fallbackPayload, null, 2);
            const prevTodosJson = fs.existsSync(fallbackPath) ? fs.readFileSync(fallbackPath, 'utf8') : '';

            const nextCalJson = JSON.stringify(calendarPayload, null, 2);
            const prevCalJson = fs.existsSync(calendarFallbackPath) ? fs.readFileSync(calendarFallbackPath, 'utf8') : '';

            if (nextTodosJson !== prevTodosJson || nextCalJson !== prevCalJson) {
                fs.writeFileSync(fallbackPath, nextTodosJson);
                fs.writeFileSync(calendarFallbackPath, nextCalJson);
                const repoRoot = path.join(__dirname, '..');
                exec(
                    'git add render-webapp/src/lib/fallback-todos.json render-webapp/src/lib/fallback-calendar.json && git commit -m "chore(sync): auto-sync reminders and calendar timeline feed" && git push origin HEAD:main && git push origin feat/ios-companion-app',
                    { cwd: repoRoot },
                    (err) => {
                        if (!err) {
                            console.log("[Git Sync] Pushed updated reminders & calendar feed to Render (origin/main).");
                        }
                    }
                );
            }
        } catch (e) {
            // non-fatal
        }

        for (const r of reminders) {
            await syncTaskToSupabase(r, r.id);
        }
    } catch (e) {
        console.error("Error syncing reminders to cloud:", e.message);
    }
}

// Check everything once an hour at the top of every hour
cron.schedule('0 * * * *', () => runHourlySync());

console.log("Sync daemon started (v2 Hourly Architecture).");
console.log("- Checking Emails, Slack & Huddle Summaries, and Letterly MCP once an hour (no AI project assignments; no calendar todos)");
console.log("- Inbound and outbound iMessage texts paused per user request");

module.exports = {
    runHourlySync
};
