import SwiftUI

struct TaskItemRowView: View {
    let task: TaskItem
    @ObservedObject private var supabase = SupabaseService.shared
    @ObservedObject private var taggingRules = TaggingRulesService.shared
    @ObservedObject private var calendarManager = CalendarManager.shared
    
    var onConvertToProject: () -> Void
    var onStartSprint: () -> Void
    
    @State private var isExpanded: Bool = false
    @State private var isCompleting: Bool = false
    @State private var checkmarkScale: CGFloat = 1.0
    
    private var isVisuallyDone: Bool {
        task.isCompleted || isCompleting
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                // Checkbox with satisfying animated completion
                Button {
                    handleTapCheckbox()
                } label: {
                    ZStack {
                        Image(systemName: isVisuallyDone ? "checkmark.circle.fill" : "circle")
                            .font(.title3)
                            .foregroundColor(isVisuallyDone ? .green : .secondary)
                            .scaleEffect(checkmarkScale)
                        
                        if isCompleting {
                            Circle()
                                .stroke(Color.green.opacity(0.35), lineWidth: 2)
                                .frame(width: 26, height: 26)
                                .scaleEffect(checkmarkScale * 1.15)
                        }
                    }
                    .padding(.top, 2)
                }
                .buttonStyle(.plain)
                
                // Title & Sunsama Metadata Pills
                VStack(alignment: .leading, spacing: 6) {
                    Text(task.cleanTitle)
                        .font(.subheadline.weight(.semibold))
                        .foregroundColor(isVisuallyDone ? .secondary : .primary)
                        .strikethrough(isVisuallyDone)
                        .lineLimit(2)
                        .animation(.easeInOut(duration: 0.2), value: isVisuallyDone)
                    
                    // Sunsama Metadata Bar: Channel, Space, Person, Timebox, Quick Tag + Time Controls
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            // 1. Sunsama Stage / Quick Move Pill (Backlog -> Today / Tomorrow)
                            sunsamaStageMenuPill
                            
                            // 2. Timebox / Clock Slot Pill (User-controlled time assignment)
                            sunsamaTimeboxMenuPill
                            
                            // 3. Channel / Project Pill (#turn90, #843fc, etc.)
                            Text(task.channelTag)
                                .font(.system(size: 10, weight: .bold))
                                .foregroundColor(.indigo)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2.5)
                                .background(Color.indigo.opacity(0.12))
                                .cornerRadius(5)
                            
                            // 4. Detected Space Pill
                            if let space = task.detectedSpace {
                                HStack(spacing: 3) {
                                    Image(systemName: space.icon)
                                        .font(.system(size: 8, weight: .bold))
                                    Text(space.label)
                                        .font(.system(size: 10, weight: .semibold))
                                }
                                .foregroundColor(.teal)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2.5)
                                .background(Color.teal.opacity(0.12))
                                .cornerRadius(5)
                            }
                            
