import SwiftUI

struct TaskRowView: View {
    var task: TaskItem
    var onToggle: () -> Void
    var onFocus: (() -> Void)? = nil
    
    @ObservedObject private var supabase = SupabaseService.shared
    
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // Checkbox
            Button(action: onToggle) {
                Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundColor(task.isCompleted ? .green : .secondary)
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
                        .strikethrough(task.isCompleted)
                        .foregroundColor(task.isCompleted ? .secondary : .primary)
                    
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
                
                // First 5 Minutes Starter Callout (if present)
                if let starter = task.firstFiveMinutesPrompt, !task.isCompleted {
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Image(systemName: "bolt.fill")
                            .font(.caption2)
                            .foregroundColor(.orange)
                        Text(starter)
                            .font(.caption2)
                            .fontWeight(.medium)
                            .foregroundColor(.orange)
                            .lineLimit(1)
                    }
                    .padding(.vertical, 1)
                }
                
                // Badges Row
                HStack(spacing: 6) {
                    // List Badge
                    Text(task.listName)
                        .font(.caption2)
                        .fontWeight(.semibold)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(listBadgeColor.opacity(0.15))
                        .foregroundColor(listBadgeColor)
                        .cornerRadius(6)
                    
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
                    
                    // Queue Pill / Toggle
                    Button {
                        Task {
                            await supabase.togglePlayQueue(for: task)
                        }
                    } label: {
                        HStack(spacing: 3) {
                            Image(systemName: task.inPlayQueue ? "play.circle.fill" : "plus")
                                .font(.system(size: 9))
                            Text(task.inPlayQueue ? "Queue" : "+Queue")
                                .font(.system(size: 10, weight: .semibold))
                        }
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(task.inPlayQueue ? Color.indigo.opacity(0.18) : Color.secondary.opacity(0.08))
                        .foregroundColor(task.inPlayQueue ? .indigo : .secondary)
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
        case let name where name.contains("first shift"):
            return .red
        case let name where name.contains("football") || name.contains("843"):
            return .green
        case let name where name.contains("albertine"):
            return .blue
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
