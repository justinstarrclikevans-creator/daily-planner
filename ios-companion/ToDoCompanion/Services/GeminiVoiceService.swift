import Foundation

struct BrainDumpResult: Codable {
    var projectName: String
    var ideaSummary: String
    var tags: [String]
    var tasks: [ExtractedTask]
    
    struct ExtractedTask: Codable {
        var title: String
        var description: String?
        var listName: String
    }
}

struct ChatMessage: Identifiable, Codable {
    var id = UUID()
    var role: String // "user" or "model"
    var text: String
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
        4. Any concrete actionable tasks with a clean title and assigned listName ("First shift", "Football", or "Personal").
        
        Respond with ONLY a valid raw JSON object matching this schema:
        {
          "projectName": "Name of matched project",
          "ideaSummary": "Concise summary of the concept/idea",
          "tags": ["tag1", "tag2"],
          "tasks": [
            {
              "title": "Clear action verb title",
              "description": "Any relevant details",
              "listName": "Personal or First shift or Football"
            }
          ]
        }
        """
        
        let urlString = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=\(AppConfig.geminiAPIKey)"
        guard let url = URL(string: urlString) else {
            throw URLError(.badURL)
        }
        
        let requestBody: [String: Any] = [
            "contents": [
                [
                    "role": "user",
                    "parts": [
                        ["text": "\(systemPrompt)\n\nVoice Transcript:\n\"\(transcript)\""]
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
              let text = parts.first?["text"] as? String else {
            throw NSError(domain: "GeminiAPI", code: 500, userInfo: [NSLocalizedDescriptionKey: "Failed to parse Gemini response"])
        }
        
        guard let cleanData = text.data(using: .utf8) else {
            throw NSError(domain: "GeminiAPI", code: 500, userInfo: [NSLocalizedDescriptionKey: "Invalid text encoding"])
        }
        
        return try JSONDecoder().decode(BrainDumpResult.self, from: cleanData)
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
        
        let urlString = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=\(AppConfig.geminiAPIKey)"
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
}
