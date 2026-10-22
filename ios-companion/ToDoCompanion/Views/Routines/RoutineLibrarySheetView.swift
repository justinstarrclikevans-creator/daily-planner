import SwiftUI

struct RoutineLibrarySheetView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var supabase = SupabaseService.shared
    @State private var expandedRoutineId: UUID? = nil
    @State private var deployingRoutineId: UUID? = nil
    @State private var showCreateSheet: Bool = false
    @State private var showAudioSheet: Bool = false
    @State private var statusMessage: String? = nil
    @State private var runningRoutineTask: TaskItem? = nil
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Header Subtitle
                    Text("Select a multi-step routine to instantly populate your Play Queue or run 1 step at a time.")
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
                                Text("AI converts notes or audio into a sequential 1-step workflow.")
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
                    
                    // Routine Cards
                    LazyVStack(spacing: 16) {
                        ForEach(supabase.routines) { routine in
                            routineCard(for: routine)
                        }
                    }
                    .padding(.horizontal)
                }
                .padding(.vertical)
            }
            .navigationTitle("Routine Library")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Close") {
                        dismiss()
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
                            Label("Manual Step-by-Step", systemImage: "plus")
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
    
    // MARK: - Routine Card
    private func routineCard(for routine: Routine) -> some View {
        VStack(alignment: .leading, spacing: 12) {
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
                        Text("\(routine.items.count) steps")
                            .font(.caption2)
                            .fontWeight(.bold)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.secondary.opacity(0.12))
                            .foregroundColor(.secondary)
                            .cornerRadius(6)
                        
                        Text("⏱ ~\(routine.totalEstimatedMinutes)m")
                            .font(.caption2)
                            .fontWeight(.bold)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(routine.swiftUIColor.opacity(0.12))
                            .foregroundColor(routine.swiftUIColor)
                            .cornerRadius(6)
                    }
                }
                
                Spacer()
                
                // Expand / Collapse Chevron
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        if expandedRoutineId == routine.id {
                            expandedRoutineId = nil
                        } else {
                            expandedRoutineId = routine.id
                        }
                    }
                } label: {
                    Image(systemName: expandedRoutineId == routine.id ? "chevron.up.circle.fill" : "chevron.down.circle")
                        .font(.title3)
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
            }
            
            if !routine.description.isEmpty {
                Text(routine.description)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            // Expanded Steps Preview
            if expandedRoutineId == routine.id {
                VStack(alignment: .leading, spacing: 8) {
                    Divider()
                        .padding(.vertical, 2)
                    
                    Text("STEPS IN THIS ROUTINE")
                        .font(.system(size: 10, weight: .black))
                        .tracking(1)
                        .foregroundColor(.secondary)
                    
                    ForEach(Array(routine.items.enumerated()), id: \.element.id) { index, step in
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Text("\(index + 1)")
                                .font(.caption2)
                                .fontWeight(.bold)
                                .foregroundColor(.white)
                                .frame(width: 18, height: 18)
                                .background(routine.swiftUIColor)
                                .clipShape(Circle())
                            
                            VStack(alignment: .leading, spacing: 2) {
                                HStack {
                                    Text(step.title)
                                        .font(.subheadline)
                                        .fontWeight(.medium)
                                    Spacer()
                                    Text("\(step.estimatedMinutes)m")
                                        .font(.caption2)
                                        .foregroundColor(.secondary)
                                }
                                
                                if let prompt = step.firstFiveMinutes {
                                    Text("⚡ 5m: \(prompt)")
                                        .font(.caption2)
                                        .foregroundColor(.orange)
                                }
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
            }
            
            // Action Buttons: Run 1-Step Focus vs Deploy All
            HStack(spacing: 8) {
                Button {
                    let subtasks = routine.items.map { SubtaskItem(title: $0.title, isCompleted: false) }
                    let totalMins = TaskDuration.normalize(routine.totalEstimatedMinutes).rawValue
                    let runnerTask = TaskItem(
                        title: routine.title,
                        description: routine.description,
                        listName: "Routine",
                        estimatedMinutes: totalMins,
                        firstFiveMinutesPrompt: routine.items.first?.firstFiveMinutes,
                        subtasks: subtasks
                    )
                    runningRoutineTask = runnerTask
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "flame.fill")
                        Text("Run 1-Step Focus")
                    }
                    .font(.footnote)
                    .fontWeight(.bold)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Color.red)
                    .foregroundColor(.white)
                    .cornerRadius(10)
                }
                
                Button {
                    Task {
                        deployingRoutineId = routine.id
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        await supabase.insertRoutineIntoQueue(routine: routine)
                        SpeechSynthesisService.shared.speak("Deployed \(routine.title) into today's play queue.")
                        statusMessage = "Deployed \(routine.title) (\(routine.items.count) tasks added to queue)!"
                        deployingRoutineId = nil
                    }
                } label: {
                    HStack(spacing: 6) {
                        if deployingRoutineId == routine.id {
                            ProgressView()
                                .tint(.white)
                        } else {
                            Image(systemName: "play.circle.fill")
                            Text("Queue All")
                        }
                    }
                    .font(.footnote)
                    .fontWeight(.bold)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(routine.swiftUIColor)
                    .foregroundColor(.white)
                    .cornerRadius(10)
                }
                .disabled(deployingRoutineId != nil)
            }
            .padding(.top, 4)
        }
        .padding(16)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(16)
    }
}

