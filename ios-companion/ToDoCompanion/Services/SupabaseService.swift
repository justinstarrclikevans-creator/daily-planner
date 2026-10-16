import Foundation
import Combine

@MainActor
class SupabaseService: ObservableObject {
    static let shared = SupabaseService()
    
    @Published var projects: [Project] = Project.defaults
    @Published var tasks: [TaskItem] = []
    @Published var ideas: [Idea] = []
    @Published var isLoading: Bool = false
    @Published var errorMessage: String? = nil
    
    private init() {
        Task {
            await fetchAll()
        }
    }
    
    func fetchAll() async {
        guard AppConfig.isSupabaseConfigured else {
            print("Supabase not configured, using local defaults.")
            return
        }
        
        isLoading = true
        defer { isLoading = false }
        
        await fetchProjects()
        await fetchTasks()
        await fetchIdeas()
    }
    
    // MARK: - Projects
    func fetchProjects() async {
        guard let url = URL(string: "\(AppConfig.supabaseURL)/rest/v1/projects?select=*&order=name.asc") else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(AppConfig.supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(AppConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
                return
            }
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            let fetched = try decoder.decode([Project].self, from: data)
            if !fetched.isEmpty {
                self.projects = fetched
            }
        } catch {
            print("Error fetching projects: \(error.localizedDescription)")
        }
    }
    
    // MARK: - Tasks
    func fetchTasks() async {
        guard let url = URL(string: "\(AppConfig.supabaseURL)/rest/v1/tasks?select=*&order=created_at.desc") else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(AppConfig.supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(AppConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
                return
            }
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            self.tasks = try decoder.decode([TaskItem].self, from: data)
        } catch {
            print("Error fetching tasks: \(error.localizedDescription)")
        }
    }
    
    func createTask(title: String, description: String? = nil, listName: String = "Personal", projectId: UUID? = nil, dueDate: Date? = nil, appleReminderId: String? = nil) async {
        let newTask = TaskItem(
            id: UUID(),
            projectId: projectId,
            title: title,
            description: description,
            listName: listName,
            status: "pending",
            dueDate: dueDate,
            source: "ios",
            appleReminderId: appleReminderId,
            createdAt: Date()
        )
        
        // Optimistic UI update
        self.tasks.insert(newTask, at: 0)
        
        guard AppConfig.isSupabaseConfigured,
              let url = URL(string: "\(AppConfig.supabaseURL)/rest/v1/tasks") else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(AppConfig.supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(AppConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("return=representation", forHTTPHeaderField: "Prefer")
        
        do {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            request.httpBody = try encoder.encode(newTask)
            _ = try await URLSession.shared.data(for: request)
        } catch {
            print("Error saving task to Supabase: \(error.localizedDescription)")
        }
    }
    
    func toggleTaskCompletion(task: TaskItem) async {
        guard let index = tasks.firstIndex(where: { $0.id == task.id }) else { return }
        tasks[index].isCompleted.toggle()
        
        let newStatus = tasks[index].status
        
        guard AppConfig.isSupabaseConfigured,
              let url = URL(string: "\(AppConfig.supabaseURL)/rest/v1/tasks?id=eq.\(task.id)") else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue(AppConfig.supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(AppConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body = ["status": newStatus]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        
        _ = try? await URLSession.shared.data(for: request)
    }
    
    // MARK: - Ideas
    func fetchIdeas() async {
        guard let url = URL(string: "\(AppConfig.supabaseURL)/rest/v1/ideas?select=*&order=created_at.desc") else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(AppConfig.supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(AppConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
                return
            }
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            self.ideas = try decoder.decode([Idea].self, from: data)
        } catch {
            print("Error fetching ideas: \(error.localizedDescription)")
        }
    }
    
    func createIdea(projectId: UUID?, rawTranscript: String, summary: String, tags: [String] = []) async {
        let newIdea = Idea(
            id: UUID(),
            projectId: projectId,
            rawTranscript: rawTranscript,
            summary: summary,
            tags: tags,
            createdAt: Date()
        )
        
        self.ideas.insert(newIdea, at: 0)
        
        guard AppConfig.isSupabaseConfigured,
              let url = URL(string: "\(AppConfig.supabaseURL)/rest/v1/ideas") else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(AppConfig.supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(AppConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        do {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            request.httpBody = try encoder.encode(newIdea)
            _ = try await URLSession.shared.data(for: request)
        } catch {
            print("Error saving idea to Supabase: \(error.localizedDescription)")
        }
    }
}
