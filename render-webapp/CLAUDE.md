# ADHD Executive Assistant & Day Planner (`render-webapp`)

## 1. System Overview
`render-webapp` is a Next.js (App Router) ADHD executive functioning assistant and Sunsama-style daily planner deployed on **Render** and backed by **Supabase** (with local JSON fallback support and optional Google Sheets integration).

### Key Components
- **Frontend UI (`src/app/page.tsx`)**: Daily Kanban board, 15-minute interval calendar timeline with task resizing (down to 5-minute blocks), focus timer mode, and backlog/routine management.
- **API Routes**:
  - `src/app/api/todos/route.ts`: CRUD operations for tasks, projects, ideas, and routines via Supabase PostgREST, plus Gemini AI actions.
  - `src/app/api/desk/route.ts`: Unified desk state endpoint for tasks, projects, ideas, and scheduled calendar appointments (`src/lib/fallback-calendar.json` / `src/lib/fallback-todos.json`).
  - `src/app/api/projects/route.ts`: Project management endpoint.
- **Mac Daemon Sync (`../mac-daemon`)**: Syncs Apple Reminders, Apple Calendar events, and voice notes with the web app.

---

## 2. AI Capabilities
Powered by **Google Gemini (`gemini-3.8-flash`)** via prompt templates stored in `skills/`:

1. **ADHD Task Breakdown (`action: "ai_breakdown"`)**
   - **Skill Template**: `skills/adhd-task-breakdown/SKILL.md`
   - **Purpose**: Breaks down a task into:
     - `firstFiveMinutes`: A single, ultra-specific, low-barrier physical action to do in the next 60 seconds to overcome initiation paralysis.
     - `estimatedMinutes`: Realistic total duration (`5`, `10`, `15`, `25`, `30`, `45`, or `60` minutes).
     - `steps`: Concise sequential steps tailored to the requested granularity (`quick`, `standard`, or `micro`).

2. **Voice Brainstorm Promotion (`action: "promote_idea"`)**
   - **Skill Template**: `skills/voice-note-triage/SKILL.md`
   - **Purpose**: Triages a saved voice brainstorm summary and raw transcript into 1–4 concrete, actionable Supabase tasks complete with time estimates, immediate 5-minute starter actions, and checklists of subtasks.

---

## 3. Deployment Instructions (Render)
The service is configured via `render.yaml` (`rootDir: render-webapp`):

- **Build Command**:
  ```bash
  npm install && npm run build
  ```
- **Start Command**:
  ```bash
  npm start
  ```

### Required Environment Variables
Set the following in the Render dashboard or `.env`:
- `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_ANON_KEY`)
- `GEMINI_API_KEY`
