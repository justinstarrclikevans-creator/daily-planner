import Foundation
import UserNotifications

class NotificationService: NSObject, ObservableObject {
    static let shared = NotificationService()
    
    @Published var isAuthorized: Bool = false
    
    private let halfwayId = "focus_timer_halfway"
    private let completeId = "focus_timer_complete"
    private let appInactive1HrId = "angry_app_inactive_1hr"
    private let appInactive2HrId = "angry_app_inactive_2hr"
    private let taskInactive1HrId = "angry_task_inactive_1hr"
    
    private override init() {
        super.init()
        checkAuthorization()
    }
    
    func checkAuthorization() {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            DispatchQueue.main.async {
                self.isAuthorized = (settings.authorizationStatus == .authorized)
            }
        }
    }
    
    func requestAuthorization() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            DispatchQueue.main.async {
                self.isAuthorized = granted
            }
            if let error = error {
                print("Notification permission error: \(error.localizedDescription)")
            }
        }
    }
    
    /// Schedules Tiimo-style multi-stage notifications: Halfway alert + Completion alert
    func scheduleFocusTimerNotifications(taskTitle: String, totalSeconds: Int) {
        cancelFocusNotifications()
        
        guard totalSeconds >= 60 else { return }
        
        let center = UNUserNotificationCenter.current()
        
        // 1. Halfway Transition Nudge
        let halfwaySecs = max(30, totalSeconds / 2)
        let halfwayContent = UNMutableNotificationContent()
        halfwayContent.title = "⏱ Halfway Checkpoint"
        halfwayContent.body = "Halfway through \"\(taskTitle)\". Keep your momentum going!"
        halfwayContent.sound = .default
        
        let halfwayTrigger = UNTimeIntervalNotificationTrigger(timeInterval: TimeInterval(halfwaySecs), repeats: false)
        let halfwayRequest = UNNotificationRequest(identifier: halfwayId, content: halfwayContent, trigger: halfwayTrigger)
        
        center.add(halfwayRequest) { error in
            if let error = error {
                print("Error scheduling halfway notification: \(error.localizedDescription)")
            }
        }
        
        // 2. Completion Notification
        let completeContent = UNMutableNotificationContent()
        completeContent.title = "🎉 Focus Session Finished"
        completeContent.body = "Time's up for \"\(taskTitle)\"! Take a breath and mark it done or extend time."
        completeContent.sound = .default
        
        let completeTrigger = UNTimeIntervalNotificationTrigger(timeInterval: TimeInterval(totalSeconds), repeats: false)
        let completeRequest = UNNotificationRequest(identifier: completeId, content: completeContent, trigger: completeTrigger)
        
        center.add(completeRequest) { error in
            if let error = error {
                print("Error scheduling completion notification: \(error.localizedDescription)")
            }
        }
    }
    
    func cancelFocusNotifications() {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [halfwayId, completeId])
    }
    
    /// Resets the 1-hour angry notification timer whenever the user opens the app.
    func scheduleOneHourAppInactivityAngryNotification() {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [appInactive1HrId, appInactive2HrId])
        
        let content1 = UNMutableNotificationContent()
        content1.title = "😡 Where Are You?!"
        content1.body = "You haven't opened the app in an hour! Stop stalling—that's a failure of nerve. Open your list and knock out a 5m task right now!"
        content1.sound = .default
        
        let trigger1 = UNTimeIntervalNotificationTrigger(timeInterval: 3600, repeats: false)
        let req1 = UNNotificationRequest(identifier: appInactive1HrId, content: content1, trigger: trigger1)
        center.add(req1, withCompletionHandler: nil)
        
        let content2 = UNMutableNotificationContent()
        content2.title = "🔥 2 Hours With Zero Action"
        content2.body = "Still dodging your tasks?! Open ToDo Companion NOW and finish one item before you do anything else."
        content2.sound = .default
        
        let trigger2 = UNTimeIntervalNotificationTrigger(timeInterval: 7200, repeats: false)
        let req2 = UNNotificationRequest(identifier: appInactive2HrId, content: content2, trigger: trigger2)
        center.add(req2, withCompletionHandler: nil)
    }
    
    /// Resets the 1-hour angry notification timer for task completions.
    func resetTaskCompletionInactivityTimer() {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [taskInactive1HrId])
        
        let content = UNMutableNotificationContent()
        content.title = "⚠️ Zero Tasks Completed in 1 Hour"
        content.body = "You haven't checked off a single task in over an hour! Stop hesitating, pick a 5-minute task, and finish it right now."
        content.sound = .default
        
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 3600, repeats: false)
        let req = UNNotificationRequest(identifier: taskInactive1HrId, content: content, trigger: trigger)
        center.add(req, withCompletionHandler: nil)
    }
}
