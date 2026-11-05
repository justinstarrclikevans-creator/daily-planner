const { exec, execFile } = require('child_process');
const path = require('path');

async function getIncompleteReminders() {
    const binPath = path.join(__dirname, 'get_reminders');
    return new Promise((resolve, reject) => {
        exec(`"${binPath}"`, (error, stdout, stderr) => {
            if (error) {
                console.error("Swift get_reminders error:", stderr);
                return resolve([]);
            }
            try {
                const rawData = JSON.parse(stdout.trim());
                const data = rawData.map(r => ({
                    id: r.id,
                    title: r.name,
                    description: r.body,
                    listName: r.listName,
                    updated: r.updated,
                    dueDate: r.dueDate,
                    priority: r.priority || 'medium',
                    isCompleted: false
                }));
                resolve(data);
            } catch (e) {
                resolve([]);
            }
        });
    });
}

async function getRecentCompletedReminders() {
    const binPath = path.join(__dirname, 'get_reminders');
    return new Promise((resolve) => {
        exec(`"${binPath}" --completed`, (error, stdout, stderr) => {
            if (error) {
                console.error("Swift get_reminders --completed error:", stderr);
                return resolve([]);
            }
            try {
                const rawData = JSON.parse(stdout.trim());
                const data = rawData.map(r => ({
                    id: r.id,
                    title: r.name,
                    description: r.body,
                    listName: r.listName,
                    updated: r.updated,
                    dueDate: r.dueDate,
                    priority: r.priority || 'medium',
                    isCompleted: true,
                    completionDate: r.completionDate
                }));
                resolve(data);
            } catch (e) {
                resolve([]);
            }
        });
    });
}

async function getAllReminders() {
    const binPath = path.join(__dirname, 'get_reminders');
    return new Promise((resolve) => {
        exec(`"${binPath}" --all`, (error, stdout, stderr) => {
            if (error) {
                console.error("Swift get_reminders --all error:", stderr);
                return resolve([]);
            }
            try {
                const rawData = JSON.parse(stdout.trim());
                const data = rawData.map(r => ({
                    id: r.id,
                    title: r.name,
                    description: r.body,
                    listName: r.listName,
                    updated: r.updated,
                    dueDate: r.dueDate,
                    priority: r.priority || 'medium',
                    isCompleted: !!r.isCompleted,
                    completionDate: r.completionDate
                }));
                resolve(data);
            } catch (e) {
                resolve([]);
            }
        });
    });
}

async function completeReminder(id) {
    const binPath = path.join(__dirname, 'complete_reminder');
    return new Promise((resolve, reject) => {
        exec(`"${binPath}" "${id}"`, (error, stdout, stderr) => {
            if (error) {
                return resolve({success: false});
            }
            try {
                resolve(JSON.parse(stdout.trim()));
            } catch (e) {
                resolve({success: false});
            }
        });
    });
}

async function addReminder(listName, title, notes = "", priority = "none", dueDate = null) {
    const cleanTitle = (title || "").replace(/!+/g, '').replace(/#\w[\w-]*/g, '').replace(/\[⏱\s*\d+m\]/g, '').trim();
    const cleanNotes = (notes || "").replace(/!+/g, '.');
    const safeTitle = cleanTitle.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const safeNotes = cleanNotes.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const safeList = (listName || "").replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    // In Apple Reminders, priority 1 = '!!!', priority 5 = '!!', priority 9 = '!'.
    // Priority 0 means None (zero exclamation points).
    const prioVal = (priority === 'high') ? 1 : ((priority === 'medium') ? 5 : ((priority === 'low') ? 9 : 0));

    let dateScript = '';
    let propDueDate = '';
    if (dueDate) {
        const d = new Date(dueDate);
        if (!isNaN(d.getTime())) {
            const year = d.getFullYear();
            const month = d.getMonth() + 1;
            const day = d.getDate();
            const hours = d.getHours();
            const minutes = d.getMinutes();
            const seconds = d.getSeconds();
            dateScript = `
        set d to current date
        set year of d to ${year}
        set month of d to ${month}
        set day of d to ${day}
        set hours of d to ${hours}
        set minutes of d to ${minutes}
        set seconds of d to ${seconds}
            `;
            propDueDate = ', due date:d';
        }
    }

    const script = `
    tell application "Reminders"
        if not (exists list "${safeList}") then
            make new list with properties {name:"${safeList}"}
        end if
        set targetList to list "${safeList}"
        ${dateScript}
        make new reminder at end of reminders of targetList with properties {name:"${safeTitle}", body:"${safeNotes}", priority:${prioVal}${propDueDate}}
    end tell
    `;
    return new Promise((resolve) => {
        execFile('osascript', ['-e', script], (err) => {
            if (err) console.error("Error creating reminder:", err.message);
            resolve(!err);
        });
    });
}

async function moveReminderToSomeday(id, title, notes = "") {
    const added = await addReminder("Someday", title, notes);
    if (added) {
        await completeReminder(id);
        return true;
    }
    return false;
}

async function updateReminderNotes(id, notes) {
    const binPath = path.join(__dirname, 'update_reminder_notes');
    return new Promise((resolve, reject) => {
        exec(`"${binPath}" "${id}" "${notes.replace(/"/g, '\\"')}"`, (error, stdout, stderr) => {
            if (error) {
                return resolve({success: false});
            }
            try {
                resolve(JSON.parse(stdout.trim()));
            } catch (e) {
                resolve({success: false});
            }
        });
    });
}

async function getActivityStatus() {
    const binPath = path.join(__dirname, 'get_activity_status');
    return new Promise((resolve) => {
        exec(`"${binPath}"`, (error, stdout) => {
            if (error) return resolve({ lastAppOpened: 0, lastTaskCompleted: 0, openCount: 0 });
            try {
                resolve(JSON.parse(stdout.trim()));
            } catch (e) {
                resolve({ lastAppOpened: 0, lastTaskCompleted: 0, openCount: 0 });
            }
        });
    });
}

module.exports = {
    getIncompleteReminders,
    getRecentCompletedReminders,
    getAllReminders,
    completeReminder,
    addReminder,
    moveReminderToSomeday,
    updateReminderNotes,
    getActivityStatus
};
