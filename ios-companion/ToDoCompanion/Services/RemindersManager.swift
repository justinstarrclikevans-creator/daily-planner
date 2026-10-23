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
    
    func addReminder(title: String, notes: String? = nil, listName: String = "Personal", dueDate: Date? = nil) async throws -> String? {
        if !isAuthorized {
            let granted = await requestAccess()
            guard granted else { return nil }
        }
        
        let calendars = eventStore.calendars(for: .reminder)
        var targetCalendar = calendars.first { $0.title.caseInsensitiveCompare(listName) == .orderedSame }
        
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
            let calendarComponent = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: dueDate)
            reminder.dueDateComponents = calendarComponent
        }
        
        try eventStore.save(reminder, commit: true)
        return reminder.calendarItemIdentifier
    }
    
    func fetchIncompleteReminders() async -> [EKReminder] {
        if !isAuthorized {
            let granted = await requestAccess()
            guard granted else { return [] }
        }
        
        let predicate = eventStore.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
        
        return await withCheckedContinuation { continuation in
            eventStore.fetchReminders(matching: predicate) { reminders in
                continuation.resume(returning: reminders ?? [])
            }
        }
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
        
        await syncReminderListsToProjects()
        let reminders = await fetchIncompleteReminders()
        let activeReminderIds = Set(reminders.map { $0.calendarItemIdentifier })
        
        for r in reminders {
            guard let title = r.title, !title.isEmpty else { continue }
            let listName = r.calendar?.title ?? "Personal"
            let reminderId = r.calendarItemIdentifier
            let dueDate = r.dueDateComponents?.date
            
            let matchedProject = SupabaseService.shared.projects.first { p in
                p.name.caseInsensitiveCompare(listName) == .orderedSame
            }
            
            if let index = SupabaseService.shared.tasks.firstIndex(where: {
                $0.appleReminderId == reminderId || ($0.appleReminderId == nil && $0.title == title && $0.listName == listName)
            }) {
                var current = SupabaseService.shared.tasks[index]
                current.appleReminderId = reminderId
                current.title = title
                current.listName = listName
                if let due = dueDate { current.dueDate = due }
                if let notes = r.notes, !notes.isEmpty {
                    current.description = notes
                    if let firstFive = TaskItem.extractFirstFive(from: notes) {
                        current.firstFiveMinutesPrompt = firstFive
                    }
                    let subtasks = TaskItem.extractSubtasks(from: notes)
                    if !subtasks.isEmpty {
                        current.subtasks = subtasks
                    }
                }
                SupabaseService.shared.tasks[index] = current
            } else {
                await SupabaseService.shared.createTask(
                    title: title,
                    description: r.notes,
                    listName: listName,
                    projectId: matchedProject?.id,
                    dueDate: dueDate,
                    appleReminderId: reminderId
                )
            }
        }
        
        // Mark tasks as completed in app if completed in Apple Reminders
        for (idx, task) in SupabaseService.shared.tasks.enumerated() {
            if let rId = task.appleReminderId, !activeReminderIds.contains(rId), !task.isCompleted {
                SupabaseService.shared.tasks[idx].isCompleted = true
            }
        }
        
        SupabaseService.shared.persistLocalTasks()
    }
    
    func importDeviceRemindersToSupabase() async {
        await syncDeviceReminders()
    }
}

