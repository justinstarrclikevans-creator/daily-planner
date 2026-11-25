const { WebClient } = require('@slack/web-api');
require('dotenv').config();

const JUSTIN_USER_ID = 'U02AGGN2E1Z';
const JUSTIN_USERNAME = 'jevans';

async function downloadSlackCanvasText(url) {
    if (!url || !process.env.SLACK_USER_TOKEN) return '';
    try {
        const resp = await fetch(url, {
            headers: { 'Authorization': `Bearer ${process.env.SLACK_USER_TOKEN}` }
        });
        if (!resp.ok) return '';
        const html = await resp.text();
        const cleaned = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        // Cap canvas text to avoid exceeding token limits
        return cleaned.length > 25000 ? cleaned.substring(0, 25000) + '... [truncated]' : cleaned;
    } catch (e) {
        return '';
    }
}

async function getRecentSlackMessages(sinceTimestamp) {
    if (!process.env.SLACK_USER_TOKEN) {
        console.error("Missing SLACK_USER_TOKEN");
        return [];
    }
    
    const client = new WebClient(process.env.SLACK_USER_TOKEN);
    const messages = [];
    const seenMessageIds = new Set();
    
    // Default to 24 hours ago if sinceTimestamp is not provided
    const minTime = sinceTimestamp ? sinceTimestamp : (Date.now() / 1000 - (24 * 60 * 60));
    
    // 1. Fetch Huddle Notes, Huddle Summaries & Transcripts (High Priority for T90 Action Items)
    try {
        console.log("[Slack] Searching recent Huddle notes, transcripts & summaries...");
        const huddleFilesRes = await client.search.files({
            query: '"Huddle notes" OR huddle',
            sort: 'timestamp',
            sort_dir: 'desc',
            count: 20
        });
        
        for (const file of huddleFilesRes.files?.matches || []) {
            if (file.timestamp < minTime) continue;
            const fileKey = `file_${file.id}`;
            if (seenMessageIds.has(fileKey)) continue;
            seenMessageIds.add(fileKey);

            const cleanText = await downloadSlackCanvasText(file.url_private_download);
            if (!cleanText) continue;

            const isJustinInvolved = cleanText.includes(JUSTIN_USER_ID) || 
                                     cleanText.includes(JUSTIN_USERNAME) || 
                                     cleanText.toLowerCase().includes('justin') ||
                                     file.user === JUSTIN_USER_ID;
            
            if (isJustinInvolved) {
                console.log(`[Slack] Found relevant Huddle summary/transcript: ${file.title}`);
                messages.push({
                    channel: `Huddle: ${file.title}`,
                    text: `[SLACK HUDDLE SUMMARY, TRANSCRIPT & ACTION ITEMS]\nHuddle Title: ${file.title}\nDate: ${new Date(file.timestamp * 1000).toLocaleString()}\nContent:\n${cleanText}`,
                    timestamp: file.timestamp,
                    isHuddle: true
                });
            }
        }
    } catch (huddleErr) {
        console.error("[Slack] Error searching huddle files:", huddleErr.message);
    }
    
    // 2. Fetch Direct Mentions, Huddle Messages & Actionable Slack Search Results
    try {
        console.log("[Slack] Searching messages & huddle summaries mentioning Justin...");
        const searchRes = await client.search.messages({
            query: `to:me OR <@${JUSTIN_USER_ID}> OR ${JUSTIN_USERNAME} OR "huddle"`,
            sort: 'timestamp',
            sort_dir: 'desc',
            count: 30
        });
        
        for (const match of searchRes.messages?.matches || []) {
            const ts = parseFloat(match.ts);
            if (ts < minTime) continue;
            
            const msgId = `${match.channel?.id || match.channel?.name}_${match.ts}`;
            if (seenMessageIds.has(msgId)) continue;
            seenMessageIds.add(msgId);
            
            messages.push({
                channel: match.channel?.name || 'Slack',
                text: `[From @${match.username || 'user'} in #${match.channel?.name || 'chat'}]: ${match.text}`,
                timestamp: ts,
                isHuddle: (match.text || '').toLowerCase().includes('huddle')
            });
        }
    } catch (searchErr) {
        console.error("[Slack] Error searching messages:", searchErr.message);
    }
    
    // 3. Fetch Active Channels, DMs, MPDMs, and Huddle Threads Justin is in
    try {
        const convos = await client.users.conversations({
            types: 'public_channel,private_channel,im,mpim',
            limit: 25
        });
        
        for (const channel of convos.channels || []) {
            try {
                const hist = await client.conversations.history({
                    channel: channel.id,
                    oldest: minTime.toString(),
                    limit: 15
                });
                
                for (const msg of hist.messages || []) {
                    const ts = parseFloat(msg.ts);
                    const msgId = `${channel.id}_${msg.ts}`;
                    if (seenMessageIds.has(msgId)) continue;
                    seenMessageIds.add(msgId);
                    
                    const isHuddleMsg = msg.subtype === 'huddle_thread' || (msg.text || '').toLowerCase().includes('huddle') || (msg.files || []).some(f => (f.title || '').toLowerCase().includes('huddle'));
                    
                    if ((msg.type === 'message' && !msg.bot_id && msg.text) || isHuddleMsg) {
                        let text = msg.text || '';
                        
                        // Download any attached huddle canvas / summary files
                        if (msg.files && msg.files.length > 0) {
                            for (const f of msg.files) {
                                if (f.url_private_download) {
                                    const canvasContent = await downloadSlackCanvasText(f.url_private_download);
                                    if (canvasContent) {
                                        text += `\n[ATTACHED HUDDLE SUMMARY / CANVAS (${f.title || 'Notes'})]:\n${canvasContent}`;
                                    }
                                }
                            }
                        }

                        // Check thread replies if present (e.g. huddle thread notes & summaries)
                        if (msg.thread_ts && msg.reply_count && msg.reply_count > 0) {
                            try {
                                const replies = await client.conversations.replies({
                                    channel: channel.id,
                                    ts: msg.thread_ts
                                });
                                const threadParts = [];
                                for (const r of (replies.messages || []).slice(1)) {
                                    let replyStr = `@${r.user || 'User'}: ${r.text || ''}`;
                                    if (r.files && r.files.length > 0) {
                                        for (const rf of r.files) {
                                            if (rf.url_private_download) {
                                                const rCanvas = await downloadSlackCanvasText(rf.url_private_download);
                                                if (rCanvas) {
                                                    replyStr += `\n[HUDDLE SUMMARY]: ${rCanvas}`;
                                                }
                                            }
                                        }
                                    }
                                    threadParts.push(replyStr);
                                }
                                if (threadParts.length > 0) {
                                    text += `\n[THREAD REPLIES]:\n${threadParts.join('\n')}`;
                                }
                            } catch (e) {}
                        }
                        
                        if (text.trim()) {
                            messages.push({
                                channel: channel.name || 'Direct Message',
                                text: text,
                                timestamp: ts,
                                isHuddle: isHuddleMsg
                            });
                        }
                    }
                }
            } catch (chErr) {
                // Ignore individual channel history errors
            }
        }
    } catch (dmErr) {
        console.error("[Slack] Error checking conversations:", dmErr.message);
    }
    
    return messages;
}

