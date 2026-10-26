import SwiftUI

struct MainTabView: View {
    @State private var selectedTab: Int = 0
    
    var body: some View {
        TabView(selection: $selectedTab) {
            AssistantHomeView()
                .tabItem {
                    Label("Assistant", systemImage: "sparkles")
                }
                .tag(0)
            
            ProjectsHubView()
                .tabItem {
                    Label("Projects", systemImage: "folder.fill")
                }
                .tag(1)
            
            RoutineLibrarySheetView(isEmbeddedTab: true)
                .tabItem {
                    Label("Processes", systemImage: "arrow.triangle.2.circlepath.circle.fill")
                }
                .tag(2)
            
            RemindersListView()
                .tabItem {
                    Label("Reminders", systemImage: "checklist")
                }
                .tag(3)
        }
        .tint(.indigo)
    }
}
