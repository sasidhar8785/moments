import Foundation

/// A creator's clips and measurements, written by prep_ar.py (web/ar/creators/<id>/manifest.json).
struct CreatorManifest: Decodable {
    let displayName: String
    /// Visible height of the person in the clip, in metres.
    let heightM: Float
    /// Clips framed above the feet float this high and fade into a light base.
    let baseM: Float?
    /// Width / height of the colour half of each frame.
    let aspect: Float
    /// Where the person's legs are across the frame (0 = left, 1 = right).
    let anchorX: Float?
    let names: [String]
    /// Occasion key -> label, e.g. "birthday": "Happy birthday".
    let occasions: [String: String]

    static func load(creator: String) throws -> (manifest: CreatorManifest, folder: URL) {
        guard let root = Bundle.main.url(forResource: "creators", withExtension: nil) else {
            throw CocoaError(.fileNoSuchFile)
        }
        let folder = root.appendingPathComponent(creator, isDirectory: true)
        let data = try Data(contentsOf: folder.appendingPathComponent("manifest.json"))
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return (try decoder.decode(CreatorManifest.self, from: data), folder)
    }

    /// A typed name only selects a clip the creator recorded; anything else gets the generic greeting.
    func clips(in folder: URL, name: String, occasion: String) -> [URL] {
        let key = String(name.lowercased().filter { $0 >= "a" && $0 <= "z" })
        let nameClip = names.contains(key) ? "names/\(key).mp4" : "names/_generic.mp4"
        return [folder.appendingPathComponent(nameClip), folder.appendingPathComponent("occasions/\(occasion).mp4")]
    }
}
