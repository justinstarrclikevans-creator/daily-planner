const { exec } = require('child_process');
const os = require('os');
const path = require('path');

const CHAT_DB = path.join(os.homedir(), 'Library/Messages/chat.db');

async function getRecentMessages(sinceTimestamp = 0) {
    let minDate;
    if (sinceTimestamp > 0) {
        // Add 10ms (10,000,000 ns) buffer to avoid JS float precision issues and duplicate processing
        minDate = Math.round((sinceTimestamp / 1000 - 978307200) * 1000000000) + 10000000;
    } else {
        minDate = Math.round((Date.now() / 1000 - (24 * 60 * 60) - 978307200) * 1000000000);
    }

    const query = `
    SELECT 
        m.text, 
        m.date, 
        m.is_from_me, 
        c.chat_identifier,
        hex(m.attributedBody)
    FROM message m
    JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
    JOIN chat c ON cmj.chat_id = c.ROWID
    WHERE m.date > ${minDate}
    ORDER BY m.date ASC;
    `;
    
    return new Promise((resolve) => {
        exec(`sqlite3 "${CHAT_DB}" "${query}"`, (err, stdout, stderr) => {
            if (err) {
                console.error("iMessage SQLite Error. Likely missing Full Disk Access.");
                return resolve([]);
            }
            
            const lines = stdout.trim().split('\n');
            const messages = [];
            for (const line of lines) {
                if (!line) continue;
                const parts = line.split('|');
                if (parts.length >= 5) {
                    let text = parts.slice(0, parts.length - 4).join('|');
                    const date = parts[parts.length - 4];
                    const is_from_me = parts[parts.length - 3];
                    const sender = parts[parts.length - 2];
                    const hexBody = parts[parts.length - 1];
                    
                    if (!text && hexBody && hexBody !== 'NULL') {
                        // Extract ASCII from hex, strip non-printables
                        let ascii = Buffer.from(hexBody, 'hex').toString('utf8');
                        ascii = ascii.replace(/[^\x20-\x7E\n]/g, '').trim();
                        // Strip common Apple classes
                        text = ascii.replace(/(streamtyped|NSAttributedString|NSDictionary|NSNumber|NSString|NSObject|NSMutableString|NSValue|NSData|__kIMMessagePartAttributeName)/ig, '').trim();
                    }
                    
                    const jsTimestamp = (parseInt(date) / 1000000000 + 978307200) * 1000;
                    
                    messages.push({
                        text,
                        sender: is_from_me === '1' ? 'Me' : sender,
                        timestamp: jsTimestamp
                    });
                }
            }
            resolve(messages);
        });
    });
}

module.exports = { getRecentMessages };

function isWithinTextingHours() {
    const hour = new Date().getHours();
    // Strictly only send text messages between 8:00 AM and 9:00 PM (08:00 to 20:59) every day
    return hour >= 8 && hour < 21;
}

function sendIMessage(target, text) {
    if (!isWithinTextingHours()) {
        console.log(`[iMessage Blocked] Outside allowed 8am-9pm window (${new Date().toLocaleTimeString()}). Message suppressed.`);
        return Promise.resolve(false);
    }
    const safeText = text.replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const script = `
    tell application "Messages"
        set targetService to 1st service whose service type = iMessage
        set targetBuddy to buddy "${target}" of targetService
        send "${safeText}" to targetBuddy
    end tell
    `;
    return new Promise((resolve) => {
        const { spawn } = require('child_process');
        const child = spawn('osascript', ['-']);
        
        let errOutput = '';
        child.stderr.on('data', data => errOutput += data.toString());
        
        child.on('close', (code) => {
            if (code !== 0) {
                console.error("Failed to send iMessage:", errOutput);
                resolve(false);
            } else {
                resolve(true);
            }
        });
        
        child.stdin.write(script);
        child.stdin.end();
    });
}

module.exports.sendIMessage = sendIMessage;
