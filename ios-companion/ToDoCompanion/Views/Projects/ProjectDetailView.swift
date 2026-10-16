import SwiftUI

struct ProjectDetailView: View {
    var project: Project
    @ObservedObject var supabase = SupabaseService.shared
    @State private var selectedTab: Int = 0 // 0: Tasks, 1: Ideas
    @State private var showVoiceSheet: Bool = false
    
    var projectTasks: [TaskItem] {
        supabase.tasks.filter { $0.projectId == project.id }
    }
    
    var projectIdeas: [Idea] {
        supabase.ideas.filter { $0.projectId == project.id }
    }
    
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Header Banner
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Label(project.name, systemImage: project.icon)
                            .font(.title2)
                            .fontWeight(.bold)
                            .foregroundColor(project.swiftUIColor)
                        
                        Spacer()
                    }
                    
                    if !project.goal.isEmpty {
                        Text(project.goal)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(project.swiftUIColor.opacity(0.08))
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
    }
    
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
                    TaskRowView(task: task) {
                        Task {
                            await supabase.toggleTaskCompletion(task: task)
                        }
                    }
                    Divider()
                }
            }
        }
    }
    
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
                    VStack(alignment: .leading, spacing: 8) {
                        Text(idea.summary)
                            .font(.subheadline)
                            .fontWeight(.medium)
                        
                        Text(idea.rawTranscript)
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .lineLimit(3)
                        
                        if !idea.tags.isEmpty {
                            HStack {
                                ForEach(idea.tags, id: \.self) { tag in
                                    Text("#\(tag)")
                                        .font(.caption2)
                                        .foregroundColor(project.swiftUIColor)
                                }
                            }
                        }
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(12)
                }
            }
        }
    }
}
