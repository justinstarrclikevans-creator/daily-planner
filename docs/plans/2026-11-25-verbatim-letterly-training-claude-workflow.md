# Implementation Plan: Verbatim Letterly 5-Lane Router, 1-Tap Staff Slack, Dual L10s, Daily Training Brief & Claude Code Builder

## Context & Non-Negotiables
1. **Strict 1-Tap Approval for ALL Outbound Emails & Messages**:
   - Every outbound email (`email_outreach`, email `task_assist`) and every outbound Slack message (`slack_message`) MUST enter `public.agent_jobs` with `status: 'needs_approval'` (or `queued` -> `needs_approval`).
   - NEVER auto-send any email or Slack message to staff/contacts until `status === 'approved'` (triggered when Justin taps Approve in `AICeoWorkspace.tsx`).
2. **Verbatim-First Letterly Processing (Keep Rewrites OFF)**:
   - Never rewrite or paraphrase Justin's voice notes into generic AI summaries.
   - Only normalize obvious speech-to-text spellings (`Turn 90` -> `Turn90`, `L S C M I` -> `LS/CMI`, `Synapse` -> `SYNAPSE`, `8 4 3` -> `843FC`).
   - For Vault Notes, Training transcripts, L10 items, and Code Change specs: preserve Justin's words **100% verbatim**.
   - For Tasks (`tasks` + Apple Reminders): use Justin's own phrasing (only stripping lead-ins like `"Remind me to"` / `"I need to"`, no `!` or `#`) and append `\nVerbatim (Letterly): "<exact quote>"` to `description`.
3. **7 Canonical "One Brain" Folders**:
   1. `Training (Turn90 & SYNAPSE)`
   2. `Turn90 Ops & Dual L10s`
   3. `SYNAPSE & Book`
   4. `843FC`
   5. `Liturgy & Quotes`
   6. `App Build Backlog`
   7. `Home & Budget`
4. **Dual L10 Schedules & Running Agendas**:
   - **Program L10**: Tuesdays `15:15` / `13:15–14:30` window -> Pre-meeting brief runs **Tuesdays at 12:15 PM EST** (`CRON: 15 12 * * 2`, `timezone: 'America/New_York'`). Running agenda note title: `Program L10 — Running Agenda` in folder `Turn90 Ops & Dual L10s`.
   - **Leadership L10**: Wednesdays `12:00–13:30` -> Pre-meeting brief runs **Wednesdays at 11:00 AM EST** (`CRON: 0 11 * * 3`, `timezone: 'America/New_York'`). Running agenda note title: `Leadership L10 — Running Agenda` in folder `Turn90 Ops & Dual L10s`.
5. **Daily Classroom & Case Management Training Brief**:
   - Runs **Weekdays at 7:30 AM EST** (`CRON: 30 7 * * 1-5`, `timezone: 'America/New_York'`) AND on-demand via `job_type: 'training_brief'`.
   - Reads real local Turn90 feedback sources:
     - SQLite DB `/Users/justinevans/Desktop/Turn90/docs/lscmi/audio-interview-app/data/app_database.sqlite` tables `class_facilitation_evaluations` and `case_management_evaluations` (query via `sqlite3 -json` child_process so there is zero native module ABI issue).
     - Dropbox `.docx` files in `/Users/justinevans/Library/CloudStorage/Dropbox/Classroom Feedback/*.docx` (extract plain text from `word/document.xml` via `python3 -c` zipfile/xml.etree).
     - `/Users/justinevans/Desktop/Turn90/pipelines/supervision-report/case_feedback_cache.json`.
   - **Domain Rule**: NEVER include numeric scores for classroom facilitation! Format strictly around **Cross-Center Training Focus Today**, **Classroom Facilitation Trends (What Went Well / Do's & Don'ts / SYNAPSE Practices / Pro-Social Modeling vs. Role-Play / Talk-Time)**, **Case Management & Briefcase Trends (6-Part Session Template / 9 Waitlist Items)**, and **Suggested Micro-Drills for Turn90 & SYNAPSE Training**.
   - Saves brief to Supabase `notes` (`folder: 'Training (Turn90 & SYNAPSE)'`), writes Markdown copy to `/Users/justinevans/Desktop/Training-Agent/.agents/skills/turn90-synapse-trainer/references/daily-briefs/YYYY-MM-DD-training-brief.md`, and creates a `needs_approval` card (`job_type: 'training_brief'`) in `agent_jobs` with optional proposed 1-tap Slack coaching messages (`proposedSlackCheckins` array) that ONLY queue as `slack_message` approval cards if Justin approves!

