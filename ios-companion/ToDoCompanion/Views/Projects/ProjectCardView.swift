import SwiftUI

struct ProjectCardView: View {
    var project: Project
    var tasks: [TaskItem]
    var ideas: [Idea]
    
    var openTasksCount: Int {
        tasks.filter {
            !$0.isCompleted && ($0.projectId == project.id || $0.listName.caseInsensitiveCompare(project.name) == .orderedSame)
        }.count
    }
    
    var latestIdea: Idea? {
        ideas.first { $0.projectId == project.id }
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(project.swiftUIColor.opacity(0.18))
                        .frame(width: 44, height: 44)
                    
                    Image(systemName: project.icon)
                        .font(.title3)
                        .foregroundColor(project.swiftUIColor)
                }
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(project.name)
                        .font(.headline)
                        .fontWeight(.bold)
                        .foregroundColor(.primary)
                    
                    HStack(spacing: 6) {
                        Text("\(openTasksCount) open tasks")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        
                        if project.effectiveScheduleRule != .always {
                            HStack(spacing: 3) {
                                Image(systemName: project.effectiveScheduleRule.icon)
                                    .font(.system(size: 9))
                                Text(project.scheduleSummaryText)
                                    .font(.system(size: 10, weight: .semibold))
                            }
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(project.swiftUIColor.opacity(0.12))
                            .foregroundColor(project.swiftUIColor)
                            .cornerRadius(6)
                        }
                    }
                }
                
                Spacer()
                
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(.secondary.opacity(0.6))
            }
            
            if !project.goal.isEmpty {
                Text(project.goal)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .lineLimit(2)
            }
            
            if let idea = latestIdea {
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "lightbulb.fill")
                        .font(.caption2)
                        .foregroundColor(.amber)
                    
                    Text(idea.summary)
                        .font(.caption)
                        .foregroundColor(.primary.opacity(0.85))
                        .lineLimit(2)
                }
                .padding(8)
                .background(Color(.secondarySystemBackground))
                .cornerRadius(8)
            }
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 20)
                .fill(Color(.systemBackground))
                .shadow(color: Color.black.opacity(0.04), radius: 8, x: 0, y: 3)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(project.swiftUIColor.opacity(0.2), lineWidth: 1)
        )
    }
}

extension Color {
    static let amber = Color(red: 245/255, green: 158/255, blue: 11/255)
}
