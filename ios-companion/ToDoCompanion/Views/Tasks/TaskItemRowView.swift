import SwiftUI

struct TaskItemRowView: View {
    let task: TaskItem
    @ObservedObject private var supabase = SupabaseService.shared
    
    var onConvertToProject: () -> Void
    var onStartSprint: () -> Void
    
    @State private var isExpanded: Bool = false
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 12) {
                // Checkbox
                Button {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                        Task {
                            await supabase.toggleTaskCompletion(task: task)
                        }
                    }
                } label: {
                    Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                        .font(.title3)
                        .foregroundColor(task.isCompleted ? .green : .secondary)
                }
                .buttonStyle(.plain)
                
                // Title & Subtitle
                VStack(alignment: .leading, spacing: 3) {
                    Text(task.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundColor(task.isCompleted ? .secondary : .primary)
                        .strikethrough(task.isCompleted)
                        .lineLimit(2)
                    
                    HStack(spacing: 6) {
                        Text(task.listName)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                        
                        if let firstFive = task.firstFiveMinutesPrompt, !firstFive.isEmpty {
                            Text("• ⚡ \(firstFive)")
                                .font(.caption2)
                                .foregroundColor(.indigo)
                                .lineLimit(1)
                        }
                    }
                }
                
                Spacer()
                
                // Priority Menu Pill
                Menu {
                    Button {
                        Task { await supabase.updateTaskPriority(task: task, priority: "high") }
                    } label: {
                        Label("High Priority", systemImage: "flame.fill")
                    }
                    Button {
                        Task { await supabase.updateTaskPriority(task: task, priority: "medium") }
                    } label: {
                        Label("Medium Priority", systemImage: "bolt.fill")
                    }
                    Button {
                        Task { await supabase.updateTaskPriority(task: task, priority: "low") }
                    } label: {
                        Label("Low Priority", systemImage: "leaf.fill")
                    }
                } label: {
                    HStack(spacing: 2) {
                        if task.isHighPriority {
                            Image(systemName: "flame.fill").foregroundColor(.red)
                            Text("High").foregroundColor(.red)
                        } else if task.isLowPriority {
                            Image(systemName: "leaf.fill").foregroundColor(.green)
                            Text("Low").foregroundColor(.green)
                        } else {
                            Image(systemName: "bolt.fill").foregroundColor(.orange)
                            Text("Med").foregroundColor(.orange)
                        }
                    }
                    .font(.system(size: 10, weight: .bold))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(priorityBackgroundColor)
                    .cornerRadius(6)
                }
                .buttonStyle(.plain)
                
                // Duration Menu Pill
                Menu {
                    ForEach([5, 10, 15, 25, 30, 45, 60, 90], id: \.self) { mins in
                        Button("\(mins) minutes") {
                            Task {
                                var copy = task
                                copy.estimatedMinutes = mins
                                await supabase.updateTask(copy)
                            }
                        }
                    }
                } label: {
                    HStack(spacing: 2) {
                        Image(systemName: "clock")
                        Text("\(task.estimatedMinutes)m")
                    }
                    .font(.system(size: 10, weight: .bold).monospaced())
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(Color(UIColor.tertiarySystemGroupedBackground))
                    .cornerRadius(6)
                }
                .buttonStyle(.plain)
                
                // Subtasks expander
                if !task.subtasks.isEmpty {
                    Button {
                        withAnimation { isExpanded.toggle() }
                    } label: {
                        Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .frame(width: 20, height: 20)
                    }
                    .buttonStyle(.plain)
                }
            }
            
            // Subtasks inline list
            if isExpanded && !task.subtasks.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(task.subtasks) { subtask in
                        HStack(spacing: 8) {
                            Button {
                                toggleSubtask(subtask)
                            } label: {
                                Image(systemName: subtask.isCompleted ? "checkmark.square.fill" : "square")
                                    .font(.caption)
                                    .foregroundColor(subtask.isCompleted ? .indigo : .secondary)
                            }
                            .buttonStyle(.plain)
                            
                            Text(subtask.title)
                                .font(.caption)
                                .foregroundColor(subtask.isCompleted ? .secondary : .primary)
                                .strikethrough(subtask.isCompleted)
                        }
                        .padding(.leading, 32)
                    }
                }
                .padding(.top, 4)
            }
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 14)
        .background(Color(UIColor.secondarySystemGroupedBackground))
        .cornerRadius(14)
        .swipeActions(edge: .leading) {
            Button {
                Task { await supabase.toggleTaskCompletion(task: task) }
            } label: {
                Label("Done", systemImage: "checkmark")
            }
            .tint(.green)
        }
        .swipeActions(edge: .trailing) {
            Button {
                Task { await supabase.deferTaskToLater(task: task) }
            } label: {
                Label("Later", systemImage: "clock.arrow.circlepath")
            }
            .tint(.orange)
        }
        .contextMenu {
            Button {
                onConvertToProject()
            } label: {
                Label("Turn into Project", systemImage: "folder.badge.plus")
            }
            
            Button {
                onStartSprint()
            } label: {
                Label("5-Min Focus Sprint", systemImage: "play.fill")
            }
            
            Button {
                Task { await supabase.deferTaskToLater(task: task) }
            } label: {
                Label("Defer to Tomorrow", systemImage: "clock")
            }
        }
    }
    
    private var priorityBackgroundColor: Color {
        if task.isHighPriority {
            return Color.red.opacity(0.12)
        } else if task.isLowPriority {
            return Color.green.opacity(0.12)
        }
        return Color.orange.opacity(0.12)
    }
    
    private func toggleSubtask(_ subtask: SubtaskItem) {
        var updated = task
        if let idx = updated.subtasks.firstIndex(where: { $0.id == subtask.id }) {
            updated.subtasks[idx].isCompleted.toggle()
            Task {
                await supabase.updateTask(updated)
            }
        }
    }
}
