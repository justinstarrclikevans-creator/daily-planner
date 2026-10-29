import Foundation
import SwiftUI

enum ProjectScheduleRule: String, Codable, CaseIterable, Identifiable {
    case always = "Always Visible"
    case customDays = "Specific Days"
    case customHours = "Custom Days & Hours"
    case workHours = "Work Hours (Mon–Fri 8am–5pm)"
    case offHours = "Off Hours (Evenings & Weekends)"
    case weekendsOnly = "Weekends Only"
    case weekdaysOnly = "Weekdays Only"
    
    var id: String { rawValue }
    
    var icon: String {
        switch self {
        case .always: return "clock"
        case .customDays: return "calendar.badge.clock"
        case .customHours: return "clock.badge.checkmark.fill"
        case .workHours: return "briefcase.fill"
        case .offHours: return "moon.stars.fill"
        case .weekendsOnly: return "sun.max.fill"
        case .weekdaysOnly: return "building.2.fill"
        }
    }
    
    static func evaluateVisibility(
        rule: ProjectScheduleRule,
        startMinutes: Int = 480,
        endMinutes: Int = 1020,
        activeDays: Set<Int> = [1, 2, 3, 4, 5, 6, 7],
        at now: Date = Date()
    ) -> Bool {
        let calendar = Calendar.current
        let weekday = calendar.component(.weekday, from: now) // 1 = Sunday, 7 = Saturday
        let isWeekend = (weekday == 1 || weekday == 7)
        let hour = calendar.component(.hour, from: now)
        let minute = calendar.component(.minute, from: now)
        let currentMinutes = hour * 60 + minute
        let isWorkHours = !isWeekend && (hour >= 8 && hour < 17)
        
        switch rule {
        case .always:
            return true
        case .customDays:
            return activeDays.contains(weekday)
        case .customHours:
            guard activeDays.contains(weekday) else { return false }
            if startMinutes == endMinutes {
                return true
            } else if startMinutes < endMinutes {
                return currentMinutes >= startMinutes && currentMinutes < endMinutes
            } else {
                // Overnight window (e.g., 8:00 PM to 2:00 AM)
                return currentMinutes >= startMinutes || currentMinutes < endMinutes
            }
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
    
    var isVisibleNow: Bool {
        Self.evaluateVisibility(rule: self)
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
    var customStartMinutes: Int?
    var customEndMinutes: Int?
    var customActiveDays: [Int]?
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
        case customStartMinutes = "custom_start_minutes"
        case customEndMinutes = "custom_end_minutes"
        case customActiveDays = "custom_active_days"
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
        customStartMinutes: Int? = 480,
        customEndMinutes: Int? = 1020,
        customActiveDays: [Int]? = [1, 2, 3, 4, 5, 6, 7],
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
        self.customStartMinutes = customStartMinutes
        self.customEndMinutes = customEndMinutes
        self.customActiveDays = customActiveDays
        self.createdAt = createdAt
    }
    
    var swiftUIColor: Color {
        Color(hex: color)
    }
    
    var safeAccentColor: Color {
        let hexClean = color.trimmingCharacters(in: CharacterSet.alphanumerics.inverted).lowercased()
        if hexClean == "ffffff" || hexClean == "fff" || hexClean.isEmpty {
            return Color.indigo
        }
        var int: UInt64 = 0
        if Scanner(string: hexClean).scanHexInt64(&int), hexClean.count == 6 {
            let r = Double((int >> 16) & 0xFF) / 255.0
            let g = Double((int >> 8) & 0xFF) / 255.0
            let b = Double(int & 0xFF) / 255.0
            let luminance = 0.299 * r + 0.587 * g + 0.114 * b
            if luminance > 0.85 {
                return Color.indigo
            }
        }
        return swiftUIColor
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
    
    var effectiveCustomStartMinutes: Int {
        if UserDefaults.standard.object(forKey: "project_custom_start_\(id.uuidString)") != nil {
            return UserDefaults.standard.integer(forKey: "project_custom_start_\(id.uuidString)")
        }
        return customStartMinutes ?? 480 // Default 8:00 AM
    }
    
    var effectiveCustomEndMinutes: Int {
        if UserDefaults.standard.object(forKey: "project_custom_end_\(id.uuidString)") != nil {
            return UserDefaults.standard.integer(forKey: "project_custom_end_\(id.uuidString)")
        }
        return customEndMinutes ?? 1020 // Default 5:00 PM
    }
    
    var effectiveCustomActiveDays: Set<Int> {
        if let saved = UserDefaults.standard.array(forKey: "project_custom_days_\(id.uuidString)") as? [Int], !saved.isEmpty {
            return Set(saved)
        }
        if let days = customActiveDays, !days.isEmpty {
            return Set(days)
        }
        return [1, 2, 3, 4, 5, 6, 7]
    }
    
    var isVisibleNow: Bool {
        ProjectScheduleRule.evaluateVisibility(
            rule: effectiveScheduleRule,
            startMinutes: effectiveCustomStartMinutes,
            endMinutes: effectiveCustomEndMinutes,
            activeDays: effectiveCustomActiveDays
        )
    }
    
    var scheduleSummaryText: String {
        switch effectiveScheduleRule {
        case .always:
            return "Always Visible"
        case .customDays:
            let daysStr = Self.formatDays(effectiveCustomActiveDays)
            return "\(daysStr) (All Day)"
        case .customHours:
            let startStr = Self.formatMinutes(effectiveCustomStartMinutes)
            let endStr = Self.formatMinutes(effectiveCustomEndMinutes)
            let daysStr = Self.formatDays(effectiveCustomActiveDays)
            return "\(daysStr) \(startStr)–\(endStr)"
        case .workHours:
            return "Mon–Fri 8am–5pm"
        case .offHours:
            return "Evenings & Weekends"
        case .weekendsOnly:
            return "Weekends Only"
        case .weekdaysOnly:
            return "Weekdays Only"
        }
    }
    
    func setCustomActiveDays(_ days: Set<Int>) {
        UserDefaults.standard.set(Array(days), forKey: "project_custom_days_\(id.uuidString)")
    }
    
    static func formatMinutes(_ minutesFromMidnight: Int) -> String {
        let clamped = ((minutesFromMidnight % 1440) + 1440) % 1440
        let h24 = clamped / 60
        let m = clamped % 60
        let period = h24 >= 12 ? "PM" : "AM"
        let h12 = h24 % 12 == 0 ? 12 : h24 % 12
        if m == 0 {
            return "\(h12)\(period)"
        }
        return String(format: "%d:%02d%@", h12, m, period)
    }
    
    static func formatDays(_ days: Set<Int>) -> String {
        if days.count == 7 { return "Daily" }
        if days == [2, 3, 4, 5, 6] { return "Mon–Fri" }
        if days == [1, 7] { return "Weekends" }
        let names = [(1, "Sun"), (2, "Mon"), (3, "Tue"), (4, "Wed"), (5, "Thu"), (6, "Fri"), (7, "Sat")]
        return names.filter { days.contains($0.0) }.map { $0.1 }.joined(separator: ", ")
    }
    
    static func dateFromMinutes(_ minutesFromMidnight: Int) -> Date {
        let cal = Calendar.current
        let h = (minutesFromMidnight / 60) % 24
        let m = minutesFromMidnight % 60
        return cal.date(bySettingHour: h, minute: m, second: 0, of: Date()) ?? Date()
    }
    
    static func minutesFromDate(_ date: Date) -> Int {
        let cal = Calendar.current
        let h = cal.component(.hour, from: date)
        let m = cal.component(.minute, from: date)
        return h * 60 + m
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
