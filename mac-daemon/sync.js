const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { getIncompleteReminders, addReminder, updateReminderNotes } = require('./reminders');
const { getRecentSlackMessages, sendSlackDM } = require('./slack');
const { getRecentEmails, getTodaysCalendarEvents } = require('./google');
const { getRecentMessages, sendIMessage } = require('./imessage');
const { extractTodos, generateDailySummary, generateADHDProcess } = require('./ai');
const { processIncomingSMS, checkUpcomingMeetings, triggerStalePurgeOffer } = require('./sms-handler');
const { syncTaskToSupabase } = require('./supabase');

const STATE_FILE = path.join(__dirname, 'state.json');

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

async function expandTaskNotesForADHD() {
    console.log(`[${new Date().toLocaleString()}] Checking for tasks that need ADHD process expansion...`);
    try {
        const reminders = await getIncompleteReminders();
        
        // Find reminders that don't have the new First 5 Minutes momentum signature
        let toExpand = reminders.filter(r => !r.description || !r.description.includes('⚡ First 5 Minutes:'));
        
        // Sort by User's List Priority: First shift > Personal > Football
        const priorityScore = (listName) => {
            const name = (listName || "").toLowerCase();
            if (name.includes("first shift")) return 1;
            if (name.includes("personal")) return 2;
            if (name.includes("football") || name.includes("843")) return 3;
            return 4; // Everything else
        };
        
        toExpand.sort((a, b) => priorityScore(a.listName) - priorityScore(b.listName));
        
        // Limit to 30 at a time
        toExpand = toExpand.slice(0, 30);
        
        if (toExpand.length > 0) {
            console.log(`Found ${toExpand.length} tasks needing process expansion...`);
            for (const task of toExpand) {
                console.log(`Expanding notes for task: ${task.title}`);
                const expandedProcess = await generateADHDProcess(task.title, task.description);
                if (expandedProcess && expandedProcess.includes('⚡ First 5 Minutes:')) {
                    await updateReminderNotes(task.id, expandedProcess);
                    console.log(`Successfully updated notes for: ${task.title}`);
                }
            }
        }
    } catch (e) {
        console.error("expandTaskNotesForADHD Error:", e);
    }
}

async function runFullSync() {
    console.log(`[${new Date().toLocaleString()}] Starting Full sync cycle...`);
    const state = loadState();
    
    try {
        console.log("Fetching Slack, Gmail, iMessages, and Calendar Events...");
        const [slack, emails, imessages, events] = await Promise.all([
            getRecentSlackMessages(state.lastSlackSync),
            getRecentEmails(state.lastEmailSync),
            getRecentMessages(state.lastIMessageSync || 0),
            getTodaysCalendarEvents()
        ]);

        if (slack.length > 0 || emails.length > 0 || imessages.length > 0 || events.length > 0) {
            console.log("Fetching existing Apple Reminders to prevent duplicates...");
            const existingTodos = await getIncompleteReminders();
            
            console.log("Extracting action items via Gemini...");
            const aiExtractedTodos = await extractTodos(slack, emails, events, existingTodos, imessages, []);
            
            if (aiExtractedTodos.length > 0) {
                console.log(`Extracted ${aiExtractedTodos.length} new action items. Pushing to Apple Reminders...`);
                for (const todo of aiExtractedTodos) {
                    const targetList = todo.listName || 'Personal';
                    const ok = await addReminder(targetList, todo.title, todo.description);
                    if (!ok) console.error(`Failed to push reminder to list (${targetList}):`, todo.title);
                    await syncTaskToSupabase(todo);
                }
            }
            
            if (slack.length > 0) state.lastSlackSync = Math.max(...slack.map(s => s.timestamp));
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
            if (imessages.length > 0) state.lastIMessageSync = Math.max(...imessages.map(i => i.timestamp));
            saveState(state);
        }

        console.log(`[${new Date().toLocaleString()}] Full Sync cycle completed successfully.`);
    } catch (e) {
        console.error("Full Sync Error:", e);
    }
}

async function runAfternoonSync() {
    console.log(`[${new Date().toLocaleString()}] Starting Afternoon sync cycle...`);
    const state = loadState();
    
    try {
        const [slack, emails, imessages, events] = await Promise.all([
            getRecentSlackMessages(state.lastSlackSync),
            getRecentEmails(state.lastEmailSync),
            getRecentMessages(state.lastIMessageSync || 0),
            getTodaysCalendarEvents()
        ]);
        
        if (slack.length > 0 || emails.length > 0 || imessages.length > 0 || events.length > 0) {
            console.log("Fetching existing Apple Reminders to prevent duplicates...");
            const existingTodos = await getIncompleteReminders();
            
            console.log("Extracting action items via Gemini...");
            const aiExtractedTodos = await extractTodos(slack, emails, events, existingTodos, imessages, []);
            
            if (aiExtractedTodos.length > 0) {
                console.log(`Extracted ${aiExtractedTodos.length} new action items. Pushing to Apple Reminders...`);
                for (const todo of aiExtractedTodos) {
                    const targetList = todo.listName || 'Personal';
                    const ok = await addReminder(targetList, todo.title, todo.description);
                    if (!ok) console.error(`Failed to push reminder to list (${targetList}):`, todo.title);
                    await syncTaskToSupabase(todo);
                }
            }
            
            if (slack.length > 0) state.lastSlackSync = Math.max(...slack.map(s => s.timestamp));
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
            if (imessages.length > 0) state.lastIMessageSync = Math.max(...imessages.map(i => i.timestamp));
            saveState(state);
        }
        
        console.log(`[${new Date().toLocaleString()}] Afternoon Sync completed.`);
    } catch (e) {
        console.error("Afternoon Sync Error:", e);
    }
}

// 6:00 AM Morning Plan
cron.schedule('0 6 * * *', () => runFullSync());

// 12:00 PM Midday Catch-up
cron.schedule('0 12 * * *', () => runFullSync());

// 3:00 PM Afternoon Catch-up
cron.schedule('0 15 * * *', runAfternoonSync);

// Process incoming SMS (for "DONE" and "PURGE" replies) every minute
cron.schedule('* * * * *', processIncomingSMS);

// Check for upcoming meetings (Just-In-Time Context) every 5 minutes
cron.schedule('*/5 * * * *', checkUpcomingMeetings);

// The "Stale Task" Purge: Every Friday at 4:00 PM
cron.schedule('0 16 * * 5', triggerStalePurgeOffer);

console.log("Sync daemon started.");
console.log("- Full Sync at 6:00 AM and 12:00 PM");
console.log("- Afternoon Sync (Slack, Gmail, iMessage) at 3:00 PM");
console.log("- Active ADHD Workflows: One Thing SMS (1m), Meeting Prompts (5m), Friday Purge (4pm Fri)");

// On start, run a full sync immediately just to catch up
runFullSync();

module.exports = {
    runFullSync,
    runAfternoonSync,
    expandTaskNotesForADHD
};
