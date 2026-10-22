const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { getRecentMessages, sendIMessage } = require('./imessage');
const { getIncompleteReminders, completeReminder, moveReminderToSomeday, addReminder } = require('./reminders');
const { getMostImportantTask, getMeetingRelatedTasks } = require('./ai');
const { getUpcomingCalendarEvents } = require('./google');
const { syncTaskToSupabase, getRoutines } = require('./supabase');

const STATE_FILE = path.join(__dirname, 'state.json');

const DEFAULT_ROUTINES = {
    'FIRST SHIFT': {
        name: 'First Shift Intake & Casework Kickoff',
        list: 'First shift',
        items: [
            { title: "Review Antoine Turner intake notes & Google Meet log", estimatedMinutes: 10, firstFiveMinutes: "Open the intake doc and read line 1." },
            { title: "Fill out Apricot employment update form", estimatedMinutes: 15, firstFiveMinutes: "Log into Apricot portal and find participant profile." },
            { title: "Send PIC volunteer coaching check-in email", estimatedMinutes: 10, firstFiveMinutes: "Open Gmail draft and type opening 2 sentences." }
        ]
    },
    'FOOTBALL': {
        name: 'Football / 843 Practice & Drill Prep',
        list: 'Football',
        items: [
            { title: "Check field permit status & confirm practice slot", estimatedMinutes: 5, firstFiveMinutes: "Check Parks & Rec confirmation email." },
            { title: "Prep cones, footballs & coaching drill sheet", estimatedMinutes: 15, firstFiveMinutes: "Grab gear bag from trunk and inspect inventory." },
            { title: "Send parent/coach reminder text on group chat", estimatedMinutes: 5, firstFiveMinutes: "Draft text with start time and field number." }
        ]
    },
    'SHUTDOWN': {
        name: 'Executive Daily Shutdown & Stale Purge',
        list: 'Personal',
        items: [
            { title: "Clear browser tabs & review scratch notes", estimatedMinutes: 5, firstFiveMinutes: "Close finished tabs and save keepers to project notes." },
            { title: "Review Play Queue and bump unstarted tasks to tomorrow", estimatedMinutes: 5, firstFiveMinutes: "Open ToDo Companion and tap Bump to Tomorrow." },
            { title: "Pin top 3 priority tasks for tomorrow morning", estimatedMinutes: 5, firstFiveMinutes: "Tap +Queue on tomorrow morning’s primary focus." }
        ]
    },
    'MOMENTUM': {
        name: 'Momentum Kickstart (Beat Paralysis)',
        list: 'Personal',
        items: [
            { title: "2-minute physical desk & environment reset", estimatedMinutes: 5, firstFiveMinutes: "Pick up 3 stray items and throw away trash." },
            { title: "5-minute triage of incoming Slack & Gmail", estimatedMinutes: 5, firstFiveMinutes: "Scan subject lines without opening reply rabbit holes." },
            { title: "15-minute deep focus sprint on #1 priority", estimatedMinutes: 15, firstFiveMinutes: "Start the timer and work on line 1 for 60 seconds." }
        ]
    }
};

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

