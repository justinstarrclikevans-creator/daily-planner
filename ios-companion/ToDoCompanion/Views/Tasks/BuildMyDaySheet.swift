import SwiftUI

enum SunsamaRitualMode: String, CaseIterable {
    case morningPlan = "Morning Plan"
    case eveningShutdown = "Evening Shutdown"
}

struct BuildMyDaySheet: View {
    @ObservedObject private var supabase = SupabaseService.shared
    @ObservedObject private var calendarManager = CalendarManager.shared
    @Environment(\.dismiss) private var dismiss
    
    var initialSpace: String = "all"
    var initialPerson: String = "anyone"
    var initialMode: SunsamaRitualMode = .morningPlan
    
    @State private var ritualMode: SunsamaRitualMode = .morningPlan
    @State private var filterByCurrentContext: Bool = true
    @State private var availableMinutes: Int = 180 // default 3 hours of focus work
    @State private var writeBlocksToAppleCalendar: Bool = false
    @State private var isAutoTimeboxing: Bool = false
    @State private var statusBanner: String? = nil
    @State private var selectedTaskToRun: TaskItem? = nil
    
    let presets: [(label: String, minutes: Int)] = [
        ("1h", 60),
        ("2h", 120),
        ("3h", 180),
        ("4h", 240),
        ("6h", 360)
    ]
    
    private var meetingMinutesToday: Int {
        calendarManager.todaysEvents.filter { !$0.isAllDay }.reduce(0) { sum, ev in
            let mins = Int(ev.endDate.timeIntervalSince(ev.startDate) / 60)
            return sum + max(0, mins)
        }
    }
    
    private var eligibleTasks: [TaskItem] {
        supabase.tasks.filter { task in
            guard !task.isCompleted else { return false }
            guard !task.isScheduledForFuture else { return false }
            if filterByCurrentContext {
                if !task.matchesSpace(initialSpace) { return false }
                if !task.matchesPerson(initialPerson) { return false }
            }
            return true
        }
    }
    
    private var scheduledPlan: (tasks: [TaskItem], totalMinutes: Int, highCount: Int, medCount: Int) {
        let priorityWeight: (TaskItem) -> Int = { t in
            if t.isHighPriority { return 3 }
            if t.isMediumPriority { return 2 }
            return 1
        }
        
        // Prefer tasks already planned for Today first, then highest priority, then shortest duration
        let sorted = eligibleTasks.sorted { a, b in
            if a.isPlannedForToday != b.isPlannedForToday {
                return a.isPlannedForToday && !b.isPlannedForToday
            }
            let wA = priorityWeight(a)
            let wB = priorityWeight(b)
            if wA != wB { return wA > wB }
            return a.estimatedMinutes < b.estimatedMinutes
        }
        
        var scheduled: [TaskItem] = []
        var used = 0
        
        for task in sorted {
            let dur = task.estimatedMinutes > 0 ? task.estimatedMinutes : 15
            if used + dur <= availableMinutes {
                scheduled.append(task)
                used += dur
            }
        }
        
        let high = scheduled.filter { $0.isHighPriority }.count
        let med = scheduled.filter { $0.isMediumPriority }.count
        
        return (scheduled, used, high, med)
    }
    
    private var completedTodayTasks: [TaskItem] {
        supabase.tasks.filter { $0.isCompleted }
    }
    
    private var incompleteTodayTasks: [TaskItem] {
        supabase.tasks.filter { !$0.isCompleted && $0.isPlannedForToday }
    }
    
