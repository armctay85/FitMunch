import SwiftUI
import RevenueCat

/// Paywall screen for subscription purchases
struct PaywallView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var premiumManager = PremiumManager.shared
    @State private var packages: [Package] = []
    @State private var selectedPackage: Package?
    @State private var showRestoreAlert = false
    @State private var restoreMessage = ""
    @State private var isLoadingPackages = false
    @State private var showErrorAlert = false
    @State private var alertError = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 32) {
                    if !Constants.isRevenueCatConfigured {
                        configurationWarningSection
                    }
                    headerSection
                    featuresSection
                    pricingSection
                    purchaseSection
                    restoreSection
                    legalSection
                }
                .padding(.vertical)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Close") { dismiss() }
                }
            }
            .overlay {
                // Local loading only — never block on shared PremiumManager.isLoading (ASC: Upgrade felt dead).
                if isLoadingPackages && packages.isEmpty {
                    ProgressView("Loading plans…")
                        .padding()
                        .background(.regularMaterial)
                        .cornerRadius(16)
                }
            }
            .alert("Error", isPresented: $showErrorAlert) {
                Button("Continue on the web") { openWebPremium() }
                Button("OK", role: .cancel) { }
            } message: {
                Text(alertError)
            }
            .alert("Restore Purchases", isPresented: $showRestoreAlert) {
                Button("OK", role: .cancel) { }
            } message: {
                Text(restoreMessage)
            }
            .task {
                await loadPackages()
            }
        }
    }

    // MARK: - Sections

    private var configurationWarningSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Configuration Required")
                .font(.headline)
                .foregroundColor(.orange)

            Text("In-app plans are not configured. You can start Premium on the web instead.")
                .font(.subheadline)
                .foregroundColor(.secondary)
            Button("Continue on the web") {
                openWebPremium()
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color.orange.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal)
    }

    private var headerSection: some View {
        VStack(spacing: 16) {
            Image(systemName: "crown.fill")
                .font(.system(size: 60))
                .foregroundColor(.yellow)

            Text("Unlock Premium Features")
                .font(.largeTitle)
                .fontWeight(.bold)
                .multilineTextAlignment(.center)

            Text("Get the most out of FitMunch with our premium subscription")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
        }
        .padding(.top)
    }

    private var featuresSection: some View {
        VStack(spacing: 16) {
            FeatureRow(icon: "infinity", title: "Unlimited Meal Logging", description: "Log as many meals as you need")
            FeatureRow(icon: "chart.line.uptrend.xyaxis", title: "Advanced Analytics", description: "Detailed charts and progress tracking")
            FeatureRow(icon: "book.fill", title: "Premium Food Database", description: "Access to recipes and nutritional data")
            FeatureRow(icon: "square.and.arrow.up", title: "Data Export", description: "Export your data for analysis")
            FeatureRow(icon: "sparkles", title: "Personalized Insights", description: "Custom recommendations based on your goals")
        }
        .padding(.horizontal)
    }

    @ViewBuilder
    private var pricingSection: some View {
        if !packages.isEmpty {
            VStack(spacing: 16) {
                Text("Choose Your Plan")
                    .font(.title2)
                    .fontWeight(.semibold)

                ForEach(packages, id: \.self) { package in
                    PackageCard(
                        package: package,
                        isSelected: selectedPackage == package,
                        action: { selectedPackage = package }
                    )
                }
            }
            .padding(.horizontal)
        } else if isLoadingPackages {
            ProgressView("Loading plans…").padding()
        } else {
            VStack(spacing: 14) {
                Text("Premium plans did not load from the App Store.")
                    .font(.subheadline.weight(.semibold))
                    .multilineTextAlignment(.center)
                Text(alertError.isEmpty
                     ? "You can still start Premium on the web. fitmunch.com.au is the live pay path."
                     : alertError)
                    .font(.footnote)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                Button("Continue on the web") {
                    openWebPremium()
                }
                .buttonStyle(.borderedProminent)
            }
            .padding(.horizontal)
        }
    }

    @ViewBuilder
    private var purchaseSection: some View {
        if let pkg = selectedPackage {
            Button {
                Task {
                    let success = await premiumManager.purchase(package: pkg)
                    if success {
                        dismiss()
                    } else {
                        alertError = premiumManager.errorMessage?.isEmpty == false
                            ? premiumManager.errorMessage!
                            : "Purchase did not complete. Try again, or continue on the web."
                        showErrorAlert = true
                    }
                }
            } label: {
                if premiumManager.isLoading {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                } else {
                    Text("Subscribe Now")
                        .font(.headline)
                        .foregroundColor(.white)
                }
            }
            .frame(maxWidth: .infinity)
            .padding()
            .background(Color.blue)
            .cornerRadius(12)
            .padding(.horizontal)
            .disabled(premiumManager.isLoading)
        }
    }

    private var restoreSection: some View {
        Button("Restore Purchases") {
            Task {
                let success = await premiumManager.restorePurchases()
                restoreMessage = success
                    ? "Purchases restored successfully!"
                    : "No purchases to restore or restore failed"
                showRestoreAlert = true
            }
        }
        .font(.subheadline)
        .foregroundColor(.blue)
    }

    private var legalSection: some View {
        VStack(spacing: 8) {
            Text("Payment will be charged to your Apple ID account at the confirmation of purchase. Subscription automatically renews unless it is canceled at least 24 hours before the end of the current period. You can manage and cancel your subscriptions by going to your account settings on the App Store after purchase.")
                .font(.caption2)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            HStack(spacing: 16) {
                Button("Privacy Policy") {
                    if let url = URL(string: "https://fitmunch.com.au/privacy") {
                        UIApplication.shared.open(url)
                    }
                }
                .font(.caption2)
                .foregroundColor(.blue)

                Button("Terms of Service") {
                    if let url = URL(string: "https://fitmunch.com.au/terms") {
                        UIApplication.shared.open(url)
                    }
                }
                .font(.caption2)
                .foregroundColor(.blue)
            }
        }
        .padding(.horizontal)
    }

    // MARK: - Methods

    private func loadPackages() async {
        isLoadingPackages = true
        defer { isLoadingPackages = false }
        packages = await premiumManager.getPackages()
        selectedPackage = packages.first
        if packages.isEmpty {
            alertError = premiumManager.errorMessage ?? "App Store plans are not available right now. Continue on fitmunch.com.au to start Premium."
            showErrorAlert = true
        }
    }

    private func openWebPremium() {
        guard let url = Constants.premiumWebURL else {
            alertError = "Could not open the Premium page. Visit www.fitmunch.com.au in Safari."
            showErrorAlert = true
            return
        }
        UIApplication.shared.open(url) { success in
            if !success {
                DispatchQueue.main.async {
                    alertError = "Could not open the Premium page. Visit www.fitmunch.com.au in Safari."
                    showErrorAlert = true
                }
            }
        }
    }
}

