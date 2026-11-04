import SwiftUI

struct ProjectsHubView: View {
    @ObservedObject private var supabase = SupabaseService.shared
    @ObservedObject private var taggingService = TaggingRulesService.shared
    
    @AppStorage("selected_space") private var selectedSpace: String = "all"
    @AppStorage("selected_person") private var selectedPerson: String = "anyone"
    
    @State private var showVoiceSheet: Bool = false
    @State private var showSettings: Bool = false
    @State private var showBuildMyDay: Bool = false
    @State private var showCreateProject: Bool = false
    @State private var showCreateTask: Bool = false
    @State private var suggestedProjectName: String? = nil
    @State private var showAllProjectsOverride: Bool = false
    @State private var isProjectsExpanded: Bool = false
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
        let pool = supabase.tasks.filter { task in
            guard !task.isCompleted else { return false }
            guard isTaskVisibleNow(task) else { return false }
            guard task.matchesSpace(selectedSpace) else { return false }
            guard task.matchesPerson(selectedPerson) else { return false }
            
            switch selectedFilter {
            case .all:
                return true
            case .high:
                return task.isHighPriority
            case .quickWins:
                return task.estimatedMinutes <= 15
            case .deepFocus:
                return task.estimatedMinutes > 15
            }
        }
        
        // Strict sorting: High Priority first (🔥 High > ⚡ Med > 🌱 Low), then shortest duration first
        return pool.sorted { a, b in
            let prioRank: (TaskItem) -> Int = { t in
                if t.isHighPriority { return 3 }
                if t.isMediumPriority { return 2 }
                return 1
            }
            let rankA = prioRank(a)
            let rankB = prioRank(b)
            if rankA != rankB {
                return rankA > rankB
            }
            return a.estimatedMinutes < b.estimatedMinutes
        }
    }
    
    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottomTrailing) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        // Header with Greeting & Build My Day Hero
                        headerSection
                        
                        // ADHD Context Gate (Space & People)
                        contextGateSection
                        
                        // Focus Tasks & Filters (Sorted High Priority First!)
                        recentTasksSection
                        
                        // Collapsible Projects
                        projectsCollapsibleSection
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
            .navigationTitle("Focus")
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
                        Menu {
                            Button {
                                showCreateTask = true
                            } label: {
                                Label("New Task", systemImage: "checkmark.circle.badge.plus")
                            }
                            
                            Button {
                                suggestedProjectName = nil
                                showCreateProject = true
                            } label: {
                                Label("New Project", systemImage: "folder.badge.plus")
                            }
                        } label: {
                            Image(systemName: "plus.circle.fill")
                                .font(.title3)
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
                BuildMyDaySheet(initialSpace: selectedSpace, initialPerson: selectedPerson)
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
            .sheet(isPresented: $showCreateTask) {
                CreateTaskSheetView()
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

    // MARK: - ADHD Context Gate Section
    private var contextGateSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            // Space Selection
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: "location.fill")
                        .font(.caption)
                        .foregroundColor(.indigo)
                    Text("WHAT SPACE ARE YOU IN?")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.secondary)
                    Spacer()
                    if selectedSpace != "all" {
                        Button("Clear") {
                            withAnimation { selectedSpace = "all" }
                        }
                        .font(.caption2.bold())
                        .foregroundColor(.indigo)
                    }
                }
                
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        contextChip(
                            label: "All Spaces",
                            icon: "globe",
                            isSelected: selectedSpace == "all"
                        ) {
                            withAnimation { selectedSpace = "all" }
                        }
                        
                        ForEach(taggingService.rules.spaces) { space in
                            contextChip(
                                label: space.label,
                                icon: spaceIcon(for: space.tag),
                                isSelected: selectedSpace.lowercased() == space.tag.lowercased()
                            ) {
                                withAnimation {
                                    if selectedSpace.lowercased() == space.tag.lowercased() {
                                        selectedSpace = "all"
                                    } else {
                                        selectedSpace = space.tag.lowercased()
                                    }
                                }
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
            
            // Person Selection
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: "person.2.fill")
                        .font(.caption)
                        .foregroundColor(.purple)
                    Text("IS ANYONE WITH YOU?")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.secondary)
                    Spacer()
                    if selectedPerson != "anyone" {
                        Button("Clear") {
                            withAnimation { selectedPerson = "anyone" }
                        }
                        .font(.caption2.bold())
                        .foregroundColor(.purple)
                    }
                }
                
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        contextChip(
                            label: "Anyone",
                            icon: "person.2",
                            isSelected: selectedPerson == "anyone"
                        ) {
                            withAnimation { selectedPerson = "anyone" }
                        }
                        
                        contextChip(
                            label: "Solo",
                            icon: "person.fill",
                            isSelected: selectedPerson == "solo"
                        ) {
                            withAnimation { selectedPerson = "solo" }
                        }
                        
                        ForEach(taggingService.rules.people) { person in
                            contextChip(
                                label: person.label,
                                icon: "person.crop.circle",
                                isSelected: selectedPerson.lowercased() == person.tag.lowercased()
                            ) {
                                withAnimation {
                                    if selectedPerson.lowercased() == person.tag.lowercased() {
                                        selectedPerson = "anyone"
                                    } else {
                                        selectedPerson = person.tag.lowercased()
                                    }
                                }
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }
        .padding(14)
        .background(Color(UIColor.secondarySystemGroupedBackground))
        .cornerRadius(16)
        .shadow(color: Color.black.opacity(0.03), radius: 6, x: 0, y: 2)
    }
    
    private func contextChip(label: String, icon: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            action()
        }) {
            HStack(spacing: 5) {
                Image(systemName: icon)
                    .font(.caption)
                Text(label)
                    .font(.caption.weight(isSelected ? .bold : .medium))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(isSelected ? Color.indigo : Color(UIColor.tertiarySystemGroupedBackground))
            .foregroundColor(isSelected ? .white : .primary)
            .cornerRadius(12)
            .shadow(color: isSelected ? Color.indigo.opacity(0.3) : .clear, radius: 4, x: 0, y: 2)
        }
        .buttonStyle(.plain)
    }
    
    private func spaceIcon(for space: String) -> String {
        switch space.lowercased() {
        case "apricot": return "laptopcomputer"
        case "slack": return "bubble.left.and.bubble.right.fill"
        case "email": return "envelope.fill"
        case "home": return "house.fill"
        default: return "tag.fill"
        }
    }
    
    // MARK: - Collapsible Projects Section
    private var projectsCollapsibleSection: some View {
        DisclosureGroup(isExpanded: $isProjectsExpanded) {
            VStack(alignment: .leading, spacing: 12) {
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
                .padding(.top, 4)
                
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
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
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
            .padding(.top, 8)
        } label: {
            HStack {
                Image(systemName: "folder")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Text("Projects & Playbooks (\(supabase.projects.count))")
                    .font(.subheadline.bold())
                    .foregroundColor(.secondary)
                Spacer()
            }
        }
        .padding(14)
        .background(Color(UIColor.secondarySystemGroupedBackground))
        .cornerRadius(14)
    }
    
    // MARK: - Focus Tasks Section
    private var recentTasksSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Focus Tasks")
                        .font(.headline)
                    if selectedSpace != "all" || selectedPerson != "anyone" {
                        HStack(spacing: 4) {
                            if selectedSpace != "all" {
                                Text("#\(selectedSpace)")
                                    .font(.caption2.bold())
                                    .foregroundColor(.indigo)
                            }
                            if selectedPerson != "anyone" {
                                Text("#\(selectedPerson)")
                                    .font(.caption2.bold())
                                    .foregroundColor(.purple)
                            }
                        }
                    }
                }
                Spacer()
                Button {
                    showCreateTask = true
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "plus.circle.fill")
                        Text("Add Task")
                    }
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundColor(.indigo)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.indigo.opacity(0.12))
                    .cornerRadius(8)
                }
                .padding(.trailing, 4)
                
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
