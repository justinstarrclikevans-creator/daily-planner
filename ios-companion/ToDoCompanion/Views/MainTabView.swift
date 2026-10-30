import SwiftUI

struct MainTabView: View {
    @State private var selectedTab: Int = 0
    
    var body: some View {
        TabView(selection: $selectedTab) {
            ProjectsHubView()
                .tabItem {
                    Label("Projects", systemImage: "folder.fill")
                }
                .tag(0)
            
            ProcessesView(isEmbeddedTab: true)
                .tabItem {
                    Label("Processes", systemImage: "arrow.triangle.2.circlepath.circle.fill")
                }
                .tag(1)
        }
        .tint(.indigo)
    }
}
