import SwiftUI

/// Paywall screen for subscription purchases. Prices and trial copy come from StoreKit.
struct PaywallView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var premiumManager = PremiumManager.shared
    @State private var selectedPlan: PaywallPlan?
    @State private var showRestoreAlert = false
    @State private var restoreMessage = ""
    @State private var showErrorAlert = false
    @State private var alertError = ""
    @State private var purchaseSuccessTick = 0

    private let brandGreen = Color(red: 21.0 / 255.0, green: 128.0 / 255.0, blue: 61.0 / 255.0)

    private var plans: [PaywallPlan] { premiumManager.paywallPlans }
    private var isLoadingPlans: Bool { premiumManager.paywallPhase == .loading && plans.isEmpty }
    private var plansLoadFailed: Bool { premiumManager.paywallPhase == .failed && plans.isEmpty }

    private var displayPlans: [PaywallPlan] {
        plans.sorted { lhs, rhs in
            let rank: (PaywallPlan) -> Int = { plan in
                plan.id == Constants.ProductIDs.annual ? 0 : 1
            }
            return rank(lhs) < rank(rhs)
        }
    }

    private var monthlyAmount: Decimal? {
        plans.first { plan in plan.id == Constants.ProductIDs.monthly }?.amount
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 28) {
                    headerSection
                    if plansLoadFailed {
                        emptyPlansSection
                    }
                    benefitsSection
                    if let timeline = trialTimeline {
                        trialTimelineSection(timeline)
                    }
                    pricingSection
                    purchaseSection
                    footnoteSection
                    sandboxProbeSection
                }
                .padding(.vertical)
            }
            .accessibilityIdentifier("paywall-root")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.body.weight(.semibold))
                            .frame(width: 32, height: 32)
                    }
                    .accessibilityLabel("Close")
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
            .sensoryFeedback(.success, trigger: purchaseSuccessTick)
        }
    }

    // MARK: - Sections

    private var headerSection: some View {
        VStack(spacing: 16) {
            Text("Eat to your goals with every shop")
                .font(.largeTitle)
                .fontWeight(.bold)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
                .accessibilityIdentifier("paywall-headline")

            if isLoadingPlans {
                Text("Loading plans")
                    .font(.subheadline.weight(.semibold))
                    .accessibilityIdentifier("paywall-load-phase")
            }
        }
        .padding(.top)
    }

    private var benefitsSection: some View {
        VStack(spacing: 12) {
            ForEach(PaywallBenefits.rows, id: \.title) { row in
                BenefitRow(icon: row.icon, title: row.title, tint: brandGreen)
            }
        }
        .padding(.horizontal)
    }

    @ViewBuilder
    private func trialTimelineSection(_ timeline: PaywallPricing.TrialTimeline) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            timelineRow("1", timeline.today)
            timelineRow("2", timeline.remind)
            timelineRow("3", timeline.billed)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.gray.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("paywall-trial-timeline")
    }

    private func timelineRow(_ step: String, _ text: String) -> some View {
        HStack(spacing: 12) {
            Text(step)
                .font(.caption.weight(.bold))
                .foregroundColor(.white)
                .frame(width: 22, height: 22)
                .background(brandGreen)
                .clipShape(Circle())
            Text(text)
                .font(.subheadline)
        }
    }

    @ViewBuilder
    private var pricingSection: some View {
        if !plans.isEmpty {
            VStack(spacing: 12) {
                ForEach(displayPlans) { plan in
                    PackageCard(
                        plan: plan,
                        monthlyAmount: monthlyAmount,
                        isSelected: selectedPlan?.id == plan.id,
                        brandGreen: brandGreen,
                        action: { selectedPlan = plan }
                    )
                }
            }
            .padding(.horizontal)
            .accessibilityIdentifier("paywall-plans")
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
            .buttonStyle(.bordered)
            .accessibilityIdentifier("paywall-retry")
            Button("Restore") {
                Task { await restore() }
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("paywall-restore-inline")
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
        if let plan = selectedPlan, !plans.isEmpty {
            let cta = PaywallPricing.cta(
                displayPrice: plan.priceString,
                periodUnit: plan.periodUnit,
                intro: plan.intro,
                eligible: plan.eligibleForIntro
            )
            Button {
                Task { await purchase(plan) }
            } label: {
                if premiumManager.isLoading {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                } else {
                    VStack(spacing: 2) {
                        Text(cta.title)
                            .font(.system(size: 17, weight: .semibold))
                        if let subline = cta.subline {
                            Text(subline)
                                .font(.footnote)
                        }
                    }
                    .foregroundColor(.white)
                    .multilineTextAlignment(.center)
                }
            }
            .frame(maxWidth: .infinity)
            .padding()
            .background(brandGreen)
            .cornerRadius(12)
            .padding(.horizontal)
            .disabled(premiumManager.isLoading)
            .accessibilityIdentifier("paywall-subscribe")
            .accessibilityLabel(purchaseAccessibilityLabel(cta))
        }
    }

    private var footnoteSection: some View {
        VStack(spacing: 10) {
            Button("Restore") {
                Task { await restore() }
            }
            .font(.footnote)
            .foregroundColor(.secondary)
            .accessibilityIdentifier("paywall-restore")

            HStack(spacing: 6) {
                Button("Terms") {
                    open("https://fitmunch.com.au/terms")
                }
                Text("·")
                Button("Privacy") {
                    open("https://fitmunch.com.au/privacy")
                }
            }
            .font(.footnote)
            .foregroundColor(.secondary)

            Text("Payment will be charged to your Apple ID account at the confirmation of purchase. Subscription automatically renews unless it is canceled at least 24 hours before the end of the current period. You can manage and cancel your subscriptions by going to your account settings on the App Store after purchase.")
                .font(.caption2)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal)
    }

    private var trialTimeline: PaywallPricing.TrialTimeline? {
        guard let plan = selectedPlan else { return nil }
        return PaywallPricing.trialTimeline(intro: plan.intro, eligible: plan.eligibleForIntro)
    }

    private func purchaseAccessibilityLabel(_ cta: PaywallPricing.CTA) -> String {
        var parts = [cta.title]
        if let subline = cta.subline {
            parts.append(subline)
        }
        if let timeline = trialTimeline {
            parts.append(timeline.today)
            parts.append(timeline.remind)
            parts.append(timeline.billed)
        }
        return parts.joined(separator: ". ")
    }

    // MARK: - Methods

    /// Shows loading immediately. Retries once with backoff before the error state.
    /// The error is the only empty state. The screen keeps the headline, Retry, and Restore.
    private func loadPlansWithRetry() async {
        await premiumManager.loadPaywallPlans()
        if let current = selectedPlan, plans.contains(where: { plan in plan.id == current.id }) {
            return
        }
        selectedPlan = plans.first { plan in plan.id == Constants.ProductIDs.annual } ?? plans.first
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
            purchaseSuccessTick += 1
            try? await Task.sleep(nanoseconds: 150_000_000)
            dismiss()
            return
        }
        if let message = premiumManager.errorMessage, !message.isEmpty {
            alertError = message
            showErrorAlert = true
        }
    }

    private func open(_ string: String) {
        if let url = URL(string: string) {
            UIApplication.shared.open(url)
        }
    }
}

