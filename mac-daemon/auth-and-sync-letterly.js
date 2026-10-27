const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { getRecentLetterlyNotes } = require('./letterly');
const { extractTodos } = require('./ai');
const { getIncompleteReminders, addReminder } = require('./reminders');

const PORT = 3333;
const CLIENT_ID = 'dea0b3e2-946f-4589-9bc3-6902afdf3c8c';
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const OAUTH_TOKENS_PATH = '/Users/justinevans/.gemini/antigravity/mcp_oauth_tokens.json';

const verifier = crypto.randomBytes(32).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

const authUrl = 'https://api.letterly.app/authorize?' + new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'notes:read notes:write',
    code_challenge: challenge,
    code_challenge_method: 'S256'
});

async function processRecordings() {
    console.log("\n=======================================================");
    console.log("Fetching Letterly recordings from last week...");
    console.log("=======================================================\n");

    // Look back 14 days to capture everything from last week
    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const notes = await getRecentLetterlyNotes(fourteenDaysAgo);

    console.log(`Found ${notes.length} Letterly recordings from the last 14 days.`);
    if (notes.length === 0) {
        console.log("No recordings found in the last 14 days.");
        return;
    }

    notes.forEach((n, idx) => {
        console.log(`[${idx + 1}] "${n.title}" (${new Date(n.timestamp).toLocaleDateString()})`);
        console.log(`    Content Preview: ${(n.content || '').substring(0, 120)}...`);
    });

    console.log("\nChecking existing Apple Reminders to avoid duplicates...");
    const existingTodos = await getIncompleteReminders();

    console.log("\nRunning Gemini AI extraction on Letterly recordings...");
    const extracted = await extractTodos([], [], [], existingTodos, notes);

    console.log(`\nGemini extracted ${extracted.length} tasks/ideas to sync:`);
    for (const item of extracted) {
        console.log(`\n-> [${item.listName}] ${item.title} (⏱ ${item.estimatedMinutes || 5}m)`);
        if (item.subtasks && item.subtasks.length > 0) {
            item.subtasks.forEach(s => console.log(`   - ${s}`));
        }

        // Build description with time estimate and subtasks
        const subtaskChecklist = (item.subtasks || []).map(s => `- [ ] ${s}`).join('\n');
        const notesBody = [
            `[⏱ ${item.estimatedMinutes || 5}m]`,
            item.description || '',
            subtaskChecklist
        ].filter(Boolean).join('\n\n');

        const success = await addReminder(item.listName, item.title, notesBody);
        if (success) {
            console.log(`   ✓ Added to Apple Reminders under '${item.listName}'`);
        } else {
            console.log(`   ✗ Failed to add to Apple Reminders`);
        }

        // Also sync to Supabase if configured
        if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
            try {
                await fetch(`${process.env.SUPABASE_URL}/rest/v1/tasks`, {
                    method: 'POST',
                    headers: {
                        'apikey': process.env.SUPABASE_KEY,
                        'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'return=representation'
                    },
                    body: JSON.stringify({
                        title: item.title,
                        description: notesBody,
                        list_name: item.listName,
                        status: 'pending',
                        source: 'letterly',
                        created_at: new Date().toISOString()
                    })
                });
            } catch (e) {
                // Ignore supabase error
            }
        }
    }

    console.log("\n=======================================================");
    console.log("✓ All Letterly recordings processed and synced!");
    console.log("=======================================================\n");
}

const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
    if (reqUrl.pathname === '/callback') {
        const code = reqUrl.searchParams.get('code');
        if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end('<h3>Error: Missing authorization code from Letterly.</h3>');
            return;
        }

        console.log("[OAuth Callback] Received authorization code. Exchanging for token...");

        try {
            const tokenParams = new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: CLIENT_ID,
                code: code,
                redirect_uri: REDIRECT_URI,
                code_verifier: verifier
            });

            const tokenResp = await fetch('https://api.letterly.app/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: tokenParams.toString()
            });

            if (!tokenResp.ok) {
                const errBody = await tokenResp.text();
                throw new Error(`Token exchange failed (${tokenResp.status}): ${errBody}`);
            }

            const tokenData = await tokenResp.json();
            console.log("[OAuth Callback] Successfully acquired OAuth token!");

            // Save token to mcp_oauth_tokens.json
            let allTokens = {};
            if (fs.existsSync(OAUTH_TOKENS_PATH)) {
                try {
                    allTokens = JSON.parse(fs.readFileSync(OAUTH_TOKENS_PATH, 'utf8'));
                } catch (e) {}
            }

            allTokens['https://mcp.letterly.app/mcp'] = {
                token: {
                    access_token: tokenData.access_token,
                    refresh_token: tokenData.refresh_token,
                    expiry: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString()
                },
                client_id: CLIENT_ID,
                token_url: 'https://api.letterly.app/token'
            };

            fs.writeFileSync(OAUTH_TOKENS_PATH, JSON.stringify(allTokens, null, 2));
            console.log(`[OAuth Callback] Saved token to ${OAUTH_TOKENS_PATH}`);

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
                <html>
                <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: white;">
                    <div style="text-align: center; max-width: 480px; padding: 40px; background: #1e293b; border-radius: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
                        <div style="font-size: 54px; margin-bottom: 16px;">🎙️</div>
                        <h2 style="margin: 0 0 10px 0;">Letterly Connected!</h2>
                        <p style="color: #94a3b8; font-size: 15px; line-height: 1.5;">Your account is authorized. We are now processing your voice recordings from last week and syncing tasks directly to Apple Reminders.</p>
                        <p style="color: #64748b; font-size: 13px; margin-top: 24px;">You can safely close this browser window.</p>
                    </div>
                </body>
                </html>
            `);

            // Run processing in background and then close server
            setTimeout(async () => {
                try {
                    await processRecordings();
                } catch (err) {
                    console.error("Processing error:", err);
                } finally {
                    server.close();
                    process.exit(0);
                }
            }, 500);

        } catch (err) {
            console.error("[OAuth Callback] Error:", err.message);
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(`<h3>OAuth Error: ${err.message}</h3>`);
        }
    } else {
        res.writeHead(404);
        res.end();
    }
});

server.listen(PORT, () => {
    console.log(`\n=======================================================`);
    console.log(`Letterly OAuth Server listening on http://localhost:${PORT}`);
    console.log(`Opening browser to login and grant access to Letterly...`);
    console.log(`Authorization URL:\n${authUrl}`);
    console.log(`=======================================================\n`);

    exec(`open "${authUrl}"`, (err) => {
        if (err) {
            console.log(`Could not automatically open browser. Please visit the URL above manually.`);
        }
    });
});
