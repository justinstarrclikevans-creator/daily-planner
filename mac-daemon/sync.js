const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { getIncompleteReminders, getRecentCompletedReminders, addReminder, completeReminder } = require('./reminders');
const { exec } = require('child_process');
const { getRecentSlackMessages } = require('./slack');
const { getRecentEmails, getTodaysCalendarEvents, upsertTaskCalendarEvent, deleteTaskCalendarEvent } = require('./google');
const { extractTodos } = require('./ai');
const { supabase, syncTaskToSupabase, getCompletedTasksFromSupabase } = require('./supabase');
const crypto = require('crypto');
const { getRecentLetterlyNotes } = require('./letterly');
const { processLetterlyNotes, getProcessedIds } = require('./letterly-router');
const { todayEastern } = require('./vault-notes');

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
    // letterly-router.js persists processedLetterlyNoteIds / lastLetterlySync directly to disk.
    // Merge the on-disk values so a stale in-memory state object never clobbers them.
    try {
        if (fs.existsSync(STATE_FILE)) {
            const onDisk = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            const ids = new Set([
                ...((onDisk.processedLetterlyNoteIds || []).map(String)),
                ...((state.processedLetterlyNoteIds || []).map(String))
            ]);
            if (ids.size > 0) state.processedLetterlyNoteIds = Array.from(ids).slice(-2000);
            if ((onDisk.lastLetterlySync || 0) > (state.lastLetterlySync || 0)) {
                state.lastLetterlySync = onDisk.lastLetterlySync;
            }
        }
    } catch (e) {}
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------------------
// Letterly verbatim 5-lane router (every 15 minutes + hourly)
// ---------------------------------------------------------------------------
let letterlySyncRunning = false;

async function runLetterlySync() {
    if (letterlySyncRunning) return;
    letterlySyncRunning = true;
    try {
        const state = loadState();
        const overlapMs = 60 * 60 * 1000;
        const floor = Date.now() - 48 * 60 * 60 * 1000;
        const since = Math.max(floor, (state.lastLetterlySync || 0) - overlapMs);
        const notes = await getRecentLetterlyNotes(since, { excludeIds: getProcessedIds() });
        if (notes.length === 0) return;
        console.log(`[Letterly Sync] Routing ${notes.length} new Letterly note(s) through verbatim 5-lane router...`);
        const summary = await processLetterlyNotes(notes);
        for (const s of summary) {
            const lanes = s.routed.map(r => r.lane).join(', ') || 'none';
            console.log(`[Letterly Sync] #${s.noteId} "${s.title}" -> ${lanes}`);
        }
    } catch (e) {
        console.error('[Letterly Sync] Error:', e.message);
    } finally {
        letterlySyncRunning = false;
    }
}

// ---------------------------------------------------------------------------
// Scheduled agent jobs (Daily Training Brief + Dual L10 briefs). These only
// generate drafts in "Needs You"; nothing outbound is ever sent automatically.
// ---------------------------------------------------------------------------
async function hasJobToday(jobType, matchPayload = null) {
    if (!supabase) return true;
    const since = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
        .from('agent_jobs')
        .select('id, created_at, output_payload')
        .eq('job_type', jobType)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(20);
    if (error) {
        console.error(`[Scheduler] Could not check existing ${jobType} jobs:`, error.message);
        return true; // fail closed: don't spam duplicate jobs
    }
    const today = todayEastern();
    return (data || []).some(row => {
        if (todayEastern(new Date(row.created_at)) !== today) return false;
        if (!matchPayload) return true;
        return Object.entries(matchPayload).every(([k, v]) => (row.output_payload || {})[k] === v);
    });
}

async function queueScheduledJob({ jobType, title, prompt, outputPayload = {}, dedupeKey = null }) {
    if (!supabase) return null;
    try {
        if (await hasJobToday(jobType, dedupeKey)) {
            console.log(`[Scheduler] ${jobType} already created today; skipping.`);
            return null;
        }
        const nowIso = new Date().toISOString();
        const row = {
            id: crypto.randomUUID(),
            agent_role: 'ceo',
            job_type: jobType,
            title,
            prompt,
            status: 'queued',
            output_markdown: '',
            output_payload: outputPayload,
            revision_feedback: '',
            execution_result: {},
            execution_error: '',
            created_at: nowIso,
            updated_at: nowIso
        };
        const { error } = await supabase.from('agent_jobs').insert([row]);
        if (error) {
            console.error(`[Scheduler] Failed queueing ${jobType}:`, error.message);
            return null;
        }
        console.log(`[Scheduler] Queued ${jobType}: "${title}"`);
        return row;
    } catch (e) {
        console.error(`[Scheduler] Error queueing ${jobType}:`, e.message);
        return null;
    }
}

