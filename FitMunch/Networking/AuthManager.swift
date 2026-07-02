import Foundation
import RevenueCat
import SwiftUI

/// Owns the FitMunch account session — the same accounts as fitmunch.com.au.
@MainActor
final class AuthManager: ObservableObject {
    static let shared = AuthManager()

    @Published var user: APIUser?
    @Published var isAuthenticated = false
    @Published var isRestoring = true
    @Published var isLoading = false
    @Published var errorMessage: String?

    /// Premium from EITHER rail: web Stripe tier (server) or Apple IAP (RevenueCat).
    var isPremiumTier: Bool {
        (user?.subscriptionTier ?? "free") != "free"
    }

    private init() {}

    /// Restore the session on launch.
    func bootstrap() async {
        defer { isRestoring = false }
        guard KeychainStore.token != nil else { return }
        do {
            let me = try await APIClient.request("/auth/me", as: MeResponse.self)
            if me.success, let user = me.user {
                self.user = user
                self.isAuthenticated = true
                identifyRevenueCat(userId: user.id)
            } else {
                KeychainStore.token = nil
            }
        } catch APIError.unauthorised {
            KeychainStore.token = nil
        } catch {
            // Offline etc. — keep the token, allow the app to open; API calls will surface errors.
            if KeychainStore.token != nil { self.isAuthenticated = true }
        }
    }

    func login(email: String, password: String) async -> Bool {
        await authenticate(path: "/auth/login", body: ["email": email, "password": password])
    }

    func register(name: String, email: String, password: String) async -> Bool {
        await authenticate(path: "/auth/register", body: ["name": name, "email": email, "password": password,
                                                          "attribution": ["utm_source": "ios_app", "landing": "ios"]])
    }

    private func authenticate(path: String, body: [String: Any]) async -> Bool {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let res = try await APIClient.request(path, method: "POST", body: body, authed: false, as: AuthResponse.self)
            guard res.success, let token = res.token, let user = res.user else {
                errorMessage = res.error ?? "Something went wrong. Please try again."
                return false
            }
            KeychainStore.token = token
            self.user = user
            self.isAuthenticated = true
            identifyRevenueCat(userId: user.id)
            return true
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }

    /// Re-fetch the profile (e.g. after purchase/sync so the tier updates).
    func refreshMe() async {
        guard KeychainStore.token != nil else { return }
        if let me = try? await APIClient.request("/auth/me", as: MeResponse.self), me.success {
            self.user = me.user
        }
    }

    func logout() {
        KeychainStore.token = nil
        user = nil
        isAuthenticated = false
        if Constants.isRevenueCatConfigured {
            Task { _ = try? await Purchases.shared.logOut() }
        }
    }

    /// Permanent server-side deletion (App Store requirement).
    func deleteAccount() async -> Bool {
        isLoading = true
        defer { isLoading = false }
        do {
            let res = try await APIClient.request("/auth/account", method: "DELETE", as: GenericResponse.self)
            if res.success == true {
                logout()
                return true
            }
            errorMessage = res.error ?? "Could not delete account."
            return false
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return false
        }
    }

    /// Ties Apple IAP purchases to the FitMunch account so the RevenueCat
    /// webhook can set the same subscription tier the website uses.
    private func identifyRevenueCat(userId: String) {
        guard Constants.isRevenueCatConfigured else { return }
        Task { _ = try? await Purchases.shared.logIn(userId) }
    }
}
