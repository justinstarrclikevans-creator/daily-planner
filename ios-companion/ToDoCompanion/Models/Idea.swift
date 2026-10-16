import Foundation

struct Idea: Identifiable, Codable, Hashable {
    var id: UUID
    var projectId: UUID?
    var rawTranscript: String
    var summary: String
    var tags: [String]
    var createdAt: Date?
    
    enum CodingKeys: String, CodingKey {
        case id
        case projectId = "project_id"
        case rawTranscript = "raw_transcript"
        case summary
        case tags
        case createdAt = "created_at"
    }
}
