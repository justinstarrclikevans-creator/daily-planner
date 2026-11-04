import Foundation

struct SpaceRule: Codable, Identifiable, Hashable {
    var id: String { tag }
    let tag: String
    let label: String
    let icon: String
    let description: String?
    let keywords: [String]
}

struct PersonRule: Codable, Identifiable, Hashable {
    var id: String { tag }
    let tag: String
    let label: String
    let keywords: [String]
}

struct ProjectRule: Codable, Identifiable, Hashable {
    var id: String { tag }
    let tag: String
    let label: String
    let keywords: [String]
}

struct TaggingRules: Codable {
    let defaultList: String
    let spaces: [SpaceRule]
    let people: [PersonRule]
    let projects: [ProjectRule]
}

class TaggingRulesService: ObservableObject {
    static let shared = TaggingRulesService()
    
    @Published var rules: TaggingRules
    
    private init() {
        if let url = Bundle.main.url(forResource: "tagging-rules", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let decoded = try? JSONDecoder().decode(TaggingRules.self, from: data) {
            self.rules = decoded
        } else {
            // Built-in defaults
            self.rules = TaggingRules(
                defaultList: "General",
                spaces: [
                    SpaceRule(tag: "apricot", label: "Apricot", icon: "doc.text.magnifyingglass", description: "Casework & Intake", keywords: ["apricot", "intake", "casework", "skillcat"]),
                    SpaceRule(tag: "slack", label: "Slack", icon: "bubble.left.and.bubble.right.fill", description: "Team Chat & Huddles", keywords: ["slack", "huddle", "thread"]),
                    SpaceRule(tag: "email", label: "Email", icon: "envelope.fill", description: "Inboxes & Invoices", keywords: ["email", "inbox", "gmail"]),
                    SpaceRule(tag: "home", label: "Home", icon: "house.fill", description: "Personal & Household", keywords: ["home", "household", "groceries", "cats", "errands"])
                ],
                people: [
                    PersonRule(tag: "matt", label: "Matt", keywords: ["matt", "matthew"]),
                    PersonRule(tag: "jenn", label: "Jenn", keywords: ["jenn", "jennifer"]),
                    PersonRule(tag: "sean", label: "Sean", keywords: ["sean"]),
                    PersonRule(tag: "daisy", label: "Daisy", keywords: ["daisy"]),
                    PersonRule(tag: "katie", label: "Katie", keywords: ["katie"]),
                    PersonRule(tag: "amy", label: "Amy", keywords: ["amy"]),
                    PersonRule(tag: "tammy", label: "Tammy", keywords: ["tammy"])
                ],
                projects: [
                    ProjectRule(tag: "turn90", label: "Turn90", keywords: ["turn90", "t90", "first shift"]),
                    ProjectRule(tag: "843fc", label: "843FC", keywords: ["843fc", "soccer", "futsal"]),
                    ProjectRule(tag: "nosa", label: "Nosa", keywords: ["nosa", "royvi", "claire"]),
                    ProjectRule(tag: "book", label: "Book & Synapse", keywords: ["memoir", "book", "synapse"])
                ]
            )
        }
    }
}
