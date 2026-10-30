import SwiftUI

struct TaskItemRowView: View {
    let task: TaskItem
    @ObservedObject private var supabase = SupabaseService.shared
    
    var onConvertToProject: () -> Void
    var onStartSprint: () -> Void
    
    @State private var isExpanded: Bool = false
    @State private var isCompleting: Bool = false
    @State private var checkmarkScale: CGFloat = 1.0
    
    private var isVisuallyDone: Bool {
        task.isCompleted || isCompleting
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 12) {
                // Checkbox with satisfying animated completion
                Button {
                    handleTapCheckbox()
                } label: {
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
                .buttonStyle(.plain)
                
                // Title & Subtitle
                VStack(alignment: .leading, spacing: 3) {
                    Text(task.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundColor(isVisuallyDone ? .secondary : .primary)
                        .strikethrough(isVisuallyDone)
                        .lineLimit(2)
                        .animation(.easeInOut(duration: 0.2), value: isVisuallyDone)
                    
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
        .background(
            isCompleting
                ? Color.green.opacity(0.12)
                : Color(UIColor.secondarySystemGroupedBackground)
        )
        .opacity(isCompleting ? 0.75 : 1.0)
        .cornerRadius(14)
        .animation(.easeInOut(duration: 0.25), value: isCompleting)
        .swipeActions(edge: .leading) {
            Button {
                handleTapCheckbox()
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
    
    private func handleTapCheckbox() {
        if task.isCompleted {
            Task {
                await supabase.toggleTaskCompletion(task: task)
            }
        } else {
            handleComplete()
        }
    }
    
    private func handleComplete() {
        guard !isCompleting else { return }
        
        // 1. Haptic feedback
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        
        // 2. Animate checkmark with spring bounce
        withAnimation(.spring(response: 0.25, dampingFraction: 0.5)) {
            isCompleting = true
            checkmarkScale = 1.35
        }
        
        // 3. Spring scale back
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            withAnimation(.spring(response: 0.2, dampingFraction: 0.7)) {
                checkmarkScale = 1.0
            }
        }
        
        // 4. Slow down! Hold completed visual state for 550ms so user sees the checkmark
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.55) {
            withAnimation(.easeInOut(duration: 0.3)) {
                Task {
                    await supabase.toggleTaskCompletion(task: task)
                }
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
