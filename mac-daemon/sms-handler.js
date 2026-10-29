const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { sendIMessage } = require('./imessage');
const { getIncompleteReminders, getActivityStatus } = require('./reminders');
const { getMeetingRelatedTasks } = require('./ai');
const { getUpcomingCalendarEvents } = require('./google');

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

// Inbound message checking is disabled per user instructions ("Do not check messages anymore")
async function processIncomingSMS() {
    return;
}

function isWithinAllowedTextWindow() {
    const hour = new Date().getHours();
    // Only send text messages between 8:00 AM and 9:00 PM every day
    return hour >= 8 && hour < 21;
}

// Outbound text messages paused per user request ("I also need the text messages and push notifications to stop for now at least.")
const SMS_NOTIFICATIONS_ENABLED = process.env.ENABLE_SMS_NOTIFICATIONS === 'true';

async function checkUpcomingMeetings() {
    if (!SMS_NOTIFICATIONS_ENABLED) return;
    if (!isWithinAllowedTextWindow()) return;
    const state = loadState();
    state.alertedMeetings = state.alertedMeetings || [];
    
    try {
        const upcomingEvents = await getUpcomingCalendarEvents(60);
        if (upcomingEvents.length === 0) return;
        
        const openTasks = await getIncompleteReminders();
        if (openTasks.length === 0) return;
        
        for (const event of upcomingEvents) {
            if (state.alertedMeetings.includes(event.id)) continue;
            
            const relatedTasks = await getMeetingRelatedTasks(event, openTasks);
            if (relatedTasks && relatedTasks.length > 0) {
                const taskBullets = relatedTasks.map(t => `- ${t.title}`).join('\n');
                const smsText = `Reminder: '${event.summary}' is starting soon. You have related tasks:\n\n${taskBullets}`;
                
                const myPhone = process.env.MY_PHONE_NUMBER;
                if (myPhone) {
                    await sendIMessage(myPhone, smsText);
                }
            }
            
            state.alertedMeetings.push(event.id);
        }
        
        if (state.alertedMeetings.length > 50) {
            state.alertedMeetings = state.alertedMeetings.slice(-50);
        }
        
        saveState(state);
    } catch (e) {
        console.error("Error checking upcoming meetings:", e);
    }
}

async function triggerStalePurgeOffer() {
    if (!SMS_NOTIFICATIONS_ENABLED) return;
    if (!isWithinAllowedTextWindow()) return;
    console.log("[Stale Purge] Evaluating tasks for stale purge...");
    try {
        const openTasks = await getIncompleteReminders();
        const now = Date.now();
        const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
        
        const staleTasks = openTasks.filter(task => {
            return (now - new Date(task.updated).getTime()) > fourteenDaysMs;
        });
        
        if (staleTasks.length > 0) {
            const myPhone = process.env.MY_PHONE_NUMBER;
            if (myPhone) {
                const smsText = `End of week cleanup: You have ${staleTasks.length} tasks untouched for 2+ weeks. Clear or execute them inside the app.`;
                await sendIMessage(myPhone, smsText);
            }
        }
    } catch (e) {
        console.error("Error triggering stale purge offer:", e);
    }
}

const ANGRY_APP_UNOPENED_QUOTES = [
    "Don't fuck it up. You haven't opened the app in over an hour. Stop hiding, open the board, and attack.",
    "One hour without opening the app. That's a failure of nerve. Stop avoiding the work and execute right now.",
    "Clock is bleeding. You haven't touched the app in an hour. Get off your ass, open your tasks, and knock one out.",
    "Quit bullshitting. Ignoring the board for an hour won't make the work disappear. Open the app and move.",
    "Nobody is coming to save you. An hour gone without opening the app. Kill the hesitation and get after it."
];

const ANGRY_NO_COMPLETION_QUOTES = [
    "Zero tasks completed in the last hour. Don't fuck it up—stop stalling, pick a task, and finish it right now.",
    "You're bleeding time and completing nothing. This isn't a time problem, it's a failure of nerve. Finish a task now.",
    "An hour has passed and not a single task is checked off. Cut the bullshit, lock in, and close out your next todo.",
    "Comfort is a trap. You haven't finished a task in over an hour. Put your head down and execute.",
    "Discipline is finishing what's in front of you. Zero completions this hour—open the app and clear a task now."
];

async function checkAggressiveMotivationNudges() {
    if (!SMS_NOTIFICATIONS_ENABLED) return;
    const state = loadState();
    const myPhone = process.env.MY_PHONE_NUMBER;
    if (!myPhone) return;

    // Only send text messages between 8:00 AM and 9:00 PM every day
    if (!isWithinAllowedTextWindow()) return;

    try {
        const status = await getActivityStatus();
        if (status.openCount <= 0) return;

        const now = Date.now();
        const oneHourMs = 60 * 60 * 1000;

        const lastOpened = Math.max(status.lastAppOpened || 0, state.lastAppOpenedAt || 0);
        const lastCompleted = Math.max(status.lastTaskCompleted || 0, state.lastTaskCompletedAt || 0);
        const lastNudgeSent = state.lastAngryNudgeSentAt || 0;

        // Enforce at least 60 minutes between angry SMS messages
        if (now - lastNudgeSent < oneHourMs) return;

        const appUnopenedOverAnHour = lastOpened > 0 ? (now - lastOpened >= oneHourMs) : true;
        const noTasksCompletedOverAnHour = lastCompleted > 0 ? (now - lastCompleted >= oneHourMs) : true;

        if (appUnopenedOverAnHour) {
            const quote = ANGRY_APP_UNOPENED_QUOTES[Math.floor(Math.random() * ANGRY_APP_UNOPENED_QUOTES.length)];
            console.log(`[Aggressive Motivation] App unopened for 1h+ trigger: ${quote}`);
            state.lastAngryNudgeSentAt = now;
            saveState(state);
            await sendIMessage(myPhone, `🔥 ${quote}`);
        } else if (noTasksCompletedOverAnHour) {
            const quote = ANGRY_NO_COMPLETION_QUOTES[Math.floor(Math.random() * ANGRY_NO_COMPLETION_QUOTES.length)];
            console.log(`[Aggressive Motivation] No tasks completed for 1h+ trigger: ${quote}`);
            state.lastAngryNudgeSentAt = now;
            saveState(state);
            await sendIMessage(myPhone, `⚠️ ${quote}`);
        }
    } catch (e) {
        console.error("Error in checkAggressiveMotivationNudges:", e.message);
    }
}

module.exports = {
    processIncomingSMS,
    checkUpcomingMeetings,
    triggerStalePurgeOffer,
    checkAggressiveMotivationNudges
};
