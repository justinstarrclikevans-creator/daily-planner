import Foundation

enum BreakdownDetailLevel: String, CaseIterable, Identifiable {
    case quick = "Quick (3 Steps)"
    case balanced = "Balanced (5 Steps)"
    case micro = "Micro-Steps (Overwhelm)"
    
    var id: String { rawValue }
    
    var stepCountRange: String {
        switch self {
        case .quick: return "exactly 3 high-level, punchy steps"
        case .balanced: return "4 to 5 clear, sequential steps"
        case .micro: return "6 to 8 tiny, zero-friction physical micro-steps (under 2 minutes each) for someone experiencing severe ADHD task paralysis"
        }
    }
    
    var shortLabel: String {
        switch self {
        case .quick: return "⚡ 3 Quick Steps"
        case .balanced: return "📋 5 Balanced Steps"
        case .micro: return "🧩 Micro-Steps"
        }
    }
}

struct TaskBreakdownResult: Codable {
    var firstFiveMinutes: String
    var estimatedMinutes: Int
    var steps: [String]
}

struct BrainDumpResult: Codable {
    var projectName: String
    var ideaSummary: String
    var tags: [String]
    var tasks: [ExtractedTask]
    
    struct ExtractedTask: Codable {
        var title: String
        var description: String?
        var listName: String
        var estimatedMinutes: Int?
        var firstFiveMinutes: String?
        var subtasks: [String]?
    }
}

struct ChatMessage: Identifiable, Codable {
    var id = UUID()
    var role: String // "user" or "model"
    var text: String
    var suggestedActionType: String? // "schedule" or "focus"
    var suggestedActionTitle: String?
    var suggestedActionDate: Date?
    var suggestedActionMinutes: Int?
    var suggestedActionPrompt: String?
}

class GeminiVoiceService {
    static let shared = GeminiVoiceService()
    
    private init() {}
    
    func parseBrainDump(transcript: String, projects: [Project]) async throws -> BrainDumpResult {
        let projectListStr = projects.map { "- \($0.name): \($0.goal)" }.joined(separator: "\n")
        
        let systemPrompt = """
        You are an intelligent executive assistant for Justin.
        Justin has ADHD and frequently brain-dumps his thoughts, project ideas, and tasks while on the go.
        
        Analyze the following voice transcript and extract:
        1. Which project this most relates to from this exact list:
        \(projectListStr)
        (If completely unrelated to work, select "Personal").
        
        2. A concise 1-2 sentence conceptual summary of any ideas, philosophies, or analogies mentioned.
        3. 1-3 relevant topic tags.
        4. Any concrete actionable tasks with:
           - a clean action-verb `title`
           - `description` (relevant context)
           - assigned `listName` ("First shift", "Football", or "Personal")
           - `estimatedMinutes` (integer: 5, 10, 15, 20, 25, 30, 45, or 60. Standard default for all new tasks is 5m. For simple tasks like calls, texts, checking something, or quick emails, use 5m. Never suggest 45m or 60m for simple tasks.)
           - `firstFiveMinutes` (1 short sentence describing the smallest physical action to start in the first 5 minutes)
           - `subtasks` (array of 2-4 concrete checklist steps)
        
        Respond with ONLY a valid raw JSON object matching this schema:
        {
          "projectName": "Name of matched project",
          "ideaSummary": "Concise summary of the concept/idea",
          "tags": ["tag1", "tag2"],
          "tasks": [
            {
              "title": "Clear action verb title",
              "description": "Any relevant details",
              "listName": "Personal or First shift or Football",
              "estimatedMinutes": 5,
              "firstFiveMinutes": "Open the thread and type a 1-line reply.",
              "subtasks": ["Step 1", "Step 2", "Step 3"]
            }
          ]
        }
        """
        
        return try await callGeminiJSON(prompt: "\(systemPrompt)\n\nVoice Transcript:\n\"\(transcript)\"", responseType: BrainDumpResult.self)
    }
    
