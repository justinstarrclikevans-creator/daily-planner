# Project Rules

## Repository Layout

`/Users/justinevans/Desktop/ToDo App` consists strictly of:

- `render-webapp/` — Next.js webapp (deployed to Render from `main`, used across desktop and mobile browsers).
- `mac-daemon/` — Headless PM2 background daemon (`daily-planner-sync`) handling Apple Reminders/Calendar sync, Letterly 5-lane verbatim routing, Daily Training & L10 briefs, and AI CEO jobs.
- `supabase/` — Database schemas.

## Rules

- **Webapp Only — No Companion App:** The iOS/SwiftUI ToDo Companion app (`ios-companion`) has been permanently removed. Never create, scaffold, reference, or target any native iOS/mobile companion app in plans, prompts, scripts, or code. All UI work belongs exclusively in `render-webapp/`.
