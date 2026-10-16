---
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Plan: Native iOS Companion App (Voice Brain-Dump & Project Hub)

## Goal Capsule

- **Objective**: Create a native SwiftUI iOS companion app for personal project management, featuring dual-mode voice interaction (Tap-to-talk Brain Dump + Conversational AI Chat), an Active Projects Hub, bidirectional Apple Reminders integration via EventKit, and real-time cloud synchronization with the Mac desktop daemon via Supabase.
- **Means**:
  - Native SwiftUI iOS application (iOS 17+) configured in Xcode.
  - Supabase PostgreSQL backend with native Realtime for instant synchronization between Mac daemon and iPhone.
  - Dual-mode voice subsystem: Apple `AVFoundation` / `Speech` + Gemini 2.5 Flash for high-speed idea parsing, task extraction, and spoken conversational responses.
  - Apple `EventKit` framework for native Apple Reminders integration directly on device.
  - Mac Daemon extension using `@supabase/supabase-js` to mirror extracted Gmail, Slack, and iMessage tasks into Supabase in real-time.
- **Stop Conditions**: The app is built, running in the iOS Simulator or physical iPhone via Xcode, connected to Supabase, able to record voice brain-dumps, extract tasks into Apple Reminders, and view active project ideas.

---

## Product Contract

### Actors
- **Primary User**: Justin (single user, executive & personal workflows across Turn90 First Shift, Albertine Initiative, Football/843, and Personal projects).
- **AI Engine**: Gemini API handling voice transcription analysis, intent routing, and conversational responses.
- **Mac Daemon**: Background collector feeding Slack, Gmail, and Mac-synced iMessages into the system.

### Core User Flows

#### Flow 1: Tap-to-Talk Brain Dump (One-Way Capture)
1. User taps the floating microphone button on the iPhone home screen.
2. User rambles thoughts, notes, and tasks freely (e.g. while walking or driving).
3. User taps "Done" (or pauses).
4. Audio is transcribed and sent to Gemini:
   - Action items are identified and routed to Apple Reminders under the appropriate list (`First shift`, `Personal`, `Football`).
   - High-level ideas, analogies, and concepts are filed under the matching Project card in Supabase.
5. App chimes and displays a short summary card of captured items with undo/edit options.

#### Flow 2: Back-and-Forth Voice Conversation (Interactive Brainstorm)
1. User switches to "Voice Chat" mode.
2. User speaks out loud: *"What are my top priorities for First Shift this week, and what did we discuss about Steve?"*
3. App queries Supabase for recent context, sends prompt to Gemini, and streams back an audio response with natural voice.
4. User can brainstorm back and forth out loud until ideas are refined into concrete action items.

#### Flow 3: Active Projects Hub
1. App presents clean, distraction-free project cards:
   - **First Shift** (Turn90 Core)
   - **Albertine Initiative** (North Charleston Project)
   - **Football / 843** (Rec & Coaching)
   - **Personal**
2. Each card surfaces:
   - Current North Star / Goal.
   - Recent Brain-Dumped Ideas (chronological, searchable).
   - Immediate Next Actions (synced with Apple Reminders).

#### Flow 4: Mac Daemon $\rightarrow$ iPhone Real-Time Pipeline
1. Mac Daemon detects an action item from Gmail or Slack during background sync.
2. Mac Daemon writes the item to Supabase `tasks` table.
3. Supabase Realtime pushes the new task to the iPhone app immediately.
4. iPhone app displays the incoming item and optionally ensures it is present in on-device Apple Reminders.

### Requirements

- **R-1**: Must provide a low-friction, 1-tap voice recording interface with visual audio wave feedback.
- **R-2**: Must support dual voice modes: (1) Rapid capture brain-dump without interruption, and (2) Interactive conversational dialogue.
- **R-3**: Must classify voice content into the user's defined projects automatically via Gemini.
- **R-4**: Must sync actionable to-dos directly into iOS Apple Reminders via `EventKit`.
- **R-5**: Must maintain real-time bidirectional data synchronization with the Mac desktop daemon via Supabase.
- **R-6**: Must allow the user to view, edit, and organize ideas and tasks by project on their iPhone.
- **R-7**: Must be packaged for straightforward deployment to the user's physical iPhone via Xcode with their Apple Developer profile.

### Acceptance Examples

