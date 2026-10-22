const { google } = require('googleapis');
const fs = require('fs');

const code = "4/0ATsMZqDVNvR9MmW6tJjkZJB5KcVmlYe4wiahqYjFsLJqJACxV0Fj1x-n7lL1zTz_cde19w";
const credentials = JSON.parse(fs.readFileSync('credentials.json'));
const {client_secret, client_id, redirect_uris} = credentials.installed;

const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

oAuth2Client.getToken(decodeURIComponent(code), (err, token) => {
    if (err) return console.error('Error retrieving access token', err);
    
    fs.writeFileSync('token_2.json', JSON.stringify(token));
    console.log('Token stored to token_2.json');
    
    // Test the token
    oAuth2Client.setCredentials(token);
    const gmail = google.gmail({version: 'v1', auth: oAuth2Client});
    gmail.users.getProfile({ userId: 'me' }).then(profile => {
        console.log(`Successfully logged in as: ${profile.data.emailAddress}`);
    }).catch(e => {
        console.error("Failed to fetch profile:", e.message);
    });
});
