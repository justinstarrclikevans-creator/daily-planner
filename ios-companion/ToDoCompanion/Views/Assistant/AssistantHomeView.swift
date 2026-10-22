import SwiftUI

struct ProjectPrefill: Identifiable {
    var id = UUID()
    var name: String
    var goal: String
}

struct AssistantHomeView: View {
    @ObservedObject var supabase = SupabaseService.shared
    @ObservedObject var calendar = CalendarManager.shared
    @ObservedObject var reminders = RemindersManager.shared
    @StateObject private var voiceCapture = VoiceCaptureManager()
    
    @State private var inputText: String = ""
    @State private var messages: [ChatMessage] = [
        ChatMessage(
            role: "model",
            text: "Hey Justin. I'm connected to your Apple Reminders and Calendar. What's on your mind, or what can I help you tackle next?"
        )
    ]
    @State private var isProcessing: Bool = false
    @State private var showVoiceSheet: Bool = false
    @State private var scheduledSuccessToast: String? = nil
    @State private var activeFocusTask: TaskItem? = nil
    @State private var projectPrefill: ProjectPrefill? = nil
    
    private func isTaskVisibleNow(_ task: TaskItem) -> Bool {
        if let pid = task.projectId, let proj = supabase.projects.first(where: { $0.id == pid }) {
            return proj.isVisibleNow
        }
        if let proj = supabase.projects.first(where: { $0.name.caseInsensitiveCompare(task.listName) == .orderedSame }) {
            return proj.isVisibleNow
        }
        return true
    }
    
    var openTasks: [TaskItem] {
        supabase.tasks.filter { !$0.isCompleted && isTaskVisibleNow($0) }
    }
    
    var nextCalendarEvent: CalendarEventItem? {
        let now = Date()
        return calendar.todaysEvents.first { $0.endDate > now }
    }
    
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Header Pulse Bar
                pulseBanner
                    .padding(.horizontal)
                    .padding(.top, 8)
                
                // Suggestion Prompt Chips
                suggestionChips
                    .padding(.vertical, 8)
                
                Divider()
                
