import SwiftUI

struct BuildMyDaySheet: View {
    @ObservedObject private var supabase = SupabaseService.shared
    @Environment(\.dismiss) private var dismiss
    
    @State private var availableMinutes: Int = 120 // default 2 hours
    @State private var selectedTaskToRun: TaskItem? = nil
    
    let presets: [(label: String, minutes: Int)] = [
        ("1 Hour", 60),
        ("2 Hours", 120),
        ("3 Hours", 180),
        ("4 Hours", 240)
    ]
    
    // Day Planning Optimization Engine
    private var eligibleTasks: [TaskItem] {
        supabase.tasks.filter { task in
            guard !task.isCompleted else { return false }
            guard !task.isScheduledForFuture else { return false }
            return true
        }
    }
    
    private var scheduledPlan: (tasks: [TaskItem], totalMinutes: Int, highCount: Int, medCount: Int) {
        let priorityWeight: (String) -> Int = { p in
            switch p.lowercased() {
            case "high": return 3
            case "medium": return 2
            case "low": return 1
            default: return 2
            }
        }
        
        let sorted = eligibleTasks.sorted { a, b in
            let wA = priorityWeight(a.priority)
            let wB = priorityWeight(b.priority)
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
                VStack(alignment: .leading, spacing: 20) {
                    // Header card
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 10) {
                            Image(systemName: "sparkles")
                                .font(.title3)
                                .foregroundColor(.yellow)
                            Text("Build My Day")
                                .font(.title3.bold())
                                .foregroundColor(.white)
                        }
                        Text("Tell us how much focus time you have today. We'll automatically pack your highest-priority items without overloading your schedule.")
                            .font(.caption)
                            .foregroundColor(.white.opacity(0.8))
                    }
                    .padding(16)
                    .background(
                        LinearGradient(colors: [Color.indigo, Color.purple], startPoint: .topLeading, endPoint: .bottomTrailing)
                    )
                    .cornerRadius(20)
                    
                    // Available time preset buttons
                    VStack(alignment: .leading, spacing: 10) {
                        Text("AVAILABLE TIME TODAY")
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
                                        .shadow(color: availableMinutes == p.minutes ? Color.indigo.opacity(0.3) : .clear, radius: 4)
                                }
                            }
                        }
                    }
                    
                    // Schedule summary pill
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("SCHEDULED BUDGET")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundColor(.secondary)
                            Text("\(formatDuration(scheduledPlan.totalMinutes)) of \(formatDuration(availableMinutes))")
                                .font(.headline.bold())
                        }
                        
                        Spacer()
                        
                        HStack(spacing: 6) {
                            if scheduledPlan.highCount > 0 {
                                HStack(spacing: 2) {
                                    Image(systemName: "flame.fill").foregroundColor(.red)
                                    Text("\(scheduledPlan.highCount) High").bold()
                                }
                                .font(.caption2)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.red.opacity(0.15))
                                .foregroundColor(.red)
                                .cornerRadius(8)
                            }
                            
                            Text("\(scheduledPlan.tasks.count) Tasks")
                                .font(.caption2.bold())
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.secondary.opacity(0.15))
                                .cornerRadius(8)
                        }
                    }
                    .padding(14)
                    .background(Color(UIColor.secondarySystemGroupedBackground))
                    .cornerRadius(16)
                    
                    // Ordered Day Schedule
                    VStack(alignment: .leading, spacing: 10) {
                        Text("YOUR FOCUS SCHEDULE")
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
                                            Text(task.title)
                                                .font(.subheadline.weight(.semibold))
                                                .lineLimit(1)
                                            Text(task.listName)
                                                .font(.caption2)
                                                .foregroundColor(.secondary)
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
                    
                    // Start Focus Runner CTA
                    if let firstTask = scheduledPlan.tasks.first {
                        Button {
                            selectedTaskToRun = firstTask
                        } label: {
                            HStack(spacing: 8) {
                                Image(systemName: "play.fill")
                                Text("Start Day with Task #1 (\(firstTask.estimatedMinutes)m)")
                            }
                            .font(.subheadline.bold())
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(Color.indigo)
                            .cornerRadius(16)
                            .shadow(color: Color.indigo.opacity(0.3), radius: 8, y: 4)
                        }
                    }
                }
                .padding(18)
            }
            .background(Color(UIColor.systemGroupedBackground).ignoresSafeArea())
            .navigationTitle("Day Planner")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .sheet(item: $selectedTaskToRun) { task in
                SingleStepFocusView(task: binding(for: task))
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
