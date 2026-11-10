import SwiftUI

struct CreateTaskSheetView: View {
    var prefillProject: Project? = nil
    
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var supabase = SupabaseService.shared
    @ObservedObject private var taggingService = TaggingRulesService.shared
    
    @State private var title: String = ""
    @State private var selectedProjectName: String = "General"
    @State private var selectedProjectTag: String = ""
    @State private var selectedStage: String = "today" // "today" | "backlog" | "tomorrow"
    @State private var selectedPriority: String = "medium" // "high" | "medium" | "low"
    @State private var selectedDuration: Int = 15
    @State private var selectedSpaceTag: String = ""
    @State private var selectedPersonTag: String = ""
    @State private var firstFiveMinutes: String = ""
    
    // Subtasks input modes: Batch (multi-line paste/type) vs Single
    @State private var isBatchMode: Bool = true
    @State private var batchSubtasksText: String = ""
    @State private var singleStepTitle: String = ""
    @State private var individualSteps: [String] = []
    
    let durationOptions = [5, 10, 15, 20, 25, 30, 45, 60]
    
    private var parsedBatchSubtasks: [String] {
        let lines = batchSubtasksText.components(separatedBy: .newlines)
        return lines.compactMap { line in
            let cleaned = line
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .replacingOccurrences(of: "^[-•*\\d.)]+\\s*", with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return cleaned.isEmpty ? nil : cleaned
        }
    }
    
    var body: some View {
        NavigationStack {
            Form {
                // Section 1: Title
                Section("Task Title (Active Sentence)") {
                    TextField("E.g. Email Jenn about transfer training", text: $title)
                        .font(.body)
                }
                
                // Section 2: Sunsama Stage (Today vs Backlog vs Tomorrow)
                Section("When to Schedule") {
                    Picker("Stage", selection: $selectedStage) {
                        Text("☀️ Today's Plan").tag("today")
                        Text("📥 Backlog").tag("backlog")
                        Text("🌅 Tomorrow").tag("tomorrow")
                    }
                    .pickerStyle(.segmented)
                }
                
                // Section 3: Channel / Project Tag
                Section("Channel / Project Tag (Optional)") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            tagChip(label: "None", isSelected: selectedProjectTag.isEmpty) {
                                selectedProjectTag = ""
                            }
                            ForEach(taggingService.rules.projects) { proj in
                                let clean = proj.tag.replacingOccurrences(of: "#", with: "")
                                tagChip(label: "#\(clean)", isSelected: selectedProjectTag == clean) {
                                    selectedProjectTag = (selectedProjectTag == clean) ? "" : clean
                                }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
                
                // Section 3: Context / Space Tag
                Section("Context / Space Tag") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            tagChip(label: "None", isSelected: selectedSpaceTag.isEmpty) {
                                selectedSpaceTag = ""
                            }
                            ForEach(taggingService.rules.spaces) { space in
                                tagChip(label: "#\(space.tag)", isSelected: selectedSpaceTag == space.tag) {
                                    selectedSpaceTag = (selectedSpaceTag == space.tag) ? "" : space.tag
                                }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
                
                // Section 4: Person Tag
                Section("Person Tag (Optional)") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            tagChip(label: "None", isSelected: selectedPersonTag.isEmpty) {
                                selectedPersonTag = ""
                            }
                            ForEach(taggingService.rules.people) { person in
                                tagChip(label: "#\(person.tag)", isSelected: selectedPersonTag == person.tag) {
                                    selectedPersonTag = (selectedPersonTag == person.tag) ? "" : person.tag
                                }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
                
                // Section 3: Importance / Priority (High, Medium, Low)
                Section("Importance / Priority") {
                    HStack(spacing: 8) {
                        priorityButton(
                            label: "High",
                            icon: "flame.fill",
                            value: "high",
                            color: .red
                        )
                        
                        priorityButton(
                            label: "Medium",
                            icon: "bolt.fill",
                            value: "medium",
                            color: .orange
                        )
                        
                        priorityButton(
                            label: "Low",
                            icon: "leaf.fill",
                            value: "low",
                            color: .green
                        )
                    }
                    .padding(.vertical, 4)
                }
                
                // Section 4: Estimated Time
                Section("Estimated Time") {
                    Picker("Duration", selection: $selectedDuration) {
                        ForEach(durationOptions, id: \.self) { mins in
                            Text("\(mins)m\(mins <= 10 ? " (Quick)" : mins == 15 ? " (Standard)" : "")").tag(mins)
                        }
                    }
                    .pickerStyle(.menu)
                }
                
                // Section 5: First 5 Minutes (Optional)
                Section("⚡ First 5 Minutes Kickstart (Optional)") {
                    TextField("E.g. Open Figma file and review feedback", text: $firstFiveMinutes)
                        .font(.subheadline)
                }
                
                // Section 6: Multiple Subtasks
                Section {
                    // Mode Switcher
                    Picker("Input Style", selection: $isBatchMode) {
                        Text("Add Multiple (Paste/Lines)").tag(true)
                        Text("One by One").tag(false)
                    }
                    .pickerStyle(.segmented)
                    .padding(.vertical, 2)
                    
                    if isBatchMode {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Paste or type multiple subtasks (one per line):")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            
                            TextEditor(text: $batchSubtasksText)
                                .frame(minHeight: 110)
                                .font(.subheadline)
                                .overlay(
                                    Group {
                                        if batchSubtasksText.isEmpty {
                                            Text("• Subtask 1\n• Subtask 2\n• Subtask 3")
                                                .font(.subheadline)
                                                .foregroundColor(.secondary.opacity(0.4))
                                                .padding(.top, 8)
                                                .padding(.leading, 5)
                                                .allowsHitTesting(false)
                                        }
                                    },
                                    alignment: .topLeading
                                )
                            
                            if !parsedBatchSubtasks.isEmpty {
                                HStack {
                                    Image(systemName: "checklist")
                                        .font(.caption)
                                        .foregroundColor(.indigo)
                                    Text("\(parsedBatchSubtasks.count) subtasks detected")
                                        .font(.caption)
                                        .fontWeight(.semibold)
                                        .foregroundColor(.indigo)
                                }
                                .padding(.top, 2)
                            }
                        }
                    } else {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                TextField("Add a subtask...", text: $singleStepTitle)
                                    .onSubmit { addSingleStep() }
                                
                                if !singleStepTitle.trimmingCharacters(in: .whitespaces).isEmpty {
                                    Button(action: addSingleStep) {
                                        Image(systemName: "plus.circle.fill")
                                            .foregroundColor(.indigo)
                                    }
                                }
                            }
                            
                            ForEach(Array(individualSteps.enumerated()), id: \.offset) { idx, step in
                                HStack {
                                    Text("• \(step)")
                                        .font(.subheadline)
                                    Spacer()
                                    Button {
                                        individualSteps.remove(at: idx)
                                    } label: {
                                        Image(systemName: "xmark")
                                            .font(.caption2)
                                            .foregroundColor(.secondary)
                                    }
                                }
                                .padding(.vertical, 2)
                            }
                        }
                    }
                } header: {
                    Text("Subtasks & Milestones")
                }
            }
            .navigationTitle("New Task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        saveTask()
                    }
                    .fontWeight(.bold)
                    .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear {
                if let prefill = prefillProject {
                    selectedProjectName = prefill.name
                }
            }
        }
    }
    
    // MARK: - Priority Pill Button
    private func priorityButton(label: String, icon: String, value: String, color: Color) -> some View {
        let isSelected = selectedPriority == value
        return Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            selectedPriority = value
        } label: {
            HStack(spacing: 5) {
                Image(systemName: icon)
                    .font(.footnote)
                Text(label)
                    .font(.footnote)
                    .fontWeight(.bold)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 9)
            .background(isSelected ? color : color.opacity(0.12))
            .foregroundColor(isSelected ? .white : color)
            .cornerRadius(10)
        }
        .buttonStyle(.plain)
    }
    
