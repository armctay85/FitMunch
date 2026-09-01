import SwiftUI
import AVFoundation
import UIKit

/// iPad-safe camera. UIImagePickerController as a SwiftUI cover still crashes
/// on iPad (popover / source-type), including iPhone-only apps in compatibility
/// mode. This is a plain UIViewController + AVCaptureSession.
struct SafeCameraPicker: UIViewControllerRepresentable {
    let onImage: (UIImage) -> Void
    var onUnavailable: (String) -> Void = { _ in }
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> SafeCameraViewController {
        let controller = SafeCameraViewController()
        controller.onImage = { image in
            onImage(image)
            dismiss()
        }
        controller.onCancel = {
            dismiss()
        }
        controller.onUnavailable = { message in
            onUnavailable(message)
            dismiss()
        }
        return controller
    }

    func updateUIViewController(_ uiViewController: SafeCameraViewController, context: Context) {}
}

final class SafeCameraViewController: UIViewController, AVCapturePhotoCaptureDelegate {
    var onImage: ((UIImage) -> Void)?
    var onCancel: (() -> Void)?
    var onUnavailable: ((String) -> Void)?

    private let session = AVCaptureSession()
    private let photoOutput = AVCapturePhotoOutput()
    private let sessionQueue = DispatchQueue(label: "com.fitmunch.camera.session")
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var didFinish = false
    private var isCapturing = false

    private let shutterButton = UIButton(type: .system)
    private let cancelButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        view.accessibilityIdentifier = "scan-camera-root"
        buildChrome()
        prepareSession()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        sessionQueue.async { [weak self] in
            guard let self, self.session.isRunning else { return }
            self.session.stopRunning()
        }
    }

    override var prefersStatusBarHidden: Bool { true }

    private func buildChrome() {
        cancelButton.setTitle("Cancel", for: .normal)
        cancelButton.setTitleColor(.white, for: .normal)
        cancelButton.titleLabel?.font = .preferredFont(forTextStyle: .body)
        cancelButton.accessibilityIdentifier = "scan-camera-cancel"
        cancelButton.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        cancelButton.translatesAutoresizingMaskIntoConstraints = false

        shutterButton.backgroundColor = .white
        shutterButton.layer.cornerRadius = 32
        shutterButton.layer.borderWidth = 4
        shutterButton.layer.borderColor = UIColor.white.withAlphaComponent(0.4).cgColor
        shutterButton.accessibilityLabel = "Take photo"
        shutterButton.accessibilityIdentifier = "scan-camera-shutter"
        shutterButton.addTarget(self, action: #selector(shutterTapped), for: .touchUpInside)
        shutterButton.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(cancelButton)
        view.addSubview(shutterButton)

        NSLayoutConstraint.activate([
            cancelButton.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20),
            cancelButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24),
            shutterButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            shutterButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -20),
            shutterButton.widthAnchor.constraint(equalToConstant: 64),
            shutterButton.heightAnchor.constraint(equalToConstant: 64),
        ])
    }

    private func prepareSession() {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        switch status {
        case .authorized:
            configureAndStart()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    if granted {
                        self?.configureAndStart()
                    } else {
                        self?.fail("Camera access is off. Enable it in Settings, or choose a photo from your library.")
                    }
                }
            }
        case .denied, .restricted:
            fail("Camera access is off. Enable it in Settings, or choose a photo from your library.")
        @unknown default:
            fail("Couldn't open the camera. Choose a photo from your library instead.")
        }
    }

    private func configureAndStart() {
        sessionQueue.async { [weak self] in
            guard let self else { return }
            let configured = self.configureSession()
            DispatchQueue.main.async {
                if configured {
                    self.attachPreview()
                    self.sessionQueue.async {
                        if !self.session.isRunning {
                            self.session.startRunning()
                        }
                    }
                } else {
                    self.fail("This device has no camera. Choose a receipt photo from your library instead.")
                }
            }
        }
    }

    private func configureSession() -> Bool {
        session.beginConfiguration()
        defer { session.commitConfiguration() }

        session.sessionPreset = .photo

        let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
            ?? AVCaptureDevice.default(for: .video)
        guard let device else { return false }

        do {
            let input = try AVCaptureDeviceInput(device: device)
            guard session.canAddInput(input) else { return false }
            session.addInput(input)
        } catch {
            return false
        }

        guard session.canAddOutput(photoOutput) else { return false }
        session.addOutput(photoOutput)
        return true
    }

    private func attachPreview() {
        guard previewLayer == nil else { return }
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        layer.frame = view.bounds
        view.layer.insertSublayer(layer, at: 0)
        previewLayer = layer
    }

    @objc private func cancelTapped() {
        finish {
            self.onCancel?()
        }
    }

    @objc private func shutterTapped() {
        guard !isCapturing else { return }
        isCapturing = true
        shutterButton.isEnabled = false
        let settings = AVCapturePhotoSettings()
        if photoOutput.availablePhotoCodecTypes.contains(.jpeg) {
            settings.photoQualityPrioritization = .balanced
        }
        sessionQueue.async { [weak self] in
            guard let self else { return }
            guard self.session.isRunning else {
                DispatchQueue.main.async {
                    self.isCapturing = false
                    self.shutterButton.isEnabled = true
                    self.fail("Couldn't take a photo. Choose a photo from your library instead.")
                }
                return
            }
            self.photoOutput.capturePhoto(with: settings, delegate: self)
        }
    }

    func photoOutput(
        _ output: AVCapturePhotoOutput,
        didFinishProcessingPhoto photo: AVCapturePhoto,
        error: Error?
    ) {
        if let error {
            DispatchQueue.main.async { [weak self] in
                self?.isCapturing = false
                self?.shutterButton.isEnabled = true
                self?.fail("Couldn't take a photo (\(error.localizedDescription)). Try again or choose from your library.")
            }
            return
        }
        guard let data = photo.fileDataRepresentation(),
              let image = UIImage(data: data) else {
            DispatchQueue.main.async { [weak self] in
                self?.isCapturing = false
                self?.shutterButton.isEnabled = true
                self?.fail("Couldn't read that photo. Try again or choose from your library.")
            }
            return
        }
        DispatchQueue.main.async { [weak self] in
            self?.finish {
                self?.onImage?(image)
            }
        }
    }

    private func fail(_ message: String) {
        finish {
            self.onUnavailable?(message)
        }
    }

    private func finish(_ action: @escaping () -> Void) {
        guard !didFinish else { return }
        didFinish = true
        action()
    }
}

/// Hardware + permission checks used before presenting the camera cover.
enum CameraAvailability {
    static var hasCameraHardware: Bool {
        AVCaptureDevice.default(for: .video) != nil
            && UIImagePickerController.isSourceTypeAvailable(.camera)
    }

    static var authorization: AVAuthorizationStatus {
        AVCaptureDevice.authorizationStatus(for: .video)
    }
}
