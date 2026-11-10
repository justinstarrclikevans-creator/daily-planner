const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { getIncompleteReminders, getRecentCompletedReminders, addReminder, updateReminderNotes } = require('./reminders');
const { exec } = require('child_process');
const { getRecentSlackMessages } = require('./slack');
const { getRecentEmails, getTodaysCalendarEvents } = require('./google');
const { getRecentLetterlyNotes } = require('./letterly');
const { extractTodos, convertCalendarEventsToReminders } = require('./ai');
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

function matchProjectForTask(title, description, rawListName, source, customProjects = []) {
    if (source === 'slack') return 'Turn90';

    const direct = normalizeListName(rawListName, source);
    if (direct !== 'General') return direct;

    const combined = `${title || ''} ${description || ''}`.toLowerCase();

    if (Array.isArray(customProjects)) {
        for (const proj of customProjects) {
            if (Array.isArray(proj.keywords)) {
                for (const kw of proj.keywords) {
                    if (kw && combined.includes(kw.toLowerCase())) {
                        return proj.name;
                    }
                }
            }
        }
    }

    if (/turn90|turn 90|\bt90\b|first shift|reentry|apricot|skillcat/i.test(combined)) return 'Turn90';
    if (/843|843fc|football|soccer|fourth wall|crowded/i.test(combined)) return '843FC';
    if (/nosa|royvi|claire/i.test(combined)) return 'Nosa';
    if (/book|memoir|synapse|draft|chapter/i.test(combined)) return 'Book (Memoir) and Synapse';
    if (/groceries|vet|apartment|family|bills|health/i.test(combined)) return 'Personal';

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
            data.syncedCalendarEventIds = data.syncedCalendarEventIds || [];
            return data;
        }
    } catch (e) {}
    return { completedTaskTitles: [], syncedCalendarEventIds: [] };
}

function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function isSameLocalCalendarDay(aIso, bIso) {
    if (!aIso || !bIso) return false;
    const a = new Date(aIso);
    const b = new Date(bIso);
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return false;
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}

