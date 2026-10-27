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

async function addReminder(listName, title, notes = "") {
    const safeTitle = (title || "").replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const safeNotes = (notes || "").replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const safeList = (listName || "").replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = `
    tell application "Reminders"
        if not (exists list "${safeList}") then
            make new list with properties {name:"${safeList}"}
        end if
        set targetList to list "${safeList}"
        make new reminder at end of reminders of targetList with properties {name:"${safeTitle}", body:"${safeNotes}"}
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
