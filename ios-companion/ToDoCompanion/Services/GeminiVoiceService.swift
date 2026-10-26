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
    var firstFiveMinutes: String?
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
        (If unsure which project it belongs to, select "General").
        
        2. A concise 1-2 sentence conceptual summary of any ideas, philosophies, or analogies mentioned.
        3. 1-3 relevant topic tags.
        4. Any concrete actionable tasks with:
           - a clean action-verb `title`
           - `description` (relevant context)
           - assigned `listName` ("General", "Turn90", "843FC", "Personal", "Nosa", or "Book (Memoir) and Synapse" — use "General" if unsure)
           - `estimatedMinutes` (integer: 5, 10, 15, 20, 25, 30, 45, or 60. Standard default for all new tasks is 5m.)
           - `subtasks` (array of 2-5 concrete checklist steps if the task has multiple steps)
        
        Respond with ONLY a valid raw JSON object matching this schema:
        {
          "projectName": "Name of matched project",
          "ideaSummary": "Concise summary of the concept/idea",
          "tags": ["tag1", "tag2"],
          "tasks": [
            {
              "title": "Clear action verb title",
              "description": "Any relevant details",
              "listName": "General",
              "estimatedMinutes": 5,
              "subtasks": ["Step 1", "Step 2", "Step 3"]
            }
          ]
        }
        """
        
        return try await callGeminiJSON(prompt: "\(systemPrompt)\n\nVoice Transcript:\n\"\(transcript)\"", responseType: BrainDumpResult.self)
    }
    
    /// AI Checklist & Momentum Breakdown with adjustable detail level (and syncs subtasks back to Apple Reminders).
    func generateTaskBreakdown(title: String, context: String?, detailLevel: BreakdownDetailLevel) async throws -> TaskBreakdownResult {
        let prompt = """
        You are an expert ADHD executive function coach helping Justin start and finish a task.
        Apply the "Failure of Nerve" principle: hesitation or overcomplicating a task is rarely a lack of skill—it is a failure of nerve. Strip away hesitation and break this task into direct, decisive execution steps.
        Do NOT generate a "first 5 minutes" starter prompt; only generate the estimatedMinutes and concrete subtasks (`steps`).
        
        Task Title: "\(title)"
        Context: "\(context ?? "None")"
        Requested Granularity: \(detailLevel.stepCountRange)
        
        Generate:
        1. `estimatedMinutes`: Realistic total duration in minutes (5, 10, 15, 20, 25, 30, 45, or 60). Standard default is 5m.
        2. `steps`: An array of \(detailLevel.stepCountRange) that walk from start to finish. Keep each step concise (under 10 words) and decisive.
        
        Respond with ONLY a valid JSON object matching this schema:
        {
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
        let projectName = project?.name ?? "General"
        
        struct IdeaPromotionResponse: Codable {
            var tasks: [BrainDumpResult.ExtractedTask]
        }
        
        let prompt = """
        You are Justin's ADHD executive assistant. Convert the following saved voice brainstorm idea into concrete actionable tasks for project "\(projectName)" (\(project?.goal ?? "")).
        Apply the "Failure of Nerve" principle: strip out over-planning and hesitation, and turn thoughts into direct, bold actions.
        
        Idea Summary: "\(idea.summary)"
        Original Transcript: "\(idea.rawTranscript)"
        Granularity Mode: \(detailLevel.stepCountRange)
        
        Create 1 to 4 actionable tasks. For each task include:
        - `title`: Clear action-verb title
        - `description`: Brief context
        - `listName`: "\(projectName)"
        - `estimatedMinutes`: Realistic duration in minutes (5, 10, 15, 30. Default is 5)
        - `subtasks`: Array of \(detailLevel.stepCountRange)
        
        Respond with ONLY valid JSON matching:
        {
          "tasks": [
            {
              "title": "Action title",
              "description": "Context",
              "listName": "\(projectName)",
              "estimatedMinutes": 5,
              "subtasks": ["Subtask 1", "Subtask 2", "Subtask 3"]
            }
          ]
        }
        """
        
        let res = try await callGeminiJSON(prompt: prompt, responseType: IdeaPromotionResponse.self)
        return res.tasks
    }
    
    private let fallbackModels = [
        "gemini-3.8-flash",
        "gemini-flash-latest",
        "gemini-3.5-flash"
    ]
    
    private func generateGeminiData(requestBody: [String: Any]) async throws -> Data {
        let bodyData = try JSONSerialization.data(withJSONObject: requestBody)
        var lastError: Error? = nil
        
        for model in fallbackModels {
            let urlString = "https://generativelanguage.googleapis.com/v1beta/models/\(model):generateContent?key=\(AppConfig.geminiAPIKey)"
            guard let url = URL(string: urlString) else { continue }
            
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = bodyData
            
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 {
                    return data
                } else {
                    let errorText = String(data: data, encoding: .utf8) ?? "Unknown Gemini API error"
                    lastError = NSError(
                        domain: "GeminiAPI",
                        code: (response as? HTTPURLResponse)?.statusCode ?? 500,
                        userInfo: [NSLocalizedDescriptionKey: errorText]
                    )
                }
            } catch {
                lastError = error
            }
        }
        
        throw lastError ?? URLError(.cannotConnectToHost)
    }
    
    private func callGeminiJSON<T: Decodable>(prompt: String, responseType: T.Type) async throws -> T {
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
        
        let data = try await generateGeminiData(requestBody: requestBody)
        
        let jsonResponse = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let candidates = jsonResponse?["candidates"] as? [[String: Any]],
              let firstCandidate = candidates.first,
              let content = firstCandidate["content"] as? [String: Any],
              let parts = content["parts"] as? [[String: Any]],
              let text = parts.compactMap({ $0["text"] as? String }).last,
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
        Enforce the "Failure of Nerve" concept: when Justin stalls, over-analyzes, or hesitates on high-leverage work, remind him that stalling is a failure of nerve, not a lack of readiness—and push him to act now.
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
                "maxOutputTokens": 2048
            ]
        ]
        
        let data = try await generateGeminiData(requestBody: requestBody)
        
        let jsonResponse = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let candidates = jsonResponse?["candidates"] as? [[String: Any]],
              let firstCandidate = candidates.first,
              let content = firstCandidate["content"] as? [String: Any],
              let parts = content["parts"] as? [[String: Any]],
              let text = parts.compactMap({ $0["text"] as? String }).last else {
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
        let taskSummary = tasks.filter { !$0.isCompleted }.prefix(40).map { t in
            let subCount = t.subtasks.isEmpty ? "" : " [\(t.subtasks.count) subtasks]"
            return "- [\(t.listName)] \(t.title) (⏱ \(t.estimatedMinutes)m)\(subCount)"
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
        Justin has ADHD. Your role is to cut through friction, prevent paralysis, and help him execute across his 6 projects: General, Turn90, 843FC, Personal, Nosa, and Book (Memoir) and Synapse.
        
        CORE DOCTRINE — FAILURE OF NERVE:
        You operate with the "Failure of Nerve" concept (Edwin Friedman). Procrastination, perfectionism, and endless preparation on important tasks are rarely due to lack of time or information—they are a FAILURE OF NERVE (fear of exposure, decision, or discomfort). Call out any failure of nerve directly and push Justin into immediate decisive execution.
        Do NOT set or mention "First 5 Minutes" starter steps.
        
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
        
        OPEN TO-DOS (Synced from Apple Reminders):
        \(taskSummary.isEmpty ? "All to-dos completed!" : taskSummary)
        
        CAPABILITIES & BEHAVIOR:
        1. When asked for a schedule, quick win, or tasks for a specific time window (e.g. "I have 15 minutes", "15m quick win", "45m sprint", "I have three hours", "give me a list of todos I can do"):
           - You MUST pick concrete tasks from the OPEN TO-DOS list above. NEVER respond with vague advice, platitudes, or an empty one-sentence answer if tasks are available.
           - For "15m quick win" / 15 minutes: Select 1 to 3 quick tasks totaling ~15 minutes (default tasks are 5m each). State clearly which task to do first and its duration.
           - For "45m sprint" / 45 minutes: Select 1 to 3 high-priority tasks totaling ~45 minutes.
           - For multi-hour blocks (e.g. 3 hours): Pack tasks cleanly into a numbered chronological agenda.
           - CRITICAL: In EVERY schedule or quick-win recommendation, append an action tag so the app can launch the focus timer directly:
             [ACTION:FOCUS|Exact Task Title|Execute now|DurationMinutes]
           - The "Exact Task Title" MUST match one of the task titles from OPEN TO-DOS verbatim.
           
        2. When asked "What does my day look like tomorrow?" (or schedule briefing):
           - Provide a crisp 2-3 sentence executive briefing of meetings, key commitments, and open blocks.
           
        3. When asked "Can you schedule me time to work on some of my todos?" (or time-blocking):
           - Identify an open window from TOMORROW'S OPEN FOCUS WINDOWS.
           - Propose scheduling a high-priority task in that slot.
           - Append: [ACTION:SCHEDULE|Task Title|ISO_DATE|DURATION_MINUTES]
           
        4. TONE & AGGRESSIVE MOTIVATION:
           - Direct, urgent, fighting-focused executive partner.
           - Call out "failure of nerve" whenever Justin is avoiding high-impact work.
           - Zero corporate fluff, no soft coddling.
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
                "maxOutputTokens": 2048
            ]
        ]
        
        let data = try await generateGeminiData(requestBody: requestBody)
        
        let jsonResponse = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let candidates = jsonResponse?["candidates"] as? [[String: Any]],
              let firstCandidate = candidates.first,
              let content = firstCandidate["content"] as? [String: Any],
              let parts = content["parts"] as? [[String: Any]],
              let rawText = parts.compactMap({ $0["text"] as? String }).last else {
            return ChatMessage(role: "model", text: "I'm right here. Pick a target and let's execute.")
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
                actionPrompt = nil
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
