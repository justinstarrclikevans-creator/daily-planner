import EventKit
import Foundation

let store = EKEventStore()

store.requestAccess(to: .reminder) { (granted, error) in
    if granted {
        let predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
        store.fetchReminders(matching: predicate) { reminders in
            guard let reminders = reminders else {
                print("[]")
                exit(0)
            }
            var result: [[String: Any]] = []
            for r in reminders {
                result.append([
                    "id": r.calendarItemIdentifier,
                    "name": r.title ?? "",
                    "body": r.notes ?? "",
                    "dueDate": r.dueDateComponents?.date?.description ?? NSNull(),
                    "listName": r.calendar?.title ?? ""
                ])
            }
            if let jsonData = try? JSONSerialization.data(withJSONObject: result, options: []),
               let jsonString = String(data: jsonData, encoding: .utf8) {
                print(jsonString)
            }
            exit(0)
        }
    } else {
        print("[]")
        exit(1)
    }
}

RunLoop.main.run()
