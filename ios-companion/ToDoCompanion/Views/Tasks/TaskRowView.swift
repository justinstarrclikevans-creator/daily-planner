import SwiftUI

struct TaskRowView: View {
    var task: TaskItem
    var onToggle: () -> Void
    
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button(action: onToggle) {
                Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundColor(task.isCompleted ? .green : .secondary)
            }
            .buttonStyle(.plain)
            
            VStack(alignment: .leading, spacing: 4) {
                Text(task.title)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .strikethrough(task.isCompleted)
                    .foregroundColor(task.isCompleted ? .secondary : .primary)
                
                if let desc = task.description, !desc.isEmpty {
                    Text(desc)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }
                
                HStack(spacing: 8) {
                    Text(task.listName)
                        .font(.caption2)
                        .fontWeight(.semibold)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(listBadgeColor.opacity(0.15))
                        .foregroundColor(listBadgeColor)
                        .cornerRadius(6)
                    
                    if let source = task.source as String?, source != "ios" {
                        Label(source.capitalized, systemImage: sourceIcon(for: source))
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }
                .padding(.top, 2)
            }
            
            Spacer()
        }
        .padding(.vertical, 6)
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
