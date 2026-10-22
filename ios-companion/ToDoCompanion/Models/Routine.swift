import Foundation
import SwiftUI

struct RoutineItemStep: Identifiable, Codable, Hashable {
    var id: UUID = UUID()
    var title: String
    var estimatedMinutes: Int = 10
    var firstFiveMinutes: String?
    
    enum CodingKeys: String, CodingKey {
        case id, title
        case estimatedMinutes = "estimated_minutes"
        case firstFiveMinutes = "first_five_minutes"
    }
    
    init(id: UUID = UUID(), title: String, estimatedMinutes: Int = 10, firstFiveMinutes: String? = nil) {
        self.id = id
        self.title = title
        self.estimatedMinutes = estimatedMinutes
        self.firstFiveMinutes = firstFiveMinutes
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        self.title = try container.decode(String.self, forKey: .title)
        self.estimatedMinutes = try container.decodeIfPresent(Int.self, forKey: .estimatedMinutes) ?? 10
        self.firstFiveMinutes = try container.decodeIfPresent(String.self, forKey: .firstFiveMinutes)
    }
}

struct Routine: Identifiable, Codable, Hashable {
    var id: UUID
    var projectId: UUID?
    var title: String
    var description: String
    var color: String
    var icon: String
    var items: [RoutineItemStep]
    var createdAt: Date?
    
    enum CodingKeys: String, CodingKey {
        case id, title, description, color, icon, items
        case projectId = "project_id"
        case createdAt = "created_at"
    }
    
    var swiftUIColor: Color {
        Color(hex: color)
    }
    
    var totalEstimatedMinutes: Int {
        items.reduce(0) { $0 + $1.estimatedMinutes }
    }
    
    static let defaults: [Routine] = [
        Routine(
            id: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!,
            projectId: nil,
            title: "First Shift: Morning Intake & Casework Kickoff",
            description: "Review participant notes, complete Apricot updates, and check volunteer coach pairings.",
            color: "#EF4444",
            icon: "briefcase.fill",
            items: [
                RoutineItemStep(title: "Review Antoine Turner intake notes & Google Meet log", estimatedMinutes: 10, firstFiveMinutes: "Open the intake doc and read line 1."),
                RoutineItemStep(title: "Fill out Apricot employment update form", estimatedMinutes: 15, firstFiveMinutes: "Log into Apricot portal and find participant profile."),
                RoutineItemStep(title: "Send PIC volunteer coaching check-in email", estimatedMinutes: 10, firstFiveMinutes: "Open Gmail draft and type opening 2 sentences.")
            ]
        ),
        Routine(
            id: UUID(uuidString: "22222222-2222-2222-2222-222222222222")!,
            projectId: nil,
            title: "Football / 843: Practice & Drill Prep",
            description: "Ensure field permits, equipment, and drills are locked in before practice.",
            color: "#10B981",
            icon: "sportscourt.fill",
            items: [
                RoutineItemStep(title: "Check field permit status & confirm practice slot", estimatedMinutes: 5, firstFiveMinutes: "Check Parks & Rec confirmation email."),
                RoutineItemStep(title: "Prep cones, footballs & coaching drill sheet", estimatedMinutes: 15, firstFiveMinutes: "Grab gear bag from trunk and inspect inventory."),
                RoutineItemStep(title: "Send parent/coach reminder text on group chat", estimatedMinutes: 5, firstFiveMinutes: "Draft text with start time and field number.")
            ]
        ),
        Routine(
            id: UUID(uuidString: "33333333-3333-3333-3333-333333333333")!,
            projectId: nil,
            title: "Executive Daily Shutdown & Stale Purge",
            description: "Clear mental cache, sweep completed items, and set tomorrow up for zero friction.",
            color: "#6366F1",
            icon: "moon.stars.fill",
            items: [
                RoutineItemStep(title: "Clear browser tabs & review scratch notes", estimatedMinutes: 5, firstFiveMinutes: "Close finished tabs and save keepers to project notes."),
                RoutineItemStep(title: "Review Play Queue and bump unstarted tasks to tomorrow", estimatedMinutes: 5, firstFiveMinutes: "Open ToDo Companion and tap Bump to Tomorrow."),
                RoutineItemStep(title: "Pin top 3 priority tasks for tomorrow morning", estimatedMinutes: 5, firstFiveMinutes: "Tap +Queue on tomorrow morning’s primary focus.")
            ]
        ),
        Routine(
            id: UUID(uuidString: "44444444-4444-4444-4444-444444444444")!,
            projectId: nil,
            title: "Momentum Kickstart (Beat Paralysis)",
            description: "Three micro-sprints designed to destroy task paralysis in under 25 minutes.",
            color: "#F59E0B",
            icon: "bolt.fill",
            items: [
                RoutineItemStep(title: "2-minute physical desk & environment reset", estimatedMinutes: 5, firstFiveMinutes: "Pick up 3 stray items and throw away trash."),
                RoutineItemStep(title: "5-minute triage of incoming Slack & Gmail", estimatedMinutes: 5, firstFiveMinutes: "Scan subject lines without opening reply rabbit holes."),
                RoutineItemStep(title: "15-minute deep focus sprint on #1 priority", estimatedMinutes: 15, firstFiveMinutes: "Start the timer and work on line 1 for 60 seconds.")
            ]
        )
    ]
}