    /// Tiimo-inspired AI Checklist & Momentum Breakdown with adjustable detail level.
    func generateTaskBreakdown(title: String, context: String?, detailLevel: BreakdownDetailLevel) async throws -> TaskBreakdownResult {
        let prompt = """
        You are an expert ADHD executive function coach helping Justin start and finish a task.
        Task Title: "\(title)"
        Context: "\(context ?? "None")"
        Requested Granularity: \(detailLevel.stepCountRange)
        
        Generate:
        1. `firstFiveMinutes`: A single, ultra-specific, low-barrier physical action Justin can do in the next 60 seconds to break initiation paralysis.
        2. `estimatedMinutes`: Realistic total duration in minutes (5, 10, 15, 20, 25, 30, 45, or 60). Standard default is 5m.
           CRITICAL DURATION SIZING:
           - For simple, everyday, or single-action tasks (e.g. calls, texts, quick emails, checking something, ordering, filing, quick lookups, routine tasks), assign 5m (or 10m).
           - NEVER assign 45 or 60 minutes to simple tasks.
           - Reserve 30-45 minutes only for complex, multi-step deep work.
        3. `steps`: An array of \(detailLevel.stepCountRange) that walk from start to finish. Keep each step concise (under 10 words).
        
        Respond with ONLY a valid JSON object matching this schema:
        {
          "firstFiveMinutes": "Smallest immediate physical starter action",
          "estimatedMinutes": 5,
          "steps": ["Step 1", "Step 2", "Step 3"]
        }
        """
        return try await callGeminiJSON(prompt: prompt, responseType: TaskBreakdownResult.self)
    }
    
    struct WorkflowExtractionResult: Codable {
        var title: String
        var description: String
        var steps: [String]
    }
    
    func extractSequentialWorkflow(transcript: String, overallMinutes: Int, project: Project?) async throws -> WorkflowExtractionResult {
        let projectName = project?.name ?? "General"
        let prompt = """
        You are an expert executive coach specializing in breaking task paralysis for adults with ADHD.
        The user has provided an audio transcript / brain-dump describing a workflow or task process for project "\(projectName)".
        
        Transcript:
        "\(transcript)"
        
        Target Total Time: \(overallMinutes) minutes (this is the OVERALL duration for the entire workflow).
        
        Break this down into:
        1. `title`: Punchy, clear workflow name (e.g. "Apricot Weekly Participant Audit").
        2. `description`: 1-sentence summary of what this workflow achieves.
        3. `steps`: An array of 3 to 7 strictly sequential single steps.
           CRITICAL: Each step must be a standalone physical action that can be executed one at a time without looking ahead.
        
        Respond with ONLY a valid JSON object matching:
        {
          "title": "Clear Workflow Name",
          "description": "1-sentence summary",
          "steps": ["Step 1", "Step 2", "Step 3"]
        }
        """
        return try await callGeminiJSON(prompt: prompt, responseType: WorkflowExtractionResult.self)
    }
    
    /// Promotes a saved Voice Idea / Brain Dump into concrete, time-estimated tasks with checklists.
    func promoteIdeaToTasks(idea: Idea, project: Project?, detailLevel: BreakdownDetailLevel) async throws -> [BrainDumpResult.ExtractedTask] {
        let projectName = project?.name ?? "Personal"
        let defaultList: String = {
            let lower = projectName.lowercased()
            if lower.contains("first shift") { return "First shift" }
            if lower.contains("football") || lower.contains("843") { return "Football" }
            return "Personal"
        }()
        
        struct IdeaPromotionResponse: Codable {
            var tasks: [BrainDumpResult.ExtractedTask]
        }
        
        let prompt = """
        You are Justin's ADHD executive assistant. Convert the following saved voice brainstorm idea into concrete actionable tasks for project "\(projectName)" (\(project?.goal ?? "")).
        
        Idea Summary: "\(idea.summary)"
        Original Transcript: "\(idea.rawTranscript)"
        Granularity Mode: \(detailLevel.stepCountRange)
        
        Create 1 to 4 actionable tasks. For each task include:
        - `title`: Clear action-verb title
        - `description`: Brief context
        - `listName`: "\(defaultList)"
        - `estimatedMinutes`: Realistic duration in minutes (5, 10, 15, 30. Default is 5)
        - `firstFiveMinutes`: 1-sentence immediate physical action to start
        - `subtasks`: Array of \(detailLevel.stepCountRange)
        
        Respond with ONLY valid JSON matching:
        {
          "tasks": [
            {
              "title": "Action title",
              "description": "Context",
              "listName": "\(defaultList)",
              "estimatedMinutes": 5,
              "firstFiveMinutes": "First 5-minute starter action",
              "subtasks": ["Subtask 1", "Subtask 2", "Subtask 3"]
            }
          ]
        }
        """
        
        let res = try await callGeminiJSON(prompt: prompt, responseType: IdeaPromotionResponse.self)
        return res.tasks
    }
    
