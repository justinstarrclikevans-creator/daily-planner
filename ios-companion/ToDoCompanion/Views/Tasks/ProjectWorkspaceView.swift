import SwiftUI

struct ProjectWorkspaceView: View {
    @ObservedObject private var supabase = SupabaseService.shared
    
    @State private var selectedProjectId: UUID? = nil // nil = All Tasks
    @State private var priorityFilter: String = "all" // all, high, medium, low
    @State private var durationFilter: String = "all" // all, quick, medium, deep
    @State private var searchQuery: String = ""
    
    @State private var showBuildMyDay: Bool = false
    @State private var showVoiceSheet: Bool = false
    @State private var showNewTaskSheet: Bool = false
    @State private var taskToConvertToProject: TaskItem? = nil
    @State private var sprintTask: TaskItem? = nil
    
    private var activeProjects: [Project] {
        supabase.projects
    }
    
    private var filteredTasks: [TaskItem] {
        supabase.tasks.filter { task in
            guard !task.isCompleted else { return false }
            guard !task.isScheduledForFuture else { return false }
            
            // 1. Project selection
            if let sel = selectedProjectId {
                if let pid = task.projectId {
                    if pid != sel { return false }
                } else {
                    let proj = activeProjects.first { $0.id == sel }
                    if task.listName.caseInsensitiveCompare(proj?.name ?? "") != .orderedSame {
                        return false
                    }
                }
            }
            
            // 2. Priority filter
            if priorityFilter != "all" {
                if task.priority.lowercased() != priorityFilter {
                    return false
                }
            }
            
            // 3. Duration filter
            if durationFilter == "quick" && task.estimatedMinutes > 15 {
                return false
            }
            if durationFilter == "medium" && (task.estimatedMinutes < 15 || task.estimatedMinutes > 30) {
                return false
            }
            if durationFilter == "deep" && task.estimatedMinutes <= 30 {
                return false
            }
            
            // 4. Search query
            if !searchQuery.trimmingCharacters(in: .whitespaces).isEmpty {
                let q = searchQuery.lowercased()
                let matchTitle = task.title.lowercased().contains(q)
                let matchSub = task.subtasks.contains { $0.title.lowercased().contains(q) }
                if !matchTitle && !matchSub { return false }
            }
            
            return true
        }
    }
    
    private var totalActiveCount: Int {
        supabase.tasks.filter { !$0.isCompleted && !$0.isScheduledForFuture }.count
    }
    
    private var highPriorityCount: Int {
        supabase.tasks.filter { !$0.isCompleted && !$0.isScheduledForFuture && $0.isHighPriority }.count
    }
    
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Top Projects Horizontal Carousel / Pills
                projectsCarousel
                    .padding(.vertical, 8)
                    .background(Color(UIColor.systemBackground))
                
                Divider()
                
                // Filter Controls Bar
                filterControlsBar
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(Color(UIColor.systemGroupedBackground))
                
