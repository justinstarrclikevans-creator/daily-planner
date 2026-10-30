import Foundation

struct SubtaskItem: Identifiable, Codable, Hashable {
    var id: UUID = UUID()
    var title: String
    var isCompleted: Bool = false
    
    enum CodingKeys: String, CodingKey {
        case id
        case title
        case isCompleted = "is_completed"
    }
    
    init(id: UUID = UUID(), title: String, isCompleted: Bool = false) {
        self.id = id
        self.title = title
        self.isCompleted = isCompleted
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        self.title = try container.decodeIfPresent(String.self, forKey: .title) ?? ""
        self.isCompleted = try container.decodeIfPresent(Bool.self, forKey: .isCompleted) ?? false
    }
    
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(title, forKey: .title)
        try container.encode(isCompleted, forKey: .isCompleted)
    }
}

enum TaskDuration: Int, CaseIterable, Identifiable {
    case five = 5
    case ten = 10
    case fifteen = 15
    case twenty = 20
    case twentyFive = 25
    case thirty = 30
    case fortyFive = 45
    case sixty = 60
    
    var id: Int { rawValue }
    var label: String { "\(rawValue)m" }
    
    static func normalize(_ minutes: Int?) -> TaskDuration {
        guard let m = minutes, m > 0 else { return .five }
        if m <= 7 { return .five }
        if m <= 12 { return .ten }
        if m <= 18 { return .fifteen }
        if m <= 22 { return .twenty }
        if m <= 27 { return .twentyFive }
        if m <= 38 { return .thirty }
        if m <= 52 { return .fortyFive }
        return .sixty
    }
}

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
    
    // MARK: - First-Class Tiimo Execution Properties (Supabase Columns)
    var estimatedMinutes: Int
    var priority: String
    var actualSeconds: Int
    var inPlayQueue: Bool
    var firstFiveMinutesPrompt: String?
    var subtasks: [SubtaskItem]
    
    var isCompleted: Bool {
        get { status == "completed" }
        set { status = newValue ? "completed" : "pending" }
    }
    
    var isHighPriority: Bool { priority.lowercased() == "high" }
    var isMediumPriority: Bool { priority.lowercased() == "medium" }
    var isLowPriority: Bool { priority.lowercased() == "low" }
    
    var isScheduledForFuture: Bool {
        guard let due = dueDate else { return false }
        let calendar = Calendar.current
        let startOfToday = calendar.startOfDay(for: Date())
        let startOfDueDate = calendar.startOfDay(for: due)
        return startOfDueDate > startOfToday
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
        case estimatedMinutes = "estimated_minutes"
        case priority
        case actualSeconds = "actual_seconds"
        case inPlayQueue = "in_play_queue"
        case firstFiveMinutesPrompt = "first_five_minutes"
        case subtasks
    }
    
    init(
        id: UUID = UUID(),
        projectId: UUID? = nil,
        title: String,
        description: String? = nil,
        listName: String = "Personal",
        status: String = "pending",
        dueDate: Date? = nil,
        source: String = "ios",
        appleReminderId: String? = nil,
        createdAt: Date? = Date(),
        estimatedMinutes: Int? = nil,
        priority: String = "medium",
        actualSeconds: Int = 0,
        inPlayQueue: Bool = false,
        firstFiveMinutesPrompt: String? = nil,
        subtasks: [SubtaskItem] = []
    ) {
        self.id = id
        self.projectId = projectId
        self.title = title
        self.description = description
        self.listName = listName
        self.status = status
        self.dueDate = dueDate
        self.source = source
        self.appleReminderId = appleReminderId
        self.createdAt = createdAt
        self.priority = priority
        self.actualSeconds = actualSeconds
        self.inPlayQueue = inPlayQueue
        self.firstFiveMinutesPrompt = firstFiveMinutesPrompt
        self.subtasks = subtasks
        
        // Duration heuristics if not provided
        if let mins = estimatedMinutes, mins > 0 {
            self.estimatedMinutes = mins
        } else {
            self.estimatedMinutes = Self.heuristicMinutes(for: title, description: description)
        }
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(UUID.self, forKey: .id)
        self.projectId = try container.decodeIfPresent(UUID.self, forKey: .projectId)
        self.title = try container.decode(String.self, forKey: .title)
        let rawDesc = try container.decodeIfPresent(String.self, forKey: .description)
        self.description = rawDesc
        self.listName = try container.decodeIfPresent(String.self, forKey: .listName) ?? "Personal"
        self.status = try container.decodeIfPresent(String.self, forKey: .status) ?? "pending"
        self.dueDate = try container.decodeIfPresent(Date.self, forKey: .dueDate)
        self.source = try container.decodeIfPresent(String.self, forKey: .source) ?? "ios"
        self.appleReminderId = try container.decodeIfPresent(String.self, forKey: .appleReminderId)
        self.createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt)
        self.actualSeconds = try container.decodeIfPresent(Int.self, forKey: .actualSeconds) ?? 0
        
        // 1. Resolve in_play_queue (Column first, then fallback to [▶️ Queue] tag)
        if let colQueue = try container.decodeIfPresent(Bool.self, forKey: .inPlayQueue) {
            self.inPlayQueue = colQueue
        } else if let desc = rawDesc {
            self.inPlayQueue = desc.contains("[▶️ Queue]")
        } else {
            self.inPlayQueue = false
        }
        
        // 2. Resolve estimated_minutes (Column first, then regex tag, then heuristic)
        if let colMins = try container.decodeIfPresent(Int.self, forKey: .estimatedMinutes), colMins > 0 {
            self.estimatedMinutes = colMins
        } else {
            self.estimatedMinutes = Self.heuristicMinutes(for: self.title, description: rawDesc)
        }
        
        // 3. Resolve first_five_minutes prompt
        if let colPrompt = try container.decodeIfPresent(String.self, forKey: .firstFiveMinutesPrompt), !colPrompt.isEmpty {
            self.firstFiveMinutesPrompt = colPrompt
        } else if let desc = rawDesc {
            self.firstFiveMinutesPrompt = Self.extractFirstFive(from: desc)
        } else {
            self.firstFiveMinutesPrompt = nil
        }
        
        // 4. Resolve subtasks
        if let colSubtasks = try container.decodeIfPresent([SubtaskItem].self, forKey: .subtasks), !colSubtasks.isEmpty {
            self.subtasks = colSubtasks
        } else if let desc = rawDesc {
            self.subtasks = Self.extractSubtasks(from: desc)
        } else {
            self.subtasks = []
        }
        
        // 5. Resolve priority
        if let colPriority = try container.decodeIfPresent(String.self, forKey: .priority) {
            self.priority = colPriority
        } else if let desc = rawDesc?.lowercased(), desc.contains("[🔥 high]") || desc.contains("priority: high") {
            self.priority = "high"
        } else if let desc = rawDesc?.lowercased(), desc.contains("[🌱 low]") || desc.contains("priority: low") {
            self.priority = "low"
        } else {
            self.priority = "medium"
        }
    }
    
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encodeIfPresent(projectId, forKey: .projectId)
        try container.encode(title, forKey: .title)
        try container.encodeIfPresent(description, forKey: .description)
        try container.encode(listName, forKey: .listName)
        try container.encode(status, forKey: .status)
        try container.encodeIfPresent(dueDate, forKey: .dueDate)
        try container.encode(source, forKey: .source)
        try container.encodeIfPresent(appleReminderId, forKey: .appleReminderId)
        try container.encodeIfPresent(createdAt, forKey: .createdAt)
        
        // First-class columns
        try container.encode(estimatedMinutes, forKey: .estimatedMinutes)
        try container.encode(priority, forKey: .priority)
        try container.encode(actualSeconds, forKey: .actualSeconds)
        try container.encode(inPlayQueue, forKey: .inPlayQueue)
        try container.encodeIfPresent(firstFiveMinutesPrompt, forKey: .firstFiveMinutesPrompt)
        try container.encode(subtasks, forKey: .subtasks)
    }
    
    // MARK: - Helpers & Fallbacks
    
    static func extractEstimatedMinutes(from desc: String) -> Int? {
        if let range = desc.range(of: #"\[⏱\s*(\d+)m\]"#, options: .regularExpression) {
            let match = String(desc[range])
            let digits = match.components(separatedBy: CharacterSet.decimalDigits.inverted).joined()
            if let mins = Int(digits), mins > 0 {
                return TaskDuration.normalize(mins).rawValue
            }
        }
        return nil
    }
    
    static func heuristicMinutes(for title: String, description: String?) -> Int {
        if let desc = description, let mins = extractEstimatedMinutes(from: desc) {
            return mins
        }
        
        // Default to 5 minutes for all added tasks as requested
        return 5
    }
    
    static func extractFirstFive(from desc: String) -> String? {
        for line in desc.components(separatedBy: .newlines) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("⚡ First 5 Minutes:") {
                let prompt = trimmed.replacingOccurrences(of: "⚡ First 5 Minutes:", with: "").trimmingCharacters(in: .whitespaces)
                if !prompt.isEmpty { return prompt }
            }
        }
        return nil
    }
    
    static func extractSubtasks(from desc: String) -> [SubtaskItem] {
        var items: [SubtaskItem] = []
        for line in desc.components(separatedBy: .newlines) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("- [ ] ") {
                let stepTitle = String(trimmed.dropFirst(6)).trimmingCharacters(in: .whitespaces)
                if !stepTitle.isEmpty {
                    items.append(SubtaskItem(title: stepTitle, isCompleted: false))
                }
            } else if trimmed.lowercased().hasPrefix("- [x] ") {
                let stepTitle = String(trimmed.dropFirst(6)).trimmingCharacters(in: .whitespaces)
                if !stepTitle.isEmpty {
                    items.append(SubtaskItem(title: stepTitle, isCompleted: true))
                }
            } else if trimmed.hasPrefix("◦ ") || trimmed.hasPrefix("• ") {
                let stepTitle = String(trimmed.dropFirst(2)).trimmingCharacters(in: .whitespaces)
                if !stepTitle.isEmpty {
                    items.append(SubtaskItem(title: stepTitle, isCompleted: false))
                }
            }
        }
        return items
    }
    
    /// Clean human-readable context notes (excluding metadata tags and checklist lines).
    var cleanDescription: String {
        guard let desc = description, !desc.isEmpty else { return "" }
        let filteredLines = desc.components(separatedBy: .newlines).compactMap { line -> String? in
            var cleaned = line
                .replacingOccurrences(of: #"\[⏱\s*\d+m\]"#, with: "", options: .regularExpression)
                .replacingOccurrences(of: "[▶️ Queue]", with: "")
                .trimmingCharacters(in: .whitespaces)
            if cleaned.isEmpty { return nil }
            if cleaned.hasPrefix("- [ ] ") || cleaned.lowercased().hasPrefix("- [x] ") { return nil }
            if cleaned.hasPrefix("◦ ") || cleaned.hasPrefix("• ") { return nil }
            if cleaned.hasPrefix("⚡ First 5 Minutes:") { return nil }
            return cleaned
        }
        return filteredLines.joined(separator: "\n")
    }
    
    /// Rebuilds serialized description preserving clean notes, subtasks, duration, and queue state.
    static func buildDescription(
        cleanNotes: String,
        estimatedMinutes: Int?,
        inPlayQueue: Bool,
        firstFiveMinutes: String? = nil,
        subtasks: [SubtaskItem]
    ) -> String {
        var parts: [String] = []
        
        var headerTags: [String] = []
        if let mins = estimatedMinutes, mins > 0 {
            headerTags.append("[⏱ \(mins)m]")
        }
        if inPlayQueue {
            headerTags.append("[▶️ Queue]")
        }
        if !headerTags.isEmpty {
            parts.append(headerTags.joined(separator: " "))
        }
        
        let trimmedNotes = cleanNotes.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedNotes.isEmpty {
            parts.append(trimmedNotes)
        }
        
        if !subtasks.isEmpty {
            let checklistLines = subtasks.map { item in
                "- [\(item.isCompleted ? "x" : " ")] \(item.title)"
            }
            parts.append(checklistLines.joined(separator: "\n"))
        }
        
        return parts.joined(separator: "\n")
    }
    
    mutating func updateMetadata(
        estimatedMinutes: Int? = nil,
        inPlayQueue: Bool? = nil,
        firstFiveMinutes: String? = nil,
        subtasks: [SubtaskItem]? = nil,
        actualSeconds: Int? = nil
    ) {
        if let mins = estimatedMinutes { self.estimatedMinutes = mins }
        if let queue = inPlayQueue { self.inPlayQueue = queue }
        if let prompt = firstFiveMinutes { self.firstFiveMinutesPrompt = prompt }
        if let steps = subtasks { self.subtasks = steps }
        if let secs = actualSeconds { self.actualSeconds = secs }
        
        self.description = Self.buildDescription(
            cleanNotes: self.cleanDescription,
            estimatedMinutes: self.estimatedMinutes,
            inPlayQueue: self.inPlayQueue,
            firstFiveMinutes: self.firstFiveMinutesPrompt,
            subtasks: self.subtasks
        )
    }
}
