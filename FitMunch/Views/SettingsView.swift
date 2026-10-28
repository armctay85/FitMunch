import SwiftData
import SwiftUI
import UIKit

/// Settings screen for user preferences and app management
struct SettingsView: View {
    var privacyRequest: Int = 0
    @StateObject private var viewModel = SettingsViewModel()
    @EnvironmentObject private var auth: AuthManager
    @State private var showLogoutAlert = false
    @State private var showResetAlert = false
    @State private var showDeleteAlert = false
    @State private var navigateToOnboarding = false
    @State private var showPaywall = false
    @State private var exportCSV: String?
    @State private var exportError: String?
    @State private var privacyExpanded = false
    @ObservedObject private var premium = PremiumManager.shared
    @ObservedObject private var consent = AIDataConsent.shared
    @Environment(\.modelContext) private var modelContext

    /// Signed-in name and email. Blank accounts and the old placeholder stay empty.
    /// Screenshot capture uses a marked sample, never a fake person.
    private var signedInProfile: (name: String, email: String)? {
        if ScreenshotLaunch.isActive {
            return ("Sample", "sample.account@fitmunch.com.au")
        }
        guard let user = auth.user else { return nil }
        let name = user.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let email = user.email.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty && email.isEmpty { return nil }
        if name == "Alex Chen" || email == "alex@fitmunch.com.au" { return nil }
        let title = name.isEmpty ? email : name
        return (title, name.isEmpty ? "" : email)
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
            List {
                Section {
                    NavigationLink {
                        HistoryView(modelContext: modelContext, embedded: true)
                    } label: {
                        Label("Progress", systemImage: "chart.line.uptrend.xyaxis")
                    }
                    .accessibilityIdentifier("me-progress")
                }

                // Profile section. Name and email come from the signed-in account only.
                Section {
                    if let profile = signedInProfile {
                        HStack(alignment: .center, spacing: Theme.Spacing.three) {
                            Image(systemName: "person.circle.fill")
                                .font(.system(size: 50))
                                .symbolRenderingMode(.hierarchical)
                                .foregroundStyle(Theme.brandGreen)

                            VStack(alignment: .leading, spacing: 4) {
                                Text(profile.name)
                                    .font(.headline)
                                    .lineLimit(1)
                                if ScreenshotLaunch.isActive {
                                    Text("Sample profile")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(Theme.brandGreen)
                                }
                                if !profile.email.isEmpty {
                                    Text(profile.email)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                        .truncationMode(.middle)
                                }
                            }
                            Spacer(minLength: Theme.Spacing.two)
                            if premium.isPremium {
                                Text("Premium")
                                    .font(.caption.weight(.semibold))
                                    .lineLimit(1)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 4)
                                    .background(Theme.brandGreenSoft)
                                    .foregroundStyle(Theme.brandGreen)
                                    .clipShape(Capsule())
                                    .accessibilityIdentifier("me-premium-badge")
                            }
                        }
                        .padding(.vertical, 8)
                        .accessibilityElement(children: .contain)
                    } else {
                        VStack(alignment: .leading, spacing: Theme.Spacing.two) {
                            Label("No profile yet", systemImage: "person.crop.circle.badge.plus")
                                .font(.headline)
                                .symbolRenderingMode(.hierarchical)
                                .foregroundStyle(Theme.brandGreen)
                            Text("Sign in and your name and email show up here.")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 8)
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("me-profile-empty")
                    }

                    // Dedicated full-width List row. Nested buttons inside the profile HStack were untappable on iPad.
                    if !premium.isPremium {
                        Button {
                            showPaywall = true
                        } label: {
                            Label("Upgrade", systemImage: "crown.fill")
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.borderless)
                        .accessibilityIdentifier("settings-upgrade")
                    }
                } header: {
                    Text("Profile")
                }

                Section {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text("\(viewModel.appVersion) (\(viewModel.buildNumber))")
                            .foregroundColor(.secondary)
                    }
                    .accessibilityIdentifier("me-about-version")
                    aboutRow("Privacy", identifier: "me-about-privacy") {
                        viewModel.viewPrivacyPolicy()
                    }
                    aboutRow("Terms", identifier: "me-about-terms") {
                        viewModel.viewTermsOfService()
                    }
                    aboutRow("Support", identifier: "me-about-support") {
                        viewModel.contactSupport()
                    }
                } header: {
                    Text("About")
                }
                .accessibilityIdentifier("me-about")

