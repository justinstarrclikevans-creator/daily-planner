import SwiftUI

struct CreateWorkflowFromAudioSheetView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var supabase = SupabaseService.shared
    @StateObject private var voiceCapture = VoiceCaptureManager()
    
    @State private var transcriptText: String = ""
    @State private var selectedDuration: TaskDuration = .thirty
    @State private var selectedProjectId: UUID? = nil
    @State private var isProcessing: Bool = false
    @State private var errorMessage: String? = nil
    
    var body: some View {
        NavigationStack {
            Form {
                Section(
                    header: Text("Audio / Transcript Input"),
                    footer: Text("Dictate with the microphone or paste notes from a recording or meeting. AI will format it into a sequential 1-step-at-a-time workflow.")
                ) {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Button {
                                if voiceCapture.isRecording {
                                    voiceCapture.stopRecording()
                                    if !voiceCapture.liveTranscript.isEmpty {
                                        transcriptText = voiceCapture.liveTranscript
                                    }
                                } else {
                                    voiceCapture.startRecording()
                                }
                            } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: voiceCapture.isRecording ? "stop.circle.fill" : "mic.fill")
                                    Text(voiceCapture.isRecording ? "Stop Dictating" : "Dictate Audio")
                                }
                                .font(.footnote)
                                .fontWeight(.bold)
                                .foregroundColor(.white)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(voiceCapture.isRecording ? Color.red : Color.indigo)
                                .cornerRadius(8)
                            }
                            
                            Spacer()
                            
                            if voiceCapture.isRecording {
                                Text("Listening...")
                                    .font(.caption)
                                    .foregroundColor(.red)
                            }
                        }
                        
                        TextEditor(text: voiceCapture.isRecording ? $voiceCapture.liveTranscript : $transcriptText)
                            .frame(minHeight: 140)
                            .font(.body)
                    }
                    .padding(.vertical, 4)
                }
                
                Section("Workflow Duration (Timed Overall)") {
                    Picker("Overall Time Budget", selection: $selectedDuration) {
                        ForEach(TaskDuration.allCases) { dur in
                            Text(dur.label).tag(dur)
                        }
                    }
                    .pickerStyle(.segmented)
                    
                    Text("This time budget applies to the entire workflow, not individual steps.")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                
                Section("Assign to Project") {
                    Picker("Project", selection: $selectedProjectId) {
                        Text("General / Personal").tag(Optional<UUID>(nil))
                        ForEach(supabase.projects) { proj in
                            Text(proj.name).tag(Optional<UUID>(proj.id))
                        }
                    }
                }
                
                if let err = errorMessage {
                    Section {
                        Text(err)
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                }
            }
            .navigationTitle("Audio Workflow Builder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        buildWorkflow()
                    } label: {
                        if isProcessing {
                            ProgressView()
                        } else {
                            Text("Create Workflow")
                                .fontWeight(.bold)
                        }
                    }
                    .disabled(effectiveTranscript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isProcessing)
                }
            }
        }
    }
    
    private var effectiveTranscript: String {
        voiceCapture.isRecording ? voiceCapture.liveTranscript : transcriptText
    }
    
    private func buildWorkflow() {
        let input = effectiveTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !input.isEmpty else { return }
        
        isProcessing = true
        errorMessage = nil
        
        let matchedProject = supabase.projects.first(where: { $0.id == selectedProjectId })
        
        Task {
            do {
                let result = try await GeminiVoiceService.shared.extractSequentialWorkflow(
                    transcript: input,
                    overallMinutes: selectedDuration.rawValue,
                    project: matchedProject
                )
                
                let stepMinutes = max(5, selectedDuration.rawValue / max(1, result.steps.count))
                let routineItems = result.steps.enumerated().map { idx, stepText in
                    RoutineItemStep(
                        title: stepText,
                        estimatedMinutes: stepMinutes,
                        firstFiveMinutes: idx == 0 ? "Open the workspace and read step 1." : nil
                    )
                }
                
                await supabase.createRoutine(
                    title: result.title,
                    description: result.description,
                    color: matchedProject?.color ?? "#6366F1",
                    icon: matchedProject?.icon ?? "sparkles",
                    items: routineItems,
                    projectId: selectedProjectId
                )
                
                await MainActor.run {
                    isProcessing = false
                    dismiss()
                }
            } catch {
                await MainActor.run {
                    isProcessing = false
                    errorMessage = "Failed to parse workflow: \(error.localizedDescription)"
                }
            }
        }
    }
}