/// Benefit lines that exist in this binary. No shopping list, so the week line
/// does not mention one.
enum PaywallBenefits {
    static let rows: [(icon: String, title: String)] = [
        ("doc.viewfinder", "Unlimited receipt scans + haul scores"),
        ("sparkles", "AI coach that knows your shop"),
        ("calendar", "High-protein week planned for you"),
        ("fork.knife", "Unlimited meal logging and full history"),
    ]
}

// MARK: - PackageCard

private struct PackageCard: View {
    let plan: PaywallPlan
    let monthlyAmount: Decimal?
    let isSelected: Bool
    let brandGreen: Color
    let action: () -> Void

    private var isAnnual: Bool { plan.id == Constants.ProductIDs.annual }

    private var perWeek: String? {
        guard isAnnual else { return nil }
        return PaywallPricing.perWeekLabel(annual: plan.amount, currencyCode: plan.currencyCode)
    }

    private var savingsPercent: Int? {
        guard isAnnual, let monthlyAmount else { return nil }
        return PaywallPricing.savingsPercent(monthly: monthlyAmount, annual: plan.amount)
    }

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Text(plan.title)
                        .font(.headline)
                        .accessibilityIdentifier("paywall-plan-title-\(plan.id)")
                    Spacer()
                    if isAnnual {
                        Text("Best value")
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(brandGreen.opacity(0.15))
                            .foregroundColor(brandGreen)
                            .clipShape(Capsule())
                    }
                    if isSelected {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(brandGreen)
                    }
                }
                Text(plan.priceString)
                    .font(.title2.weight(.bold))
                    .accessibilityIdentifier("paywall-price-\(plan.id)")
                if let perWeek {
                    Text(perWeek)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .accessibilityIdentifier("paywall-per-week-\(plan.id)")
                }
                if let savingsPercent {
                    Text("Save \(savingsPercent)%")
                        .font(.subheadline.weight(.semibold))
                        .foregroundColor(brandGreen)
                        .accessibilityIdentifier("paywall-save-\(plan.id)")
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isSelected ? brandGreen.opacity(0.08) : Color.gray.opacity(0.08))
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isSelected ? brandGreen : Color.clear, lineWidth: 2)
            )
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("paywall-plan-\(plan.id)")
        .accessibilityLabel(voiceOverLabel)
    }

    private var voiceOverLabel: String {
        var parts = [plan.title, plan.priceString]
        if let perWeek {
            parts.append(perWeek)
        }
        if isAnnual {
            parts.append("Best value")
        }
        if let savingsPercent {
            parts.append("Save \(savingsPercent) percent")
        }
        let cta = PaywallPricing.cta(
            displayPrice: plan.priceString,
            periodUnit: plan.periodUnit,
            intro: plan.intro,
            eligible: plan.eligibleForIntro
        )
        if plan.intro != nil {
            parts.append(cta.title)
            if let subline = cta.subline {
                parts.append(subline)
            }
            if let timeline = PaywallPricing.trialTimeline(intro: plan.intro, eligible: plan.eligibleForIntro) {
                parts.append(timeline.today)
                parts.append(timeline.remind)
                parts.append(timeline.billed)
            }
        }
        return parts.joined(separator: ". ")
    }
}

private struct BenefitRow: View {
    let icon: String
    let title: String
    let tint: Color

    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundColor(tint)
                .frame(width: 32)
            Text(title)
                .font(.body)
            Spacer()
        }
        .accessibilityElement(children: .combine)
    }
}

#Preview {
    PaywallView()
}
