import Foundation
import SwiftUI

struct RoutineItemStep: Identifiable, Codable, Hashable {
    var id: UUID = UUID()
    var title: String
    var estimatedMinutes: Int = 10
    var firstFiveMinutes: String?
    var isCompleted: Bool = false
    
    enum CodingKeys: String, CodingKey {
        case id, title
        case estimatedMinutes = "estimated_minutes"
        case firstFiveMinutes = "first_five_minutes"
        case isCompleted = "is_completed"
    }
    
    init(id: UUID = UUID(), title: String, estimatedMinutes: Int = 10, firstFiveMinutes: String? = nil, isCompleted: Bool = false) {
        self.id = id
        self.title = title
        self.estimatedMinutes = estimatedMinutes
        self.firstFiveMinutes = firstFiveMinutes
        self.isCompleted = isCompleted
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        self.title = try container.decode(String.self, forKey: .title)
        self.estimatedMinutes = try container.decodeIfPresent(Int.self, forKey: .estimatedMinutes) ?? 10
        self.firstFiveMinutes = try container.decodeIfPresent(String.self, forKey: .firstFiveMinutes)
        self.isCompleted = try container.decodeIfPresent(Bool.self, forKey: .isCompleted) ?? false
    }
}

struct Routine: Identifiable, Codable, Hashable {
    var id: UUID
    var projectId: UUID?
    var defaultListName: String
    var title: String
    var description: String
    var color: String
    var icon: String
    var items: [RoutineItemStep]
    var isCompleted: Bool = false
    var createdAt: Date?
    
    enum CodingKeys: String, CodingKey {
        case id, title, description, color, icon, items
        case projectId = "project_id"
        case defaultListName = "default_list_name"
        case isCompleted = "is_completed"
        case createdAt = "created_at"
    }
    
    init(
        id: UUID = UUID(),
        projectId: UUID? = nil,
        defaultListName: String = "General",
        title: String,
        description: String = "",
        color: String = "#6366F1",
        icon: String = "arrow.triangle.2.circlepath.circle.fill",
        items: [RoutineItemStep] = [],
        isCompleted: Bool = false,
        createdAt: Date? = Date()
    ) {
        self.id = id
        self.projectId = projectId
        self.defaultListName = defaultListName
        self.title = title
        self.description = description
        self.color = color
        self.icon = icon
        self.items = items
        self.isCompleted = isCompleted
        self.createdAt = createdAt
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        self.projectId = try container.decodeIfPresent(UUID.self, forKey: .projectId)
        self.defaultListName = try container.decodeIfPresent(String.self, forKey: .defaultListName) ?? "General"
        self.title = try container.decode(String.self, forKey: .title)
        self.description = try container.decodeIfPresent(String.self, forKey: .description) ?? ""
        self.color = try container.decodeIfPresent(String.self, forKey: .color) ?? "#6366F1"
        self.icon = try container.decodeIfPresent(String.self, forKey: .icon) ?? "arrow.triangle.2.circlepath.circle.fill"
        self.items = try container.decodeIfPresent([RoutineItemStep].self, forKey: .items) ?? []
        self.isCompleted = try container.decodeIfPresent(Bool.self, forKey: .isCompleted) ?? false
        self.createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt)
    }
    
    var completedStepsCount: Int {
        items.filter { $0.isCompleted }.count
    }
    
    var progressFraction: Double {
        guard !items.isEmpty else { return isCompleted ? 1.0 : 0.0 }
        return Double(completedStepsCount) / Double(items.count)
    }
    
    var swiftUIColor: Color {
        Color(hex: color)
    }
    
    var totalEstimatedMinutes: Int {
        max(5, items.reduce(0) { $0 + $1.estimatedMinutes })
    }
    
    static let defaults: [Routine] = [
        Routine(
            id: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!,
            projectId: nil,
            defaultListName: "General",
            title: "End of the day workflow",
            description: "Close out open loops, update notes, and prep tomorrow's priorities before shutting down.",
            color: "#6366F1",
            icon: "moon.stars.fill",
            items: [
                RoutineItemStep(title: "Review completed tasks and open loops across projects", estimatedMinutes: 5),
                RoutineItemStep(title: "Update Apricot & Turn90 notes before signing off", estimatedMinutes: 5),
                RoutineItemStep(title: "Move unfinished today tasks or schedule for tomorrow", estimatedMinutes: 5),
                RoutineItemStep(title: "Check tomorrow's calendar and prep top 3 priorities", estimatedMinutes: 5),
                RoutineItemStep(title: "Clear browser tabs and reset workspace", estimatedMinutes: 5)
            ]
        ),
        Routine(
            id: UUID(uuidString: "22222222-2222-2222-2222-222222222222")!,
            projectId: nil,
            defaultListName: "Turn90",
            title: "Start the day",
            description: "Daily morning Turn90 reporting, evaluations, and team feedback workflow.",
            color: "#EF4444",
            icon: "sun.max.fill",
            items: [
                RoutineItemStep(title: "Open Apricot", estimatedMinutes: 5),
                RoutineItemStep(title: "Run Main Report and export", estimatedMinutes: 5),
                RoutineItemStep(title: "Open T90 app", estimatedMinutes: 5),
                RoutineItemStep(title: "Feed report into app", estimatedMinutes: 5),
                RoutineItemStep(title: "Check CM and Class evaluations", estimatedMinutes: 5),
                RoutineItemStep(title: "Message teammates any needed feedback", estimatedMinutes: 5)
            ]
        )
    ]
}