                // Preferences section
                Section("Preferences") {
                    Toggle("Dark Mode", isOn: $viewModel.isDarkMode)
                        .accessibilityIdentifier("me-dark-mode")
                        .onChange(of: viewModel.isDarkMode) { _, newValue in
                            viewModel.applyDarkMode(newValue)
                        }
                    
                    Toggle("Notifications", isOn: $viewModel.notificationsEnabled)
                        .onChange(of: viewModel.notificationsEnabled) { _, newValue in
                            viewModel.setNotificationsEnabled(newValue)
                        }
                    
                    Toggle("Metric Units", isOn: $viewModel.useMetricUnits)
                        .onChange(of: viewModel.useMetricUnits) { _, newValue in
                            viewModel.setMetricUnits(newValue)
                        }
                }

                Section {
                    Toggle("AI features", isOn: Binding(
                        get: { consent.allows(auth.user?.id) },
                        set: { turnedOn in
                            if turnedOn {
                                consent.allow(userId: auth.user?.id)
                            } else {
                                consent.deny(userId: auth.user?.id)
                            }
                        }
                    ))
                    .accessibilityIdentifier("me-ai-consent")
                    // List buttons drop their accessibilityIdentifier on iOS 26.
                    // The id sits on this label, above the paragraph, so the row
                    // stays in the tree whenever Me is on screen.
                    PrivacyMoreRow(
                        title: privacyExpanded || privacyRequest > 0 ? "Show less" : "Read more"
                    ) {
                        privacyExpanded.toggle()
                    }
                    if privacyExpanded || privacyRequest > 0 {
                        Text("Coach sends up to 12 recent messages, including replies. The server keeps at most 20. Age, weight, height, goal, and diet come from the account profile. Providers are xAI, then OpenAI, then Anthropic. A receipt photo goes to xAI or OpenAI only. Data is processed in the United States. A failed read is not shown as your shop. A meal plan sends the goal as a label, calories, protein, and the number of days.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                } header: {
                    Text("Privacy")
                        .accessibilityIdentifier("me-privacy")
                } footer: {
                    Text("Off blocks Coach, receipt scan, meal plans, insights, and the weekly review.")
                }
                .id("me-privacy")
                
                // Subscription section
                Section("Subscription") {
                    if premium.isPremium {
                        HStack {
                            Text("Status")
                            Spacer()
                            Text("Active")
                                .foregroundColor(.green)
                                .fontWeight(.semibold)
                        }
                        
                        Button("Manage Subscription") {
                            if let url = URL(string: "https://apps.apple.com/account/subscriptions") {
                                UIApplication.shared.open(url)
                            }
                        }
                        .foregroundStyle(Theme.brandGreen)
                    } else {
                        Button {
                            showPaywall = true
                        } label: {
                            Label("Upgrade to Premium", systemImage: "crown.fill")
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.borderless)
                        .foregroundStyle(Theme.brandGreen)
                        .accessibilityIdentifier("settings-upgrade-premium")
                    }
                    
                    Button("Restore Purchases") {
                        Task {
                            await viewModel.restorePurchases()
                        }
                    }
                    .foregroundStyle(Theme.brandGreen)
                    .disabled(viewModel.isLoading)
                }
                
                // Support section
                Section("Support") {
                    Button("Contact Support") {
                        viewModel.contactSupport()
                    }
                    .foregroundStyle(Theme.brandGreen)
                    
                    Button("Privacy Policy") {
                        viewModel.viewPrivacyPolicy()
                    }
                    .foregroundStyle(Theme.brandGreen)
                    
                    Button("Terms of Service") {
                        viewModel.viewTermsOfService()
                    }
                    .foregroundStyle(Theme.brandGreen)
                    
                    Button("Rate the App") {
                        if let url = URL(string: "https://apps.apple.com/app/id6760215679?action=write-review") {
                            UIApplication.shared.open(url)
                        }
                    }
                    .foregroundStyle(Theme.brandGreen)
                }
                
                // Data section
                Section("Data") {
                    Button("Export Data") {
                        prepareExport()
                    }
                    .accessibilityIdentifier("settings-export")
                    .foregroundStyle(Theme.brandGreen)
                    .disabled(!premium.isPremium)
                    
                    Button("Reset Data", role: .destructive) {
                        showResetAlert = true
                    }
                }
                
                // Account section
                Section("Account") {
                    if let user = auth.user {
                        HStack {
                            Text("Signed in as")
                            Spacer()
                            Text(user.email)
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }
                    Button("Log Out", role: .destructive) {
                        showLogoutAlert = true
                    }
                    Button("Delete Account", role: .destructive) {
                        showDeleteAlert = true
                    }
                }
            }
            .navigationTitle("Me")
            .scrollContentBackground(.hidden)
            .background(Theme.surface)
            .scrollClearsTabBar()
            .floatingTabBarInset()
            .onAppear {
                viewModel.loadPreferences()
                if privacyRequest > 0 {
                    expandPrivacy(proxy)
                }
            }
            .onChange(of: privacyRequest) { _, value in
                guard value > 0 else { return }
                expandPrivacy(proxy)
            }
            .onReceive(NotificationCenter.default.publisher(for: .fitMunchOpenPrivacy)) { _ in
                expandPrivacy(proxy)
            }
            .overlay {
                if viewModel.isLoading {
                    LoadingSkeletonScreen(rows: 3, label: "Loading", identifier: "me-loading")
                }
            }
            .alert("Purchases", isPresented: Binding(
                get: { viewModel.noticeMessage != nil },
                set: { if !$0 { viewModel.noticeMessage = nil } }
            )) {
                Button("OK") {
                    viewModel.noticeMessage = nil
                }
            } message: {
                Text(viewModel.noticeMessage ?? "")
            }
            .alert("Error", isPresented: Binding(
                get: { viewModel.errorMessage != nil },
                set: { if !$0 { viewModel.errorMessage = nil } }
            )) {
                Button("OK") {
                    viewModel.errorMessage = nil
                }
            } message: {
                Text(viewModel.errorMessage ?? "")
            }
            .alert("Log Out", isPresented: $showLogoutAlert) {
                Button("Cancel", role: .cancel) { }
                Button("Log Out", role: .destructive) {
                    viewModel.logOut()
                    auth.logout()
                }
            } message: {
                Text("Are you sure you want to log out? Your local data will be preserved.")
            }
            .alert("Delete Account", isPresented: $showDeleteAlert) {
                Button("Cancel", role: .cancel) { }
                Button("Delete Everything", role: .destructive) {
                    Task { _ = await auth.deleteAccount() }
                }
            } message: {
                Text("This permanently deletes your FitMunch account and all data (meals, plans, progress and subscriptions) on all devices. This cannot be undone.")
            }
            .alert("Reset Data", isPresented: $showResetAlert) {
                Button("Cancel", role: .cancel) { }
                Button("Reset", role: .destructive) {
                    resetLocalLogs()
                }
            } message: {
                Text("This deletes the meal and workout logs on this iPhone. Your account, goals and synced history stay.")
            }
            .navigationDestination(isPresented: $navigateToOnboarding) {
                OnboardingView()
            }
            .fullScreenCover(isPresented: $showPaywall) {
                PaywallView()
            }
            .sheet(isPresented: Binding(
                get: { exportCSV != nil },
                set: { if !$0 { exportCSV = nil } }
            )) {
                if let exportCSV {
                    ExportSheet(data: exportCSV)
                }
            }
            .alert("Export", isPresented: Binding(
                get: { exportError != nil },
                set: { if !$0 { exportError = nil } }
            )) {
                Button("Try again") { prepareExport() }
                Button("OK", role: .cancel) { exportError = nil }
            } message: {
                Text(exportError ?? "")
            }
            }
        }
    }

    /// The identifier sits on the text and on a UIKit label. A List row drops
    /// a SwiftUI identifier on iOS 26, which is why me-privacy-more uses the same anchor.
    private func aboutRow(_ title: String, identifier: String, action: @escaping () -> Void) -> some View {
        Text(title)
            .font(.body)
            .foregroundStyle(Theme.brandGreen)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
            .onTapGesture(perform: action)
            .accessibilityLabel(title)
            .accessibilityIdentifier(identifier)
            .accessibilityAddTraits(.isButton)
            .accessibilityAction(.default, action)
            .background {
                AboutRowAnchor(title: title, identifier: identifier)
            }
    }

    private func expandPrivacy(_ proxy: ScrollViewProxy) {
        privacyExpanded = true
        DispatchQueue.main.async {
            proxy.scrollTo("me-privacy", anchor: .top)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
            proxy.scrollTo("me-privacy", anchor: .top)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            proxy.scrollTo("me-privacy", anchor: .top)
        }
    }

    /// Deletes on-device meal and training logs. Meals cascade to their foods.
    /// A failed save rolls the context back. The account stays signed in.
    private func resetLocalLogs() {
        do {
            for meal in try modelContext.fetch(FetchDescriptor<Meal>()) {
                modelContext.delete(meal)
            }
            for log in try modelContext.fetch(FetchDescriptor<WorkoutLog>()) {
                modelContext.delete(log)
            }
            try modelContext.save()
            UserDefaults.standard.removeObject(forKey: "completedWorkoutDays")
        } catch {
            modelContext.rollback()
            viewModel.errorMessage = "Couldn't reset your logs. Try again."
        }
    }

    /// A failed fetch stays on the error alert. It does not open Export Complete.
    private func prepareExport() {
        do {
            exportError = nil
            exportCSV = try mealExportCSV()
        } catch {
            exportCSV = nil
            exportError = "Couldn't prepare your export. Try again."
        }
    }

    private func mealExportCSV() throws -> String {
        let descriptor = FetchDescriptor<Meal>(sortBy: [SortDescriptor(\.date, order: .forward)])
        let meals = try modelContext.fetch(descriptor)
        let rows = meals.map { meal in
            [
                Constants.dateFormatter.string(from: meal.date),
                meal.name,
                "\(meal.totalCalories)",
                "\(meal.totalProtein)",
                "\(meal.totalCarbs)",
                "\(meal.totalFats)",
            ]
        }
        return MealCSV.document(rows: rows)
    }
}

