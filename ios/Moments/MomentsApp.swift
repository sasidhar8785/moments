import AVFoundation
import SwiftUI

@main
struct MomentsApp: App {
    init() {
        // Play the creator's voice even when the ring/silent switch is on.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
    }

    var body: some Scene {
        WindowGroup { ContentView() }
    }
}