async function sendSlackDM(text) {
    if (!process.env.SLACK_USER_TOKEN) return false;
    const client = new WebClient(process.env.SLACK_USER_TOKEN);
    try {
        const auth = await client.auth.test();
        await client.chat.postMessage({
            channel: auth.user_id,
            text: text
        });
        return true;
    } catch (e) {
        console.error("Failed to send Slack DM:", e.message);
        return false;
    }
}

// ---------------------------------------------------------------------------
// Staff recipient resolution + 1-tap approved Slack sends
// (sendSlackMessageToRecipient must ONLY be called by agent-worker after a
//  `slack_message` agent_job reaches status === 'approved'.)
// ---------------------------------------------------------------------------

const USERS_CACHE_TTL_MS = 15 * 60 * 1000;
let cachedSlackUsers = null;
let cachedSlackUsersAt = 0;

function loadTaggingPeople() {
    try {
        const rules = require('./tagging-rules.json');
        return Array.isArray(rules.people) ? rules.people : [];
    } catch (e) {
        return [];
    }
}

function normName(str) {
    return String(str || '').toLowerCase().replace(/^@/, '').replace(/[^a-z0-9\s.]/g, '').replace(/\s+/g, ' ').trim();
}

async function getSlackUsersCached(client) {
    const now = Date.now();
    if (cachedSlackUsers && now - cachedSlackUsersAt < USERS_CACHE_TTL_MS) {
        return cachedSlackUsers;
    }
    const members = [];
    let cursor;
    let pages = 0;
    do {
        const res = await client.users.list({ limit: 200, cursor });
        for (const m of res.members || []) {
            if (m.deleted || m.is_bot || m.id === 'USLACKBOT') continue;
            members.push(m);
        }
        cursor = res.response_metadata?.next_cursor || undefined;
        pages++;
    } while (cursor && pages < 10);
    cachedSlackUsers = members;
    cachedSlackUsersAt = now;
    return members;
}

function scoreMemberMatch(member, candidates) {
    const fields = [
        member.real_name,
        member.profile?.real_name,
        member.profile?.display_name,
        member.name,
    ].map(normName).filter(Boolean);

    let best = 0;
    for (const cand of candidates) {
        if (!cand) continue;
        for (const f of fields) {
            if (f === cand) best = Math.max(best, 100);
            else if (f.split(' ')[0] === cand) best = Math.max(best, 80);
            else if (f.split(/[\s.]/).includes(cand)) best = Math.max(best, 60);
            else if (cand.length >= 4 && f.includes(cand)) best = Math.max(best, 40);
        }
    }
    return best;
}

/**
 * Resolve a staff recipient ("Matt", "@jenn", "Casey Sexton") to a Slack user.
 * Returns { ok, userId, channelId, displayName, handle, error }.
 */