                // Chat Stream
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 16) {
                            ForEach(messages) { msg in
                                ChatMessageBubbleView(
                                    message: msg,
                                    onSchedule: { title, date, minutes in
                                        scheduleEventOnCalendar(title: title, date: date, minutes: minutes)
                                    },
                                    onFocus: { title in
                                        focusTaskByTitle(title: title)
                                    },
                                    onCreateProject: { name, goal in
                                        projectPrefill = ProjectPrefill(name: name, goal: goal)
                                    }
                                )
                                .id(msg.id)
                            }
                            
                            if isProcessing {
                                HStack(spacing: 8) {
                                    ProgressView()
                                        .controlSize(.small)
                                    Text("Thinking...")
                                        .font(.subheadline)
                                        .foregroundColor(.secondary)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal)
                                .id("thinking_indicator")
                            }
                        }
                        .padding()
                    }
                    .onChange(of: messages.count) { _ in
                        withAnimation {
                            if let last = messages.last {
                                proxy.scrollTo(last.id, anchor: .bottom)
                            }
                        }
                    }
                    .onChange(of: isProcessing) { proc in
                        if proc {
                            withAnimation {
                                proxy.scrollTo("thinking_indicator", anchor: .bottom)
                            }
                        }
                    }
                }
                
                // Success Toast
                if let toast = scheduledSuccessToast {
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                        Text(toast)
                            .font(.caption)
                            .fontWeight(.medium)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(20)
                    .padding(.bottom, 6)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
                
                // Bottom Persistent Brain Dump / Input Bar
                bottomInputBar
            }
            .navigationTitle("Assistant")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        Task {
                            await calendar.refreshEvents()
                            await supabase.fetchAll()
                        }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .font(.subheadline)
                    }
                }
            }
            .sheet(isPresented: $showVoiceSheet) {
                VoiceSheetView(activeProject: nil)
            }
            .sheet(item: $activeFocusTask) { task in
                TaskFocusSheetView(task: binding(for: task))
            }
            .sheet(item: $projectPrefill) { prefill in
                CreateProjectSheetView(prefillName: prefill.name, prefillGoal: prefill.goal)
            }
            .task {
                await calendar.refreshEvents()
            }
        }
    }
    
    // MARK: - Pulse Banner
    private var pulseBanner: some View {
        HStack(spacing: 14) {
            // Next event or tasks status
            VStack(alignment: .leading, spacing: 3) {
                if let next = nextCalendarEvent {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(Color.blue)
                            .frame(width: 8, height: 8)
                        Text("UPCOMING")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundColor(.blue)
                    }
                    Text(next.title)
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .lineLimit(1)
                    Text(next.timeString)
                        .font(.caption)
                        .foregroundColor(.secondary)
                } else {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(Color.green)
                            .frame(width: 8, height: 8)
                        Text("CALENDAR CLEAR")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundColor(.green)
                    }
                    Text("No upcoming meetings today")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                    Text("\(openTasks.count) open to-dos in Reminders")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            
            Spacer()
            
            // 1-Tap Brain Dump Floating Action
            Button {
                showVoiceSheet = true
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "mic.fill")
                    Text("Dump")
                        .font(.caption)
                        .fontWeight(.bold)
                }
                .foregroundColor(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(Color.indigo)
                .cornerRadius(20)
            }
        }
        .padding(12)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(16)
    }
    
    // MARK: - Suggestion Chips
    private var suggestionChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Button {
                    sendQuickPrompt("I have three hours, give me a list of todos I can do during that time based on the times assigned to the tasks.")
                } label: {
                    Label("3-Hour Plan", systemImage: "clock.badge")
                        .font(.caption)
                        .fontWeight(.bold)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(Color.indigo.opacity(0.15))
                        .foregroundColor(.indigo)
                        .cornerRadius(16)
                }
                
                Button {
                    sendQuickPrompt("I have 15 minutes, what is something I could knock out.")
                } label: {
                    Label("15m Quick Win", systemImage: "bolt.fill")
                        .font(.caption)
                        .fontWeight(.medium)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(Color.orange.opacity(0.12))
                        .foregroundColor(.orange)
                        .cornerRadius(16)
                }
                
                Button {
                    sendQuickPrompt("I have 45 minutes, give me 1 or 2 focused tasks to crush.")
                } label: {
                    Label("45m Sprint", systemImage: "timer")
                        .font(.caption)
                        .fontWeight(.medium)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(Color.green.opacity(0.12))
                        .foregroundColor(.green)
                        .cornerRadius(16)
                }
                
                Button {
                    sendQuickPrompt("Do I have 3 or more todos that should be promoted into a project under the Rule of 3?")
                } label: {
                    Label("Rule of 3 Audit", systemImage: "folder.badge.plus")
                        .font(.caption)
                        .fontWeight(.medium)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(Color.yellow.opacity(0.15))
                        .foregroundColor(.orange)
                        .cornerRadius(16)
                }
                
                Button {
                    sendQuickPrompt("What does my day look like tomorrow?")
                } label: {
                    Label("Tomorrow's Agenda", systemImage: "calendar")
                        .font(.caption)
                        .fontWeight(.medium)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(Color.blue.opacity(0.12))
                        .foregroundColor(.blue)
                        .cornerRadius(16)
                }
                
                Button {
                    sendQuickPrompt("Can you schedule me time to work on some of my todos tomorrow?")
                } label: {
                    Label("Time-Block Todos", systemImage: "clock.badge.checkmark")
                        .font(.caption)
                        .fontWeight(.medium)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(Color.purple.opacity(0.12))
                        .foregroundColor(.purple)
                        .cornerRadius(16)
                }
                
                Button {
                    showVoiceSheet = true
                } label: {
                    Label("Voice Brain Dump", systemImage: "waveform")
                        .font(.caption)
                        .fontWeight(.medium)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(Color.indigo.opacity(0.12))
                        .foregroundColor(.indigo)
                        .cornerRadius(16)
                }
            }
            .padding(.horizontal)
        }
    }
    
    // MARK: - Bottom Input Bar
    private var bottomInputBar: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 12) {
                Button {
                    showVoiceSheet = true
                } label: {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 18))
                        .foregroundColor(.indigo)
                        .frame(width: 36, height: 36)
                        .background(Color.indigo.opacity(0.12))
                        .clipShape(Circle())
                }
                
                TextField("Brain dump or ask anything...", text: $inputText)
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(20)
                    .onSubmit {
                        submitUserMessage()
                    }
                
                if !inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Button {
                        submitUserMessage()
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 32))
                            .foregroundColor(.indigo)
                    }
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 10)
            .background(Color(.systemBackground))
        }
    }
    
    // MARK: - Actions
    private func sendQuickPrompt(_ prompt: String) {
        inputText = prompt
        submitUserMessage()
    }
    
    private func submitUserMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        
        inputText = ""
        let userMsg = ChatMessage(role: "user", text: text)
        messages.append(userMsg)
        
        isProcessing = true
        
        Task {
            // Refresh schedule context first
            await calendar.refreshEvents()
            
            let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
            let freeSlots = calendar.findFreeSlots(for: tomorrow, minMinutes: 15)
            
            do {
                let reply = try await GeminiVoiceService.shared.assistantChat(
                    history: messages,
                    tasks: openTasks,
                    projects: supabase.projects,
                    todayEvents: calendar.todaysEvents,
                    tomorrowEvents: calendar.tomorrowsEvents,
                    freeSlotsTomorrow: freeSlots
                )
                
                await MainActor.run {
                    self.messages.append(reply)
                    self.isProcessing = false
                }
            } catch {
                await MainActor.run {
                    self.messages.append(ChatMessage(role: "model", text: "Sorry, I had trouble connecting to the assistant engine: \(error.localizedDescription)"))
                    self.isProcessing = false
                }
            }
        }
    }
    
    private func scheduleEventOnCalendar(title: String, date: Date?, minutes: Int?) {
        guard let date = date else { return }
        let duration = minutes ?? 30
        
        Task {
            do {
                let success = try await calendar.scheduleFocusBlock(
                    title: title,
                    startDate: date,
                    durationMinutes: duration,
                    notes: "Focus block scheduled by ToDo Companion Assistant."
                )
                if success {
                    await MainActor.run {
                        withAnimation {
                            scheduledSuccessToast = "Added '\(title)' to Apple Calendar!"
                        }
                    }
                    try? await Task.sleep(nanoseconds: 3_500_000_000)
                    await MainActor.run {
                        withAnimation {
                            scheduledSuccessToast = nil
                        }
                    }
                }
            } catch {
                print("Failed to schedule: \(error)")
            }
        }
    }
    
    private func focusTaskByTitle(title: String) {
        if let matched = openTasks.first(where: { $0.title.caseInsensitiveCompare(title) == .orderedSame || $0.title.localizedCaseInsensitiveContains(title) }) {
            self.activeFocusTask = matched
        }
    }
    
    private func binding(for task: TaskItem) -> Binding<TaskItem> {
        guard let index = supabase.tasks.firstIndex(where: { $0.id == task.id }) else {
            return .constant(task)
        }
        return $supabase.tasks[index]
    }
}

