const { exec } = require('child_process');
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
                const data = JSON.parse(stdout.trim());
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

module.exports = {
    getIncompleteReminders,
    completeReminder
};
