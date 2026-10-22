import SwiftUI

struct CreateProjectSheetView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var supabase = SupabaseService.shared
    @ObservedObject private var reminders = RemindersManager.shared
    
    @State private var name: String = ""
    @State private var goal: String = ""
    @State private var instructions: String = ""
    @State private var selectedColorHex: String = "#3B82F6"
    @State private var selectedIcon: String = "briefcase.fill"
    @State private var selectedSchedule: ProjectScheduleRule = .always
    @State private var createAppleReminderList: Bool = true
    @State private var isCreating: Bool = false
    
    // Optional prefill for Rule of 3 conversion
    init(prefillName: String = "", prefillGoal: String = "") {
        _name = State(initialValue: prefillName)
        _goal = State(initialValue: prefillGoal)
    }
    
    let colors = [
        "#EF4444", "#3B82F6", "#10B981", "#8B5CF6",
        "#F59E0B", "#EC4899", "#14B8A6", "#6366F1",
        "#64748B", "#F97316"
    ]
    
    let icons = [
        "briefcase.fill", "book.fill", "sportscourt.fill", "video.fill",
        "film.fill", "sparkles", "hammer.fill", "graduationcap.fill",
        "figure.run", "heart.fill", "star.fill", "flame.fill",
        "folder.fill", "envelope.fill", "chart.bar.fill", "person.fill"
    ]
    
    var body: some View {
        NavigationStack {
            Form {
                Section("Project Identity") {
                    TextField("Project Name (e.g. Book Project)", text: $name)
                        .autocapitalization(.words)
                    
                    TextField("High-Level Goal / Mission", text: $goal)
                }
                
                Section("Color & Icon") {
                    // Color row
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
                    
                    // Icon row
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 8), spacing: 10) {
                        ForEach(icons, id: \.self) { iconName in
                            Image(systemName: iconName)
                                .font(.body)
                                .foregroundColor(selectedIcon == iconName ? Color(hex: selectedColorHex) : .secondary)
                                .padding(8)
                                .background(selectedIcon == iconName ? Color(hex: selectedColorHex).opacity(0.18) : Color.clear)
                                .cornerRadius(8)
                                .onTapGesture {
                                    selectedIcon = iconName
                                }
                        }
                    }
                    .padding(.vertical, 4)
                }
                
                Section(
                    header: Text("Visibility Schedule"),
                    footer: Text("Controls when this project's tasks appear. E.g. Set 'Off Hours' or 'Weekends Only' for side projects to avoid distraction during business hours.")
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
                    header: Text("Playbook & AI Instructions (Optional)"),
                    footer: Text("Custom rules for the AI assistant when scheduling or breaking down tasks for this project.")
                ) {
                    TextEditor(text: $instructions)
                        .frame(minHeight: 100)
                }
                
                Section {
                    Toggle("Create Apple Reminders List", isOn: $createAppleReminderList)
                }
            }
            .navigationTitle("New Project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        createProject()
                    }
                    .fontWeight(.bold)
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || isCreating)
                }
            }
        }
    }
    
    private func createProject() {
        let cleanName = name.trimmingCharacters(in: .whitespaces)
        guard !cleanName.isEmpty else { return }
        isCreating = true
        
        let slug = cleanName
            .lowercased()
            .replacingOccurrences(of: " ", with: "-")
            .replacingOccurrences(of: "[^a-z0-9-]", with: "", options: .regularExpression)
        
        Task {
            _ = await supabase.createProject(
                name: cleanName,
                slug: slug.isEmpty ? "project-\(Int.random(in: 100...999))" : slug,
                color: selectedColorHex,
                icon: selectedIcon,
                goal: goal.trimmingCharacters(in: .whitespaces),
                instructions: instructions.trimmingCharacters(in: .whitespaces),
                scheduleRule: selectedSchedule
            )
            
            if createAppleReminderList {
                _ = await reminders.createReminderList(named: cleanName)
            }
            
            await MainActor.run {
                dismiss()
            }
        }
    }
}
