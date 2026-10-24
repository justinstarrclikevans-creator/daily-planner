const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { getIncompleteReminders, addReminder } = require('./reminders');
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

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        }
    } catch (e) {}
    return {};
}

function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function runHourlySync() {
    console.log(`[${new Date().toLocaleString()}] Starting Hourly Sync (Emails, Slack/Huddles, Calendar, Letterly MCP)...`);
    const state = loadState();
    
    try {
        const [slack, emails, events, letterlyNotes] = await Promise.all([
            getRecentSlackMessages(state.lastSlackSync),
            getRecentEmails(state.lastEmailSync),
            getTodaysCalendarEvents(),
            getRecentLetterlyNotes(state.lastLetterlySync)
        ]);

        if (slack.length > 0 || emails.length > 0 || letterlyNotes.length > 0) {
            console.log(`New inputs found (Slack: ${slack.length}, Emails: ${emails.length}, Letterly: ${letterlyNotes.length}). Checking existing Apple Reminders...`);
            const existingTodos = await getIncompleteReminders();
            
            console.log("Extracting todos, ideas & brainstorming via Gemini...");
            const aiExtractedItems = await extractTodos(slack, emails, events, existingTodos, letterlyNotes);
            
            if (aiExtractedItems.length > 0) {
                console.log(`Extracted ${aiExtractedItems.length} new items. Pushing to Apple Reminders...`);
                for (const item of aiExtractedItems) {
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
