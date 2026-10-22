const { google } = require('googleapis');
const fs = require('fs');

const code = "AQ.Ab8RN6IcCg0ZHzgemvtrQ-8oyseoCX5QSMOxKBT_aCyMXrHd6w";
const credentials = JSON.parse(fs.readFileSync('credentials.json'));
const {client_secret, client_id, redirect_uris} = credentials.installed;

const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

oAuth2Client.getToken(decodeURIComponent(code), async (err, token) => {
    if (err) {
        console.error('Error retrieving access token:', err);
        return;
    }
    
    try {
        oAuth2Client.setCredentials(token);
        const gmail = google.gmail({version: 'v1', auth: oAuth2Client});
        const profile = await gmail.users.getProfile({ userId: 'me' });
        const email = profile.data.emailAddress;
        
        console.log(`Successfully logged in as: ${email}`);
        
        // Find next token slot
        let i = 2;
        let tokenFile = 'token.json';
        while (fs.existsSync(tokenFile)) {
            tokenFile = `token_${i}.json`;
            i++;
        }
        
        fs.writeFileSync(tokenFile, JSON.stringify(token));
        console.log(`Saved token to ${tokenFile}`);
        
    } catch (e) {
        console.error("Failed to fetch profile:", e.message);
    }
});
