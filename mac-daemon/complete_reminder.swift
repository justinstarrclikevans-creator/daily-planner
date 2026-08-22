import EventKit
import Foundation

let store = EKEventStore()
let id = CommandLine.arguments[1]

let group = DispatchGroup()
group.enter()

store.requestAccess(to: .reminder) { (granted, error) in
    if granted {
        if let reminder = store.calendarItem(withIdentifier: id) as? EKReminder {
            reminder.isCompleted = true
            do {
                try store.save(reminder, commit: true)
                print("{\"success\": true}")
            } catch {
                print("{\"success\": false, \"error\": \"\(error.localizedDescription)\"}")
            }
        } else {
            print("{\"success\": false, \"error\": \"Not found\"}")
        }
    } else {
        print("{\"success\": false, \"error\": \"No permission\"}")
    }
    exit(0)
}

dispatchMain()