---

## Step-by-Step File Changes

### 1. `mac-daemon/slack.js`
- Keep `getRecentSlackMessages` and `sendSlackDM` intact.
- Add `resolveSlackRecipient(query)`:
  - Uses `SLACK_USER_TOKEN` + `tagging-rules.json` `people` entries.
  - Checks `client.users.list()` (cached for 15 minutes) matching `real_name`, `display_name`, `name`, or `tagging-rules.json` keywords; if `users.list` lacks scope, falls back to `client.users.conversations({ types: 'im' })` + `client.search.messages` usernames.
  - Returns `{ ok, userId, channelId, displayName, handle, error }`.
- Add `sendSlackMessageToRecipient({ userId, channelId, recipientName, text })`:
  - Opens DM via `client.conversations.open({ users: userId })` if `channelId` not provided, then posts via `client.chat.postMessage({ channel, text })`.
  - Export `{ getRecentSlackMessages, sendSlackDM, resolveSlackRecipient, sendSlackMessageToRecipient }`.

### 2. `mac-daemon/ai.js`
- Keep `extractTodos` working for Slack + Email hourly extraction.
- Add `CANONICAL_FOLDERS`:
  `['Training (Turn90 & SYNAPSE)', 'Turn90 Ops & Dual L10s', 'SYNAPSE & Book', '843FC', 'Liturgy & Quotes', 'App Build Backlog', 'Home & Budget']`.
- Add `triageLetterlyNote(note, { existingTodos = [], completedTodos = [] } = {})`:
  - Takes a single Letterly note `{ id, title, content, timestamp }`.
  - Prompts `gemini-3.8-flash` (`temperature: 0.15`) to split the raw recording into atomic segments WITHOUT generic rewriting:
    - Fix ONLY obvious speech-to-text errors (`Turn 90` -> `Turn90`, `L S C M I` -> `LS/CMI`, `Synapse` -> `SYNAPSE`, `8 4 3` -> `843FC`).
    - Return JSON array of routed items, each with `lane`:
      - `'task'`: `{ lane: 'task', title, verbatimQuote }`
      - `'slack_message'`: `{ lane: 'slack_message', recipients: ['Matt'], messageText, verbatimQuote }` (when Justin asks to Slack/message a staff member)
      - `'delegate'`: `{ lane: 'delegate', jobType: 'email_outreach' | 'rerun_coworker' | 'task_assist', recipientName, subject, prompt, verbatimQuote }`
      - `'vault_note'`: `{ lane: 'vault_note', folder, title, verbatimTranscript, l10Target: 'leadership' | 'program' | null, isTrainingCorpus: boolean }`
      - `'code_change'`: `{ lane: 'code_change', targetRepo: 'todo' | 'turn90' | 'synapse' | 'liturgy' | 'resource', executionMode: 'antigravity_claude' | 'claude_direct', title, verbatimSpec }`
  - Export `{ extractTodos, triageLetterlyNote, CANONICAL_FOLDERS }`.

