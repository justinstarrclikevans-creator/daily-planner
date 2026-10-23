import SwiftUI

struct ProjectsHubView: View {
    @ObservedObject private var supabase = SupabaseService.shared
    @State private var showVoiceSheet: Bool = false
    @State private var showSettings: Bool = false
    @State private var showRoutineLibrary: Bool = false
    @State private var showCreateProject: Bool = false
    @State private var suggestedProjectName: String? = nil
    @State private var showAllProjectsOverride: Bool = false
    @State private var playDeckIndex: Int = 0
    @State private var selectedFilter: TaskFilter = .all
    @State private var activeFocusTask: TaskItem? = nil
    
    enum TaskFilter: String, CaseIterable, Identifiable {
        case all = "All"
        case queue = "▶️ Play Queue"
        case quickWins = "⚡ Quick Wins (≤10m)"
        case deepFocus = "🎯 15–30m"
        
        var id: String { rawValue }
    }
    
    private func isTaskVisibleNow(_ task: TaskItem) -> Bool {
        if showAllProjectsOverride { return true }
        if let pid = task.projectId, let proj = supabase.projects.first(where: { $0.id == pid }) {
            return proj.isVisibleNow
        }
        if let proj = supabase.projects.first(where: { $0.name.caseInsensitiveCompare(task.listName) == .orderedSame }) {
            return proj.isVisibleNow
        }
        return true
    }
    
    private var visibleProjects: [Project] {
        if showAllProjectsOverride {
            return supabase.projects
        }
        return supabase.projects.filter { $0.isVisibleNow }
    }
    
    private var hiddenProjectsCount: Int {
        supabase.projects.filter { !$0.isVisibleNow }.count
    }
    
    private var detectedRuleOfThreeTopic: String? {
        let unassignedTasks = supabase.tasks.filter { task in
            !task.isCompleted && (task.projectId == nil || task.listName.caseInsensitiveCompare("Personal") == .orderedSame)
        }
        
        var wordCounts: [String: Int] = [:]
        let stopWords: Set<String> = ["with", "from", "that", "this", "have", "call", "send", "review", "email", "check", "need", "update", "make", "task", "todo", "meet", "prep"]
        
        for task in unassignedTasks {
            let words = task.title.lowercased()
                .components(separatedBy: CharacterSet.alphanumerics.inverted)
                .filter { $0.count >= 4 && !stopWords.contains($0) }
            for w in Set(words) {
                wordCounts[w, default: 0] += 1
            }
        }
        
        if let (word, _) = wordCounts.first(where: { $0.value >= 3 }) {
            return word.capitalized
        }
        return nil
    }
    
    private var queuedTasks: [TaskItem] {
        supabase.tasks.filter { $0.inPlayQueue && !$0.isCompleted && isTaskVisibleNow($0) }
    }
    
