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
    @State private var successDetail: String?

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
                VStack(spacing: 16) {
                    headerSection
                    if isLoadingPlans {
                        LoadingSkeleton(rows: 3, label: "Loading plans", identifier: "paywall-loading")
                    }
                    benefitsSection
                    if plansLoadFailed {
                        emptyPlansSection
                    }
                    if let timeline = trialTimeline {
                        trialTimelineSection(timeline)
                    }
                    pricingSection
                }
                .padding(.horizontal)
                .padding(.top, 4)
                .padding(.bottom, 8)
            }
            .contentMargins(.top, 0, for: .scrollContent)
            .accessibilityIdentifier("paywall-root")
            .navigationBarTitleDisplayMode(.inline)
            .background(Theme.surface.ignoresSafeArea())
            .toolbarBackground(Theme.surface, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.body.weight(.semibold))
                            .frame(width: 44, height: 44)
                    }
                    .accessibilityLabel("Close")
                    .accessibilityIdentifier("paywall-close")
                }
            }
            .refreshable {
                await loadPlansWithRetry()
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                bottomBar
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
            .overlay {
                if let successDetail {
                    successCard(successDetail)
                }
            }
        }
    }

    private func successCard(_ detail: String) -> some View {
        VStack(spacing: Theme.Spacing.four) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 48))
                .foregroundStyle(Theme.brandGreen)
            Text("You're in")
                .font(.title2.weight(.bold))
            Text(detail)
                .font(.body)
                .multilineTextAlignment(.center)
                .foregroundStyle(Theme.secondaryText)
            Button("Continue") { dismiss() }
                .buttonStyle(PrimaryButtonStyle())
        }
        .padding(Theme.Spacing.six)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.surface.ignoresSafeArea())
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("paywall-success")
    }

    // MARK: - Sections

    private var headerSection: some View {
        VStack(spacing: 8) {
            Text("Eat to your goals with every shop")
                .font(.title.weight(.bold))
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .accessibilityIdentifier("paywall-headline")
        }
    }

    private var benefitsSection: some View {
        VStack(spacing: 10) {
            ForEach(PaywallBenefits.rows, id: \.title) { row in
                BenefitRow(icon: row.icon, title: row.title, tint: Theme.green)
            }
        }
    }

    @ViewBuilder
    private func trialTimelineSection(_ timeline: PaywallPricing.TrialTimeline) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            timelineRow("1", timeline.today, identifier: "paywall-trial-today")
            timelineRow("2", timeline.reminder, identifier: "paywall-trial-reminder")
            timelineRow("3", timeline.billed, identifier: "paywall-trial-billing")
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("paywall-trial-timeline")
    }

    private func timelineRow(_ step: String, _ text: String, identifier: String) -> some View {
        HStack(spacing: 12) {
            Text(step)
                .font(.caption.weight(.bold))
                .foregroundColor(.white)
                .frame(width: 22, height: 22)
                .background(Theme.buttonGreen)
                .clipShape(Circle())
            Text(text)
                .font(.subheadline)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(identifier)
    }

    @ViewBuilder
    private var pricingSection: some View {
        if !plans.isEmpty {
            VStack(spacing: 10) {
                ForEach(displayPlans) { plan in
                    PackageCard(
                        plan: plan,
                        monthlyAmount: monthlyAmount,
                        isSelected: selectedPlan?.id == plan.id,
                        brandGreen: Theme.green,
                        action: { selectedPlan = plan }
                    )
                }
            }
            .accessibilityIdentifier("paywall-plans")
        }
    }

    private var emptyPlansSection: some View {
        VStack(spacing: 14) {
            Text(PaywallLoadPolicy.userFacingLoadFailure)
                .font(.subheadline.weight(.semibold))
                .multilineTextAlignment(.center)
                .accessibilityIdentifier("paywall-error")
            Button {
                Task { await loadPlansWithRetry() }
            } label: {
                Text("Retry")
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .accessibilityIdentifier("paywall-retry")
            }
            .accessibilityIdentifier("paywall-retry")
            .buttonStyle(PaywallChoiceButtonStyle(identifier: "paywall-retry"))
            legalButton("Restore Purchases", identifier: "paywall-restore-inline") {
                Task { await restore() }
            }
        }
        .accessibilityIdentifier("paywall-error-state")
    }

    @ViewBuilder
    private var sandboxProbeSection: some View {
        #if DEBUG
        if PaywallLaunchArgument.isSandboxProbe {
            Text(premiumManager.lastPlanFetchSummary.isEmpty ? "probe:pending" : "probe:\(premiumManager.lastPlanFetchSummary)")
                .font(.caption2)
                .foregroundColor(Theme.secondaryText)
                .accessibilityIdentifier("sandbox-probe-summary")
        }
        #endif
    }

    private var bottomBar: some View {
        VStack(spacing: 8) {
            sandboxProbeSection
            if let plan = selectedPlan, !plans.isEmpty {
                Text(renewalLine(plan))
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("paywall-renewal")
                subscribeButton(plan)
            }
            if !plansLoadFailed {
                legalButton("Restore Purchases", identifier: "paywall-restore") {
                    Task { await restore() }
                }
            }

            HStack(spacing: 6) {
                legalButton("Terms", identifier: "paywall-terms") {
                    open("https://fitmunch.com.au/terms")
                }
                Text("·")
                legalButton("Privacy", identifier: "paywall-privacy") {
                    open("https://fitmunch.com.au/privacy")
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 6)
        .frame(maxWidth: .infinity)
        .background(Theme.surface.ignoresSafeArea(edges: .bottom))
    }

    private func subscribeButton(_ plan: PaywallPlan) -> some View {
        let cta = PaywallPricing.cta(
            displayPrice: plan.priceString,
            periodUnit: plan.periodUnit,
            intro: plan.intro,
            eligible: plan.eligibleForIntro
        )
        return Button {
            Task { await purchase(plan) }
        } label: {
            if premiumManager.isLoading {
                Text("Confirming with the App Store")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .accessibilityIdentifier("paywall-confirming")
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
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .padding(.horizontal, 12)
            }
        }
        .background(Theme.buttonGreen)
        .cornerRadius(12)
        .disabled(premiumManager.isLoading)
        .accessibilityIdentifier("paywall-subscribe")
        .accessibilityLabel(purchaseAccessibilityLabel(cta))
    }

    private func renewalLine(_ plan: PaywallPlan) -> String {
        PaywallPricing.renewalTerms(
            displayPrice: plan.priceString,
            periodUnit: plan.periodUnit,
            intro: plan.intro,
            eligible: plan.eligibleForIntro
        )
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
            parts.append(timeline.reminder)
            parts.append(timeline.billed)
        }
        return parts.joined(separator: ". ")
    }

    // MARK: - Methods

    /// Shows loading immediately. Retries once with backoff before the error state.
    /// The error is the only empty state. The screen keeps the headline, Retry, and Restore Purchases.
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
            successDetail = trialEndCopy(plan)
            purchaseSuccessTick += 1
            return
        }
        if let message = premiumManager.errorMessage, !message.isEmpty {
            alertError = message
            showErrorAlert = true
        }
    }

    /// Trial end is the intro length on the purchased product, counted from today.
    private func trialEndCopy(_ plan: PaywallPlan) -> String {
        if plan.eligibleForIntro, let intro = plan.intro, intro.isFreeTrial {
            if let end = PaywallPricing.trialEndDate(intro) {
                return "Your free trial ends \(end.formatted(date: .long, time: .omitted))."
            }
        }
        return "Premium is on."
    }

    /// 44pt target on the text itself. A Button style was measuring as the glyph height.
    private func legalButton(_ title: String, identifier: String, action: @escaping () -> Void) -> some View {
        Text(title)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Theme.secondaryText)
            .frame(maxWidth: .infinity, minHeight: 44)
            .contentShape(Rectangle())
            .onTapGesture(perform: action)
            .accessibilityLabel(title)
            .accessibilityIdentifier(identifier)
            .accessibilityAddTraits(.isButton)
            .accessibilityAction(.default, action)
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

    private var priceLine: String {
        PaywallPricing.priceWithPeriod(displayPrice: plan.priceString, periodUnit: plan.periodUnit)
    }

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
            VStack(alignment: .leading, spacing: 6) {
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
                            .foregroundColor(Theme.buttonGreen)
                            .clipShape(Capsule())
                    }
                    if isSelected {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(brandGreen)
                    }
                }
                Text(priceLine)
                    .font(.title3.weight(.bold))
                    .accessibilityIdentifier("paywall-price-\(plan.id)")
                if let perWeek {
                    Text(perWeek)
                        .font(.subheadline.weight(.semibold))
                        .foregroundColor(Theme.secondaryText)
                        .accessibilityIdentifier("paywall-per-week-\(plan.id)")
                }
                if let savingsPercent {
                    Text("Save \(savingsPercent)%")
                        .font(.subheadline.weight(.semibold))
                        .foregroundColor(Theme.buttonGreen)
                        .accessibilityIdentifier("paywall-save-\(plan.id)")
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isSelected ? Theme.brandGreenSoft : Color(.secondarySystemBackground))
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
        var parts = [plan.title, priceLine]
        if let perWeek {
            parts.append(perWeek)
        }
        if isAnnual {
            parts.append("Best value")
        }
        if let savingsPercent {
            parts.append("Save \(savingsPercent) percent")
        }
        return parts.joined(separator: ". ")
    }
}

/// Bordered system style hides its accessibility identifier on iOS 26.
/// Same two pills: Retry and Restore, 44pt tall, brand green label.
private struct PaywallChoiceButtonStyle: ButtonStyle {
    var identifier: String

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(Theme.brandGreen)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, minHeight: 44)
            .padding(.horizontal, 12)
            .background(Capsule(style: .continuous).fill(Color(.secondarySystemBackground)))
            .overlay(Capsule(style: .continuous).stroke(Theme.brandGreen.opacity(0.45), lineWidth: 1))
            .opacity(configuration.isPressed ? 0.75 : 1)
            .accessibilityElement(children: .ignore)
            .accessibilityIdentifier(identifier)
            .accessibilityAddTraits(.isButton)
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
