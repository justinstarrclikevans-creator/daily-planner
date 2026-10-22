import SwiftUI
import Combine

struct TaskFocusSheetView: View {
    @Binding var task: TaskItem
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var supabase = SupabaseService.shared
    @ObservedObject private var speechSynth = SpeechSynthesisService.shared
    
    // Timer state
    enum TimerMode: String, CaseIterable, Identifiable {
        case firstFive = "⚡ First 5 Min"
        case full = "⏱ Full Task"
        
        var id: String { rawValue }
    }
    
    @State private var timerMode: TimerMode = .firstFive
    @State private var totalSeconds: Int = 300 // default 5 minutes
    @State private var secondsRemaining: Int = 300
    @State private var isRunning: Bool = false
    @State private var didAnnounceHalfway: Bool = false
    @State private var didAnnounceFinish: Bool = false
    @State private var showSingleStepRunner: Bool = false
    
    // Subtask and AI breakdown state
    @State private var newStepTitle: String = ""
    @State private var selectedDetailLevel: BreakdownDetailLevel = .balanced
    @State private var isGeneratingBreakdown: Bool = false
    @State private var breakdownError: String? = nil
    
    let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    // Task Header
                    headerSection
                    
                    // Single-Step Zero-Paralysis Runner Action Card
                    Button {
                        showSingleStepRunner = true
                    } label: {
                        HStack(spacing: 12) {
                            ZStack {
                                Circle()
                                    .fill(Color.white.opacity(0.2))
                                    .frame(width: 40, height: 40)
                                Image(systemName: "flame.fill")
                                    .font(.headline)
                                    .foregroundColor(.white)
                            }
                            
                            VStack(alignment: .leading, spacing: 2) {
                                Text("RUN 1-STEP ZERO-PARALYSIS MODE")
                                    .font(.subheadline)
                                    .fontWeight(.black)
                                    .foregroundColor(.white)
                                Text("Shows 1 step at a time • Overall \(task.estimatedMinutes)m timer • Fighting quotes")
                                    .font(.caption2)
                                    .foregroundColor(.white.opacity(0.9))
                            }
                            
                            Spacer()
                            
                            Image(systemName: "arrow.right.circle.fill")
                                .font(.title3)
                                .foregroundColor(.white)
                        }
                        .padding(14)
                        .background(
                            LinearGradient(
                                colors: [.red, .orange],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .cornerRadius(14)
                        .shadow(color: Color.red.opacity(0.3), radius: 6, x: 0, y: 3)
                    }
                    .padding(.horizontal)
                    .fullScreenCover(isPresented: $showSingleStepRunner) {
                        SingleStepFocusView(task: $task)
                    }
                    
                    // Timer Mode Selector
                    Picker("Timer Mode", selection: $timerMode) {
                        ForEach(TimerMode.allCases) { mode in
                            Text(mode == .firstFive ? "⚡ First 5 Min Sprint" : "⏱ Full (\(task.estimatedMinutes)m)").tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal)
                    .onChange(of: timerMode) { newMode in
                        resetTimer(for: newMode)
                    }
                    
                    // Circular Focus Timer Ring
                    timerRingSection
                    
                    // First 5 Minutes Starter Prompt Callout
                    starterPromptSection
                    
                    // Subtasks Checklist
                    subtasksSection
                    
                    // AI Breakdown Assistant
                    aiBreakdownSection
                    
                    // Bottom Actions
                    bottomActionsSection
                }
                .padding(.vertical)
            }
            .navigationTitle("Focus Sprint")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Close") {
                        stopTimer()
                        dismiss()
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        togglePlayQueue()
                    } label: {
                        Label(
                            task.inPlayQueue ? "In Queue" : "Add to Queue",
                            systemImage: task.inPlayQueue ? "play.circle.fill" : "plus.circle"
                        )
                        .foregroundColor(task.inPlayQueue ? .indigo : .secondary)
                    }
                }
            }
            .onAppear {
                setupInitialTimer()
                NotificationService.shared.requestAuthorization()
            }
            .onReceive(timer) { _ in
                handleTimerTick()
            }
        }
    }
    
    // MARK: - Header
    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(task.listName)
                    .font(.caption2)
                    .fontWeight(.bold)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color.indigo.opacity(0.15))
                    .foregroundColor(.indigo)
                    .cornerRadius(6)
                
                Spacer()
                
                HStack(spacing: 4) {
                    Image(systemName: "clock")
                        .font(.caption2)
                    Text("\(task.estimatedMinutes) min estimated")
                        .font(.caption2)
                        .fontWeight(.medium)
                }
                .foregroundColor(.secondary)
            }
            
            Text(task.title)
                .font(.title3)
                .fontWeight(.bold)
                .foregroundColor(.primary)
            
            if !task.cleanDescription.isEmpty {
                Text(task.cleanDescription)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .padding(.top, 2)
            }
        }
        .padding(.horizontal)
    }
    
    // MARK: - Timer Ring Section
    private var timerRingSection: some View {
        VStack(spacing: 16) {
            ZStack {
                // Background Track
                Circle()
                    .stroke(Color.secondary.opacity(0.15), lineWidth: 14)
                    .frame(width: 200, height: 200)
                
                // Progress Stroke
                Circle()
                    .trim(from: 0, to: progressFraction)
                    .stroke(
                        LinearGradient(
                            colors: timerMode == .firstFive ? [.orange, .yellow] : [.indigo, .purple],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        style: StrokeStyle(lineWidth: 14, lineCap: .round)
                    )
                    .frame(width: 200, height: 200)
                    .rotationEffect(.degrees(-90))
                    .animation(.linear(duration: 1.0), value: secondsRemaining)
                
                // Centered Digits & Status
                VStack(spacing: 4) {
                    Text(formattedTime(secondsRemaining))
                        .font(.system(size: 42, weight: .bold, design: .rounded))
                        .monospacedDigit()
                    
                    Text(timerStatusLabel)
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundColor(timerMode == .firstFive ? .orange : .indigo)
                }
            }
            .padding(.top, 6)
            
            // Timer Control Buttons
            HStack(spacing: 24) {
                Button(action: resetTimerCurrent) {
                    Image(systemName: "arrow.counterclockwise")
                        .font(.title3)
                        .foregroundColor(.secondary)
                        .frame(width: 44, height: 44)
                        .background(Color(.secondarySystemBackground))
                        .clipShape(Circle())
                }
                
                Button(action: toggleTimer) {
                    Image(systemName: isRunning ? "pause.fill" : "play.fill")
                        .font(.title2)
                        .foregroundColor(.white)
                        .frame(width: 64, height: 64)
                        .background(
                            Circle()
                                .fill(timerMode == .firstFive ? Color.orange : Color.indigo)
                        )
                        .shadow(color: (timerMode == .firstFive ? Color.orange : Color.indigo).opacity(0.35), radius: 8, x: 0, y: 4)
                }
                
                Button(action: addOneMinute) {
                    Text("+1m")
                        .font(.footnote)
                        .fontWeight(.bold)
                        .foregroundColor(.secondary)
                        .frame(width: 44, height: 44)
                        .background(Color(.secondarySystemBackground))
                        .clipShape(Circle())
                }
                
                Button(action: addFiveMinutes) {
                    Text("+5m")
                        .font(.footnote)
                        .fontWeight(.bold)
                        .foregroundColor(.secondary)
                        .frame(width: 44, height: 44)
                        .background(Color(.secondarySystemBackground))
                        .clipShape(Circle())
                }
            }
        }
    }
    
    // MARK: - First 5 Minutes Starter Prompt
    private var starterPromptSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("First 5 Minutes Starter", systemImage: "bolt.fill")
                    .font(.footnote)
                    .fontWeight(.bold)
                    .foregroundColor(.orange)
                
                Spacer()
            }
            
            if let prompt = task.firstFiveMinutesPrompt, !prompt.isEmpty {
                Text(prompt)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundColor(.primary)
            } else {
                Text("Start with the smallest 60-second action: open the workspace, read line 1, or type 1 sentence.")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.1))
        .cornerRadius(14)
        .padding(.horizontal)
    }
    
    // MARK: - Subtasks Section
    private var subtasksSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Subtasks & Milestones")
                    .font(.headline)
                
                Spacer()
                
                if !task.subtasks.isEmpty {
                    let completed = task.subtasks.filter { $0.isCompleted }.count
                    Text("\(completed)/\(task.subtasks.count) completed")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            
            if !task.subtasks.isEmpty {
                VStack(spacing: 8) {
                    ForEach(task.subtasks) { step in
                        HStack(alignment: .center, spacing: 12) {
                            Button {
                                toggleSubtask(step)
                            } label: {
                                Image(systemName: step.isCompleted ? "checkmark.circle.fill" : "circle")
                                    .font(.title3)
                                    .foregroundColor(step.isCompleted ? .green : .secondary)
                            }
                            .buttonStyle(.plain)
                            
                            Text(step.title)
                                .font(.subheadline)
                                .strikethrough(step.isCompleted)
                                .foregroundColor(step.isCompleted ? .secondary : .primary)
                            
                            Spacer()
                            
                            Button {
                                deleteSubtask(step)
                            } label: {
                                Image(systemName: "xmark")
                                    .font(.caption2)
                                    .foregroundColor(.secondary.opacity(0.6))
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(.vertical, 4)
                        
                        if step.id != task.subtasks.last?.id {
                            Divider()
                        }
                    }
                }
                .padding()
                .background(Color(.secondarySystemBackground))
                .cornerRadius(14)
            }
            
            // Inline Add Step Field
            HStack {
                TextField("Add a bite-sized step...", text: $newStepTitle)
                    .font(.subheadline)
                    .onSubmit {
                        addManualStep()
                    }
                
                if !newStepTitle.trimmingCharacters(in: .whitespaces).isEmpty {
                    Button(action: addManualStep) {
                        Image(systemName: "plus.circle.fill")
                            .foregroundColor(.indigo)
                    }
                }
            }
            .padding(12)
            .background(Color(.secondarySystemBackground))
            .cornerRadius(12)
        }
        .padding(.horizontal)
    }
    
    // MARK: - AI Breakdown Section
    private var aiBreakdownSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("AI Step Breakdown", systemImage: "sparkles")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(.indigo)
                
                Spacer()
            }
            
            Picker("Detail Level", selection: $selectedDetailLevel) {
                ForEach(BreakdownDetailLevel.allCases) { level in
                    Text(level.shortLabel).tag(level)
                }
            }
            .pickerStyle(.segmented)
            
            Button {
                Task {
                    await generateAIBreakdown()
                }
            } label: {
                HStack {
                    if isGeneratingBreakdown {
                        ProgressView()
                            .tint(.white)
                            .padding(.trailing, 4)
                        Text("Breaking down task with Gemini...")
                    } else {
                        Image(systemName: "sparkles")
                        Text("Generate \(selectedDetailLevel.shortLabel)")
                    }
                }
                .font(.subheadline)
                .fontWeight(.medium)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(Color.indigo)
                .foregroundColor(.white)
                .cornerRadius(10)
            }
            .disabled(isGeneratingBreakdown)
            
            if let err = breakdownError {
                Text(err)
                    .font(.caption)
                    .foregroundColor(.red)
            }
        }
        .padding()
        .background(Color.indigo.opacity(0.06))
        .cornerRadius(14)
        .padding(.horizontal)
    }
    
    // MARK: - Bottom Actions
    private var bottomActionsSection: some View {
        VStack(spacing: 12) {
            Button {
                markTaskComplete()
            } label: {
                HStack {
                    Image(systemName: "checkmark.circle.fill")
                    Text("Mark Task Complete")
                }
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Color.green)
                .foregroundColor(.white)
                .cornerRadius(14)
                .shadow(color: Color.green.opacity(0.3), radius: 6, x: 0, y: 3)
            }
        }
        .padding(.horizontal)
        .padding(.top, 8)
    }
    
    // MARK: - Timer Logic
    private var progressFraction: CGFloat {
        guard totalSeconds > 0 else { return 0 }
        let elapsed = totalSeconds - secondsRemaining
        return CGFloat(max(0, min(totalSeconds, elapsed))) / CGFloat(totalSeconds)
    }
    
    private var timerStatusLabel: String {
        if secondsRemaining == 0 {
            return "Target Eliminated. Don't slow down."
        } else if isRunning {
            return timerMode == .firstFive ? "Momentum Sprint" : "Deep Focus"
        } else {
            return "Paused"
        }
    }
    
    private func setupInitialTimer() {
        resetTimer(for: timerMode)
    }
    
    private func resetTimer(for mode: TimerMode) {
        isRunning = false
        didAnnounceHalfway = false
        didAnnounceFinish = false
        if mode == .firstFive {
            totalSeconds = 300 // 5 minutes
        } else {
            totalSeconds = max(60, task.estimatedMinutes * 60)
        }
        secondsRemaining = totalSeconds
    }
    
    private func resetTimerCurrent() {
        resetTimer(for: timerMode)
    }
    
    private func toggleTimer() {
        isRunning.toggle()
        if isRunning {
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            NotificationService.shared.scheduleFocusTimerNotifications(taskTitle: task.title, totalSeconds: secondsRemaining)
            if secondsRemaining == totalSeconds {
                speechSynth.speak(timerMode == .firstFive ? "Starting 5-minute momentum sprint. Ready, set, go!" : "Starting deep focus timer.")
            }
        } else {
            NotificationService.shared.cancelFocusNotifications()
        }
    }
    
    private func stopTimer() {
        isRunning = false
        speechSynth.stopSpeaking()
        NotificationService.shared.cancelFocusNotifications()
    }
    
    private func addOneMinute() {
        secondsRemaining += 60
        totalSeconds += 60
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        if isRunning {
            NotificationService.shared.scheduleFocusTimerNotifications(taskTitle: task.title, totalSeconds: secondsRemaining)
        }
    }
    
    private func addFiveMinutes() {
        secondsRemaining += 300
        totalSeconds += 300
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        if isRunning {
            NotificationService.shared.scheduleFocusTimerNotifications(taskTitle: task.title, totalSeconds: secondsRemaining)
        }
    }
    
    private func handleTimerTick() {
        guard isRunning else { return }
        if secondsRemaining > 0 {
            secondsRemaining -= 1
            
            // Halfway voice / haptic check
            let halfway = totalSeconds / 2
            if secondsRemaining == halfway && !didAnnounceHalfway {
                didAnnounceHalfway = true
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                speechSynth.speak("Halfway point. Keep your momentum going!")
            }
        } else {
            isRunning = false
            if !didAnnounceFinish {
                didAnnounceFinish = true
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                speechSynth.speak(timerMode == .firstFive ? "5 minutes elapsed. Don't slow down, attack the next step." : "Timer reached zero. Attack the next target.")
            }
        }
    }
    
    private func formattedTime(_ secs: Int) -> String {
        let m = secs / 60
        let s = secs % 60
        return String(format: "%02d:%02d", m, s)
    }
    
    // MARK: - Subtask Operations
    private func toggleSubtask(_ item: SubtaskItem) {
        var currentSubtasks = task.subtasks
        guard let index = currentSubtasks.firstIndex(where: { $0.id == item.id }) else { return }
        currentSubtasks[index].isCompleted.toggle()
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        
        task.updateMetadata(subtasks: currentSubtasks)
        saveTaskToSupabase()
    }
    
    private func deleteSubtask(_ item: SubtaskItem) {
        var currentSubtasks = task.subtasks
        currentSubtasks.removeAll(where: { $0.id == item.id })
        task.updateMetadata(subtasks: currentSubtasks)
        saveTaskToSupabase()
    }
    
    private func addManualStep() {
        let trimmed = newStepTitle.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        
        var currentSubtasks = task.subtasks
        currentSubtasks.append(SubtaskItem(title: trimmed, isCompleted: false))
        task.updateMetadata(subtasks: currentSubtasks)
        newStepTitle = ""
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        saveTaskToSupabase()
    }
    
    private func generateAIBreakdown() async {
        isGeneratingBreakdown = true
        breakdownError = nil
        defer { isGeneratingBreakdown = false }
        
        do {
            let result = try await GeminiVoiceService.shared.generateTaskBreakdown(
                title: task.title,
                context: task.cleanDescription,
                detailLevel: selectedDetailLevel
            )
            
            let newSubtasks = result.steps.map { SubtaskItem(title: $0, isCompleted: false) }
            task.updateMetadata(
                estimatedMinutes: result.estimatedMinutes,
                firstFiveMinutes: result.firstFiveMinutes,
                subtasks: newSubtasks
            )
            
            // Adjust full timer duration if currently on full mode
            if timerMode == .full {
                resetTimer(for: .full)
            }
            
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            speechSynth.speak("Broke down \(task.title) into \(result.steps.count) steps.")
            saveTaskToSupabase()
        } catch {
            breakdownError = "Failed to generate steps: \(error.localizedDescription)"
        }
    }
    
    private func togglePlayQueue() {
        task.updateMetadata(inPlayQueue: !task.inPlayQueue)
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        saveTaskToSupabase()
    }
    
    private func markTaskComplete() {
        stopTimer()
        let elapsed = max(1, totalSeconds - secondsRemaining)
        task.actualSeconds = elapsed
        task.isCompleted = true
        task.updateMetadata(actualSeconds: elapsed)
        UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
        Task {
            await supabase.updateTask(task)
            await supabase.toggleTaskCompletion(task: task)
            dismiss()
        }
    }
    
    private func saveTaskToSupabase() {
        Task {
            await supabase.updateTask(task)
        }
    }
}
