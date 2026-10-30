import SwiftUI

struct ProcessesView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var supabase = SupabaseService.shared
    
    @State private var showCreateSheet: Bool = false
    @State private var showAudioSheet: Bool = false
    @State private var runningRoutineTask: TaskItem? = nil
    
    var isEmbeddedTab: Bool = false
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Header Subtitle
                    Text("Step-by-step repeatable workflows. Check off steps as you go—processes stay open until every step is done.")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .padding(.horizontal)
                    
                    // Action Cards Grid (Audio / Transcript & Manual)
                    HStack(spacing: 12) {
                        Button {
                            showAudioSheet = true
                        } label: {
                            HStack(spacing: 10) {
                                ZStack {
                                    Circle()
                                        .fill(Color.indigo.opacity(0.18))
                                        .frame(width: 36, height: 36)
                                    Image(systemName: "waveform.and.mic")
                                        .font(.subheadline)
                                        .foregroundColor(.indigo)
                                }
                                
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("From Audio / Notes")
                                        .font(.subheadline)
                                        .fontWeight(.bold)
                                        .foregroundColor(.primary)
                                    Text("Dictate or paste transcript")
                                        .font(.caption2)
                                        .foregroundColor(.secondary)
                                }
                                Spacer()
                            }
                            .padding(12)
                            .background(Color.indigo.opacity(0.08))
                            .cornerRadius(12)
                        }
                        .buttonStyle(.plain)
                        
                        Button {
                            showCreateSheet = true
                        } label: {
                            HStack(spacing: 10) {
                                ZStack {
                                    Circle()
                                        .fill(Color.purple.opacity(0.18))
                                        .frame(width: 36, height: 36)
                                    Image(systemName: "plus")
                                        .font(.subheadline)
                                        .foregroundColor(.purple)
                                }
                                
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("New Process")
                                        .font(.subheadline)
                                        .fontWeight(.bold)
                                        .foregroundColor(.primary)
                                    Text("Build steps manually")
                                        .font(.caption2)
                                        .foregroundColor(.secondary)
                                }
                                Spacer()
                            }
                            .padding(12)
                            .background(Color.purple.opacity(0.08))
                            .cornerRadius(12)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal)
                    
                    // Open Processes List
                    if supabase.routines.isEmpty {
                        VStack(spacing: 8) {
                            Image(systemName: "arrow.triangle.2.circlepath.circle")
                                .font(.system(size: 40))
                                .foregroundColor(.secondary)
                            Text("No Processes Yet")
                                .font(.headline)
                            Text("Tap 'From Audio / Notes' or 'New Process' to build your first repeatable workflow.")
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 40)
                    } else {
                        LazyVStack(spacing: 16) {
                            ForEach(supabase.routines) { routine in
                                processCard(for: routine)
                            }
                        }
                        .padding(.horizontal)
                    }
                }
                .padding(.vertical)
            }
            .navigationTitle("Processes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !isEmbeddedTab {
                    ToolbarItem(placement: .navigationBarLeading) {
                        Button("Close") {
                            dismiss()
                        }
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button {
                            showAudioSheet = true
                        } label: {
                            Label("Build from Audio / Transcript", systemImage: "waveform.and.mic")
                        }
                        
                        Button {
                            showCreateSheet = true
                        } label: {
                            Label("New Process", systemImage: "plus")
                        }
                    } label: {
                        Image(systemName: "plus.circle.fill")
                            .foregroundColor(.indigo)
                    }
                }
            }
            .sheet(isPresented: $showCreateSheet) {
                CreateRoutineSheetView()
            }
            .sheet(isPresented: $showAudioSheet) {
                CreateWorkflowFromAudioSheetView()
            }
            .fullScreenCover(item: $runningRoutineTask) { task in
                SingleStepFocusView(task: binding(for: task))
            }
        }
    }
    
    private func binding(for task: TaskItem) -> Binding<TaskItem> {
        Binding(
            get: { runningRoutineTask ?? task },
            set: { runningRoutineTask = $0 }
        )
    }
    
    // MARK: - Open Process Card
    private func processCard(for routine: Routine) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            // Header Row: Icon, Title, Project Tag, Trash
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(routine.swiftUIColor.opacity(0.18))
                        .frame(width: 44, height: 44)
                    
                    Image(systemName: routine.icon)
                        .font(.title3)
                        .foregroundColor(routine.swiftUIColor)
                }
                
                VStack(alignment: .leading, spacing: 4) {
                    Text(routine.title)
                        .font(.headline)
                        .foregroundColor(.primary)
                    
                    HStack(spacing: 8) {
                        Text(routine.defaultListName)
                            .font(.caption2)
                            .fontWeight(.bold)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Color.indigo.opacity(0.15))
                            .foregroundColor(.indigo)
                            .cornerRadius(6)
                        
                        if !routine.items.isEmpty {
                            Text("\(routine.completedStepsCount)/\(routine.items.count) done")
                                .font(.caption2)
                                .fontWeight(.bold)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(routine.isCompleted ? Color.green.opacity(0.15) : Color.secondary.opacity(0.12))
                                .foregroundColor(routine.isCompleted ? .green : .secondary)
                                .cornerRadius(6)
                        }
                    }
                }
                
                Spacer()
                
                Button {
                    supabase.deleteRoutine(routine)
                } label: {
                    Image(systemName: "trash")
                        .font(.caption)
                        .foregroundColor(.secondary.opacity(0.7))
                }
                .buttonStyle(.plain)
            }
            
            if !routine.description.isEmpty {
                Text(routine.description)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            // Progress Bar
            if !routine.items.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ProgressView(value: routine.progressFraction)
                        .tint(routine.isCompleted ? .green : routine.swiftUIColor)
                }
            }
            
            // Interactive Steps Checklist (Leave open until done!)
            if !routine.items.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Divider()
                        .padding(.vertical, 2)
                    
                    ForEach(routine.items) { step in
                        Button {
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                            supabase.toggleRoutineStep(routineId: routine.id, stepId: step.id)
                        } label: {
                            HStack(alignment: .center, spacing: 10) {
                                Image(systemName: step.isCompleted ? "checkmark.circle.fill" : "circle")
                                    .font(.title3)
                                    .foregroundColor(step.isCompleted ? .green : .secondary)
                                
                                Text(step.title)
                                    .font(.subheadline)
                                    .strikethrough(step.isCompleted)
                                    .foregroundColor(step.isCompleted ? .secondary : .primary)
                                    .multilineTextAlignment(.leading)
                                
                                Spacer()
                                
                                Text("⏱ \(step.estimatedMinutes)m")
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                            .padding(.vertical, 2)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            
            // Completion / Action Bar
            HStack(spacing: 10) {
                if routine.isCompleted {
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark.seal.fill")
                            .foregroundColor(.green)
                        Text("Process Done!")
                            .font(.footnote)
                            .fontWeight(.bold)
                            .foregroundColor(.green)
                    }
                    .padding(.vertical, 8)
                    
                    Spacer()
                    
                    Button {
                        supabase.resetRoutineSteps(routineId: routine.id)
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "arrow.counterclockwise")
                            Text("Reset to Run Again")
                        }
                        .font(.footnote)
                        .fontWeight(.bold)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(Color.secondary.opacity(0.12))
                        .foregroundColor(.primary)
                        .cornerRadius(8)
                    }
                } else {
                    if !routine.items.isEmpty {
                        Button {
                            let subtasks = routine.items.map { SubtaskItem(title: $0.title, isCompleted: $0.isCompleted) }
                            let runnerTask = TaskItem(
                                title: routine.title,
                                description: routine.description,
                                listName: routine.defaultListName,
                                estimatedMinutes: routine.totalEstimatedMinutes,
                                subtasks: subtasks
                            )
                            runningRoutineTask = runnerTask
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "play.fill")
                                Text("Step-by-Step Focus")
                            }
                            .font(.footnote)
                            .fontWeight(.bold)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(Color.indigo)
                            .foregroundColor(.white)
                            .cornerRadius(10)
                        }
                    }
                    
                    if routine.completedStepsCount > 0 {
                        Button {
                            supabase.resetRoutineSteps(routineId: routine.id)
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        } label: {
                            Image(systemName: "arrow.counterclockwise")
                                .font(.footnote)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 10)
                                .background(Color.secondary.opacity(0.12))
                                .foregroundColor(.secondary)
                                .cornerRadius(10)
                        }
                    }
                }
            }
            .padding(.top, 4)
        }
        .padding(16)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(16)
    }
}

