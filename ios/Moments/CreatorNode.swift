import AVFoundation
import CoreImage
import SceneKit
import UIKit

/// The creator standing in the room: their real, cut-out video on a plane that turns to face
/// the viewer, with a contact shadow and (for clips cut above the feet) a glowing base.
///
/// Clips are "stacked alpha" MP4s: colour in the top half, the cut-out mask in the bottom half.
/// Each video frame is split with Core Image into one transparent image for the plane.
final class CreatorNode {
    /// Sits on the floor; move this to move the creator.
    let node = SCNNode()

    private let clips: [URL]
    private let material = SCNMaterial()
    private let fade: CGFloat
    private let ciContext = CIContext(options: [.cacheIntermediates: false])
    private let pixelFormat = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]

    // Touched from the main thread (play/stop) and SceneKit's render thread (frames).
    private let lock = NSLock()
    private var player: AVQueuePlayer?
    private var outputs: [ObjectIdentifier: AVPlayerItemVideoOutput] = [:]
    private var endObserver: NSObjectProtocol?

    init(manifest: CreatorManifest, clips: [URL]) {
        self.clips = clips
        let height = CGFloat(manifest.heightM)
        let width = height * CGFloat(manifest.aspect)
        let base = CGFloat(manifest.baseM ?? 0)
        fade = base > 0 ? 0.16 : 0

        material.lightingModel = .constant
        material.isDoubleSided = true
        material.blendMode = .alpha
        material.transparencyMode = .aOne
        material.writesToDepthBuffer = false
        material.diffuse.contents = UIColor.clear
        let plane = SCNPlane(width: width, height: height)
        plane.materials = [material]

        // The pivot turns to face the viewer; inside it the clip is shifted so the person's legs
        // (not the middle of the frame) sit over the spot they were placed on.
        let pivot = SCNNode()
        let billboard = SCNBillboardConstraint()
        billboard.freeAxes = .Y
        pivot.constraints = [billboard]
        let body = SCNNode(geometry: plane)
        body.position = SCNVector3(Float((0.5 - CGFloat(manifest.anchorX ?? 0.5)) * width), Float(base + height / 2), 0)
        body.renderingOrder = 10
        pivot.addChildNode(body)
        node.addChildNode(pivot)

        node.addChildNode(Self.floorDisc(size: 0.9, image: Self.radialImage(stops: [
            (0, UIColor(white: 0, alpha: 0.5)), (1, UIColor(white: 0, alpha: 0)),
        ]), additive: false))

        if base > 0 {
            let glow = UIColor(red: 0.63, green: 0.84, blue: 1, alpha: 1)
            node.addChildNode(Self.floorDisc(size: 0.62, image: Self.radialImage(stops: [
                (0, glow.withAlphaComponent(0)), (0.55, glow.withAlphaComponent(0)),
                (0.72, glow.withAlphaComponent(0.7)), (0.8, glow.withAlphaComponent(0.3)), (1, glow.withAlphaComponent(0)),
            ]), additive: true))
            node.addChildNode(Self.beam(height: base + height * 0.2, colour: glow))
        }
        node.opacity = 0
    }

    // MARK: Playback

    /// Plays the name clip then the occasion clip from the start; `onFinish` runs on the main queue.
    func play(onFinish: (() -> Void)? = nil) {
        stop()
        var items: [AVPlayerItem] = []
        var newOutputs: [ObjectIdentifier: AVPlayerItemVideoOutput] = [:]
        for url in clips {
            let item = AVPlayerItem(url: url)
            let output = AVPlayerItemVideoOutput(pixelBufferAttributes: pixelFormat)
            item.add(output)
            newOutputs[ObjectIdentifier(item)] = output
            items.append(item)
        }
        let queue = AVQueuePlayer(items: items)
        if let last = items.last {
            endObserver = NotificationCenter.default.addObserver(
                forName: .AVPlayerItemDidPlayToEndTime, object: last, queue: .main
            ) { _ in onFinish?() }
        }
        lock.lock()
        player = queue
        outputs = newOutputs
        lock.unlock()
        queue.play()
        node.runAction(.fadeIn(duration: 0.6))
    }

    func stop() {
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
        lock.lock()
        player?.pause()
        player = nil
        outputs = [:]
        lock.unlock()
    }

    /// Call every rendered frame (SceneKit render thread): shows the newest video frame, if any.
    func updateFrame() {
        lock.lock()
        let item = player?.currentItem
        let output = item.flatMap { outputs[ObjectIdentifier($0)] }
        lock.unlock()
        guard let output else { return }
        let time = output.itemTime(forHostTime: CACurrentMediaTime())
        guard output.hasNewPixelBuffer(forItemTime: time),
              let buffer = output.copyPixelBuffer(forItemTime: time, itemTimeForDisplay: nil),
              let image = compose(buffer) else { return }
        material.diffuse.contents = image
    }

    /// Dims the creator in darker rooms, from ARKit's light estimate (about 1000 = neutral).
    func setAmbientIntensity(_ lumens: CGFloat) {
        let k = min(max(0.55 + 0.45 * lumens / 1000, 0.6), 1)
        material.multiply.contents = UIColor(white: k, alpha: 1)
    }

    private func compose(_ buffer: CVPixelBuffer) -> CGImage? {
        let frame = CIImage(cvPixelBuffer: buffer)
        let w = frame.extent.width, h = frame.extent.height / 2
        // Core Image's origin is bottom-left: the colour (top half of the frame) is y in [h, 2h).
        let colour = frame.cropped(to: CGRect(x: 0, y: h, width: w, height: h))
            .transformed(by: CGAffineTransform(translationX: 0, y: -h))
        var mask = frame.cropped(to: CGRect(x: 0, y: 0, width: w, height: h))
        if fade > 0, let gradient = CIFilter(name: "CILinearGradient", parameters: [
            "inputPoint0": CIVector(x: 0, y: 0),
            "inputPoint1": CIVector(x: 0, y: h * fade),
            "inputColor0": CIColor.black,
            "inputColor1": CIColor.white,
        ])?.outputImage {
            mask = mask.applyingFilter("CIMultiplyCompositing", parameters: [
                kCIInputBackgroundImageKey: gradient.cropped(to: mask.extent),
            ])
        }
        let cutOut = colour.applyingFilter("CIBlendWithMask", parameters: [
            kCIInputBackgroundImageKey: CIImage.empty(),
            kCIInputMaskImageKey: mask,
        ])
        return ciContext.createCGImage(cutOut, from: CGRect(x: 0, y: 0, width: w, height: h))
    }

    // MARK: Floor decorations

    private static func floorDisc(size: CGFloat, image: UIImage, additive: Bool) -> SCNNode {
        let m = SCNMaterial()
        m.lightingModel = .constant
        m.diffuse.contents = image
        m.isDoubleSided = true
        m.writesToDepthBuffer = false
        m.blendMode = additive ? .add : .alpha
        let plane = SCNPlane(width: size, height: size)
        plane.materials = [m]
        let disc = SCNNode(geometry: plane)
        disc.eulerAngles.x = -.pi / 2
        disc.position.y = additive ? 0.004 : 0.002
        return disc
    }

    private static func beam(height: CGFloat, colour: UIColor) -> SCNNode {
        let side = SCNMaterial()
        side.lightingModel = .constant
        side.diffuse.contents = UIGraphicsImageRenderer(size: CGSize(width: 4, height: 128)).image { ctx in
            let colours = [colour.withAlphaComponent(0.09).cgColor, colour.withAlphaComponent(0).cgColor] as CFArray
            let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colours, locations: [0, 1])!
            ctx.cgContext.drawLinearGradient(gradient, start: CGPoint(x: 0, y: 128), end: .zero, options: [])
        }
        side.isDoubleSided = true
        side.writesToDepthBuffer = false
        side.blendMode = .add
        let hidden = SCNMaterial()
        hidden.transparency = 0
        let cylinder = SCNCylinder(radius: 0.22, height: height)
        cylinder.materials = [side, hidden, hidden]
        let beam = SCNNode(geometry: cylinder)
        beam.position.y = Float(height / 2)
        return beam
    }

    private static func radialImage(stops: [(CGFloat, UIColor)]) -> UIImage {
        let size = CGSize(width: 256, height: 256)
        return UIGraphicsImageRenderer(size: size).image { ctx in
            let gradient = CGGradient(
                colorsSpace: CGColorSpaceCreateDeviceRGB(),
                colors: stops.map { $0.1.cgColor } as CFArray,
                locations: stops.map { $0.0 }
            )!
            let centre = CGPoint(x: size.width / 2, y: size.height / 2)
            ctx.cgContext.drawRadialGradient(gradient, startCenter: centre, startRadius: 0,
                                             endCenter: centre, endRadius: size.width / 2, options: [])
        }
    }
}