/// Clear label with the About row identifier. Created once so List updates
/// do not rebuild the accessibility node. It does not draw its own title.
private struct AboutRowAnchor: UIViewRepresentable {
    var title: String
    var identifier: String

    func makeUIView(context: Context) -> UILabel {
        let label = UILabel()
        label.backgroundColor = .clear
        label.textColor = .clear
        label.font = .preferredFont(forTextStyle: .body)
        label.isUserInteractionEnabled = false
        label.isAccessibilityElement = true
        label.accessibilityIdentifier = identifier
        label.accessibilityTraits = .button
        return label
    }

    func updateUIView(_ label: UILabel, context: Context) {
        label.text = title
        label.textColor = .clear
        label.accessibilityLabel = title
        label.accessibilityIdentifier = identifier
        label.accessibilityTraits = .button
        label.isAccessibilityElement = true
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UILabel, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? 44, height: max(proposal.height ?? 44, 44))
    }
}

/// Disclosure label for the privacy paragraph. A List `Button` does not
/// publish `me-privacy-more` to XCTest. The id is on the text, and on a
/// UIKit label behind it, so one of them stays in the tree on Me.
private struct PrivacyMoreRow: View {
    var title: String
    var action: () -> Void

    var body: some View {
        Text(title)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Theme.brandGreen)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
            .onTapGesture(perform: action)
            .accessibilityLabel(title)
            .accessibilityIdentifier("me-privacy-more")
            .accessibilityAddTraits(.isButton)
            .accessibilityAction(.default, action)
            .background {
                PrivacyMoreAnchor(title: title)
            }
    }
}

/// Clear label with the same identifier. Created once so List updates do not
/// rebuild the accessibility node. It does not draw its own title.
private struct PrivacyMoreAnchor: UIViewRepresentable {
    var title: String

    func makeUIView(context: Context) -> UILabel {
        let label = UILabel()
        label.backgroundColor = .clear
        label.textColor = .clear
        label.font = .preferredFont(forTextStyle: .footnote)
        label.isUserInteractionEnabled = false
        label.isAccessibilityElement = true
        label.accessibilityIdentifier = "me-privacy-more"
        label.accessibilityTraits = .button
        return label
    }

    func updateUIView(_ label: UILabel, context: Context) {
        label.text = title
        label.textColor = .clear
        label.accessibilityLabel = title
        label.accessibilityIdentifier = "me-privacy-more"
        label.accessibilityTraits = .button
        label.isAccessibilityElement = true
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UILabel, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? 44, height: max(proposal.height ?? 44, 44))
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
        .environmentObject(AuthManager.shared)
        .environmentObject(PremiumManager.shared)
}