async function processIncomingSMS() {
    const state = loadState();
    const lastProcessed = state.lastSMSProcessed || (Date.now() - 3600000); 
    
    try {
        const messages = await getRecentMessages(lastProcessed);
        if (messages.length === 0) return;
        
        let newLastProcessed = lastProcessed;
        let processedDoneThisRun = false;
        
        for (const msg of messages) {
            newLastProcessed = Math.max(newLastProcessed, msg.timestamp);
            
            const sender = msg.sender;
            const myPhone = process.env.MY_PHONE_NUMBER;
            
            if (sender === 'Me' || (myPhone && sender.includes(myPhone))) {
                const text = msg.text.trim().toUpperCase();
                
                if (text.includes('DONE') && text.length < 50) {
                    if (processedDoneThisRun) {
                        console.log("[SMS] Skipping additional DONE to prevent rapid-fire SMS.");
                        continue;
                    }
                    processedDoneThisRun = true;
                    
                    console.log("[SMS] Received 'DONE'. Checking for focused task...");
                    if (state.focusedTask && state.focusedTask.id) {
                        const successInfo = await completeReminder(state.focusedTask.id);
                        if (successInfo && successInfo.success !== false) {
                            console.log(`[SMS] Completed task: ${state.focusedTask.title}`);
                            state.lastTaskCompletedAt = Date.now();
                            state.idleNudgeSent = false;
                            state.overtimeNudgeSent = false;
                            
                            const openTasks = await getIncompleteReminders();
                            const nextTask = await getMostImportantTask(openTasks);
                            
                            if (nextTask) {
                                state.focusedTask = nextTask;
                                state.focusedTaskStartedAt = Date.now();
                                state.didSendHalfway = false;
                                const smsText = `Awesome. Next focus:\n\n${nextTask.title}\n\nReply DONE when finished.`;
                                await sendIMessage(myPhone, smsText);
                            } else {
                                state.focusedTask = null;
                                state.focusedTaskStartedAt = null;
                                state.didSendHalfway = false;
                                await sendIMessage(myPhone, `All caught up! No open tasks left right now.`);
                            }
                        } else {
                            await sendIMessage(myPhone, `Hmm, had trouble marking that task as complete. Check your Apple Reminders.`);
                        }
                    } else {
                        const openTasks = await getIncompleteReminders();
                        const nextTask = await getMostImportantTask(openTasks);
                        if (nextTask) {
                            state.focusedTask = nextTask;
                            state.focusedTaskStartedAt = Date.now();
                            state.didSendHalfway = false;
                            await sendIMessage(myPhone, `I didn't have a task tracked, but let's start fresh. Your focus:\n\n${nextTask.title}\n\nReply DONE when finished.`);
                        }
                    }
                } else if (text.includes('WAIT') && text.length < 50) {
                    if (processedDoneThisRun) {
                        console.log("[SMS] Skipping additional WAIT to prevent rapid-fire SMS.");
                        continue;
                    }
                    processedDoneThisRun = true;
                    
                    console.log("[SMS] Received 'WAIT'. Skipping current task...");
                    const openTasks = await getIncompleteReminders();
                    
                    // Filter out the currently focused task so AI doesn't just pick it again
                    const filteredTasks = state.focusedTask ? openTasks.filter(t => t.id !== state.focusedTask.id) : openTasks;
                    const nextTask = await getMostImportantTask(filteredTasks);
                    
                    if (nextTask) {
                        state.focusedTask = nextTask;
                        state.focusedTaskStartedAt = Date.now();
                        state.didSendHalfway = false;
                        const smsText = `Skipping that one for now. Next focus:\n\n${nextTask.title}\n\nReply DONE to complete, or WAIT to skip.`;
                        await sendIMessage(myPhone, smsText);
                    } else {
                        state.focusedTask = null;
                        state.focusedTaskStartedAt = null;
                        state.didSendHalfway = false;
                        await sendIMessage(myPhone, `All caught up! No other open tasks right now.`);
                    }
                } else if (text === 'PURGE') {
                    console.log("[SMS] Received 'PURGE'. Checking if purge was offered...");
                    if (state.purgePending) {
                        console.log("[SMS] Executing purge...");
                        const openTasks = await getIncompleteReminders();
                        const now = Date.now();
                        const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
                        
                        let purgedCount = 0;
                        for (const task of openTasks) {
                            const taskAge = now - new Date(task.updated).getTime();
                            if (taskAge > fourteenDaysMs) {
                                const success = await moveReminderToSomeday(task.tasklistId, task.id, task.title, task.description);
                                if (success) purgedCount++;
                            }
                        }
                        
                        state.purgePending = false;
                        await sendIMessage(myPhone, `Purge complete! Moved ${purgedCount} stale tasks to your 'Someday' list. Breathing room restored.`);
                    }
                } else if (text === 'ROUTINES' || text === 'ROUTINE') {
                    const routineList = Object.keys(DEFAULT_ROUTINES)
                        .map(key => `• ROUTINE ${key} (${DEFAULT_ROUTINES[key].name})`)
                        .join('\n');
                    const reply = `✨ Available Routines (Tiimo-Style):\n\n${routineList}\n\nReply with any command (e.g. ROUTINE FIRST SHIFT) to deploy into your Play Queue!`;
                    await sendIMessage(myPhone, reply);
                } else if (text.startsWith('ROUTINE ')) {
                    const requestedKey = text.replace('ROUTINE ', '').trim();
                    const matchedKey = Object.keys(DEFAULT_ROUTINES).find(k => k === requestedKey || requestedKey.includes(k) || k.includes(requestedKey));
                    
                    if (matchedKey) {
                        const routine = DEFAULT_ROUTINES[matchedKey];
                        console.log(`[SMS] Deploying routine: ${routine.name}`);
                        
                        let firstTask = null;
                        for (const item of routine.items) {
                            const desc = `[⏱ ${item.estimatedMinutes}m] [▶️ Queue]\n⚡ First 5 Minutes: ${item.firstFiveMinutes}`;
                            await addReminder(routine.list, item.title, desc);
                            
                            const synced = await syncTaskToSupabase({
                                title: item.title,
                                description: desc,
                                listName: routine.list,
                                estimated_minutes: item.estimatedMinutes,
                                in_play_queue: true,
                                first_five_minutes: item.firstFiveMinutes
                            });
                            
                            if (!firstTask) {
                                firstTask = {
                                    id: synced ? synced.id : null,
                                    title: item.title,
                                    listName: routine.list,
                                    description: desc,
                                    firstFiveMinutes: item.firstFiveMinutes,
                                    estimatedMinutes: item.estimatedMinutes
                                };
                            }
                        }
                        
                        state.focusedTask = firstTask;
                        state.focusedTaskStartedAt = Date.now();
                        state.didSendHalfway = false;
                        
                        const reply = `🚀 Deployed "${routine.name}" (${routine.items.length} tasks in Play Queue)!\n\nFirst Sprint:\n${firstTask.title} (⏱ ${firstTask.estimatedMinutes}m)\n⚡ First 5m: ${firstTask.firstFiveMinutes}\n\nReply DONE when finished, or WAIT to skip.`;
                        await sendIMessage(myPhone, reply);
                    } else {
                        await sendIMessage(myPhone, `Could not find routine "${requestedKey}". Reply ROUTINES to see available templates.`);
                    }
                }
            }
        }
        
        state.lastSMSProcessed = newLastProcessed;
        saveState(state);
    } catch (e) {
        console.error("Error processing incoming SMS:", e);
    }
}

