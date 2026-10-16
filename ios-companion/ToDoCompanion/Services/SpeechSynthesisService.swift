import Foundation
import AVFoundation

@MainActor
class SpeechSynthesisService: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    static let shared = SpeechSynthesisService()
    
    @Published var isSpeaking: Bool = false
    private let synthesizer = AVSpeechSynthesizer()
    
    override private init() {
        super.init()
        synthesizer.delegate = self
    }
    
    func speak(_ text: String) {
        guard !text.isEmpty else { return }
        
        stopSpeaking()
        
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 1.05
        utterance.pitchMultiplier = 1.0
        
        isSpeaking = true
        synthesizer.speak(utterance)
    }
    
    func stopSpeaking() {
        if synthesizer.isSpeaking {
            synthesizer.stopSpeaking(at: .immediate)
        }
        isSpeaking = false
    }
    
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            self.isSpeaking = false
        }
    }
}
