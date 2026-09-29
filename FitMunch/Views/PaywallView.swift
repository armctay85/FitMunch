import SwiftUI

/// Paywall screen for subscription purchases
struct PaywallView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var premiumManager = PremiumManager.shared
    @State private var selectedPlan: PaywallPlan?
    @State private var showRestoreAlert = false
    @State private var restoreMessage = ""
    @State private var showErrorAlert = false
    @State private var alertError = ""

    private var plans: [PaywallPlan] { premiumManager.paywallPlans }
    private var isLoadingPlans: Bool { premiumManager.paywallPhase == .loading && plans.isEmpty }
    private var plansLoadFailed: Bool { premiumManager.paywallPhase == .failed && plans.isEmpty }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 32) {
                    if !Constants.isRevenueCatConfigured {
                        configurationWarningSection
                    }
                    headerSection
                    pricingSection
                    featuresSection
                    purchaseSection
                    restoreSection
                    sandboxProbeSection
                    legalSection
                }
                .padding(.vertical)
            }
            .accessibilityIdentifier("paywall-root")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Close") { dismiss() }
                        .accessibilityIdentifier("paywall-close")
                }
            }
            .refreshable {
                await loadPlansWithRetry()
            }
            .overlay {
                if isLoadingPlans && plans.isEmpty {
                    VStack(spacing: 12) {
                        ProgressView()
                        Text("Loading plans…")
                            .font(.subheadline.weight(.semibold))
                            .accessibilityIdentifier("paywall-loading-label")
                    }
                    .padding(24)
                    .background(.regularMaterial)
                    .cornerRadius(16)
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("paywall-loading")
                }
            }
            .alert("Couldn't complete that", isPresented: $showErrorAlert) {
                Button("Retry") {
                    Task { await loadPlansWithRetry() }
                }
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
                await loadPlansWithRetry()
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
        if !plans.isEmpty {
            VStack(spacing: 16) {
                Text("Choose Your Plan")
                    .font(.title2)
                    .fontWeight(.semibold)

                ForEach(plans) { plan in
                    PackageCard(
                        plan: plan,
                        isSelected: selectedPlan?.id == plan.id,
                        action: { selectedPlan = plan }
                    )
                }
            }
            .padding(.horizontal)
            .accessibilityIdentifier("paywall-plans")
        } else if isLoadingPlans {
            VStack(spacing: 8) {
                ProgressView()
                Text("Loading plans…")
                    .font(.subheadline)
                    .accessibilityIdentifier("paywall-loading-inline-label")
            }
            .padding()
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("paywall-loading-inline")
        } else if plansLoadFailed {
            emptyPlansSection
        }
    }

    private var emptyPlansSection: some View {
        VStack(spacing: 14) {
            Text(PaywallLoadPolicy.userFacingLoadFailure)
                .font(.subheadline.weight(.semibold))
                .multilineTextAlignment(.center)
                .accessibilityIdentifier("paywall-error")
            Button("Retry") {
                Task { await loadPlansWithRetry() }
            }
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("paywall-retry")
            Button("Restore Purchases") {
                Task { await restore() }
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("paywall-restore-inline")
            Button("Continue on the web") {
                openWebPremium()
            }
            .buttonStyle(.bordered)
        }
        .padding(.horizontal)
        .accessibilityIdentifier("paywall-error-state")
    }

    @ViewBuilder
    private var sandboxProbeSection: some View {
        if ProcessInfo.processInfo.arguments.contains(PaywallLaunchArgument.sandboxProbe) {
            Text(premiumManager.lastPlanFetchSummary.isEmpty ? "probe:pending" : "probe:\(premiumManager.lastPlanFetchSummary)")
                .font(.caption2)
                .foregroundColor(.secondary)
                .accessibilityIdentifier("sandbox-probe-summary")
        }
    }

    @ViewBuilder
    private var purchaseSection: some View {
        if let plan = selectedPlan {
            Button {
                Task { await purchase(plan) }
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
            .accessibilityIdentifier("paywall-subscribe")
        }
    }

    private var restoreSection: some View {
        Button("Restore Purchases") {
            Task { await restore() }
        }
        .font(.subheadline)
        .foregroundColor(.blue)
        .accessibilityIdentifier("paywall-restore")
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

    /// Shows loading immediately. Retries once with backoff before the error state.
    /// The error is the only empty state. The screen keeps the header, Retry, and Restore.
    private func loadPlansWithRetry() async {
        await premiumManager.loadPaywallPlans()
        if selectedPlan == nil || !plans.contains(where: { $0.id == selectedPlan?.id }) {
            selectedPlan = plans.first
        }
    }

    private func restore() async {
        let success = await premiumManager.restorePurchases()
        restoreMessage = success
            ? "Purchases restored successfully!"
            : (premiumManager.errorMessage ?? "No purchases to restore or restore failed")
        showRestoreAlert = true
    }

    private func purchase(_ plan: PaywallPlan) async {
        let success = await premiumManager.purchase(plan: plan)
        if success {
            dismiss()
            return
        }
        if let message = premiumManager.errorMessage, !message.isEmpty {
            alertError = message
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
    let plan: PaywallPlan
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
        .accessibilityIdentifier("paywall-plan-\(plan.id)")
        .accessibilityLabel("\(plan.title). \(plan.description). \(plan.priceString)")
    }

    private var productTitleRow: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(plan.title)
                    .font(.headline)
                    .accessibilityIdentifier("paywall-plan-title-\(plan.id)")
                Text(plan.description)
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
            Text(plan.priceString)
                .font(.title2)
                .fontWeight(.bold)
                .accessibilityIdentifier("paywall-price-\(plan.id)")
            Spacer()
            savingsBadge
        }
    }

    @ViewBuilder
    private var savingsBadge: some View {
        if plan.id == Constants.ProductIDs.annual {
            Text("Save 20%")
                .font(.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Color.green.opacity(0.2))
                .foregroundColor(.green)
                .cornerRadius(4)
        }
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
