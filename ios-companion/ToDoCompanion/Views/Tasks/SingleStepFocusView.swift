import SwiftUI
import Combine

struct SingleStepFocusView: View {
    @Binding var task: TaskItem
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var supabase = SupabaseService.shared
    @ObservedObject private var speechSynth = SpeechSynthesisService.shared
    
    // Steps to execute 1-at-a-time
    @State private var steps: [String] = []
    @State private var currentStepIndex: Int = 0
    @State private var isFinished: Bool = false
    
    // Overall Countdown Timer (Timed OVERALL, not per step)
    @State private var totalSeconds: Int = 900 // default 15m
    @State private var secondsRemaining: Int = 900
    @State private var isRunning: Bool = true
    @State private var startTime: Date = Date()
    @State private var loggedActualSeconds: Int = 0
    
    // Raw Aggressive Fighting Quotes Pool
    let aggressiveQuotes = [
        "Don't fuck it up.",
        "Clock is bleeding. Move.",
        "Quit bullshitting and finish the drill.",
        "Nobody is coming to save you. Execute.",
        "One step. Right now. Do not hesitate.",
        "Put your head down and knock this out.",
        "Stop thinking. Start moving.",
        "Kill the distractions. Attack.",
        "Discipline is doing what you hate like you love it.",
        "No excuses. Finish the job."
    ]
    @State private var currentQuote: String = "Don't fuck it up."
    
    let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
    
    var body: some View {
        NavigationStack {
            ZStack {
                Color(.systemBackground).ignoresSafeArea()
                
                if isFinished {
                    aggressiveFinishView
                } else {
                    activeStepView
                }
            }
            .navigationTitle("Focus Execution")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Exit") {
                        stopSession()
                        dismiss()
                    }
                    .foregroundColor(.secondary)
                }
                