### 3. `mac-daemon/letterly-router.js` (New Module)
- Shared local router that processes an array of Letterly notes (used by `sync.js` hourly/fast loop AND `backfill-letterly-training.js`):
  - Deduplicates via `state.processedLetterlyNoteIds` (persisted in `mac-daemon/state.json`).
  - For `'task'`: deduplicates against active/completed reminders, adds to Apple Reminders (`General`) + `syncTaskToSupabase`, keeping Justin's words + `Verbatim (Letterly): "..."` in notes.
  - For `'slack_message'`: resolves each recipient via `resolveSlackRecipient` and inserts a `public.agent_jobs` row with `agent_role: 'outreach'`, `job_type: 'slack_message'`, `status: 'needs_approval'`, `output_markdown`, and `output_payload: { isSlack: true, recipientName, slackUserId, slackChannelId, messageText, verbatimQuote }` — **strictly 1-tap approval**.
  - For `'delegate'`: inserts `queued` job into `public.agent_jobs` so `agent-worker.js` drafts it and lands it in `needs_approval` (**strictly 1-tap approval**).
  - For `'vault_note'`:
    - If `l10Target === 'leadership'` or `'program'`, appends `- **[YYYY-MM-DD — Letterly Verbatim]:** <verbatimTranscript>` to the existing `Leadership L10 — Running Agenda` or `Program L10 — Running Agenda` note in Supabase `notes` (creating that note in `Turn90 Ops & Dual L10s` if it doesn't exist yet!).
    - Otherwise inserts a verbatim note in `public.notes` under the chosen canonical folder (`source: 'letterly'`).
    - If `folder === 'Training (Turn90 & SYNAPSE)'` or `isTrainingCorpus`, ALSO writes `/Users/justinevans/Desktop/Training-Agent/.agents/skills/turn90-synapse-trainer/references/transcripts/letterly-<id>-<slug>.md` with the exact verbatim text!
  - For `'code_change'`: inserts `queued` job (`job_type: 'code_change'`, `agent_role: 'ceo'`) into `public.agent_jobs` AND logs the spec in `App Build Backlog`.

### 4. `mac-daemon/training-brief.js` (New Module)
- Implements `generateDailyTrainingBrief({ days = 7 } = {})`:
  - Queries `class_facilitation_evaluations` and `case_management_evaluations` from `/Users/justinevans/Desktop/Turn90/docs/lscmi/audio-interview-app/data/app_database.sqlite` via `execFileSync('sqlite3', ['-json', dbPath, sql])` (pulling recent rows; if none in last `days`, pulls the most recent 8 classroom + 5 CM evaluations clearly labeled with their actual session dates so the brief is immediately rich and never fabricates dates!).
  - Also reads up to 4 newest `.docx` files in `/Users/justinevans/Library/CloudStorage/Dropbox/Classroom Feedback` (via quick `python3` zipfile XML reader) and up to 15 entries from `/Users/justinevans/Desktop/Turn90/pipelines/supervision-report/case_feedback_cache.json`.
  - Calls `gemini-3.8-flash` to synthesize a grounded **Daily Classroom & Case Management Training Brief** (strictly NO numeric classroom scores; Do's & Don'ts, What Went Well, How to Improve, SYNAPSE practices, Pro-Social Modeling vs. Role-Play, Talk-Time, CM 6-part template & 9 Briefcase waitlist items) + 1–3 optional suggested staff Slack coaching check-ins (`proposedSlackCheckins`: `[{ recipientName, messageText }]`, written in Justin's supportive, direct tone).
  - Saves to `/Users/justinevans/Desktop/Training-Agent/.agents/skills/turn90-synapse-trainer/references/daily-briefs/YYYY-MM-DD-training-brief.md` AND Supabase `notes` (`folder: 'Training (Turn90 & SYNAPSE)'`).
  - Returns `{ output_markdown, output_payload }`.

### 5. `mac-daemon/l10-brief.js` (New Module)
- Implements `generateL10Brief(l10Type = 'program')` (`'leadership'` or `'program'`):
  - Fetches the corresponding `Leadership L10 — Running Agenda` or `Program L10 — Running Agenda` note from Supabase `notes`, open/recent tasks from `tasks`, recent Slack/huddle highlights via `getRecentSlackMessages`, and (for `program`) recent training/supervision highlights.
  - Synthesizes a crisp 1-page L10 Pre-Meeting Brief scoped strictly to:
    - **Leadership L10** (Wednesdays 12:00–13:30): Org rocks, finance/HR/Gusto, Goodwill/SC Works/donor partnerships, strategic ventures, open loops for `#amy`, `#katie`, `#sean`, `#daisy`.
    - **Program L10** (Tuesdays): 5-center scorecards (`Charleston`, `Columbia`, `Spartanburg`, `Reentry Navigation`, `Prison Program`), Apricot/Briefcase 9-item compliance, LS/CMI completions, Classroom & CM Training Brief takeaways, SkillCat progress, open loops for `#matt`, `#jenn`, `#diyoung`, `#tb`, `#lashawn`, `#stacy`, `#casey`.
  - Saves to Supabase `notes` (`folder: 'Turn90 Ops & Dual L10s'`).

### 6. `mac-daemon/code-runner.js` (New Module — Antigravity + Claude Code Offloading)
- Maps `REPO_MAP`:
  - `todo`: `/Users/justinevans/Desktop/ToDo App`
  - `turn90`: `/Users/justinevans/Desktop/Turn90`
  - `synapse`: `/Users/justinevans/Desktop/SYNAPSE App`
  - `liturgy`: `/Users/justinevans/LiturgyApp`
  - `resource`: `/Users/justinevans/.gemini/antigravity/scratch/turn90-resource-app`
- Implements `runCodeChangeJob(job)` and `approveCodeChangeJob(job)`:
  - Checks `~/.local/bin/claude` and `/Users/justinevans/.gemini/antigravity/bin/agentapi`.
  - Runs headless Claude Code (`~/.local/bin/claude -p <prompt> --dangerously-skip-permissions`, timeout 8 minutes) inside the target repo directory with safety instructions: DO NOT `git push` or delete untracked user data; make surgical edits, run syntax/build checks, and output a concise summary of files changed and verification results.
  - If `executionMode === 'antigravity_claude'`, first uses a fast architectural framing prompt (or spawns an Antigravity QA companion thread via `agentapi new-conversation --model=flash --title="QA Review: <title>" <reviewPrompt>` after Claude finishes editing so Antigravity reviews the diff in the IDE!).
  - Captures `git status --short` and `git diff --stat` and returns `{ output_markdown, output_payload }` so the job lands in **`"Needs You"` (`status: 'needs_approval'`)** for Justin's 1-tap review!
  - On **1-Tap Approve** (`approveCodeChangeJob`), stages & commits the modified files with a clean `feat(ai-builder): <title>` commit message (and pushes if `output_payload.pushOnApprove === true`).

### 7. `mac-daemon/agent-worker.js` & `mac-daemon/sync.js`
- In `agent-worker.js`:
  - Update `updateDaemonHeartbeat()` capabilities to also report `slackReady`, `letterlyReady`, `claudeCodeReady` (`fs.existsSync('/Users/justinevans/.local/bin/claude')`), and `antigravityApiReady` (`fs.existsSync('/Users/justinevans/.gemini/antigravity/bin/agentapi')`).
  - Add `switch (currentJob.job_type)` cases for `'slack_message'`, `'training_brief'`, `'l10_brief'`, and `'code_change'`.
  - In `executeApprovedJob`:
    - `'slack_message'`: sends the Slack message via `sendSlackMessageToRecipient` ONLY now that `status === 'approved'`, recording message timestamp & channel in `execution_result`!
    - `'training_brief'`: saves note (if edited) and, for any `proposedSlackCheckins` with `selected === true`, inserts `needs_approval` `slack_message` cards so Justin still gets 1-tap control before messaging staff!
    - `'l10_brief'`: saves finalized brief to `Turn90 Ops & Dual L10s`.
    - `'code_change'`: runs `approveCodeChangeJob` (commits & optional push).
- In `sync.js`:
  - Re-enable Letterly polling via `getRecentLetterlyNotes` + `processLetterlyNotes` every 15 minutes (`*/15 * * * *`) as well as during `runHourlySync()`.
  - Add cron schedules (`timezone: 'America/New_York'`):
    - **Daily Classroom & CM Training Brief**: `30 7 * * 1-5` (Weekdays 7:30 AM EST) -> queues a `training_brief` job if one hasn't been created today.
    - **Program L10 Brief**: `15 12 * * 2` (Tuesdays 12:15 PM EST) -> queues a `l10_brief` (`l10Type: 'program'`) job.
    - **Leadership L10 Brief**: `0 11 * * 3` (Wednesdays 11:00 AM EST, 1 hr before 12:00–13:30 Leadership L10) -> queues a `l10_brief` (`l10Type: 'leadership'`) job.

### 8. `mac-daemon/backfill-letterly-training.js` (New Script)
- Paginates through all available pages of `callLetterlyMCPTool('list_notes', { page, page_size: 50 })`, fetches full raw transcripts via `get_note` for notes related to training, facilitation, classroom, case management, SYNAPSE, communication, Pro-Social Modeling, CBT, or coaching, saves them **100% verbatim** to `/Users/justinevans/Desktop/Training-Agent/.agents/skills/turn90-synapse-trainer/references/transcripts/` AND Supabase `notes` (`folder: 'Training (Turn90 & SYNAPSE)'`, deduplicated by `[Letterly #<id>]` marker so running twice never duplicates!).

### 9. `render-webapp` Updates
- `src/lib/supabase.ts`:
  - Expand `AgentRole` and `AgentJobType` (`'slack_message' | 'code_change' | 'training_brief' | 'l10_brief'`).
  - Expand `DaemonCapabilities` (`slackReady`, `letterlyReady`, `claudeCodeReady`, `antigravityApiReady`).
  - Export `CANONICAL_NOTE_FOLDERS` array with the 7 canonical folders.
- `src/app/api/letterly-webhook/route.ts` (New API Route):
  - Accepts `POST` from Letterly Actions Webhook (`{ id, title, transcription, text, content }`), runs Gemini 5-lane verbatim triage using `GEMINI_API_KEY` + `supabaseFetch`, writes verbatim `notes` (including appending to `Leadership L10 — Running Agenda` / `Program L10 — Running Agenda`), `tasks`, and `agent_jobs` (`slack_message` with `status: 'needs_approval'`, `email_outreach`, `code_change`, `rerun_coworker`).
- `src/components/NotesWorkspace.tsx`:
  - Always include the 7 `CANONICAL_NOTE_FOLDERS` in the folder filter list and folder `<datalist>` / selector so all 7 buckets (starting with `Training (Turn90 & SYNAPSE)` and `Turn90 Ops & Dual L10s`) are permanently visible and one click away.
- `src/components/AICeoWorkspace.tsx`:
  - Support rendering & editing **`slack_message` 1-Tap Approval Cards** in `"Needs You"` (editable Staff Recipient + Message Text + `"Approve & Send Slack"` button).
  - Support rendering **`code_change` Approval Cards** (Target Repo badge, Mode badge `Antigravity -> Claude Code` vs `Direct Claude`, diff preview, `"Approve & Commit"` button).
  - Support rendering **`training_brief`** (with checkboxes on `proposedSlackCheckins` to queue 1-tap Slack drafts) and **`l10_brief`** cards.
  - Add a compact **"Quick Actions & App Builder"** bar at the top of `AICeoWorkspace` with 1-click triggers for:
    1. **Code Change (AG + Claude Code)** modal/drawer (select Repo: `ToDo App`, `Turn90`, `SYNAPSE App`, `Liturgy App`, `Resource App`; select Mode: `Antigravity Orchestrates Claude Code` vs `Direct Claude Code (0 AG Credits)`; enter spec).
    2. **Generate Daily Training Brief Now**
    3. **Prep Program L10 (Tue)** / **Prep Leadership L10 (Wed 12:00)**
    4. **Stage 1-Tap Staff Slack**
  - Show the **Letterly Instant Webhook URL** (`{originUrl}/api/letterly-webhook`) + copy button and the new daemon capability pills (`Claude Code`, `Antigravity API`, `Slack`, `Letterly`) in the **Connections** tab!
