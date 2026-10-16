import Foundation
import Speech
import AVFoundation

@MainActor
class VoiceCaptureManager: ObservableObject {
    @Published var isRecording: Bool = false
    @Published var liveTranscript: String = ""
    @Published var audioLevel: Float = 0.0
    @Published var permissionGranted: Bool = false
    @Published var errorMessage: String? = nil
    
    private let speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private let audioEngine = AVAudioEngine()
    
    init() {
        requestPermissions()
    }
    
    func requestPermissions() {
        SFSpeechRecognizer.requestAuthorization { authStatus in
            AVAudioApplication.requestRecordPermission { micGranted in
                Task { @MainActor in
                    self.permissionGranted = (authStatus == .authorized) && micGranted
                }
            }
        }
    }
    
    func startRecording() {
        guard permissionGranted else {
            errorMessage = "Please grant microphone and speech recognition permissions in Settings."
            return
        }
        
        // Stop any active session
        stopRecording()
        liveTranscript = ""
        errorMessage = nil
        
        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .allowBluetooth])
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
            
            recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
            guard let recognitionRequest = recognitionRequest else { return }
            recognitionRequest.shouldReportPartialResults = true
            
            let inputNode = audioEngine.inputNode
            
            recognitionTask = speechRecognizer?.recognitionTask(with: recognitionRequest) { [weak self] result, error in
                guard let self = self else { return }
                
                if let result = result {
                    Task { @MainActor in
                        self.liveTranscript = result.bestTranscription.formattedString
                    }
                }
                
                if error != nil || (result?.isFinal ?? false) {
                    self.audioEngine.stop()
                    inputNode.removeTap(onBus: 0)
                    self.recognitionRequest = nil
                    self.recognitionTask = nil
                }
            }
            
            let recordingFormat = inputNode.outputFormat(forBus: 0)
            inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, _ in
                self?.recognitionRequest?.append(buffer)
                
                // Calculate simple audio level for waveform visualizer
                guard let channelData = buffer.floatChannelData?[0] else { return }
                let frames = buffer.frameLength
                var sum: Float = 0.0
                for i in 0..<Int(frames) {
                    sum += abs(channelData[i])
                }
                let avg = sum / Float(frames)
                let normalized = min(max(avg * 5.0, 0.05), 1.0)
                
                Task { @MainActor in
                    self?.audioLevel = normalized
                }
            }
            
            audioEngine.prepare()
            try audioEngine.start()
            isRecording = true
        } catch {
            errorMessage = "Unable to start audio engine: \(error.localizedDescription)"
            isRecording = false
        }
    }
    
    @discardableResult
    func stopRecording() -> String {
        guard isRecording else { return liveTranscript }
        
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        
        recognitionRequest = nil
        recognitionTask = nil
        isRecording = false
        audioLevel = 0.0
        
        return liveTranscript
    }
}
