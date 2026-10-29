import SwiftUI

struct HomeCardStacksView: View {
    @ObservedObject private var supabase = SupabaseService.shared
    @State private var selectedDeckProject: Project? = nil
    @State private var showAllProjectsOverride: Bool = false
    @State private var showVoiceSheet: Bool = false
    @State private var editingPlaybookProject: Project? = nil
    @State private var showHiddenProjects: Bool = false
    
    // Group active projects vs hidden today
    private var visibleProjects: [Project] {
        if showAllProjectsOverride {
            return supabase.projects
        }
        return supabase.projects.filter { $0.isVisibleNow }
    }
    
    private var hiddenProjects: [Project] {
        if showAllProjectsOverride {
            return []
        }
        return supabase.projects.filter { !$0.isVisibleNow }
    }
    
    private func tasksForProject(_ project: Project) -> [TaskItem] {
        supabase.tasks.filter { task in
            if let pid = task.projectId {
                return pid == project.id
            }
            return task.listName.caseInsensitiveCompare(project.name) == .orderedSame
        }
    }
    
    private var totalActiveCardsToday: Int {
        visibleProjects.reduce(0) { total, proj in
            total + tasksForProject(proj).filter { !$0.isCompleted }.count
        }
    }
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Header Greeting & Today's Metric Banner
                    headerSection
                    
                    // Active Project Stacks Section
                    activeStacksSection
                    
                    // Hidden Today Section (if any projects are scheduled off today)
                    if !hiddenProjects.isEmpty {
                        hiddenProjectsSection
                    }
                    
                    Spacer(minLength: 40)
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
            }
            .background(Color(UIColor.systemGroupedBackground).ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    HStack(spacing: 6) {
                        Image(systemName: "square.stack.3d.up.fill")
                            .foregroundColor(.indigo)
                        Text("Card Stacks")
                            .font(.headline)
                            .fontWeight(.black)
                    }
                }
                
                ToolbarItem(placement: .navigationBarTrailing) {
                    HStack(spacing: 12) {
                        Button {
                            showVoiceSheet = true
                        } label: {
                            Image(systemName: "mic.fill")
                                .font(.system(size: 14, weight: .bold))
                                .padding(8)
                                .background(Color.indigo.opacity(0.12))
                                .foregroundColor(.indigo)
                                .clipShape(Circle())
                        }
                    }
                }
            }
            .fullScreenCover(item: $selectedDeckProject) { project in
                ProjectDeckView(project: project)
            }
            .sheet(isPresented: $showVoiceSheet) {
                VoiceSheetView()
            }
            .sheet(item: $editingPlaybookProject) { project in
                ProjectPlaybookEditorView(project: project)
            }
            .refreshable {
                await supabase.fetchTasks()
                await supabase.fetchProjects()
            }
        }
    }
    
    // MARK: - Header & Banner
    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(currentDateFormatted)
                .font(.caption)
                .fontWeight(.bold)
                .foregroundColor(.secondary)
                .textCase(.uppercase)
                .tracking(0.5)
            
            Text(greetingText)
                .font(.title)
                .fontWeight(.black)
            
            // Daily Focus Metric Pill
            HStack(spacing: 16) {
                HStack(spacing: 6) {
                    Image(systemName: "square.stack.3d.forward.dottedline")
                        .foregroundColor(.indigo)
                    Text("\(visibleProjects.count) Active Stacks")
                        .font(.subheadline)
                        .fontWeight(.bold)
                }
                
                Divider()
                    .frame(height: 14)
                
                HStack(spacing: 6) {
                    Image(systemName: "play.circle.fill")
                        .foregroundColor(.green)
                    Text("\(totalActiveCardsToday) Cards Today")
                        .font(.subheadline)
                        .fontWeight(.bold)
                }
                
                Spacer()
                
                // Override Toggle button
                Button {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    withAnimation(.spring()) {
                        showAllProjectsOverride.toggle()
                    }
                } label: {
                    Image(systemName: showAllProjectsOverride ? "eye.fill" : "eye.slash")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .padding(6)
                        .background(Color(.tertiarySystemFill))
                        .clipShape(Circle())
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Color(UIColor.secondarySystemGroupedBackground))
            .cornerRadius(12)
            .shadow(color: Color.black.opacity(0.03), radius: 4, y: 2)
        }
        .padding(.top, 4)
    }
    
    private var currentDateFormatted: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE, MMMM d"
        return formatter.string(from: Date())
    }
    
    private var greetingText: String {
        let hour = Calendar.current.component(.hour, from: Date())
        if hour < 12 { return "Morning Focus" }
        if hour < 17 { return "Afternoon Sprint" }
        return "Evening Wrap-up"
    }
    
    // MARK: - Active Project Stacks
    private var activeStacksSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("TODAY'S PROJECT DECKS")
                    .font(.caption)
                    .fontWeight(.black)
                    .tracking(0.8)
                    .foregroundColor(.secondary)
                
                Spacer()
                
                Text("Tap any stack to open cards")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            
            if visibleProjects.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "moon.stars.fill")
                        .font(.largeTitle)
                        .foregroundColor(.indigo)
                    Text("No projects scheduled for right now")
                        .font(.headline)
                    Text("All your project decks are resting based on their active hours or days.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                    Button("Show All Projects Anyway") {
                        showAllProjectsOverride = true
                    }
                    .font(.footnote)
                    .fontWeight(.bold)
                    .padding(.top, 4)
                }
                .frame(maxWidth: .infinity)
                .padding(32)
                .background(Color(UIColor.secondarySystemGroupedBackground))
                .cornerRadius(16)
            } else {
                ForEach(visibleProjects) { project in
                    ProjectStackCardView(
                        project: project,
                        tasks: tasksForProject(project),
                        onTap: {
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                            selectedDeckProject = project
                        }
                    )
                    .contextMenu {
                        Button {
                            editingPlaybookProject = project
                        } label: {
                            Label("Edit Project Schedule", systemImage: "calendar.badge.clock")
                        }
                    }
                }
            }
        }
    }
    
    // MARK: - Hidden Today Section
    private var hiddenProjectsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                withAnimation(.spring()) {
                    showHiddenProjects.toggle()
                }
            } label: {
                HStack {
                    Image(systemName: showHiddenProjects ? "chevron.down" : "chevron.right")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                    
                    Text("SCHEDULED OFF TODAY (\(hiddenProjects.count))")
                        .font(.caption)
                        .fontWeight(.black)
                        .tracking(0.6)
                        .foregroundColor(.secondary)
                    
                    Spacer()
                    
                    Text(showHiddenProjects ? "Hide" : "Show")
                        .font(.caption2)
                        .fontWeight(.bold)
                        .foregroundColor(.indigo)
                }
                .padding(.vertical, 6)
            }
            .buttonStyle(.plain)
            
            if showHiddenProjects {
                VStack(spacing: 12) {
                    ForEach(hiddenProjects) { project in
                        ProjectStackCardView(
                            project: project,
                            tasks: tasksForProject(project),
                            onTap: {
                                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                                selectedDeckProject = project
                            }
                        )
                        .opacity(0.85)
                    }
                }
            }
        }
        .padding(.top, 8)
    }
}
