import SwiftUI

struct ProjectsHubView: View {
    @ObservedObject private var supabase = SupabaseService.shared
    @State private var showVoiceSheet: Bool = false
    @State private var showSettings: Bool = false
    
    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottomTrailing) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        // Header
                        headerSection
                        
                        // Active Projects Grid
                        projectsSection
                        
                        // Recent Cross-Device Tasks
                        recentTasksSection
                    }
                    .padding()
                    .padding(.bottom, 80) // Padding for floating mic button
                }
                .refreshable {
                    await supabase.fetchAll()
                }
                
                // Floating Voice Mic Button
                floatingMicButton
            }
            .navigationTitle("Projects Hub")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                            .foregroundColor(.secondary)
                    }
                }
            }
            .sheet(isPresented: $showVoiceSheet) {
                VoiceSheetView()
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
        }
    }
    
    // MARK: - Header
    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(greetingText)
                .font(.title2)
                .fontWeight(.bold)
            
            HStack(spacing: 8) {
                Circle()
                    .fill(AppConfig.isSupabaseConfigured ? Color.green : Color.orange)
                    .frame(width: 8, height: 8)
                
                Text(AppConfig.isSupabaseConfigured ? "Live Sync Active" : "Local Mode (Add Supabase keys in Settings)")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.top, 4)
    }
    
    private var greetingText: String {
        let hour = Calendar.current.component(.hour, from: Date())
        if hour < 12 { return "Good morning, Justin" }
        if hour < 17 { return "Good afternoon, Justin" }
        return "Good evening, Justin"
    }
    
    // MARK: - Projects Section
    private var projectsSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Active Focus Areas")
                .font(.headline)
                .foregroundColor(.primary)
            
            LazyVStack(spacing: 14) {
                ForEach(supabase.projects) { project in
                    NavigationLink(destination: ProjectDetailView(project: project)) {
                        ProjectCardView(
                            project: project,
                            tasks: supabase.tasks,
                            ideas: supabase.ideas
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
    
    // MARK: - Recent Tasks Section
    private var recentTasksSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Recent Action Items")
                    .font(.headline)
                Spacer()
                Text("\(supabase.tasks.filter { !$0.isCompleted }.count) open")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            if supabase.tasks.isEmpty {
                Text("No pending tasks. Tap the mic to brain-dump!")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .padding(.vertical, 12)
            } else {
                VStack(spacing: 8) {
                    ForEach(supabase.tasks.prefix(6)) { task in
                        TaskRowView(task: task) {
                            Task {
                                await supabase.toggleTaskCompletion(task: task)
                            }
                        }
                        Divider()
                    }
                }
                .padding()
                .background(Color(.secondarySystemBackground))
                .cornerRadius(16)
            }
        }
    }
    
    // MARK: - Floating Mic Button
    private var floatingMicButton: some View {
        Button {
            showVoiceSheet = true
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "mic.fill")
                    .font(.title2)
                Text("Brain Dump")
                    .fontWeight(.semibold)
            }
            .foregroundColor(.white)
            .padding(.horizontal, 20)
            .padding(.vertical, 14)
            .background(
                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [.indigo, .purple],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .shadow(color: Color.indigo.opacity(0.4), radius: 10, x: 0, y: 5)
            )
        }
        .padding(.trailing, 20)
        .padding(.bottom, 20)
    }
}

// MARK: - Settings View
struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage("supabase_url") private var supabaseURL = ""
    @AppStorage("supabase_anon_key") private var supabaseAnonKey = ""
    @AppStorage("gemini_api_key") private var geminiKey = "AQ.Ab8RN6IcCg0ZHzgemvtrQ-8oyseoCX5QSMOxKBT_aCyMXrHd6w"
    
    var body: some View {
        NavigationStack {
            Form {
                Section("Supabase Cloud Sync") {
                    TextField("Project URL", text: $supabaseURL)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                    
                    SecureField("Anon Public Key", text: $supabaseAnonKey)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                }
                
                Section("Gemini AI API") {
                    SecureField("Gemini API Key", text: $geminiKey)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                }
                
                Section("About") {
                    Text("ToDo Companion v1.0")
                        .foregroundColor(.secondary)
                    Text("Syncs with Mac Desktop Daemon, Apple Reminders, and Supabase.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Save") {
                        Task {
                            await SupabaseService.shared.fetchAll()
                        }
                        dismiss()
                    }
                }
            }
        }
    }
}