                ToolbarItem(placement: .confirmationAction) {
                    if !isFinished {
                        Button("Finish Early") {
                            completeEntireTask()
                        }
                        .font(.footnote)
                        .fontWeight(.bold)
                        .foregroundColor(.indigo)
                    }
                }
            }
            .onAppear {
                setupSession()
            }
            .onReceive(timer) { _ in
                handleTimerTick()
            }
        }
    }
    
    // MARK: - Active Single-Step View (Zero-Paralysis Mode)
    private var activeStepView: some View {
        VStack(spacing: 24) {
            // Aggressive Fighting Quote Banner
            HStack(spacing: 10) {
                Image(systemName: "flame.fill")
                    .foregroundColor(.red)
                
                Text(currentQuote)
                    .font(.subheadline)
                    .fontWeight(.black)
                    .textCase(.uppercase)
                    .foregroundColor(.red)
                    .tracking(0.5)
                
                Spacer()
                
                Button {
                    cycleQuote()
                } label: {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.caption2)
                        .foregroundColor(.red.opacity(0.8))
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Color.red.opacity(0.12))
            .cornerRadius(10)
            
            // Overall Workflow Countdown Timer Header
            VStack(spacing: 6) {
                HStack {
                    Label("\(task.listName)", systemImage: "target")
                        .font(.caption)
                        .fontWeight(.bold)
                        .foregroundColor(.secondary)
                    
                    Spacer()
                    
                    Text("⏱ OVERALL TIMER (\(task.estimatedMinutes)M)")
                        .font(.caption2)
                        .fontWeight(.black)
                        .tracking(0.5)
                        .foregroundColor(.secondary)
                }
                
                // Giant Digits & Progress Bar
                HStack(alignment: .lastTextBaseline) {
                    Text(formattedTime(secondsRemaining))
                        .font(.system(size: 48, weight: .black, design: .monospaced))
                        .foregroundColor(secondsRemaining < 180 ? .red : .primary)
                    
                    Spacer()
                    
                    Text(isRunning ? "BURNING" : "PAUSED")
                        .font(.caption2)
                        .fontWeight(.heavy)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(isRunning ? Color.orange.opacity(0.15) : Color.secondary.opacity(0.15))
                        .foregroundColor(isRunning ? .orange : .secondary)
                        .cornerRadius(6)
                }
                
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(Color.secondary.opacity(0.15))
                            .frame(height: 8)
                        Capsule()
                            .fill(
                                LinearGradient(
                                    colors: secondsRemaining < 180 ? [.red, .orange] : [.indigo, .purple],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                            .frame(width: max(0, min(geo.size.width, geo.size.width * CGFloat(secondsRemaining) / CGFloat(max(1, totalSeconds)))), height: 8)
                    }
                }
                .frame(height: 8)
            }
            .padding()
            .background(Color(.secondarySystemBackground))
            .cornerRadius(16)
            
            Spacer(minLength: 12)
            
            // Single Step Focus Card (ONLY ONE STEP VISIBLE)
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("STEP \(currentStepIndex + 1) OF \(max(1, steps.count))")
                        .font(.system(size: 11, weight: .black))
                        .tracking(1.5)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.indigo)
                        .foregroundColor(.white)
                        .cornerRadius(6)
                    
                    Spacer()
                    
                    Text(task.title)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
                
                Text(currentStepTitle)
                    .font(.system(size: 26, weight: .bold))
                    .foregroundColor(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, 6)
                
                if let starter = task.firstFiveMinutesPrompt, currentStepIndex == 0, !starter.isEmpty {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "bolt.fill")
                            .foregroundColor(.orange)
                            .font(.caption)
                        Text("Micro Starter: \(starter)")
                            .font(.footnote)
                            .foregroundColor(.secondary)
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.orange.opacity(0.1))
                    .cornerRadius(8)
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 18)
                    .fill(Color(.secondarySystemBackground))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18)
                            .stroke(Color.indigo.opacity(0.3), lineWidth: 1.5)
                    )
            )
            .shadow(color: Color.black.opacity(0.04), radius: 8, x: 0, y: 4)
            
            Spacer(minLength: 12)
            
            // Giant Next Action Button
            Button {
                advanceStep()
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: isLastStep ? "checkmark.seal.fill" : "arrow.right.circle.fill")
                        .font(.title3)
                    
                    Text(isLastStep ? "FINISHED — COMPLETE TASK" : "STEP DONE → NEXT STEP")
                        .font(.headline)
                        .fontWeight(.black)
                }
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 18)
                .background(isLastStep ? Color.red : Color.indigo)
                .cornerRadius(16)
                .shadow(color: (isLastStep ? Color.red : Color.indigo).opacity(0.35), radius: 8, x: 0, y: 4)
            }
            .padding(.bottom, 12)
        }
        .padding()
    }
    
    // MARK: - Aggressive Completion Verdict Screen
    private var aggressiveFinishView: some View {
        VStack(spacing: 24) {
            Spacer()
            
            ZStack {
                Circle()
                    .fill(Color.red.opacity(0.15))
                    .frame(width: 88, height: 88)
                Image(systemName: "flame.fill")
                    .font(.system(size: 40))
                    .foregroundColor(.red)
            }
            
            VStack(spacing: 8) {
                Text("TARGET ELIMINATED")
                    .font(.system(size: 28, weight: .black))
                    .foregroundColor(.primary)
                
                Text(task.title)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }
            
            // Velocity Learning Box
            VStack(spacing: 12) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("ACTUAL TIME")
                            .font(.system(size: 10, weight: .black))
                            .foregroundColor(.secondary)
                        Text("\(loggedActualSeconds / 60)m \(loggedActualSeconds % 60)s")
                            .font(.title2)
                            .fontWeight(.bold)
                    }
                    
                    Spacer()
                    
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("ESTIMATED")
                            .font(.system(size: 10, weight: .black))
                            .foregroundColor(.secondary)
                        Text("\(task.estimatedMinutes)m")
                            .font(.title2)
                            .fontWeight(.bold)
                    }
                }
                
                Divider()
                
                Text(velocityVerdictText)
                    .font(.footnote)
                    .fontWeight(.bold)
                    .foregroundColor(loggedActualSeconds <= task.estimatedMinutes * 60 ? .green : .orange)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(16)
            .background(Color(.secondarySystemBackground))
            .cornerRadius(14)
            
            // Hard Fighting Mandate (No Soft Celebrations)
            VStack(spacing: 6) {
                Text("“Don't slow down. Attack the next one.”")
                    .font(.headline)
                    .fontWeight(.black)
                    .foregroundColor(.red)
                
                Text("Your mac daemon has recorded your completion. Do not sit idle for 15 minutes.")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding()
            .frame(maxWidth: .infinity)
            .background(Color.red.opacity(0.08))
            .cornerRadius(12)
            
            Spacer()
            
            Button {
                dismiss()
            } label: {
                Text("NEXT TARGET")
                    .font(.headline)
                    .fontWeight(.black)
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(Color.primary)
                    .cornerRadius(14)
            }
            .padding(.bottom, 16)
        }
        .padding()
    }
    
    // MARK: - Logic & Actions
    private var isLastStep: Bool {
        currentStepIndex >= steps.count - 1
    }
    
    private var currentStepTitle: String {
        guard currentStepIndex < steps.count else { return task.title }
        return steps[currentStepIndex]
    }
    
    private var velocityVerdictText: String {
        let estSeconds = task.estimatedMinutes * 60
        if loggedActualSeconds <= estSeconds {
            let diff = (estSeconds - loggedActualSeconds) / 60
            return "⚡ Locked in: Finished \(diff)m faster than estimated."
        } else {
            let diff = (loggedActualSeconds - estSeconds) / 60
            return "⚠️ Overtime: Exceeded estimate by \(diff)m. Keep drills shorter."
        }
    }
    
    private func setupSession() {
        startTime = Date()
        currentQuote = aggressiveQuotes.randomElement() ?? "Don't fuck it up."
        
        // 1. Resolve steps (From subtasks or task title)
        if !task.subtasks.isEmpty {
            self.steps = task.subtasks.map { $0.title }
        } else {
            self.steps = [task.title]
        }
        
        // 2. Set overall timer duration
        self.totalSeconds = max(60, task.estimatedMinutes * 60)
        self.secondsRemaining = totalSeconds
        self.isRunning = true
        
        UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
    }
    
    private func handleTimerTick() {
        guard isRunning && !isFinished else { return }
        if secondsRemaining > 0 {
            secondsRemaining -= 1
        }
    }
    
    private func advanceStep() {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        if isLastStep {
            completeEntireTask()
        } else {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                currentStepIndex += 1
                currentQuote = aggressiveQuotes.randomElement() ?? "Clock is bleeding. Move."
            }
        }
    }
    
    private func completeEntireTask() {
        stopSession()
        let elapsed = max(1, Int(Date().timeIntervalSince(startTime)))
        self.loggedActualSeconds = elapsed
        
        // Update task model
        task.actualSeconds = elapsed
        task.isCompleted = true
        
        // Mark subtasks complete
        var updatedSubtasks = task.subtasks
        for i in 0..<updatedSubtasks.count {
            updatedSubtasks[i].isCompleted = true
        }
        task.updateMetadata(subtasks: updatedSubtasks, actualSeconds: elapsed)
        
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        
        Task {
            await supabase.updateTask(task)
            await supabase.toggleTaskCompletion(task: task)
        }
        
        withAnimation {
            self.isFinished = true
        }
    }
    
    private func stopSession() {
        isRunning = false
    }
    
    private func cycleQuote() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        var next = aggressiveQuotes.randomElement() ?? "Move."
        while next == currentQuote && aggressiveQuotes.count > 1 {
            next = aggressiveQuotes.randomElement() ?? "Move."
        }
        currentQuote = next
    }
    
    private func formattedTime(_ secs: Int) -> String {
        let m = secs / 60
        let s = secs % 60
        return String(format: "%02d:%02d", m, s)
    }
}
