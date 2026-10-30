import SwiftUI

struct TaskRowView: View {
    var task: TaskItem
    var onToggle: () -> Void
    var onFocus: (() -> Void)? = nil
    
    @ObservedObject private var supabase = SupabaseService.shared
    
    @State private var isCompleting: Bool = false
    @State private var checkmarkScale: CGFloat = 1.0
    
    private var isVisuallyDone: Bool {
        task.isCompleted || isCompleting
    }
    
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // Checkbox with satisfying animated completion
            Button(action: handleToggle) {
                ZStack {
                    Image(systemName: isVisuallyDone ? "checkmark.circle.fill" : "circle")
                        .font(.title3)
                        .foregroundColor(isVisuallyDone ? .green : .secondary)
                        .scaleEffect(checkmarkScale)
                    
                    if isCompleting {
                        Circle()
                            .stroke(Color.green.opacity(0.35), lineWidth: 2)
                            .frame(width: 26, height: 26)
                            .scaleEffect(checkmarkScale * 1.15)
                    }
                }
            }
            .buttonStyle(.borderless)
            .padding(.top, 2)
            
            // Content
            VStack(alignment: .leading, spacing: 4) {
                // Title and badges
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(task.title)
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .strikethrough(isVisuallyDone)
                        .foregroundColor(isVisuallyDone ? .secondary : .primary)
                        .animation(.easeInOut(duration: 0.2), value: isVisuallyDone)
                    
                    Spacer()
                    
                    // Duration pill with Quick Time Frame Changer
                    Menu {
                        Section("Change Time Frame") {
                            ForEach([5, 10, 15, 20, 25, 30, 45, 60], id: \.self) { mins in
                                Button {
                                    var updated = task
                                    updated.updateMetadata(estimatedMinutes: mins)
                                    Task {
                                        await supabase.updateTask(updated)
                                    }
                                } label: {
                                    HStack {
                                        Text("\(mins) min\(mins <= 10 ? " (Quick)" : mins == 15 ? " (Standard)" : "")")
                                        if task.estimatedMinutes == mins {
                                            Image(systemName: "checkmark")
                                        }
                                    }
                                }
                            }
                        }
                    } label: {
                        HStack(spacing: 3) {
                            Image(systemName: "clock")
                                .font(.system(size: 9))
                            Text("\(task.estimatedMinutes)m")
                                .font(.system(size: 10, weight: .bold))
                            if task.actualSeconds > 0 {
                                Text("(\(max(1, task.actualSeconds / 60))m)")
                                    .font(.system(size: 9))
                            }
                        }
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(durationBadgeColor.opacity(0.12))
                        .foregroundColor(durationBadgeColor)
                        .cornerRadius(6)
                    }
                    .buttonStyle(.borderless)
                }
                
                // Clean Description (if available)
                if !task.cleanDescription.isEmpty {
                    Text(task.cleanDescription)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }
                