// MARK: - Quick Create Routine Sheet
struct CreateRoutineSheetView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var supabase = SupabaseService.shared
    
    @State private var routineTitle: String = ""
    @State private var routineDescription: String = ""
    @State private var selectedColorHex: String = "#6366F1"
    @State private var selectedIcon: String = "sparkles"
    
    @State private var step1Title: String = ""
    @State private var step1Mins: Int = 10
    @State private var step1Prompt: String = ""
    
    @State private var step2Title: String = ""
    @State private var step2Mins: Int = 15
    @State private var step2Prompt: String = ""
    
    @State private var step3Title: String = ""
    @State private var step3Mins: Int = 10
    @State private var step3Prompt: String = ""
    
    let colors = ["#EF4444", "#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#EC4899"]
    let icons = ["sparkles", "briefcase.fill", "sportscourt.fill", "moon.stars.fill", "bolt.fill", "heart.fill", "book.fill"]
    
    var body: some View {
        NavigationStack {
            Form {
                Section("Routine Details") {
                    TextField("Routine Title (e.g. Morning Casework)", text: $routineTitle)
                    TextField("Description (e.g. 3-step daily startup)", text: $routineDescription)
                    
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
                
                Section("Step 1") {
                    TextField("Action title", text: $step1Title)
                    Stepper("\(step1Mins) minutes", value: $step1Mins, in: 2...60, step: 5)
                    TextField("⚡ First 5m micro-action", text: $step1Prompt)
                }
                
                Section("Step 2 (Optional)") {
                    TextField("Action title", text: $step2Title)
                    Stepper("\(step2Mins) minutes", value: $step2Mins, in: 2...60, step: 5)
                    TextField("⚡ First 5m micro-action", text: $step2Prompt)
                }
                
                Section("Step 3 (Optional)") {
                    TextField("Action title", text: $step3Title)
                    Stepper("\(step3Mins) minutes", value: $step3Mins, in: 2...60, step: 5)
                    TextField("⚡ First 5m micro-action", text: $step3Prompt)
                }
            }
            .navigationTitle("New Routine")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Save") {
                        saveRoutine()
                    }
                    .disabled(routineTitle.trimmingCharacters(in: .whitespaces).isEmpty || step1Title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
    
    private func saveRoutine() {
        var items: [RoutineItemStep] = []
        if !step1Title.trimmingCharacters(in: .whitespaces).isEmpty {
            items.append(RoutineItemStep(title: step1Title.trimmingCharacters(in: .whitespaces), estimatedMinutes: step1Mins, firstFiveMinutes: step1Prompt.isEmpty ? nil : step1Prompt))
        }
        if !step2Title.trimmingCharacters(in: .whitespaces).isEmpty {
            items.append(RoutineItemStep(title: step2Title.trimmingCharacters(in: .whitespaces), estimatedMinutes: step2Mins, firstFiveMinutes: step2Prompt.isEmpty ? nil : step2Prompt))
        }
        if !step3Title.trimmingCharacters(in: .whitespaces).isEmpty {
            items.append(RoutineItemStep(title: step3Title.trimmingCharacters(in: .whitespaces), estimatedMinutes: step3Mins, firstFiveMinutes: step3Prompt.isEmpty ? nil : step3Prompt))
        }
        
        Task {
            await supabase.createRoutine(
                title: routineTitle.trimmingCharacters(in: .whitespaces),
                description: routineDescription.trimmingCharacters(in: .whitespaces),
                color: selectedColorHex,
                icon: selectedIcon,
                items: items
            )
            dismiss()
        }
    }
}
