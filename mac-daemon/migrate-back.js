const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { addReminder } = require('./reminders');

async function migrateTasks() {
    console.log("Loading credentials...");
    const credentials = JSON.parse(fs.readFileSync('credentials.json'));
    const {client_secret, client_id, redirect_uris} = credentials.installed;
    
    const token = JSON.parse(fs.readFileSync('token.json', 'utf8'));
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    oAuth2Client.setCredentials(token);
    
    const service = google.tasks({ version: 'v1', auth: oAuth2Client });
    
    try {
        console.log("Fetching task lists...");
        const listRes = await service.tasklists.list();
        const lists = listRes.data.items || [];
        
        let totalCount = 0;
        
        for (const l of lists) {
            console.log(`Fetching tasks for list: ${l.title}`);
            const res = await service.tasks.list({
                tasklist: l.id,
                showCompleted: false
            });
            const items = res.data.items || [];
            
            for (const t of items) {
                console.log(`Migrating: ${t.title}`);
                await addReminder(l.title, t.title, t.notes || "");
                totalCount++;
            }
        }
        
        console.log(`Successfully migrated ${totalCount} tasks back to Apple Reminders!`);
    } catch (e) {
        console.error("Migration error:", e);
    }
}

migrateTasks();
