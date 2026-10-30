import SwiftUI

struct ConvertTaskToProjectSheet: View {
    let task: TaskItem
    @ObservedObject private var supabase = SupabaseService.shared
    @Environment(\.dismiss) private var dismiss
    
    @State private var projectName: String
    @State private var selectedColor: String = "#3B82F6"
    @State private var selectedIcon: String = "folder.fill"
    @State private var keywords: [String] = []
    @State private var newKeywordInput: String = ""
    
    let colorPalette = [
        "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#06B6D4"
    ]
    
    init(task: TaskItem) {
        self.task = task
        _projectName = State(initialValue: task.title)
    }
    
    private func deriveInitialKeywords() -> [String] {
        let stopWords: Set<String> = [
            "the", "and", "for", "that", "this", "with", "from", "have", "make",
            "about", "will", "into", "some", "task", "todo", "plan"
        ]
        let raw = task.title.lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { $0.count >= 3 && !stopWords.contains($0) }
        return Array(Set(raw))
    }
    
    var body: some View {
        NavigationStack {
            Form {
                Section(header: Text("NEW PROJECT DETAILS")) {
                    TextField("Project Name", text: $projectName)
                    
                    // Color Picker
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Color Accent")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        
                        HStack(spacing: 12) {
                            ForEach(colorPalette, id: \.self) { hex in
                                Circle()
                                    .fill(Color(hex: hex))
                                    .frame(width: 28, height: 28)
                                    .overlay(
                                        Circle()
                                            .stroke(Color.primary, lineWidth: selectedColor == hex ? 2 : 0)
                                    )
                                    .scaleEffect(selectedColor == hex ? 1.15 : 1.0)
                                    .onTapGesture {
                                        selectedColor = hex
                                    }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
                
                Section(header: Text("AUTO-ROUTING RULES & KEYWORDS"), footer: Text("Incoming and future todos containing these keywords will automatically route into this project.")) {
                    HStack {
                        TextField("Add keyword (e.g. sponsor)...", text: $newKeywordInput)
                            .onSubmit {
                                addKeyword()
                            }
                        Button("Add") {
                            addKeyword()
                        }
                        .disabled(newKeywordInput.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    
                    if !keywords.isEmpty {
                        ForEach(keywords, id: \.self) { kw in
                            HStack {
                                Label(kw, systemImage: "tag.fill")
                                    .font(.caption)
                                    .foregroundColor(.indigo)
                                Spacer()
                                Button(role: .destructive) {
                                    keywords.removeAll { $0 == kw }
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .foregroundColor(.secondary)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Turn into Project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create Project") {
                        Task {
                            await supabase.createProjectFromTask(
                                task: task,
                                name: projectName,
                                color: selectedColor,
                                icon: selectedIcon,
                                keywords: keywords
                            )
                            dismiss()
                        }
                    }
                    .disabled(projectName.trimmingCharacters(in: .whitespaces).isEmpty)
                    .bold()
                }
            }
            .onAppear {
                keywords = deriveInitialKeywords()
            }
        }
    }
    
    private func addKeyword() {
        let trimmed = newKeywordInput.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if !trimmed.isEmpty && !keywords.contains(trimmed) {
            keywords.append(trimmed)
            newKeywordInput = ""
        }
    }
}
