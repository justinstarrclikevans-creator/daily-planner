import EventKit
import Foundation

let store = EKEventStore()

let args = CommandLine.arguments
let fetchAll = args.contains("--all")
let fetchCompletedOnly = args.contains("--completed")

store.requestAccess(to: .reminder) { (granted, error) in
    guard granted else {
        print("[]")
        exit(1)
    }
    
    var allResults: [[String: Any]] = []
    let formatter = ISO8601DateFormatter()
    let dispatchGroup = DispatchGroup()
    
    // 1. Incomplete reminders (unless --completed was explicitly requested)
    if !fetchCompletedOnly {
        dispatchGroup.enter()
        let incompletePredicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
        store.fetchReminders(matching: incompletePredicate) { reminders in
            if let reminders = reminders {
                for r in reminders {
                    if r.title == "[App Heartbeat]" { continue }
                    let updatedStr = r.lastModifiedDate != nil ? formatter.string(from: r.lastModifiedDate!) : formatter.string(from: Date())
                    var dueDateStr = ""
                    if let due = r.dueDateComponents, let date = Calendar.current.date(from: due) {
                        dueDateStr = formatter.string(from: date)
                    }
                    
                    allResults.append([
                        "id": r.calendarItemIdentifier,
                        "name": r.title ?? "",
                        "body": r.notes ?? "",
                        "listName": r.calendar?.title ?? "",
                        "updated": updatedStr,
                        "dueDate": dueDateStr,
                        "isCompleted": false,
                        "completionDate": ""
                    ])
                }
            }
            dispatchGroup.leave()
        }
    }
    
    // 2. Completed reminders (when --completed or --all is requested)
    if fetchAll || fetchCompletedOnly {
        dispatchGroup.enter()
        let sixtyDaysAgo = Calendar.current.date(byAdding: .day, value: -60, to: Date()) ?? Date().addingTimeInterval(-60 * 86400)
        let completedPredicate = store.predicateForCompletedReminders(withCompletionDateStarting: sixtyDaysAgo, ending: Date(), calendars: nil)
        store.fetchReminders(matching: completedPredicate) { reminders in
            if let reminders = reminders {
                for r in reminders {
                    if r.title == "[App Heartbeat]" { continue }
                    let updatedStr = r.lastModifiedDate != nil ? formatter.string(from: r.lastModifiedDate!) : formatter.string(from: Date())
                    var dueDateStr = ""
                    if let due = r.dueDateComponents, let date = Calendar.current.date(from: due) {
                        dueDateStr = formatter.string(from: date)
                    }
                    var completionDateStr = ""
                    if let comp = r.completionDate {
                        completionDateStr = formatter.string(from: comp)
                    }
                    
                    allResults.append([
                        "id": r.calendarItemIdentifier,
                        "name": r.title ?? "",
                        "body": r.notes ?? "",
                        "listName": r.calendar?.title ?? "",
                        "updated": updatedStr,
                        "dueDate": dueDateStr,
                        "isCompleted": true,
                        "completionDate": completionDateStr
                    ])
                }
            }
            dispatchGroup.leave()
        }
    }
    
    dispatchGroup.notify(queue: .main) {
        if let jsonData = try? JSONSerialization.data(withJSONObject: allResults, options: []),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            print(jsonString)
        } else {
            print("[]")
        }
        exit(0)
    }
}

dispatchMain()
