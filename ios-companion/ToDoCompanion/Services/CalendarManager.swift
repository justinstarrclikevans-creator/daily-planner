import Foundation
import EventKit
import Combine

struct CalendarEventItem: Identifiable, Hashable {
    var id: String
    var title: String
    var startDate: Date
    var endDate: Date
    var isAllDay: Bool
    var location: String?
    
    var timeString: String {
        if isAllDay { return "All Day" }
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return "\(formatter.string(from: startDate)) - \(formatter.string(from: endDate))"
    }
}

struct FreeTimeSlot: Identifiable, Hashable {
    var id = UUID()
    var startDate: Date
    var endDate: Date
    var durationMinutes: Int
    
    var label: String {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return "\(formatter.string(from: startDate)) (\(durationMinutes)m free)"
    }
}

@MainActor
class CalendarManager: ObservableObject {
    static let shared = CalendarManager()
    
    private let eventStore = EKEventStore()
    @Published var isAuthorized: Bool = false
    @Published var todaysEvents: [CalendarEventItem] = []
    @Published var tomorrowsEvents: [CalendarEventItem] = []
    
    private init() {
        checkAuthorization()
    }
    
    func checkAuthorization() {
        let status = EKEventStore.authorizationStatus(for: .event)
        isAuthorized = (status == .fullAccess || status == .authorized)
    }
    
    func requestAccess() async -> Bool {
        do {
            if #available(iOS 17.0, *) {
                let granted = try await eventStore.requestFullAccessToEvents()
                self.isAuthorized = granted
                return granted
            } else {
                let granted = try await eventStore.requestAccess(to: .event)
                self.isAuthorized = granted
                return granted
            }
        } catch {
            print("Failed to request Calendar access: \(error)")
            return false
        }
    }
    
    func refreshEvents() async {
        if !isAuthorized {
            _ = await requestAccess()
        }
        guard isAuthorized else { return }
        
        self.todaysEvents = fetchEvents(for: Date())
        if let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: Date()) {
            self.tomorrowsEvents = fetchEvents(for: tomorrow)
        }
    }
    
    func fetchEvents(for date: Date) -> [CalendarEventItem] {
        let cal = Calendar.current
        let startOfDay = cal.startOfDay(for: date)
        guard let endOfDay = cal.date(byAdding: .day, value: 1, to: startOfDay) else { return [] }
        
        let predicate = eventStore.predicateForEvents(withStart: startOfDay, end: endOfDay, calendars: nil)
        let rawEvents = eventStore.events(matching: predicate)
        
        return rawEvents
            .sorted { $0.startDate < $1.startDate }
            .map { ev in
                CalendarEventItem(
                    id: ev.eventIdentifier ?? UUID().uuidString,
                    title: ev.title ?? "Untitled Event",
                    startDate: ev.startDate,
                    endDate: ev.endDate,
                    isAllDay: ev.isAllDay,
                    location: ev.location
                )
            }
    }
    
    /// Finds open gaps of at least `minMinutes` between 8:00 AM and 6:00 PM for a given day.
    func findFreeSlots(for date: Date, minMinutes: Int = 15) -> [FreeTimeSlot] {
        let cal = Calendar.current
        let events = fetchEvents(for: date).filter { !$0.isAllDay }
        
        var dayComponents = cal.dateComponents([.year, .month, .day], from: date)
        dayComponents.hour = 8
        dayComponents.minute = 0
        guard var cursor = cal.date(from: dayComponents) else { return [] }
        
        dayComponents.hour = 18
        dayComponents.minute = 0
        guard let workDayEnd = cal.date(from: dayComponents) else { return [] }
        
        var freeSlots: [FreeTimeSlot] = []
        
        for event in events {
            if event.startDate > cursor {
                let duration = Int(event.startDate.timeIntervalSince(cursor) / 60)
                if duration >= minMinutes {
                    freeSlots.append(FreeTimeSlot(startDate: cursor, endDate: event.startDate, durationMinutes: duration))
                }
            }
            if event.endDate > cursor {
                cursor = event.endDate
            }
        }
        
        if workDayEnd > cursor {
            let duration = Int(workDayEnd.timeIntervalSince(cursor) / 60)
            if duration >= minMinutes {
                freeSlots.append(FreeTimeSlot(startDate: cursor, endDate: workDayEnd, durationMinutes: duration))
            }
        }
        
        return freeSlots
    }
    
    /// Creates a dedicated focus time block on the user's primary Apple Calendar.
    func scheduleFocusBlock(title: String, startDate: Date, durationMinutes: Int, notes: String? = nil) async throws -> Bool {
        if !isAuthorized {
            let granted = await requestAccess()
            guard granted else { return false }
        }
        
        guard let calendar = eventStore.defaultCalendarForNewEvents else {
            throw NSError(domain: "CalendarManager", code: 404, userInfo: [NSLocalizedDescriptionKey: "No default calendar found"])
        }
        
        let event = EKEvent(eventStore: eventStore)
        event.title = title.hasPrefix("[Focus]") ? title : "[Focus] \(title)"
        event.startDate = startDate
        event.endDate = startDate.addingTimeInterval(TimeInterval(durationMinutes * 60))
        event.calendar = calendar
        event.notes = notes ?? "Focus block scheduled by ToDo Companion Assistant."
        
        try eventStore.save(event, span: .thisEvent, commit: true)
        await refreshEvents()
        return true
    }
}
