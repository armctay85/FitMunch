import Foundation

/// One AI-data choice per FitMunch account. Coach, receipt scan, and meal plans share it.
@MainActor
final class AIDataConsent: ObservableObject {
    static let shared = AIDataConsent()

    /// Bumps when the stored choice changes so Me and the three features refresh.
    @Published private(set) var revision = 0

    private init() {}

    func allows(_ userId: String?) -> Bool {
        choice(for: userId) == "allow"
    }

    func isDenied(_ userId: String?) -> Bool {
        choice(for: userId) == "deny"
    }

    func needsPrompt(_ userId: String?) -> Bool {
        choice(for: userId) == nil
    }

    func allow(userId: String?) {
        set("allow", userId: userId, sync: true)
    }

    func deny(userId: String?) {
        set("deny", userId: userId, sync: true)
    }

    /// Server value wins when the account has already answered. Unknown does not wipe a local choice.
    func applyServer(_ value: Bool?, userId: String) {
        guard let value else { return }
        set(value ? "allow" : "deny", userId: userId, sync: false)
    }

    /// Screenshot and review launches are already allowed so camera and plan checks stay reachable.
    func grantLaunch(userId: String) {
        set("allow", userId: userId, sync: false)
    }

    private func choice(for userId: String?) -> String? {
        guard let userId, !userId.isEmpty else { return nil }
        let stored = UserDefaults.standard.string(forKey: storageKey(userId))
        if stored == "allow" || stored == "deny" { return stored }
        return nil
    }

    private func set(_ value: String, userId: String?, sync: Bool) {
        guard let userId, !userId.isEmpty else { return }
        UserDefaults.standard.set(value, forKey: storageKey(userId))
        revision += 1
        guard sync else { return }
        Task {
            _ = try? await APIClient.request(
                "/auth/ai-consent",
                method: "POST",
                body: ["allowed": value == "allow"],
                as: GenericResponse.self
            )
        }
    }

    private func storageKey(_ userId: String) -> String {
        "aiDataConsent.\(userId)"
    }
}
