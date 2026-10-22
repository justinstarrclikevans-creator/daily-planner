import Foundation
import Combine

@MainActor
class SupabaseService: ObservableObject {
    static let shared = SupabaseService()
    
    @Published var projects: [Project] = Project.defaults
    @Published var tasks: [TaskItem] = []
    @Published var ideas: [Idea] = []
    @Published var routines: [Routine] = Routine.defaults
    @Published var isLoading: Bool = false
    @Published var errorMessage: String? = nil
    
    private let customProjectsKey = "saved_custom_projects_v1"
    
    private init() {
        loadLocalProjects()
        Task {
            await fetchAll()
        }
    }
    
    private func loadLocalProjects() {
        if let data = UserDefaults.standard.data(forKey: customProjectsKey),
           let saved = try? JSONDecoder().decode([Project].self, from: data),
           !saved.isEmpty {
            var combined = Project.defaults
            for p in saved {
                if !combined.contains(where: { $0.id == p.id }) {
                    combined.append(p)
                }
            }
            self.projects = combined
        } else {
            self.projects = Project.defaults
        }
    }
    
    private func persistCustomProjects() {
        let customOnly = projects.filter { p in
            !Project.defaults.contains(where: { $0.id == p.id })
        }
        if let data = try? JSONEncoder().encode(customOnly) {
            UserDefaults.standard.set(data, forKey: customProjectsKey)
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
        await fetchRoutines()
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
                var merged = fetched
                // Keep any custom local projects
                for p in self.projects {
                    if !merged.contains(where: { $0.id == p.id }) {
                        merged.append(p)
                    }
                }
                self.projects = merged
            }
        } catch {
            print("Error fetching projects: \(error.localizedDescription)")
        }
    }
    
    func createProject(
        name: String,
        slug: String,
        color: String,
        icon: String,
        goal: String,
        instructions: String? = nil,
        scheduleRule: ProjectScheduleRule = .always
    ) async -> Project {
        let newProject = Project(
            id: UUID(),
            name: name,
            slug: slug,
            color: color,
            icon: icon,
            goal: goal,
            instructions: instructions,
            scheduleRule: scheduleRule,
            createdAt: Date()
        )
        
        // 1. Memory update & local persistence
        self.projects.append(newProject)
        UserDefaults.standard.set(scheduleRule.rawValue, forKey: "project_schedule_\(newProject.id.uuidString)")
        if let inst = instructions, !inst.isEmpty {
            UserDefaults.standard.set(inst, forKey: "project_instructions_\(newProject.id.uuidString)")
        }
        persistCustomProjects()
        
        // 2. Sync to Supabase if configured
        if AppConfig.isSupabaseConfigured,
           let url = URL(string: "\(AppConfig.supabaseURL)/rest/v1/projects") {
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue(AppConfig.supabaseAnonKey, forHTTPHeaderField: "apikey")
            request.setValue("Bearer \(AppConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            request.httpBody = try? encoder.encode(newProject)
            _ = try? await URLSession.shared.data(for: request)
        }
        
        return newProject
    }
    
    func deleteProject(projectId: UUID) async {
        // 1. Remove from memory
        self.projects.removeAll(where: { $0.id == projectId })
        persistCustomProjects()
        
        // 2. Clear UserDefaults keys
        UserDefaults.standard.removeObject(forKey: "project_instructions_\(projectId.uuidString)")
        UserDefaults.standard.removeObject(forKey: "project_schedule_\(projectId.uuidString)")
        
        // 3. Supabase delete if configured
        guard AppConfig.isSupabaseConfigured,
              let url = URL(string: "\(AppConfig.supabaseURL)/rest/v1/projects?id=eq.\(projectId.uuidString)") else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue(AppConfig.supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(AppConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        _ = try? await URLSession.shared.data(for: request)
    }
    
    func updateProjectPlaybook(projectId: UUID, instructions: String, scheduleRule: ProjectScheduleRule) async {
        // 1. Save locally immediately
        UserDefaults.standard.set(instructions, forKey: "project_instructions_\(projectId.uuidString)")
        UserDefaults.standard.set(scheduleRule.rawValue, forKey: "project_schedule_\(projectId.uuidString)")
        
        // 2. Update memory model
        if let idx = projects.firstIndex(where: { $0.id == projectId }) {
            projects[idx].instructions = instructions
            projects[idx].scheduleRule = scheduleRule
        }
        persistCustomProjects()
        
        // 3. Sync to Supabase if configured
        guard AppConfig.isSupabaseConfigured,
              let url = URL(string: "\(AppConfig.supabaseURL)/rest/v1/projects?id=eq.\(projectId.uuidString)") else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue(AppConfig.supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(AppConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = [
            "instructions": instructions,
            "schedule_rule": scheduleRule.rawValue
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        _ = try? await URLSession.shared.data(for: request)
    }
    
    func updateProjectInstructions(projectId: UUID, instructions: String) async {
        let currentSchedule = projects.first(where: { $0.id == projectId })?.effectiveScheduleRule ?? .always
        await updateProjectPlaybook(projectId: projectId, instructions: instructions, scheduleRule: currentSchedule)
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
    
    func createTask(
        title: String,
        description: String? = nil,
        listName: String = "Personal",
        projectId: UUID? = nil,
        dueDate: Date? = nil,
        appleReminderId: String? = nil,
        estimatedMinutes: Int? = nil,
        inPlayQueue: Bool = false,
        firstFiveMinutes: String? = nil,
        subtasks: [SubtaskItem] = []
    ) async {
        let finalDescription = TaskItem.buildDescription(
            cleanNotes: description ?? "",
            estimatedMinutes: estimatedMinutes,
            inPlayQueue: inPlayQueue,
            firstFiveMinutes: firstFiveMinutes,
            subtasks: subtasks
        )
        
        let newTask = TaskItem(
            id: UUID(),
            projectId: projectId,
            title: title,
            description: finalDescription,
            listName: listName,
            status: "pending",
            dueDate: dueDate,
            source: "ios",
            appleReminderId: appleReminderId,
            createdAt: Date(),
            estimatedMinutes: estimatedMinutes,
            actualSeconds: 0,
            inPlayQueue: inPlayQueue,
            firstFiveMinutesPrompt: firstFiveMinutes,
            subtasks: subtasks
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
        let updated = tasks[index]
        await updateTask(updated)
    }
    
    func updateTask(_ updatedTask: TaskItem) async {
        if let index = tasks.firstIndex(where: { $0.id == updatedTask.id }) {
            tasks[index] = updatedTask
        }
        
        guard AppConfig.isSupabaseConfigured,
              let url = URL(string: "\(AppConfig.supabaseURL)/rest/v1/tasks?id=eq.\(updatedTask.id)") else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue(AppConfig.supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(AppConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        do {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            request.httpBody = try encoder.encode(updatedTask)
            _ = try await URLSession.shared.data(for: request)
        } catch {
            print("Error updating task in Supabase: \(error.localizedDescription)")
        }
    }
    
    func togglePlayQueue(for task: TaskItem) async {
        guard let index = tasks.firstIndex(where: { $0.id == task.id }) else { return }
        var copy = tasks[index]
        copy.updateMetadata(inPlayQueue: !copy.inPlayQueue)
        await updateTask(copy)
    }
    
    func bumpTaskToTomorrow(task: TaskItem) async {
        guard let index = tasks.firstIndex(where: { $0.id == task.id }) else { return }
        var copy = tasks[index]
        let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: Date())
        copy.dueDate = tomorrow
        // Keep in play queue or softly defer based on user routine
        await updateTask(copy)
    }
    
    // MARK: - Routines (Tiimo-Style Modular Bundles)
    func fetchRoutines() async {
        guard let url = URL(string: "\(AppConfig.supabaseURL)/rest/v1/routines?select=*&order=created_at.asc") else { return }
        
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
            let fetched = try decoder.decode([Routine].self, from: data)
            if !fetched.isEmpty {
                self.routines = fetched
            }
        } catch {
            print("Note: Using local default routines: \(error.localizedDescription)")
        }
    }
    
    func createRoutine(title: String, description: String = "", color: String = "#6366F1", icon: String = "sparkles", items: [RoutineItemStep], projectId: UUID? = nil) async {
        let newRoutine = Routine(
            id: UUID(),
            projectId: projectId,
            title: title,
            description: description,
            color: color,
            icon: icon,
            items: items,
            createdAt: Date()
        )
        self.routines.append(newRoutine)
        
        guard AppConfig.isSupabaseConfigured,
              let url = URL(string: "\(AppConfig.supabaseURL)/rest/v1/routines") else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(AppConfig.supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(AppConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        do {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            request.httpBody = try encoder.encode(newRoutine)
            _ = try await URLSession.shared.data(for: request)
        } catch {
            print("Error creating routine in Supabase: \(error.localizedDescription)")
        }
    }
    
    func insertRoutineIntoQueue(routine: Routine) async {
        // Determine target list by title or projectId
        let targetList: String
        let titleLower = routine.title.lowercased()
        if titleLower.contains("first shift") {
            targetList = "First shift"
        } else if titleLower.contains("football") || titleLower.contains("843") {
            targetList = "Football"
        } else {
            targetList = "Personal"
        }
        
        for step in routine.items {
            let reminderId = try? await RemindersManager.shared.addReminder(
                title: step.title,
                notes: TaskItem.buildDescription(
                    cleanNotes: "",
                    estimatedMinutes: step.estimatedMinutes,
                    inPlayQueue: true,
                    firstFiveMinutes: step.firstFiveMinutes,
                    subtasks: []
                ),
                listName: targetList
            )
            
            await createTask(
                title: step.title,
                description: "",
                listName: targetList,
                projectId: routine.projectId,
                dueDate: Date(),
                appleReminderId: reminderId,
                estimatedMinutes: step.estimatedMinutes,
                inPlayQueue: true,
                firstFiveMinutes: step.firstFiveMinutes,
                subtasks: []
            )
        }
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
