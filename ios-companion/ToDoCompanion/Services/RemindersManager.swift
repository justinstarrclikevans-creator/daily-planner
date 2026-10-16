import Foundation
import EventKit

@MainActor
class RemindersManager: ObservableObject {
    static let shared = RemindersManager()
    
    private let eventStore = EKEventStore()
    @Published var isAuthorized: Bool = false
    
    private init() {
        checkAuthorization()
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
}
