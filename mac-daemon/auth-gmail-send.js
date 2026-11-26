const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { OAuth2Client } = require('google-auth-library');

const PORT = 3335;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const CRED_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token_gmail_send.json');

if (!fs.existsSync(CRED_PATH)) {
    console.error(`Missing Google credentials.json at ${CRED_PATH}`);
    process.exit(1);
}

const credentials = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
const { client_secret, client_id } = credentials.installed;
const oAuth2Client = new OAuth2Client(client_id, client_secret, REDIRECT_URI);

const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.compose',
        'https://www.googleapis.com/auth/gmail.readonly'
    ]
});

const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
    if (reqUrl.pathname !== '/callback') {
        res.writeHead(404);
        return res.end('Not found');
    }

    const code = reqUrl.searchParams.get('code');
    if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Missing authorization code');
    }

    try {
        const { tokens } = await oAuth2Client.getToken(code);
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <html><body style="font-family:-apple-system,sans-serif;background:#111318;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
                <div style="text-align:center;max-width:460px;padding:32px;background:#171A23;border-radius:16px;border:1px solid rgba(255,255,255,0.1);">
                    <h2 style="margin-top:0;">Gmail Auto-Send Connected!</h2>
                    <p style="color:#94a3b8;font-size:14px;line-height:1.5;">
                        Saved OAuth credentials to <code>token_gmail_send.json</code>. Approved outreach emails in ToDo Webapp AI CEO will now send automatically via Gmail. You can close this window.
                    </p>
                </div>
            </body></html>
        `);

        console.log('[Gmail Send OAuth] Saved token_gmail_send.json with gmail.send + gmail.compose + gmail.readonly scopes!');
        setTimeout(() => {
            server.close();
            process.exit(0);
        }, 500);
    } catch (err) {
        console.error('[Gmail Send OAuth] Error:', err.message);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`OAuth Error: ${err.message}`);
    }
});

server.listen(PORT, () => {
    console.log(`\nGmail Auto-Send OAuth listening on http://localhost:${PORT}`);
    console.log(`Authorization URL:\n${authUrl}\n`);
    exec(`open "${authUrl}"`);
});
