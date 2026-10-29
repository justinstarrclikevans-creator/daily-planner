import SwiftUI

struct ProjectPlaybookEditorView: View {
    var project: Project
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var supabase = SupabaseService.shared
    
    @State private var instructionsText: String = ""
    @State private var selectedSchedule: ProjectScheduleRule = .always
    @State private var customStartTime: Date = Project.dateFromMinutes(480) // 8:00 AM
    @State private var customEndTime: Date = Project.dateFromMinutes(1020) // 5:00 PM
    @State private var customActiveDays: Set<Int> = [1, 2, 3, 4, 5, 6, 7]
    
    private let weekdayItems: [(day: Int, short: String, label: String)] = [
        (1, "S", "Sun"),
        (2, "M", "Mon"),
        (3, "T", "Tue"),
        (4, "W", "Wed"),
        (5, "T", "Thu"),
        (6, "F", "Fri"),
        (7, "S", "Sat")
    ]
    
    private var previewIsVisibleNow: Bool {
        ProjectScheduleRule.evaluateVisibility(
            rule: selectedSchedule,
            startMinutes: Project.minutesFromDate(customStartTime),
            endMinutes: Project.minutesFromDate(customEndTime),
            activeDays: customActiveDays
        )
    }
    
    var body: some View {
        NavigationStack {
            Form {
                Section(header: Text("Project Overview")) {
                    HStack {
                        Label(project.name, systemImage: project.icon)
                            .font(.headline)
                            .foregroundColor(project.swiftUIColor)
                    }
                    if !project.goal.isEmpty {
                        Text(project.goal)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                }
                
                Section(
                    header: Text("Visibility Schedule"),
                    footer: Text("Hide this project and its related cards on days or hours when you don't want to see them (e.g. only active Mon–Wed, or during work hours).")
                ) {
                    Picker("Active Hours", selection: $selectedSchedule) {
                        ForEach(ProjectScheduleRule.allCases) { rule in
                            Label(rule.rawValue, systemImage: rule.icon).tag(rule)
                        }
                    }
                    
                    if selectedSchedule == .customDays || selectedSchedule == .customHours {
                        if selectedSchedule == .customHours {
                            DatePicker(
                                "Start Time",
                                selection: $customStartTime,
                                displayedComponents: .hourAndMinute
                            )
                            
                            DatePicker(
                                "End Time",
                                selection: $customEndTime,
                                displayedComponents: .hourAndMinute
                            )
                        }
                        
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Text("Active Days")
                                    .font(.subheadline)
                                Spacer()
                                HStack(spacing: 6) {
                                    Button("Daily") {
                                        customActiveDays = [1, 2, 3, 4, 5, 6, 7]
                                    }
                                    .buttonStyle(.bordered)
                                    .controlSize(.mini)
                                    
                                    Button("Mon–Fri") {
                                        customActiveDays = [2, 3, 4, 5, 6]
                                    }
                                    .buttonStyle(.bordered)
                                    .controlSize(.mini)
                                    
                                    Button("Wknds") {
                                        customActiveDays = [1, 7]
                                    }
                                    .buttonStyle(.bordered)
                                    .controlSize(.mini)
                                }
                            }
                            
                            HStack(spacing: 8) {
                                ForEach(weekdayItems, id: \.day) { item in
                                    let isSelected = customActiveDays.contains(item.day)
                                    Button {
                                        if isSelected && customActiveDays.count > 1 {
                                            customActiveDays.remove(item.day)
                                        } else {
                                            customActiveDays.insert(item.day)
                                        }
                                    } label: {
                                        VStack(spacing: 2) {
                                            Text(item.short)
                                                .font(.caption)
                                                .fontWeight(.bold)
                                            Text(item.label)
                                                .font(.system(size: 9))
                                        }
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 8)
                                        .background(isSelected ? project.swiftUIColor : Color(.secondarySystemBackground))
                                        .foregroundColor(isSelected ? .white : .primary)
                                        .cornerRadius(8)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    
                    HStack {
                        Text("Current Status:")
                            .font(.footnote)
                            .foregroundColor(.secondary)
                        Spacer()
                        Text(previewIsVisibleNow ? "Visible Right Now" : "Hidden Right Now")
                            .font(.footnote)
                            .fontWeight(.bold)
                            .foregroundColor(previewIsVisibleNow ? .green : .orange)
                    }
                }
                
                Section(
                    header: Text("AI Assistant Playbook & Instructions"),
                    footer: Text("These instructions guide how the AI assistant prioritizes, schedules, and breaks down tasks for this project. E.g. 'Participant intakes always come first', 'No meetings on Friday mornings'.")
                ) {
                    TextEditor(text: $instructionsText)
                        .frame(minHeight: 180)
                        .font(.body)
                }
            }
            .navigationTitle("Visibility & Playbook")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        saveInstructions()
                    }
                    .fontWeight(.bold)
                }
            }
            .onAppear {
                self.instructionsText = project.effectiveInstructions
                self.selectedSchedule = project.effectiveScheduleRule
                self.customStartTime = Project.dateFromMinutes(project.effectiveCustomStartMinutes)
                self.customEndTime = Project.dateFromMinutes(project.effectiveCustomEndMinutes)
                self.customActiveDays = project.effectiveCustomActiveDays
            }
        }
    }
    
    private func saveInstructions() {
        let startMins = Project.minutesFromDate(customStartTime)
        let endMins = Project.minutesFromDate(customEndTime)
        let sortedDays = Array(customActiveDays).sorted()
        
        Task {
            await supabase.updateProjectPlaybook(
                projectId: project.id,
                instructions: instructionsText.trimmingCharacters(in: .whitespacesAndNewlines),
                scheduleRule: selectedSchedule,
                customStartMinutes: startMins,
                customEndMinutes: endMins,
                customActiveDays: sortedDays
            )
            await MainActor.run {
                dismiss()
            }
        }
    }
}