                // Tasks List
                if filteredTasks.isEmpty {
                    VStack(spacing: 12) {
                        Spacer()
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: 40))
                            .foregroundColor(.secondary)
                        Text("No matching tasks")
                            .font(.headline)
                            .foregroundColor(.secondary)
                        Text("All items completed or excluded by active filters.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Button("Reset Filters") {
                            withAnimation {
                                priorityFilter = "all"
                                durationFilter = "all"
                                searchQuery = ""
                                selectedProjectId = nil
                            }
                        }
                        .font(.caption.bold())
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                        .background(Color.indigo.opacity(0.15))
                        .foregroundColor(.indigo)
                        .cornerRadius(8)
                        Spacer()
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        ForEach(filteredTasks) { task in
                            TaskItemRowView(
                                task: task,
                                onConvertToProject: {
                                    taskToConvertToProject = task
                                },
                                onStartSprint: {
                                    sprintTask = task
                                }
                            )
                            .listRowInsets(EdgeInsets(top: 4, leading: 14, bottom: 4, trailing: 14))
                            .listRowSeparator(.hidden)
                            .listRowBackground(Color.clear)
                        }
                    }
                    .listStyle(.plain)
                    .background(Color(UIColor.systemGroupedBackground))
                }
            }
            .background(Color(UIColor.systemGroupedBackground).ignoresSafeArea())
            .navigationTitle("Workspace")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button {
                        showBuildMyDay = true
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "sparkles")
                            Text("Build My Day")
                                .font(.caption.bold())
                        }
                        .foregroundColor(.indigo)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Color.indigo.opacity(0.12))
                        .cornerRadius(12)
                    }
                }
                
                ToolbarItem(placement: .navigationBarTrailing) {
                    HStack(spacing: 12) {
                        Button {
                            showVoiceSheet = true
                        } label: {
                            Image(systemName: "mic.fill")
                                .foregroundColor(.indigo)
                        }
                    }
                }
            }
            .searchable(text: $searchQuery, placement: .navigationBarDrawer(displayMode: .automatic), prompt: "Search tasks or subtasks...")
            .sheet(isPresented: $showBuildMyDay) {
                BuildMyDaySheet()
            }
            .sheet(item: $taskToConvertToProject) { task in
                ConvertTaskToProjectSheet(task: task)
            }
            .sheet(item: $sprintTask) { task in
                SingleStepFocusView(task: binding(for: task))
            }
            .sheet(isPresented: $showVoiceSheet) {
                VoiceSheetView()
            }
        }
    }
    
    private func binding(for task: TaskItem) -> Binding<TaskItem> {
        Binding(
            get: {
                if let idx = supabase.tasks.firstIndex(where: { $0.id == task.id }) {
                    return supabase.tasks[idx]
                }
                return task
            },
            set: { updated in
                if let idx = supabase.tasks.firstIndex(where: { $0.id == updated.id }) {
                    supabase.tasks[idx] = updated
                }
            }
        )
    }
    
    // MARK: - Subviews
    
    private var projectsCarousel: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                // All Tasks Pill
                Button {
                    withAnimation { selectedProjectId = nil }
                } label: {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(Color.indigo)
                            .frame(width: 8, height: 8)
                        Text("All")
                            .font(.subheadline.weight(selectedProjectId == nil ? .bold : .regular))
                        Text("\(totalActiveCount)")
                            .font(.caption2.monospaced())
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(selectedProjectId == nil ? Color.white.opacity(0.2) : Color(UIColor.tertiarySystemGroupedBackground))
                            .cornerRadius(6)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(selectedProjectId == nil ? Color.indigo : Color(UIColor.secondarySystemGroupedBackground))
                    .foregroundColor(selectedProjectId == nil ? .white : .primary)
                    .cornerRadius(12)
                }
                .buttonStyle(.plain)
                
                // Each Project Pill
                ForEach(activeProjects) { project in
                    let isSelected = selectedProjectId == project.id
                    let count = supabase.tasks.filter { !$0.isCompleted && !$0.isScheduledForFuture && ($0.projectId == project.id || $0.listName.caseInsensitiveCompare(project.name) == .orderedSame) }.count
                    let highCount = supabase.tasks.filter { !$0.isCompleted && !$0.isScheduledForFuture && $0.isHighPriority && ($0.projectId == project.id || $0.listName.caseInsensitiveCompare(project.name) == .orderedSame) }.count
                    
                    Button {
                        withAnimation { selectedProjectId = project.id }
                    } label: {
                        HStack(spacing: 6) {
                            Circle()
                                .fill(project.safeAccentColor)
                                .frame(width: 8, height: 8)
                            Text(project.name)
                                .font(.subheadline.weight(isSelected ? .bold : .regular))
                            
                            if highCount > 0 {
                                Image(systemName: "flame.fill")
                                    .font(.caption2)
                                    .foregroundColor(.red)
                            }
                            
                            Text("\(count)")
                                .font(.caption2.monospaced())
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(isSelected ? Color.white.opacity(0.2) : Color(UIColor.tertiarySystemGroupedBackground))
                                .cornerRadius(6)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(isSelected ? Color.indigo : Color(UIColor.secondarySystemGroupedBackground))
                        .foregroundColor(isSelected ? .white : .primary)
                        .cornerRadius(12)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
        }
    }
    
    private var filterControlsBar: some View {
        HStack(spacing: 8) {
            // Priority Filter Picker
            Menu {
                Button("All Priorities") { priorityFilter = "all" }
                Button("🔥 High Only") { priorityFilter = "high" }
                Button("⚡ Medium Only") { priorityFilter = "medium" }
                Button("🌱 Low Only") { priorityFilter = "low" }
            } label: {
                HStack(spacing: 4) {
                    Text("Priority:")
                        .foregroundColor(.secondary)
                    Text(priorityFilter.capitalized)
                        .bold()
                    Image(systemName: "chevron.down")
                        .font(.caption2)
                }
                .font(.caption)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color(UIColor.secondarySystemGroupedBackground))
                .cornerRadius(10)
            }
            .buttonStyle(.plain)
            
            // Duration Filter Picker
            Menu {
                Button("All Durations") { durationFilter = "all" }
                Button("≤15m Quick") { durationFilter = "quick" }
                Button("15–30m Focus") { durationFilter = "medium" }
                Button(">30m Deep Work") { durationFilter = "deep" }
            } label: {
                HStack(spacing: 4) {
                    Text("Time:")
                        .foregroundColor(.secondary)
                    Text(durationFilterLabel)
                        .bold()
                    Image(systemName: "chevron.down")
                        .font(.caption2)
                }
                .font(.caption)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color(UIColor.secondarySystemGroupedBackground))
                .cornerRadius(10)
            }
            .buttonStyle(.plain)
            
            Spacer()
            
            Text("\(filteredTasks.count) tasks")
                .font(.caption2.monospaced())
                .foregroundColor(.secondary)
        }
    }
    
    private var durationFilterLabel: String {
        switch durationFilter {
        case "quick": return "≤15m"
        case "medium": return "15–30m"
        case "deep": return ">30m"
        default: return "All"
        }
    }
}
