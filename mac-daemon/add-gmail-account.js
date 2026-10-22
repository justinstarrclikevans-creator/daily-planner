const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');

// Load client secrets from a local file.
fs.readFile('credentials.json', (err, content) => {
    if (err) return console.log('Error loading client secret file:', err);
    // Authorize a client with credentials, then call the Google Drive API.
    authorize(JSON.parse(content));
});

function authorize(credentials) {
    const {client_secret, client_id, redirect_uris} = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    getAccessToken(oAuth2Client);
}

function getAccessToken(oAuth2Client) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/calendar.readonly'],
    });
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
            
            // Find next available token filename
            let index = 2;
            let tokenPath = `token_${index}.json`;
            while(fs.existsSync(tokenPath)) {
                index++;
                tokenPath = `token_${index}.json`;
            }
            
            fs.writeFile(tokenPath, JSON.stringify(token), (err) => {
                if (err) return console.error(err);
                console.log('Token stored to', tokenPath);
                console.log('Success! Your new Gmail account has been linked.');
            });
        });
    });
}
