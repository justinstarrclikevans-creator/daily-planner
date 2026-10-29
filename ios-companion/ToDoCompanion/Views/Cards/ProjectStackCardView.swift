import SwiftUI

struct ProjectStackCardView: View {
    let project: Project
    let tasks: [TaskItem]
    let onTap: () -> Void
    
    private var activeTasks: [TaskItem] {
        tasks.filter { !$0.isCompleted }
    }
    
    private var totalMinutes: Int {
        activeTasks.reduce(0) { $0 + $1.estimatedMinutes }
    }
    
    private var topTask: TaskItem? {
        activeTasks.first
    }
    
    var body: some View {
        Button(action: onTap) {
            ZStack {
                // Layer 3 (Bottom Card of Stack, if 3+ cards)
                if activeTasks.count >= 3 {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(Color(UIColor.secondarySystemGroupedBackground).opacity(0.5))
                        .offset(x: 4, y: 8)
                        .rotationEffect(.degrees(2.0))
                        .shadow(color: Color.black.opacity(0.04), radius: 4, y: 3)
                }
                
                // Layer 2 (Middle Card of Stack, if 2+ cards)
                if activeTasks.count >= 2 {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(Color(UIColor.secondarySystemGroupedBackground).opacity(0.8))
                        .offset(x: -3, y: 4)
                        .rotationEffect(.degrees(-1.5))
                        .shadow(color: Color.black.opacity(0.05), radius: 6, y: 3)
                }
                
                // Layer 1: Front Physical Index Card
                VStack(alignment: .leading, spacing: 0) {
                    // Top Color Accent Bar
                    Rectangle()
                        .fill(project.swiftUIColor)
                        .frame(height: 5)
                    
                    VStack(alignment: .leading, spacing: 12) {
                        // Header: Icon + Name + Card Count
                        HStack(alignment: .center, spacing: 10) {
                            ZStack {
                                Circle()
                                    .fill(project.swiftUIColor.opacity(0.15))
                                    .frame(width: 38, height: 38)
                                
                                Image(systemName: project.icon)
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundColor(project.swiftUIColor)
                            }
                            
                            VStack(alignment: .leading, spacing: 2) {
                                Text(project.name)
                                    .font(.headline)
                                    .fontWeight(.bold)
                                    .foregroundColor(.primary)
                                    .lineLimit(1)
                                
                                Text(project.scheduleSummaryText)
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                            
                            Spacer()
                            
                            // Card Count Badge
                            VStack(alignment: .trailing, spacing: 2) {
                                Text("\(activeTasks.count)")
                                    .font(.system(size: 20, weight: .black, design: .rounded))
                                    .foregroundColor(activeTasks.isEmpty ? .secondary : project.swiftUIColor)
                                Text(activeTasks.count == 1 ? "CARD" : "CARDS")
                                    .font(.system(size: 9, weight: .black))
                                    .tracking(0.5)
                                    .foregroundColor(.secondary)
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(Color(.tertiarySystemFill))
                            .cornerRadius(8)
                        }
                        
                        Divider()
                            .padding(.vertical, 2)
                        
                        // Top Card Preview
                        if let firstTask = topTask {
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text("TOP CARD")
                                        .font(.system(size: 9, weight: .heavy))
                                        .foregroundColor(project.swiftUIColor)
                                        .tracking(0.5)
                                    
                                    Spacer()
                                    
                                    HStack(spacing: 3) {
                                        Image(systemName: "timer")
                                            .font(.system(size: 10))
                                        Text("\(firstTask.estimatedMinutes)m")
                                            .font(.caption2)
                                            .fontWeight(.bold)
                                    }
                                    .foregroundColor(.secondary)
                                }
                                
                                Text(firstTask.title)
                                    .font(.subheadline)
                                    .fontWeight(.semibold)
                                    .foregroundColor(.primary)
                                    .lineLimit(2)
                                    .multilineTextAlignment(.leading)
                                
                                if !firstTask.subtasks.isEmpty {
                                    let done = firstTask.subtasks.filter { $0.isCompleted }.count
                                    HStack(spacing: 4) {
                                        Image(systemName: "checklist")
                                            .font(.caption2)
                                        Text("\(done)/\(firstTask.subtasks.count) subtasks")
                                            .font(.caption2)
                                    }
                                    .foregroundColor(.secondary)
                                }
                            }
                        } else {
                            HStack {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.green)
                                Text("Stack clear • Zero pending tasks")
                                    .font(.subheadline)
                                    .foregroundColor(.secondary)
                                Spacer()
                            }
                            .padding(.vertical, 8)
                        }
                        
                        // Footer: Total Time Pill + Tap to Open Prompt
                        HStack {
                            if activeTasks.count > 0 {
                                HStack(spacing: 4) {
                                    Image(systemName: "clock")
                                        .font(.system(size: 10))
                                    Text("\(totalMinutes)m total")
                                        .font(.caption2)
                                        .fontWeight(.semibold)
                                }
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(project.swiftUIColor.opacity(0.12))
                                .foregroundColor(project.swiftUIColor)
                                .cornerRadius(6)
                            }
                            
                            Spacer()
                            
                            HStack(spacing: 4) {
                                Text("Open Deck")
                                    .font(.caption)
                                    .fontWeight(.bold)
                                Image(systemName: "chevron.right")
                                    .font(.caption2)
                            }
                            .foregroundColor(project.swiftUIColor)
                        }
                        .padding(.top, 4)
                    }
                    .padding(16)
                }
                .background(Color(UIColor.secondarySystemGroupedBackground))
                .cornerRadius(16)
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color(.separator).opacity(0.4), lineWidth: 1)
                )
                .shadow(color: Color.black.opacity(0.06), radius: 8, x: 0, y: 4)
            }
        }
        .buttonStyle(.plain)
    }
}
