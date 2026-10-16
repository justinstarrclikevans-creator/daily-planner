import Foundation
import SwiftUI

struct Project: Identifiable, Codable, Hashable {
    var id: UUID
    var name: String
    var slug: String
    var color: String
    var icon: String
    var goal: String
    var createdAt: Date?
    
    enum CodingKeys: String, CodingKey {
        case id
        case name
        case slug
        case color
        case icon
        case goal
        case createdAt = "created_at"
    }
    
    var swiftUIColor: Color {
        Color(hex: color)
    }
    
    static let defaults: [Project] = [
        Project(id: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!,
                name: "First Shift",
                slug: "first-shift",
                color: "#EF4444",
                icon: "briefcase.fill",
                goal: "Deliver top tier re-entry employment and participant case management."),
        Project(id: UUID(uuidString: "22222222-2222-2222-2222-222222222222")!,
                name: "Albertine Initiative",
                slug: "albertine",
                color: "#3B82F6",
                icon: "video.fill",
                goal: "Community outreach and media initiatives in North Charleston."),
        Project(id: UUID(uuidString: "33333333-3333-3333-3333-333333333333")!,
                name: "Football / 843",
                slug: "football-843",
                color: "#10B981",
                icon: "sportscourt.fill",
                goal: "Rec training, coaching drills, and local youth football leagues."),
        Project(id: UUID(uuidString: "44444444-4444-4444-4444-444444444444")!,
                name: "Personal",
                slug: "personal",
                color: "#8B5CF6",
                icon: "person.fill",
                goal: "Personal life, health, appointments, and family errands.")
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
