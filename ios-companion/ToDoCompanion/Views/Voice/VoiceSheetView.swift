import SwiftUI

struct VoiceSheetView: View {
    var activeProject: Project? = nil
    
    @Environment(\.dismiss) private var dismiss
    @StateObject private var voiceCapture = VoiceCaptureManager()
    @ObservedObject private var supabase = SupabaseService.shared
    @ObservedObject private var speechSynth = SpeechSynthesisService.shared
    
    @State private var voiceMode: Int = 0 // 0: Brain Dump, 1: Conversation
    @State private var isProcessing: Bool = false
    @State private var statusMessage: String = "Tap the microphone to speak"
    @State private var chatHistory: [ChatMessage] = []
    @State private var capturedResult: BrainDumpResult? = nil
    
    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                // Mode Toggle
                Picker("Voice Mode", selection: $voiceMode) {
                    Text("⚡ Brain Dump").tag(0)
                    Text("🎙️ Live Conversation").tag(1)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.top, 12)
                
                if voiceMode == 0 {
                    brainDumpContent
                } else {
                    conversationContent
                }
                
                Spacer()
                
                // Audio Waveform & Mic Controls
                bottomVoiceControls
            }
            .navigationTitle(activeProject != nil ? activeProject!.name : "Voice Assistant")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        voiceCapture.stopRecording()
                        speechSynth.stopSpeaking()
                        dismiss()
                    }
                }
            }
        }
    }
    
    // MARK: - Brain Dump Mode
    private var brainDumpContent: some View {
        VStack(spacing: 16) {
            if let result = capturedResult {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Label("Saved to \(result.projectName)", systemImage: "checkmark.circle.fill")
                            .font(.headline)
                            .foregroundColor(.green)
                        
                        Text(result.ideaSummary)
                            .font(.subheadline)
                            .padding()
                            .background(Color(.secondarySystemBackground))
                            .cornerRadius(12)
                        
                        if !result.tasks.isEmpty {
                            Text("Extracted Action Items:")
                                .font(.caption)
                                .fontWeight(.bold)
                                .foregroundColor(.secondary)
                            
                            ForEach(result.tasks, id: \.title) { task in
                                HStack {
                                    Image(systemName: "circle")
                                        .foregroundColor(.secondary)
                                    Text(task.title)
                                        .font(.subheadline)
                                    Spacer()
                                    Text(task.listName)
                                        .font(.caption2)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(Color.indigo.opacity(0.15))
                                        .cornerRadius(4)
                                }
                                .padding(8)
                                .background(Color(.secondarySystemBackground))
                                .cornerRadius(8)
                            }
                        }
                    }
                    .padding(.horizontal)
                }
            } else {
                VStack(spacing: 12) {
                    Text(voiceCapture.liveTranscript.isEmpty ? "Speak your thoughts, tasks, and ideas freely..." : voiceCapture.liveTranscript)
                        .font(.body)
                        .foregroundColor(voiceCapture.liveTranscript.isEmpty ? .secondary : .primary)
                        .multilineTextAlignment(.center)
                        .padding()
                        .frame(maxWidth: .infinity, minHeight: 140)
                        .background(Color(.secondarySystemBackground))
                        .cornerRadius(16)
                        .padding(.horizontal)
                    
                    if isProcessing {
                        ProgressView("Analyzing with Gemini...")
                            .font(.caption)
                    }
                }
            }
        }
    }
    
    // MARK: - Conversation Mode
    private var conversationContent: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 12) {
                    if chatHistory.isEmpty {
                        VStack(spacing: 8) {
                            Image(systemName: "bubble.left.and.bubble.right")
                                .font(.system(size: 40))
                                .foregroundColor(.secondary)
                            Text("Speak out loud to brainstorm with your executive coach.")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                                .multilineTextAlignment(.center)
                        }
                        .padding(.top, 40)
                        .padding(.horizontal)
                    } else {
                        ForEach(chatHistory) { msg in
                            HStack {
                                if msg.role == "user" {
                                    Spacer()
                                    Text(msg.text)
                                        .padding(12)
                                        .background(Color.indigo)
                                        .foregroundColor(.white)
                                        .cornerRadius(16)
                                } else {
                                    Text(msg.text)
                                        .padding(12)
                                        .background(Color(.secondarySystemBackground))
                                        .foregroundColor(.primary)
                                        .cornerRadius(16)
                                    Spacer()
                                }
                            }
                            .id(msg.id)
                        }
                    }
                }
                .padding(.horizontal)
            }
            .onChange(of: chatHistory.count) { _ in
                if let last = chatHistory.last {
                    withAnimation {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
        }
    }
    
    // MARK: - Bottom Mic & Waveform
    private var bottomVoiceControls: some View {
        VStack(spacing: 16) {
            WaveformView(audioLevel: voiceCapture.audioLevel, isRecording: voiceCapture.isRecording)
            
            HStack(spacing: 30) {
                Button(action: toggleRecording) {
                    ZStack {
                        Circle()
                            .fill(voiceCapture.isRecording ? Color.red : Color.indigo)
                            .frame(width: 72, height: 72)
                            .shadow(color: (voiceCapture.isRecording ? Color.red : Color.indigo).opacity(0.35), radius: 10, x: 0, y: 5)
                        
                        Image(systemName: voiceCapture.isRecording ? "stop.fill" : "mic.fill")
                            .font(.title)
                            .foregroundColor(.white)
                    }
                }
            }
            
            Text(voiceCapture.isRecording ? "Listening... tap to process" : (isProcessing ? "Processing..." : "Tap mic to start"))
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(.bottom, 24)
    }
    
    private func toggleRecording() {
        if voiceCapture.isRecording {
            let transcript = voiceCapture.stopRecording()
            if !transcript.isEmpty {
                processAudioTranscript(transcript)
            }
        } else {
            capturedResult = nil
            voiceCapture.startRecording()
        }
    }
    
    private func processAudioTranscript(_ transcript: String) {
        guard !transcript.isEmpty else { return }
        isProcessing = true
        
        Task {
            defer { isProcessing = false }
            
            if voiceMode == 0 {
                // Brain Dump Pipeline
                do {
                    let result = try await GeminiVoiceService.shared.parseBrainDump(transcript: transcript, projects: supabase.projects)
                    self.capturedResult = result
                    
                    // Match project
                    let matchedProject = supabase.projects.first { $0.name.caseInsensitiveCompare(result.projectName) == .orderedSame }
                    let projectId = matchedProject?.id
                    
                    // 1. Save Idea to Supabase
                    await supabase.createIdea(
                        projectId: projectId,
                        rawTranscript: transcript,
                        summary: result.ideaSummary,
                        tags: result.tags
                    )
                    
                    // 2. Save Tasks to Apple Reminders & Supabase
                    for extracted in result.tasks {
                        let subtaskItems = (extracted.subtasks ?? []).map { SubtaskItem(title: $0, isCompleted: false) }
                        
                        let reminderId = try? await RemindersManager.shared.addReminder(
                            title: extracted.title,
                            notes: TaskItem.buildDescription(
                                cleanNotes: extracted.description ?? "",
                                estimatedMinutes: extracted.estimatedMinutes,
                                inPlayQueue: false,
                                firstFiveMinutes: extracted.firstFiveMinutes,
                                subtasks: subtaskItems
                            ),
                            listName: extracted.listName
                        )
                        
                        await supabase.createTask(
                            title: extracted.title,
                            description: extracted.description,
                            listName: extracted.listName,
                            projectId: projectId,
                            appleReminderId: reminderId,
                            estimatedMinutes: extracted.estimatedMinutes,
                            inPlayQueue: false,
                            firstFiveMinutes: extracted.firstFiveMinutes,
                            subtasks: subtaskItems
                        )
                    }
                    
                    // Speak back confirmation chime
                    SpeechSynthesisService.shared.speak("Saved \(result.tasks.count) tasks to \(result.projectName).")
                } catch {
                    print("Brain dump error: \(error.localizedDescription)")
                }
            } else {
                // Conversational Pipeline
                chatHistory.append(ChatMessage(role: "user", text: transcript))
                
                do {
                    let reply = try await GeminiVoiceService.shared.chatConversation(history: chatHistory, activeProject: activeProject)
                    chatHistory.append(ChatMessage(role: "model", text: reply))
                    SpeechSynthesisService.shared.speak(reply)
                } catch {
                    print("Chat error: \(error.localizedDescription)")
                }
            }
        }
    }
}
