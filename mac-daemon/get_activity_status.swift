import EventKit
import Foundation

let store = EKEventStore()

store.requestAccess(to: .reminder) { (granted, error) in
    guard granted else {
        print("{\"lastAppOpened\":0,\"lastTaskCompleted\":0,\"openCount\":0}")
        exit(0)
    }
    
    let pred = store.predicateForReminders(in: nil)
    store.fetchReminders(matching: pred) { reminders in
        guard let reminders = reminders else {
            print("{\"lastAppOpened\":0,\"lastTaskCompleted\":0,\"openCount\":0}")
            exit(0)
        }
        
        var lastAppOpened: Double = 0
        var lastTaskCompleted: Double = 0
        var openCount = 0
        
        for r in reminders {
            let modTime = (r.lastModifiedDate?.timeIntervalSince1970 ?? 0) * 1000.0
            if r.title == "[App Heartbeat]" {
                if modTime > lastAppOpened {
                    lastAppOpened = modTime
                }
                continue
            }
            if r.isCompleted {
                let compTime = (r.completionDate?.timeIntervalSince1970 ?? (r.lastModifiedDate?.timeIntervalSince1970 ?? 0)) * 1000.0
                if compTime > lastTaskCompleted {
                    lastTaskCompleted = compTime
                }
            } else {
                openCount += 1
                // Any modification to an active task also indicates app activity
                if modTime > lastAppOpened {
                    lastAppOpened = modTime
                }
            }
        }
        
        let out: [String: Any] = [
            "lastAppOpened": Int64(lastAppOpened),
            "lastTaskCompleted": Int64(lastTaskCompleted),
            "openCount": openCount
        ]
        if let data = try? JSONSerialization.data(withJSONObject: out),
           let str = String(data: data, encoding: .utf8) {
            print(str)
        }
        exit(0)
    }
}

dispatchMain()
