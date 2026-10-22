require('dotenv').config();
const { getTodaysCalendarEvents } = require('./google');
const { generateDailySummary } = require('./ai');
const { getAllPendingTodos, addDailySummaryToSheet } = require('./sheets');

async function forceMorningRun() {
    console.log("Generating Daily Summary...");
    const events = await getTodaysCalendarEvents();
    const pendingTodos = await getAllPendingTodos();
    const dailySummary = await generateDailySummary(events, pendingTodos);
    if (dailySummary) {
        console.log("Pushing Daily Summary to Google Sheets...");
        await addDailySummaryToSheet(dailySummary);
        console.log("Done!");
    } else {
        console.log("Failed to generate summary");
    }
}
forceMorningRun();