// MARK: - PackageCard

private struct PackageCard: View {
    let package: Package
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 12) {
                productTitleRow
                priceRow
            }
            .padding()
            .background(isSelected ? Color.blue.opacity(0.1) : Color.gray.opacity(0.1))
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isSelected ? Color.blue : Color.clear, lineWidth: 2)
            )
        }
        .buttonStyle(.plain)
    }

    private var productTitleRow: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(package.storeProduct.localizedTitle)
                    .font(.headline)
                Text(package.storeProduct.localizedDescription)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
            Spacer()
            if isSelected {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(.blue)
                    .font(.title2)
            }
        }
    }

    private var priceRow: some View {
        HStack {
            Text(package.localizedPriceString)
                .font(.title2)
                .fontWeight(.bold)
            Spacer()
            savingsBadge
        }
    }

    @ViewBuilder
    private var savingsBadge: some View {
        if let savings = calculateSavings() {
            Text("Save \(savings)%")
                .font(.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Color.green.opacity(0.2))
                .foregroundColor(.green)
                .cornerRadius(4)
        }
    }

    private func calculateSavings() -> Int? {
        guard let period = package.storeProduct.subscriptionPeriod,
              period.unit == .year else { return nil }
        return 20
    }
}

// MARK: - FeatureRow

private struct FeatureRow: View {
    let icon: String
    let title: String
    let description: String

    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundColor(.blue)
                .frame(width: 32)

            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                Text(description).font(.subheadline).foregroundColor(.secondary)
            }
            Spacer()
        }
        .padding()
        .background(Color.gray.opacity(0.1))
        .cornerRadius(12)
    }
}

#Preview {
    PaywallView()
}
