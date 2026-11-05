import SwiftUI

/// Onboarding and paywall screen
struct OnboardingView: View {
    @StateObject private var viewModel = OnboardingViewModel()
    @Environment(\.dismiss) private var dismiss
    @State private var showPaywall = false
    
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Progress indicator
                HStack(spacing: 8) {
                    ForEach(0..<viewModel.totalSteps, id: \.self) { step in
                        Rectangle()
                            .fill(step <= viewModel.currentStep ? Theme.brandGreen : Color(.tertiarySystemFill))
                            .frame(height: 4)
                            .cornerRadius(2)
                    }
                }
                .padding(.horizontal)
                .padding(.top)
                
                ScrollView {
                    VStack(spacing: viewModel.currentStep == 2 ? 12 : 20) {
                        // Welcome and goals keep the large header. The plan step
                        // drops the icon and title size so the premium price,
                        // "per month", and trial line sit above the footer on a
                        // 375pt phone without the footer covering them.
                        planHeader

                        stepContent
                    }
                    .padding()
                    .padding(.bottom, Theme.Spacing.six)
                }
                .id(viewModel.currentStep)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                // Outside the scroll view. A footer inside the scroll view's
                // inset is drawn at the bottom, but the scroll view keeps the hit.
                // Next then looks tappable and the step never changes.
                // The inset's top edge is the line the price and trial must clear.
                onboardingFooter
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationBarBackButtonHidden(true)
            .overlay {
                if viewModel.isLoading {
                    LoadingSkeletonScreen(rows: 3, label: "Loading your plan", identifier: "onboarding-loading")
                }
            }
            .alert("Error", isPresented: .constant(viewModel.errorMessage != nil)) {
                Button("OK") {
                    viewModel.errorMessage = nil
                }
            } message: {
                if let error = viewModel.errorMessage {
                    Text(error)
                }
            }
            .fullScreenCover(isPresented: $showPaywall) {
                PaywallView()
            }
        }
    }
    
    @ViewBuilder
    private var planHeader: some View {
        let plan = viewModel.currentStep == 2
        VStack(spacing: plan ? 6 : 12) {
            if !plan {
                Image(systemName: "fork.knife.circle.fill")
                    .font(.system(size: 44))
                    .foregroundColor(Theme.brandGreen)
            }

            Text(viewModel.currentStepTitle)
                .font(plan ? .title2 : .largeTitle)
                .fontWeight(.bold)
                .multilineTextAlignment(.center)

            Text(viewModel.currentStepDescription)
                .font(plan ? .subheadline : .body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, plan ? 4 : 16)
    }

    /// Content for the current step
    @ViewBuilder
    private var stepContent: some View {
        switch viewModel.currentStep {
        case 0:
            welcomeStep
        case 1:
            goalsStep
        case 2:
            planStep
        default:
            EmptyView()
        }
    }
    
    /// Welcome step content
    private var welcomeStep: some View {
        VStack(spacing: 24) {
            FeatureRow(
                icon: "chart.line.uptrend.xyaxis",
                title: "Track Your Progress",
                description: "Monitor your nutrition and fitness goals with detailed charts"
            )
            
            FeatureRow(
                icon: "fork.knife",
                title: "Log Meals Easily",
                description: "Quickly add foods and track your daily intake"
            )
            
            FeatureRow(
                icon: "target",
                title: "Reach Your Goals",
                description: "Personalized recommendations based on your fitness objectives"
            )
        }
    }
    
    /// Goals step content
    private var goalsStep: some View {
        VStack(spacing: 12) {
            TextField("Your Name", text: $viewModel.name)
                .textFieldStyle(.roundedBorder)
                .textContentType(.name)
            
            TextField("Email Address", text: $viewModel.email)
                .textFieldStyle(.roundedBorder)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .autocapitalization(.none)
            
            VStack(alignment: .leading, spacing: 8) {
                Text("Fitness Goal")
                    .font(.headline)
                
                ForEach(Constants.FitnessGoals.allCases, id: \.self) { goal in
                    let selected = viewModel.selectedGoal == goal
                    Button {
                        viewModel.selectedGoal = goal
                    } label: {
                        HStack {
                            Text(goal.displayName)
                                .foregroundColor(.primary)
                                .lineLimit(2)
                                .minimumScaleFactor(0.8)
                            Spacer()
                            if selected {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(Theme.brandGreen)
                            }
                        }
                        .padding(.horizontal, Theme.Spacing.four)
                        .frame(minHeight: 44)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(selected ? Theme.brandGreenSoft : Color(.secondarySystemBackground))
                        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous)
                                .stroke(selected ? Theme.brandGreen : Color.clear, lineWidth: 2)
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("onboarding-goal-\(goal.rawValue)")
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
            .sensoryFeedback(.selection, trigger: viewModel.selectedGoal)
        }
    }
    
    /// Plan step content
    private var planStep: some View {
        VStack(spacing: 12) {
            PlanCard(
                title: "Free",
                price: "Free",
                period: "forever",
                features: [
                    "Log up to 3 meals per day",
                    "Today's calories and macros",
                    "Set fitness goals"
                ],
                isSelected: false,
                cardID: "onboarding-plan-free",
                priceID: "onboarding-free-price",
                action: {}
            )
            
            PlanCard(
                title: "Premium",
                price: viewModel.premiumPriceText,
                period: viewModel.premiumPeriodText,
                trial: viewModel.premiumTrialText,
                features: [
                    "Unlimited meal logging",
                    "Full history and charts",
                    "AI meal plans and coach",
                    "Data export"
                ],
                isSelected: true,
                cardID: "onboarding-plan-premium",
                priceID: "onboarding-premium-price",
                periodID: "onboarding-premium-period",
                trialID: "onboarding-premium-trial",
                action: {
                    showPaywall = true
                }
            )
            
            Text("Start with free plan, upgrade anytime")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .onAppear {
            print("ONBOARDING_PLAN visible")
        }
        .task {
            // The title and cards are already on screen. Yield so that frame
            // commits before any StoreKit work is scheduled.
            await Task.yield()
            await viewModel.loadPremiumPrice()
        }
    }

    /// Pinned under the scroll view so Back and Next take the tap.
    private var onboardingFooter: some View {
        HStack {
            if viewModel.currentStep > 0 {
                Button("Back") {
                    viewModel.previousStep()
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("onboarding-back")
            }

            Spacer()

            if viewModel.currentStep < viewModel.totalSteps - 1 {
                Button("Next") {
                    viewModel.nextStep()
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.buttonFill)
                .accessibilityIdentifier("onboarding-next")
            } else {
                Button("Get Started") {
                    Task {
                        if await viewModel.completeOnboarding() {
                            dismiss()
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.buttonFill)
                .disabled(viewModel.isLoading)
                .accessibilityIdentifier("onboarding-get-started")
            }
        }
        .padding(.horizontal)
        .padding(.top, 12)
        .padding(.bottom, 12)
        .background(.ultraThinMaterial)
        // No identifier on this stack. It replaces onboarding-next, so the
        // width test cannot find Next. Footer top is the button top minus
        // this 12pt padding.
    }
}

/// Feature row for welcome step
private struct FeatureRow: View {
    let icon: String
    let title: String
    let description: String
    
    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundColor(Theme.brandGreen)
                .frame(width: 40)
            
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)
                Text(description)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
            
            Spacer()
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }
}

/// Skips an empty identifier so the free card does not publish a blank id.
private struct OptionalAccessibilityID: ViewModifier {
    let identifier: String

    @ViewBuilder
    func body(content: Content) -> some View {
        if identifier.isEmpty {
            content
        } else {
            content.accessibilityIdentifier(identifier)
        }
    }
}

/// Plan card for plan selection
private struct PlanCard: View {
    let title: String
    let price: String
    let period: String
    var trial: String = ""
    let features: [String]
    let isSelected: Bool
    let cardID: String
    let priceID: String
    var periodID: String = ""
    var trialID: String = ""
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text(title)
                        .font(.title2)
                        .fontWeight(.bold)
                    Spacer()
                    if isSelected {
                        Text("Selected")
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Theme.brandGreenSoft)
                            .foregroundStyle(Theme.brandGreen)
                            .clipShape(Capsule())
                    }
                }
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(price)
                        .font(.title.weight(.bold))
                        .minimumScaleFactor(0.7)
                        .lineLimit(1)
                        .accessibilityIdentifier(priceID)
                    Text(period)
                        .font(.subheadline)
                        .foregroundColor(Theme.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                        .modifier(OptionalAccessibilityID(identifier: periodID))
                    if isSelected && !trial.isEmpty {
                        Text(trial)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.brandGreen)
                            .fixedSize(horizontal: false, vertical: true)
                            .modifier(OptionalAccessibilityID(identifier: trialID))
                    }
                }
                
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(features, id: \.self) { feature in
                        HStack(spacing: 8) {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                                .font(.caption)
                            Text(feature)
                                .font(.subheadline)
                        }
                    }
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isSelected ? Theme.brandGreenSoft : Color(.secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.large, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.large, style: .continuous)
                    .stroke(isSelected ? Theme.brandGreen : Color.clear, lineWidth: 2)
            )
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(cardID)
    }
}

#Preview {
    OnboardingView()
}