    private func tagChip(label: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.caption.bold())
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(isSelected ? Color.indigo : Color(UIColor.secondarySystemGroupedBackground))
                .foregroundColor(isSelected ? .white : .primary)
                .cornerRadius(8)
        }
        .buttonStyle(.plain)
    }

    private func addSingleStep() {
        let trimmed = singleStepTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        individualSteps.append(trimmed)
        singleStepTitle = ""
    }
    
    private func saveTask() {
        let finalTitle = title
            .replacingOccurrences(of: "!+", with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !finalTitle.isEmpty else { return }
        
        let allSubtaskTitles: [String] = isBatchMode ? parsedBatchSubtasks : individualSteps
        let subtaskItems = allSubtaskTitles.map { SubtaskItem(title: $0, isCompleted: false) }
        
        let matchedProj = supabase.projects.first { $0.name.caseInsensitiveCompare(selectedProjectName) == .orderedSame }
        
        let firstFive = firstFiveMinutes.trimmingCharacters(in: .whitespacesAndNewlines)
        let firstFiveOpt = firstFive.isEmpty ? nil : firstFive

        var finalTags: [String] = []
        if !selectedProjectTag.isEmpty { finalTags.append(selectedProjectTag.replacingOccurrences(of: "#", with: "")) }
        if !selectedSpaceTag.isEmpty { finalTags.append(selectedSpaceTag.replacingOccurrences(of: "#", with: "")) }
        if !selectedPersonTag.isEmpty { finalTags.append(selectedPersonTag.replacingOccurrences(of: "#", with: "")) }
        
        let cal = Calendar.current
        let resolvedDueDate: Date?
        let isTodayQueue: Bool
        if selectedStage == "today" {
            resolvedDueDate = cal.startOfDay(for: Date())
            isTodayQueue = true
        } else if selectedStage == "tomorrow" {
            resolvedDueDate = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: Date()))
            isTodayQueue = false
        } else {
            resolvedDueDate = nil
            isTodayQueue = false
        }
        
        Task {
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            
            // Build notes with serialized metadata, tags & subtasks (keeping title 100% clean)
            let serializedNotes = TaskItem.buildDescription(
                cleanNotes: "",
                estimatedMinutes: selectedDuration,
                inPlayQueue: isTodayQueue,
                firstFiveMinutes: firstFiveOpt,
                subtasks: subtaskItems,
                tags: finalTags
            )
            
            // Sync to Apple Reminders ("General" list)
            let reminderId = try? await RemindersManager.shared.addReminder(
                title: finalTitle,
                notes: serializedNotes,
                listName: "General",
                dueDate: resolvedDueDate
            )
            
            // Create in Supabase & local state
            await supabase.createTask(
                title: finalTitle,
                description: serializedNotes,
                listName: "General",
                projectId: matchedProj?.id,
                dueDate: resolvedDueDate,
                appleReminderId: reminderId,
                estimatedMinutes: selectedDuration,
                priority: selectedPriority,
                inPlayQueue: isTodayQueue,
                firstFiveMinutes: firstFiveOpt,
                subtasks: subtaskItems,
                tags: finalTags
            )
            
            dismiss()
        }
    }
}