async function resolveSlackRecipient(query) {
    const raw = String(query || '').trim();
    if (!raw) return { ok: false, userId: null, channelId: null, displayName: '', handle: '', error: 'Empty recipient' };
    if (!process.env.SLACK_USER_TOKEN) {
        return { ok: false, userId: null, channelId: null, displayName: raw, handle: '', error: 'Missing SLACK_USER_TOKEN' };
    }

    const client = new WebClient(process.env.SLACK_USER_TOKEN);
    const q = normName(raw.replace(/^#/, ''));

    // Expand with tagging-rules.json people keywords (e.g. "matt" -> ["matt", "matthew"])
    const people = loadTaggingPeople();
    const person = people.find(p =>
        normName(p.tag) === q ||
        normName(p.label) === q ||
        (Array.isArray(p.keywords) && p.keywords.some(k => normName(k) === q))
    );
    const candidates = Array.from(new Set([
        q,
        ...(person ? [normName(person.label), normName(person.tag), ...(person.keywords || []).map(normName)] : []),
    ].filter(Boolean)));
    // Prefer full-name keywords (e.g. "casey sexton") first
    candidates.sort((a, b) => b.split(' ').length - a.split(' ').length);

    // 1. Primary: users.list (cached 15 min)
    try {
        const members = await getSlackUsersCached(client);
        let bestMember = null;
        let bestScore = 0;
        for (const m of members) {
            const s = scoreMemberMatch(m, candidates);
            if (s > bestScore) {
                bestScore = s;
                bestMember = m;
            }
        }
        if (bestMember && bestScore >= 60) {
            return {
                ok: true,
                userId: bestMember.id,
                channelId: null,
                displayName: bestMember.real_name || bestMember.profile?.real_name || bestMember.name,
                handle: bestMember.profile?.display_name || bestMember.name || '',
                error: null,
            };
        }
    } catch (e) {
        console.warn('[Slack] users.list unavailable, falling back to DM/search lookup:', e.data?.error || e.message);
    }

    // 2. Fallback: existing IM channels + search.messages usernames
    try {
        const ims = await client.users.conversations({ types: 'im', limit: 200 });
        for (const im of ims.channels || []) {
            if (!im.user) continue;
            try {
                const info = await client.users.info({ user: im.user });
                const u = info.user;
                if (u && scoreMemberMatch(u, candidates) >= 60) {
                    return {
                        ok: true,
                        userId: u.id,
                        channelId: im.id,
                        displayName: u.real_name || u.name,
                        handle: u.profile?.display_name || u.name || '',
                        error: null,
                    };
                }
            } catch (e) {
                // users.info may also lack scope; continue to search fallback
            }
        }
    } catch (e) {
        // ignore
    }

    try {
        for (const cand of candidates.slice(0, 3)) {
            const res = await client.search.messages({ query: `from:${cand.split(' ')[0]}`, count: 5 });
            for (const match of res.messages?.matches || []) {
                const uname = normName(match.username);
                if (match.user && candidates.some(c => uname === c || uname.startsWith(c.split(' ')[0]))) {
                    return {
                        ok: true,
                        userId: match.user,
                        channelId: null,
                        displayName: match.username,
                        handle: match.username,
                        error: null,
                    };
                }
            }
        }
    } catch (e) {
        // ignore
    }

    return {
        ok: false,
        userId: null,
        channelId: null,
        displayName: person?.label || raw,
        handle: '',
        error: `Could not resolve Slack user for "${raw}"`,
    };
}

/**
 * Send a Slack DM to a resolved staff recipient. Callers MUST only invoke this
 * for agent_jobs that Justin has explicitly approved (status === 'approved').
 */
async function sendSlackMessageToRecipient({ userId, channelId, recipientName, text } = {}) {
    if (!process.env.SLACK_USER_TOKEN) return { ok: false, error: 'Missing SLACK_USER_TOKEN' };
    const messageText = String(text || '').trim();
    if (!messageText) return { ok: false, error: 'Message text is empty' };

    const client = new WebClient(process.env.SLACK_USER_TOKEN);
    try {
        let targetUserId = userId || null;
        let channel = channelId || null;

        if (!channel && !targetUserId && recipientName) {
            const resolved = await resolveSlackRecipient(recipientName);
            if (!resolved.ok) return { ok: false, error: resolved.error };
            targetUserId = resolved.userId;
            channel = resolved.channelId;
        }

        if (!channel) {
            if (!targetUserId) return { ok: false, error: 'No Slack userId or channelId provided' };
            const opened = await client.conversations.open({ users: targetUserId });
            channel = opened.channel?.id;
            if (!channel) return { ok: false, error: 'Failed to open Slack DM channel' };
        }

        const posted = await client.chat.postMessage({ channel, text: messageText });
        return { ok: true, channel: posted.channel || channel, ts: posted.ts, userId: targetUserId };
    } catch (e) {
        return { ok: false, error: e.data?.error || e.message };
    }
}

module.exports = { getRecentSlackMessages, sendSlackDM, resolveSlackRecipient, sendSlackMessageToRecipient };
