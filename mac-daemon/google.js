const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

async function getAllGoogleAuths() {
    return new Promise((resolve) => {
        if (!fs.existsSync('credentials.json')) {
            console.error("Missing Google credentials.json");
            return resolve([]);
        }
        
        fs.readFile('credentials.json', (err, content) => {
            if (err) return resolve([]);
            const credentials = JSON.parse(content);
            const {client_secret, client_id, redirect_uris} = credentials.installed;
            
            const auths = [];
            const files = fs.readdirSync(__dirname);
            const tokenFiles = files.filter(f => f.startsWith('token') && f.endsWith('.json'));
            
            for (const tFile of tokenFiles) {
                try {
                    const token = JSON.parse(fs.readFileSync(path.join(__dirname, tFile), 'utf8'));
                    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
                    oAuth2Client.setCredentials(token);
                    auths.push({ client: oAuth2Client, account: tFile });
                } catch (e) {
                    console.error("Failed to load token file", tFile);
                }
            }
            resolve(auths);
        });
    });
}

async function getRecentEmails(sinceMap = {}) {
    const auths = await getAllGoogleAuths();
    if (auths.length === 0) return [];
    
    const allEmails = [];
    
    for (const authObj of auths) {
        const gmail = google.gmail({version: 'v1', auth: authObj.client});
        const accountSince = typeof sinceMap === 'object' && sinceMap !== null ? sinceMap[authObj.account] : sinceMap;
        
        try {
            const res = await gmail.users.messages.list({
                userId: 'me',
                q: 'is:unread OR (inbox newer_than:3d)',
                maxResults: 25,
            });
            
            const messages = res.data.messages || [];
            for (const msg of messages) {
                const msgData = await gmail.users.messages.get({ userId: 'me', id: msg.id });
                const timestamp = parseInt(msgData.data.internalDate);
                
                // If sinceTimestamp is provided for this account, skip older emails
                if (accountSince && timestamp <= accountSince) {
                    continue;
                }
                
                const payload = msgData.data.payload;
                const headers = payload.headers;
                
                const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
                const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
                
                allEmails.push({ 
                    subject, 
                    from, 
                    snippet: msgData.data.snippet,
                    timestamp: timestamp,
                    account: authObj.account
                });
            }
        } catch (e) {
            console.error(`Gmail error for ${authObj.account}:`, e);
        }
    }
    return allEmails;
}

async function getTodaysCalendarEvents() {
    const auths = await getAllGoogleAuths();
    if (auths.length === 0) return [];
    
    const eventsData = [];
    
    for (const authObj of auths) {
        const calendar = google.calendar({version: 'v3', auth: authObj.client});
        
        try {
            const now = new Date();
            const startOfDay = new Date(now.setHours(0, 0, 0, 0)).toISOString();
            const endOfDay = new Date(now.setHours(23, 59, 59, 999)).toISOString();
            
            const res = await calendar.events.list({
                calendarId: 'primary',
                timeMin: startOfDay,
                timeMax: endOfDay,
                singleEvents: true,
                orderBy: 'startTime',
            });
            
            const events = res.data.items || [];
            events.forEach(event => {
                eventsData.push({
                    summary: event.summary,
                    start: event.start.dateTime || event.start.date,
                    description: event.description || ''
                });
            });
        } catch (e) {
            console.error(`Calendar error for ${authObj.account}:`, e);
        }
    }
    return eventsData;
}

async function getUpcomingCalendarEvents(minutesAhead = 15) {
    const auths = await getAllGoogleAuths();
    if (auths.length === 0) return [];
    
    const eventsData = [];
    
    for (const authObj of auths) {
        const calendar = google.calendar({version: 'v3', auth: authObj.client});
        
        try {
            const now = new Date();
            const future = new Date(now.getTime() + minutesAhead * 60000);
            
            const res = await calendar.events.list({
                calendarId: 'primary',
                timeMin: now.toISOString(),
                timeMax: future.toISOString(),
                singleEvents: true,
                orderBy: 'startTime',
            });
            
            const events = res.data.items || [];
            events.forEach(event => {
                // Only consider events that have a specific start time, not all-day events
                if (event.start.dateTime) {
                    eventsData.push({
                        id: event.id,
                        summary: event.summary,
                        start: event.start.dateTime,
                        description: event.description || ''
                    });
                }
            });
        } catch (e) {
            console.error(`Calendar error for ${authObj.account}:`, e);
        }
    }
    return eventsData;
}

module.exports = {
    getRecentEmails,
    getTodaysCalendarEvents,
    getUpcomingCalendarEvents
};
