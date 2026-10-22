const { WebClient } = require('@slack/web-api');
require('dotenv').config();

async function searchDaisy() {
    if (!process.env.SLACK_BOT_TOKEN && !process.env.SLACK_USER_TOKEN) {
        console.error("No Slack token found.");
        return;
    }
    
    // We might need to use a user token for search.messages
    const client = new WebClient(process.env.SLACK_USER_TOKEN || process.env.SLACK_BOT_TOKEN);
    
    try {
        const response = await client.search.messages({
            query: 'Daisy',
            sort: 'timestamp',
            sort_dir: 'desc',
            count: 30
        });
        
        if (response.messages && response.messages.matches) {
            console.log("Found matches:");
            for (const msg of response.messages.matches) {
                console.log(`- [@${msg.username} in #${msg.channel.name}]: ${msg.text}`);
            }
        } else {
            console.log("No messages found.");
        }
    } catch (e) {
        console.error("Error searching Slack:", e.message);
    }
}
searchDaisy();