function queueDailyTrainingBrief() {
    return queueScheduledJob({
        jobType: 'training_brief',
        title: `Daily Classroom & CM Training Brief — ${todayEastern()}`,
        prompt: 'Generate the Daily Classroom & Case Management Training Brief from local Turn90 feedback sources.',
        outputPayload: { days: 7 }
    });
}

function queueL10Brief(l10Type) {
    const label = l10Type === 'leadership' ? 'Leadership L10' : 'Program L10';
    return queueScheduledJob({
        jobType: 'l10_brief',
        title: `${label} Pre-Meeting Brief — ${todayEastern()}`,
        prompt: `Prepare the ${label} pre-meeting brief.`,
        outputPayload: { l10Type },
        dedupeKey: { l10Type }
    });
}

async function syncWebCompletionsToAppleReminders() {
    try {
        const [supaCompleted, openReminders] = await Promise.all([
            getCompletedTasksFromSupabase(),
            getIncompleteReminders()
        ]);

        const webCompleted = [...supaCompleted];
        if (webCompleted.length === 0 || openReminders.length === 0) {
            return 0;
        }

        const state = loadState();
        state.completedTaskTitles = state.completedTaskTitles || [];
        let completedCount = 0;

        for (const webItem of webCompleted) {
            const targetId = webItem.appleReminderId || webItem.id;
            const normTargetTitle = normalizeTitle(webItem.title);

            if (normTargetTitle && !state.completedTaskTitles.includes(normTargetTitle)) {
                state.completedTaskTitles.push(normTargetTitle);
            }

            const matchingReminders = openReminders.filter(r =>
                (targetId && r.id === targetId) ||
                (normTargetTitle && normalizeTitle(r.title) === normTargetTitle)
            );

            for (const rem of matchingReminders) {
                const res = await completeReminder(rem.id);
                if (res && res.success) {
                    console.log(`[Two-Way Sync] Completed in Apple Reminders: "${rem.title}" (${rem.id})`);
                    completedCount++;
                }
            }
        }

        if (state.completedTaskTitles.length > 500) {
            state.completedTaskTitles = state.completedTaskTitles.slice(-500);
        }
        saveState(state);

        if (completedCount > 0) {
            const events = await getTodaysCalendarEvents().catch(() => []);
            await syncAllRemindersToCloud(events);
        }

        return completedCount;
    } catch (e) {
        console.error("[Two-Way Sync] Error syncing web completions to Apple Reminders:", e.message);
        return 0;
    }
}

