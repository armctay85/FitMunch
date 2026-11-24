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
            // One column. A bottom inset taller than the iPad compatibility
            // window (and the iPhone 16e window) drew the Annual card over the
            // headline and the last feature row. ViewThatFits keeps every row
            // in that column, and scrolls only when the window is shorter.
            GeometryReader { proxy in
                let offered = proxy.size
                ViewThatFits(in: .vertical) {
                    paywallColumn(.regular, width: offered.width)
                        .fixedSize(horizontal: false, vertical: true)
                    paywallColumn(.compact, width: offered.width)
                        .fixedSize(horizontal: false, vertical: true)
                    ScrollView {
                        paywallColumn(.compact, width: offered.width)
                    }
                    .refreshable {
                        await loadPlansWithRetry()
                    }
                    .frame(width: offered.width, height: offered.height, alignment: .top)
                }
                .frame(width: offered.width, height: offered.height, alignment: .top)
            }
            .background(Theme.surface)
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

    private func paywallColumn(_ density: PaywallDensity, width: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: density.section) {
            headerSection(density)
            if isLoadingPlans {
                paywallLoadingCards
            }
            benefitsSection(density)
            if plansLoadFailed {
                emptyPlansSection
            }
            if let timeline = trialTimeline {
                trialTimelineSection(timeline, compact: density == .compact)
            }
            if !plans.isEmpty {
                pricingSection(density)
            }
            bottomBar(density)
        }
        .padding(.horizontal, 16)
        .padding(.top, density == .compact ? 0 : 4)
        .padding(.bottom, 4)
        .frame(width: width, alignment: .top)
    }

    private func headerSection(_ density: PaywallDensity) -> some View {
        VStack(spacing: 8) {
            // Wraps on iPhone 16e, 6.9in, and iPad compatibility mode.
            // A single line was clipping after "with" on the iPad Air 11-inch window.
            Text("Eat to your goals with every shop")
                .font(density.headline)
                .foregroundStyle(Theme.offwhite)
                .multilineTextAlignment(.center)
                .lineLimit(nil)
                .fixedSize(horizontal: false, vertical: true)
                .frame(minWidth: 0, maxWidth: .infinity, alignment: .center)
                .accessibilityIdentifier("paywall-headline")
        }
        .frame(maxWidth: .infinity)
    }

    private func benefitsSection(_ density: PaywallDensity) -> some View {
        VStack(spacing: density.benefitSpacing) {
            ForEach(Array(PaywallBenefits.rows.enumerated()), id: \.element.title) { index, row in
                BenefitRow(
                    icon: row.icon,
                    title: row.title,
                    tint: Theme.green,
                    identifier: "paywall-benefit-\(index)",
                    compact: density == .compact
                )
            }
        }
    }

    @ViewBuilder
    private func trialTimelineSection(_ timeline: PaywallPricing.TrialTimeline, compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: compact ? 4 : 10) {
            timelineRow("1", timeline.today, identifier: "paywall-trial-today", compact: compact)
            timelineRow("2", timeline.reminder, identifier: "paywall-trial-reminder", compact: compact)
            timelineRow("3", timeline.billed, identifier: "paywall-trial-billing", compact: compact)
        }
        .padding(compact ? 8 : 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.fmSurface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("paywall-trial-timeline")
    }

    private func timelineRow(_ step: String, _ text: String, identifier: String, compact: Bool) -> some View {
        HStack(spacing: compact ? 8 : 12) {
            Text(step)
                .font(.caption.weight(.bold))
                .foregroundColor(Theme.forest)
                .frame(width: compact ? 18 : 22, height: compact ? 18 : 22)
                .background(Theme.mint)
                .clipShape(Circle())
            Text(text)
                .font(compact ? .caption : .subheadline)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(identifier)
    }

    @ViewBuilder
    private func pricingSection(_ density: PaywallDensity) -> some View {
        if !plans.isEmpty {
            VStack(spacing: density.planSpacing) {
                ForEach(displayPlans) { plan in
                    PackageCard(
                        plan: plan,
                        monthlyAmount: monthlyAmount,
                        isSelected: selectedPlan?.id == plan.id,
                        brandGreen: Theme.green,
                        padding: density.cardPadding,
                        stackSpacing: density.cardSpacing,
                        action: { selectedPlan = plan }
                    )
                }
            }
            .accessibilityIdentifier("paywall-plans")
        }
    }

    private var emptyPlansSection: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 24))
                .foregroundStyle(Theme.errorDark)
            Text("Couldn't load plans")
                .font(.headline.weight(.semibold))
                .accessibilityIdentifier("paywall-error")
                .accessibilityLabel(PaywallLoadPolicy.userFacingLoadFailure)
            Text("Check your connection and try again.")
                .font(.subheadline)
                .foregroundStyle(Theme.fmSecondary)
                .multilineTextAlignment(.center)
            Button {
                Task { await loadPlansWithRetry() }
            } label: {
                Text("Try again")
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(Theme.forest)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 48)
                    .accessibilityIdentifier("paywall-retry")
            }
            .background(Theme.mint)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .accessibilityIdentifier("paywall-retry")
            legalButton("Restore Purchases", identifier: "paywall-restore-inline") {
                Task { await restore() }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        .background(Theme.fmSurface)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Theme.fmSeparator, lineWidth: 1)
        )
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

    private func bottomBar(_ density: PaywallDensity) -> some View {
        VStack(spacing: density == .compact ? 4 : 8) {
            sandboxProbeSection
            if let plan = selectedPlan, !plans.isEmpty {
                Text(renewalLine(plan))
                    .font(.footnote)
                    .foregroundStyle(Theme.fmSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity)
                    .accessibilityIdentifier("paywall-renewal")
                subscribeButton(plan)
            }
            if !plansLoadFailed {
                legalButton("Restore Purchases", identifier: "paywall-restore") {
                    Task { await restore() }
                }
            }

            HStack(spacing: 6) {
                legalButton("Terms of Use", identifier: "paywall-terms") {
                    open("https://fitmunch.com.au/terms")
                }
                Text("·")
                legalButton("Privacy Policy", identifier: "paywall-privacy") {
                    open("https://fitmunch.com.au/privacy")
                }
            }
        }
        .padding(.top, density == .compact ? 2 : 6)
        .padding(.bottom, 2)
        .frame(maxWidth: .infinity)
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
                    .foregroundStyle(Theme.forest)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .accessibilityIdentifier("paywall-confirming")
            } else {
                Text(cta.title)
                    .font(.system(size: 17, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.9)
                    .foregroundColor(Theme.forest)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 48)
                    .padding(.horizontal, 12)
            }
        }
        .background(Theme.mint)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .disabled(premiumManager.isLoading)
        .accessibilityIdentifier("paywall-subscribe")
        .accessibilityLabel(purchaseAccessibilityLabel(cta))
    }

    private func renewalLine(_ plan: PaywallPlan) -> String {
        let billing = PaywallPricing.renewalTerms(
            displayPrice: plan.priceString,
            periodUnit: plan.periodUnit,
            intro: plan.intro,
            eligible: plan.eligibleForIntro
        )
        guard plan.eligibleForIntro, let intro = plan.intro, intro.isFreeTrial, intro.periodUnit == .day else {
            return billing
        }
        let price = PaywallPricing.priceWithPeriod(displayPrice: plan.priceString, periodUnit: plan.periodUnit)
        return "\(intro.periodValue) days free, then \(price). Cancel anytime in Settings. \(billing)"
    }

    /// Two plan-shaped blocks. One accessibility name, so loading does not say it twice.
    private var paywallLoadingCards: some View {
        VStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Theme.fmSurface)
                .frame(height: 88)
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Theme.fmSurface)
                .frame(height: 88)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading plans")
        .accessibilityIdentifier("paywall-loading")
    }

    private var trialTimeline: PaywallPricing.TrialTimeline? {
        guard let plan = selectedPlan else { return nil }
        return PaywallPricing.trialTimeline(intro: plan.intro, eligible: plan.eligibleForIntro)
    }

    private func purchaseAccessibilityLabel(_ cta: PaywallPricing.CTA) -> String {
        var parts = [cta.title]
        if cta.title.localizedCaseInsensitiveContains("trial") {
            parts.append("free trial")
        }
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
            : (premiumManager.errorMessage ?? "No purchases to restore")
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

    /// 44pt target. The width test measures the element that carries the identifier.
    /// children: .ignore collapsed that element to the footnote line, about 20pt.
    private func legalButton(_ title: String, identifier: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.secondaryText)
                .frame(maxWidth: .infinity, minHeight: 44)
                .contentShape(Rectangle())
                .accessibilityIdentifier(identifier)
        }
        .buttonStyle(PaywallLegalButtonStyle(identifier: identifier))
        .accessibilityIdentifier(identifier)
    }

    private func open(_ string: String) {
        if let url = URL(string: string) {
            UIApplication.shared.open(url)
        }
    }
}

