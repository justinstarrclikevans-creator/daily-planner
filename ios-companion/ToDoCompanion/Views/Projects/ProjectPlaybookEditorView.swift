import SwiftUI

struct ProjectPlaybookEditorView: View {
    var project: Project
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var supabase = SupabaseService.shared
    
    @State private var instructionsText: String = ""
    @State private var selectedSchedule: ProjectScheduleRule = .always
    @State private var isSavedToast: Bool = false
    
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
                    footer: Text("Hide this project and its related tasks during specific times (e.g. keep personal or book projects hidden during work hours, or work projects hidden on weekends).")
                ) {
                    Picker("Active Hours", selection: $selectedSchedule) {
                        ForEach(ProjectScheduleRule.allCases) { rule in
                            Label(rule.rawValue, systemImage: rule.icon).tag(rule)
                        }
                    }
                    
                    HStack {
                        Text("Current Status:")
                            .font(.footnote)
                            .foregroundColor(.secondary)
                        Spacer()
                        Text(selectedSchedule.isVisibleNow ? "Visible Right Now" : "Hidden Right Now")
                            .font(.footnote)
                            .fontWeight(.bold)
                            .foregroundColor(selectedSchedule.isVisibleNow ? .green : .orange)
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
            .navigationTitle("Project Playbook")
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
            }
        }
    }
    
    private func saveInstructions() {
        Task {
            await supabase.updateProjectPlaybook(
                projectId: project.id,
                instructions: instructionsText.trimmingCharacters(in: .whitespacesAndNewlines),
                scheduleRule: selectedSchedule
            )
            await MainActor.run {
                dismiss()
            }
        }
    }
}
