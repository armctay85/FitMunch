import SwiftUI
import RevenueCat

/// Paywall screen for subscription purchases
struct PaywallView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var premiumManager = PremiumManager.shared
    @State private var packages: [Package] = []
    @State private var selectedPackage: Package?
    @State private var showRestoreAlert = false
    @State private var restoreMessage = ""

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
                if premiumManager.isLoading && packages.isEmpty {
                    ProgressView()
                        .scaleEffect(1.5)
                        .padding()
                        .background(.regularMaterial)
                        .cornerRadius(16)
                }
            }
            .alert("Error", isPresented: .constant(premiumManager.errorMessage != nil)) {
                Button("OK") { premiumManager.errorMessage = nil }
            } message: {
                if let error = premiumManager.errorMessage {
                    Text(error)
                }
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

            Text("RevenueCat is not configured yet. Add your public SDK key to REVENUECAT_API_KEY in Info.plist to load live subscription plans.")
                .font(.subheadline)
                .foregroundColor(.secondary)
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
        } else if premiumManager.isLoading {
            ProgressView("Loading plans...").padding()
        }
    }

    @ViewBuilder
    private var purchaseSection: some View {
        if let pkg = selectedPackage {
            Button {
                Task {
                    let success = await premiumManager.purchase(package: pkg)
                    if success { dismiss() }
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
        packages = await premiumManager.getPackages()
        selectedPackage = packages.first
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
