const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

async function test() {
    const content = fs.readFileSync('credentials.json');
    const credentials = JSON.parse(content);
    const {client_secret, client_id, redirect_uris} = credentials.installed;
    
    const token = JSON.parse(fs.readFileSync('token.json', 'utf8'));
    console.log("Token scopes:", token.scope);
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    oAuth2Client.setCredentials(token);
    const tasks = google.tasks({ version: 'v1', auth: oAuth2Client });
    
    try {
        const res = await tasks.tasks.insert({
            tasklist: '@default',
            requestBody: { title: "Test task" }
        });
        console.log("Inserted:", res.data);
    } catch (e) {
        console.error("Error details:", e);
    }
}
test();
