const { google } = require('googleapis');
const fs = require('fs');

async function checkTurn90() {
    const credentials = JSON.parse(fs.readFileSync('credentials.json'));
    const {client_secret, client_id, redirect_uris} = credentials.installed;
    const token = JSON.parse(fs.readFileSync('token_2.json', 'utf8'));
    
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    oAuth2Client.setCredentials(token);
    
    const gmail = google.gmail({version: 'v1', auth: oAuth2Client});
    const res = await gmail.users.messages.list({
        userId: 'me',
        q: 'is:unread',
        maxResults: 10,
    });
    
    const messages = res.data.messages || [];
    console.log("Unread Turn90 emails:", messages.length);
    for (const msg of messages) {
        const msgData = await gmail.users.messages.get({ userId: 'me', id: msg.id });
        const headers = msgData.data.payload.headers;
        const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
        const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
        console.log(`- ${from}: ${subject}`);
    }
}
checkTurn90();
