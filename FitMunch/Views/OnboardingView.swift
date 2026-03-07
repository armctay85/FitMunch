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
                            .fill(step <= viewModel.currentStep ? .blue : .gray.opacity(0.3))
                            .frame(height: 4)
                            .cornerRadius(2)
                    }
                }
                .padding(.horizontal)
                .padding(.top)
                
                ScrollView {
                    VStack(spacing: 32) {
                        // Header
                        VStack(spacing: 16) {
                            Image(systemName: "fork.knife.circle.fill")
                                .font(.system(size: 80))
                                .foregroundColor(.blue)
                            
                            Text(viewModel.currentStepTitle)
                                .font(.largeTitle)
                                .fontWeight(.bold)
                                .multilineTextAlignment(.center)
                            
                            Text(viewModel.currentStepDescription)
                                .font(.body)
                                .foregroundColor(.secondary)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal)
                        }
                        .padding(.top, 32)
                        
                        // Step content
                        stepContent
                        
                        Spacer()
                    }
                    .padding()
                }
                
                // Navigation buttons
                HStack {
                    if viewModel.currentStep > 0 {
                        Button("Back") {
                            viewModel.previousStep()
                        }
                        .buttonStyle(.bordered)
                    }
                    
                    Spacer()
                    
                    if viewModel.currentStep < viewModel.totalSteps - 1 {
                        Button("Next") {
                            viewModel.nextStep()
                        }
                        .buttonStyle(.borderedProminent)
                    } else {
                        Button("Get Started") {
                            Task {
                                if await viewModel.completeOnboarding() {
                                    dismiss()
                                }
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(viewModel.isLoading)
                    }
                }
                .padding()
                .background(.ultraThinMaterial)
            }
            .navigationBarBackButtonHidden(true)
            .overlay {
                if viewModel.isLoading {
                    ProgressView()
                        .scaleEffect(1.5)
                        .padding()
                        .background(.regularMaterial)
                        .cornerRadius(16)
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
            .sheet(isPresented: $showPaywall) {
                PaywallView()
            }
        }
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
        VStack(spacing: 24) {
            TextField("Your Name", text: $viewModel.name)
                .textFieldStyle(.roundedBorder)
                .textContentType(.name)
            
            TextField("Email Address", text: $viewModel.email)
                .textFieldStyle(.roundedBorder)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .autocapitalization(.none)
            
            VStack(alignment: .leading, spacing: 12) {
                Text("Fitness Goal")
                    .font(.headline)
                
                ForEach(Constants.FitnessGoals.allCases, id: \.self) { goal in
                    Button {
                        viewModel.selectedGoal = goal
                    } label: {
                        HStack {
                            Text(goal.displayName)
                                .foregroundColor(.primary)
                            Spacer()
                            if viewModel.selectedGoal == goal {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.blue)
                            }
                        }
                        .padding()
                        .background(Color.gray.opacity(0.1))
                        .cornerRadius(8)
                    }
                }
            }
        }
    }
    
    /// Plan step content
    private var planStep: some View {
        VStack(spacing: 24) {
            PlanCard(
                title: "Free",
                price: "$0",
                period: "forever",
                features: [
                    "Log up to 3 meals per day",
                    "7-day history view",
                    "Basic food database",
                    "Set fitness goals"
                ],
                isSelected: false,
                action: {}
            )
            
            PlanCard(
                title: "Premium",
                price: "$9.99",
                period: "per month",
                features: [
                    "Unlimited meal logging",
                    "Full history & advanced charts",
                    "Premium food database with recipes",
                    "Data export & insights",
                    "Personalized recommendations"
                ],
                isSelected: true,
                action: {
                    showPaywall = true
                }
            )
            
            Text("Start with free plan, upgrade anytime")
                .font(.caption)
                .foregroundColor(.secondary)
        }
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
                .foregroundColor(.blue)
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
        .background(Color.gray.opacity(0.1))
        .cornerRadius(12)
    }
}

/// Plan card for plan selection
private struct PlanCard: View {
    let title: String
    let price: String
    let period: String
    let features: [String]
    let isSelected: Bool
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text(title)
                        .font(.title2)
                        .fontWeight(.bold)
                    Spacer()
                    if isSelected {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.blue)
                            .font(.title2)
                    }
                }
                
                VStack(alignment: .leading, spacing: 4) {
                    Text(price)
                        .font(.largeTitle)
                        .fontWeight(.bold)
                    Text(period)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                
                VStack(alignment: .leading, spacing: 8) {
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
            .background(isSelected ? Color.blue.opacity(0.1) : Color.gray.opacity(0.1))
            .cornerRadius(16)
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(isSelected ? Color.blue : Color.clear, lineWidth: 2)
            )
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    OnboardingView()
}