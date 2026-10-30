import ARKit
import ReplayKit
import SceneKit
import SwiftUI
import UIKit

struct ARMomentView: UIViewControllerRepresentable {
    let manifest: CreatorManifest
    let clips: [URL]
    let onClose: () -> Void

    func makeUIViewController(context: Context) -> ARMomentViewController {
        ARMomentViewController(manifest: manifest, clips: clips, onClose: onClose)
    }

    func updateUIViewController(_ controller: ARMomentViewController, context: Context) {}
}

/// Live AR: find the floor, tap to place the creator, drag to move them, record the moment.
/// Uses people occlusion where supported, and the LiDAR scene mesh (iPad Pro / iPhone Pro)
/// so real furniture can hide the creator.
final class ARMomentViewController: UIViewController, ARSCNViewDelegate, RPPreviewViewControllerDelegate {
    private let manifest: CreatorManifest
    private let onClose: () -> Void
    private let creator: CreatorNode
    private var placed = false

    private let sceneView = ARSCNView()
    private lazy var arSession: ARSession = sceneView.session  // safe to read off the main thread
    private let coaching = ARCoachingOverlayView()
    private let hint = PaddedLabel()
    private let recordButton = UIButton(type: .system)
    private let replayButton = UIButton(type: .system)
    private let closeButton = UIButton(type: .system)

    init(manifest: CreatorManifest, clips: [URL], onClose: @escaping () -> Void) {
        self.manifest = manifest
        self.onClose = onClose
        creator = CreatorNode(manifest: manifest, clips: clips)
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    // MARK: Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        sceneView.frame = view.bounds
        sceneView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        sceneView.delegate = self
        _ = arSession
        sceneView.automaticallyUpdatesLighting = true
        sceneView.rendersCameraGrain = true
        view.addSubview(sceneView)

        coaching.session = sceneView.session
        coaching.goal = .horizontalPlane
        coaching.activatesAutomatically = true
        coaching.frame = view.bounds
        coaching.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(coaching)

        sceneView.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(handleTap)))
        sceneView.addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(handlePan)))
        buildControls()
        setHint("Move your device slowly to find the floor")
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        let config = ARWorldTrackingConfiguration()
        config.planeDetection = [.horizontal]
        config.environmentTexturing = .automatic
        config.isLightEstimationEnabled = true
        if ARWorldTrackingConfiguration.supportsFrameSemantics(.personSegmentationWithDepth) {
            config.frameSemantics.insert(.personSegmentationWithDepth)  // people pass in front of them
        }
        if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
            config.sceneReconstruction = .mesh  // LiDAR: furniture can hide them
        }
        sceneView.session.run(config)
        UIApplication.shared.isIdleTimerDisabled = true
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        sceneView.session.pause()
        creator.stop()
        UIApplication.shared.isIdleTimerDisabled = false
    }

    // MARK: Placing

    @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
        place(at: gesture.location(in: sceneView))
    }

    @objc private func handlePan(_ gesture: UIPanGestureRecognizer) {
        guard placed else { return }
        place(at: gesture.location(in: sceneView))
    }

    private func place(at point: CGPoint) {
        let hit = raycast(point, .existingPlaneGeometry) ?? raycast(point, .estimatedPlane)
        guard let hit else {
            if !placed { setHint("Point at the floor, then tap") }
            return
        }
        let t = hit.worldTransform.columns.3
        creator.node.simdPosition = SIMD3(t.x, t.y, t.z)
        if !placed {
            placed = true
            sceneView.scene.rootNode.addChildNode(creator.node)
            creator.play()
            setHint("Drag to move them · tap ⏺ to record your moment")
        }
    }

    private func raycast(_ point: CGPoint, _ target: ARRaycastQuery.Target) -> ARRaycastResult? {
        guard let query = sceneView.raycastQuery(from: point, allowing: target, alignment: .horizontal) else { return nil }
        return sceneView.session.raycast(query).first
    }

    // MARK: ARSCNViewDelegate

    func renderer(_ renderer: SCNSceneRenderer, updateAtTime time: TimeInterval) {
        creator.updateFrame()
        if let estimate = arSession.currentFrame?.lightEstimate {
            creator.setAmbientIntensity(estimate.ambientIntensity)
        }
    }

    func renderer(_ renderer: SCNSceneRenderer, nodeFor anchor: ARAnchor) -> SCNNode? {
        guard let mesh = anchor as? ARMeshAnchor else { return SCNNode() }
        let node = SCNNode(geometry: OcclusionMesh.geometry(from: mesh.geometry))
        node.renderingOrder = -1
        return node
    }

    func renderer(_ renderer: SCNSceneRenderer, didUpdate node: SCNNode, for anchor: ARAnchor) {
        guard let mesh = anchor as? ARMeshAnchor else { return }
        node.geometry = OcclusionMesh.geometry(from: mesh.geometry)
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        DispatchQueue.main.async { self.setHint("AR stopped: \(error.localizedDescription)") }
    }

    // MARK: Recording

    @objc private func toggleRecording() {
        let recorder = RPScreenRecorder.shared()
        if recorder.isRecording { stopRecording(); return }
        guard placed else { setHint("Tap the floor to place them first"); return }
        guard recorder.isAvailable else { setHint("Screen recording isn't available right now"); return }
        recorder.isMicrophoneEnabled = false
        recorder.startRecording { [weak self] error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let error { self.setHint("Couldn't record: \(error.localizedDescription)"); return }
                self.setRecording(true)
                // Record exactly one moment: restart it and stop shortly after it ends.
                self.creator.play { [weak self] in
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { self?.stopRecording() }
                }
            }
        }
    }

    private func stopRecording() {
        let recorder = RPScreenRecorder.shared()
        guard recorder.isRecording else { return }
        recorder.stopRecording { [weak self] preview, error in
            DispatchQueue.main.async {
                guard let self else { return }
                self.setRecording(false)
                if let preview {
                    preview.previewControllerDelegate = self
                    preview.modalPresentationStyle = .fullScreen
                    self.present(preview, animated: true)
                } else if let error {
                    self.setHint("Recording failed: \(error.localizedDescription)")
                }
            }
        }
    }

    func previewControllerDidFinish(_ previewController: RPPreviewViewController) {
        previewController.dismiss(animated: true)
    }

    // MARK: Controls

    private func buildControls() {
        hint.textColor = .white
        hint.font = .preferredFont(forTextStyle: .subheadline)
        hint.numberOfLines = 0
        hint.textAlignment = .center
        hint.backgroundColor = UIColor(white: 0, alpha: 0.55)
        hint.layer.cornerRadius = 12
        hint.clipsToBounds = true

        style(replayButton, symbol: "arrow.counterclockwise", size: 22, action: #selector(replay))
        style(recordButton, symbol: "record.circle", size: 64, action: #selector(toggleRecording))
        recordButton.tintColor = .systemRed
        style(closeButton, symbol: "xmark", size: 22, action: #selector(close))

        let bar = UIStackView(arrangedSubviews: [replayButton, recordButton, closeButton])
        bar.axis = .horizontal
        bar.alignment = .center
        bar.spacing = 36

        for v in [hint, bar] as [UIView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(v)
        }
        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            hint.topAnchor.constraint(equalTo: guide.topAnchor, constant: 12),
            hint.centerXAnchor.constraint(equalTo: guide.centerXAnchor),
            hint.leadingAnchor.constraint(greaterThanOrEqualTo: guide.leadingAnchor, constant: 16),
            hint.trailingAnchor.constraint(lessThanOrEqualTo: guide.trailingAnchor, constant: -16),
            bar.centerXAnchor.constraint(equalTo: guide.centerXAnchor),
            bar.bottomAnchor.constraint(equalTo: guide.bottomAnchor, constant: -20),
        ])
    }

    private func style(_ button: UIButton, symbol: String, size: CGFloat, action: Selector) {
        let config = UIImage.SymbolConfiguration(pointSize: size, weight: .semibold)
        button.setImage(UIImage(systemName: symbol, withConfiguration: config), for: .normal)
        button.tintColor = .white
        button.addTarget(self, action: action, for: .touchUpInside)
    }

    private func setRecording(_ on: Bool) {
        let config = UIImage.SymbolConfiguration(pointSize: 64, weight: .semibold)
        recordButton.setImage(UIImage(systemName: on ? "stop.circle.fill" : "record.circle", withConfiguration: config), for: .normal)
        // Keep the recording clean: only the stop button stays on screen.
        hint.isHidden = on
        replayButton.isHidden = on
        closeButton.isHidden = on
    }

    private func setHint(_ text: String) {
        hint.text = text
    }

    @objc private func replay() {
        guard placed else { return }
        creator.play()
    }

    @objc private func close() {
        onClose()
    }
}

