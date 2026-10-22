import Foundation
import UserNotifications

class NotificationService: NSObject, ObservableObject {
    static let shared = NotificationService()
    
    @Published var isAuthorized: Bool = false
    
    private let halfwayId = "focus_timer_halfway"
    private let completeId = "focus_timer_complete"
    
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
}
