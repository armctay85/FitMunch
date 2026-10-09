import SwiftUI
import PhotosUI
import AVFoundation

/// Receipt scanner — snap a supermarket receipt, get the macro breakdown.
struct ReceiptScanView: View {
    @State private var pickedItem: PhotosPickerItem?
    @State private var receiptImage: UIImage?
    @State private var showCamera = false
    @State private var isScanning = false
    @State private var scan: ReceiptScanResponse?
    @State private var errorMessage: String?
    @State private var isLogging = false
    @State private var loggedCount: Int?
    @State private var isRequestingCamera = false
    @State private var showLibraryPicker = false
    @State private var showCameraFallback = false
    @State private var cameraFallbackMessage = ""
    @State private var scanCompletions = 0
    @State private var showConsent = false
    @State private var pendingScan: ScanStart?
    @State private var showRetake = false

    private static let unreadableCopy = "We couldn't read this receipt. Try again with a flat, well-lit photo."
    private static let unavailableCopy = "Scanning is unavailable right now."
    @EnvironmentObject private var auth: AuthManager
    @ObservedObject private var consent = AIDataConsent.shared

    private enum ScanStart {
        case camera
        case library
    }

    private let brandGreen = Theme.brandGreen

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    OfflineNotice()
                    if let scan = scan, scan.scannerProvider != "fallback" {
                        resultsView(scan)
                    } else {
                        introView
                    }
                }
                .padding()
            }
            .defaultScrollAnchor(.top)
            .scrollClearsTabBar()
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if scan == nil && !isScanning {
                    scanActions
                        .padding(.horizontal, Theme.Spacing.four)
                        .padding(.top, Theme.Spacing.two)
                        .padding(.bottom, Theme.Spacing.three)
                        .background(Theme.surface)
                }
            }
            .floatingTabBarInset()
            .background(Theme.surface)
            .sensoryFeedback(.success, trigger: scanCompletions)
            .navigationTitle("Scan")
            .accessibilityIdentifier("scan-screen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.surface, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                if scan != nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("New scan") { reset() }
                    }
                }
            }
            // AVCapture camera is the cover root. Do not present a system image picker for camera.
            .fullScreenCover(isPresented: $showCamera) {
                SafeCameraPicker(
                    onImage: { image in
                        receiptImage = image
                        startScan(image)
                    },
                    onUnavailable: { message in
                        presentCameraFallback(message)
                    }
                )
                .ignoresSafeArea()
            }
            .photosPicker(isPresented: $showLibraryPicker, selection: $pickedItem, matching: .images)
            .sheet(isPresented: $showConsent) {
                AIDataConsentSheet(
                    onAllow: {
                        showConsent = false
                        consent.allow(userId: auth.user?.id)
                        let next = pendingScan
                        pendingScan = nil
                        runScan(next)
                    },
                    onNotNow: {
                        showConsent = false
                        pendingScan = nil
                        consent.deny(userId: auth.user?.id)
                        errorMessage = AIConsentCopy.scanBlocked
                    }
                )
            }
            .alert("Camera not available", isPresented: $showCameraFallback) {
                Button("Choose from library") { showLibraryPicker = true }
                Button("OK", role: .cancel) { }
            } message: {
                Text(cameraFallbackMessage)
            }
            .onChange(of: pickedItem) { _, newItem in
                guard let newItem = newItem else { return }
                Task {
                    if let data = try? await newItem.loadTransferable(type: Data.self),
                       let image = UIImage(data: data) {
                        receiptImage = image
                        startScan(image)
                    }
                }
            }
        }
    }

    private var scanActions: some View {
        VStack(spacing: 10) {
            Button {
                beginScan(.camera)
            } label: {
                Text(isRequestingCamera ? "Opening camera…" : "Take a photo")
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(isRequestingCamera)
            .accessibilityIdentifier("scan-take-photo")
            Button {
                beginScan(.library)
            } label: {
                Text("Choose from library")
            }
            .buttonStyle(SecondaryButtonStyle())
            .accessibilityIdentifier("scan-choose-library")
        }
    }

    // MARK: - Intro

    private var introView: some View {
        VStack(spacing: 18) {
            Image(systemName: "doc.viewfinder")
                .font(.system(size: 52))
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(Theme.brandGreen)
                .padding(.top, 56)
                .accessibilityLabel("Scan a receipt")
            Text("Scan your shop")
                .font(.title2.weight(.heavy))
            Text("Snap a supermarket receipt. Get every item's macros, a haul score, and meal ideas in seconds.")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            if isScanning {
                VStack(spacing: 10) {
                    ProgressView().scaleEffect(1.3)
                    Text("Reading your receipt…")
                        .font(.footnote)
                        .foregroundColor(.secondary)
                }
                .padding(.top, 20)
            }

            if let errorMessage = errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundColor(.red)
                    .multilineTextAlignment(.center)
            }
            if showRetake {
                Button("Retake") {
                    showRetake = false
                    errorMessage = nil
                    receiptImage = nil
                    pickedItem = nil
                    beginScan(.camera)
                }
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityIdentifier("scan-retake")
            }
        }
    }

    // MARK: - Results

    private func resultsView(_ scan: ReceiptScanResponse) -> some View {
        VStack(spacing: 16) {
            // Grade + totals
            VStack(spacing: 8) {
                Text(scan.grade ?? "–")
                    .font(.system(size: 46, weight: .black, design: .rounded))
                    .foregroundColor(brandGreen)
                Text("Weekly haul score")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.secondary)
                HStack(spacing: 22) {
                    totalStat(Int(scan.weeklyTotals?.protein?.value ?? 0), "g protein", Theme.brandGreen)
                    totalStat(Int(scan.weeklyTotals?.calories?.value ?? 0), "calories", .orange)
                    totalStat(scan.items?.count ?? 0, "items", brandGreen)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 20)
            .background(Color(.secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 16))

            Text("Prices vary by store and week.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)

            // Items. Aisle (category) and protein per item. Never a shelf price.
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array((scan.items ?? []).enumerated()), id: \.offset) { _, item in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.name).font(.subheadline.weight(.medium))
                            if let category = item.category {
                                Text(category.capitalized).font(.caption2).foregroundColor(.secondary)
                            }
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("\(Int(item.nutrition?.protein?.value ?? 0))g protein")
                                .font(.caption.monospacedDigit().weight(.bold))
                                .foregroundStyle(Theme.brandGreen)
                            Text("\(Int(item.nutrition?.calories?.value ?? 0)) cal")
                                .font(.caption2).foregroundColor(.secondary)
                        }
                    }
                    .padding(.vertical, 9)
                    Divider()
                }
            }
            .padding(.horizontal, 14)
            .background(Color(.secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 16))

            // Actions
            if let loggedCount = loggedCount {
                Label("\(loggedCount) items logged to today's meals", systemImage: "checkmark.circle.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(brandGreen)
            } else if scan.scannerProvider != "fallback" {
                Button {
                    logAll(scan)
                } label: {
                    HStack {
                        if isLogging { ProgressView().tint(.white) }
                        Text("Log haul to today's meals")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(isLogging)
            }

            if scan.scannerProvider != "fallback", let shareText = scan.shareText {
                ShareLink(item: shareText) {
                    Label("Share my haul score", systemImage: "square.and.arrow.up")
                        .fontWeight(.semibold)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Color(.secondarySystemBackground))
                        .foregroundColor(.primary)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
            }
        }
    }

    private func totalStat(_ value: Int, _ label: String, _ color: Color) -> some View {
        VStack(spacing: 2) {
            MacroNumber(value: value, style: .headline)
                .foregroundStyle(color)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(value) \(label)")
    }

    // MARK: - Actions

    private func reset() {
        scan = nil
        receiptImage = nil
        pickedItem = nil
        errorMessage = nil
        loggedCount = nil
        showRetake = false
    }

    private func isScanFailure(_ message: String) -> Bool {
        message == Self.unreadableCopy || message == Self.unavailableCopy
    }

    private func presentReadFailure(_ message: String) {
        scan = nil
        loggedCount = nil
        errorMessage = isScanFailure(message) ? message : Self.unavailableCopy
        showRetake = true
    }

    private func customerError(_ message: String?) -> String {
        let text = message ?? Self.unreadableCopy
        if isScanFailure(text) { return text }
        let leaked = text.range(of: "API_KEY", options: .caseInsensitive) != nil
            || text.range(of: "GEMINI", options: .caseInsensitive) != nil
            || text.range(of: "XAI_API", options: .caseInsensitive) != nil
            || text.range(of: "OPENAI_API", options: .caseInsensitive) != nil
            || text.range(of: "ANTHROPIC_API", options: .caseInsensitive) != nil
        if leaked { return Self.unavailableCopy }
        return text
    }

    private func beginScan(_ start: ScanStart) {
        errorMessage = nil
        if consent.needsPrompt(auth.user?.id) {
            pendingScan = start
            showConsent = true
            return
        }
        if consent.isDenied(auth.user?.id) {
            errorMessage = AIConsentCopy.scanBlocked
            return
        }
        runScan(start)
    }

    private func runScan(_ start: ScanStart?) {
        switch start {
        case .camera:
            Task { await openCameraSafely() }
        case .library:
            showLibraryPicker = true
        case nil:
            break
        }
    }

    /// Never present a camera cover unless hardware exists and video is authorized.
    @MainActor
    private func openCameraSafely() async {
        errorMessage = nil
        guard CameraAvailability.hasCameraHardware else {
            presentCameraFallback("This device has no camera. Choose a receipt photo from your library instead.")
            return
        }
        isRequestingCamera = true
        defer { isRequestingCamera = false }

        let status = CameraAvailability.authorization
        switch status {
        case .authorized:
            showCamera = true
        case .notDetermined:
            let granted = await AVCaptureDevice.requestAccess(for: .video)
            if granted {
                showCamera = true
            } else {
                presentCameraFallback("Camera access is off. Enable it in Settings, or choose a photo from your library.")
            }
        case .denied, .restricted:
            presentCameraFallback("Camera access is off. Enable it in Settings, or choose a photo from your library.")
        @unknown default:
            presentCameraFallback("Couldn't open the camera. Choose a photo from your library instead.")
        }
    }

    private func presentCameraFallback(_ message: String) {
        errorMessage = message
        cameraFallbackMessage = message
        if showCamera {
            showCamera = false
            DispatchQueue.main.async {
                showCameraFallback = true
            }
        } else {
            showCameraFallback = true
        }
    }

    private func startScan(_ image: UIImage) {
        guard let jpeg = image.jpegData(compressionQuality: 0.7) else {
            errorMessage = "Couldn't read that image. Try another photo."
            return
        }
        isScanning = true
        errorMessage = nil
        Task {
            defer { isScanning = false }
            do {
                let res = try await APIClient.request(
                    "/receipt/scan",
                    method: "POST",
                    body: ["image": jpeg.base64EncodedString(), "mimeType": "image/jpeg"],
                    as: ReceiptScanResponse.self
                )
                if res.scannerProvider == "fallback" || (res.error != nil && isScanFailure(res.error ?? "")) {
                    presentReadFailure(res.error ?? Self.unreadableCopy)
                } else if res.success {
                    showRetake = false
                    scan = res
                    scanCompletions += 1
                } else {
                    showRetake = false
                    errorMessage = customerError(res.error)
                }
            } catch {
                let message = (error as? APIError)?.errorDescription ?? error.localizedDescription
                if isScanFailure(message) || customerError(message) == Self.unavailableCopy && message != Self.unavailableCopy {
                    presentReadFailure(isScanFailure(message) ? message : Self.unavailableCopy)
                } else {
                    showRetake = false
                    errorMessage = customerError(message)
                }
            }
        }
    }

    private func logAll(_ scan: ReceiptScanResponse) {
        guard scan.scannerProvider != "fallback" else { return }
        let items = scan.items ?? []
        guard !items.isEmpty else { return }
        isLogging = true
        Task {
            defer { isLogging = false }
            var logged = 0
            for item in items {
                let body: [String: Any] = [
                    "mealType": "snack",
                    "foodName": item.name,
                    "calories": Int(item.nutrition?.calories?.value ?? 0),
                    "protein": item.nutrition?.protein?.value ?? 0,
                    "carbs": item.nutrition?.carbs?.value ?? 0,
                    "fat": item.nutrition?.fat?.value ?? 0,
                ]
                if let res = try? await APIClient.request("/meals/log", method: "POST", body: body, as: GenericResponse.self),
                   res.success == true {
                    logged += 1
                }
            }
            loggedCount = logged
        }
    }
}

#Preview {
    ReceiptScanView()
        .environmentObject(AuthManager.shared)
}
