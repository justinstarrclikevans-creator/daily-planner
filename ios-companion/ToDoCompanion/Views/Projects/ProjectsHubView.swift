import SwiftUI
import EventKit

struct ProjectsHubView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @ObservedObject private var supabase = SupabaseService.shared
    @ObservedObject private var taggingService = TaggingRulesService.shared
    @ObservedObject private var calendarManager = CalendarManager.shared
    
    @AppStorage("selected_space") private var selectedSpace: String = "all"
    @AppStorage("selected_person") private var selectedPerson: String = "anyone"
    @AppStorage("selected_channel") private var selectedChannel: String = "all"
    
    @State private var selectedPhonePane: SunsamaPane = .today
    @State private var showContextGate: Bool = true
    @State private var showVoiceSheet: Bool = false
    @State private var showSettings: Bool = false
    @State private var showBuildMyDay: Bool = false
    @State private var ritualInitialMode: SunsamaRitualMode = .morningPlan
    @State private var showCreateProject: Bool = false
    @State private var showCreateTask: Bool = false
    @State private var suggestedProjectName: String? = nil
    @State private var showAllProjectsOverride: Bool = false
    @State private var isProjectsExpanded: Bool = false
    @State private var isTomorrowExpanded: Bool = true
    @State private var selectedFilter: TaskFilter = .all
    @State private var activeFocusTask: TaskItem? = nil
    @State private var editingPlaybookProject: Project? = nil
    @State private var taskForProjectConversion: TaskItem? = nil
    @State private var autoTimeboxToast: String? = nil
    
    enum SunsamaPane: String, CaseIterable, Identifiable {
        case today = "Today"
        case backlog = "Backlog"
        case timeline = "Timeline"
        case tomorrow = "Tomorrow"
        
        var id: String { rawValue }
    }
    
    enum TaskFilter: String, CaseIterable, Identifiable {
        case all = "All"
        case high = "🔥 High"
        case quickWins = "⚡ ≤15m"
        case deepFocus = "🎯 >15m"
        
        var id: String { rawValue }
    }
    
    private func isTaskVisibleNow(_ task: TaskItem) -> Bool {
        if showAllProjectsOverride { return true }
        if let pid = task.projectId, let proj = supabase.projects.first(where: { $0.id == pid }) {
            return proj.isVisibleNow
        }
        if let proj = supabase.projects.first(where: { $0.name.caseInsensitiveCompare(task.listName) == .orderedSame }) {
            return proj.isVisibleNow
        }
        return true
    }
    
    private var visibleProjects: [Project] {
        if showAllProjectsOverride {
            return supabase.projects
        }
        return supabase.projects.filter { $0.isVisibleNow }
    }
    
    private var hiddenProjectsCount: Int {
        supabase.projects.filter { !$0.isVisibleNow }.count
    }
    
    // Base context-filtered tasks (incomplete)
    private var contextFilteredTasks: [TaskItem] {
        let pool = supabase.tasks.filter { task in
            guard !task.isCompleted else { return false }
            guard isTaskVisibleNow(task) else { return false }
            guard task.matchesSpace(selectedSpace) else { return false }
            guard task.matchesPerson(selectedPerson) else { return false }
            guard task.matchesChannel(selectedChannel) else { return false }
            
            switch selectedFilter {
            case .all:
                return true
            case .high:
                return task.isHighPriority
            case .quickWins:
                return task.estimatedMinutes <= 15
            case .deepFocus:
                return task.estimatedMinutes > 15
            }
        }
        
        return sortTasksSunsamaOrder(pool)
    }
    
    private func sortTasksSunsamaOrder(_ list: [TaskItem]) -> [TaskItem] {
        list.sorted { a, b in
            let prioRank: (TaskItem) -> Int = { t in
                if t.isHighPriority { return 3 }
                if t.isMediumPriority { return 2 }
                return 1
            }
            let rankA = prioRank(a)
            let rankB = prioRank(b)
            if rankA != rankB {
                return rankA > rankB
            }
            if a.isTimeboxed != b.isTimeboxed {
                return a.isTimeboxed && !b.isTimeboxed
            }
            if let dA = a.dueDate, let dB = b.dueDate, dA != dB {
                return dA < dB
            }
            return a.estimatedMinutes < b.estimatedMinutes
        }
    }
    
    private var backlogTasks: [TaskItem] {
        contextFilteredTasks.filter { $0.isBacklog }
    }
    
    private var todayTasks: [TaskItem] {
        contextFilteredTasks.filter { $0.isPlannedForToday }
    }
    
    private var tomorrowTasks: [TaskItem] {
        contextFilteredTasks.filter { $0.isPlannedForTomorrow }
    }
    
    // MARK: - Sunsama Workload Metrics
    private var todayTaskMinutes: Int {
        todayTasks.reduce(0) { $0 + max(5, $1.estimatedMinutes) }
    }
    
    private var todayMeetingMinutes: Int {
        calendarManager.todaysEvents.filter { !$0.isAllDay }.reduce(0) { sum, ev in
            let mins = Int(ev.endDate.timeIntervalSince(ev.startDate) / 60)
            return sum + max(0, mins)
        }
    }
    
    private var totalTodayWorkloadMinutes: Int {
        todayTaskMinutes + todayMeetingMinutes
    }
    
    private let dailyCapacityTargetMinutes: Int = 360 // 6h realistic daily capacity
    
    private func formatDuration(_ mins: Int) -> String {
        let h = mins / 60
        let m = mins % 60
        if h == 0 { return "\(m)m" }
        if m == 0 { return "\(h)h" }
        return "\(h)h \(m)m"
    }
    
    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottomTrailing) {
                VStack(spacing: 0) {
                    if let toast = autoTimeboxToast {
                        HStack(spacing: 8) {
                            Image(systemName: "sparkles")
                                .foregroundColor(.indigo)
                            Text(toast)
                                .font(.caption.bold())
                            Spacer()
                            Button {
                                withAnimation { autoTimeboxToast = nil }
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundColor(.secondary)
                            }
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(Color.indigo.opacity(0.14))
                    }
                    
                    if horizontalSizeClass == .regular {
                        iPadSunsamaSplitWorkspace
                    } else {
                        iPhoneSunsamaAdaptiveWorkspace
                    }
                }
                .background(Color(UIColor.systemGroupedBackground))
                .task {
                    await supabase.fetchAll()
                    await RemindersManager.shared.importDeviceRemindersToSupabase()
                    await calendarManager.fetchUpcomingEvents()
                }
                
                floatingMicButton
            }
            .navigationTitle("Daily Planner")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    HStack(spacing: 8) {
                        Button {
                            ritualInitialMode = .morningPlan
                            showBuildMyDay = true
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "sun.max.fill")
                                    .foregroundColor(.yellow)
                                Text("Plan Day")
                                    .font(.caption.bold())
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(Color.indigo)
                            .foregroundColor(.white)
                            .cornerRadius(10)
                        }
                        
                        Button {
                            ritualInitialMode = .eveningShutdown
                            showBuildMyDay = true
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "moon.stars.fill")
                                    .foregroundColor(.purple)
                                Text("Wrap Up")
                                    .font(.caption.bold())
                            }
                            .padding(.horizontal, 8)
                            .padding(.vertical, 5)
                            .background(Color.purple.opacity(0.14))
                            .foregroundColor(.purple)
                            .cornerRadius(10)
                        }
                    }
                }
                
                ToolbarItem(placement: .navigationBarTrailing) {
                    HStack(spacing: 12) {
                        Button {
                            withAnimation { showContextGate.toggle() }
                        } label: {
                            Image(systemName: (selectedSpace != "all" || selectedPerson != "anyone" || selectedChannel != "all") ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                                .foregroundColor(.indigo)
                        }
                        
                        Menu {
                            Button {
                                showCreateTask = true
                            } label: {
                                Label("New Task", systemImage: "checkmark.circle.badge.plus")
                            }
                            
                            Button {
                                Task {
                                    let count = await supabase.autoTimeboxTodayTasks()
                                    withAnimation {
                                        autoTimeboxToast = count > 0
                                            ? "Auto-timeboxed \(count) Today task\(count == 1 ? "" : "s") around your meetings"
                                            : "All Today tasks are already timeboxed (or no open slots)"
                                    }
                                }
                            } label: {
                                Label("Auto-Timebox Today", systemImage: "calendar.badge.clock")
                            }
                            
                            Button {
                                suggestedProjectName = nil
                                showCreateProject = true
                            } label: {
                                Label("New Project", systemImage: "folder.badge.plus")
                            }
                        } label: {
                            Image(systemName: "plus.circle.fill")
                                .font(.title3)
                                .foregroundColor(.indigo)
                        }
                        
                        Button {
                            Task {
                                await supabase.fetchAll()
                                await RemindersManager.shared.importDeviceRemindersToSupabase()
                                await calendarManager.fetchUpcomingEvents()
                            }
                        } label: {
                            Image(systemName: "arrow.triangle.2.circlepath")
                                .foregroundColor(.indigo)
                        }
                        
                        Button {
                            showSettings = true
                        } label: {
                            Image(systemName: "gearshape")
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }
            .sheet(isPresented: $showBuildMyDay) {
                BuildMyDaySheet(
                    initialSpace: selectedSpace,
                    initialPerson: selectedPerson,
                    initialMode: ritualInitialMode
                )
            }
            .sheet(isPresented: $showVoiceSheet) {
                VoiceSheetView()
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
            .sheet(isPresented: $showCreateProject) {
                CreateProjectSheetView(prefillName: suggestedProjectName ?? "")
            }
            .sheet(isPresented: $showCreateTask) {
                CreateTaskSheetView()
            }
            .sheet(item: $activeFocusTask) { task in
                TaskFocusSheetView(task: binding(for: task))
            }
            .sheet(item: $editingPlaybookProject) { project in
                ProjectPlaybookEditorView(project: project)
            }
            .sheet(item: $taskForProjectConversion) { task in
                ConvertTaskToProjectSheet(task: task)
            }
        }
    }
    
    // MARK: - iPad 3-Pane Sunsama Split Workspace
    private var iPadSunsamaSplitWorkspace: some View {
        VStack(spacing: 10) {
            VStack(spacing: 10) {
                sunsamaWorkloadBar
                if showContextGate {
                    contextGateSection
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)
            
            HStack(alignment: .top, spacing: 14) {
                // Column 1: Unplanned Backlog Drawer (Tasks from Mac Daemon)
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Label("Backlog", systemImage: "tray.full.fill")
                            .font(.headline)
                            .foregroundColor(.secondary)
                        Spacer()
                        Text("\(backlogTasks.count)")
                            .font(.caption.bold())
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Color.secondary.opacity(0.15))
                            .cornerRadius(8)
                    }
                    .padding(.horizontal, 12)
                    .padding(.top, 12)
                    
                    Text("Extracted from Gmail, Slack & Letterly by Mac Daemon. Tap 'Today' to commit.")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 12)
                    
                    ScrollView {
                        LazyVStack(spacing: 8) {
                            if backlogTasks.isEmpty {
                                emptyStateCard(
                                    icon: "tray",
                                    title: "Backlog is clear",
                                    subtitle: "New tasks from Gmail, Slack, and Letterly appear here."
                                )
                            } else {
                                ForEach(backlogTasks) { task in
                                    TaskItemRowView(
                                        task: task,
                                        onConvertToProject: { taskForProjectConversion = task },
                                        onStartSprint: { activeFocusTask = task }
                                    )
                                }
                            }
                        }
                        .padding(12)
                        .padding(.bottom, 70)
                    }
                }
                .frame(maxWidth: .infinity)
                .background(Color(UIColor.secondarySystemGroupedBackground).opacity(0.6))
                .cornerRadius(18)
                
                // Column 2: Today's Plan & Tomorrow Board
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Label("Today's Plan", systemImage: "sun.max.fill")
                            .font(.headline)
                            .foregroundColor(.primary)
                        Spacer()
                        Button {
                            Task {
                                let count = await supabase.autoTimeboxTodayTasks()
                                withAnimation {
                                    autoTimeboxToast = count > 0
                                        ? "Auto-timeboxed \(count) task\(count == 1 ? "" : "s") into open calendar slots"
                                        : "All Today tasks are already timeboxed"
                                }
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "sparkles")
                                Text("Auto-Timebox")
                            }
                            .font(.caption2.bold())
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color.indigo.opacity(0.14))
                            .foregroundColor(.indigo)
                            .cornerRadius(8)
                        }
                        
                        Button {
                            showCreateTask = true
                        } label: {
                            Image(systemName: "plus.circle.fill")
                                .foregroundColor(.indigo)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.top, 12)
                    
                    filterPillsBar
                        .padding(.horizontal, 12)
                    
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 10) {
                            if todayTasks.isEmpty {
                                emptyStateCard(
                                    icon: "sun.max",
                                    title: "No tasks committed to Today yet",
                                    subtitle: "Tap 'Today' on any Backlog task or tap 'Plan Day' to build your lineup."
                                )
                            } else {
                                ForEach(todayTasks) { task in
                                    TaskItemRowView(
                                        task: task,
                                        onConvertToProject: { taskForProjectConversion = task },
                                        onStartSprint: { activeFocusTask = task }
                                    )
                                }
                            }
                            
                            // Tomorrow Section inside center board
                            DisclosureGroup(isExpanded: $isTomorrowExpanded) {
                                LazyVStack(spacing: 8) {
                                    if tomorrowTasks.isEmpty {
                                        Text("No tasks staged for Tomorrow.")
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                            .padding(.vertical, 8)
                                    } else {
                                        ForEach(tomorrowTasks) { task in
                                            TaskItemRowView(
                                                task: task,
                                                onConvertToProject: { taskForProjectConversion = task },
                                                onStartSprint: { activeFocusTask = task }
                                            )
                                        }
                                    }
                                }
                                .padding(.top, 8)
                            } label: {
                                HStack {
                                    Image(systemName: "sunrise.fill")
                                        .foregroundColor(.orange)
                                    Text("Tomorrow (\(tomorrowTasks.count))")
                                        .font(.subheadline.bold())
                                }
                            }
                            .padding(12)
                            .background(Color(UIColor.secondarySystemGroupedBackground))
                            .cornerRadius(14)
                            .padding(.top, 8)
                            
                            projectsCollapsibleSection
                        }
                        .padding(12)
                        .padding(.bottom, 70)
                    }
                }
                .frame(maxWidth: .infinity)
                .background(Color(UIColor.secondarySystemGroupedBackground).opacity(0.6))
                .cornerRadius(18)
                
                // Column 3: Interactive 24-Hour Calendar & Timebox Timeline
                VStack(alignment: .leading, spacing: 10) {
                    sunsamaTimelineColumn
                }
                .frame(maxWidth: .infinity)
                .background(Color(UIColor.secondarySystemGroupedBackground).opacity(0.6))
                .cornerRadius(18)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
    }
    
    // MARK: - iPhone Adaptive Segmented Sunsama Workspace
    private var iPhoneSunsamaAdaptiveWorkspace: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                // Workload Capacity Bar
                sunsamaWorkloadBar
                
                // Collapsible Context Gate (Space, Person, Channel)
                if showContextGate {
                    contextGateSection
                }
                
                // Segmented Pane Switcher (Today | Backlog | Timeline | Tomorrow)
                HStack(spacing: 6) {
                    ForEach(SunsamaPane.allCases) { pane in
                        let badgeCount = countForPane(pane)
                        Button {
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                            withAnimation(.easeInOut(duration: 0.18)) {
                                selectedPhonePane = pane
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Text(pane.rawValue)
                                    .font(.caption.bold())
                                if let count = badgeCount {
                                    Text("\(count)")
                                        .font(.system(size: 10, weight: .bold))
                                        .padding(.horizontal, 5)
                                        .padding(.vertical, 1.5)
                                        .background(selectedPhonePane == pane ? Color.white.opacity(0.25) : Color.secondary.opacity(0.15))
                                        .cornerRadius(6)
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 9)
                            .background(selectedPhonePane == pane ? Color.indigo : Color(UIColor.secondarySystemGroupedBackground))
                            .foregroundColor(selectedPhonePane == pane ? .white : .primary)
                            .cornerRadius(12)
                        }
                        .buttonStyle(.plain)
                    }
                }
                
                switch selectedPhonePane {
                case .today:
                    iPhoneTodayPane
                case .backlog:
                    iPhoneBacklogPane
                case .timeline:
                    sunsamaTimelineColumn
                        .frame(minHeight: 540)
                case .tomorrow:
                    iPhoneTomorrowPane
                }
                
                projectsCollapsibleSection
            }
            .padding(14)
            .padding(.bottom, 80)
        }
        .refreshable {
            await supabase.fetchAll()
            await RemindersManager.shared.importDeviceRemindersToSupabase()
            await calendarManager.fetchUpcomingEvents()
        }
    }
    
    private func countForPane(_ pane: SunsamaPane) -> Int? {
        switch pane {
        case .today: return todayTasks.count
        case .backlog: return backlogTasks.count
        case .timeline: return nil
        case .tomorrow: return tomorrowTasks.count
        }
    }
    
    private var iPhoneTodayPane: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Today's Plan")
                        .font(.headline)
                    Text("\(todayTasks.count) tasks • \(formatDuration(todayTaskMinutes)) focus work")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                Spacer()
                Button {
                    Task {
                        let count = await supabase.autoTimeboxTodayTasks()
                        withAnimation {
                            autoTimeboxToast = count > 0
                                ? "Auto-timeboxed \(count) task\(count == 1 ? "" : "s") around your meetings"
                                : "All Today tasks are already timeboxed"
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "sparkles")
                        Text("Auto-Timebox")
                    }
                    .font(.caption.bold())
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Color.indigo.opacity(0.14))
                    .foregroundColor(.indigo)
                    .cornerRadius(8)
                }
                
                Button {
                    showCreateTask = true
                } label: {
                    Image(systemName: "plus.circle.fill")
                        .font(.title3)
                        .foregroundColor(.indigo)
                }
            }
            
            filterPillsBar
            
            if todayTasks.isEmpty {
                VStack(spacing: 10) {
                    emptyStateCard(
                        icon: "sun.max",
                        title: "Your Today board is empty",
                        subtitle: "Pull tasks from your Backlog (\(backlogTasks.count) waiting) or run your Morning Planning Ritual."
                    )
                    if !backlogTasks.isEmpty {
                        Button {
                            withAnimation { selectedPhonePane = .backlog }
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "tray.full.fill")
                                Text("Browse Backlog (\(backlogTasks.count) Tasks)")
                            }
                            .font(.caption.bold())
                            .foregroundColor(.white)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(Color.indigo)
                            .cornerRadius(12)
                        }
                    }
                }
            } else {
                LazyVStack(spacing: 10) {
                    ForEach(todayTasks) { task in
                        TaskItemRowView(
                            task: task,
                            onConvertToProject: { taskForProjectConversion = task },
                            onStartSprint: { activeFocusTask = task }
                        )
                    }
                }
            }
        }
    }
    
    private var iPhoneBacklogPane: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Unplanned Backlog")
                        .font(.headline)
                    Text("Tasks captured from Gmail, Slack & Letterly without a date. Tap 'Today' to commit.")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                Spacer()
                Button {
                    showCreateTask = true
                } label: {
                    Image(systemName: "plus.circle.fill")
                        .font(.title3)
                        .foregroundColor(.indigo)
                }
            }
            
            filterPillsBar
            
            if backlogTasks.isEmpty {
                emptyStateCard(
                    icon: "tray",
                    title: "Backlog is empty",
                    subtitle: "All captured tasks have been scheduled or completed."
                )
            } else {
                LazyVStack(spacing: 10) {
                    ForEach(backlogTasks) { task in
                        TaskItemRowView(
                            task: task,
                            onConvertToProject: { taskForProjectConversion = task },
                            onStartSprint: { activeFocusTask = task }
                        )
                    }
                }
            }
        }
    }
    
    private var iPhoneTomorrowPane: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Tomorrow's Staging")
                        .font(.headline)
                    Text("Tasks deferred or rolled over for tomorrow")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                Spacer()
            }
            
            if tomorrowTasks.isEmpty {
                emptyStateCard(
                    icon: "sunrise",
                    title: "Nothing staged for Tomorrow",
                    subtitle: "Swipe left on any task or use Evening Wrap Up to roll tasks to Tomorrow."
                )
            } else {
                LazyVStack(spacing: 10) {
                    ForEach(tomorrowTasks) { task in
                        TaskItemRowView(
                            task: task,
                            onConvertToProject: { taskForProjectConversion = task },
                            onStartSprint: { activeFocusTask = task }
                        )
                    }
                }
            }
        }
    }
    
    // MARK: - Sunsama Workload Capacity Bar
    private var sunsamaWorkloadBar: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                HStack(spacing: 6) {
                    Image(systemName: totalTodayWorkloadMinutes > dailyCapacityTargetMinutes ? "exclamationmark.triangle.fill" : "gauge.with.dots.needle.33percent")
                        .foregroundColor(totalTodayWorkloadMinutes > dailyCapacityTargetMinutes ? .red : .indigo)
                        .font(.caption)
                    Text("TODAY'S WORKLOAD:")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.secondary)
                    Text("\(formatDuration(totalTodayWorkloadMinutes)) / 6h target")
                        .font(.caption.bold())
                        .foregroundColor(totalTodayWorkloadMinutes > dailyCapacityTargetMinutes ? .red : .primary)
                }
                
                Spacer()
                
                HStack(spacing: 10) {
                    HStack(spacing: 4) {
                        Circle().fill(Color.blue).frame(width: 6, height: 6)
                        Text("Meetings \(formatDuration(todayMeetingMinutes))")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundColor(.secondary)
                    }
                    HStack(spacing: 4) {
                        Circle().fill(Color.indigo).frame(width: 6, height: 6)
                        Text("Tasks \(formatDuration(todayTaskMinutes))")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundColor(.secondary)
                    }
                }
            }
            
            GeometryReader { geo in
                let maxBar = max(Double(dailyCapacityTargetMinutes), Double(totalTodayWorkloadMinutes), 60.0)
                let meetingWidth = geo.size.width * min(1.0, Double(todayMeetingMinutes) / maxBar)
                let taskWidth = geo.size.width * min(1.0 - (Double(todayMeetingMinutes) / maxBar), Double(todayTaskMinutes) / maxBar)
                
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(Color.secondary.opacity(0.15))
                    HStack(spacing: 0) {
                        Rectangle()
                            .fill(Color.blue.opacity(0.75))
                            .frame(width: max(0, meetingWidth))
                        Rectangle()
                            .fill(totalTodayWorkloadMinutes > dailyCapacityTargetMinutes ? Color.red : Color.indigo)
                            .frame(width: max(0, taskWidth))
                    }
                    .clipShape(Capsule())
                }
            }
            .frame(height: 7)
        }
        .padding(12)
        .background(Color(UIColor.secondarySystemGroupedBackground))
        .cornerRadius(14)
    }
    
    // MARK: - Sunsama Interactive Calendar Timeline (7 AM - 8 PM)
    private var sunsamaTimelineColumn: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Today's Timeline", systemImage: "calendar.day.timeline.left")
                    .font(.headline)
                Spacer()
                Button {
                    Task {
                        let count = await supabase.autoTimeboxTodayTasks()
                        withAnimation {
                            autoTimeboxToast = count > 0
                                ? "Auto-timeboxed \(count) task\(count == 1 ? "" : "s") around your meetings"
                                : "All Today tasks are already timeboxed"
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "sparkles")
                        Text("Auto-Slot")
                    }
                    .font(.caption2.bold())
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.indigo.opacity(0.14))
                    .foregroundColor(.indigo)
                    .cornerRadius(8)
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 12)
            
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(7...20, id: \.self) { hour in
                        timelineHourRow(hour: hour)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 60)
            }
        }
    }
    
    private func timelineHourRow(hour: Int) -> some View {
        let currentHour = Calendar.current.component(.hour, from: Date())
        let isCurrentHour = (currentHour == hour)
        let eventsInHour = calendarManager.todaysEvents.filter { ev in
            guard !ev.isAllDay else { return false }
            let startH = Calendar.current.component(.hour, from: ev.startDate)
            return startH == hour
        }
        let tasksInHour = supabase.tasks.filter { t in
            guard !t.isCompleted, t.isPlannedForToday, t.isTimeboxed, let due = t.dueDate else { return false }
            return Calendar.current.component(.hour, from: due) == hour
        }
        
        return HStack(alignment: .top, spacing: 10) {
            // Left Hour Label
            VStack(alignment: .trailing, spacing: 2) {
                Text(formatTimelineHour(hour))
                    .font(.system(size: 11, weight: isCurrentHour ? .bold : .medium).monospaced())
                    .foregroundColor(isCurrentHour ? .red : .secondary)
                if isCurrentHour {
                    Circle()
                        .fill(Color.red)
                        .frame(width: 6, height: 6)
                }
            }
            .frame(width: 54, alignment: .trailing)
            .padding(.top, 6)
            
            // Right Slot Content
            VStack(alignment: .leading, spacing: 6) {
                Divider()
                    .background(isCurrentHour ? Color.red : Color.secondary.opacity(0.2))
                
                // Calendar Meetings in this hour
                ForEach(eventsInHour) { event in
                    HStack(spacing: 8) {
                        Rectangle()
                            .fill(Color.blue)
                            .frame(width: 3)
                            .cornerRadius(1.5)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(event.title)
                                .font(.caption.bold())
                                .foregroundColor(.primary)
                                .lineLimit(1)
                            Text("\(formatEventTime(event.startDate)) – \(formatEventTime(event.endDate))")
                                .font(.system(size: 10).monospaced())
                                .foregroundColor(.blue)
                        }
                        Spacer()
                        Image(systemName: "video.fill")
                            .font(.caption2)
                            .foregroundColor(.blue)
                    }
                    .padding(8)
                    .background(Color.blue.opacity(0.12))
                    .cornerRadius(8)
                }
                
                // Timeboxed Tasks in this hour
                ForEach(tasksInHour) { task in
                    HStack(spacing: 8) {
                        Button {
                            Task { await supabase.toggleTaskCompletion(task: task) }
                        } label: {
                            Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                                .foregroundColor(.indigo)
                                .font(.caption)
                        }
                        .buttonStyle(.plain)
                        
                        VStack(alignment: .leading, spacing: 2) {
                            Text(task.cleanTitle)
                                .font(.caption.bold())
                                .foregroundColor(.primary)
                                .lineLimit(1)
                            HStack(spacing: 6) {
                                if let tb = task.timeboxString {
                                    Text(tb)
                                        .font(.system(size: 10).monospaced())
                                        .foregroundColor(.indigo)
                                }
                                Text(task.channelTag)
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundColor(.secondary)
                            }
                        }
                        Spacer()
                        Button {
                            activeFocusTask = task
                        } label: {
                            Image(systemName: "play.fill")
                                .font(.system(size: 10))
                                .foregroundColor(.indigo)
                                .padding(6)
                                .background(Color.indigo.opacity(0.15))
                                .clipShape(Circle())
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(8)
                    .background(Color.indigo.opacity(0.12))
                    .cornerRadius(8)
                }
                
                // Quick "+ Slot Task" Menu for any hour
                Menu {
                    let unslottedToday = todayTasks.filter { !$0.isTimeboxed }
                    if !unslottedToday.isEmpty {
                        Section("Un-Timeboxed Today Tasks") {
                            ForEach(unslottedToday) { t in
                                Button {
                                    slotTask(t, atHour: hour)
                                } label: {
                                    Label("\(t.cleanTitle) (\(t.estimatedMinutes)m)", systemImage: "sun.max.fill")
                                }
                            }
                        }
                    }
                    if !backlogTasks.isEmpty {
                        Section("Pull from Backlog & Slot Here") {
                            ForEach(backlogTasks.prefix(10)) { t in
                                Button {
                                    slotTask(t, atHour: hour)
                                } label: {
                                    Label("\(t.cleanTitle) (\(t.estimatedMinutes)m)", systemImage: "tray.full.fill")
                                }
                            }
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "plus")
                            .font(.system(size: 9, weight: .bold))
                        Text(eventsInHour.isEmpty && tasksInHour.isEmpty ? "Slot task at \(formatTimelineHour(hour))" : "Add task")
                            .font(.system(size: 10, weight: .medium))
                    }
                    .foregroundColor(.secondary.opacity(0.75))
                    .padding(.vertical, 4)
                }
                .buttonStyle(.plain)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minHeight: 54)
    }
    
    private func slotTask(_ task: TaskItem, atHour hour: Int) {
        if let date = Calendar.current.date(bySettingHour: hour, minute: 0, second: 0, of: Date()) {
            Task {
                await supabase.timeboxTask(task, at: date, createCalendarEvent: false)
            }
        }
    }
    
    private func formatTimelineHour(_ hour: Int) -> String {
        if hour == 12 { return "12 PM" }
        if hour > 12 { return "\(hour - 12) PM" }
        return "\(hour) AM"
    }
    
    private func formatEventTime(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "h:mm a"
        return f.string(from: date)
    }
    
    // MARK: - Filter Pills Bar
    private var filterPillsBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(TaskFilter.allCases) { filter in
                    Button {
                        selectedFilter = filter
                    } label: {
                        Text(filter.rawValue)
                            .font(.caption2.bold())
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(selectedFilter == filter ? Color.indigo : Color(UIColor.secondarySystemGroupedBackground))
                            .foregroundColor(selectedFilter == filter ? .white : .primary)
                            .cornerRadius(10)
                    }
                }
            }
        }
    }
    
    private func emptyStateCard(icon: String, title: String, subtitle: String) -> some View {
        VStack(spacing: 6) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundColor(.secondary)
            Text(title)
                .font(.subheadline.bold())
                .foregroundColor(.primary)
            Text(subtitle)
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .padding(.horizontal, 12)
        .background(Color(UIColor.secondarySystemGroupedBackground))
        .cornerRadius(14)
    }
    
    // MARK: - ADHD Context Gate Section (Space, Person, Channel)
    private var contextGateSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            // 1. Channel / Project Tag Filter
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    Text("CHANNEL:")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.secondary)
                    
                    contextChip(label: "All", icon: "number", isSelected: selectedChannel == "all") {
                        withAnimation { selectedChannel = "all" }
                    }
                    
                    ForEach(taggingService.rules.projects) { proj in
                        let clean = proj.tag.replacingOccurrences(of: "#", with: "").lowercased()
                        contextChip(
                            label: proj.label,
                            icon: "number",
                            isSelected: selectedChannel.lowercased() == clean
                        ) {
                            withAnimation {
                                selectedChannel = (selectedChannel.lowercased() == clean) ? "all" : clean
                            }
                        }
                    }
                }
            }
            
            // 2. Space Selection
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    Text("SPACE:")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.secondary)
                    
                    contextChip(
                        label: "All Spaces",
                        icon: "globe",
                        isSelected: selectedSpace == "all"
                    ) {
                        withAnimation { selectedSpace = "all" }
                    }
                    
                    ForEach(taggingService.rules.spaces) { space in
                        let clean = space.tag.replacingOccurrences(of: "#", with: "").lowercased()
                        contextChip(
                            label: space.label,
                            icon: spaceIcon(for: clean),
                            isSelected: selectedSpace.lowercased() == clean
                        ) {
                            withAnimation {
                                selectedSpace = (selectedSpace.lowercased() == clean) ? "all" : clean
                            }
                        }
                    }
                }
            }
            
            // 3. Person Selection
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    Text("WITH:")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.secondary)
                    
                    contextChip(
                        label: "Anyone",
                        icon: "person.2",
                        isSelected: selectedPerson == "anyone"
                    ) {
                        withAnimation { selectedPerson = "anyone" }
                    }
                    
                    contextChip(
                        label: "Solo",
                        icon: "person.fill",
                        isSelected: selectedPerson == "solo"
                    ) {
                        withAnimation { selectedPerson = "solo" }
                    }
                    
                    ForEach(taggingService.rules.people) { person in
                        let clean = person.tag.replacingOccurrences(of: "#", with: "").lowercased()
                        contextChip(
                            label: person.label,
                            icon: "person.crop.circle",
                            isSelected: selectedPerson.lowercased() == clean
                        ) {
                            withAnimation {
                                selectedPerson = (selectedPerson.lowercased() == clean) ? "anyone" : clean
                            }
                        }
                    }
                }
            }
        }
        .padding(12)
        .background(Color(UIColor.secondarySystemGroupedBackground))
        .cornerRadius(14)
    }
    
    private func contextChip(label: String, icon: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            action()
        }) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 10))
                Text(label)
                    .font(.system(size: 11, weight: isSelected ? .bold : .medium))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(isSelected ? Color.indigo : Color(UIColor.tertiarySystemGroupedBackground))
            .foregroundColor(isSelected ? .white : .primary)
            .cornerRadius(10)
        }
        .buttonStyle(.plain)
    }
    
    private func spaceIcon(for space: String) -> String {
        switch space.lowercased() {
        case "apricot": return "laptopcomputer"
        case "slack": return "bubble.left.and.bubble.right.fill"
        case "email": return "envelope.fill"
        case "home": return "house.fill"
        default: return "tag.fill"
        }
    }
    
    // MARK: - Collapsible Projects Section
    private var projectsCollapsibleSection: some View {
        DisclosureGroup(isExpanded: $isProjectsExpanded) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Projects")
                        .font(.headline)
                        .foregroundColor(.primary)
                    Spacer()
                    Button {
                        suggestedProjectName = nil
                        showCreateProject = true
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "plus")
                            Text("New Project")
                        }
                        .font(.caption)
                        .fontWeight(.bold)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.indigo.opacity(0.12))
                        .foregroundColor(.indigo)
                        .cornerRadius(8)
                    }
                }
                .padding(.top, 4)
                
                if hiddenProjectsCount > 0 {
                    HStack(spacing: 6) {
                        Image(systemName: "clock.badge.exclamationmark")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                        Text("\(hiddenProjectsCount) project\(hiddenProjectsCount == 1 ? "" : "s") hidden by work/off-hours schedule")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                        Spacer()
                        Button(showAllProjectsOverride ? "Hide Scheduled" : "Show All") {
                            showAllProjectsOverride.toggle()
                        }
                        .font(.caption2)
                        .fontWeight(.bold)
                        .foregroundColor(.indigo)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(8)
                }
                
                LazyVStack(spacing: 12) {
                    ForEach(visibleProjects) { project in
                        NavigationLink(destination: ProjectDetailView(project: project)) {
                            ProjectCardView(
                                project: project,
                                tasks: supabase.tasks,
                                ideas: supabase.ideas
                            )
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button {
                                editingPlaybookProject = project
                            } label: {
                                Label("Set Visibility Hours & Playbook", systemImage: "clock.badge.checkmark")
                            }
                            
                            Button(role: .destructive) {
                                Task {
                                    await supabase.deleteProject(projectId: project.id)
                                }
                            } label: {
                                Label("Delete Project", systemImage: "trash")
                            }
                        }
                    }
                }
            }
            .padding(.top, 8)
        } label: {
            HStack {
                Image(systemName: "folder")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Text("Projects & Playbooks (\(supabase.projects.count))")
                    .font(.subheadline.bold())
                    .foregroundColor(.secondary)
                Spacer()
            }
        }
        .padding(14)
        .background(Color(UIColor.secondarySystemGroupedBackground))
        .cornerRadius(14)
    }
    
    // MARK: - Floating Mic Button
    private var floatingMicButton: some View {
        Button {
            showVoiceSheet = true
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "mic.fill")
                    .font(.title3)
                Text("Brain Dump")
                    .font(.subheadline.weight(.semibold))
            }
            .foregroundColor(.white)
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
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
    
    private func binding(for task: TaskItem) -> Binding<TaskItem> {
        Binding(
            get: {
                supabase.tasks.first(where: { $0.id == task.id }) ?? task
            },
            set: { updated in
                Task {
                    await supabase.updateTask(updated)
                }
            }
        )
    }
}

// MARK: - Settings View
struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage("supabase_url") private var supabaseURL = ""
    @AppStorage("supabase_anon_key") private var supabaseAnonKey = ""
    @AppStorage("gemini_api_key") private var geminiKey = ""
    
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
                    Text("ToDo Companion v1.0 (Sunsama Edition)")
                        .foregroundColor(.secondary)
                    Text("Syncs with Mac Desktop Daemon, Apple Reminders (General list), Apple Calendar, and Supabase.")
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
