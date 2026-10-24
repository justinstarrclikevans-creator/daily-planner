import SwiftUI

@main
struct ToDoCompanionApp: App {
    @Environment(\.scenePhase) private var scenePhase
    
    var body: some Scene {
        WindowGroup {
            MainTabView()
                .onChange(of: scenePhase) { _, newPhase in
                    if newPhase == .active {
                        NotificationService.shared.requestAuthorization()
                        NotificationService.shared.scheduleOneHourAppInactivityAngryNotification()
                        NotificationService.shared.resetTaskCompletionInactivityTimer()
                        Task {
                            await RemindersManager.shared.recordAppOpenedHeartbeat()
                        }
                    }
                }
        }
    }
}
