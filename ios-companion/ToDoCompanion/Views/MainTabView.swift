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
            
            RemindersListView()
                .tabItem {
                    Label("Reminders", systemImage: "checklist")
                }
                .tag(2)
        }
        .tint(.indigo)
    }
}
