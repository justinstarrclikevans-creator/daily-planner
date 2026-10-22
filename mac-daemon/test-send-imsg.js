const { exec } = require('child_process');

function sendIMessage(target, text) {
    const safeText = text.replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const script = `
    tell application "Messages"
        set targetService to 1st service whose service type = iMessage
        set targetBuddy to buddy "${target}" of targetService
        send "${safeText}" to targetBuddy
    end tell
    `;
    return new Promise((resolve, reject) => {
        exec(`osascript -e '${script}'`, (err, stdout, stderr) => {
            if (err) {
                console.error(stderr);
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}
module.exports = { sendIMessage };
