const { WebClient } = require('@slack/web-api');
require('dotenv').config();

const JUSTIN_USER_ID = 'U02AGGN2E1Z';
const JUSTIN_USERNAME = 'jevans';

async function getRecentSlackMessages(sinceTimestamp) {
    if (!process.env.SLACK_USER_TOKEN) {
        console.error("Missing SLACK_USER_TOKEN");
        return [];
    }
    
    const client = new WebClient(process.env.SLACK_USER_TOKEN);
    const messages = [];
    const seenMessageIds = new Set();
    
    // Default to 3 days ago if sinceTimestamp is not provided
    const minTime = sinceTimestamp ? sinceTimestamp : (Date.now() / 1000 - (3 * 24 * 60 * 60));
    
    // 1. Fetch Huddle Notes & AI Canvases (High Priority for Team Action Items)
    try {
        console.log("[Slack] Searching recent Huddle notes & canvases...");
        const huddleFilesRes = await client.search.files({
            query: '"Huddle notes"',
            sort: 'timestamp',
            sort_dir: 'desc',
            count: 15
        });
        
        for (const file of huddleFilesRes.files?.matches || []) {
            if (file.timestamp < minTime) continue;
            if (!file.url_private_download) continue;
            
            try {
                const resp = await fetch(file.url_private_download, {
                    headers: { 'Authorization': `Bearer ${process.env.SLACK_USER_TOKEN}` }
                });
                
                if (resp.ok) {
                    const html = await resp.text();
                    const cleanText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                    
                    // Check if Justin participated, was tagged, or was assigned action items
                    const isJustinInvolved = cleanText.includes(JUSTIN_USER_ID) || 
                                             cleanText.includes(JUSTIN_USERNAME) || 
                                             cleanText.toLowerCase().includes('justin');
                    
                    if (isJustinInvolved) {
                        console.log(`[Slack] Found relevant Huddle canvas: ${file.title}`);
                        messages.push({
                            channel: `Huddle: ${file.title}`,
                            text: `[SLACK HUDDLE NOTES & ACTION ITEMS]\nHuddle Title: ${file.title}\nDate: ${new Date(file.timestamp * 1000).toLocaleString()}\nJustin Evans Attended/Involved: YES\n\nContent:\n${cleanText}`,
                            timestamp: file.timestamp,
                            isHuddle: true
                        });
                    }
                }
            } catch (dlErr) {
                console.error(`[Slack] Error downloading canvas for ${file.title}:`, dlErr.message);
            }
        }
    } catch (huddleErr) {
        console.error("[Slack] Error searching huddle files:", huddleErr.message);
    }
    
    // 2. Fetch Direct Mentions & Actionable Slack Search Results
    try {
        console.log("[Slack] Searching messages mentioning or addressed to Justin...");
        const searchRes = await client.search.messages({
            query: `to:me OR <@${JUSTIN_USER_ID}> OR ${JUSTIN_USERNAME}`,
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
                isHuddle: false
            });
        }
    } catch (searchErr) {
        console.error("[Slack] Error searching messages:", searchErr.message);
    }
    
    // 3. Fetch Top Active DMs and MPDMs
    try {
        const convos = await client.users.conversations({
            types: 'im,mpim',
            limit: 12
        });
        
        for (const channel of convos.channels || []) {
            try {
                const hist = await client.conversations.history({
                    channel: channel.id,
                    oldest: minTime.toString(),
                    limit: 10
                });
                
                for (const msg of hist.messages || []) {
                    const ts = parseFloat(msg.ts);
                    const msgId = `${channel.id}_${msg.ts}`;
                    if (seenMessageIds.has(msgId)) continue;
                    seenMessageIds.add(msgId);
                    
                    if (msg.type === 'message' && !msg.bot_id && msg.text) {
                        let text = msg.text;
                        
                        // Check thread replies if present
                        if (msg.thread_ts && msg.reply_count && msg.reply_count > 0) {
                            try {
                                const replies = await client.conversations.replies({
                                    channel: channel.id,
                                    ts: msg.thread_ts
                                });
                                const threadText = (replies.messages || [])
                                    .slice(1) // skip root
                                    .map(r => `@${r.user || 'User'}: ${r.text || ''}`)
                                    .join('\n');
                                if (threadText) {
                                    text += `\n[THREAD REPLIES]:\n${threadText}`;
                                }
                            } catch (e) {}
                        }
                        
                        messages.push({
                            channel: channel.name || 'Direct Message',
                            text: text,
                            timestamp: ts,
                            isHuddle: false
                        });
                    }
                }
            } catch (chErr) {
                // Ignore individual channel history errors
            }
        }
    } catch (dmErr) {
        console.error("[Slack] Error checking DMs:", dmErr.message);
    }
    
    return messages;
}

module.exports = { getRecentSlackMessages };

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
        console.error("Failed to send Slack DM. You probably need to add 'chat:write' scope to your Slack app's User Token Scopes and reinstall the app.");
        console.error(e.message);
        return false;
    }
}
module.exports.sendSlackDM = sendSlackDM;
