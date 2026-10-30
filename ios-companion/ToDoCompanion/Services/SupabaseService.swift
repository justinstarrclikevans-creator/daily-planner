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
    
    private let customProjectsKey = "saved_custom_projects_v6_clean"
    private let customTasksKey = "saved_custom_tasks_v6_clean"
    private let customRoutinesKey = "saved_do_it_again_v6_clean"
    
    private init() {
        loadLocalProjects()
        loadLocalTasks()
        loadLocalRoutines()
        Task {
            await fetchAll()
        }
    }
    
    func loadLocalRoutines() {
        if let data = UserDefaults.standard.data(forKey: customRoutinesKey),
           let saved = try? JSONDecoder().decode([Routine].self, from: data),
           !saved.isEmpty {
            var combined = Routine.defaults
            for r in saved {
                if !combined.contains(where: { $0.id == r.id || $0.title.caseInsensitiveCompare(r.title) == .orderedSame }) {
                    combined.insert(r, at: 0)
                }
            }
            self.routines = combined
        } else {
            self.routines = Routine.defaults
        }
    }
    
    func persistLocalRoutines() {
        if let data = try? JSONEncoder().encode(self.routines) {
            UserDefaults.standard.set(data, forKey: customRoutinesKey)
        }
    }
    
    func loadLocalTasks() {
        if let data = UserDefaults.standard.data(forKey: customTasksKey),
           let saved = try? JSONDecoder().decode([TaskItem].self, from: data) {
            self.tasks = saved
        }
    }
    
    func persistLocalTasks() {
        if let data = try? JSONEncoder().encode(self.tasks) {
            UserDefaults.standard.set(data, forKey: customTasksKey)
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
        scheduleRule: ProjectScheduleRule = .always,
        customStartMinutes: Int? = nil,
        customEndMinutes: Int? = nil,
        customActiveDays: [Int]? = nil
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
            customStartMinutes: customStartMinutes,
            customEndMinutes: customEndMinutes,
            customActiveDays: customActiveDays,
            createdAt: Date()
        )
        
        // 1. Memory update & local persistence
        self.projects.append(newProject)
        UserDefaults.standard.set(scheduleRule.rawValue, forKey: "project_schedule_\(newProject.id.uuidString)")
        if let start = customStartMinutes {
            UserDefaults.standard.set(start, forKey: "project_custom_start_\(newProject.id.uuidString)")
        }
        if let end = customEndMinutes {
            UserDefaults.standard.set(end, forKey: "project_custom_end_\(newProject.id.uuidString)")
        }
        if let days = customActiveDays {
            UserDefaults.standard.set(days, forKey: "project_custom_days_\(newProject.id.uuidString)")
        }
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
        UserDefaults.standard.removeObject(forKey: "project_custom_start_\(projectId.uuidString)")
        UserDefaults.standard.removeObject(forKey: "project_custom_end_\(projectId.uuidString)")
        UserDefaults.standard.removeObject(forKey: "project_custom_days_\(projectId.uuidString)")
        
        // 3. Supabase delete if configured
        guard AppConfig.isSupabaseConfigured,
              let url = URL(string: "\(AppConfig.supabaseURL)/rest/v1/projects?id=eq.\(projectId.uuidString)") else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue(AppConfig.supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(AppConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        _ = try? await URLSession.shared.data(for: request)
    }
    
    func updateProjectPlaybook(
        projectId: UUID,
        instructions: String,
        scheduleRule: ProjectScheduleRule,
        customStartMinutes: Int? = nil,
        customEndMinutes: Int? = nil,
        customActiveDays: [Int]? = nil
    ) async {
        // 1. Save locally immediately
        UserDefaults.standard.set(instructions, forKey: "project_instructions_\(projectId.uuidString)")
        UserDefaults.standard.set(scheduleRule.rawValue, forKey: "project_schedule_\(projectId.uuidString)")
        if let start = customStartMinutes {
            UserDefaults.standard.set(start, forKey: "project_custom_start_\(projectId.uuidString)")
        }
        if let end = customEndMinutes {
            UserDefaults.standard.set(end, forKey: "project_custom_end_\(projectId.uuidString)")
        }
        if let days = customActiveDays {
            UserDefaults.standard.set(days, forKey: "project_custom_days_\(projectId.uuidString)")
        }
        
        // 2. Update memory model
        if let idx = projects.firstIndex(where: { $0.id == projectId }) {
            projects[idx].instructions = instructions
            projects[idx].scheduleRule = scheduleRule
            if let start = customStartMinutes {
                projects[idx].customStartMinutes = start
            }
            if let end = customEndMinutes {
                projects[idx].customEndMinutes = end
            }
            if let days = customActiveDays {
                projects[idx].customActiveDays = days
            }
        }
        objectWillChange.send()
        persistCustomProjects()
        
        // 3. Sync to Supabase if configured
        guard AppConfig.isSupabaseConfigured,
              let url = URL(string: "\(AppConfig.supabaseURL)/rest/v1/projects?id=eq.\(projectId.uuidString)") else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue(AppConfig.supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(AppConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        var body: [String: Any] = [
            "instructions": instructions,
            "schedule_rule": scheduleRule.rawValue
        ]
        if let start = customStartMinutes {
            body["custom_start_minutes"] = start
        }
        if let end = customEndMinutes {
            body["custom_end_minutes"] = end
        }
        if let days = customActiveDays {
            body["custom_active_days"] = days
        }
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
            let fetched = try decoder.decode([TaskItem].self, from: data)
            if !fetched.isEmpty {
                self.tasks = fetched
                persistLocalTasks()
            }
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
        estimatedMinutes: Int? = 5,
        priority: String = "medium",
        inPlayQueue: Bool = false,
        firstFiveMinutes: String? = nil,
        subtasks: [SubtaskItem] = []
    ) async {
        let effectiveMinutes = estimatedMinutes ?? TaskItem.extractEstimatedMinutes(from: description ?? "") ?? 5
        let finalDescription = TaskItem.buildDescription(
            cleanNotes: description ?? "",
            estimatedMinutes: effectiveMinutes,
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
            estimatedMinutes: effectiveMinutes,
            priority: priority,
            actualSeconds: 0,
            inPlayQueue: inPlayQueue,
            firstFiveMinutesPrompt: firstFiveMinutes,
            subtasks: subtasks
        )
        
        // Optimistic UI update & local persistence
        self.tasks.insert(newTask, at: 0)
        persistLocalTasks()
        
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
    
    func markTaskCompleted(task: TaskItem) async {
        guard let index = tasks.firstIndex(where: { $0.id == task.id }) else { return }
        tasks[index].isCompleted = true
        let updated = tasks[index]
        persistLocalTasks()
        
        NotificationService.shared.resetTaskCompletionInactivityTimer()
        if let reminderId = updated.appleReminderId {
            _ = await RemindersManager.shared.completeReminder(identifier: reminderId)
        }
        
        await updateTask(updated)
    }
    
    func toggleSubtask(task: TaskItem, subtaskId: UUID) async {
        guard let taskIndex = tasks.firstIndex(where: { $0.id == task.id }) else { return }
        var current = tasks[taskIndex]
        guard let subIndex = current.subtasks.firstIndex(where: { $0.id == subtaskId }) else { return }
        current.subtasks[subIndex].isCompleted.toggle()
        
        let newDesc = TaskItem.buildDescription(
            cleanNotes: current.cleanDescription,
            estimatedMinutes: current.estimatedMinutes,
            inPlayQueue: current.inPlayQueue,
            firstFiveMinutes: current.firstFiveMinutesPrompt,
            subtasks: current.subtasks
        )
        current.description = newDesc
        tasks[taskIndex] = current
        persistLocalTasks()
        await updateTask(current)
    }
    
    func toggleTaskCompletion(task: TaskItem) async {
        guard let index = tasks.firstIndex(where: { $0.id == task.id }) else { return }
        tasks[index].isCompleted.toggle()
        let updated = tasks[index]
        persistLocalTasks()
        
        // Also mark complete in Apple Reminders on device
        if updated.isCompleted {
            NotificationService.shared.resetTaskCompletionInactivityTimer()
            if let reminderId = updated.appleReminderId {
                _ = await RemindersManager.shared.completeReminder(identifier: reminderId)
            }
        }
        
        await updateTask(updated)
    }
    
    func updateTask(_ updatedTask: TaskItem) async {
        if let index = tasks.firstIndex(where: { $0.id == updatedTask.id }) {
            tasks[index] = updatedTask
            persistLocalTasks()
        }
        
        // Sync updated title, subtasks (in notes), dueDate, and listName back to Apple Reminders
        await RemindersManager.shared.updateReminder(from: updatedTask)
        
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
    
    func moveTask(_ task: TaskItem, toProjectNamed targetListName: String) async {
        guard let index = tasks.firstIndex(where: { $0.id == task.id }) else { return }
        var copy = tasks[index]
        copy.listName = targetListName
        let matchedProject = projects.first { p in
            p.name.caseInsensitiveCompare(targetListName) == .orderedSame
        }
        copy.projectId = matchedProject?.id
        await updateTask(copy)
    }
    
    func togglePlayQueue(for task: TaskItem) async {
        guard let index = tasks.firstIndex(where: { $0.id == task.id }) else { return }
        var copy = tasks[index]
        copy.updateMetadata(inPlayQueue: !copy.inPlayQueue)
        await updateTask(copy)
    }
    
    func deferTaskToLater(task: TaskItem) async {
        guard let index = tasks.firstIndex(where: { $0.id == task.id }) else { return }
        var copy = tasks[index]
        let calendar = Calendar.current
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: Date())) ?? Date().addingTimeInterval(86400)
        let tomorrowNineAM = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: tomorrow) ?? tomorrow
        copy.dueDate = tomorrowNineAM
        await updateTask(copy)
    }
    
    func bumpTaskToTomorrow(task: TaskItem) async {
        await deferTaskToLater(task: task)
    }
    
    func updateTaskPriority(task: TaskItem, priority: String) async {
        guard let index = tasks.firstIndex(where: { $0.id == task.id }) else { return }
        var copy = tasks[index]
        copy.priority = priority
        await updateTask(copy)
    }
    
    func createProjectFromTask(task: TaskItem, name: String, color: String, icon: String, keywords: [String]) async {
        let slug = name.lowercased()
            .replacingOccurrences(of: " ", with: "-")
            .filter { $0.isLetter || $0.isNumber || $0 == "-" }
        let newProj = Project(
            id: UUID(),
            name: name,
            slug: slug,
            color: color,
            icon: icon,
            goal: "Dedicated focus on \(name)",
            keywords: keywords
        )
        self.projects.append(newProj)
        persistCustomProjects()
        
        await moveTask(task, toProjectNamed: name)
        
        guard AppConfig.isSupabaseConfigured,
              let url = URL(string: "\(AppConfig.supabaseURL)/rest/v1/projects") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(AppConfig.supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(AppConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        do {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            request.httpBody = try encoder.encode(newProj)
            _ = try await URLSession.shared.data(for: request)
        } catch {
            print("Error creating project in Supabase: \(error)")
        }
    }
    
    // MARK: - "Do it again" (Repeatable Tasks & Subtasks)
    func fetchRoutines() async {
        loadLocalRoutines()
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
                for r in fetched {
                    if !self.routines.contains(where: { $0.id == r.id || $0.title.caseInsensitiveCompare(r.title) == .orderedSame }) {
                        self.routines.append(r)
                    }
                }
                persistLocalRoutines()
            }
        } catch {
            print("Note: Using local Do It Again routines: \(error.localizedDescription)")
        }
    }
    
    func saveTaskToDoItAgain(_ task: TaskItem) {
        let matchedProject = projects.first { p in
            p.name.caseInsensitiveCompare(task.listName) == .orderedSame
        }
        let steps = task.subtasks.map { SubtaskItem in
            RoutineItemStep(title: SubtaskItem.title, estimatedMinutes: 5)
        }
        let newRoutine = Routine(
            id: UUID(),
            projectId: matchedProject?.id ?? task.projectId,
            defaultListName: task.listName,
            title: task.title,
            description: task.cleanDescription,
            color: matchedProject?.color ?? "#6366F1",
            icon: matchedProject?.icon ?? "arrow.triangle.2.circlepath.circle.fill",
            items: steps,
            createdAt: Date()
        )
        
        if let existingIdx = routines.firstIndex(where: { $0.title.caseInsensitiveCompare(task.title) == .orderedSame }) {
            routines[existingIdx] = newRoutine
        } else {
            routines.insert(newRoutine, at: 0)
        }
        persistLocalRoutines()
    }
    
    func deleteRoutine(_ routine: Routine) {
        routines.removeAll { $0.id == routine.id }
        persistLocalRoutines()
    }
    
    func addDoItAgainToReminders(routine: Routine, projectName: String, scheduledDate: Date? = nil) async {
        let matchedProject = projects.first { p in
            p.name.caseInsensitiveCompare(projectName) == .orderedSame
        }
        let subtasks = routine.items.map { step in
            SubtaskItem(title: step.title, isCompleted: false)
        }
        let serializedNotes = TaskItem.buildDescription(
            cleanNotes: routine.description,
            estimatedMinutes: 5,
            inPlayQueue: scheduledDate == nil,
            subtasks: subtasks
        )
        let reminderId = try? await RemindersManager.shared.addReminder(
            title: routine.title,
            notes: serializedNotes,
            listName: projectName,
            dueDate: scheduledDate
        )
        await createTask(
            title: routine.title,
            description: routine.description,
            listName: projectName,
            projectId: matchedProject?.id,
            dueDate: scheduledDate,
            appleReminderId: reminderId,
            estimatedMinutes: 5,
            inPlayQueue: scheduledDate == nil,
            subtasks: subtasks
        )
    }
    
    func createRoutine(title: String, description: String = "", color: String = "#6366F1", icon: String = "sparkles", items: [RoutineItemStep], projectId: UUID? = nil, defaultListName: String = "General") async {
        let newRoutine = Routine(
            id: UUID(),
            projectId: projectId,
            defaultListName: defaultListName,
            title: title,
            description: description,
            color: color,
            icon: icon,
            items: items,
            createdAt: Date()
        )
        self.routines.insert(newRoutine, at: 0)
        persistLocalRoutines()
    }
    
    func insertRoutineIntoQueue(routine: Routine) async {
        await addDoItAgainToReminders(routine: routine, projectName: routine.defaultListName, scheduledDate: nil)
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
