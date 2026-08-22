const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { getIncompleteReminders, completeReminder } = require('./reminders');
const { getRecentLetterlyNotes, summarizeNotes } = require('./letterly');
const { addTodosToSheet, addLetterlySummariesToSheet, addDailySummaryToSheet, getAllPendingTodos } = require('./sheets');
const { getRecentSlackMessages } = require('./slack');
const { getRecentEmails, getTodaysCalendarEvents } = require('./google');
const { extractTodos, generateDailySummary } = require('./ai');

const STATE_FILE = path.join(__dirname, 'state.json');

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        }
    } catch (e) {
        console.error("Error reading state.json:", e);
    }
    return {};
}

function saveState(state) {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (e) {
        console.error("Error saving state.json:", e);
    }
}

async function runSlackSync() {
    console.log(`[${new Date().toLocaleString()}] Starting Slack-only sync...`);
    const state = loadState();
    
    // Pass the last slack sync timestamp (if null, slack.js defaults to 7 days ago)
    const slack = await getRecentSlackMessages(state.lastSlackSync);
    
    if (slack.length > 0) {
        console.log("Extracting action items via Gemini...");
        // Pass empty arrays for emails and events
        const aiTodos = await extractTodos(slack, [], []);
        
        if (aiTodos.length > 0) {
            console.log(`Extracted ${aiTodos.length} new Slack action items. Pushing to Google Sheets...`);
            const formattedTodos = aiTodos.map(todo => ({
                id: 'ai_' + Date.now() + Math.floor(Math.random()*1000),
                name: `[${todo.source.toUpperCase()}] ${todo.title}`,
                body: todo.description,
                dueDate: ''
            }));
            await addTodosToSheet(formattedTodos);
        }
        
        // Update state with the highest timestamp we found
        const maxTs = Math.max(...slack.map(s => s.timestamp));
        state.lastSlackSync = maxTs;
        saveState(state);
    } else {
        console.log("No new Slack communications found.");
    }
}

async function runFullSync(isMorningRun = false) {
    console.log(`[${new Date().toLocaleString()}] Starting Full sync cycle...`);
    const state = loadState();
    
    try {
        // 1. Process Apple Reminders
        console.log("Fetching Apple Reminders...");
        const reminders = await getIncompleteReminders();
        if (reminders.length > 0) {
            console.log(`Found ${reminders.length} incomplete reminders. Pushing to Google Sheets...`);
            await addTodosToSheet(reminders);
            
            console.log("Marking reminders as complete in Apple Reminders...");
            for (const r of reminders) {
                await completeReminder(r.id);
            }
        }

        // 2. Process Letterly Notes
        console.log("Fetching recent Letterly notes...");
        const allRecentNotes = await getRecentLetterlyNotes();
        const lastSyncedLetterly = state.lastLetterlySync || (Date.now() - (24 * 60 * 60 * 1000));
        const newNotes = allRecentNotes.filter(n => n.timestamp > lastSyncedLetterly);
        
        if (newNotes.length > 0) {
            console.log(`Found ${newNotes.length} new Letterly notes. Summarizing with Gemini...`);
            const summarizedNotes = await summarizeNotes(newNotes);
            
            console.log("Pushing Letterly summaries to Google Sheets...");
            await addLetterlySummariesToSheet(summarizedNotes);
            
            state.lastLetterlySync = Math.max(...newNotes.map(n => n.timestamp));
            saveState(state);
        }

        // 3. Process Communications (Slack, Gmail, Calendar) for Action Items
        console.log("Fetching Slack, Gmail, and Calendar...");
        const [slack, emails, events] = await Promise.all([
            getRecentSlackMessages(state.lastSlackSync),
            getRecentEmails(),
            getTodaysCalendarEvents()
        ]);

        if (slack.length > 0 || emails.length > 0 || events.length > 0) {
            console.log("Extracting action items via Gemini...");
            const aiTodos = await extractTodos(slack, emails, events);
            
            if (aiTodos.length > 0) {
                console.log(`Extracted ${aiTodos.length} new action items. Pushing to Google Sheets...`);
                const formattedTodos = aiTodos.map(todo => ({
                    id: 'ai_' + Date.now() + Math.floor(Math.random()*1000),
                    name: `[${todo.source.toUpperCase()}] ${todo.title}`,
                    body: todo.description,
                    dueDate: ''
                }));
                await addTodosToSheet(formattedTodos);
            }
            
            if (slack.length > 0) {
                const maxTs = Math.max(...slack.map(s => s.timestamp));
                state.lastSlackSync = maxTs;
                saveState(state);
            }
        }
        
        // 4. Generate Daily Summary if this is the 6 AM run
        if (isMorningRun) {
            console.log("Morning run detected. Generating Daily Summary...");
            // events was fetched above
            const pendingTodos = await getAllPendingTodos();
            const dailySummary = await generateDailySummary(events, pendingTodos);
            if (dailySummary) {
                console.log("Pushing Daily Summary to Google Sheets...");
                await addDailySummaryToSheet(dailySummary);
            }
        }

        console.log(`[${new Date().toLocaleString()}] Full Sync cycle completed successfully.`);
    } catch (err) {
        console.error("Error during sync cycle:", err);
    }
}

// 6 AM: Full Sync + Daily Summary
cron.schedule('0 6 * * *', () => {
    runFullSync(true);
});

// 12 PM (Noon): Full Sync
cron.schedule('0 12 * * *', () => {
    runFullSync(false);
});

// 3 PM: Slack Only Sync
cron.schedule('0 15 * * *', () => {
    runSlackSync();
});

console.log("Sync daemon started.");
console.log("- Full Sync at 6:00 AM and 12:00 PM");
console.log("- Slack-only Sync at 3:00 PM");

// On start, run a full sync immediately just to catch up
runFullSync(false);
