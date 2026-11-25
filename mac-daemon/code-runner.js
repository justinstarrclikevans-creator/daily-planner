// AI Builder: Antigravity + Claude Code offloading for `code_change` agent jobs.
// Edits happen in the working tree only; nothing is committed until Justin taps Approve.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { callGeminiWithRetry } = require('./gemini-helper');

const REPO_MAP = {
    todo: '/Users/justinevans/Desktop/ToDo App',
    turn90: '/Users/justinevans/Desktop/Turn90',
    synapse: '/Users/justinevans/Desktop/SYNAPSE App',
    liturgy: '/Users/justinevans/LiturgyApp',
    resource: '/Users/justinevans/.gemini/antigravity/scratch/turn90-resource-app',
};

const REPO_LABELS = {
    todo: 'ToDo App',
    turn90: 'Turn90',
    synapse: 'SYNAPSE App',
    liturgy: 'Liturgy App',
    resource: 'Resource App',
};

const CLAUDE_BIN = path.join(os.homedir(), '.local/bin/claude');
const AGENTAPI_BIN = '/Users/justinevans/.gemini/antigravity/bin/agentapi';
const CLAUDE_TIMEOUT_MS = 8 * 60 * 1000;

function isClaudeCodeReady() {
    return fs.existsSync(CLAUDE_BIN);
}

function isAntigravityApiReady() {
    return fs.existsSync(AGENTAPI_BIN);
}

function run(cmd, args, { cwd, timeout = 60000, maxBuffer = 32 * 1024 * 1024 } = {}) {
    return new Promise((resolve) => {
        execFile(cmd, args, { cwd, timeout, maxBuffer, env: process.env }, (err, stdout, stderr) => {
            resolve({
                ok: !err,
                code: err ? (err.code ?? 1) : 0,
                killed: Boolean(err && err.killed),
                stdout: String(stdout || ''),
                stderr: String(stderr || ''),
                error: err ? err.message : null,
            });
        });
    });
}

/** Parse `git status --porcelain -z -uall` into [{ status, file }]. */
function parsePorcelainZ(out) {
    const entries = [];
    const parts = String(out || '').split('\0');
    for (let i = 0; i < parts.length; i++) {
        const rec = parts[i];
        if (!rec || rec.length < 4) continue;
        const status = rec.slice(0, 2);
        const file = rec.slice(3);
        entries.push({ status, file });
        if (status[0] === 'R' || status[0] === 'C') i++; // skip original path
    }
    return entries;
}

async function gitSnapshot(repoDir) {
    const status = await run('git', ['status', '--porcelain', '-z', '-uall'], { cwd: repoDir });
    const entries = status.ok ? parsePorcelainZ(status.stdout) : [];
    const map = new Map();
    for (const e of entries) map.set(e.file, e.status);
    return { ok: status.ok, map };
}

async function fileHash(repoDir, file) {
    const res = await run('git', ['hash-object', '--', file], { cwd: repoDir });
    return res.ok ? res.stdout.trim() : null;
}

function resolveRepo(job) {
    const payload = job.output_payload || {};
    const key = REPO_MAP[payload.targetRepo] ? payload.targetRepo : 'todo';
    return { key, dir: REPO_MAP[key], label: REPO_LABELS[key] };
}

async function buildArchitecturalFraming(job, repoLabel) {
    try {
        const res = await callGeminiWithRetry({
            model: 'gemini-3.8-flash',
            contents: `You are a senior architect. In <= 12 bullet points, frame how to implement this change in the "${repoLabel}" codebase: likely files/areas to inspect, risks, and verification steps. Do not write code.\n\nChange title: ${job.title}\nJustin's spec (verbatim):\n${job.output_payload?.verbatimSpec || job.prompt}`,
            config: { temperature: 0.2 },
        });
        return String(res.text || '').trim();
    } catch (e) {
        return '';
    }
}