    private func formatDuration(_ mins: Int) -> String {
        let h = mins / 60
        let m = mins % 60
        if h == 0 { return "\(m)m" }
        if m == 0 { return "\(h)h" }
        return "\(h)h \(m)m"
    }
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    // Ritual Mode Picker
                    Picker("Ritual Mode", selection: $ritualMode) {
                        ForEach(SunsamaRitualMode.allCases, id: \.self) { mode in
                            Text(mode.rawValue).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                    
                    if let banner = statusBanner {
                        HStack(spacing: 8) {
                            Image(systemName: "checkmark.seal.fill")
                                .foregroundColor(.green)
                            Text(banner)
                                .font(.caption.bold())
                                .foregroundColor(.primary)
                            Spacer()
                        }
                        .padding(12)
                        .background(Color.green.opacity(0.14))
                        .cornerRadius(12)
                    }
                    
                    if ritualMode == .morningPlan {
                        morningPlanningContent
                    } else {
                        eveningShutdownContent
                    }
                }
                .padding(18)
            }
            .background(Color(UIColor.systemGroupedBackground).ignoresSafeArea())
            .navigationTitle("Sunsama Daily Ritual")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .onAppear {
                ritualMode = initialMode
                Task { await calendarManager.fetchUpcomingEvents() }
            }
            .sheet(item: $selectedTaskToRun) { task in
                SingleStepFocusView(task: binding(for: task))
            }
        }
    }
    
    // MARK: - Morning Planning Ritual
    
    private var morningPlanningContent: some View {
        VStack(alignment: .leading, spacing: 18) {
            // Header card
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 10) {
                    Image(systemName: "sun.max.fill")
                        .font(.title3)
                        .foregroundColor(.yellow)
                    Text("Morning Planning Ritual")
                        .font(.title3.bold())
                        .foregroundColor(.white)
                }
                Text("Pull only what fits into a realistic workday, slot tasks around your meetings, and start Task #1 with zero friction.")
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.85))
            }
            .padding(16)
            .background(
                LinearGradient(colors: [Color.indigo, Color.purple], startPoint: .topLeading, endPoint: .bottomTrailing)
            )
            .cornerRadius(20)
            
            // Active Context Filter Toggle
            if initialSpace != "all" || initialPerson != "anyone" {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("ACTIVE CONTEXT FILTER")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundColor(.secondary)
                        HStack(spacing: 6) {
                            if initialSpace != "all" {
                                Text("Space: #\(initialSpace)")
                                    .font(.caption.bold())
                                    .foregroundColor(.indigo)
                            }
                            if initialPerson != "anyone" {
                                Text("With: #\(initialPerson)")
                                    .font(.caption.bold())
                                    .foregroundColor(.purple)
                            }
                        }
                    }
                    Spacer()
                    Toggle("", isOn: $filterByCurrentContext)
                        .labelsHidden()
                }
                .padding(12)
                .background(Color(UIColor.secondarySystemGroupedBackground))
                .cornerRadius(14)
            }
            
            // Available time preset buttons
            VStack(alignment: .leading, spacing: 10) {
                Text("TARGET FOCUS TASK BUDGET")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(.secondary)
                
                HStack(spacing: 8) {
                    ForEach(presets, id: \.minutes) { p in
                        Button {
                            withAnimation { availableMinutes = p.minutes }
                        } label: {
                            Text(p.label)
                                .font(.caption.bold())
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 10)
                                .background(availableMinutes == p.minutes ? Color.indigo : Color(UIColor.secondarySystemGroupedBackground))
                                .foregroundColor(availableMinutes == p.minutes ? .white : .primary)
                                .cornerRadius(12)
                        }
                    }
                }
            }
            
            // Sunsama Workload Capacity Summary (Tasks + Meetings)
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("TOTAL WORKLOAD (TASKS + MEETINGS)")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundColor(.secondary)
                        let combined = scheduledPlan.totalMinutes + meetingMinutesToday
                        Text("\(formatDuration(combined)) total (\(formatDuration(scheduledPlan.totalMinutes)) tasks + \(formatDuration(meetingMinutesToday)) meetings)")
                            .font(.subheadline.bold())
                            .foregroundColor(combined > 360 ? .red : .primary)
                    }
                    Spacer()
                    Text("\(scheduledPlan.tasks.count) Tasks")
                        .font(.caption2.bold())
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.indigo.opacity(0.15))
                        .foregroundColor(.indigo)
                        .cornerRadius(8)
                }
                
                GeometryReader { geo in
                    let totalCap = max(360.0, Double(availableMinutes + meetingMinutesToday))
                    let meetingFrac = min(1.0, Double(meetingMinutesToday) / totalCap)
                    let taskFrac = min(1.0 - meetingFrac, Double(scheduledPlan.totalMinutes) / totalCap)
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(Color.secondary.opacity(0.15))
                        HStack(spacing: 0) {
                            Rectangle()
                                .fill(Color.blue.opacity(0.75))
                                .frame(width: geo.size.width * meetingFrac)
                            Rectangle()
                                .fill((scheduledPlan.totalMinutes + meetingMinutesToday) > 360 ? Color.red : Color.indigo)
                                .frame(width: geo.size.width * taskFrac)
                        }
                        .clipShape(Capsule())
                    }
                }
                .frame(height: 8)
                
                if (scheduledPlan.totalMinutes + meetingMinutesToday) > 360 {
                    Text("⚠️ Over 6 hours of combined meetings and focus work. Sunsama recommends deferring lower-priority items to Tomorrow.")
                        .font(.caption2)
                        .foregroundColor(.red)
                }
            }
            .padding(14)
            .background(Color(UIColor.secondarySystemGroupedBackground))
            .cornerRadius(16)
            
            // Ordered Day Schedule
            VStack(alignment: .leading, spacing: 10) {
                Text("RECOMMENDED TODAY LINEUP")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(.secondary)
                
                if scheduledPlan.tasks.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "clock.badge.exclamationmark")
                            .font(.title2)
                            .foregroundColor(.secondary)
                        Text("No tasks fit within this time window.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 30)
                    .background(Color(UIColor.secondarySystemGroupedBackground))
                    .cornerRadius(16)
                } else {
                    VStack(spacing: 8) {
                        ForEach(Array(scheduledPlan.tasks.enumerated()), id: \.element.id) { index, task in
                            HStack(spacing: 12) {
                                Text("\(index + 1)")
                                    .font(.caption.bold())
                                    .foregroundColor(.indigo)
                                    .frame(width: 24, height: 24)
                                    .background(Color.indigo.opacity(0.15))
                                    .clipShape(Circle())
                                
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(task.cleanTitle)
                                        .font(.subheadline.weight(.semibold))
                                        .lineLimit(1)
                                    HStack(spacing: 6) {
                                        Text(task.channelTag)
                                            .font(.caption2.bold())
                                            .foregroundColor(.indigo)
                                        if let tb = task.timeboxString {
                                            Text("🕒 \(tb)")
                                                .font(.caption2)
                                                .foregroundColor(.secondary)
                                        }
                                    }
                                }
                                
                                Spacer()
                                
                                if task.isHighPriority {
                                    Image(systemName: "flame.fill")
                                        .foregroundColor(.red)
                                        .font(.caption)
                                }
                                
                                Text("\(task.estimatedMinutes)m")
                                    .font(.caption.monospaced())
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Color(UIColor.tertiarySystemGroupedBackground))
                                    .cornerRadius(6)
                            }
                            .padding(12)
                            .background(Color(UIColor.secondarySystemGroupedBackground))
                            .cornerRadius(14)
                        }
                    }
                }
            }
            
            Toggle("Also write focus blocks to Apple Calendar", isOn: $writeBlocksToAppleCalendar)
                .font(.caption.bold())
                .padding(.horizontal, 4)
            
            // Action Buttons: Auto-Timebox + Start Task #1
            VStack(spacing: 10) {
                Button {
                    isAutoTimeboxing = true
                    Task {
                        for item in scheduledPlan.tasks {
                            await supabase.planTaskForToday(item)
                        }
                        let count = await supabase.autoTimeboxTodayTasks(
                            tasksToSchedule: scheduledPlan.tasks,
                            writeToCalendar: writeBlocksToAppleCalendar
                        )
                        isAutoTimeboxing = false
                        statusBanner = "Committed \(scheduledPlan.tasks.count) tasks to Today & auto-timeboxed \(count) slots around meetings."
                    }
                } label: {
                    HStack(spacing: 8) {
                        if isAutoTimeboxing {
                            ProgressView().tint(.white)
                        } else {
                            Image(systemName: "calendar.badge.clock")
                        }
                        Text("Commit Plan & Auto-Timebox Today")
                    }
                    .font(.subheadline.bold())
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color.indigo)
                    .cornerRadius(16)
                }
                .disabled(scheduledPlan.tasks.isEmpty || isAutoTimeboxing)
                
                if let firstTask = scheduledPlan.tasks.first {
                    Button {
                        selectedTaskToRun = firstTask
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "play.fill")
                            Text("Start Focus on Task #1 (\(firstTask.estimatedMinutes)m)")
                        }
                        .font(.subheadline.bold())
                        .foregroundColor(.indigo)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                        .background(Color.indigo.opacity(0.14))
                        .cornerRadius(16)
                    }
                }
            }
        }
    }
    
    // MARK: - Evening Shutdown Ritual
    
    private var eveningShutdownContent: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 10) {
                    Image(systemName: "moon.stars.fill")
                        .font(.title3)
                        .foregroundColor(.yellow)
                    Text("Evening Shutdown Ritual")
                        .font(.title3.bold())
                        .foregroundColor(.white)
                }
                Text("Celebrate what you finished today and cleanly roll unfinished tasks to Tomorrow or Backlog so you can disconnect guilt-free.")
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.85))
            }
            .padding(16)
            .background(
                LinearGradient(colors: [Color.purple, Color.blue], startPoint: .topLeading, endPoint: .bottomTrailing)
            )
            .cornerRadius(20)
            
            // Completed Today Summary Card
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("COMPLETED TASKS")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.secondary)
                    Text("\(completedTodayTasks.count)")
                        .font(.title2.bold())
                        .foregroundColor(.green)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    Text("REMAINING ON TODAY")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.secondary)
                    Text("\(incompleteTodayTasks.count)")
                        .font(.title2.bold())
                        .foregroundColor(.orange)
                }
            }
            .padding(16)
            .background(Color(UIColor.secondarySystemGroupedBackground))
            .cornerRadius(16)
            
            if incompleteTodayTasks.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 36))
                        .foregroundColor(.green)
                    Text("Your Today board is 100% clear.")
                        .font(.headline)
                    Text("Enjoy your evening!")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 32)
                .background(Color(UIColor.secondarySystemGroupedBackground))
                .cornerRadius(16)
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    Text("UNFINISHED TODAY TASKS (\(incompleteTodayTasks.count))")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.secondary)
                    
                    ForEach(incompleteTodayTasks) { task in
                        HStack {
                            Text(task.cleanTitle)
                                .font(.subheadline.weight(.medium))
                                .lineLimit(1)
                            Spacer()
                            Text("\(task.estimatedMinutes)m")
                                .font(.caption2.monospaced())
                                .foregroundColor(.secondary)
                        }
                        .padding(12)
                        .background(Color(UIColor.secondarySystemGroupedBackground))
                        .cornerRadius(12)
                    }
                }
                
                VStack(spacing: 10) {
                    Button {
                        Task {
                            let count = await supabase.shutdownDay(rolloverToTomorrow: true)
                            statusBanner = "Rolled \(count) unfinished tasks to Tomorrow. Have a great evening!"
                        }
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "sunrise.fill")
                            Text("Roll All \(incompleteTodayTasks.count) Tasks to Tomorrow")
                        }
                        .font(.subheadline.bold())
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Color.orange)
                        .cornerRadius(16)
                    }
                    
                    Button {
                        Task {
                            let count = await supabase.shutdownDay(rolloverToTomorrow: false)
                            statusBanner = "Moved \(count) unfinished tasks back to the Backlog."
                        }
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "tray.full.fill")
                            Text("Return All \(incompleteTodayTasks.count) Tasks to Backlog")
                        }
                        .font(.subheadline.bold())
                        .foregroundColor(.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                        .background(Color(UIColor.secondarySystemGroupedBackground))
                        .cornerRadius(16)
                    }
                }
            }
        }
    }
    
    private func binding(for task: TaskItem) -> Binding<TaskItem> {
        Binding(
            get: {
                if let idx = supabase.tasks.firstIndex(where: { $0.id == task.id }) {
                    return supabase.tasks[idx]
                }
                return task
            },
            set: { updated in
                if let idx = supabase.tasks.firstIndex(where: { $0.id == updated.id }) {
                    supabase.tasks[idx] = updated
                }
            }
        )
    }
}
