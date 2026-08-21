const { WebClient } = require('@slack/web-api');
require('dotenv').config();

async function getRecentSlackMessages() {
    if (!process.env.SLACK_USER_TOKEN) {
        console.error("Missing SLACK_USER_TOKEN");
        return [];
    }
    
    const client = new WebClient(process.env.SLACK_USER_TOKEN);
    const messages = [];
    
    try {
        const result = await client.conversations.list({ types: 'public_channel,private_channel,im,mpim' });
        
        for (const channel of result.channels || []) {
            try {
                const history = await client.conversations.history({
                    channel: channel.id,
                    limit: 20
                });
                
                // Get messages from the last 24 hours
                const yesterday = Date.now() / 1000 - (24 * 60 * 60);
                
                for (const msg of history.messages || []) {
                    if (msg.ts > yesterday && !msg.bot_id && msg.type === 'message') {
                        messages.push({
                            channel: channel.name || 'DM',
                            text: msg.text,
                            timestamp: msg.ts
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