// MARK: - Bubble Subview
struct ChatMessageBubbleView: View {
    var message: ChatMessage
    var onSchedule: (String, Date?, Int?) -> Void
    var onFocus: (String) -> Void
    var onCreateProject: (String, String) -> Void
    
    var isUser: Bool {
        message.role == "user"
    }
    
    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 40) }
            
            VStack(alignment: isUser ? .trailing : .leading, spacing: 8) {
                Text(message.text)
                    .font(.body)
                    .foregroundColor(isUser ? .white : .primary)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(isUser ? Color.indigo : Color(.secondarySystemBackground))
                    .cornerRadius(18)
                
                // Suggested Action Cards (Focus or Schedule)
                if let actionType = message.suggestedActionType {
                    if actionType == "focus", let taskTitle = message.suggestedActionTitle {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Label("Quick Win Focus", systemImage: "bolt.fill")
                                    .font(.caption)
                                    .fontWeight(.bold)
                                    .foregroundColor(.orange)
                                Spacer()
                                Text("⏱ \(message.suggestedActionMinutes ?? 15)m")
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                            
                            Text(taskTitle)
                                .font(.subheadline)
                                .fontWeight(.semibold)
                            
                            if let prompt = message.suggestedActionPrompt {
                                Text("⚡ First step: \(prompt)")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            
                            Button {
                                onFocus(taskTitle)
                            } label: {
                                HStack {
                                    Image(systemName: "play.fill")
                                    Text("Open Focus Session")
                                }
                                .font(.caption)
                                .fontWeight(.bold)
                                .foregroundColor(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 8)
                                .background(Color.green)
                                .cornerRadius(10)
                            }
                            .padding(.top, 4)
                        }
                        .padding(12)
                        .background(Color(.tertiarySystemBackground))
                        .cornerRadius(14)
                        .overlay(
                            RoundedRectangle(cornerRadius: 14)
                                .stroke(Color.orange.opacity(0.3), lineWidth: 1)
                        )
                    } else if actionType == "schedule", let taskTitle = message.suggestedActionTitle, let date = message.suggestedActionDate {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Label("Schedule Focus Block", systemImage: "calendar.badge.clock")
                                    .font(.caption)
                                    .fontWeight(.bold)
                                    .foregroundColor(.blue)
                                Spacer()
                                Text("⏱ \(message.suggestedActionMinutes ?? 30)m")
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                            
                            Text(taskTitle)
                                .font(.subheadline)
                                .fontWeight(.semibold)
                            
                            Text("Proposed: \(date.formatted(date: .abbreviated, time: .shortened))")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            
                            Button {
                                onSchedule(taskTitle, date, message.suggestedActionMinutes)
                            } label: {
                                HStack {
                                    Image(systemName: "calendar.badge.plus")
                                    Text("Add to Apple Calendar")
                                }
                                .font(.caption)
                                .fontWeight(.bold)
                                .foregroundColor(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 8)
                                .background(Color.blue)
                                .cornerRadius(10)
                            }
                            .padding(.top, 4)
                        }
                        .padding(12)
                        .background(Color(.tertiarySystemBackground))
                        .cornerRadius(14)
                        .overlay(
                            RoundedRectangle(cornerRadius: 14)
                                .stroke(Color.blue.opacity(0.3), lineWidth: 1)
                        )
                    } else if actionType == "create_project", let projectName = message.suggestedActionTitle {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Label("Rule of 3: New Project", systemImage: "folder.badge.plus")
                                    .font(.caption)
                                    .fontWeight(.bold)
                                    .foregroundColor(.orange)
                                Spacer()
                            }
                            
                            Text(projectName)
                                .font(.subheadline)
                                .fontWeight(.semibold)
                            
                            if let goal = message.suggestedActionPrompt {
                                Text("Goal: \(goal)")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            
                            Button {
                                onCreateProject(projectName, message.suggestedActionPrompt ?? "")
                            } label: {
                                HStack {
                                    Image(systemName: "plus.circle.fill")
                                    Text("Create Dedicated Project")
                                }
                                .font(.caption)
                                .fontWeight(.bold)
                                .foregroundColor(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 8)
                                .background(Color.orange)
                                .cornerRadius(10)
                            }
                            .padding(.top, 4)
                        }
                        .padding(12)
                        .background(Color(.tertiarySystemBackground))
                        .cornerRadius(14)
                        .overlay(
                            RoundedRectangle(cornerRadius: 14)
                                .stroke(Color.orange.opacity(0.3), lineWidth: 1)
                        )
                    }
                }
            }
            
            if !isUser { Spacer(minLength: 40) }
        }
    }
}
