const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

async function checkAccounts() {
    const credentials = JSON.parse(fs.readFileSync('credentials.json'));
    const {client_secret, client_id, redirect_uris} = credentials.installed;
    
    const files = fs.readdirSync(__dirname).filter(f => f.startsWith('token') && f.endsWith('.json'));
    
    for (const tFile of files) {
        try {
            const token = JSON.parse(fs.readFileSync(path.join(__dirname, tFile), 'utf8'));
            const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
            oAuth2Client.setCredentials(token);
            
            const oauth2 = google.oauth2({
                auth: oAuth2Client,
                version: 'v2'
            });
            const userInfo = await oauth2.userinfo.get();
            console.log(`${tFile}: ${userInfo.data.email}`);
        } catch (e) {
            console.error(`Failed on ${tFile}:`, e.message);
        }
    }
}
checkAccounts();