async function checkUpcomingMeetings() {
    const state = loadState();
    state.alertedMeetings = state.alertedMeetings || [];
    
    try {
        const upcomingEvents = await getUpcomingCalendarEvents(15);
        if (upcomingEvents.length === 0) return;
        
        const openTasks = await getIncompleteReminders();
        if (openTasks.length === 0) return;
        
        for (const event of upcomingEvents) {
            // Check if we've already alerted for this meeting
            if (state.alertedMeetings.includes(event.id)) continue;
            
            const relatedTasks = await getMeetingRelatedTasks(event, openTasks);
            if (relatedTasks && relatedTasks.length > 0) {
                console.log(`[Meeting Context] Found ${relatedTasks.length} tasks related to ${event.summary}`);
                
                const taskBullets = relatedTasks.map(t => `- ${t.title}`).join('\n');
                const smsText = `Reminder: '${event.summary}' is starting soon. You have related tasks:\n\n${taskBullets}`;
                
                const myPhone = process.env.MY_PHONE_NUMBER;
                if (myPhone) {
                    await sendIMessage(myPhone, smsText);
                }
            }
            
            state.alertedMeetings.push(event.id);
        }
        
        // Clean up old alerted meetings (keep last 50)
        if (state.alertedMeetings.length > 50) {
            state.alertedMeetings = state.alertedMeetings.slice(-50);
        }
        
        saveState(state);
    } catch (e) {
        console.error("Error checking upcoming meetings:", e);
    }
}

async function triggerStalePurgeOffer() {
    console.log("[Stale Purge] Evaluating tasks for stale purge...");
    try {
        const openTasks = await getIncompleteReminders();
        const now = Date.now();
        const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
        
        const staleTasks = openTasks.filter(task => {
            return (now - new Date(task.updated).getTime()) > fourteenDaysMs;
        });
        
        if (staleTasks.length > 0) {
            const state = loadState();
            state.purgePending = true;
            saveState(state);
            
            const myPhone = process.env.MY_PHONE_NUMBER;
            if (myPhone) {
                const smsText = `End of week cleanup! You have ${staleTasks.length} tasks that haven't been updated in over 2 weeks. Reply PURGE to move them to your 'Someday' list and clear your plate for the weekend.`;
                await sendIMessage(myPhone, smsText);
            }
        }
    } catch (e) {
        console.error("Error triggering stale purge offer:", e);
    }
}