async function syncCalendarEventsAsReminders(events, incompleteTodos, completedTodos, state) {
    if (!Array.isArray(events) || events.length === 0) return;

    state.syncedCalendarEventIds = state.syncedCalendarEventIds || [];
    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // Filter events: timed events from today onward
    const candidateEvents = events.filter(ev => {
        if (!ev.summary || !ev.start) return false;
        if (ev.isAllDay) return false;
        const startMs = new Date(ev.start).getTime();
        if (isNaN(startMs)) return false;
        if (startMs < startOfToday.getTime()) return false;
        return true;
    });

    if (candidateEvents.length === 0) {
        return;
    }

    const reminderItems = await convertCalendarEventsToReminders(candidateEvents);

    let targetList = 'General';
    try {
        const rulesPath = path.join(__dirname, 'tagging-rules.json');
        if (fs.existsSync(rulesPath)) {
            const r = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
            targetList = r.defaultList || 'General';
        }
    } catch (e) {}

    let addedCount = 0;
    for (const item of reminderItems) {
        const normTitle = normalizeTitle(item.title);
        const normRaw = normalizeTitle(item.rawSummary || '');
        if (!normTitle) continue;

        // Check if already an active reminder on the SAME calendar day
        const existingSameDay = incompleteTodos.find(t => {
            if (!isSameLocalCalendarDay(t.dueDate, item.start)) return false;
            const nt = normalizeTitle(t.title);
            return nt === normTitle || (normRaw && nt === normRaw) || nt.includes(normTitle) || normTitle.includes(nt);
        });

        if (existingSameDay) {
            // Upgrade notes with [⏱ durationm] [Calendar Event] if missing
            if (existingSameDay.id && item.notes && !(existingSameDay.description || '').includes('[Calendar Event]')) {
                await updateReminderNotes(existingSameDay.id, item.notes);
                existingSameDay.description = item.notes;
                console.log(`[Calendar] Upgraded metadata for "${existingSameDay.title}" -> ${item.notes.split('\n')[0]}`);
            }
            if (item.id && !state.syncedCalendarEventIds.includes(item.id)) {
                state.syncedCalendarEventIds.push(item.id);
            }
            continue;
        }

        // Skip if this specific event ID was already synced and completed
        if (item.id && state.syncedCalendarEventIds.includes(item.id)) {
            continue;
        }

        const cleanItemTitle = (item.title || '').replace(/!+/g, '').trim();
        const ok = await addReminder(targetList, cleanItemTitle, item.notes || '', 'none', item.start);
        if (ok) {
            console.log(`[Calendar Scheduled] Added to [${targetList}]: "${cleanItemTitle}" scheduled for ${new Date(item.start).toLocaleString()} (${item.durationMinutes || 30}m)`);
            incompleteTodos.push({
                title: cleanItemTitle,
                description: item.notes || '',
                listName: targetList,
                dueDate: item.start
            });
            if (item.id) state.syncedCalendarEventIds.push(item.id);
            addedCount++;

            await syncTaskToSupabase({
                title: cleanItemTitle,
                listName: targetList,
                description: item.notes || '',
                dueDate: item.start,
                estimatedMinutes: item.durationMinutes || 30,
                priority: 'none'
            });
        }
    }

    if (state.syncedCalendarEventIds.length > 500) {
        state.syncedCalendarEventIds = state.syncedCalendarEventIds.slice(-500);
    }
    saveState(state);
    if (addedCount > 0) {
        console.log(`[Calendar] Successfully synced ${addedCount} scheduled reminders to Apple Reminders.`);
    }
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

        // 1. Sync Calendar Events to Apple Reminders as Scheduled Reminders
        await syncCalendarEventsAsReminders(events, incompleteTodos, completedTodos, state);

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

                    let targetList = 'General';
                    try {
                        const rulesPath = path.join(__dirname, 'tagging-rules.json');
                        if (fs.existsSync(rulesPath)) {
                            const r = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
                            targetList = r.defaultList || 'General';
                        }
                    } catch (e) {}

                    const priority = 'none';

                    // Clean title without hashtags, time brackets, or exclamation points
                    const cleanTitle = (item.title || '')
                        .replace(/!+/g, '')
                        .replace(/#\w[\w-]*/g, '')
                        .replace(/\[⏱\s*\d+m\]/g, '')
                        .trim();

                    // Clean notes: brief context only, NO time estimates, NO subtasks / microsteps, NO exclamation points
                    let cleanNotes = (item.description || '')
                        .replace(/!+/g, '.')
                        .replace(/\[⏱\s*\d+m\]/g, '')
                        .trim();
                    // Remove any microstep checklist lines if present
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

        // Sync open Apple Reminders to cloud if configured
        await syncAllRemindersToCloud();

        // Check meeting context & motivation criteria (paused per user request)
        // await checkUpcomingMeetings();
        // await checkAggressiveMotivationNudges();

        console.log(`[${new Date().toLocaleString()}] Hourly Sync cycle completed.`);
    } catch (e) {
        console.error("Hourly Sync Error:", e);
    }
}

async function syncAllRemindersToCloud() {
    try {
        const reminders = await getIncompleteReminders();

        // Keep webapp fallback dataset fresh with current active incomplete reminders (including newly synced Calendar Events)
        try {
            const fallbackPath = path.join(__dirname, '../render-webapp/src/lib/fallback-todos.json');
            const fallbackPayload = reminders.map(r => ({
                title: r.title,
                notes: r.description || '',
                listName: r.listName || 'General',
                priority: r.priority || 'medium',
                dueDate: r.dueDate || null,
                appleReminderId: r.id
            }));
            const nextJson = JSON.stringify(fallbackPayload, null, 2);
            const prevJson = fs.existsSync(fallbackPath) ? fs.readFileSync(fallbackPath, 'utf8') : '';
            if (nextJson !== prevJson) {
                fs.writeFileSync(fallbackPath, nextJson);
                const repoRoot = path.join(__dirname, '..');
                exec(
                    'git add render-webapp/src/lib/fallback-todos.json && git commit -m "chore(sync): auto-sync live calendar appointments & reminders" && git push origin HEAD:main && git push origin feat/ios-companion-app',
                    { cwd: repoRoot },
                    (err) => {
                        if (!err) {
                            console.log("[Git Sync] Pushed updated fallback-todos.json to Render (origin/main).");
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

// Nudges and stale purge offer paused per user request
// cron.schedule('*/15 * * * *', () => checkAggressiveMotivationNudges());
// cron.schedule('0 16 * * 5', triggerStalePurgeOffer);

console.log("Sync daemon started (v2 Hourly Architecture).");
console.log("- Checking Emails (fallback: General), Slack & Huddle Summaries (target: Turn90), and Letterly MCP once an hour");
console.log("- Inbound and outbound iMessage texts paused per user request");

module.exports = {
    runHourlySync
};
