import SwiftUI

struct RoutineLibrarySheetView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var supabase = SupabaseService.shared
    @State private var selectedProjects: [UUID: String] = [:]
    @State private var deployingRoutineId: UUID? = nil
    @State private var schedulingRoutine: Routine? = nil
    @State private var scheduleDate: Date = Date().addingTimeInterval(3600)
    @State private var showCreateSheet: Bool = false
    @State private var showAudioSheet: Bool = false
    @State private var statusMessage: String? = nil
    @State private var runningRoutineTask: TaskItem? = nil
    
    var isEmbeddedTab: Bool = false
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Header Subtitle
                    Text("Saved tasks and their subtasks. Choose a Project to add them to Apple Reminders now, or schedule a date and time.")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .padding(.horizontal)
                    
                    // Audio / Transcript Workflow Builder Banner
                    Button {
                        showAudioSheet = true
                    } label: {
                        HStack(spacing: 12) {
                            ZStack {
                                Circle()
                                    .fill(Color.indigo.opacity(0.18))
                                    .frame(width: 40, height: 40)
                                Image(systemName: "waveform.and.mic")
                                    .font(.subheadline)
                                    .foregroundColor(.indigo)
                            }
                            
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Dictate Audio / Paste Transcript")
                                    .font(.subheadline)
                                    .fontWeight(.bold)
                                    .foregroundColor(.primary)
                                Text("AI converts notes or audio into a repeatable Process & subtasks.")
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                            
                            Spacer()
                            
                            Image(systemName: "chevron.right")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        .padding(12)
                        .background(Color.indigo.opacity(0.08))
                        .cornerRadius(12)
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal)
                    
                    if let msg = statusMessage {
                        HStack(spacing: 8) {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Text(msg)
                                .font(.subheadline)
                                .fontWeight(.medium)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.green.opacity(0.12))
                        .cornerRadius(12)
                        .padding(.horizontal)
                    }
                    
                    // "Do it again" Task Cards
                    LazyVStack(spacing: 16) {
                        ForEach(supabase.routines) { routine in
                            routineCard(for: routine)
                        }
                    }
                    .padding(.horizontal)
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
            .sheet(item: $schedulingRoutine) { routine in
                scheduleRoutineSheet(for: routine)
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
    
    private func targetProjectName(for routine: Routine) -> String {
        if let chosen = selectedProjects[routine.id] {
            return chosen
        }
        return routine.defaultListName
    }
    
    // MARK: - Schedule Sheet
    private func scheduleRoutineSheet(for routine: Routine) -> some View {
        let projectName = targetProjectName(for: routine)
        return NavigationStack {
            Form {
                Section("Task & Subtasks") {
                    Text(routine.title)
                        .font(.headline)
                    if !routine.items.isEmpty {
                        ForEach(routine.items) { step in
                            HStack(spacing: 6) {
                                Image(systemName: "circle")
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                                Text(step.title)
                                    .font(.subheadline)
                            }
                        }
                    }
                }
                
                Section("Choose Project") {
                    Picker("Project", selection: Binding(
                        get: { targetProjectName(for: routine) },
                        set: { selectedProjects[routine.id] = $0 }
                    )) {
                        ForEach(supabase.projects) { project in
                            Text(project.name).tag(project.name)
                        }
                    }
                }
                
                Section("Schedule Date & Time") {
                    DatePicker(
                        "When to add/remind",
                        selection: $scheduleDate,
                        in: Date()...,
                        displayedComponents: [.date, .hourAndMinute]
                    )
                    .datePickerStyle(.graphical)
                }
            }
            .navigationTitle("Schedule Task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        schedulingRoutine = nil
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Schedule") {
                        let chosenProject = targetProjectName(for: routine)
                        let chosenDate = scheduleDate
                        schedulingRoutine = nil
                        Task {
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                            await supabase.addDoItAgainToReminders(
                                routine: routine,
                                projectName: chosenProject,
                                scheduledDate: chosenDate
                            )
                            let formatted = chosenDate.formatted(date: .abbreviated, time: .shortened)
                            statusMessage = "Scheduled '\(routine.title)' in \(chosenProject) for \(formatted)!"
                        }
                    }
                    .fontWeight(.bold)
                }
            }
        }
        .presentationDetents([.large])
    }
    
    // MARK: - "Do it again" Card
    private func routineCard(for routine: Routine) -> some View {
        let currentProject = targetProjectName(for: routine)
        
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                // Colored Icon Badge
                ZStack {
                    Circle()
                        .fill(routine.swiftUIColor.opacity(0.15))
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
                        // Project Selector Menu
                        Menu {
                            Section("Choose Project for Reminders") {
                                ForEach(supabase.projects) { project in
                                    Button {
                                        selectedProjects[routine.id] = project.name
                                    } label: {
                                        HStack {
                                            Label(project.name, systemImage: project.icon)
                                            if currentProject.caseInsensitiveCompare(project.name) == .orderedSame {
                                                Image(systemName: "checkmark")
                                            }
                                        }
                                    }
                                }
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "folder.fill")
                                    .font(.system(size: 10))
                                Text(currentProject)
                                    .font(.caption2)
                                    .fontWeight(.bold)
                                Image(systemName: "chevron.up.chevron.down")
                                    .font(.system(size: 8, weight: .bold))
                            }
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Color.indigo.opacity(0.15))
                            .foregroundColor(.indigo)
                            .cornerRadius(6)
                        }
                        
                        if !routine.items.isEmpty {
                            Text("\(routine.items.count) subtasks")
                                .font(.caption2)
                                .fontWeight(.bold)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.secondary.opacity(0.12))
                                .foregroundColor(.secondary)
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
            
            // Always list subtasks clearly inside the "Do it again" card
            if !routine.items.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Divider()
                        .padding(.vertical, 2)
                    
                    ForEach(Array(routine.items.enumerated()), id: \.element.id) { index, step in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text("•")
                                .font(.subheadline)
                                .fontWeight(.bold)
                                .foregroundColor(routine.swiftUIColor)
                            
                            Text(step.title)
                                .font(.subheadline)
                                .foregroundColor(.primary)
                            
                            Spacer()
                        }
                    }
                }
            }
            
            // Action Buttons: Add to Reminders (with Project) | Schedule Time | (1-Step Mode if has subtasks)
            HStack(spacing: 8) {
                Button {
                    Task {
                        deployingRoutineId = routine.id
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        await supabase.addDoItAgainToReminders(
                            routine: routine,
                            projectName: currentProject,
                            scheduledDate: nil
                        )
                        statusMessage = "Added '\(routine.title)' to \(currentProject) in Reminders!"
                        deployingRoutineId = nil
                    }
                } label: {
                    HStack(spacing: 6) {
                        if deployingRoutineId == routine.id {
                            ProgressView()
                                .tint(.white)
                        } else {
                            Image(systemName: "plus.circle.fill")
                            Text("Add to \(currentProject)")
                        }
                    }
                    .font(.footnote)
                    .fontWeight(.bold)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Color.indigo)
                    .foregroundColor(.white)
                    .cornerRadius(10)
                }
                .disabled(deployingRoutineId != nil)
                
                Button {
                    scheduleDate = Date().addingTimeInterval(3600)
                    schedulingRoutine = routine
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "calendar.badge.clock")
                        Text("Schedule")
                    }
                    .font(.footnote)
                    .fontWeight(.bold)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Color.orange.opacity(0.15))
                    .foregroundColor(.orange)
                    .cornerRadius(10)
                }
                
                if !routine.items.isEmpty {
                    Button {
                        let subtasks = routine.items.map { SubtaskItem(title: $0.title, isCompleted: false) }
                        let runnerTask = TaskItem(
                            title: routine.title,
                            description: routine.description,
                            listName: currentProject,
                            estimatedMinutes: 5,
                            subtasks: subtasks
                        )
                        runningRoutineTask = runnerTask
                    } label: {
                        Image(systemName: "flame.fill")
                            .font(.footnote)
                            .fontWeight(.bold)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .background(Color.red)
                            .foregroundColor(.white)
                            .cornerRadius(10)
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

// MARK: - Quick Create "Do it again" Task Sheet
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
    
    let colors = ["#EF4444", "#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#EC4899"]
    let icons = ["arrow.triangle.2.circlepath.circle.fill", "sparkles", "briefcase.fill", "sportscourt.fill", "moon.stars.fill", "bolt.fill", "book.fill"]
    
    var body: some View {
        NavigationStack {
            Form {
                Section("Task Details") {
                    TextField("Task Title", text: $routineTitle)
                    TextField("Notes / Context (optional)", text: $routineDescription)
                    
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
                
                Section("Subtasks (Optional)") {
                    TextField("Subtask 1", text: $step1Title)
                    TextField("Subtask 2", text: $step2Title)
                    TextField("Subtask 3", text: $step3Title)
                    TextField("Subtask 4", text: $step4Title)
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
                    .disabled(routineTitle.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
    
    private func saveRoutine() {
        let rawSteps = [step1Title, step2Title, step3Title, step4Title]
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
