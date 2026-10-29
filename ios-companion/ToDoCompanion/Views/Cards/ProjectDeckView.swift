import SwiftUI

struct ProjectDeckView: View {
    let project: Project
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var supabase = SupabaseService.shared
    
    @State private var currentIndex: Int = 0
    @State private var dragOffset: CGSize = .zero
    @State private var isAnimatingAction: Bool = false
    @State private var activeFocusTask: TaskItem? = nil
    @State private var showCelebration: Bool = false
    @State private var deferredTaskIds: Set<UUID> = []
    @State private var completedTaskIds: Set<UUID> = []
    
    private var tasks: [TaskItem] {
        supabase.tasks.filter { task in
            guard !task.isCompleted else { return false }
            guard !completedTaskIds.contains(task.id) else { return false }
            guard !deferredTaskIds.contains(task.id) else { return false }
            guard !task.isScheduledForFuture else { return false }
            if let pid = task.projectId {
                return pid == project.id
            }
            return task.listName.caseInsensitiveCompare(project.name) == .orderedSame
        }
    }
    
    private var currentTask: TaskItem? {
        guard !tasks.isEmpty else { return nil }
        let safeIndex = min(max(0, currentIndex), tasks.count - 1)
        return tasks[safeIndex]
    }
    
    var body: some View {
        NavigationStack {
            ZStack {
                Color(UIColor.systemGroupedBackground)
                    .ignoresSafeArea()
                
                VStack(spacing: 16) {
                    // Top Progress & Stats Bar
                    deckHeader
                    
                    Spacer(minLength: 8)
                    
                    // Card Area
                    if let task = currentTask {
                        cardStack(task: task)
                        
                        Spacer(minLength: 8)
                        
                        // Bottom Navigation & Actions Bar (only when active cards exist)
                        bottomActionBar
                    } else {
                        emptyDeckView
                        
                        Spacer(minLength: 16)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button {
                        dismiss()
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "chevron.down.circle.fill")
                                .font(.system(size: 20))
                                .foregroundColor(.secondary)
                        }
                    }
                }
                
                ToolbarItem(placement: .principal) {
                    HStack(spacing: 8) {
                        Circle()
                            .fill(project.safeAccentColor)
                            .frame(width: 10, height: 10)
                        Text(project.name)
                            .font(.headline)
                            .fontWeight(.bold)
                    }
                }
                
                ToolbarItem(placement: .navigationBarTrailing) {
                    Text("\(tasks.count) Left")
                        .font(.caption)
                        .fontWeight(.bold)
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color(.tertiarySystemFill))
                        .cornerRadius(6)
                }
            }
            .sheet(item: $activeFocusTask) { focusTask in
                SingleStepFocusView(task: binding(for: focusTask))
            }
        }
    }
    
    // MARK: - Deck Header
    private var deckHeader: some View {
        HStack {
            if !tasks.isEmpty {
                let totalMins = tasks.reduce(0) { $0 + $1.estimatedMinutes }
                HStack(spacing: 6) {
                    Image(systemName: "clock")
                        .font(.caption2)
                    Text("\(totalMins)m total estimated")
                        .font(.caption)
                        .fontWeight(.medium)
                }
                .foregroundColor(.secondary)
                
                Spacer()
                
                // Card Dots Indicator (up to 8 dots)
                HStack(spacing: 4) {
                    ForEach(0..<min(8, tasks.count), id: \.self) { idx in
                        Circle()
                            .fill(idx == currentIndex ? project.safeAccentColor : Color.secondary.opacity(0.3))
                            .frame(width: idx == currentIndex ? 7 : 5, height: idx == currentIndex ? 7 : 5)
                    }
                }
            }
        }
        .padding(.horizontal, 4)
    }
    
    // MARK: - Interactive Card Stack with Physical Depth
    @ViewBuilder
    private func cardStack(task: TaskItem) -> some View {
        ZStack {
            // Layer 2: Deep card shadow/edge (if 2+ cards remain)
            if tasks.count > 2 {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color(UIColor.secondarySystemGroupedBackground).opacity(0.6))
                    .frame(height: 340)
                    .offset(y: 12)
                    .scaleEffect(0.92)
                    .shadow(color: Color.black.opacity(0.04), radius: 6, x: 0, y: 3)
            }
            
            // Layer 1: Next card edge (if 1+ card behind)
            if tasks.count > 1 {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color(UIColor.secondarySystemGroupedBackground).opacity(0.85))
                    .frame(height: 340)
                    .offset(y: 6)
                    .scaleEffect(0.96)
                    .shadow(color: Color.black.opacity(0.05), radius: 8, x: 0, y: 4)
            }
            
            // Top Interactive Card
            TactileIndexCardView(
                task: task,
                projectColor: project.safeAccentColor,
                cardIndex: currentIndex,
                totalCards: tasks.count,
                dragOffset: dragOffset,
                onToggleSubtask: { subtaskId in
                    Task {
                        await supabase.toggleSubtask(task: task, subtaskId: subtaskId)
                    }
                },
                onStartSprint: {
                    activeFocusTask = task
                }
            )
            .offset(dragOffset)
            .rotationEffect(.degrees(Double(dragOffset.width / 20)))
            .gesture(
                DragGesture()
                    .onChanged { gesture in
                        self.dragOffset = gesture.translation
                    }
                    .onEnded { gesture in
                        handleGestureEnd(translation: gesture.translation)
                    }
            )
            .animation(.interactiveSpring(response: 0.35, dampingFraction: 0.7), value: dragOffset)
        }
    }
    
    // MARK: - Gesture Handling
    private func handleGestureEnd(translation: CGSize) {
        let h = translation.height
        let w = translation.width
        
        if h < -80 {
            // SWIPE UP: COMPLETE
            executeComplete()
        } else if w < -80 {
            // SWIPE LEFT: DEFER TO LATER
            executeDeferLater()
        } else if w > 80 {
            // SWIPE RIGHT: SPRINT
            executeStartSprint()
        } else {
            // Reset to center
            withAnimation(.spring()) {
                self.dragOffset = .zero
            }
        }
    }
    
    private func executeComplete() {
        guard let task = currentTask else { return }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        
        withAnimation(.easeOut(duration: 0.22)) {
            self.dragOffset = CGSize(width: 0, height: -600)
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.22) {
            withAnimation(.spring(response: 0.35, dampingFraction: 0.75)) {
                self.completedTaskIds.insert(task.id)
                self.dragOffset = .zero
                let remainingCount = self.tasks.count - 1
                if self.currentIndex >= remainingCount {
                    self.currentIndex = max(0, remainingCount - 1)
                }
            }
            Task {
                await supabase.markTaskCompleted(task: task)
            }
        }
    }
    
    private func executeDeferLater() {
        guard let task = currentTask else { return }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        
        withAnimation(.easeOut(duration: 0.22)) {
            self.dragOffset = CGSize(width: -600, height: 0)
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.22) {
            withAnimation(.spring(response: 0.35, dampingFraction: 0.75)) {
                self.deferredTaskIds.insert(task.id)
                self.dragOffset = .zero
                let remainingCount = self.tasks.count - 1
                if self.currentIndex >= remainingCount {
                    self.currentIndex = max(0, remainingCount - 1)
                }
            }
            Task {
                await supabase.deferTaskToLater(task: task)
            }
        }
    }
    
    private func executeStartSprint() {
        guard let task = currentTask else { return }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        withAnimation(.spring()) {
            self.dragOffset = .zero
        }
        self.activeFocusTask = task
    }
    
    private func binding(for task: TaskItem) -> Binding<TaskItem> {
        Binding(
            get: { activeFocusTask ?? task },
            set: { activeFocusTask = $0 }
        )
    }
    
    // MARK: - Bottom Actions Bar
    private var bottomActionBar: some View {
        VStack(spacing: 12) {
            HStack(spacing: 16) {
                // Later Button (Swipe Left equivalent)
                Button {
                    executeDeferLater()
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: "clock.arrow.circlepath")
                            .font(.system(size: 16, weight: .semibold))
                        Text("Later")
                            .font(.system(size: 10, weight: .bold))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Color(.secondarySystemGroupedBackground))
                    .foregroundColor(.blue)
                    .cornerRadius(12)
                    .shadow(color: Color.black.opacity(0.04), radius: 4, y: 2)
                }
                .buttonStyle(.plain)
                
                // Done Button (Swipe Up equivalent)
                Button {
                    executeComplete()
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 20))
                        Text("Done")
                            .font(.system(size: 10, weight: .heavy))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Color.green)
                    .foregroundColor(.white)
                    .cornerRadius(12)
                    .shadow(color: Color.green.opacity(0.25), radius: 6, y: 3)
                }
                .buttonStyle(.plain)
                
                // Focus Sprint Button (Swipe Right equivalent)
                Button {
                    executeStartSprint()
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: "play.fill")
                            .font(.system(size: 16))
                        Text("Sprint")
                            .font(.system(size: 10, weight: .bold))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Color(.secondarySystemGroupedBackground))
                    .foregroundColor(project.safeAccentColor)
                    .cornerRadius(12)
                    .shadow(color: Color.black.opacity(0.04), radius: 4, y: 2)
                }
                .buttonStyle(.plain)
            }
            
            // Previous & Next navigation controls
            if tasks.count > 1 {
                HStack {
                    Button {
                        if currentIndex > 0 {
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                            withAnimation(.spring()) { currentIndex -= 1 }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "chevron.left")
                            Text("Previous Card")
                        }
                        .font(.caption)
                        .foregroundColor(currentIndex > 0 ? .secondary : .secondary.opacity(0.3))
                    }
                    .disabled(currentIndex == 0)
                    
                    Spacer()
                    
                    Button {
                        if currentIndex < tasks.count - 1 {
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                            withAnimation(.spring()) { currentIndex += 1 }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Text("Next Card")
                            Image(systemName: "chevron.right")
                        }
                        .font(.caption)
                        .foregroundColor(currentIndex < tasks.count - 1 ? .secondary : .secondary.opacity(0.3))
                    }
                    .disabled(currentIndex >= tasks.count - 1)
                }
                .padding(.horizontal, 8)
                .padding(.top, 2)
            }
        }
    }
    
    // MARK: - Empty Deck View
    private var emptyDeckView: some View {
        VStack(spacing: 20) {
            ZStack {
                Circle()
                    .fill(project.safeAccentColor.opacity(0.12))
                    .frame(width: 88, height: 88)
                
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 46))
                    .foregroundColor(project.safeAccentColor)
            }
            .padding(.top, 12)
            
            VStack(spacing: 6) {
                Text("Deck Cleared!")
                    .font(.title2)
                    .fontWeight(.black)
                    .foregroundColor(.primary)
                
                Text("You've finished or deferred all active cards in \(project.name).")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 20)
            }
            
            Button {
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                dismiss()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "square.stack.3d.up.fill")
                        .font(.subheadline)
                    Text("Back to Card Stacks")
                        .font(.headline)
                        .fontWeight(.bold)
                }
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(project.safeAccentColor)
                )
                .shadow(color: project.safeAccentColor.opacity(0.3), radius: 8, x: 0, y: 4)
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 16)
            .padding(.top, 12)
        }
        .frame(maxWidth: .infinity)
        .padding(28)
        .background(Color(UIColor.secondarySystemGroupedBackground))
        .cornerRadius(20)
        .shadow(color: Color.black.opacity(0.04), radius: 10, y: 4)
    }
}