// Function to manually kick off the "One Thing" loop if needed
async function startOneThingFocus() {
    try {
        const openTasks = await getIncompleteReminders();
        const nextTask = await getMostImportantTask(openTasks);
        
        if (nextTask) {
            const state = loadState();
            state.focusedTask = nextTask;
            state.focusedTaskStartedAt = Date.now();
            state.didSendHalfway = false;
            saveState(state);
            
            const myPhone = process.env.MY_PHONE_NUMBER;
            if (myPhone) {
                await sendIMessage(myPhone, `Let's focus. Your One Thing:\n\n${nextTask.title}\n\nReply DONE when finished.`);
            }
        }
    } catch (e) {
        console.error("Error starting One Thing focus:", e);
    }
}

async function checkHalfwayNudge() {
    const state = loadState();
    if (!state.focusedTask || !state.focusedTaskStartedAt || state.didSendHalfway) return;
    
    const elapsedMinutes = (Date.now() - state.focusedTaskStartedAt) / (60 * 1000);
    // Trigger halfway nudge if active for 15+ minutes
    if (elapsedMinutes >= 15) {
        state.didSendHalfway = true;
        saveState(state);
        
        const myPhone = process.env.MY_PHONE_NUMBER;
        if (myPhone) {
            console.log(`[Halfway Nudge] Sending halfway check-in for: ${state.focusedTask.title}`);
            const text = `⏱ Halfway Check-in: You've been on "${state.focusedTask.title}" for ~15m.\n\nStill cruising, or hit a blocker? Reply DONE to wrap up, or WAIT to switch.`;
            await sendIMessage(myPhone, text);
        }
    }
}

const AGGRESSIVE_IDLE_QUOTES = [
    "Don't fuck it up. You've been sitting idle for 15 minutes. Pick your next target and attack.",
    "Clock is bleeding, move. 15 minutes gone. Get off your ass and start the next task.",
    "Quit bullshitting. One task down doesn't mean the day is won. Attack line 1 now.",
    "Comfort is a trap. You're stalling. Open the board and execute.",
    "Nobody is coming to save you or finish your drill. Next task starts right now.",
    "Excuses don't build empires. 60 seconds on the clock—get moving."
];

const AGGRESSIVE_OVERTIME_QUOTES = [
    "You're bleeding time on '${taskTitle}'. Stop overthinking, cut the bullshit, finish it, and hit Done.",
    "Clock expired on '${taskTitle}'. You're drifting. Kill the distractions and finish the drill right now.",
    "Time's up on '${taskTitle}'. Wrap it up or kill it. Move.",
    "Don't let '${taskTitle}' drag you into paralysis. Close it out now."
];

async function checkAggressiveMotivationNudges() {
    const state = loadState();
    const myPhone = process.env.MY_PHONE_NUMBER;
    if (!myPhone) return;

    // 1. Check for 15-minute Idle gap after finishing a task
    if (state.lastTaskCompletedAt && !state.focusedTask && !state.idleNudgeSent) {
        const idleMinutes = (Date.now() - state.lastTaskCompletedAt) / (60 * 1000);
        if (idleMinutes >= 15) {
            state.idleNudgeSent = true;
            saveState(state);
            const quote = AGGRESSIVE_IDLE_QUOTES[Math.floor(Math.random() * AGGRESSIVE_IDLE_QUOTES.length)];
            console.log(`[Aggressive Motivation] Sending 15m idle anger trigger: ${quote}`);
            await sendIMessage(myPhone, `🔥 ${quote}`);
        }
    }

    // 2. Check for Overtime on active focused task
    if (state.focusedTask && state.focusedTaskStartedAt && !state.overtimeNudgeSent) {
        const estimatedMin = state.focusedTask.estimatedMinutes || 15;
        const elapsedMinutes = (Date.now() - state.focusedTaskStartedAt) / (60 * 1000);
        // Alert if 5 minutes beyond the task's assigned duration
        if (elapsedMinutes >= (estimatedMin + 5)) {
            state.overtimeNudgeSent = true;
            saveState(state);
            let quote = AGGRESSIVE_OVERTIME_QUOTES[Math.floor(Math.random() * AGGRESSIVE_OVERTIME_QUOTES.length)];
            quote = quote.replace('${taskTitle}', state.focusedTask.title || 'current task');
            console.log(`[Aggressive Motivation] Sending overtime alert: ${quote}`);
            await sendIMessage(myPhone, `⚠️ ${quote}`);
        }
    }
}

module.exports = {
    processIncomingSMS,
    checkUpcomingMeetings,
    triggerStalePurgeOffer,
    startOneThingFocus,
    checkHalfwayNudge,
    checkAggressiveMotivationNudges
};
