import SwiftUI

struct TactileIndexCardView: View {
    let task: TaskItem
    let projectColor: Color
    var cardIndex: Int = 0
    var totalCards: Int = 1
    var dragOffset: CGSize = .zero
    var onToggleSubtask: ((UUID) -> Void)? = nil
    var onStartSprint: (() -> Void)? = nil
    
    // Drag threshold constants
    private let actionThreshold: CGFloat = 80
    
    var body: some View {
        ZStack {
            // Physical Index Card Canvas
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(UIColor.secondarySystemGroupedBackground))
                .overlay(
                    // Subtle Lined Paper Effect
                    VStack(spacing: 24) {
                        ForEach(0..<14, id: \.self) { _ in
                            Divider()
                                .background(Color.blue.opacity(0.08))
                        }
                    }
                    .padding(.top, 40)
                    .allowsHitTesting(false)
                )
                .overlay(
                    // Red margin vertical line on the left
                    HStack {
                        Rectangle()
                            .fill(Color.red.opacity(0.18))
                            .frame(width: 1.5)
                            .padding(.leading, 32)
                        Spacer()
                    }
                    .allowsHitTesting(false)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color(.separator).opacity(0.4), lineWidth: 1)
                )
                .shadow(color: Color.black.opacity(0.08), radius: 10, x: 0, y: 5)
            
            // Card Content
            VStack(alignment: .leading, spacing: 14) {
                // Top Header: Project Badge + Card Number + Duration
                HStack(alignment: .center) {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(projectColor)
                            .frame(width: 8, height: 8)
                        Text(task.listName.uppercased())
                            .font(.system(size: 11, weight: .black))
                            .tracking(0.8)
                            .foregroundColor(projectColor)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(projectColor.opacity(0.12))
                    .cornerRadius(6)
                    
                    Text("CARD \(cardIndex + 1) OF \(totalCards)")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.secondary)
                        .padding(.leading, 4)
                    
                    Spacer()
                    
                    HStack(spacing: 4) {
                        Image(systemName: "timer")
                            .font(.system(size: 11))
                        Text("\(task.estimatedMinutes)m")
                            .font(.system(size: 12, weight: .bold))
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color(.tertiarySystemFill))
                    .foregroundColor(.primary)
                    .cornerRadius(6)
                }
                
                // Task Headline
                Text(task.title)
                    .font(.title3)
                    .fontWeight(.bold)
                    .foregroundColor(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
                
                // First 5-minute prompt (if available)
                if let prompt = task.firstFiveMinutesPrompt, !prompt.isEmpty {
                    HStack(alignment: .top, spacing: 6) {
                        Image(systemName: "bolt.fill")
                            .font(.caption2)
                            .foregroundColor(.orange)
                            .padding(.top, 2)
                        Text("Start: \(prompt)")
                            .font(.caption)
                            .fontWeight(.medium)
                            .foregroundColor(.secondary)
                    }
                    .padding(8)
                    .background(Color.orange.opacity(0.08))
                    .cornerRadius(8)
                }
                
                // Clean Description / Notes (if any)
                let cleanNotes = task.cleanDescription
                if !cleanNotes.isEmpty {
                    Text(cleanNotes)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(3)
                        .padding(.vertical, 2)
                }
                
                // Subtasks Checklist directly on the card
                if !task.subtasks.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            let completedCount = task.subtasks.filter { $0.isCompleted }.count
                            Text("SUBTASKS (\(completedCount)/\(task.subtasks.count))")
                                .font(.system(size: 10, weight: .black))
                                .tracking(0.6)
                                .foregroundColor(.secondary)
                            Spacer()
                            
                            // Mini progress bar
                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    Capsule()
                                        .fill(Color(.tertiarySystemFill))
                                        .frame(height: 4)
                                    Capsule()
                                        .fill(projectColor)
                                        .frame(width: geo.size.width * CGFloat(completedCount) / CGFloat(max(1, task.subtasks.count)), height: 4)
                                }
                            }
                            .frame(width: 60, height: 4)
                        }
                        .padding(.top, 4)
                        
                        // Scrollable list of subtasks if many, or standard stack
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(task.subtasks) { subtask in
                                Button {
                                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                                    onToggleSubtask?(subtask.id)
                                } label: {
                                    HStack(alignment: .top, spacing: 8) {
                                        Image(systemName: subtask.isCompleted ? "checkmark.circle.fill" : "circle")
                                            .font(.system(size: 16, weight: .semibold))
                                            .foregroundColor(subtask.isCompleted ? .green : .secondary)
                                            .padding(.top, 1)
                                        
                                        Text(subtask.title)
                                            .font(.subheadline)
                                            .foregroundColor(subtask.isCompleted ? .secondary : .primary)
                                            .strikethrough(subtask.isCompleted, color: .secondary)
                                            .multilineTextAlignment(.leading)
                                        
                                        Spacer()
                                    }
                                    .padding(.vertical, 2)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                
                Spacer(minLength: 8)
                
                // Bottom Sprint Launcher
                HStack {
                    Spacer()
                    Button {
                        onStartSprint?()
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "play.circle.fill")
                                .font(.subheadline)
                            Text("Start 5m Sprint")
                                .font(.footnote)
                                .fontWeight(.bold)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(projectColor)
                        .foregroundColor(.white)
                        .cornerRadius(8)
                    }
                }
            }
            .padding(20)
            
            // Dynamic Drag Overlay Feedback Hints
            dragActionOverlay
        }
        .frame(minHeight: 340)
    }
    
    // MARK: - Drag Action Cue Overlay
    @ViewBuilder
    private var dragActionOverlay: some View {
        if dragOffset.height < -40 {
            // Swiping Up: Complete
            VStack {
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.title2)
                    Text("COMPLETE")
                        .font(.headline)
                        .fontWeight(.black)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(Color.green)
                .foregroundColor(.white)
                .cornerRadius(12)
                .shadow(radius: 6)
                .padding(.top, 24)
                Spacer()
            }
            .opacity(min(1.0, Double(-dragOffset.height) / Double(actionThreshold)))
        } else if dragOffset.width < -40 {
            // Swiping Left: Defer to Tomorrow
            HStack {
                Spacer()
                VStack(spacing: 6) {
                    Image(systemName: "moon.fill")
                        .font(.title2)
                    Text("TOMORROW")
                        .font(.caption)
                        .fontWeight(.black)
                }
                .padding(12)
                .background(Color.blue)
                .foregroundColor(.white)
                .cornerRadius(12)
                .shadow(radius: 6)
                .padding(.trailing, 20)
            }
            .opacity(min(1.0, Double(-dragOffset.width) / Double(actionThreshold)))
        } else if dragOffset.width > 40 {
            // Swiping Right: Focus Sprint
            HStack {
                VStack(spacing: 6) {
                    Image(systemName: "play.fill")
                        .font(.title2)
                    Text("SPRINT")
                        .font(.caption)
                        .fontWeight(.black)
                }
                .padding(12)
                .background(Color.purple)
                .foregroundColor(.white)
                .cornerRadius(12)
                .shadow(radius: 6)
                .padding(.leading, 20)
                Spacer()
            }
            .opacity(min(1.0, Double(dragOffset.width) / Double(actionThreshold)))
        }
    }
}
