import SwiftUI

enum TaskFilterMode: String, CaseIterable, Identifiable {
    case all = "All"
    case quick = "⚡ <15m"
    case deep = "⏱ >30m"
    case queue = "▶️ Queue"
    case completed = "Done"
    
    var id: String { rawValue }
}

struct RemindersListView: View {
    @ObservedObject var supabase = SupabaseService.shared
    @ObservedObject var reminders = RemindersManager.shared
    
    @State private var filterMode: TaskFilterMode = .all
    @State private var selectedList: String? = nil // nil means all lists
    @State private var searchText: String = ""
    @State private var activeFocusTask: TaskItem? = nil
    @State private var showNewTaskSheet: Bool = false
    @State private var newReminderTitle: String = ""
    @State private var selectedDuration: TaskDuration = .fifteen
    
    private func isTaskVisibleNow(_ task: TaskItem) -> Bool {
        // In the Reminders view, all incomplete tasks are visible without time-of-day filtering
        return true
    }
    
    var filteredTasks: [TaskItem] {
        supabase.tasks.filter { task in
            // Respect project visibility schedule
            guard isTaskVisibleNow(task) else { return false }
            
            // Search text
            if !searchText.isEmpty {
                if !task.title.localizedCaseInsensitiveContains(searchText) {
                    return false
                }
            }
            
            // List filter
            if let list = selectedList {
                if task.listName.caseInsensitiveCompare(list) != .orderedSame {
                    return false
                }
            }
            
            // Mode filter
            switch filterMode {
            case .all:
                return !task.isCompleted
            case .quick:
                return !task.isCompleted && (task.estimatedMinutes ?? 15) <= 15
            case .deep:
                return !task.isCompleted && (task.estimatedMinutes ?? 15) >= 30
            case .queue:
                return !task.isCompleted && task.inPlayQueue
            case .completed:
                return task.isCompleted
            }
        }
    }
    
    var uniqueLists: [String] {
        let lists = Set(supabase.tasks.map { $0.listName })
        return Array(lists).sorted()
    }
    
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Quick List Selector Pills
                listSelectorBar
                    .padding(.vertical, 6)
                
