import SwiftUI

struct ProjectsHubView: View {
    @ObservedObject private var supabase = SupabaseService.shared
    @State private var showVoiceSheet: Bool = false
    @State private var showSettings: Bool = false
    @State private var showBuildMyDay: Bool = false
    @State private var showCreateProject: Bool = false
    @State private var suggestedProjectName: String? = nil
    @State private var showAllProjectsOverride: Bool = false
    @State private var selectedFilter: TaskFilter = .all
    @State private var activeFocusTask: TaskItem? = nil
    @State private var editingPlaybookProject: Project? = nil
    @State private var taskForProjectConversion: TaskItem? = nil
    
    enum TaskFilter: String, CaseIterable, Identifiable {
        case all = "All"
        case high = "🔥 High Priority"
        case quickWins = "⚡ Quick Hits (≤15m)"
        case deepFocus = "🎯 Deep Work (>15m)"
        
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
    
    private var filteredTasks: [TaskItem] {
        let pool = supabase.tasks.filter { isTaskVisibleNow($0) && !$0.isCompleted }
        switch selectedFilter {
        case .all:
            return pool
        case .high:
            return pool.filter { $0.isHighPriority }
        case .quickWins:
            return pool.filter { $0.estimatedMinutes <= 15 }
        case .deepFocus:
            return pool.filter { $0.estimatedMinutes > 15 }
        }
    }
    
    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottomTrailing) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        // Header with Greeting & Build My Day Hero
                        headerSection
                        
                        // Active Projects Grid
                        projectsSection
                        
                        // Action Items & Filters
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
            .navigationTitle("Projects")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button {
                        showBuildMyDay = true
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "bolt.fill")
                                .foregroundColor(.yellow)
                            Text("Build Day")
                                .font(.caption)
                                .fontWeight(.bold)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Color.indigo)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                    }
                }
                
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
            .sheet(isPresented: $showBuildMyDay) {
                BuildMyDaySheet()
            }
            .sheet(isPresented: $showVoiceSheet) {
                VoiceSheetView()
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
            .sheet(isPresented: $showCreateProject) {
                CreateProjectSheetView(prefillName: suggestedProjectName ?? "")
            }
            .sheet(item: $activeFocusTask) { task in
                TaskFocusSheetView(task: binding(for: task))
            }
            .sheet(item: $editingPlaybookProject) { project in
                ProjectPlaybookEditorView(project: project)
            }
            .sheet(item: $taskForProjectConversion) { task in
                ConvertTaskToProjectSheet(task: task)
            }
        }
    }
    
    // MARK: - Header
    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(greetingText)
                    .font(.title2)
                    .fontWeight(.bold)
                
                HStack(spacing: 8) {
                    Circle()
                        .fill(AppConfig.isSupabaseConfigured ? Color.green : Color.orange)
                        .frame(width: 8, height: 8)
                    
                    Text(AppConfig.isSupabaseConfigured ? "Live Sync Active" : "Local Mode")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            
            // Build My Day Hero Banner
            Button {
                showBuildMyDay = true
            } label: {
                HStack(spacing: 14) {
                    ZStack {
                        Circle()
                            .fill(Color.white.opacity(0.2))
                            .frame(width: 44, height: 44)
                        Image(systemName: "bolt.fill")
                            .font(.title3)
                            .foregroundColor(.yellow)
                    }
                    
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Build My Day")
                            .font(.headline)
                            .fontWeight(.bold)
                            .foregroundColor(.white)
                        Text("Auto-fit top priority tasks into your available time budget")
                            .font(.caption2)
                            .foregroundColor(.white.opacity(0.85))
                    }
                    
                    Spacer()
                    
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.bold))
                        .foregroundColor(.white.opacity(0.75))
                }
                .padding(14)
                .background(
                    LinearGradient(
                        colors: [Color.indigo, Color.purple],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .cornerRadius(16)
                .shadow(color: Color.indigo.opacity(0.3), radius: 8, x: 0, y: 4)
            }
            .buttonStyle(.plain)
        }
        .padding(.top, 4)
    }
    
    private var greetingText: String {
        let hour = Calendar.current.component(.hour, from: Date())
        if hour < 12 { return "Good morning, Justin" }
        if hour < 17 { return "Good afternoon, Justin" }
        return "Good evening, Justin"
    }

    // MARK: - Projects Section
    private var projectsSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Projects")
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
                LazyVStack(spacing: 12) {
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
                            Button {
                                editingPlaybookProject = project
                            } label: {
                                Label("Set Visibility Hours & Playbook", systemImage: "clock.badge.checkmark")
                            }
                            
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
    
    // MARK: - Action Items Section
    private var recentTasksSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Action Items")
                    .font(.headline)
                Spacer()
                Text("\(filteredTasks.count) open")
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
                LazyVStack(spacing: 10) {
                    ForEach(filteredTasks) { task in
                        TaskItemRowView(
                            task: task,
                            onConvertToProject: {
                                taskForProjectConversion = task
                            },
                            onStartSprint: {
                                activeFocusTask = task
                            }
                        )
                    }
                }
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