- *Example 1 (Voice Capture)*: User records: *"Need to make sure Kevin brings the cones for tomorrow's 843 practice and check on the field permit."* $\rightarrow$ App creates 2 Apple Reminders in the `Football` list and logs a note under the `Football / 843` project card.
- *Example 2 (Conversational Dialogue)*: User asks: *"Give me 3 angles for the Albertine community video."* $\rightarrow$ AI speaks back three punchy angles, and when user says *"Save the second one"*, it creates an idea entry in the `Albertine Initiative` project.
- *Example 3 (Daemon Sync)*: User receives an email from Turn90 HR on Gmail. The Mac daemon extracts a task $\rightarrow$ within 2 seconds, the task appears in the iPhone app's First Shift task list.

---

## Planning Contract

### Key Technical Decisions (KTDs)

- **KTD-1 (UI Framework)**: **SwiftUI (iOS 17+)** with Swift `@Observable` macros and modern async/await concurrency for clean state management and rapid responsive UI.
- **KTD-2 (Data Layer & Sync)**: **Supabase** via official `supabase-swift` SDK.
  - Tables:
    - `projects`: `id`, `name`, `color`, `icon`, `goal`, `created_at`
    - `ideas`: `id`, `project_id`, `raw_transcript`, `summary`, `tags`, `created_at`
    - `tasks`: `id`, `project_id`, `title`, `description`, `list_name`, `status`, `due_date`, `source`, `created_at`
  - Real-time subscriptions enabled on `tasks` and `ideas` for live cross-device updates.
- **KTD-3 (Voice Architecture)**:
  - Audio capture: `AVAudioRecorder` + Apple `SFSpeechRecognizer` for instant on-device real-time transcription preview.
  - High-fidelity intent parsing: Gemini 2.5 Flash API with JSON mode for structured task & idea classification.
  - Spoken response: Apple `AVSpeechSynthesizer` (zero latency, offline capable, no third-party audio costs).
- **KTD-4 (Apple Reminders Bridge)**:
  - iOS `EventKit` (`EKEventStore`) with `requestFullAccessToReminders()` to read and create reminders natively in the user's iCloud Reminders lists.
- **KTD-5 (Mac Daemon Extension)**:
  - Add `@supabase/supabase-js` to `mac-daemon/package.json`.
  - In `sync.js`, after tasks are extracted or completed, sync them to the Supabase `tasks` table.

---

## Implementation Units

### U-1: Supabase Database Schema & Mac Daemon Bridge
- **Files**:
  - `mac-daemon/supabase.js` (new)
  - `mac-daemon/sync.js` (modify)
  - `mac-daemon/package.json` (add `@supabase/supabase-js`)
  - `supabase/schema.sql` (migration script)
- **Work**:
  1. Define PostgreSQL schema for `projects`, `ideas`, and `tasks` with foreign keys and indexes.
  2. Write Supabase helper module in `mac-daemon` for inserting/updating tasks and reading pending items.
  3. Wire `sync.js` to push newly extracted action items to Supabase during sync cycles.
- **Verification**: Run a test script in `mac-daemon` to insert a mock task and verify it appears in Supabase.

### U-2: Xcode iOS Project Scaffolding & Dependencies
- **Files**:
  - `ios-companion/ToDoCompanion.xcodeproj`
  - `ios-companion/ToDoCompanion/App/ToDoCompanionApp.swift`
  - `ios-companion/ToDoCompanion/Config/Secrets.swift`
  - `ios-companion/ToDoCompanion/Info.plist`
- **Work**:
  1. Scaffold native SwiftUI iOS project target with bundle ID configured for the user's Apple Developer Team.
  2. Add Swift Package dependency: `supabase-swift`.
  3. Configure `Info.plist` permissions with user-friendly descriptions:
     - `NSSpeechRecognitionUsageDescription`
     - `NSMicrophoneUsageDescription`
     - `NSRemindersFullAccessUsageDescription`
- **Verification**: Project compiles cleanly with no missing symbols in Xcode.

### U-3: Data Models & Supabase Client (iOS)
- **Files**:
  - `ios-companion/ToDoCompanion/Models/Project.swift`
  - `ios-companion/ToDoCompanion/Models/Idea.swift`
  - `ios-companion/ToDoCompanion/Models/TaskItem.swift`
  - `ios-companion/ToDoCompanion/Services/SupabaseService.swift`
