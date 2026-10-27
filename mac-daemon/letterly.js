const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const MCP_URL = 'https://mcp.letterly.app/mcp';
const OAUTH_TOKENS_PATH = '/Users/justinevans/.gemini/antigravity/mcp_oauth_tokens.json';

async function getValidAccessToken() {
    // 1. Check environment variable first
    if (process.env.LETTERLY_ACCESS_TOKEN && process.env.LETTERLY_ACCESS_TOKEN.trim()) {
        return process.env.LETTERLY_ACCESS_TOKEN.trim();
    }

    // 2. Check mcp_oauth_tokens.json
    if (!fs.existsSync(OAUTH_TOKENS_PATH)) {
        console.error('[Letterly MCP] Missing mcp_oauth_tokens.json and no LETTERLY_ACCESS_TOKEN in .env');
        return null;
    }

    try {
        const raw = JSON.parse(fs.readFileSync(OAUTH_TOKENS_PATH, 'utf8'));
        const entry = raw[MCP_URL] || raw['letterly'];
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
    } catch (e) {
        console.error('[Letterly MCP] Error reading token file:', e.message);
        return null;
    }
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

function parseTimestamp(rawDateStr) {
    if (!rawDateStr) return 0;
    const str = String(rawDateStr).trim();
    // Check if numeric unix timestamp
    if (/^\d{10,13}$/.test(str)) {
        let num = parseInt(str, 10);
        if (num < 10000000000) num *= 1000;
        return num;
    }
    const parsed = Date.parse(str);
    return isNaN(parsed) ? 0 : parsed;
}

function parseListNotesOutput(rawText) {
    if (!rawText) return [];
    
    // First, check if rawText is JSON
    try {
        const parsed = JSON.parse(rawText);
        const list = Array.isArray(parsed) ? parsed : (parsed.notes || parsed.items || []);
        if (Array.isArray(list) && list.length > 0) {
            return list.map(item => ({
                id: item.id || item.note_id,
                title: item.title || item.name || `Note #${item.id}`,
                created: parseTimestamp(item.created_at || item.created),
                updated: parseTimestamp(item.updated_at || item.updated || item.created_at),
                preview: item.transcription || item.content || item.preview || JSON.stringify(item)
            }));
        }
    } catch (e) {}

    // Fallback: parse text blocks
    const notes = [];
    const blocks = rawText.split(/\n(?=Note\s*#?\d+:)/i);
    for (const block of blocks) {
        const headerMatch = block.match(/Note\s*#?(\d+):\s*(.+)/i);
        if (!headerMatch) continue;
        const id = parseInt(headerMatch[1], 10);
        const title = headerMatch[2].trim();
        const createdMatch = block.match(/Created:\s*([^\n]+)/i);
        const updatedMatch = block.match(/Updated:\s*([^\n]+)/i);
        const created = createdMatch ? parseTimestamp(createdMatch[1]) : 0;
        const updated = updatedMatch ? parseTimestamp(updatedMatch[1]) : created;
        notes.push({
            id,
            title,
            created: created || Date.now(),
            updated: updated || created || Date.now(),
            preview: block
        });
    }
    return notes;
}

async function getRecentLetterlyNotes(sinceTimestamp = 0) {
    try {
        console.log('[Letterly MCP] Checking recent recordings via MCP...');
        const rawList = await callLetterlyMCPTool('list_notes', { page: 1, page_size: 20 });
        if (!rawList) {
            console.log('[Letterly MCP] No response returned from list_notes.');
            return [];
        }
        
        const parsedList = parseListNotesOutput(rawList);
        console.log(`[Letterly MCP] Retrieved ${parsedList.length} total notes from account.`);
        
        // Default to looking back 14 days if sinceTimestamp is 0, to make sure recent recordings are included
        const minTime = sinceTimestamp || (Date.now() - 14 * 24 * 60 * 60 * 1000);

        const recentNotes = parsedList.filter(n => Math.max(n.created, n.updated) >= minTime);
        if (recentNotes.length === 0) {
            console.log(`[Letterly MCP] 0 notes newer than timestamp ${new Date(minTime).toLocaleString()}.`);
            return [];
        }

        console.log(`[Letterly MCP] Found ${recentNotes.length} notes matching time window.`);
        const fullNotes = [];
        for (const item of recentNotes) {
            try {
                const fullText = await callLetterlyMCPTool('get_note', { note_id: item.id, offset: 0 });
                let content = item.preview;
                if (fullText && !fullText.toLowerCase().includes('rate limit') && !fullText.toLowerCase().startsWith('error')) {
                    content = fullText;
                }
                fullNotes.push({
                    id: item.id,
                    title: item.title,
                    timestamp: Math.max(item.created, item.updated),
                    content: content
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
