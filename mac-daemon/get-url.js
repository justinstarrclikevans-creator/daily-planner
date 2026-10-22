const { google } = require('googleapis');
const fs = require('fs');
const credentials = JSON.parse(fs.readFileSync('credentials.json'));
const {client_secret, client_id, redirect_uris} = credentials.installed;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/calendar.readonly'],
    prompt: 'consent' // Force consent to ensure we get a refresh token!
});
console.log(authUrl);
