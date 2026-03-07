import SwiftUI

/// Settings screen for user preferences and app management
struct SettingsView: View {
    @StateObject private var viewModel = SettingsViewModel()
    @State private var showLogoutAlert = false
    @State private var showResetAlert = false
    @State private var navigateToOnboarding = false
    
    var body: some View {
        NavigationStack {
            List {
                // Profile section
                Section {
                    HStack {
                        Image(systemName: "person.circle.fill")
                            .font(.system(size: 50))
                            .foregroundColor(.blue)
                        
                        VStack(alignment: .leading, spacing: 4) {
                            Text(viewModel.userDisplayName)
                                .font(.headline)
                            Text(viewModel.userEmail)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        
                        Spacer()
                        
                        VStack {
                            Text(viewModel.subscriptionStatus)
                                .font(.caption)
                                .fontWeight(.semibold)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(viewModel.subscriptionStatusColor.opacity(0.2))
                                .foregroundColor(viewModel.subscriptionStatusColor)
                                .cornerRadius(4)
                            
                            if !viewModel.isSubscribed {
                                Button("Upgrade") {
                                    // This would open paywall
                                }
                                .font(.caption2)
                                .buttonStyle(.borderedProminent)
                                .buttonBorderShape(.capsule)
                                .controlSize(.mini)
                            }
                        }
                    }
                    .padding(.vertical, 8)
                } header: {
                    Text("Profile")
                }
                
                // Preferences section
                Section("Preferences") {
                    Toggle("Dark Mode", isOn: $viewModel.isDarkMode)
                        .onChange(of: viewModel.isDarkMode) { _, newValue in
                            viewModel.toggleDarkMode()
                        }
                    
                    Toggle("Notifications", isOn: $viewModel.notificationsEnabled)
                        .onChange(of: viewModel.notificationsEnabled) { _, newValue in
                            viewModel.toggleNotifications()
                        }
                    
                    Toggle("Metric Units", isOn: $viewModel.useMetricUnits)
                        .onChange(of: viewModel.useMetricUnits) { _, newValue in
                            viewModel.toggleMetricUnits()
                        }
                }
                
                // Subscription section
                Section("Subscription") {
                    if viewModel.isSubscribed {
                        HStack {
                            Text("Status")
                            Spacer()
                            Text("Active")
                                .foregroundColor(.green)
                                .fontWeight(.semibold)
                        }
                        
                        Button("Manage Subscription") {
                            // This would open App Store subscription management
                            if let url = URL(string: "https://apps.apple.com/account/subscriptions") {
                                UIApplication.shared.open(url)
                            }
                        }
                        .foregroundColor(.blue)
                    } else {
                        Button("Upgrade to Premium") {
                            // This would open paywall
                        }
                        .foregroundColor(.blue)
                    }
                    
                    Button("Restore Purchases") {
                        Task {
                            await viewModel.restorePurchases()
                        }
                    }
                    .foregroundColor(.blue)
                    .disabled(viewModel.isLoading)
                }
                
                // Support section
                Section("Support") {
                    Button("Contact Support") {
                        viewModel.contactSupport()
                    }
                    .foregroundColor(.blue)
                    
                    Button("Privacy Policy") {
                        viewModel.viewPrivacyPolicy()
                    }
                    .foregroundColor(.blue)
                    
                    Button("Terms of Service") {
                        viewModel.viewTermsOfService()
                    }
                    .foregroundColor(.blue)
                    
                    Button("Rate the App") {
                        // This would open App Store review
                        if let url = URL(string: "https://apps.apple.com/app/idYOUR_APP_ID?action=write-review") {
                            UIApplication.shared.open(url)
                        }
                    }
                    .foregroundColor(.blue)
                }
                
                // Data section
                Section("Data") {
                    Button("Export Data") {
                        // This would export user data
                    }
                    .foregroundColor(.blue)
                    .disabled(!viewModel.isSubscribed)
                    
                    Button("Reset Data", role: .destructive) {
                        showResetAlert = true
                    }
                }
                
                // About section
                Section("About") {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text("\(viewModel.appVersion) (\(viewModel.buildNumber))")
                            .foregroundColor(.secondary)
                    }
                    
                    HStack {
                        Text("Build Date")
                        Spacer()
                        Text("March 2025")
                            .foregroundColor(.secondary)
                    }
                }
                
                // Account section
                Section {
                    Button("Log Out", role: .destructive) {
                        showLogoutAlert = true
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .navigationTitle("Settings")
            .onAppear {
                viewModel.loadPreferences()
            }
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
            .alert("Log Out", isPresented: $showLogoutAlert) {
                Button("Cancel", role: .cancel) { }
                Button("Log Out", role: .destructive) {
                    viewModel.logOut()
                    navigateToOnboarding = true
                }
            } message: {
                Text("Are you sure you want to log out? Your local data will be preserved.")
            }
            .alert("Reset Data", isPresented: $showResetAlert) {
                Button("Cancel", role: .cancel) { }
                Button("Reset", role: .destructive) {
                    // This would reset all user data
                }
            } message: {
                Text("This will delete all your meal logs and reset the app to its initial state. This action cannot be undone.")
            }
            .navigationDestination(isPresented: $navigateToOnboarding) {
                OnboardingView()
            }
        }
    }
}

/// Settings row with icon
private struct SettingsRow: View {
    let icon: String
    let title: String
    let color: Color
    
    var body: some View {
        HStack {
            Image(systemName: icon)
                .font(.headline)
                .foregroundColor(color)
                .frame(width: 30)
            
            Text(title)
                .font(.body)
            
            Spacer()
            
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 8)
    }
}

#Preview {
    SettingsView()
}