function buildClaudePrompt(job, repoLabel, framing) {
    const spec = job.output_payload?.verbatimSpec || job.prompt || job.title;
    const feedback = String(job.revision_feedback || '').trim();
    return `You are working inside the "${repoLabel}" repository on Justin Evans's machine as a headless coding agent.

TASK: ${job.title}

JUSTIN'S SPEC (verbatim from his voice note — follow its intent exactly):
${spec}
${feedback ? `\nREVISION FEEDBACK FROM JUSTIN (highest priority):\n${feedback}\n` : ''}${framing ? `\nARCHITECTURAL FRAMING (guidance, not a mandate):\n${framing}\n` : ''}
SAFETY RULES (mandatory):
- DO NOT run git commit, git push, git reset, git checkout of other branches, or any destructive git command.
- DO NOT delete untracked files, user data, databases, .env files, or credentials. Never print secret values.
- DO NOT restart pm2 or any long-running services.
- Make surgical, minimal edits that fit existing code style.
- Run relevant syntax/build checks (e.g. node --check on changed .js files, npm run build / tsc where applicable) and fix errors you introduced.

When finished, output a concise summary:
1. Files changed (one line each, with what changed)
2. Verification commands run and their results
3. Anything Justin must do manually`;
}

async function spawnAntigravityQaReview(job, repoLabel, diffStat, summary) {
    if (!isAntigravityApiReady()) return { ok: false, error: 'agentapi not installed' };
    const reviewPrompt = `QA review the uncommitted changes in the ${repoLabel} repo made by Claude Code for: "${job.title}".\n\nDiff stat:\n${diffStat}\n\nClaude's summary:\n${String(summary).slice(0, 4000)}\n\nCheck correctness, regressions and style. Do not commit or push.`;
    const res = await run(
        AGENTAPI_BIN,
        ['new-conversation', '--model=flash', `--title=QA Review: ${String(job.title).slice(0, 80)}`, reviewPrompt],
        { cwd: resolveRepo(job).dir, timeout: 60000 }
    );
    return { ok: res.ok, output: res.stdout.slice(0, 2000), error: res.ok ? null : (res.stderr || res.error || '').slice(0, 500) };
}

/**
 * Run a queued `code_change` job with headless Claude Code. Returns { output_markdown, output_payload }
 * so the job lands in "Needs You" (needs_approval). No commits happen here.
 */