- **Work**:
  1. Define Codable Swift structs matching the database tables.
  2. Implement `SupabaseService` with real-time channel subscriptions to stream project cards, ideas, and tasks directly into SwiftUI `@Observable` view models.
- **Verification**: Unit test / preview fetching mock projects from Supabase.

### U-4: Dual-Mode Voice Engine (Audio Capture + Gemini Intelligence)
- **Files**:
  - `ios-companion/ToDoCompanion/Services/VoiceCaptureManager.swift`
  - `ios-companion/ToDoCompanion/Services/GeminiVoiceService.swift`
  - `ios-companion/ToDoCompanion/Services/SpeechSynthesisService.swift`
  - `ios-companion/ToDoCompanion/Views/Voice/VoiceSheetView.swift`
- **Work**:
  1. `VoiceCaptureManager`: Audio recording, real-time waveform calculation, and local speech-to-text fallback.
  2. `GeminiVoiceService`: Communicates with Gemini API. Implements two prompt pipelines:
     - **Brain Dump Pipeline**: Extracts `{ project: string, ideas: string[], tasks: [{ title: string, list: string }] }`.
     - **Conversational Pipeline**: Accepts dialog history + project context, returns `{ spokenReply: string, suggestedActions: TaskItem[] }`.
  3. `SpeechSynthesisService`: Plays natural spoken replies via `AVSpeechSynthesizer`.
  4. `VoiceSheetView`: Bottom-sheet modal with interactive mic visualizer, live transcription text, and mode toggle (Brain-Dump vs Dialogue).
- **Verification**: Recording voice generates structured JSON tasks and projects via Gemini in test runs.

### U-5: Active Projects Hub & Task Views
- **Files**:
  - `ios-companion/ToDoCompanion/Views/Projects/ProjectsHubView.swift`
  - `ios-companion/ToDoCompanion/Views/Projects/ProjectCardView.swift`
  - `ios-companion/ToDoCompanion/Views/Projects/ProjectDetailView.swift`
  - `ios-companion/ToDoCompanion/Views/Tasks/TaskListView.swift`
- **Work**:
  1. Build `ProjectsHubView` showcasing cards for *First Shift*, *Albertine*, *Football*, and *Personal*.
  2. Inside each card, display the active objective, number of open tasks, and latest voice ideas.
  3. Tapping a card opens `ProjectDetailView` with filtered task checklist and idea stream.
- **Verification**: SwiftUI Previews render accurately with light and dark mode support.

### U-6: Apple Reminders Integration (EventKit)
- **Files**:
  - `ios-companion/ToDoCompanion/Services/RemindersManager.swift`
- **Work**:
  1. Implement `RemindersManager` using `EKEventStore`.
  2. Sync tasks between Supabase and local Apple Reminders lists.
  3. When Gemini extracts a task on phone, add it directly to Apple Reminders and mirror to Supabase.
- **Verification**: Triggering a voice task creates an actual reminder in the user's Apple Reminders app.

### U-7: Device Deployment & Build Guide
- **Files**:
  - `ios-companion/README.md`
- **Work**:
  1. Provide clear, straightforward instructions for opening the project in Xcode, selecting the user's connected iPhone, and building directly to hardware.
  2. Provide instructions for uploading an Internal Build to TestFlight via Xcode organizer.
- **Verification**: App installs and runs natively on the user's physical iPhone.

---

## Verification Contract

### Test & Build Commands
- **Mac Daemon**:
  ```bash
  cd "/Users/justinevans/Desktop/ToDo App/mac-daemon"
  npm test # or node -e "require('./supabase')"
  ```
- **iOS App (Xcode command-line build)**:
  ```bash
  cd "/Users/justinevans/Desktop/ToDo App/ios-companion"
  xcodebuild -scheme ToDoCompanion -destination 'platform=iOS Simulator,name=iPhone 16' build
  ```

### Acceptance Checklist
1. Voice recording accurately captures rambling audio on device.
2. Gemini parses project, ideas, and tasks accurately.
3. Apple Reminders receives tasks under the right list.
4. Supabase stores ideas and tasks, syncing them between Mac daemon and iPhone.
5. App runs on physical iPhone via Xcode.

---

## Definition of Done

- All 7 implementation units completed.
- Supabase schema deployed and connected.
- Mac daemon syncing to Supabase.
- iOS companion app builds without errors and runs in simulator / physical device.
- End-to-end voice test verified: speak task $\rightarrow$ appears in Apple Reminders and Supabase.
