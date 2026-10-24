const fs = require('fs');
const path = require('path');

const MCP_URL = 'https://mcp.letterly.app/mcp';
const OAUTH_TOKENS_PATH = '/Users/justinevans/.gemini/antigravity/mcp_oauth_tokens.json';

async function getValidAccessToken() {
    if (!fs.existsSync(OAUTH_TOKENS_PATH)) {
        console.error('[Letterly MCP] Missing mcp_oauth_tokens.json');
        return null;
    }

    const raw = JSON.parse(fs.readFileSync(OAUTH_TOKENS_PATH, 'utf8'));
    const entry = raw[MCP_URL];
    if (!entry || !entry.token || !entry.token.access_token) {
        console.error('[Letterly MCP] No token found for', MCP_URL);
        return null;
    }

    // Check if token is near expiry and refresh if needed
    if (entry.token.expiry) {
        const expiryTime = new Date(entry.token.expiry).getTime();
        if (!isNaN(expiryTime) && Date.now() > expiryTime - 60000 && entry.token.refresh_token && entry.token_url) {
            try {
                const params = new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: entry.token.refresh_token,
                    client_id: entry.client_id || ''
                });
                const resp = await fetch(entry.token_url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params.toString()
                });
                if (resp.ok) {
                    const refreshed = await resp.json();
                    entry.token.access_token = refreshed.access_token || entry.token.access_token;
                    if (refreshed.refresh_token) entry.token.refresh_token = refreshed.refresh_token;
                    if (refreshed.expires_in) {
                        entry.token.expiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
                    }
                    fs.writeFileSync(OAUTH_TOKENS_PATH, JSON.stringify(raw, null, 2));
                    console.log('[Letterly MCP] Refreshed OAuth access token.');
                }
            } catch (err) {
                console.error('[Letterly MCP] Token refresh warning:', err.message);
            }
        }
    }

    return entry.token.access_token;
}

async function callLetterlyMCPTool(toolName, args = {}) {
    const accessToken = await getValidAccessToken();
    if (!accessToken) return null;

    const resp = await fetch(MCP_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream'
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/call',
            params: {
                name: toolName,
                arguments: args
            }
        })
    });

    if (!resp.ok) {
        throw new Error(`Letterly MCP HTTP ${resp.status}`);
    }

    const text = await resp.text();
    // Parse SSE or JSON response
    const dataLines = text.split('\n').filter(line => line.startsWith('data: '));
    for (const line of dataLines) {
        const jsonStr = line.replace(/^data:\s*/, '').trim();
        try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.result?.content) {
                return parsed.result.content.map(c => c.text || '').join('\n');
            }
        } catch (e) {}
    }

    try {
        const parsed = JSON.parse(text);
        if (parsed.result?.content) {
            return parsed.result.content.map(c => c.text || '').join('\n');
        }
    } catch (e) {}

    return null;
}

function parseListNotesOutput(rawText) {
    if (!rawText) return [];
    const notes = [];
    const blocks = rawText.split(/\n(?=Note #\d+:)/);
    for (const block of blocks) {
        const headerMatch = block.match(/^Note #(\d+):\s*(.+)/);
        if (!headerMatch) continue;
        const id = parseInt(headerMatch[1], 10);
        const title = headerMatch[2].trim();
        const createdMatch = block.match(/Created:\s*(\d+)/);
        const updatedMatch = block.match(/Updated:\s*(\d+)/);
        const created = createdMatch ? parseInt(createdMatch[1], 10) : 0;
        const updated = updatedMatch ? parseInt(updatedMatch[1], 10) : created;
        notes.push({
            id,
            title,
            created,
            updated,
            preview: block
        });
    }
    return notes;
}

async function getRecentLetterlyNotes(sinceTimestamp = 0) {
    try {
        console.log('[Letterly MCP] Checking recent recordings via MCP...');
        const rawList = await callLetterlyMCPTool('list_notes', { page: 1, page_size: 15 });
        const parsedList = parseListNotesOutput(rawList);
        const minTime = sinceTimestamp || (Date.now() - 24 * 60 * 60 * 1000);

        const recentNotes = parsedList.filter(n => Math.max(n.created, n.updated) > minTime);
        if (recentNotes.length === 0) {
            return [];
        }

        const fullNotes = [];
        for (const item of recentNotes) {
            try {
                const fullText = await callLetterlyMCPTool('get_note', { note_id: item.id, offset: 0 });
                fullNotes.push({
                    id: item.id,
                    title: item.title,
                    timestamp: Math.max(item.created, item.updated),
                    content: fullText || item.preview
                });
            } catch (err) {
                console.error(`[Letterly MCP] Error fetching full note #${item.id}:`, err.message);
                fullNotes.push({
                    id: item.id,
                    title: item.title,
                    timestamp: Math.max(item.created, item.updated),
                    content: item.preview
                });
            }
        }
        return fullNotes;
    } catch (err) {
        console.error('[Letterly MCP] Failed to fetch Letterly notes:', err.message);
        return [];
    }
}

module.exports = {
    getRecentLetterlyNotes,
    callLetterlyMCPTool
};
