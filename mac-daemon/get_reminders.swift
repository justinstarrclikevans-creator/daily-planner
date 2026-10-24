import EventKit
import Foundation

let store = EKEventStore()

let group = DispatchGroup()
group.enter()

store.requestAccess(to: .reminder) { (granted, error) in
    if granted {
        let predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
        store.fetchReminders(matching: predicate) { reminders in
            guard let reminders = reminders else {
                print("[]")
                exit(0)
            }
            var result: [[String: Any]] = []
            let formatter = ISO8601DateFormatter()
            for r in reminders {
                if r.title == "[App Heartbeat]" { continue }
                let updatedStr = r.lastModifiedDate != nil ? formatter.string(from: r.lastModifiedDate!) : formatter.string(from: Date())
                var dueDateStr = ""
                if let due = r.dueDateComponents, let date = Calendar.current.date(from: due) {
                    dueDateStr = formatter.string(from: date)
                }
                
                result.append([
                    "id": r.calendarItemIdentifier,
                    "name": r.title ?? "",
                    "body": r.notes ?? "",
                    "listName": r.calendar?.title ?? "",
                    "updated": updatedStr,
                    "dueDate": dueDateStr
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

dispatchMain()