    private var filteredTasks: [TaskItem] {
        let pool = supabase.tasks.filter { isTaskVisibleNow($0) }
        switch selectedFilter {
        case .all:
            return Array(pool.prefix(12))
        case .queue:
            return queuedTasks
        case .quickWins:
            return pool.filter { !$0.isCompleted && $0.estimatedMinutes <= 10 }
        case .deepFocus:
            return pool.filter { !$0.isCompleted && $0.estimatedMinutes >= 15 && $0.estimatedMinutes <= 30 }
        }
    }
    
    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottomTrailing) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        // Header
                        headerSection
                        
                        // Rule of 3 Suggestion Banner
                        if let topic = detectedRuleOfThreeTopic {
                            ruleOfThreeBanner(for: topic)
                        }
                        
                        // Today's Play Queue Spotlight / Play Deck (Tiimo-Style)
                        playQueueSpotlightSection
                        
                        // Active Projects Grid
                        projectsSection
                        
                        // Filter Pills & Action Items
                        recentTasksSection
                    }
                    .padding()
                    .padding(.bottom, 80) // Padding for floating mic button
                }
                .refreshable {
                    await supabase.fetchAll()
                    await RemindersManager.shared.importDeviceRemindersToSupabase()
                }
                .task {
                    await supabase.fetchAll()
                    await RemindersManager.shared.importDeviceRemindersToSupabase()
                }
                
                // Floating Voice Mic Button
                floatingMicButton
            }
            .navigationTitle("Projects Hub")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    HStack(spacing: 14) {
                        Button {
                            suggestedProjectName = nil
                            showCreateProject = true
                        } label: {
                            Image(systemName: "plus")
                                .foregroundColor(.indigo)
                        }
                        
                        Button {
                            showRoutineLibrary = true
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "sparkles")
                                Text("Routines")
                                    .font(.caption)
                                    .fontWeight(.bold)
                            }
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color.indigo.opacity(0.12))
                            .foregroundColor(.indigo)
                            .cornerRadius(8)
                        }
                        
                        Button {
                            Task {
                                await supabase.fetchAll()
                                await RemindersManager.shared.importDeviceRemindersToSupabase()
                            }
                        } label: {
                            Image(systemName: "arrow.triangle.2.circlepath")
                                .foregroundColor(.indigo)
                        }
                        
                        Button {
                            showSettings = true
                        } label: {
                            Image(systemName: "gearshape")
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }
            .sheet(isPresented: $showVoiceSheet) {
                VoiceSheetView()
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
            .sheet(isPresented: $showRoutineLibrary) {
                RoutineLibrarySheetView()
            }
            .sheet(isPresented: $showCreateProject) {
                CreateProjectSheetView(prefillName: suggestedProjectName ?? "")
            }
            .sheet(item: $activeFocusTask) { task in
                TaskFocusSheetView(task: binding(for: task))
            }
        }
    }
    
    // MARK: - Header
    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(greetingText)
                .font(.title2)
                .fontWeight(.bold)
            
            HStack(spacing: 8) {
                Circle()
                    .fill(AppConfig.isSupabaseConfigured ? Color.green : Color.orange)
                    .frame(width: 8, height: 8)
                
                Text(AppConfig.isSupabaseConfigured ? "Live Sync Active" : "Local Mode (Add Supabase keys in Settings)")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.top, 4)
    }
    
    private var greetingText: String {
        let hour = Calendar.current.component(.hour, from: Date())
        if hour < 12 { return "Good morning, Justin" }
        if hour < 17 { return "Good afternoon, Justin" }
        return "Good evening, Justin"
    }
    
    // MARK: - Today's Play Queue Deck (Tiimo-Style Anytime Flow)
    private var playQueueSpotlightSection: some View {
        Group {
            if queuedTasks.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Label("Play Queue (Anytime Deck)", systemImage: "play.circle.fill")
                            .font(.headline)
                            .foregroundColor(.indigo)
                        Spacer()
                        Button {
                            showRoutineLibrary = true
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "sparkles")
                                Text("Explore Routines")
                            }
                            .font(.caption)
                            .fontWeight(.bold)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(Color.indigo.opacity(0.12))
                            .foregroundColor(.indigo)
                            .cornerRadius(8)
                        }
                    }
                    Text("No tasks active in your Play Queue right now. Deploy a ready-to-go routine above or tap +Queue on any task below to build momentum without calendar pressure.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(16)
                .background(Color(.secondarySystemBackground))
                .cornerRadius(16)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Label("Play Queue Deck", systemImage: "play.circle.fill")
                            .font(.headline)
                            .foregroundColor(.white)
                        
                        Spacer()
                        
                        let totalMins = queuedTasks.reduce(0) { $0 + $1.estimatedMinutes }
                        Text("\(queuedTasks.count) items • \(totalMins)m total")
                            .font(.caption)
                            .fontWeight(.bold)
                            .foregroundColor(.white.opacity(0.85))
                    }
                    
                    let safeIndex = min(max(0, playDeckIndex), queuedTasks.count - 1)
                    let current = queuedTasks[safeIndex]
                    
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text("CARD \(safeIndex + 1) OF \(queuedTasks.count)")
                                .font(.system(size: 10, weight: .black))
                                .tracking(1)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.white.opacity(0.2))
                                .foregroundColor(.white)
                                .cornerRadius(4)
                            
                            Text(current.listName)
                                .font(.caption2)
                                .fontWeight(.bold)
                                .foregroundColor(.white.opacity(0.8))
                            
                            Spacer()
                            
                            Text("⏱ \(current.estimatedMinutes)m estimated")
                                .font(.caption2)
                                .fontWeight(.bold)
                                .foregroundColor(.white.opacity(0.9))
                        }
                        
                        Text(current.title)
                            .font(.title3)
                            .fontWeight(.bold)
                            .foregroundColor(.white)
                        
                        if let starter = current.firstFiveMinutesPrompt, !starter.isEmpty {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("⚡ First 5-Minute Micro-Action:")
                                    .font(.caption2)
                                    .fontWeight(.bold)
                                    .foregroundColor(.yellow)
                                Text(starter)
                                    .font(.caption)
                                    .foregroundColor(.white.opacity(0.95))
                            }
                            .padding(8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.black.opacity(0.18))
                            .cornerRadius(8)
                        }
                        
                        // Action Bar: Focus Sprint, Tomorrow deferral, Next, Done
                        HStack(spacing: 8) {
                            Button {
                                activeFocusTask = current
                            } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: "play.fill")
                                    Text("Start 5m Sprint")
                                }
                                .font(.footnote)
                                .fontWeight(.bold)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 9)
                                .background(Color.white)
                                .foregroundColor(.indigo)
                                .cornerRadius(10)
                            }
                            
                            Button {
                                Task {
                                    await supabase.bumpTaskToTomorrow(task: current)
                                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                                }
                            } label: {
                                HStack(spacing: 4) {
                                    Image(systemName: "moon.fill")
                                    Text("Tomorrow")
                                }
                                .font(.caption)
                                .fontWeight(.semibold)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 9)
                                .background(Color.white.opacity(0.18))
                                .foregroundColor(.white)
                                .cornerRadius(10)
                            }
                            
                            Spacer()
                            
                            if queuedTasks.count > 1 {
                                Button {
                                    withAnimation(.easeInOut(duration: 0.2)) {
                                        playDeckIndex = (playDeckIndex + 1) % queuedTasks.count
                                    }
                                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                                } label: {
                                    Image(systemName: "forward.fill")
                                        .font(.caption)
                                        .padding(9)
                                        .background(Color.white.opacity(0.18))
                                        .foregroundColor(.white)
                                        .clipShape(Circle())
                                }
                            }
                            
                            Button {
                                Task {
                                    await supabase.toggleTaskCompletion(task: current)
                                    UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
                                }
                            } label: {
                                Image(systemName: "checkmark.circle.fill")
                                    .font(.title2)
                                    .foregroundColor(.white)
                            }
                        }
                        .padding(.top, 4)
                    }
                    .padding(16)
                    .background(Color.white.opacity(0.12))
                    .cornerRadius(14)
                }
                .padding(16)
                .background(
                    LinearGradient(
                        colors: [Color.indigo, Color.purple.opacity(0.85)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .cornerRadius(16)
                .shadow(color: Color.indigo.opacity(0.25), radius: 8, x: 0, y: 4)
            }
        }
    }
    
    // MARK: - Rule of 3 Banner
    private func ruleOfThreeBanner(for topic: String) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(Color.orange.opacity(0.18))
                    .frame(width: 36, height: 36)
                Image(systemName: "folder.badge.plus")
                    .foregroundColor(.orange)
                    .font(.footnote)
            }
            
            VStack(alignment: .leading, spacing: 2) {
                Text("Rule of 3: Emerging Project")
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundColor(.orange)
                Text("3+ tasks identified for '\(topic)'. Promote to a dedicated Project for custom schedule & playbook.")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(2)
            }
            
            Spacer()
            
            Button {
                suggestedProjectName = topic
                showCreateProject = true
            } label: {
                Text("Create")
                    .font(.caption)
                    .fontWeight(.bold)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Color.orange)
                    .foregroundColor(.white)
                    .cornerRadius(8)
            }
        }
        .padding(12)
        .background(Color.orange.opacity(0.08))
        .cornerRadius(12)
    }

    // MARK: - Projects Section
    private var projectsSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Active Focus Areas")
                    .font(.headline)
                    .foregroundColor(.primary)
                
                Spacer()
                
                Button {
                    suggestedProjectName = nil
                    showCreateProject = true
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "plus")
                        Text("New Project")
                    }
                    .font(.caption)
                    .fontWeight(.bold)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.indigo.opacity(0.12))
                    .foregroundColor(.indigo)
                    .cornerRadius(8)
                }
            }
            
            if hiddenProjectsCount > 0 {
                HStack(spacing: 6) {
                    Image(systemName: "clock.badge.exclamationmark")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                    Text("\(hiddenProjectsCount) project\(hiddenProjectsCount == 1 ? "" : "s") hidden by work/off-hours schedule")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                    Spacer()
                    Button(showAllProjectsOverride ? "Hide Scheduled" : "Show All") {
                        showAllProjectsOverride.toggle()
                    }
                    .font(.caption2)
                    .fontWeight(.bold)
                    .foregroundColor(.indigo)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color(.secondarySystemBackground))
                .cornerRadius(8)
            }
            
            if visibleProjects.isEmpty {
                VStack(spacing: 6) {
                    Image(systemName: "moon.stars.fill")
                        .font(.title2)
                        .foregroundColor(.secondary)
                    Text("All projects are currently off-schedule.")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                    Button("Show Hidden Projects") {
                        showAllProjectsOverride = true
                    }
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundColor(.indigo)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 20)
            } else {
                LazyVStack(spacing: 14) {
                    ForEach(visibleProjects) { project in
                        NavigationLink(destination: ProjectDetailView(project: project)) {
                            ProjectCardView(
                                project: project,
                                tasks: supabase.tasks,
                                ideas: supabase.ideas
                            )
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button(role: .destructive) {
                                Task {
                                    await supabase.deleteProject(projectId: project.id)
                                }
                            } label: {
                                Label("Delete Project", systemImage: "trash")
                            }
                        }
                    }
                }
            }
        }
    }
    
    // MARK: - Recent Tasks Section
    private var recentTasksSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Action Items")
                    .font(.headline)
                Spacer()
                Text("\(supabase.tasks.filter { !$0.isCompleted }.count) open")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            // Filter Pills
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(TaskFilter.allCases) { filter in
                        Button {
                            selectedFilter = filter
                        } label: {
                            Text(filter.rawValue)
                                .font(.caption)
                                .fontWeight(.semibold)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(selectedFilter == filter ? Color.indigo : Color(.secondarySystemBackground))
                                .foregroundColor(selectedFilter == filter ? .white : .primary)
                                .cornerRadius(12)
                        }
                    }
                }
            }
            
            if filteredTasks.isEmpty {
                VStack(spacing: 6) {
                    Image(systemName: "tray")
                        .font(.title2)
                        .foregroundColor(.secondary)
                    Text("No tasks match '\(selectedFilter.rawValue)'")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 24)
            } else {
                VStack(spacing: 8) {
                    ForEach(filteredTasks) { task in
                        TaskRowView(
                            task: task,
                            onToggle: {
                                Task {
                                    await supabase.toggleTaskCompletion(task: task)
                                }
                            },
                            onFocus: {
                                self.activeFocusTask = task
                            }
                        )
                        Divider()
                    }
                }
                .padding()
                .background(Color(.secondarySystemBackground))
                .cornerRadius(16)
            }
        }
    }
    
    // MARK: - Floating Mic Button
    private var floatingMicButton: some View {
        Button {
            showVoiceSheet = true
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "mic.fill")
                    .font(.title2)
                Text("Brain Dump")
                    .fontWeight(.semibold)
            }
            .foregroundColor(.white)
            .padding(.horizontal, 20)
            .padding(.vertical, 14)
            .background(
                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [.indigo, .purple],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .shadow(color: Color.indigo.opacity(0.4), radius: 10, x: 0, y: 5)
            )
        }
        .padding(.trailing, 20)
        .padding(.bottom, 20)
    }
    
    private func binding(for task: TaskItem) -> Binding<TaskItem> {
        Binding(
            get: {
                supabase.tasks.first(where: { $0.id == task.id }) ?? task
            },
            set: { updated in
                Task {
                    await supabase.updateTask(updated)
                }
            }
        )
    }
}

// MARK: - Settings View
struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage("supabase_url") private var supabaseURL = ""
    @AppStorage("supabase_anon_key") private var supabaseAnonKey = ""
    @AppStorage("gemini_api_key") private var geminiKey = ""
    
    var body: some View {
        NavigationStack {
            Form {
                Section("Supabase Cloud Sync") {
                    TextField("Project URL", text: $supabaseURL)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                    
                    SecureField("Anon Public Key", text: $supabaseAnonKey)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                }
                
                Section("Gemini AI API") {
                    SecureField("Gemini API Key", text: $geminiKey)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                }
                
                Section("About") {
                    Text("ToDo Companion v1.0")
                        .foregroundColor(.secondary)
                    Text("Syncs with Mac Desktop Daemon, Apple Reminders, and Supabase.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Save") {
                        Task {
                            await SupabaseService.shared.fetchAll()
                        }
                        dismiss()
                    }
                }
            }
        }
    }
}
