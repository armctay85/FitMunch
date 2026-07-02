import SwiftUI
import PhotosUI

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

    private let brandGreen = Color(red: 0.086, green: 0.639, blue: 0.290)

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if let scan = scan {
                        resultsView(scan)
                    } else {
                        introView
                    }
                }
                .padding()
            }
            .navigationTitle("Receipt Scanner")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if scan != nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("New scan") { reset() }
                    }
                }
            }
            .sheet(isPresented: $showCamera) {
                CameraPicker { image in
                    receiptImage = image
                    startScan(image)
                }
                .ignoresSafeArea()
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

    // MARK: - Intro

    private var introView: some View {
        VStack(spacing: 18) {
            Text("📸").font(.system(size: 52)).padding(.top, 28)
            Text("Scan your shop")
                .font(.title2.weight(.heavy))
            Text("Snap your Woolies, Coles, Aldi or IGA receipt — get every item's macros, a haul score, and meal ideas in seconds.")
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
            } else {
                VStack(spacing: 10) {
                    Button {
                        showCamera = true
                    } label: {
                        Label("Take a photo", systemImage: "camera.fill")
                            .fontWeight(.bold)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(brandGreen)
                            .foregroundColor(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    PhotosPicker(selection: $pickedItem, matching: .images) {
                        Label("Choose from library", systemImage: "photo.on.rectangle")
                            .fontWeight(.semibold)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(Color(.secondarySystemBackground))
                            .foregroundColor(.primary)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                }
                .padding(.top, 8)
            }

            if let errorMessage = errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundColor(.red)
                    .multilineTextAlignment(.center)
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
                    totalStat(Int(scan.weeklyTotals?.protein?.value ?? 0), "g protein", .blue)
                    totalStat(Int(scan.weeklyTotals?.calories?.value ?? 0), "calories", .orange)
                    totalStat(scan.items?.count ?? 0, "items", brandGreen)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 20)
            .background(Color(.secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 16))

            // Items
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
                                .font(.caption.weight(.bold)).foregroundColor(.blue)
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
            } else {
                Button {
                    logAll(scan)
                } label: {
                    HStack {
                        if isLogging { ProgressView().tint(.white) }
                        Text("Log haul to today's meals")
                            .fontWeight(.bold)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(brandGreen)
                    .foregroundColor(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .disabled(isLogging)
            }

            if let shareText = scan.shareText {
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
            Text("\(value)").font(.headline.weight(.heavy)).foregroundColor(color)
            Text(label).font(.caption2).foregroundColor(.secondary)
        }
    }

    // MARK: - Actions

    private func reset() {
        scan = nil
        receiptImage = nil
        pickedItem = nil
        errorMessage = nil
        loggedCount = nil
    }

    private func startScan(_ image: UIImage) {
        guard let jpeg = image.jpegData(compressionQuality: 0.7) else {
            errorMessage = "Couldn't read that image — try another photo."
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
                if res.success {
                    scan = res
                } else {
                    errorMessage = res.error ?? "Couldn't read that receipt — try a clearer photo."
                }
            } catch {
                errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    private func logAll(_ scan: ReceiptScanResponse) {
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

/// UIKit camera bridge (rear camera, still photos).
struct CameraPicker: UIViewControllerRepresentable {
    let onImage: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = UIImagePickerController.isSourceTypeAvailable(.camera) ? .camera : .photoLibrary
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage {
                parent.onImage(image)
            }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}

#Preview {
    ReceiptScanView()
}
