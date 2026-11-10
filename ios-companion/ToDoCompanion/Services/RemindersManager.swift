import Foundation
import EventKit

@MainActor
class RemindersManager: ObservableObject {
    static let shared = RemindersManager()
    
    private let eventStore = EKEventStore()
    @Published var isAuthorized: Bool = false
    
    private init() {
        checkAuthorization()
        setupEventStoreObserver()
    }
    
    private func setupEventStoreObserver() {
        NotificationCenter.default.addObserver(
            forName: .EKEventStoreChanged,
            object: eventStore,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                print("Detected Apple Reminders database change. Auto-syncing...")
                await self?.syncDeviceReminders()
            }
        }
    }
    
    func checkAuthorization() {
        let status = EKEventStore.authorizationStatus(for: .reminder)
        isAuthorized = (status == .fullAccess || status == .authorized)
    }
    
    func requestAccess() async -> Bool {
        do {
            if #available(iOS 17.0, *) {
                let granted = try await eventStore.requestFullAccessToReminders()
                self.isAuthorized = granted
                return granted
            } else {
                let granted = try await eventStore.requestAccess(to: .reminder)
                self.isAuthorized = granted
                return granted
            }
        } catch {
            print("Failed to request Reminders access: \(error)")
            return false
        }
    }
    
    func createReminderList(named name: String) async -> Bool {
        if !isAuthorized {
            let granted = await requestAccess()
            guard granted else { return false }
        }
        
        let existing = eventStore.calendars(for: .reminder)
        if existing.contains(where: { $0.title.caseInsensitiveCompare(name) == .orderedSame }) {
            return true
        }
        
        let newCal = EKCalendar(for: .reminder, eventStore: eventStore)
        newCal.title = name
        newCal.source = eventStore.defaultCalendarForNewReminders()?.source ?? eventStore.sources.first
        
        do {
            try eventStore.saveCalendar(newCal, commit: true)
            return true
        } catch {
            print("Failed to create reminder list \(name): \(error)")
            return false
        }
    }
    
    func addReminder(title: String, notes: String? = nil, listName: String = "General", dueDate: Date? = nil) async throws -> String? {
        if !isAuthorized {
            let granted = await requestAccess()
            guard granted else { return nil }
        }
        
        let calendars = eventStore.calendars(for: .reminder)
        var targetCalendar = calendars.first { $0.title.caseInsensitiveCompare(listName) == .orderedSame }
        
        if targetCalendar == nil {
            _ = await createReminderList(named: listName)
            let updatedCalendars = eventStore.calendars(for: .reminder)
            targetCalendar = updatedCalendars.first { $0.title.caseInsensitiveCompare(listName) == .orderedSame }
        }
        
        // Fall back to default calendar if specific list doesn't exist
        if targetCalendar == nil {
            targetCalendar = eventStore.defaultCalendarForNewReminders()
        }
        
        guard let calendar = targetCalendar else {
            throw NSError(domain: "RemindersManager", code: 404, userInfo: [NSLocalizedDescriptionKey: "No reminders list found"])
        }
        
        let reminder = EKReminder(eventStore: eventStore)
        reminder.title = title
        reminder.notes = notes
        reminder.calendar = calendar
        
        if let dueDate = dueDate {
            let comps = Calendar.current.dateComponents([.hour, .minute], from: dueDate)
            let hasExplicitTime = (comps.hour ?? 0) != 0 || (comps.minute ?? 0) != 0
            if hasExplicitTime {
                reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: dueDate)
            } else {
                reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day], from: dueDate)
            }
        }
        
        try eventStore.save(reminder, commit: true)
        return reminder.calendarItemIdentifier
    }
    
    func updateReminder(from task: TaskItem) async {
        if !isAuthorized {
            let granted = await requestAccess()
            guard granted else { return }
        }
        
        var targetReminder: EKReminder? = nil
        if let rId = task.appleReminderId {
            targetReminder = eventStore.calendarItem(withIdentifier: rId) as? EKReminder
        }
        
        if targetReminder == nil {
            let incomplete = await fetchIncompleteReminders()
            targetReminder = incomplete.first(where: {
                ($0.title ?? "").caseInsensitiveCompare(task.title) == .orderedSame
            })
        }
        
        if let reminder = targetReminder {
            reminder.title = task.title
            reminder.notes = task.description
            reminder.isCompleted = task.isCompleted
            if task.isCompleted {
                if reminder.completionDate == nil {
                    reminder.completionDate = Date()
                }
            } else {
                reminder.completionDate = nil
            }
            if let dueDate = task.dueDate {
                if task.isTimeboxed {
                    reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: dueDate)
                } else {
                    reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day], from: dueDate)
                }
            } else {
                reminder.dueDateComponents = nil
            }
            
            // Sync priority (1 = High, 5 = Medium, 9 = Low)
            if task.priority.lowercased() == "high" {
                reminder.priority = 1
            } else if task.priority.lowercased() == "low" {
                reminder.priority = 9
            } else {
                reminder.priority = 5
            }
            
            // Move between lists in Apple Reminders if listName changed
            if reminder.calendar?.title.caseInsensitiveCompare(task.listName) != .orderedSame {
                _ = await createReminderList(named: task.listName)
                let calendars = eventStore.calendars(for: .reminder)
                if let newCal = calendars.first(where: { $0.title.caseInsensitiveCompare(task.listName) == .orderedSame }) {
                    reminder.calendar = newCal
                }
            }
            
            do {
                try eventStore.save(reminder, commit: true)
            } catch {
                print("Failed to update EKReminder: \(error)")
            }
        } else if !task.isCompleted {
            if let newId = try? await addReminder(
                title: task.title,
                notes: task.description,
                listName: task.listName,
                dueDate: task.dueDate
            ) {
                if let idx = SupabaseService.shared.tasks.firstIndex(where: { $0.id == task.id }) {
                    SupabaseService.shared.tasks[idx].appleReminderId = newId
                    SupabaseService.shared.persistLocalTasks()
                }
            }
        }
    }
    
    func recordAppOpenedHeartbeat() async {
        if !isAuthorized {
            let granted = await requestAccess()
            guard granted else { return }
        }
        let predicate = eventStore.predicateForReminders(in: nil)
        let allReminders: [EKReminder] = await withCheckedContinuation { continuation in
            eventStore.fetchReminders(matching: predicate) { reminders in
                continuation.resume(returning: reminders ?? [])
            }
        }
        if let heartbeat = allReminders.first(where: { $0.title == "[App Heartbeat]" }) {
            heartbeat.isCompleted = true
            heartbeat.notes = "Last opened: \(ISO8601DateFormatter().string(from: Date()))"
            try? eventStore.save(heartbeat, commit: true)
        } else if let defaultCal = eventStore.defaultCalendarForNewReminders() {
            let heartbeat = EKReminder(eventStore: eventStore)
            heartbeat.title = "[App Heartbeat]"
            heartbeat.calendar = defaultCal
            heartbeat.isCompleted = true
            heartbeat.completionDate = Date()
            heartbeat.notes = "Last opened: \(ISO8601DateFormatter().string(from: Date()))"
            try? eventStore.save(heartbeat, commit: true)
        }
    }
    
    func fetchIncompleteReminders() async -> [EKReminder] {
        if !isAuthorized {
            let granted = await requestAccess()
            guard granted else { return [] }
        }
        
        let predicate = eventStore.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
        
        return await withCheckedContinuation { continuation in
            eventStore.fetchReminders(matching: predicate) { reminders in
                let filtered = (reminders ?? []).filter { $0.title != "[App Heartbeat]" }
                continuation.resume(returning: filtered)
            }
        }
    }
    
    func fetchRecentCompletedReminders(days: Int = 30) async -> [EKReminder] {
        if !isAuthorized {
            let granted = await requestAccess()
            guard granted else { return [] }
        }
        
        let startDate = Calendar.current.date(byAdding: .day, value: -days, to: Date()) ?? Date().addingTimeInterval(-30 * 86400)
        let predicate = eventStore.predicateForCompletedReminders(withCompletionDateStarting: startDate, ending: Date(), calendars: nil)
        
        return await withCheckedContinuation { continuation in
            eventStore.fetchReminders(matching: predicate) { reminders in
                let filtered = (reminders ?? []).filter { $0.title != "[App Heartbeat]" }
                continuation.resume(returning: filtered)
            }
        }
    }
    
    private let deprecatedListNames: Set<String> = [
        "first shift", "football", "football / 843", "albertine initiative", "reentry nav", "843"
    ]
    
    func migrateToNewPDFStructureIfNeeded() async {
        // Consolidated single-list ("General") architecture:
        // Never wipe user's live iCloud reminders; just ensure the "General" list exists.
        guard isAuthorized else { return }
        _ = await createReminderList(named: "General")
    }
    
    func syncReminderListsToProjects() async {
        if !isAuthorized {
            let granted = await requestAccess()
            guard granted else { return }
        }
        
        let calendars = eventStore.calendars(for: .reminder)
        for cal in calendars {
            let name = cal.title.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty else { continue }
            if deprecatedListNames.contains(name.lowercased()) { continue }
            
            let exists = SupabaseService.shared.projects.contains { p in
                p.name.caseInsensitiveCompare(name) == .orderedSame ||
                p.slug.caseInsensitiveCompare(name) == .orderedSame
            }
            
            if !exists {
                let slug = name.lowercased()
                    .replacingOccurrences(of: " ", with: "-")
                    .replacingOccurrences(of: "[^a-z0-9-]", with: "", options: .regularExpression)
                _ = await SupabaseService.shared.createProject(
                    name: name,
                    slug: slug.isEmpty ? "project-\(Int.random(in: 100...999))" : slug,
                    color: "#3B82F6",
                    icon: "folder.fill",
                    goal: "Imported from Apple Reminders list",
                    scheduleRule: .always
                )
            }
        }
    }
    
    func completeReminder(identifier: String) async -> Bool {
        if !isAuthorized {
            let granted = await requestAccess()
            guard granted else { return false }
        }
        guard let item = eventStore.calendarItem(withIdentifier: identifier) as? EKReminder else {
            return false
        }
        item.isCompleted = true
        item.completionDate = Date()
        do {
            try eventStore.save(item, commit: true)
            return true
        } catch {
            print("Failed to complete EKReminder on device: \(error)")
            return false
        }
    }
    
    func syncDeviceReminders() async {
        if !isAuthorized {
            _ = await requestAccess()
        }
        guard isAuthorized else { return }
        
        await migrateToNewPDFStructureIfNeeded()
        await syncReminderListsToProjects()
        let reminders = await fetchIncompleteReminders()
        let completedReminders = await fetchRecentCompletedReminders(days: 30)
        let activeReminderIds = Set(reminders.map { $0.calendarItemIdentifier })
        
        // Remove local tasks belonging to deprecated lists
        SupabaseService.shared.tasks.removeAll { task in
            deprecatedListNames.contains(task.listName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
        }
        
        // 1. Mark tasks as completed in app if completed in Apple Reminders
        for comp in completedReminders {
            guard let title = comp.title, !title.isEmpty, title != "[App Heartbeat]" else { continue }
            let compId = comp.calendarItemIdentifier
            let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
            if let index = SupabaseService.shared.tasks.firstIndex(where: {
                $0.appleReminderId == compId || ($0.appleReminderId == nil && $0.title.caseInsensitiveCompare(cleanTitle) == .orderedSame)
            }) {
                if !SupabaseService.shared.tasks[index].isCompleted {
                    SupabaseService.shared.tasks[index].isCompleted = true
                    SupabaseService.shared.tasks[index].appleReminderId = compId
                }
            }
        }
        
        // 2. Mark tasks as completed in app if completed/removed in Apple Reminders
        for (idx, task) in SupabaseService.shared.tasks.enumerated() {
            if let rId = task.appleReminderId, !activeReminderIds.contains(rId), !task.isCompleted {
                SupabaseService.shared.tasks[idx].isCompleted = true
            }
        }
        
        // Build set of all completed task titles to prevent resurrection
        let completedTitles = Set(
            SupabaseService.shared.tasks.filter { $0.isCompleted }.map { $0.title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            + completedReminders.compactMap { $0.title?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        )
        
        for r in reminders {
            guard let title = r.title, !title.isEmpty, title != "[App Heartbeat]" else { continue }
            let listName = r.calendar?.title ?? "General"
            if deprecatedListNames.contains(listName.lowercased()) { continue }
            let reminderId = r.calendarItemIdentifier
            var dueDate: Date? = nil
            if let comps = r.dueDateComponents, let parsedDate = Calendar.current.date(from: comps) {
                if comps.hour == nil {
                    dueDate = Calendar.current.startOfDay(for: parsedDate)
                } else {
                    dueDate = parsedDate
                }
            }
            let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
            let cleanTitleLower = cleanTitle.lowercased()
            
            let matchedProject = SupabaseService.shared.projects.first { p in
                p.name.caseInsensitiveCompare(listName) == .orderedSame
            }
            
            if let index = SupabaseService.shared.tasks.firstIndex(where: {
                $0.appleReminderId == reminderId || ($0.appleReminderId == nil && $0.title == title && $0.listName.caseInsensitiveCompare(listName) == .orderedSame)
            }) {
                // If user already completed this task in the companion app, DO NOT resurrect it as incomplete!
                if SupabaseService.shared.tasks[index].isCompleted {
                    _ = await completeReminder(identifier: reminderId)
                    continue
                }
                
                var current = SupabaseService.shared.tasks[index]
                current.appleReminderId = reminderId
                current.title = title
                current.listName = listName
                current.projectId = matchedProject?.id
                current.dueDate = dueDate
                
                // Resolve priority from reminder priority or notes
                if r.priority >= 1 && r.priority <= 4 {
                    current.priority = "high"
                } else if r.priority >= 6 && r.priority <= 9 {
                    current.priority = "low"
                } else if let notes = r.notes?.lowercased(), notes.contains("[🔥 high]") || notes.contains("priority: high") {
                    current.priority = "high"
                } else if let notes = r.notes?.lowercased(), notes.contains("[🌱 low]") || notes.contains("priority: low") {
                    current.priority = "low"
                }
                
                if let notes = r.notes, !notes.isEmpty {
                    current.description = notes
                    if let mins = TaskItem.extractEstimatedMinutes(from: notes) {
                        current.estimatedMinutes = mins
                    } else if current.estimatedMinutes <= 0 {
                        current.estimatedMinutes = 5
                    }
                    let subtasks = TaskItem.extractSubtasks(from: notes)
                    if !subtasks.isEmpty {
                        current.subtasks = subtasks
                    }
                } else if current.estimatedMinutes <= 0 {
                    current.estimatedMinutes = 5
                }
                
                let hashtags = TaskItem.extractHashtags(from: title) + TaskItem.extractHashtags(from: r.notes ?? "")
                if !hashtags.isEmpty {
                    current.tags = Array(Set(current.tags + hashtags))
                }
                
                SupabaseService.shared.tasks[index] = current
            } else {
                // If this reminder matches a completed task, complete it in EventKit and DO NOT create a new pending task
                if completedTitles.contains(cleanTitleLower) {
                    _ = await completeReminder(identifier: reminderId)
                    continue
                }
                
                var prio = "medium"
                if r.priority >= 1 && r.priority <= 4 {
                    prio = "high"
                } else if r.priority >= 6 && r.priority <= 9 {
                    prio = "low"
                } else if let notes = r.notes?.lowercased(), notes.contains("[🔥 high]") || notes.contains("priority: high") {
                    prio = "high"
                } else if let notes = r.notes?.lowercased(), notes.contains("[🌱 low]") || notes.contains("priority: low") {
                    prio = "low"
                }
                
                let mins = TaskItem.extractEstimatedMinutes(from: r.notes ?? "") ?? 5
                let parsedSubtasks = TaskItem.extractSubtasks(from: r.notes ?? "")
                let hashtags = TaskItem.extractHashtags(from: title) + TaskItem.extractHashtags(from: r.notes ?? "")
                
                await SupabaseService.shared.createTask(
                    title: title,
                    description: r.notes,
                    listName: listName,
                    projectId: matchedProject?.id,
                    dueDate: dueDate,
                    appleReminderId: reminderId,
                    estimatedMinutes: mins,
                    priority: prio,
                    subtasks: parsedSubtasks,
                    tags: hashtags
                )
            }
        }
        
        SupabaseService.shared.persistLocalTasks()
    }
    
    func importDeviceRemindersToSupabase() async {
        await syncDeviceReminders()
    }
}

