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
            // Exclude send-only token_gmail_send.json so read/list calls don't hit HTTP 400 Precondition errors
            const tokenFiles = files.filter(
                f => f.startsWith('token') && f.endsWith('.json') && f !== 'token_gmail_send.json'
            );
            
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

const SCHOOL_SENDER_PATTERNS = [
    'bcsdschools.net',
    'parentlink.net',
    'blackboard.com',
    'geniussis.com',
    'lcv admin',
    'lowcountry virtual',
    'hanahan elementary',
    'hanahan middle',
    'hanahan high',
    'berkeley county school',
    'powerschool',
    'parentsquare',
    'thrillshare',
    'finalsite',
    'peachjar',
    'schoology',
    'instructure.com',
    'classdojo',
    'seesaw',
    'talkingpoints',
    'remind.com',
    '.k12.',
];

const KIDS_SCHOOL_NAME_RE = /\b(london|reece|reese|jackson)\b/i;
const SCHOOL_CONTEXT_RE =
    /\b(school|elementary|middle school|high school|bcsd|hanahan|lcv|virtual|attendance|absence|absent|tardy|progress report|report card|gradebook|teacher|principal|guidance|counselor|homeroom|yearbook|cafeteria|school lunch|school bus|pta|pto|semester|homework|instructional calendar|student)\b/i;

const APP_STORE_CONNECT_SENDER_RE = /\b(app\s*store\s*connect|itunes\s*connect|appstoreconnect|itunesconnect|testflight)\b/i;
const APPLE_DEV_CONTEXT_RE =
    /\b(app store connect|itunes connect|testflight|app review|ready for sale|ready for review|waiting for review|in review|processing has completed|new build|beta review|provisioning profile|signing certificate|developer program|xcode cloud)\b/i;

const MARKETING_SENDER_PATTERNS = [
    '@marketing.',
    '.marketing.',
    'metamail.com',
    'sendfoxmail.com',
    'emails.synchrony.com',
    'digitalorder-update@amazon.com',
    'updates-noreply@linkedin.com',
    'hello.babbel.com',
    'meditations@cac.org',
    'informeddelivery.usps.com',
    'mailchimp.com',
    'klaviyo',
    'constantcontact.com',
    'substack.com',
    'beehiiv.com',
    'convertkit',
];

const MARKETING_CONTENT_RE =
    /\b(unsubscribe|view in browser|limited time|%\s*off|\$\d+\s*off|pre-approved|free trial|activate your|flash sale|black friday|cyber monday|special offer|deal ends|shop now|daily meditation|weekly summary|honest review|extra records a month)\b/i;

const ACTIONABLE_BILL_OR_PICKUP_RE =
    /\b(bill is now available|amount due|payment due|past due|invoice|toll|dominion energy|nocd|support plan|ready for pickup|pickup reminder|waiver)\b/i;

function getHeader(headers, name) {
    if (!Array.isArray(headers)) return '';
    const target = name.toLowerCase();
    return headers.find((h) => (h.name || '').toLowerCase() === target)?.value || '';
}

