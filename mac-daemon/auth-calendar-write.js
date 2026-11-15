const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { OAuth2Client } = require('google-auth-library');

const PORT = 3334;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const CRED_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token_2.json');
const STATE_PATH = path.join(__dirname, 'state.json');

const credentials = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
const { client_secret, client_id } = credentials.installed;
const oAuth2Client = new OAuth2Client(client_id, client_secret, REDIRECT_URI);

const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    login_hint: 'justin@turnninety.com',
    scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/calendar.events'
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

        if (fs.existsSync(STATE_PATH)) {
            try {
                const st = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
                delete st.calendarReauthWarned;
                fs.writeFileSync(STATE_PATH, JSON.stringify(st, null, 2));
            } catch (e) {}
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <html><body style="font-family:-apple-system,sans-serif;background:#111318;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
                <div style="text-align:center;max-width:440px;padding:32px;background:#171A23;border-radius:16px;border:1px solid rgba(255,255,255,0.1);">
                    <h2>justin@turnninety.com Calendar Connected!</h2>
                    <p style="color:#94a3b8;font-size:14px;">Two-way Google Calendar sync is now active. You can close this window.</p>
                </div>
            </body></html>
        `);

        console.log('[Google Calendar OAuth] Saved upgraded token_2.json with calendar.events write scope!');
        setTimeout(() => {
            server.close();
            process.exit(0);
        }, 500);
    } catch (err) {
        console.error('[Google Calendar OAuth] Error:', err.message);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`OAuth Error: ${err.message}`);
    }
});

server.listen(PORT, () => {
    console.log(`\nGoogle Calendar Write OAuth listening on http://localhost:${PORT}`);
    console.log(`Authorization URL:\n${authUrl}\n`);
    exec(`open "${authUrl}"`);
});
