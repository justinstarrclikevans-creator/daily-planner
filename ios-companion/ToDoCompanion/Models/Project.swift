import Foundation
import SwiftUI

enum ProjectScheduleRule: String, Codable, CaseIterable, Identifiable {
    case always = "Always Visible"
    case workHours = "Work Hours (Mon–Fri 8am–5pm)"
    case offHours = "Off Hours (Evenings & Weekends)"
    case weekendsOnly = "Weekends Only"
    case weekdaysOnly = "Weekdays Only"
    
    var id: String { rawValue }
    
    var icon: String {
        switch self {
        case .always: return "clock"
        case .workHours: return "briefcase.fill"
        case .offHours: return "moon.stars.fill"
        case .weekendsOnly: return "sun.max.fill"
        case .weekdaysOnly: return "building.2.fill"
        }
    }
    
    var isVisibleNow: Bool {
        let calendar = Calendar.current
        let now = Date()
        let weekday = calendar.component(.weekday, from: now) // 1 = Sunday, 7 = Saturday
        let isWeekend = (weekday == 1 || weekday == 7)
        let hour = calendar.component(.hour, from: now)
        let isWorkHours = !isWeekend && (hour >= 8 && hour < 17)
        
        switch self {
        case .always:
            return true
        case .workHours:
            return isWorkHours
        case .offHours:
            return !isWorkHours
        case .weekendsOnly:
            return isWeekend
        case .weekdaysOnly:
            return !isWeekend
        }
    }
}

struct Project: Identifiable, Codable, Hashable {
    var id: UUID
    var name: String
    var slug: String
    var color: String
    var icon: String
    var goal: String
    var instructions: String?
    var scheduleRule: ProjectScheduleRule?
    var createdAt: Date?
    
    enum CodingKeys: String, CodingKey {
        case id
        case name
        case slug
        case color
        case icon
        case goal
        case instructions
        case scheduleRule = "schedule_rule"
        case createdAt = "created_at"
    }
    
    init(
        id: UUID = UUID(),
        name: String,
        slug: String,
        color: String,
        icon: String,
        goal: String,
        instructions: String? = nil,
        scheduleRule: ProjectScheduleRule? = .always,
        createdAt: Date? = Date()
    ) {
        self.id = id
        self.name = name
        self.slug = slug
        self.color = color
        self.icon = icon
        self.goal = goal
        self.instructions = instructions
        self.scheduleRule = scheduleRule
        self.createdAt = createdAt
    }
    
    var swiftUIColor: Color {
        Color(hex: color)
    }
    
    var effectiveInstructions: String {
        if let saved = UserDefaults.standard.string(forKey: "project_instructions_\(id.uuidString)"), !saved.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return saved
        }
        return instructions ?? ""
    }
    
    var effectiveScheduleRule: ProjectScheduleRule {
        if let saved = UserDefaults.standard.string(forKey: "project_schedule_\(id.uuidString)"),
           let rule = ProjectScheduleRule(rawValue: saved) {
            return rule
        }
        return scheduleRule ?? .always
    }
    
    var isVisibleNow: Bool {
        effectiveScheduleRule.isVisibleNow
    }
    
    static let defaults: [Project] = [
        Project(id: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!,
                name: "General",
                slug: "general",
                color: "#6366F1",
                icon: "tray.full.fill",
                goal: "General tasks, workflows, and uncategorized action items.",
                scheduleRule: .always),
        Project(id: UUID(uuidString: "22222222-2222-2222-2222-222222222222")!,
                name: "Turn90",
                slug: "turn90",
                color: "#EF4444",
                icon: "briefcase.fill",
                goal: "Turn90 re-entry operations, Apricot reports, evaluations, and participant support.",
                scheduleRule: .always),
        Project(id: UUID(uuidString: "33333333-3333-3333-3333-333333333333")!,
                name: "843FC",
                slug: "843fc",
                color: "#10B981",
                icon: "sportscourt.fill",
                goal: "843FC coaching, tournament planning, trainings, and player recruiting.",
                scheduleRule: .always),
        Project(id: UUID(uuidString: "44444444-4444-4444-4444-444444444444")!,
                name: "Personal",
                slug: "personal",
                color: "#8B5CF6",
                icon: "person.fill",
                goal: "Personal life, health, appointments, and family errands.",
                scheduleRule: .always),
        Project(id: UUID(uuidString: "55555555-5555-5555-5555-555555555555")!,
                name: "Nosa",
                slug: "nosa",
                color: "#F59E0B",
                icon: "sparkles",
                goal: "Nosa product roadmap, website updates, and customer validation.",
                scheduleRule: .always),
        Project(id: UUID(uuidString: "66666666-6666-6666-6666-666666666666")!,
                name: "Book (Memoir) and Synapse",
                slug: "book-memoir-and-synapse",
                color: "#3B82F6",
                icon: "book.closed.fill",
                goal: "Memoir writing, outlines, and Synapse creative/research work.",
                scheduleRule: .always)
    ]
}

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3: // RGB (12-bit)
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB (32-bit)
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 99, 102, 241) // Default indigo
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}
