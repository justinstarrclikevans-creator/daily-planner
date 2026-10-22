const fs = require('fs');
const { google } = require('googleapis');

const code = process.argv[2];
if (!code) {
    console.error("Please provide the authorization code or full redirect URL as an argument.");
    process.exit(1);
}

// Extract code if full URL was pasted
let cleanCode = code;
if (code.includes('code=')) {
    const match = code.match(/code=([^&]+)/);
    if (match) cleanCode = match[1];
}
cleanCode = decodeURIComponent(cleanCode);

fs.readFile('credentials.json', (err, content) => {
    if (err) return console.error('Error loading credentials.json:', err);
    const credentials = JSON.parse(content);
    const {client_secret, client_id, redirect_uris} = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    
    const targetFile = process.argv[3] || (fs.existsSync('token.json') ? 'token_2.json' : 'token.json');
    oAuth2Client.getToken(cleanCode, (err, token) => {
        if (err) return console.error('Error retrieving access token:', err);
        fs.writeFileSync(targetFile, JSON.stringify(token, null, 2));
        console.log(`Successfully saved token to ${targetFile}!`);
    });
});
