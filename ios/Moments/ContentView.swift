import ARKit
import SwiftUI

struct ContentView: View {
    @State private var name = ""
    @State private var occasion = ""
    @State private var showAR = false
    private let creator = try? CreatorManifest.load(creator: "presenter")

    var body: some View {
        if let creator {
            if showAR {
                ARMomentView(
                    manifest: creator.manifest,
                    clips: creator.manifest.clips(in: creator.folder, name: name, occasion: occasion),
                    onClose: { showAR = false }
                )
                .ignoresSafeArea()
            } else {
                setup(creator.manifest)
            }
        } else {
            Text("The creator's clips are missing from the app.").padding()
        }
    }

    private func setup(_ manifest: CreatorManifest) -> some View {
        let keys = manifest.occasions.keys.sorted()
        return NavigationStack {
            Form {
                Section {
                    Text("Point your camera at the floor, tap to place \(manifest.displayName), then record your moment.")
                        .foregroundStyle(.secondary)
                }
                Section("Your first name") {
                    TextField("e.g. Priya", text: $name)
                        .textContentType(.givenName)
                        .autocorrectionDisabled()
                }
                Section("Occasion") {
                    Picker("Occasion", selection: $occasion) {
                        ForEach(keys, id: \.self) { key in
                            Text(manifest.occasions[key] ?? key).tag(key)
                        }
                    }
                }
                Section {
                    Button("Start AR") { showAR = true }
                        .disabled(!ARWorldTrackingConfiguration.isSupported || occasion.isEmpty)
                    if !ARWorldTrackingConfiguration.isSupported {
                        Text("This device doesn't support AR.").foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Moments")
        }
        .onAppear { if occasion.isEmpty { occasion = keys.first ?? "" } }
    }
}