// Compatibility wrapper for any callers
struct RoutineLibrarySheetView: View {
    var isEmbeddedTab: Bool = false
    
    var body: some View {
        ProcessesView(isEmbeddedTab: isEmbeddedTab)
    }
}

// MARK: - Quick Create "New Process" Sheet
struct CreateRoutineSheetView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var supabase = SupabaseService.shared
    
    @State private var routineTitle: String = ""
    @State private var routineDescription: String = ""
    @State private var defaultListName: String = "General"
    @State private var selectedColorHex: String = "#6366F1"
    @State private var selectedIcon: String = "arrow.triangle.2.circlepath.circle.fill"
    
    @State private var step1Title: String = ""
    @State private var step2Title: String = ""
    @State private var step3Title: String = ""
    @State private var step4Title: String = ""
    @State private var step5Title: String = ""
    
    let colors = ["#EF4444", "#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#EC4899"]
    let icons = ["arrow.triangle.2.circlepath.circle.fill", "sparkles", "briefcase.fill", "sportscourt.fill", "moon.stars.fill", "bolt.fill", "book.fill"]
    
    var body: some View {
        NavigationStack {
            Form {
                Section("Process Details") {
                    TextField("Process Title (e.g. End of Day Workflow)", text: $routineTitle)
                    TextField("Notes / Purpose (optional)", text: $routineDescription)
                    
                    Picker("Default Project", selection: $defaultListName) {
                        ForEach(supabase.projects) { project in
                            Text(project.name).tag(project.name)
                        }
                    }
                    
                    // Color Picker Row
                    HStack(spacing: 12) {
                        ForEach(colors, id: \.self) { hex in
                            Circle()
                                .fill(Color(hex: hex))
                                .frame(width: 28, height: 28)
                                .overlay(
                                    Circle()
                                        .stroke(Color.primary, lineWidth: selectedColorHex == hex ? 2 : 0)
                                )
                                .onTapGesture {
                                    selectedColorHex = hex
                                }
                        }
                    }
                    .padding(.vertical, 4)
                    
                    // Icon Picker Row
                    HStack(spacing: 14) {
                        ForEach(icons, id: \.self) { iconName in
                            Image(systemName: iconName)
                                .font(.title3)
                                .foregroundColor(selectedIcon == iconName ? Color(hex: selectedColorHex) : .secondary)
                                .padding(6)
                                .background(selectedIcon == iconName ? Color(hex: selectedColorHex).opacity(0.15) : Color.clear)
                                .cornerRadius(8)
                                .onTapGesture {
                                    selectedIcon = iconName
                                }
                        }
                    }
                    .padding(.vertical, 4)
                }
                
                Section("Steps (Checklist)") {
                    TextField("Step 1", text: $step1Title)
                    TextField("Step 2", text: $step2Title)
                    TextField("Step 3", text: $step3Title)
                    TextField("Step 4", text: $step4Title)
                    TextField("Step 5", text: $step5Title)
                }
            }
            .navigationTitle("New Process")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Save") {
                        saveRoutine()
                    }
                    .fontWeight(.bold)
                    .disabled(routineTitle.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
    
    private func saveRoutine() {
        let rawSteps = [step1Title, step2Title, step3Title, step4Title, step5Title]
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        let items = rawSteps.map { RoutineItemStep(title: $0, estimatedMinutes: 5) }
        
        Task {
            await supabase.createRoutine(
                title: routineTitle.trimmingCharacters(in: .whitespaces),
                description: routineDescription.trimmingCharacters(in: .whitespaces),
                color: selectedColorHex,
                icon: selectedIcon,
                items: items,
                defaultListName: defaultListName
            )
            dismiss()
        }
    }
}