                            // 5. Detected People Pills
                            ForEach(task.peopleInTask.prefix(2), id: \.self) { person in
                                HStack(spacing: 2) {
                                    Image(systemName: "person.fill")
                                        .font(.system(size: 8))
                                    Text(person)
                                        .font(.system(size: 10, weight: .semibold))
                                }
                                .foregroundColor(.purple)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2.5)
                                .background(Color.purple.opacity(0.12))
                                .cornerRadius(5)
                            }
                            
                            // 6. User-Assigned Tags Menu (#Tag Picker)
                            userTagPickerMenu
                        }
                    }
                }
                
                Spacer(minLength: 4)
                
                // Right-hand Action Cluster: Focus Play, Priority, Duration
                VStack(alignment: .trailing, spacing: 6) {
                    HStack(spacing: 6) {
                        // Quick "-> Today" one-tap button if task is in Backlog
                        if task.isBacklog {
                            Button {
                                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                                Task { await supabase.planTaskForToday(task) }
                            } label: {
                                HStack(spacing: 3) {
                                    Image(systemName: "sun.max.fill")
                                    Text("Today")
                                }
                                .font(.system(size: 10, weight: .bold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.indigo)
                                .cornerRadius(6)
                            }
                            .buttonStyle(.plain)
                        } else {
                            // One-tap Focus Timer button for planned tasks
                            Button {
                                onStartSprint()
                            } label: {
                                Image(systemName: "play.fill")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundColor(.indigo)
                                    .frame(width: 24, height: 24)
                                    .background(Color.indigo.opacity(0.14))
                                    .clipShape(Circle())
                            }
                            .buttonStyle(.plain)
                        }
                        
                        // Subtasks expander
                        if !task.subtasks.isEmpty {
                            Button {
                                withAnimation { isExpanded.toggle() }
                            } label: {
                                HStack(spacing: 2) {
                                    Text("\(task.subtasks.filter(\.isCompleted).count)/\(task.subtasks.count)")
                                        .font(.system(size: 9, weight: .bold).monospaced())
                                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                                        .font(.system(size: 9, weight: .bold))
                                }
                                .foregroundColor(.secondary)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 3)
                                .background(Color(UIColor.tertiarySystemGroupedBackground))
                                .cornerRadius(5)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    
                    HStack(spacing: 5) {
                        // Priority Menu Pill
                        Menu {
                            Button {
                                Task { await supabase.updateTaskPriority(task: task, priority: "high") }
                            } label: {
                                Label("High Priority", systemImage: "flame.fill")
                            }
                            Button {
                                Task { await supabase.updateTaskPriority(task: task, priority: "medium") }
                            } label: {
                                Label("Medium Priority", systemImage: "bolt.fill")
                            }
                            Button {
                                Task { await supabase.updateTaskPriority(task: task, priority: "low") }
                            } label: {
                                Label("Low Priority", systemImage: "leaf.fill")
                            }
                        } label: {
                            HStack(spacing: 2) {
                                if task.isHighPriority {
                                    Image(systemName: "flame.fill").foregroundColor(.red)
                                    Text("High").foregroundColor(.red)
                                } else if task.isLowPriority {
                                    Image(systemName: "leaf.fill").foregroundColor(.green)
                                    Text("Low").foregroundColor(.green)
                                } else {
                                    Image(systemName: "bolt.fill").foregroundColor(.orange)
                                    Text("Med").foregroundColor(.orange)
                                }
                            }
                            .font(.system(size: 10, weight: .bold))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 3)
                            .background(priorityBackgroundColor)
                            .cornerRadius(6)
                        }
                        .buttonStyle(.plain)
                        
                        // Duration Menu Pill
                        Menu {
                            ForEach([5, 10, 15, 25, 30, 45, 60, 90], id: \.self) { mins in
                                Button("\(mins) minutes") {
                                    Task {
                                        await supabase.updateEstimatedMinutes(for: task, minutes: mins)
                                    }
                                }
                            }
                        } label: {
                            HStack(spacing: 2) {
                                Image(systemName: "hourglass")
                                Text("\(task.estimatedMinutes)m")
                            }
                            .font(.system(size: 10, weight: .bold).monospaced())
                            .foregroundColor(.secondary)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 3)
                            .background(Color(UIColor.tertiarySystemGroupedBackground))
                            .cornerRadius(6)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            
            // Subtasks inline list
            if isExpanded && !task.subtasks.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(task.subtasks) { subtask in
                        HStack(spacing: 8) {
                            Button {
                                toggleSubtask(subtask)
                            } label: {
                                Image(systemName: subtask.isCompleted ? "checkmark.square.fill" : "square")
                                    .font(.caption)
                                    .foregroundColor(subtask.isCompleted ? .indigo : .secondary)
                            }
                            .buttonStyle(.plain)
                            
                            Text(subtask.title)
                                .font(.caption)
                                .foregroundColor(subtask.isCompleted ? .secondary : .primary)
                                .strikethrough(subtask.isCompleted)
                        }
                        .padding(.leading, 32)
                    }
                }
                .padding(.top, 4)
            }
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .background(
            isCompleting
                ? Color.green.opacity(0.12)
                : Color(UIColor.secondarySystemGroupedBackground)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(task.isTimeboxed ? Color.indigo.opacity(0.35) : Color.clear, lineWidth: 1)
        )
        .opacity(isCompleting ? 0.75 : 1.0)
        .cornerRadius(14)
        .animation(.easeInOut(duration: 0.25), value: isCompleting)
        .swipeActions(edge: .leading) {
            Button {
                handleTapCheckbox()
            } label: {
                Label("Done", systemImage: "checkmark")
            }
            .tint(.green)
            
            if !task.isPlannedForToday {
                Button {
                    Task { await supabase.planTaskForToday(task) }
                } label: {
                    Label("Today", systemImage: "sun.max.fill")
                }
                .tint(.indigo)
            }
        }
        .swipeActions(edge: .trailing) {
            Button {
                Task { await supabase.planTaskForTomorrow(task) }
            } label: {
                Label("Tomorrow", systemImage: "sunrise.fill")
            }
            .tint(.orange)
            
            if !task.isBacklog {
                Button {
                    Task { await supabase.moveTaskToBacklog(task) }
                } label: {
                    Label("Backlog", systemImage: "tray.full.fill")
                }
                .tint(.gray)
            }
        }
        .contextMenu {
            Button {
                Task { await supabase.planTaskForToday(task) }
            } label: {
                Label("Plan for Today", systemImage: "sun.max.fill")
            }
            
            Button {
                Task { await supabase.planTaskForTomorrow(task) }
            } label: {
                Label("Roll to Tomorrow", systemImage: "sunrise.fill")
            }
            
            Button {
                Task { await supabase.moveTaskToBacklog(task) }
            } label: {
                Label("Move to Backlog", systemImage: "tray.full.fill")
            }
            
            Divider()
            
            Button {
                onStartSprint()
            } label: {
                Label("Start Focus Timer", systemImage: "play.fill")
            }
            
            Button {
                onConvertToProject()
            } label: {
                Label("Turn into Project", systemImage: "folder.badge.plus")
            }
        }
    }
    
    // MARK: - Sunsama Sub-Menus
    
    private var sunsamaStageMenuPill: some View {
        Menu {
            Button {
                Task { await supabase.planTaskForToday(task) }
            } label: {
                Label("Today's Plan", systemImage: "sun.max.fill")
            }
            Button {
                Task { await supabase.planTaskForTomorrow(task) }
            } label: {
                Label("Tomorrow", systemImage: "sunrise.fill")
            }
            Button {
                Task { await supabase.moveTaskToBacklog(task) }
            } label: {
                Label("Unplanned Backlog", systemImage: "tray.full.fill")
            }
        } label: {
            HStack(spacing: 3) {
                if task.isPlannedForToday {
                    Image(systemName: "sun.max.fill")
                    Text("Today")
                } else if task.isPlannedForTomorrow {
                    Image(systemName: "sunrise.fill")
                    Text("Tomorrow")
                } else {
                    Image(systemName: "tray.fill")
                    Text("Backlog")
                }
            }
            .font(.system(size: 10, weight: .bold))
            .foregroundColor(task.isPlannedForToday ? .orange : (task.isPlannedForTomorrow ? .blue : .secondary))
            .padding(.horizontal, 6)
            .padding(.vertical, 2.5)
            .background(
                (task.isPlannedForToday ? Color.orange : (task.isPlannedForTomorrow ? Color.blue : Color.gray))
                    .opacity(0.14)
            )
            .cornerRadius(5)
        }
        .buttonStyle(.plain)
    }
    
    private var sunsamaTimeboxMenuPill: some View {
        Menu {
            Section("Free Slots Between Meetings Today") {
                let freeSlots = calendarManager.findFreeSlots(for: Date(), minMinutes: max(5, task.estimatedMinutes))
                if freeSlots.isEmpty {
                    Text("No open gaps found")
                } else {
                    ForEach(freeSlots.prefix(5)) { slot in
                        Button {
                            Task { await supabase.timeboxTask(task, at: slot.startDate, createCalendarEvent: false) }
                        } label: {
                            Label("Slot at \(formatShortTime(slot.startDate))", systemImage: "sparkles")
                        }
                    }
                }
            }
            
            Section("Pick Timebox Hour Today") {
                ForEach([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18], id: \.self) { hour in
                    Button {
                        if let date = Calendar.current.date(bySettingHour: hour, minute: 0, second: 0, of: Date()) {
                            Task { await supabase.timeboxTask(task, at: date, createCalendarEvent: false) }
                        }
                    } label: {
                        Label(formatHourLabel(hour), systemImage: "clock")
                    }
                }
            }
            
            if task.isTimeboxed {
                Divider()
                Button {
                    if let start = task.dueDate {
                        Task { await supabase.timeboxTask(task, at: start, createCalendarEvent: true) }
                    }
                } label: {
                    Label("Push Block to Apple Calendar", systemImage: "calendar.badge.plus")
                }
                
                Button(role: .destructive) {
                    Task { await supabase.clearTimebox(for: task) }
                } label: {
                    Label("Clear Timebox", systemImage: "xmark.circle")
                }
            }
        } label: {
            HStack(spacing: 3) {
                Image(systemName: task.isTimeboxed ? "clock.badge.checkmark.fill" : "clock")
                Text(task.timeboxString ?? "Set Time")
            }
            .font(.system(size: 10, weight: .bold).monospaced())
            .foregroundColor(task.isTimeboxed ? .indigo : .secondary)
            .padding(.horizontal, 6)
            .padding(.vertical, 2.5)
            .background(task.isTimeboxed ? Color.indigo.opacity(0.15) : Color(UIColor.tertiarySystemGroupedBackground))
            .cornerRadius(5)
        }
        .buttonStyle(.plain)
    }
    
    private var userTagPickerMenu: some View {
        Menu {
            Section("Project / Channel Tag") {
                ForEach(taggingRules.rules.projects) { proj in
                    let clean = proj.tag.replacingOccurrences(of: "#", with: "").lowercased()
                    let isSelected = task.allTags.contains(clean)
                    Button {
                        Task { await supabase.toggleTag(on: task, tag: clean) }
                    } label: {
                        Label("\(proj.label) (#\(clean))", systemImage: isSelected ? "checkmark.circle.fill" : "number")
                    }
                }
            }
            Section("Work Space Tag") {
                ForEach(taggingRules.rules.spaces) { space in
                    let clean = space.tag.replacingOccurrences(of: "#", with: "").lowercased()
                    let isSelected = task.allTags.contains(clean)
                    Button {
                        Task { await supabase.toggleTag(on: task, tag: clean) }
                    } label: {
                        Label("\(space.label) (#\(clean))", systemImage: isSelected ? "checkmark.circle.fill" : "laptopcomputer")
                    }
                }
            }
            Section("Person Tag") {
                ForEach(taggingRules.rules.people) { person in
                    let clean = person.tag.replacingOccurrences(of: "#", with: "").lowercased()
                    let isSelected = task.allTags.contains(clean)
                    Button {
                        Task { await supabase.toggleTag(on: task, tag: clean) }
                    } label: {
                        Label("\(person.label) (#\(clean))", systemImage: isSelected ? "checkmark.circle.fill" : "person.fill")
                    }
                }
            }
        } label: {
            HStack(spacing: 2) {
                Image(systemName: "tag.fill")
                    .font(.system(size: 8))
                Text(task.tags.isEmpty ? "+ Tag" : "#\(task.tags.first ?? "")")
                    .font(.system(size: 10, weight: .semibold))
            }
            .foregroundColor(.secondary)
            .padding(.horizontal, 6)
            .padding(.vertical, 2.5)
            .background(Color(UIColor.tertiarySystemGroupedBackground))
            .cornerRadius(5)
        }
        .buttonStyle(.plain)
    }
    
    private func formatShortTime(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "h:mm a"
        return f.string(from: date)
    }
    
    private func formatHourLabel(_ hour: Int) -> String {
        if hour == 12 { return "12:00 PM" }
        if hour > 12 { return "\(hour - 12):00 PM" }
        return "\(hour):00 AM"
    }
    
    private func handleTapCheckbox() {
        if task.isCompleted {
            Task {
                await supabase.toggleTaskCompletion(task: task)
            }
        } else {
            handleComplete()
        }
    }
    
    private func handleComplete() {
        guard !isCompleting else { return }
        
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        
        withAnimation(.spring(response: 0.25, dampingFraction: 0.5)) {
            isCompleting = true
            checkmarkScale = 1.35
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            withAnimation(.spring(response: 0.2, dampingFraction: 0.7)) {
                checkmarkScale = 1.0
            }
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.55) {
            withAnimation(.easeInOut(duration: 0.3)) {
                Task {
                    await supabase.toggleTaskCompletion(task: task)
                }
            }
        }
    }
    
    private var priorityBackgroundColor: Color {
        if task.isHighPriority {
            return Color.red.opacity(0.12)
        } else if task.isLowPriority {
            return Color.green.opacity(0.12)
        }
        return Color.orange.opacity(0.12)
    }
    
    private func toggleSubtask(_ subtask: SubtaskItem) {
        var updated = task
        if let idx = updated.subtasks.firstIndex(where: { $0.id == subtask.id }) {
            updated.subtasks[idx].isCompleted.toggle()
            Task {
                await supabase.updateTask(updated)
            }
        }
    }
}
