const { gmail: getGmailClient } = require('googleapis/build/src/apis/gmail');
const { calendar: getCalendarClient } = require('googleapis/build/src/apis/calendar');
const { OAuth2Client } = require('google-auth-library');
const fs = require('fs');
const path = require('path');

async function getAllGoogleAuths() {
    return new Promise((resolve) => {
        const credPath = path.join(__dirname, 'credentials.json');
        if (!fs.existsSync(credPath)) {
            console.error("Missing Google credentials.json at", credPath);
            return resolve([]);
        }
        
        fs.readFile(credPath, (err, content) => {
            if (err) return resolve([]);
            const credentials = JSON.parse(content);
            const {client_secret, client_id, redirect_uris} = credentials.installed;
            
            const auths = [];
            const files = fs.readdirSync(__dirname);
            const tokenFiles = files.filter(f => f.startsWith('token') && f.endsWith('.json'));
            
            for (const tFile of tokenFiles) {
                try {
                    const token = JSON.parse(fs.readFileSync(path.join(__dirname, tFile), 'utf8'));
                    const oAuth2Client = new OAuth2Client(client_id, client_secret, redirect_uris[0]);
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
        const gmail = getGmailClient({version: 'v1', auth: authObj.client});
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

const JUSTIN_CALENDAR_NAMES = new Set([
    'task management',
    'justin',
    'justin@turnninety.com',
    'justinstarrclikevans@gmail.com',
    'justinscevans@gmail.com',
    '843 fc u16',
    'u16 north charleston rec',
    'family'
]);

async function getTodaysCalendarEvents(daysAhead = 3) {
    const auths = await getAllGoogleAuths();
    if (auths.length === 0) return [];
    
    const eventsData = [];
    const seenKeys = new Set();
    
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString();
    const endWindow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (daysAhead - 1), 23, 59, 59, 999).toISOString();
    
    for (const authObj of auths) {
        const calendar = getCalendarClient({version: 'v3', auth: authObj.client});
        
        try {
            let targetCalendars = [{ id: 'primary', summary: 'Primary' }];
            try {
                const listRes = await calendar.calendarList.list();
                const allCals = listRes.data.items || [];
                const matched = allCals.filter(c => {
                    if (!c || !c.id) return false;
                    if (c.id.includes('holiday@group')) return false;
                    if (c.primary) return true;
                    const sumLower = (c.summary || '').trim().toLowerCase();
                    return JUSTIN_CALENDAR_NAMES.has(sumLower);
                });
                if (matched.length > 0) {
                    targetCalendars = matched;
                }
            } catch (e) {
                // fallback to primary
            }

            for (const calInfo of targetCalendars) {
                try {
                    const res = await calendar.events.list({
                        calendarId: calInfo.id,
                        timeMin: startOfDay,
                        timeMax: endWindow,
                        singleEvents: true,
                        orderBy: 'startTime',
                    });
                    
                    const events = res.data.items || [];
                    for (const event of events) {
                        if (event.status === 'cancelled') continue;
                        const startStr = event.start?.dateTime || event.start?.date;
                        const endStr = event.end?.dateTime || event.end?.date;
                        if (!startStr || !event.summary) continue;

                        const dedupeKey = `${event.id || ''}::${(event.summary || '').trim().toLowerCase()}::${startStr}`;
                        if (seenKeys.has(dedupeKey)) continue;
                        seenKeys.add(dedupeKey);

                        let durationMinutes = 30;
                        if (event.start?.dateTime && event.end?.dateTime) {
                            const diffMins = Math.round((new Date(event.end.dateTime).getTime() - new Date(event.start.dateTime).getTime()) / 60000);
                            if (diffMins > 0) durationMinutes = Math.max(5, diffMins);
                        }

                        eventsData.push({
                            id: event.id,
                            summary: event.summary,
                            start: startStr,
                            end: endStr,
                            durationMinutes,
                            calendarName: calInfo.summary || 'Calendar',
                            isAllDay: !event.start.dateTime,
                            description: event.description || '',
                            location: event.location || ''
                        });
                    }
                } catch (calErr) {
                    // skip inaccessible calendar
                }
            }
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
        const calendar = getCalendarClient({version: 'v3', auth: authObj.client});
        
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
