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
                await self?.importDeviceRemindersToSupabase()
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
    
    func importDeviceRemindersToSupabase() async {
        await syncReminderListsToProjects()
        let reminders = await fetchIncompleteReminders()
        for r in reminders {
            guard let title = r.title, !title.isEmpty else { continue }
            let listName = r.calendar?.title ?? "Personal"
            let reminderId = r.calendarItemIdentifier
            
            let matchedProject = SupabaseService.shared.projects.first { p in
                p.name.caseInsensitiveCompare(listName) == .orderedSame
            }
            
            if !SupabaseService.shared.tasks.contains(where: { $0.appleReminderId == reminderId || $0.title == title }) {
                await SupabaseService.shared.createTask(
                    title: title,
                    description: r.notes,
                    listName: listName,
                    projectId: matchedProject?.id,
                    appleReminderId: reminderId
                )
            }
        }
    }
}