/// Spacing that still leaves the headline, four feature rows, both plans,
/// and the renewal sentence on a 6.5-inch phone. Compact is the iPhone 16e
/// and iPad compatibility column. Scroll is only the fallback.
private enum PaywallDensity {
    case regular, compact

    var section: CGFloat { self == .regular ? 10 : 6 }
    var benefitSpacing: CGFloat { self == .regular ? 8 : 4 }
    var planSpacing: CGFloat { self == .regular ? 8 : 6 }
    var cardPadding: CGFloat { self == .regular ? 12 : 8 }
    var cardSpacing: CGFloat { self == .regular ? 4 : 2 }
    var headline: Font { .title2.weight(.bold) }
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
    var padding: CGFloat = 12
    var stackSpacing: CGFloat = 6
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
            VStack(alignment: .leading, spacing: stackSpacing) {
                HStack(alignment: .firstTextBaseline) {
                    Text(plan.title)
                        .font(.headline)
                        .accessibilityIdentifier("paywall-plan-title-\(plan.id)")
                    Spacer()
                    if isAnnual {
                        Text("Best value")
                            .font(.footnote.weight(.semibold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Theme.mint)
                            .foregroundStyle(Theme.forest)
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
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
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isSelected ? Theme.brandGreenSoft : Theme.fmSurface)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(isSelected ? Theme.fmBrand : Theme.fmSeparator, lineWidth: isSelected ? 2 : 1)
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

/// Fixed 44pt hit target. Combine keeps the laid-out frame. Ignore shrank it to the text line.
private struct PaywallLegalButtonStyle: ButtonStyle {
    var identifier: String

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Theme.secondaryText)
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .contentShape(Rectangle())
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(identifier)
            .accessibilityAddTraits(.isButton)
            .opacity(configuration.isPressed ? 0.75 : 1)
    }
}

/// Bordered system style hides its accessibility identifier on iOS 26.
/// Same two pills: Retry and Restore, 44pt tall, off-white label on a surface fill.
private struct PaywallChoiceButtonStyle: ButtonStyle {
    var identifier: String

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(Theme.offwhite)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, minHeight: 44)
            .padding(.horizontal, 12)
            .background(Capsule(style: .continuous).fill(Theme.fmSurface))
            .overlay(Capsule(style: .continuous).stroke(Theme.muteDark, lineWidth: 1.5))
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
    var identifier: String
    var compact: Bool

    var body: some View {
        HStack(spacing: compact ? 10 : 12) {
            Image(systemName: icon)
                .font(compact ? .subheadline : .body)
                .foregroundColor(tint)
                .frame(width: compact ? 22 : 28)
            Text(title)
                .font(compact ? .subheadline : .body)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(title)
        .accessibilityIdentifier(identifier)
    }
}

#Preview {
    PaywallView()
}
