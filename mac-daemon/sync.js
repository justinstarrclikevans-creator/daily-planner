const cron = require('node-cron');
const { getIncompleteReminders, completeReminder } = require('./reminders');
const { getRecentLetterlyNotes, summarizeNotes } = require('./letterly');
const { addTodosToSheet, addLetterlySummariesToSheet } = require('./sheets');
const { getRecentSlackMessages } = require('./slack');
const { getRecentEmails, getTodaysCalendarEvents } = require('./google');
const { extractTodos } = require('./ai');

// Simple cache to avoid duplicating Letterly notes. 
let lastSyncedLetterlyTime = Date.now() - (24 * 60 * 60 * 1000); 

async function syncCycle() {
    console.log(`[${new Date().toLocaleString()}] Starting sync cycle...`);
    
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
        } else {
            console.log("No new reminders to sync.");
        }

        // 2. Process Letterly Notes
        console.log("Fetching recent Letterly notes...");
        const allRecentNotes = await getRecentLetterlyNotes();
        const newNotes = allRecentNotes.filter(n => n.timestamp > lastSyncedLetterlyTime);
        
        if (newNotes.length > 0) {
            console.log(`Found ${newNotes.length} new Letterly notes. Summarizing with Gemini...`);
            const summarizedNotes = await summarizeNotes(newNotes);
            
            console.log("Pushing Letterly summaries to Google Sheets...");
            await addLetterlySummariesToSheet(summarizedNotes);
            
            lastSyncedLetterlyTime = Math.max(...newNotes.map(n => n.timestamp));
        } else {
            console.log("No new Letterly notes to sync.");
        }

        // 3. Process Communications (Slack, Gmail, Calendar) for Action Items
        console.log("Fetching Slack, Gmail, and Calendar...");
        const [slack, emails, events] = await Promise.all([
            getRecentSlackMessages(),
            getRecentEmails(),
            getTodaysCalendarEvents()
        ]);

        if (slack.length > 0 || emails.length > 0 || events.length > 0) {
            console.log("Extracting action items via Gemini...");
            const aiTodos = await extractTodos(slack, emails, events);
            
            if (aiTodos.length > 0) {
                console.log(`Extracted ${aiTodos.length} new action items. Pushing to Google Sheets...`);
                // Format them to match the Reminders sheet format
                const formattedTodos = aiTodos.map(todo => ({
                    id: 'ai_' + Date.now() + Math.floor(Math.random()*1000),
                    name: `[${todo.source.toUpperCase()}] ${todo.title}`,
                    body: todo.description,
                    dueDate: ''
                }));
                await addTodosToSheet(formattedTodos);
            }
        } else {
            console.log("No recent communications found.");
        }

        console.log(`[${new Date().toLocaleString()}] Sync cycle completed successfully.`);
    } catch (err) {
        console.error("Error during sync cycle:", err);
    }
}

// Run immediately on start, then once an hour
syncCycle();
cron.schedule('0 * * * *', () => {
    syncCycle();
});

console.log("Sync daemon started. Running every hour.");