                // Mode Segmented Picker
                Picker("Filter", selection: $filterMode) {
                    ForEach(TaskFilterMode.allCases) { mode in
                        Text(mode.rawValue).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.bottom, 8)
                
                Divider()
                
                // Tasks List
                if filteredTasks.isEmpty {
                    emptyStateView
                } else {
                    List {
                        ForEach(filteredTasks) { task in
                            TaskRowView(
                                task: task,
                                onToggle: {
                                    Task {
                                        await supabase.toggleTaskCompletion(task: task)
                                    }
                                },
                                onFocus: {
                                    self.activeFocusTask = task
                                }
                            )
                            .contentShape(Rectangle())
                            .onTapGesture {
                                self.activeFocusTask = task
                            }
                            .swipeActions(edge: .leading) {
                                Button {
                                    Task {
                                        await supabase.togglePlayQueue(for: task)
                                    }
                                } label: {
                                    Label(task.inPlayQueue ? "De-Queue" : "Queue", systemImage: task.inPlayQueue ? "minus.circle" : "play.circle.fill")
                                }
                                .tint(.indigo)
                            }
                            .swipeActions(edge: .trailing) {
                                Button {
                                    Task {
                                        await supabase.bumpTaskToTomorrow(task: task)
                                    }
                                } label: {
                                    Label("Tomorrow", systemImage: "arrow.right.circle")
                                }
                                .tint(.orange)
                            }
                        }
                    }
                    .listStyle(.plain)
                    .refreshable {
                        await reminders.syncDeviceReminders()
                        if AppConfig.isSupabaseConfigured {
                            await supabase.fetchTasks()
                        }
                    }
                }
            }
            .task {
                await reminders.syncDeviceReminders()
                if AppConfig.isSupabaseConfigured {
                    await supabase.fetchTasks()
                }
            }
            .navigationTitle("Reminders (\(filteredTasks.count))")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $searchText, prompt: "Search todos...")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showNewTaskSheet = true
                    } label: {
                        Image(systemName: "plus")
                            .fontWeight(.semibold)
                    }
                }
            }
            .sheet(item: $activeFocusTask) { task in
                TaskFocusSheetView(task: binding(for: task))
            }
            .sheet(isPresented: $showNewTaskSheet) {
                quickAddSheet
            }
        }
    }
    
    // MARK: - List Selector Bar
    private var listSelectorBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Button {
                    selectedList = nil
                } label: {
                    Text("All Lists")
                        .font(.caption)
                        .fontWeight(selectedList == nil ? .bold : .regular)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(selectedList == nil ? Color.primary : Color(.secondarySystemBackground))
                        .foregroundColor(selectedList == nil ? Color(.systemBackground) : .primary)
                        .cornerRadius(14)
                }
                
                ForEach(uniqueLists, id: \.self) { list in
                    Button {
                        selectedList = list
                    } label: {
                        Text(list)
                            .font(.caption)
                            .fontWeight(selectedList == list ? .bold : .regular)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(selectedList == list ? Color.indigo : Color(.secondarySystemBackground))
                            .foregroundColor(selectedList == list ? .white : .primary)
                            .cornerRadius(14)
                    }
                }
            }
            .padding(.horizontal)
        }
    }
    
    // MARK: - Empty State
    private var emptyStateView: some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: filterMode == .completed ? "archivebox" : "checkmark.seal.fill")
                .font(.system(size: 48))
                .foregroundColor(filterMode == .completed ? .secondary : .green)
            
            Text(filterMode == .completed ? "No completed tasks found" : "All caught up!")
                .font(.headline)
            
            Text(filterMode == .completed ? "Completed reminders will appear here." : "No tasks match this filter. Take a breath or add a new one.")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            
            if !reminders.isAuthorized {
                Button {
                    Task {
                        _ = await reminders.requestAccess()
                        await reminders.syncDeviceReminders()
                    }
                } label: {
                    Label("Allow Apple Reminders Access", systemImage: "checklist")
                        .font(.footnote)
                        .fontWeight(.bold)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(Color.indigo)
                        .foregroundColor(.white)
                        .cornerRadius(10)
                }
                .padding(.top, 4)
            }
            
            Spacer()
        }
    }
    
    // MARK: - Quick Add Sheet
    private var quickAddSheet: some View {
        NavigationStack {
            Form {
                Section(header: Text("New To-Do")) {
                    TextField("What needs to get done?", text: $newReminderTitle)
                }
                
                Section(header: Text("Target Time (Forced 15m Intervals)")) {
                    Picker("Duration", selection: $selectedDuration) {
                        ForEach(TaskDuration.allCases) { dur in
                            Text(dur.label).tag(dur)
                        }
                    }
                    .pickerStyle(.segmented)
                }
                
                Section(header: Text("List")) {
                    Picker("List", selection: Binding(
                        get: { selectedList ?? "Personal" },
                        set: { selectedList = $0 }
                    )) {
                        ForEach(uniqueLists.isEmpty ? ["Personal", "First shift", "Football"] : uniqueLists, id: \.self) {
                            Text($0).tag($0)
                        }
                    }
                }
            }
            .navigationTitle("Add to Reminders")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        showNewTaskSheet = false
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        let title = newReminderTitle.trimmingCharacters(in: .whitespacesAndNewlines)
                        if !title.isEmpty {
                            let list = selectedList ?? "Personal"
                            Task {
                                // Add directly to Apple Reminders
                                let reminderId = try? await reminders.addReminder(title: title, listName: list)
                                // Sync to Supabase
                                await supabase.createTask(
                                    title: title,
                                    listName: list,
                                    appleReminderId: reminderId,
                                    estimatedMinutes: selectedDuration.rawValue
                                )
                            }
                        }
                        newReminderTitle = ""
                        showNewTaskSheet = false
                    }
                    .fontWeight(.bold)
                    .disabled(newReminderTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
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
