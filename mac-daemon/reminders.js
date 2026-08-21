const { exec } = require('child_process');

async function getIncompleteReminders() {
    const jxaScript = `
        var Reminders = Application("Reminders");
        var lists = Reminders.lists();
        var allReminders = [];
        
        for (var i = 0; i < lists.length; i++) {
            var list = lists[i];
            var reminders = list.reminders();
            for (var j = 0; j < reminders.length; j++) {
                var r = reminders[j];
                if (!r.completed()) {
                    allReminders.push({
                        id: r.id(),
                        name: r.name(),
                        body: r.body() || "",
                        dueDate: r.dueDate() ? r.dueDate().toISOString() : null,
                        listName: list.name()
                    });
                }
            }
        }
        JSON.stringify(allReminders);
    `;

    return new Promise((resolve, reject) => {
        exec(`osascript -l JavaScript -e '${jxaScript}'`, (error, stdout, stderr) => {
            if (error) {
                console.error("AppleScript error:", stderr);
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
    const jxaScript = `
        var Reminders = Application("Reminders");
        var reminder = Reminders.reminders.byId("${id}");
        if (reminder) {
            reminder.completed = true;
            JSON.stringify({success: true});
        } else {
            JSON.stringify({success: false, error: "Not found"});
        }
    `;

    return new Promise((resolve, reject) => {
        exec(`osascript -l JavaScript -e '${jxaScript}'`, (error, stdout, stderr) => {
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
