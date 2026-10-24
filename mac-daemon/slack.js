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
        return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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

module.exports = { getRecentSlackMessages, sendSlackDM };
