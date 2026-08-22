const { WebClient } = require('@slack/web-api');
require('dotenv').config();

async function getRecentSlackMessages(sinceTimestamp) {
    if (!process.env.SLACK_USER_TOKEN) {
        console.error("Missing SLACK_USER_TOKEN");
        return [];
    }
    
    const client = new WebClient(process.env.SLACK_USER_TOKEN);
    const messages = [];
    
    try {
        const result = await client.conversations.list({ types: 'public_channel,private_channel,im,mpim' });
        
        // Default to 7 days ago if sinceTimestamp is not provided
        const minTime = sinceTimestamp ? sinceTimestamp : (Date.now() / 1000 - (7 * 24 * 60 * 60));
        
        for (const channel of result.channels || []) {
            try {
                const history = await client.conversations.history({
                    channel: channel.id,
                    oldest: minTime.toString()
                });
                
                for (const msg of history.messages || []) {
                    if (!msg.bot_id && (msg.type === 'message' || msg.subtype === 'huddle_thread')) {
                        let text = msg.text || '';
                        
                        // If it's a thread (like a huddle transcript), fetch the replies
                        if (msg.thread_ts) {
                            try {
                                const replies = await client.conversations.replies({
                                    channel: channel.id,
                                    ts: msg.thread_ts
                                });
                                const threadText = replies.messages.map(r => r.text).join('\n');
                                text += `\n[THREAD/HUDDLE]: ${threadText}`;
                            } catch (e) {
                                // Ignore thread fetch errors
                            }
                        }

                        messages.push({
                            channel: channel.name || 'DM',
                            text: text,
                            timestamp: parseFloat(msg.ts)
                        });
                    }
                }
            } catch (err) {
                // Ignore channels we don't have access to read
            }
        }
    } catch (e) {
        console.error("Failed to read Slack:", e);
    }
    return messages;
}

module.exports = { getRecentSlackMessages };