    private func callGeminiJSON<T: Decodable>(prompt: String, responseType: T.Type) async throws -> T {
        let urlString = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=\(AppConfig.geminiAPIKey)"
        guard let url = URL(string: urlString) else {
            throw URLError(.badURL)
        }
        
        let requestBody: [String: Any] = [
            "contents": [
                [
                    "role": "user",
                    "parts": [
                        ["text": prompt]
                    ]
                ]
            ],
            "generationConfig": [
                "responseMimeType": "application/json",
                "temperature": 0.2
            ]
        ]
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: requestBody)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            let errorText = String(data: data, encoding: .utf8) ?? "Unknown Gemini API error"
            throw NSError(domain: "GeminiAPI", code: (response as? HTTPURLResponse)?.statusCode ?? 500, userInfo: [NSLocalizedDescriptionKey: errorText])
        }
        
        let jsonResponse = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let candidates = jsonResponse?["candidates"] as? [[String: Any]],
              let firstCandidate = candidates.first,
              let content = firstCandidate["content"] as? [String: Any],
              let parts = content["parts"] as? [[String: Any]],
              let text = parts.first?["text"] as? String,
              let cleanData = text.data(using: .utf8) else {
            throw NSError(domain: "GeminiAPI", code: 500, userInfo: [NSLocalizedDescriptionKey: "Failed to parse Gemini response"])
        }
        
        return try JSONDecoder().decode(T.self, from: cleanData)
    }
    
    func chatConversation(history: [ChatMessage], activeProject: Project?) async throws -> String {
        let projectContext = activeProject != nil ? "Currently discussing Project: \(activeProject!.name) (\(activeProject!.goal))" : "General executive discussion."
        
        let systemInstruction = """
        You are Justin's conversational ADHD executive partner and brainstorm sounding-board.
        You are speaking out loud to Justin through his phone.
        Keep answers short, natural, conversational, and direct (1-3 sentences max).
        Help him refine rough ideas, prioritize his day, and decide next immediate actions.
        Context: \(projectContext)
        """
        
        let contents = history.map { msg -> [String: Any] in
            return [
                "role": msg.role == "user" ? "user" : "model",
                "parts": [["text": msg.text]]
            ]
        }
        
        let requestBody: [String: Any] = [
            "system_instruction": [
                "parts": [["text": systemInstruction]]
            ],
            "contents": contents,
            "generationConfig": [
                "temperature": 0.7,
                "maxOutputTokens": 300
            ]
        ]
        
        let urlString = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=\(AppConfig.geminiAPIKey)"
        guard let url = URL(string: urlString) else { throw URLError(.badURL) }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: requestBody)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            let errorText = String(data: data, encoding: .utf8) ?? "Unknown Gemini API error"
            throw NSError(domain: "GeminiAPI", code: (response as? HTTPURLResponse)?.statusCode ?? 500, userInfo: [NSLocalizedDescriptionKey: errorText])
        }
        
        let jsonResponse = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let candidates = jsonResponse?["candidates"] as? [[String: Any]],
              let firstCandidate = candidates.first,
              let content = firstCandidate["content"] as? [String: Any],
              let parts = content["parts"] as? [[String: Any]],
              let text = parts.first?["text"] as? String else {
            return "Got it. Let's keep moving forward."
        }
        
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    
    // MARK: - Full Executive Assistant Co-Pilot
    func assistantChat(
        history: [ChatMessage],
        tasks: [TaskItem],
        projects: [Project],
        todayEvents: [CalendarEventItem],
        tomorrowEvents: [CalendarEventItem],
        freeSlotsTomorrow: [FreeTimeSlot]
    ) async throws -> ChatMessage {
        let taskSummary = tasks.filter { !$0.isCompleted }.prefix(30).map { t in
            "- [\(t.listName)] \(t.title) (⏱ \(t.estimatedMinutes ?? 5)m)\(t.firstFiveMinutesPrompt != nil ? " | Starter: \(t.firstFiveMinutesPrompt!)" : "")"
        }.joined(separator: "\n")
        
        let projectRules = projects.map { p in
            let instr = p.effectiveInstructions
            return "- Project '\(p.name)': Goal: \(p.goal)\(instr.isEmpty ? "" : " | Rules/Instructions: \(instr)")"
        }.joined(separator: "\n")
        
        let calSummaryToday = todayEvents.isEmpty ? "No events scheduled for today." : todayEvents.map { "- \($0.timeString): \($0.title)" }.joined(separator: "\n")
        let calSummaryTomorrow = tomorrowEvents.isEmpty ? "No events scheduled for tomorrow." : tomorrowEvents.map { "- \($0.timeString): \($0.title)" }.joined(separator: "\n")
        let slotsSummary = freeSlotsTomorrow.isEmpty ? "No large open blocks found tomorrow." : freeSlotsTomorrow.prefix(5).map { slot in
            let iso = ISO8601DateFormatter().string(from: slot.startDate)
            return "- \(slot.label) [ISO: \(iso)]"
        }.joined(separator: "\n")
        
        let systemInstruction = """
        You are Justin's intelligent, personal executive assistant and chief of staff.
        Justin has ADHD. Your role is to cut through friction, prevent paralysis, and help him execute across his primary projects (Turn Ninety / First Shift, Football / 843, Briefcase, and Personal).
        
        CURRENT TIME:
        \(Date().formatted(date: .complete, time: .shortened))
        
        ACTIVE PROJECT PLAYBOOKS & RULES:
        \(projectRules)
        
        TODAY'S CALENDAR:
        \(calSummaryToday)
        
        TOMORROW'S CALENDAR:
        \(calSummaryTomorrow)
        
        TOMORROW'S OPEN FOCUS WINDOWS:
        \(slotsSummary)
        
        OPEN TO-DOS (Top 30 synced from Apple Reminders):
        \(taskSummary.isEmpty ? "All to-dos completed!" : taskSummary)
        
        CAPABILITIES & BEHAVIOR:
        1. When asked for a schedule, quick win, or tasks for a specific time window (e.g. "I have 15 minutes", "15m quick win", "45m sprint", "I have three hours", "give me a list of todos I can do"):
           - You MUST pick concrete tasks from the OPEN TO-DOS list above. NEVER respond with vague advice, platitudes, or an empty one-sentence answer if tasks are available.
           - For "15m quick win" / 15 minutes: Select 1 to 3 quick tasks totaling ~15 minutes (default tasks are 5m each). State clearly which task to do first, its duration, and the immediate physical starter step.
           - For "45m sprint" / 45 minutes: Select 1 or 2 high-priority tasks totaling ~45 minutes.
           - For multi-hour blocks (e.g. 3 hours): Pack tasks cleanly into a numbered chronological agenda.
           - CRITICAL: In EVERY schedule or quick-win recommendation, append an action tag so the app can launch the focus timer directly:
             [ACTION:FOCUS|Exact Task Title|Smallest 60-second physical starter action|DurationMinutes]
           - The "Exact Task Title" MUST match one of the task titles from OPEN TO-DOS verbatim.
           
        2. RULE OF THREE (Project Promotion):
           - If you observe 3 or more unassigned or "Personal" tasks that share a common theme, domain, or project (e.g. book writing, taxes, car, podcast, drills), actively call it out:
           - "Rule of 3: You have 3+ tasks related to [Topic]. Let's convert this into a dedicated Project so we can control its hours and AI playbook."
           - Append: [ACTION:CREATE_PROJECT|Topic Name|Suggested Project Goal]
           
        3. When asked "What does my day look like tomorrow?" (or schedule briefing):
           - Provide a crisp 2-3 sentence executive briefing of meetings, key commitments, and open blocks.
           
        4. When asked "Can you schedule me time to work on some of my todos?" (or time-blocking):
           - Identify an open window from TOMORROW'S OPEN FOCUS WINDOWS.
           - Propose scheduling a high-priority task in that slot.
           - Append: [ACTION:SCHEDULE|Task Title|ISO_DATE|DURATION_MINUTES]
           
        5. TONE & AGGRESSIVE MOTIVATION:
           - Direct, urgent, fighting-focused executive partner.
           - Zero corporate fluff, no soft coddling.
           - Emphasize taking immediate action: "Stop deliberating, execute line 1."
           - 2 to 4 sentences max.
        """
        
        let contents = history.map { msg -> [String: Any] in
            return [
                "role": msg.role == "user" ? "user" : "model",
                "parts": [["text": msg.text]]
            ]
        }
        
        let requestBody: [String: Any] = [
            "system_instruction": [
                "parts": [["text": systemInstruction]]
            ],
            "contents": contents,
            "generationConfig": [
                "temperature": 0.5,
                "maxOutputTokens": 450
            ]
        ]
        
        let urlString = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=\(AppConfig.geminiAPIKey)"
        guard let url = URL(string: urlString) else { throw URLError(.badURL) }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: requestBody)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            let errorText = String(data: data, encoding: .utf8) ?? "Unknown Gemini API error"
            throw NSError(domain: "GeminiAPI", code: (response as? HTTPURLResponse)?.statusCode ?? 500, userInfo: [NSLocalizedDescriptionKey: errorText])
        }
        
        let jsonResponse = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let candidates = jsonResponse?["candidates"] as? [[String: Any]],
              let firstCandidate = candidates.first,
              let content = firstCandidate["content"] as? [String: Any],
              let parts = content["parts"] as? [[String: Any]],
              let rawText = parts.first?["text"] as? String else {
            return ChatMessage(role: "model", text: "I'm right here. How can I help with your day or projects?")
        }
        
        var cleanText = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        var actionType: String? = nil
        var actionTitle: String? = nil
        var actionDate: Date? = nil
        var actionMinutes: Int? = nil
        var actionPrompt: String? = nil
        
        if let focusRange = cleanText.range(of: #"\[ACTION:FOCUS\|([^\]]+)\]"#, options: .regularExpression) {
            let matched = String(cleanText[focusRange])
            let inner = matched.replacingOccurrences(of: "[ACTION:FOCUS|", with: "").replacingOccurrences(of: "]", with: "")
            let components = inner.components(separatedBy: "|")
            if components.count >= 3 {
                actionType = "focus"
                actionTitle = components[0].trimmingCharacters(in: .whitespacesAndNewlines)
                actionPrompt = components[1].trimmingCharacters(in: .whitespacesAndNewlines)
                actionMinutes = Int(components[2].trimmingCharacters(in: .whitespacesAndNewlines)) ?? 5
            }
            cleanText.removeSubrange(focusRange)
        } else if let schedRange = cleanText.range(of: #"\[ACTION:SCHEDULE\|([^\]]+)\]"#, options: .regularExpression) {
            let matched = String(cleanText[schedRange])
            let inner = matched.replacingOccurrences(of: "[ACTION:SCHEDULE|", with: "").replacingOccurrences(of: "]", with: "")
            let components = inner.components(separatedBy: "|")
            if components.count >= 3 {
                actionType = "schedule"
                actionTitle = components[0].trimmingCharacters(in: .whitespacesAndNewlines)
                let dateStr = components[1].trimmingCharacters(in: .whitespacesAndNewlines)
                actionDate = ISO8601DateFormatter().date(from: dateStr)
                actionMinutes = Int(components[2].trimmingCharacters(in: .whitespacesAndNewlines)) ?? 30
            }
            cleanText.removeSubrange(schedRange)
        } else if let projRange = cleanText.range(of: #"\[ACTION:CREATE_PROJECT\|([^\]]+)\]"#, options: .regularExpression) {
            let matched = String(cleanText[projRange])
            let inner = matched.replacingOccurrences(of: "[ACTION:CREATE_PROJECT|", with: "").replacingOccurrences(of: "]", with: "")
            let components = inner.components(separatedBy: "|")
            if components.count >= 2 {
                actionType = "create_project"
                actionTitle = components[0].trimmingCharacters(in: .whitespacesAndNewlines)
                actionPrompt = components[1].trimmingCharacters(in: .whitespacesAndNewlines)
            }
            cleanText.removeSubrange(projRange)
        }
        
        return ChatMessage(
            role: "model",
            text: cleanText.trimmingCharacters(in: .whitespacesAndNewlines),
            suggestedActionType: actionType,
            suggestedActionTitle: actionTitle,
            suggestedActionDate: actionDate,
            suggestedActionMinutes: actionMinutes,
            suggestedActionPrompt: actionPrompt
        )
    }
}
