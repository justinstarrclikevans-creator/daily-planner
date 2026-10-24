import SwiftUI

struct ProjectDetailView: View {
    var project: Project
    @ObservedObject var supabase = SupabaseService.shared
    @State private var selectedTab: Int = 0 // 0: Tasks, 1: Ideas
    @State private var showVoiceSheet: Bool = false
    @State private var showPlaybookEditor: Bool = false
    @State private var activeFocusTask: TaskItem? = nil
    
    var liveProject: Project {
        supabase.projects.first(where: { $0.id == project.id }) ?? project
    }
    
    var projectTasks: [TaskItem] {
        supabase.tasks.filter {
            !$0.isCompleted && ($0.projectId == project.id || $0.listName.caseInsensitiveCompare(project.name) == .orderedSame)
        }
    }
    
    var projectIdeas: [Idea] {
        supabase.ideas.filter { $0.projectId == project.id }
    }
    
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Header Banner
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Label(liveProject.name, systemImage: liveProject.icon)
                            .font(.title2)
                            .fontWeight(.bold)
                            .foregroundColor(liveProject.swiftUIColor)
                        
                        Spacer()
                        
                        Button {
                            showPlaybookEditor = true
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "slider.horizontal.3")
                                Text("Playbook")
                            }
                            .font(.caption)
                            .fontWeight(.bold)
                            .foregroundColor(liveProject.swiftUIColor)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(liveProject.swiftUIColor.opacity(0.12))
                            .cornerRadius(12)
                        }
                    }
                    
                    if !liveProject.goal.isEmpty {
                        Text(liveProject.goal)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    
                    if !liveProject.effectiveInstructions.isEmpty {
                        HStack(alignment: .top, spacing: 6) {
                            Image(systemName: "sparkles")
                                .font(.caption)
                                .foregroundColor(liveProject.swiftUIColor)
                            Text(liveProject.effectiveInstructions)
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .lineLimit(2)
                        }
                        .padding(.top, 2)
                    }
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(liveProject.swiftUIColor.opacity(0.08))
                .cornerRadius(16)
                
                // Mode Picker
                Picker("View", selection: $selectedTab) {
                    Text("Tasks (\(projectTasks.count))").tag(0)
                    Text("Ideas & Brain Dumps (\(projectIdeas.count))").tag(1)
                }
                .pickerStyle(.segmented)
                
                // Content View
                if selectedTab == 0 {
                    tasksSection
                } else {
                    ideasSection
                }
            }
            .padding()
        }
        .navigationTitle(project.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    showVoiceSheet = true
                } label: {
                    Label("Voice Brainstorm", systemImage: "mic.fill")
                        .foregroundColor(project.swiftUIColor)
                }
            }
        }
        .sheet(isPresented: $showVoiceSheet) {
            VoiceSheetView(activeProject: project)
        }
        .sheet(isPresented: $showPlaybookEditor) {
            ProjectPlaybookEditorView(project: liveProject)
        }
        .sheet(item: $activeFocusTask) { task in
            TaskFocusSheetView(task: binding(for: task))
        }
    }
    
    // MARK: - Tasks Section
    private var tasksSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            if projectTasks.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "checkmark.circle")
                        .font(.largeTitle)
                        .foregroundColor(.secondary)
                    Text("No open tasks for this project")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 40)
            } else {
                ForEach(projectTasks) { task in
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
                    .contentShape(Rectangle())
                    .onTapGesture {
                        self.activeFocusTask = task
                    }
                    Divider()
                }
            }
        }
    }
    
    // MARK: - Ideas Section
    private var ideasSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            if projectIdeas.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "lightbulb")
                        .font(.largeTitle)
                        .foregroundColor(.secondary)
                    Text("No voice ideas logged yet")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 40)
            } else {
                ForEach(projectIdeas) { idea in
                    IdeaPromotionCardView(idea: idea, project: project) {
                        selectedTab = 0
                    }
                }
            }
        }
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

// MARK: - Idea Promotion Card View
struct IdeaPromotionCardView: View {
    var idea: Idea
    var project: Project
    var onPromoted: () -> Void
    
    @State private var detailLevel: BreakdownDetailLevel = .balanced
    @State private var isPromoting: Bool = false
    @State private var promotionError: String? = nil
    @ObservedObject private var supabase = SupabaseService.shared
    
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Summary
            Text(idea.summary)
                .font(.subheadline)
                .fontWeight(.semibold)
                .foregroundColor(.primary)
            
            // Raw Transcript
            Text(idea.rawTranscript)
                .font(.caption)
                .foregroundColor(.secondary)
                .lineLimit(3)
            
            // Tags
            if !idea.tags.isEmpty {
                HStack(spacing: 6) {
                    ForEach(idea.tags, id: \.self) { tag in
                        Text("#\(tag)")
                            .font(.caption2)
                            .fontWeight(.medium)
                            .foregroundColor(project.swiftUIColor)
                    }
                }
            }
            
            Divider()
                .padding(.vertical, 2)
            
            // Detail Level Selector
            VStack(alignment: .leading, spacing: 6) {
                Text("Action Granularity:")
                    .font(.caption2)
                    .fontWeight(.bold)
                    .foregroundColor(.secondary)
                
                Picker("Granularity", selection: $detailLevel) {
                    ForEach(BreakdownDetailLevel.allCases) { level in
                        Text(level.shortLabel).tag(level)
                    }
                }
                .pickerStyle(.segmented)
            }
            
            // Action Button
            Button {
                Task {
                    await promoteIdea()
                }
            } label: {
                HStack {
                    if isPromoting {
                        ProgressView()
                            .tint(.white)
                            .padding(.trailing, 4)
                        Text("Transforming with Gemini...")
                    } else {
                        Image(systemName: "sparkles")
                        Text("Promote to Actionable Tasks")
                    }
                }
                .font(.footnote)
                .fontWeight(.bold)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(project.swiftUIColor)
                .foregroundColor(.white)
                .cornerRadius(10)
            }
            .disabled(isPromoting)
            
            if let err = promotionError {
                Text(err)
                    .font(.caption2)
                    .foregroundColor(.red)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(14)
    }
    
    private func promoteIdea() async {
        isPromoting = true
        promotionError = nil
        defer { isPromoting = false }
        
        do {
            let extractedTasks = try await GeminiVoiceService.shared.promoteIdeaToTasks(
                idea: idea,
                project: project,
                detailLevel: detailLevel
            )
            
            for extracted in extractedTasks {
                let subtaskItems = (extracted.subtasks ?? []).map { SubtaskItem(title: $0, isCompleted: false) }
                
                let reminderId = try? await RemindersManager.shared.addReminder(
                    title: extracted.title,
                    notes: TaskItem.buildDescription(
                        cleanNotes: extracted.description ?? "",
                        estimatedMinutes: extracted.estimatedMinutes,
                        inPlayQueue: false,
                        firstFiveMinutes: extracted.firstFiveMinutes,
                        subtasks: subtaskItems
                    ),
                    listName: extracted.listName
                )
                
                await supabase.createTask(
                    title: extracted.title,
                    description: extracted.description,
                    listName: extracted.listName,
                    projectId: project.id,
                    appleReminderId: reminderId,
                    estimatedMinutes: extracted.estimatedMinutes,
                    inPlayQueue: false,
                    firstFiveMinutes: extracted.firstFiveMinutes,
                    subtasks: subtaskItems
                )
            }
            
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            SpeechSynthesisService.shared.speak("Promoted idea to \(extractedTasks.count) tasks.")
            onPromoted()
        } catch {
            promotionError = "Could not promote idea: \(error.localizedDescription)"
        }
    }
}
