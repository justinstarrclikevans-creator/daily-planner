import SwiftUI

struct WaveformView: View {
    var audioLevel: Float
    var isRecording: Bool
    
    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<15, id: \.self) { index in
                RoundedRectangle(cornerRadius: 3)
                    .fill(
                        LinearGradient(
                            colors: [.indigo, .purple, .pink],
                            startPoint: .bottom,
                            endPoint: .top
                        )
                    )
                    .frame(width: 4, height: barHeight(for: index))
                    .animation(.spring(response: 0.15, dampingFraction: 0.4), value: audioLevel)
            }
        }
        .frame(height: 60)
    }
    
    private func barHeight(for index: Int) -> CGFloat {
        guard isRecording else { return 6 }
        let center = 7.0
        let dist = abs(Double(index) - center) / center
        let factor = 1.0 - (dist * 0.5)
        let randomJitter = Double.random(in: 0.8...1.2)
        let height = CGFloat(Double(audioLevel) * 55.0 * factor * randomJitter)
        return max(height, 6)
    }
}