/// Invisible geometry from the LiDAR scene mesh: it fills the depth buffer, so real objects
/// in front of the creator hide them.
enum OcclusionMesh {
    private static let material: SCNMaterial = {
        let m = SCNMaterial()
        m.colorBufferWriteMask = []
        m.isDoubleSided = true
        return m
    }()

    static func geometry(from mesh: ARMeshGeometry) -> SCNGeometry {
        let vertices = mesh.vertices
        let source = SCNGeometrySource(buffer: vertices.buffer, vertexFormat: vertices.format, semantic: .vertex,
                                       vertexCount: vertices.count, dataOffset: vertices.offset, dataStride: vertices.stride)
        let faces = mesh.faces
        let data = Data(bytes: faces.buffer.contents(), count: faces.count * faces.indexCountPerPrimitive * faces.bytesPerIndex)
        let element = SCNGeometryElement(data: data, primitiveType: .triangles,
                                         primitiveCount: faces.count, bytesPerIndex: faces.bytesPerIndex)
        let geometry = SCNGeometry(sources: [source], elements: [element])
        geometry.materials = [material]
        return geometry
    }
}

/// A label with padding around its text.
final class PaddedLabel: UILabel {
    private let insets = UIEdgeInsets(top: 8, left: 14, bottom: 8, right: 14)

    override func drawText(in rect: CGRect) {
        super.drawText(in: rect.inset(by: insets))
    }

    override var intrinsicContentSize: CGSize {
        let size = super.intrinsicContentSize
        return CGSize(width: size.width + insets.left + insets.right, height: size.height + insets.top + insets.bottom)
    }

    override func textRect(forBounds bounds: CGRect, limitedToNumberOfLines numberOfLines: Int) -> CGRect {
        let rect = super.textRect(forBounds: bounds.inset(by: insets), limitedToNumberOfLines: numberOfLines)
        return rect.inset(by: UIEdgeInsets(top: -insets.top, left: -insets.left, bottom: -insets.bottom, right: -insets.right))
    }
}