                // Badges Row
                HStack(spacing: 6) {
                    // Interactive Project Switcher Badge (Move task between projects)
                    Menu {
                        Section("Move to Project") {
                            ForEach(supabase.projects) { project in
                                Button {
                                    Task {
                                        await supabase.moveTask(task, toProjectNamed: project.name)
                                    }
                                } label: {
                                    HStack {
                                        Label(project.name, systemImage: project.icon)
                                        if task.listName.caseInsensitiveCompare(project.name) == .orderedSame {
                                            Image(systemName: "checkmark")
                                        }
                                    }
                                }
                            }
                        }
                        Section("Processes") {
                            Button {
                                supabase.saveTaskToDoItAgain(task)
                                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                            } label: {
                                Label("Save to 'Processes'", systemImage: "arrow.triangle.2.circlepath.circle")
                            }
                        }
                    } label: {
                        HStack(spacing: 3) {
                            Text(task.listName)
                                .font(.caption2)
                                .fontWeight(.semibold)
                            Image(systemName: "chevron.up.chevron.down")
                                .font(.system(size: 7, weight: .bold))
                        }
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(listBadgeColor.opacity(0.15))
                        .foregroundColor(listBadgeColor)
                        .cornerRadius(6)
                    }
                    .buttonStyle(.borderless)
                    
                    // Subtask Progress Pill
                    if !task.subtasks.isEmpty {
                        let completed = task.subtasks.filter { $0.isCompleted }.count
                        HStack(spacing: 3) {
                            Image(systemName: "checklist")
                                .font(.system(size: 9))
                            Text("\(completed)/\(task.subtasks.count)")
                                .font(.system(size: 10, weight: .medium))
                        }
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(Color.secondary.opacity(0.12))
                        .foregroundColor(.secondary)
                        .cornerRadius(6)
                    }
                    
                    // Save to "Processes" quick button
                    Button {
                        supabase.saveTaskToDoItAgain(task)
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    } label: {
                        HStack(spacing: 2) {
                            Image(systemName: "arrow.triangle.2.circlepath")
                                .font(.system(size: 9))
                            Text("Process")
                                .font(.system(size: 9, weight: .semibold))
                        }
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(Color.indigo.opacity(0.1))
                        .foregroundColor(.indigo)
                        .cornerRadius(6)
                    }
                    .buttonStyle(.borderless)
                    

                    
                    if let source = task.source as String?, source != "ios" {
                        Label(source.capitalized, systemImage: sourceIcon(for: source))
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                    
                    Spacer()
                    
                    // Focus Sprint Launcher Button
                    if !task.isCompleted {
                        Button {
                            onFocus?()
                        } label: {
                            HStack(spacing: 3) {
                                Image(systemName: "play.fill")
                                    .font(.system(size: 8))
                                Text("Focus")
                                    .font(.system(size: 10, weight: .bold))
                            }
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Color.orange.opacity(0.15))
                            .foregroundColor(.orange)
                            .cornerRadius(10)
                        }
                        .buttonStyle(.borderless)
                    }
                }
                .padding(.top, 2)
            }
        }
        .padding(.vertical, 6)
        .contextMenu {
            Menu("Move to Project") {
                ForEach(supabase.projects) { project in
                    Button {
                        Task {
                            await supabase.moveTask(task, toProjectNamed: project.name)
                        }
                    } label: {
                        Label(project.name, systemImage: project.icon)
                    }
                }
            }
            Button {
                supabase.saveTaskToDoItAgain(task)
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            } label: {
                Label("Save to 'Processes'", systemImage: "arrow.triangle.2.circlepath.circle")
            }
        }
        .padding(.vertical, 2)
        .background(isCompleting ? Color.green.opacity(0.1) : Color.clear)
        .opacity(isCompleting ? 0.75 : 1.0)
        .animation(.easeInOut(duration: 0.25), value: isCompleting)
    }
    
    private func handleToggle() {
        if task.isCompleted {
            onToggle()
            return
        }
        guard !isCompleting else { return }
        
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        
        withAnimation(.spring(response: 0.25, dampingFraction: 0.5)) {
            isCompleting = true
            checkmarkScale = 1.35
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            withAnimation(.spring(response: 0.2, dampingFraction: 0.7)) {
                checkmarkScale = 1.0
            }
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.55) {
            withAnimation(.easeInOut(duration: 0.3)) {
                onToggle()
            }
        }
    }
    
    private var durationBadgeColor: Color {
        if task.estimatedMinutes <= 10 {
            return .green
        } else if task.estimatedMinutes <= 25 {
            return .blue
        } else {
            return .purple
        }
    }
    
    private var listBadgeColor: Color {
        switch task.listName.lowercased() {
        case let name where name.contains("turn90") || name.contains("first shift"):
            return .red
        case let name where name.contains("843") || name.contains("football"):
            return .green
        case let name where name.contains("nosa"):
            return .orange
        case let name where name.contains("book") || name.contains("synapse"):
            return .blue
        case let name where name.contains("general"):
            return .indigo
        default:
            return .purple
        }
    }
    
    private func sourceIcon(for source: String) -> String {
        switch source.lowercased() {
        case "slack": return "bubble.left.and.bubble.right"
        case "gmail": return "envelope"
        case "imessage": return "message"
        default: return "tray"
        }
    }
}
