const DEFAULT_RERUN_MCP_URL = 'https://app.rerun.build/api/mcp/account';
const REQUEST_TIMEOUT_MS = 15000;

function getRerunMcpToken() {
  return (process.env.RERUN_MCP_TOKEN || process.env.RERUN_API_KEY || '').trim();
}

function isRerunMcpConfigured() {
  return Boolean(getRerunMcpToken());
}

function validateWebhookUrl(webhookUrl) {
  let parsed;
  try {
    parsed = new URL(String(webhookUrl || '').trim());
  } catch {
    return { ok: false, error: 'Invalid webhook URL format.' };
  }

  const isHttps = parsed.protocol === 'https:';
  const isLocalHttp =
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');

  if (!isHttps && !isLocalHttp) {
    return { ok: false, error: 'Webhook URL must use https:// (or http://localhost for local testing).' };
  }
  return { ok: true, url: parsed.toString() };
}

async function triggerRerunWebhook(webhookUrl, payload = {}) {
  const check = validateWebhookUrl(webhookUrl);
  if (!check.ok) {
    return { ok: false, status: 0, body: null, error: check.error };
  }

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const secret = (process.env.RERUN_CALLBACK_SECRET || '').trim();
  if (secret) {
    headers['X-Rerun-Secret'] = secret;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(check.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        source: 'todo-companion-ai-ceo',
        timestamp: new Date().toISOString(),
        ...payload,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const text = await res.text();
    let parsedBody = text;
    try {
      parsedBody = text ? JSON.parse(text) : null;
    } catch {
      // keep raw text
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        body: parsedBody,
        error: `Rerun webhook returned HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
      };
    }

    return { ok: true, status: res.status, body: parsedBody, error: null };
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err?.name === 'AbortError' ? 'Rerun webhook request timed out after 15s.' : err.message || String(err);
    return { ok: false, status: 0, body: null, error: msg };
  }
}

async function callRerunMcpTool(toolName, args = {}) {
  const token = getRerunMcpToken();
  if (!token) {
    return { ok: false, status: 0, error: 'RERUN_MCP_TOKEN (or RERUN_API_KEY) is not configured in mac-daemon/.env' };
  }
  if (!toolName || !String(toolName).trim()) {
    return { ok: false, status: 400, error: 'toolName is required for Rerun MCP call.' };
  }

  const mcpUrl = (process.env.RERUN_MCP_URL || DEFAULT_RERUN_MCP_URL).trim();
  const check = validateWebhookUrl(mcpUrl);
  if (!check.ok) {
    return { ok: false, status: 0, error: check.error };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(check.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: String(toolName).trim(),
          arguments: args || {},
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: `Rerun MCP HTTP ${res.status}: ${json?.error?.message || text.slice(0, 200)}`,
      };
    }

    if (json?.error) {
      return {
        ok: false,
        status: res.status,
        error: json.error.message || JSON.stringify(json.error),
      };
    }

    return { ok: true, status: res.status, result: json?.result ?? json };
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err?.name === 'AbortError' ? 'Rerun MCP request timed out after 15s.' : err.message || String(err);
    return { ok: false, status: 0, error: msg };
  }
}

module.exports = {
  isRerunMcpConfigured,
  triggerRerunWebhook,
  callRerunMcpTool,
};
