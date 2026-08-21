const { google } = require('googleapis');
const fs = require('fs');

async function getGoogleAuth() {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync('credentials.json') || !fs.existsSync('token.json')) {
            console.error("Missing Google credentials.json or token.json");
            return resolve(null);
        }
        
        fs.readFile('credentials.json', (err, content) => {
            if (err) return resolve(null);
            const credentials = JSON.parse(content);
            const {client_secret, client_id, redirect_uris} = credentials.installed;
            const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
            
            fs.readFile('token.json', (err, token) => {
                if (err) return resolve(null);
                oAuth2Client.setCredentials(JSON.parse(token));
                resolve(oAuth2Client);
            });
        });
    });
}

async function getRecentEmails() {
    const auth = await getGoogleAuth();
    if (!auth) return [];
    
    const gmail = google.gmail({version: 'v1', auth});
    const emails = [];
    try {
        const res = await gmail.users.messages.list({
            userId: 'me',
            q: 'is:unread',
            maxResults: 10,
        });
        
        const messages = res.data.messages || [];
        for (const msg of messages) {
            const msgData = await gmail.users.messages.get({ userId: 'me', id: msg.id });
            const payload = msgData.data.payload;
            const headers = payload.headers;
            
            const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
            const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
            
            // Extract snippet instead of parsing complex body for brevity
            emails.push({ subject, from, snippet: msgData.data.snippet });
        }
    } catch (e) {
        console.error("Gmail error:", e);
    }
    return emails;
}

async function getTodaysCalendarEvents() {
    const auth = await getGoogleAuth();
    if (!auth) return [];
    
    const calendar = google.calendar({version: 'v3', auth});
    const eventsData = [];
    
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
        console.error("Calendar error:", e);
    }
    return eventsData;
}

module.exports = {
    getRecentEmails,
    getTodaysCalendarEvents
};
