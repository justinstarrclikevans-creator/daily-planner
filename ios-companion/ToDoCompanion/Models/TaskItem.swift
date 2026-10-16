import Foundation

struct TaskItem: Identifiable, Codable, Hashable {
    var id: UUID
    var projectId: UUID?
    var title: String
    var description: String?
    var listName: String
    var status: String
    var dueDate: Date?
    var source: String
    var appleReminderId: String?
    var createdAt: Date?
    
    var isCompleted: Bool {
        get { status == "completed" }
        set { status = newValue ? "completed" : "pending" }
    }
    
    enum CodingKeys: String, CodingKey {
        case id
        case projectId = "project_id"
        case title
        case description
        case listName = "list_name"
        case status
        case dueDate = "due_date"
        case source
        case appleReminderId = "apple_reminder_id"
        case createdAt = "created_at"
    }
}
