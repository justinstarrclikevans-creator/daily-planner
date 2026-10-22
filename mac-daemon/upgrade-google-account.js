const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');

fs.readFile('credentials.json', (err, content) => {
    if (err) return console.log('Error loading client secret file:', err);
    authorize(JSON.parse(content));
});

function authorize(credentials) {
    const {client_secret, client_id, redirect_uris} = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/calendar.readonly',
            'https://www.googleapis.com/auth/tasks'
        ],
    });
    console.log('--- UPGRADE TO GOOGLE TASKS ---');
    console.log('Authorize this app by visiting this url:\n');
    console.log(authUrl);
    console.log('\nOnce you authorize the account, you will be redirected to localhost (which will fail). Just copy the "code=" parameter from the URL you are redirected to.\n');
    
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    rl.question('Enter the code from that page here: ', (code) => {
        rl.close();
        oAuth2Client.getToken(decodeURIComponent(code), (err, token) => {
            if (err) return console.error('Error retrieving access token', err);
            
            // Overwrite the primary token.json
            fs.writeFile('token.json', JSON.stringify(token), (err) => {
                if (err) return console.error(err);
                console.log('Token stored to token.json');
                console.log('Success! Your primary Google account now has Tasks permissions.');
            });
        });
    });
}