async function runHourlySync() {
    console.log(`[${new Date().toLocaleString()}] Starting Hourly Sync (Emails, Slack/Huddles)...`);
    await syncWebCompletionsToAppleReminders();
    const state = loadState();
    state.completedTaskTitles = state.completedTaskTitles || [];
    
    try {
        const [slack, emails, events, incompleteTodos, completedTodos] = await Promise.all([
            getRecentSlackMessages(state.lastSlackSync),
            getRecentEmails(state.lastEmailSync),
            getTodaysCalendarEvents(),
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

        if (slack.length > 0 || emails.length > 0) {
            console.log(`New inputs found (Slack: ${slack.length}, Emails: ${emails.length}). Active Apple Reminders: ${incompleteTodos.length}, Completed: ${completedTodos.length}.`);
            
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
                letterlyNotes: []
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
            saveState(state);
        } else {
            console.log("No new Slack messages or emails since last hourly check.");
        }

        // Route any new Letterly voice notes (verbatim 5-lane router)
        await runLetterlySync();

        // Sync open Apple Reminders + Calendar timeline feed to Render webapp & cloud
        await syncTwoWayCalendarWithSupabase(events);
        await syncAllRemindersToCloud(events);

        console.log(`[${new Date().toLocaleString()}] Hourly Sync cycle completed.`);
    } catch (e) {
        console.error("Hourly Sync Error:", e);
    }
}

async function syncTwoWayCalendarWithSupabase(events = []) {
    if (!supabase) return;
    try {
        const state = loadState();
        state.calendarTaskMap = state.calendarTaskMap || {};
        let stateChanged = false;

        const { data: allTasks, error } = await supabase
            .from('tasks')
            .select('id, title, description, status, due_date, estimated_minutes');
        if (error || !Array.isArray(allTasks)) return;

        const taskById = new Map(allTasks.map(t => [String(t.id), t]));

        // 1. Google Calendar -> App: if a linked event was moved/resized in Google Calendar, update Supabase
        for (const ev of (events || [])) {
            if (!ev.plannerTaskId || !ev.start) continue;
            const taskId = String(ev.plannerTaskId);
            const task = taskById.get(taskId);
            const entry = state.calendarTaskMap[taskId];
            if (!task || task.status === 'completed' || !entry) continue;

            const calStartMs = new Date(ev.start).getTime();
            const entryStartMs = entry.dueDate ? new Date(entry.dueDate).getTime() : 0;
            const calDuration = ev.durationMinutes || 15;

            if (Math.abs(calStartMs - entryStartMs) >= 60000 || calDuration !== (entry.estimatedMinutes || 15)) {
                const nextDueIso = new Date(ev.start).toISOString();
                const { error: upErr } = await supabase
                    .from('tasks')
                    .update({
                        due_date: nextDueIso,
                        estimated_minutes: calDuration,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', task.id);

                if (!upErr) {
                    task.due_date = nextDueIso;
                    task.estimated_minutes = calDuration;
                    state.calendarTaskMap[taskId] = {
                        ...entry,
                        dueDate: nextDueIso,
                        estimatedMinutes: calDuration
                    };
                    stateChanged = true;
                    console.log(`[Calendar -> App] Updated "${task.title}" to ${nextDueIso} (${calDuration}m)`);
                }
            }
        }

        // 2. App -> Google Calendar (justin@turnninety.com): create/update events for scheduled pending tasks
        for (const task of allTasks) {
            if (task.status !== 'pending' || !task.due_date) continue;
            const taskId = String(task.id);
            const entry = state.calendarTaskMap[taskId];
            const estMins = Math.max(5, Number(task.estimated_minutes) || 15);
            const taskDueMs = new Date(task.due_date).getTime();
            const entryDueMs = entry?.dueDate ? new Date(entry.dueDate).getTime() : 0;

            const needsSync =
                !entry ||
                !entry.eventId ||
                Math.abs(taskDueMs - entryDueMs) >= 60000 ||
                estMins !== (entry.estimatedMinutes || 15) ||
                task.title !== entry.title;

            if (needsSync) {
                const res = await upsertTaskCalendarEvent(task, entry?.eventId || null);
                if (res.ok && res.eventId) {
                    state.calendarTaskMap[taskId] = {
                        eventId: res.eventId,
                        dueDate: new Date(task.due_date).toISOString(),
                        estimatedMinutes: estMins,
                        title: task.title
                    };
                    stateChanged = true;
                    console.log(`[App -> Calendar] Synced "${task.title}" to justin@turnninety.com`);
                } else if (res.needsReauth) {
                    if (!state.calendarReauthWarned) {
                        console.log('[Calendar Sync] justin@turnninety.com needs calendar.events write scope. Run auth-calendar-write.js.');
                        state.calendarReauthWarned = true;
                        stateChanged = true;
                    }
                    break;
                }
            }
        }

        // 3. Delete calendar events for tasks that were unscheduled, completed, or deleted
        for (const [taskId, entry] of Object.entries(state.calendarTaskMap)) {
            const task = taskById.get(taskId);
            if (!task || task.status === 'completed' || !task.due_date) {
                if (entry?.eventId) {
                    const delRes = await deleteTaskCalendarEvent(entry.eventId);
                    if (delRes.ok) {
                        console.log(`[App -> Calendar] Removed event for "${entry.title || taskId}"`);
                    }
                }
                delete state.calendarTaskMap[taskId];
                stateChanged = true;
            }
        }

        if (stateChanged) {
            saveState(state);
        }
    } catch (e) {
        console.error("[Two-Way Calendar Sync] Error:", e.message);
    }
}

async function runFastReminderSync() {
    try {
        await syncWebCompletionsToAppleReminders();
        const reminders = await getIncompleteReminders();
        const events = await getTodaysCalendarEvents().catch(() => []);
        await syncTwoWayCalendarWithSupabase(events);
        await syncAllRemindersToCloud(events, reminders);
    } catch (e) {
        console.error("[Fast Sync] Error:", e.message);
    }
}

async function syncAllRemindersToCloud(events = [], incomingReminders = null) {
    try {
        const reminders = incomingReminders || await getIncompleteReminders();

        // 0. Sync any new incomplete Apple Reminders to Supabase (without overwriting existing tasks)
        if (supabase && reminders.length > 0) {
            try {
                const { data: existingRows, error: fetchErr } = await supabase
                    .from('tasks')
                    .select('apple_reminder_id, title');
                if (!fetchErr && Array.isArray(existingRows)) {
                    const existingIds = new Set(existingRows.map(r => r.apple_reminder_id).filter(Boolean));
                    const existingTitles = new Set(existingRows.map(r => normalizeTitle(r.title)).filter(Boolean));
                    let insertedCount = 0;

                    for (const r of reminders) {
                        if ((r.description || '').includes('[Calendar Event]')) continue;
                        const cleanTitle = (r.title || '')
                            .replace(/!+/g, '')
                            .replace(/#\w[\w-]*/g, '')
                            .replace(/\[⏱\s*\d+m\]/g, '')
                            .trim() || r.title;
                        const norm = normalizeTitle(cleanTitle);
                        if (existingIds.has(r.id) || (norm && existingTitles.has(norm))) continue;

                        const saved = await syncTaskToSupabase({
                            id: r.id,
                            title: cleanTitle,
                            description: r.description || '',
                            listName: 'General',
                            status: 'pending',
                            dueDate: r.dueDate || null,
                            source: 'apple-reminders',
                            projectId: null
                        }, r.id);

                        if (saved && saved.id) {
                            insertedCount++;
                            existingIds.add(r.id);
                            if (norm) existingTitles.add(norm);
                        }
                    }
                    if (insertedCount > 0) {
                        console.log(`[Supabase Sync] Synced ${insertedCount} new Apple Reminder(s) to Supabase.`);
                    }
                }
            } catch (supaErr) {
                console.error("[Supabase Sync] Error syncing Apple Reminders:", supaErr.message);
            }
        }

        // 1. Direct push to local webapp if running
        try {
            fetch('http://localhost:3000/api/sync/reminders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reminders, events })
            }).catch(() => null);
        } catch (e) {}

        // 3. Fallback files + debounced git commit
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
                .filter(ev => ev && ev.summary && ev.start && !ev.isAllDay && !ev.plannerTaskId)
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
    } catch (e) {
        console.error("Error syncing reminders to cloud:", e.message);
    }
}

// Run fast sync every 1 minute so new reminders and web completions sync immediately
cron.schedule('* * * * *', () => runFastReminderSync());

// Check everything once an hour at the top of every hour
cron.schedule('0 * * * *', () => runHourlySync());

// Letterly verbatim router every 15 minutes (skips :00, which runHourlySync already covers)
cron.schedule('15,30,45 * * * *', () => runLetterlySync());

// Daily Classroom & CM Training Brief — weekdays 7:30 AM Eastern
cron.schedule('30 7 * * 1-5', () => queueDailyTrainingBrief(), { timezone: 'America/New_York' });

// Program L10 Brief — Tuesdays 12:15 PM Eastern
cron.schedule('15 12 * * 2', () => queueL10Brief('program'), { timezone: 'America/New_York' });

// Leadership L10 Brief — Wednesdays 11:00 AM Eastern (1 hr before 12:00–13:30 Leadership L10)
cron.schedule('0 11 * * 3', () => queueL10Brief('leadership'), { timezone: 'America/New_York' });

console.log("Sync daemon started (v2 1-Minute Live Reminder Sync + Hourly Slack/Email AI Extraction).");
console.log("- Syncing active Apple Reminders and web completions every 1 minute");
console.log("- Checking Emails and Slack & Huddle Summaries once an hour");
console.log("- Routing Letterly voice notes (verbatim 5-lane router) every 15 minutes");
console.log("- Training Brief weekdays 7:30 ET · Program L10 brief Tue 12:15 ET · Leadership L10 brief Wed 11:00 ET");

try {
    const { startAgentWorker } = require('./agent-worker');
    startAgentWorker();
} catch (err) {
    console.error("[Agent Worker] Non-fatal startup error:", err.message || err);
}

module.exports = {
    runHourlySync,
    runLetterlySync,
    queueDailyTrainingBrief,
    queueL10Brief,
    runFastReminderSync,
    syncWebCompletionsToAppleReminders
};