async function runCodeChangeJob(job) {
    const payload = job.output_payload || {};
    const { key, dir, label } = resolveRepo(job);
    const executionMode = payload.executionMode === 'claude_direct' ? 'claude_direct' : 'antigravity_claude';

    if (!fs.existsSync(dir)) throw new Error(`Target repo not found: ${dir}`);
    if (!isClaudeCodeReady()) throw new Error(`Claude Code CLI not found at ${CLAUDE_BIN}`);

    // Snapshot pre-existing dirty files so we only ever stage what this job changed.
    const before = await gitSnapshot(dir);
    const beforeHashes = {};
    for (const file of before.map.keys()) {
        beforeHashes[file] = await fileHash(dir, file);
    }

    const framing = executionMode === 'antigravity_claude' ? await buildArchitecturalFraming(job, label) : '';
    const prompt = buildClaudePrompt(job, label, framing);

    console.log(`[Code Runner] Running Claude Code in ${dir} (${executionMode})...`);
    const claudeRes = await run(CLAUDE_BIN, ['-p', prompt, '--dangerously-skip-permissions'], {
        cwd: dir,
        timeout: CLAUDE_TIMEOUT_MS,
    });
    const claudeSummary = (claudeRes.stdout || '').trim() || (claudeRes.stderr || '').trim();

    const after = await gitSnapshot(dir);
    const changedFiles = [];
    for (const [file, status] of after.map.entries()) {
        if (!before.map.has(file)) {
            changedFiles.push(file);
        } else {
            const h = await fileHash(dir, file);
            if (h !== beforeHashes[file]) changedFiles.push(file);
        }
    }
    // Files that were dirty before and are now clean were reverted by the agent
    for (const file of before.map.keys()) {
        if (!after.map.has(file)) changedFiles.push(file);
    }

    const statusShort = (await run('git', ['status', '--short'], { cwd: dir })).stdout.trim();
    const diffStat = changedFiles.length
        ? (await run('git', ['diff', '--stat', '--', ...changedFiles], { cwd: dir })).stdout.trim()
        : '';
    const diffPreviewRaw = changedFiles.length
        ? (await run('git', ['diff', '--', ...changedFiles], { cwd: dir })).stdout
        : '';
    const diffPreview = diffPreviewRaw.length > 15000 ? `${diffPreviewRaw.slice(0, 15000)}\n… [diff truncated]` : diffPreviewRaw;

    let antigravityQa = null;
    if (executionMode === 'antigravity_claude' && changedFiles.length > 0) {
        antigravityQa = await spawnAntigravityQaReview(job, label, diffStat, claudeSummary);
    }

    const timedOut = claudeRes.killed;
    const output_markdown = [
        `### AI Builder — ${label}`,
        `**Mode:** ${executionMode === 'claude_direct' ? 'Direct Claude Code' : 'Antigravity → Claude Code'} · **Repo:** \`${dir}\``,
        timedOut ? '\n> Claude Code hit the 8-minute timeout; review partial changes carefully.' : '',
        !claudeRes.ok && !timedOut ? `\n> Claude Code exited with an error: ${(claudeRes.error || '').slice(0, 300)}` : '',
        '\n#### Claude Code Summary',
        claudeSummary.slice(0, 8000) || '_No output_',
        '\n#### Files changed by this job',
        changedFiles.length ? changedFiles.map((f) => `- \`${f}\``).join('\n') : '_No file changes detected_',
        diffStat ? `\n\`\`\`\n${diffStat}\n\`\`\`` : '',
        antigravityQa ? `\n#### Antigravity QA Review\n${antigravityQa.ok ? 'QA conversation opened in Antigravity.' : `Not started: ${antigravityQa.error}`}` : '',
        '\n_Tap **Approve & Commit** to commit only these files (no push unless enabled)._',
    ]
        .filter(Boolean)
        .join('\n');

    return {
        output_markdown,
        output_payload: {
            ...payload,
            targetRepo: key,
            repoDir: dir,
            executionMode,
            changedFiles,
            gitStatusShort: statusShort.slice(0, 5000),
            diffStat,
            diffPreview,
            claudeExitOk: claudeRes.ok,
            claudeTimedOut: timedOut,
            antigravityQa,
            pushOnApprove: payload.pushOnApprove === true,
        },
    };
}

/** On 1-tap approve: stage & commit ONLY this job's files; push only if pushOnApprove === true. */
async function approveCodeChangeJob(job) {
    const payload = job.output_payload || {};
    const { dir } = resolveRepo(job);
    const files = Array.isArray(payload.changedFiles) ? payload.changedFiles.filter(Boolean) : [];
    if (files.length === 0) {
        return { ok: true, action: 'no_changes', committed: false };
    }

    const add = await run('git', ['add', '-A', '--', ...files], { cwd: dir });
    if (!add.ok) return { ok: false, error: `git add failed: ${(add.stderr || add.error || '').slice(0, 400)}` };

    const cleanTitle = String(job.title || 'code change').replace(/[\r\n]+/g, ' ').replace(/!+/g, '').trim().slice(0, 72);
    const message = `feat(ai-builder): ${cleanTitle}`;
    const commit = await run('git', ['commit', '-m', message, '--', ...files], { cwd: dir });
    if (!commit.ok) return { ok: false, error: `git commit failed: ${(commit.stderr || commit.stdout || commit.error || '').slice(0, 400)}` };

    const sha = (await run('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();
    let pushed = false;
    let pushError = null;
    if (payload.pushOnApprove === true) {
        const push = await run('git', ['push'], { cwd: dir, timeout: 120000 });
        pushed = push.ok;
        if (!push.ok) pushError = (push.stderr || push.error || '').slice(0, 400);
    }
    return { ok: true, action: 'committed', committed: true, commitSha: sha, message, files, pushed, pushError };
}

module.exports = {
    REPO_MAP,
    REPO_LABELS,
    isClaudeCodeReady,
    isAntigravityApiReady,
    runCodeChangeJob,
    approveCodeChangeJob,
};
