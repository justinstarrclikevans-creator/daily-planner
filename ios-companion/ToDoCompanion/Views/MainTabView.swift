import SwiftUI

struct MainTabView: View {
    @State private var selectedTab: Int = 0
    
    var body: some View {
        TabView(selection: $selectedTab) {
            HomeCardStacksView()
                .tabItem {
                    Label("Cards", systemImage: "square.stack.3d.up.fill")
                }
                .tag(0)
            
            AssistantHomeView()
                .tabItem {
                    Label("Assistant", systemImage: "sparkles")
                }
                .tag(1)
            
            ProjectsHubView()
                .tabItem {
                    Label("Projects", systemImage: "folder.fill")
                }
                .tag(2)
            
            RoutineLibrarySheetView(isEmbeddedTab: true)
                .tabItem {
                    Label("Processes", systemImage: "arrow.triangle.2.circlepath.circle.fill")
                }
                .tag(3)
            
            RemindersListView()
                .tabItem {
                    Label("Reminders", systemImage: "checklist")
                }
                .tag(4)
        }
        .tint(.indigo)
    }
}