function shouldSkipEmail({ from = '', subject = '', snippet = '', labelIds = [], headers = [] }) {
    const fromLower = String(from || '').toLowerCase();
    const subjLower = String(subject || '').toLowerCase();
    const snipLower = String(snippet || '').toLowerCase();
    const combined = `${from} ${subject} ${snippet}`;
    const combinedLower = combined.toLowerCase();
    const labels = Array.isArray(labelIds) ? labelIds : [];

    // 1. School emails for London, Reece/Reese, and Jackson (or direct school portals)
    if (SCHOOL_SENDER_PATTERNS.some((p) => fromLower.includes(p))) {
        return { skip: true, reason: 'school_sender' };
    }
    if (KIDS_SCHOOL_NAME_RE.test(combined) && SCHOOL_CONTEXT_RE.test(combined)) {
        return { skip: true, reason: 'kids_school_context' };
    }

    // 2. App Store Connect / TestFlight / Apple Developer notifications
    if (
        APP_STORE_CONNECT_SENDER_RE.test(fromLower) ||
        APP_STORE_CONNECT_SENDER_RE.test(subjLower) ||
        (fromLower.includes('apple.com') && APPLE_DEV_CONTEXT_RE.test(combined))
    ) {
        return { skip: true, reason: 'app_store_connect' };
    }

    // 3. Marketing, promotional & newsletter emails (preserving real bills, pickups, & waivers)
    if (labels.includes('SPAM') || labels.includes('TRASH')) {
        return { skip: true, reason: 'spam_or_trash' };
    }
    const isActionableBillOrPickup = ACTIONABLE_BILL_OR_PICKUP_RE.test(combinedLower);
    const isDirectHumanReply = /^re:\s/i.test(subject) && !fromLower.includes('no-reply') && !fromLower.includes('noreply');

    if (!isActionableBillOrPickup && !isDirectHumanReply) {
        if (labels.includes('CATEGORY_PROMOTIONS') || labels.includes('CATEGORY_SOCIAL')) {
            return { skip: true, reason: 'gmail_promo_or_social' };
        }
        if (MARKETING_SENDER_PATTERNS.some((p) => fromLower.includes(p))) {
            return { skip: true, reason: 'marketing_sender' };
        }
        const hasListUnsub = Boolean(getHeader(headers, 'List-Unsubscribe'));
        const precedence = getHeader(headers, 'Precedence').toLowerCase();
        if (hasListUnsub && (precedence === 'bulk' || precedence === 'list' || MARKETING_CONTENT_RE.test(combined))) {
            return { skip: true, reason: 'bulk_marketing' };
        }
        if (MARKETING_CONTENT_RE.test(subjLower)) {
            return { skip: true, reason: 'marketing_subject' };
        }
    }

    return { skip: false, reason: null };
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
                q: '(is:unread OR (in:inbox newer_than:3d)) -category:promotions -category:social',
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
                
                const payload = msgData.data.payload || {};
                const headers = payload.headers || [];
                const labelIds = msgData.data.labelIds || [];
                
                const subject = getHeader(headers, 'Subject') || 'No Subject';
                const from = getHeader(headers, 'From') || 'Unknown';
                const snippet = msgData.data.snippet || '';

                const filterCheck = shouldSkipEmail({ from, subject, snippet, labelIds, headers });
                if (filterCheck.skip) {
                    continue;
                }
                
                allEmails.push({ 
                    subject, 
                    from, 
                    snippet,
                    timestamp: timestamp,
                    account: authObj.account
                });
            }
        } catch (e) {
            console.error(`Gmail error for ${authObj.account}:`, e.message || e);
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
                            location: event.location || '',
                            plannerTaskId: event.extendedProperties?.private?.plannerTaskId || null
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

async function getTurnNinetyCalendarClient() {
    const credPath = path.join(__dirname, 'credentials.json');
    const tokPath = path.join(__dirname, 'token_2.json');
    if (!fs.existsSync(credPath) || !fs.existsSync(tokPath)) return null;
    const credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    const token = JSON.parse(fs.readFileSync(tokPath, 'utf8'));
    const oAuth2Client = new OAuth2Client(client_id, client_secret, redirect_uris[0]);
    oAuth2Client.setCredentials(token);
    return getCalendarClient({ version: 'v3', auth: oAuth2Client });
}

async function upsertTaskCalendarEvent(task, existingEventId = null) {
    try {
        const calendar = await getTurnNinetyCalendarClient();
        if (!calendar || !task.due_date) return { ok: false, error: 'Missing client or due_date' };

        const startDate = new Date(task.due_date);
        if (Number.isNaN(startDate.getTime())) return { ok: false, error: 'Invalid due_date' };
        const durationMins = Math.max(5, Number(task.estimated_minutes) || 15);
        const endDate = new Date(startDate.getTime() + durationMins * 60000);

        const requestBody = {
            summary: task.title,
            description: (task.description || '').trim(),
            start: { dateTime: startDate.toISOString() },
            end: { dateTime: endDate.toISOString() },
            extendedProperties: {
                private: {
                    plannerTaskId: String(task.id)
                }
            }
        };

        if (existingEventId) {
            try {
                const res = await calendar.events.patch({
                    calendarId: 'primary',
                    eventId: existingEventId,
                    requestBody
                });
                return { ok: true, eventId: res.data.id };
            } catch (patchErr) {
                if (patchErr.code !== 404 && patchErr.code !== 410) {
                    throw patchErr;
                }
            }
        }

        const res = await calendar.events.insert({
            calendarId: 'primary',
            requestBody
        });
        return { ok: true, eventId: res.data.id };
    } catch (e) {
        const msg = e.message || String(e);
        const needsReauth = msg.includes('Insufficient Permission') || e.code === 403;
        return { ok: false, needsReauth, error: msg };
    }
}

async function deleteTaskCalendarEvent(eventId) {
    if (!eventId) return { ok: false };
    try {
        const calendar = await getTurnNinetyCalendarClient();
        if (!calendar) return { ok: false };
        await calendar.events.delete({
            calendarId: 'primary',
            eventId
        });
        return { ok: true };
    } catch (e) {
        if (e.code === 404 || e.code === 410) return { ok: true };
        return { ok: false, error: e.message };
    }
}

const GMAIL_SEND_TOKEN_PRIORITY = [
    'token_gmail_send.json',
    'token_2.json',
    'token.json',
    'token_3.json'
];

function tokenHasSendScope(token) {
    if (!token || typeof token.scope !== 'string') return false;
    const scopes = token.scope.split(/\s+/);
    return scopes.some(
        (s) =>
            s === 'https://www.googleapis.com/auth/gmail.send' ||
            s === 'https://mail.google.com/'
    );
}

function hasGmailSendScope() {
    for (const fileName of GMAIL_SEND_TOKEN_PRIORITY) {
        const fullPath = path.join(__dirname, fileName);
        if (!fs.existsSync(fullPath)) continue;
        try {
            const token = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
            if (tokenHasSendScope(token)) {
                return { ready: true, tokenFile: fileName };
            }
        } catch (e) {
            // ignore malformed token file
        }
    }
    return { ready: false, tokenFile: null };
}

function getGmailSendClient() {
    const credPath = path.join(__dirname, 'credentials.json');
    if (!fs.existsSync(credPath)) return { client: null, tokenFile: null, error: 'Missing Google credentials.json' };
    const credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    const { client_secret, client_id, redirect_uris } = credentials.installed;

    const scopeStatus = hasGmailSendScope();
    if (!scopeStatus.ready || !scopeStatus.tokenFile) {
        return {
            client: null,
            tokenFile: null,
            needsReauth: true,
            error: 'No Gmail send OAuth token found. Run auth-gmail-send.js to grant gmail.send permission.'
        };
    }

    const tokPath = path.join(__dirname, scopeStatus.tokenFile);
    const token = JSON.parse(fs.readFileSync(tokPath, 'utf8'));
    const oAuth2Client = new OAuth2Client(client_id, client_secret, redirect_uris[0]);
    oAuth2Client.setCredentials(token);

    return {
        client: getGmailClient({ version: 'v1', auth: oAuth2Client }),
        tokenFile: scopeStatus.tokenFile
    };
}

function sanitizeHeaderValue(val) {
    return String(val || '').replace(/[\r\n]+/g, ' ').trim();
}

function buildRawEmailMessage({ to, subject, body, cc, bcc, replyTo }) {
    const cleanTo = sanitizeHeaderValue(to);
    const cleanSubject = sanitizeHeaderValue(subject);
    if (!cleanTo) throw new Error('Recipient email ("to") is required.');
    if (!cleanSubject) throw new Error('Email subject is required.');

    const headers = [
        `To: ${cleanTo}`,
        `Subject: ${cleanSubject}`,
    ];
    if (cc && sanitizeHeaderValue(cc)) headers.push(`Cc: ${sanitizeHeaderValue(cc)}`);
    if (bcc && sanitizeHeaderValue(bcc)) headers.push(`Bcc: ${sanitizeHeaderValue(bcc)}`);
    if (replyTo && sanitizeHeaderValue(replyTo)) headers.push(`Reply-To: ${sanitizeHeaderValue(replyTo)}`);
    headers.push('MIME-Version: 1.0');
    headers.push('Content-Type: text/plain; charset="UTF-8"');

    const normalizedBody = String(body || '').replace(/\r?\n/g, '\r\n');
    const mime = `${headers.join('\r\n')}\r\n\r\n${normalizedBody}`;

    return Buffer.from(mime, 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

async function sendGmailEmail({ to, subject, body, cc, bcc, replyTo }) {
    try {
        const { client: gmail, tokenFile, needsReauth, error } = getGmailSendClient();
        if (!gmail) {
            return { ok: false, needsReauth: Boolean(needsReauth), error };
        }

        const raw = buildRawEmailMessage({ to, subject, body, cc, bcc, replyTo });
        const res = await gmail.users.messages.send({
            userId: 'me',
            requestBody: { raw }
        });

        return {
            ok: true,
            messageId: res.data?.id || null,
            threadId: res.data?.threadId || null,
            tokenFile
        };
    } catch (e) {
        const msg = e?.message || String(e);
        const needsReauth = msg.includes('Insufficient Permission') || e?.code === 403 || e?.status === 403;
        return {
            ok: false,
            needsReauth,
            error: msg
        };
    }
}

module.exports = {
    getRecentEmails,
    shouldSkipEmail,
    getTodaysCalendarEvents,
    getUpcomingCalendarEvents,
    upsertTaskCalendarEvent,
    deleteTaskCalendarEvent,
    hasGmailSendScope,
    buildRawEmailMessage,
    sendGmailEmail
};
