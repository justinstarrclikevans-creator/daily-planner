# ToDo Companion — iOS Native App

A native SwiftUI companion app for personal executive management, featuring:
- **Dual-Mode Voice AI**: Tap-to-Talk Brain Dump + Conversational Sounding Board (powered by Gemini 2.5 Flash).
- **Active Projects Hub**: High-level focus areas (*First Shift*, *Albertine Initiative*, *Football / 843*, *Personal*).
- **Apple Reminders Sync**: Uses `EventKit` to push extracted tasks straight to your native iPhone Reminders lists.
- **Mac Desktop Sync**: Uses Supabase to sync in real-time with your Mac daemon (which reads Slack, Gmail, and iMessages).

---

## 1. Quick Setup: Supabase Database (1 Minute)

1. Log into your Supabase Dashboard at [app.supabase.com](https://app.supabase.com).
2. Open your project, click **SQL Editor** in the left sidebar, and click **New Query**.
3. Copy and paste the contents of [`supabase/schema.sql`](../supabase/schema.sql) and click **Run**.
   * *This creates the `projects`, `ideas`, and `tasks` tables with real-time sync enabled and seeds your default focus areas.*
4. In your Supabase Project Settings $\rightarrow$ **API**, copy your **Project URL** and **anon public key**.
5. Add them to your Mac daemon's `.env` file:
   ```env
   SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
   SUPABASE_KEY="YOUR_SUPABASE_ANON_KEY"
   ```

---

## 2. Opening & Running in Xcode

1. Open the project in Xcode:
   ```bash
   open "/Users/justinevans/Desktop/ToDo App/ios-companion/ToDoCompanion.xcodeproj"
   ```
2. **Signing & Team**:
   - In Xcode's left sidebar, click the top-level **ToDoCompanion** project icon.
   - Click the **Signing & Capabilities** tab.
   - Under **Team**, select your **Apple Developer Account / Team**.
3. **Select Your iPhone**:
   - Plug your iPhone into your Mac using a USB-C or Lightning cable.
   - In Xcode's top toolbar (next to the "ToDoCompanion" scheme), click the device selector and choose **your physical iPhone** (or an iOS Simulator).
4. **Click Run ($\blacktriangleright$)**:
   - Xcode will compile and install the app directly onto your iPhone!
   *Note: The first time you run an app from your developer account, your iPhone may say "Untrusted Developer". Simply go to iPhone Settings $\rightarrow$ General $\rightarrow$ VPN & Device Management $\rightarrow$ tap your Apple ID $\rightarrow$ Trust.*

---

## 3. Using the App

- **⚡ Brain Dump Mode**: Tap the floating microphone button on the home screen. Ramble your thoughts, tasks, and ideas freely. When you tap stop, Gemini automatically categorizes the note, files the conceptual idea under the right project, and adds any to-dos directly into your **Apple Reminders** app under the proper list (`First shift`, `Football`, `Personal`).
- **🎙️ Live Conversation Mode**: Switch to "Live Conversation" to speak back and forth out loud with your AI executive coach to brainstorm, refine ideas, or plan your day.
- **Projects Hub**: Tap into any project card to review open tasks, read your past voice brainstorms, or launch a voice session focused specifically on that project.
- **Settings**: Tap the gear icon in the top right to adjust your Supabase credentials or Gemini API key anytime directly on your phone.
