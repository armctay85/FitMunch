import Foundation

/// Allergies chosen in onboarding and sent with every meal plan.
/// "No other allergies" is a confirmation, not a food name sent to the server.
enum AllergyStore {
    private static let savedKey = "savedAllergies"
    private static let noOtherKey = "allergiesNoOther"

    static var saved: [String] {
        let raw = UserDefaults.standard.stringArray(forKey: savedKey) ?? []
        return Array(Set(raw.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }.filter { !$0.isEmpty })).sorted()
    }

    static var confirmedNoOther: Bool {
        UserDefaults.standard.bool(forKey: noOtherKey)
    }

    static func save(selected: Set<String>, noOther: Bool) {
        let names = selected
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty && $0 != "no other" && $0 != "no other allergies" }
        UserDefaults.standard.set(Array(Set(names)).sorted(), forKey: savedKey)
        UserDefaults.standard.set(noOther, forKey: noOtherKey)
    }

    /// Push the on-device list, then keep the union of what the server already stored.
    static func sync(userId: String) async {
        guard KeychainStore.token != nil, !userId.isEmpty else { return }
        let remote = await fetch(userId: userId)
        let merged = Array(Set(saved + remote.allergies)).sorted()
        if merged != remote.allergies.sorted() {
            await post(userId: userId, allergies: merged, updatedAt: remote.updatedAt)
        }
        if !merged.isEmpty {
            UserDefaults.standard.set(merged, forKey: savedKey)
        }
    }

    private struct RemoteProfile {
        var allergies: [String] = []
        var updatedAt: String?
    }

    private static func fetch(userId: String) async -> RemoteProfile {
        guard let envelope = try? await APIClient.request(
            "/user/profile/\(userId)",
            as: ProfileEnvelope.self
        ), envelope.success != false, let profile = envelope.profile else {
            return RemoteProfile()
        }
        return RemoteProfile(allergies: profile.allergies, updatedAt: profile.updatedAt)
    }

    private static func post(userId: String, allergies: [String], updatedAt: String?) async {
        var body: [String: Any] = ["allergies": allergies]
        if let updatedAt, !updatedAt.isEmpty {
            body["profileUpdatedAt"] = updatedAt
        }
        _ = try? await APIClient.request(
            "/user/profile",
            method: "POST",
            body: body,
            as: GenericResponse.self
        )
    }
}

struct ProfileEnvelope: Decodable {
    let success: Bool?
    let profile: ServerProfile?
}

struct ServerProfile: Decodable {
    let allergies: [String]
    let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case allergies, updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        updatedAt = try container.decodeIfPresent(String.self, forKey: .updatedAt)
        if let list = try? container.decode([String].self, forKey: .allergies) {
            allergies = list
        } else if let text = try? container.decode(String.self, forKey: .allergies),
                  let data = text.data(using: .utf8),
                  let list = try? JSONDecoder().decode([String].self, from: data) {
            allergies = list
        } else {
            allergies = []
        }
    }
}

/// Goal and targets the training plan is built from. Meal plan and onboarding write them.
enum TrainingTargets {
    private static let goalKey = "trainingGoal"
    private static let caloriesKey = "trainingCalories"
    private static let proteinKey = "trainingProtein"

    static var goal: String {
        let raw = UserDefaults.standard.string(forKey: goalKey) ?? "general_fitness"
        return raw.isEmpty ? "general_fitness" : raw
    }

    static var calories: Int {
        let stored = UserDefaults.standard.integer(forKey: caloriesKey)
        return stored > 0 ? stored : 2000
    }

    static var protein: Int {
        let stored = UserDefaults.standard.integer(forKey: proteinKey)
        return stored > 0 ? stored : 150
    }

    static func saveGoal(_ goal: String) {
        UserDefaults.standard.set(goal, forKey: goalKey)
    }

    static func saveTargets(calories: Int, protein: Int) {
        UserDefaults.standard.set(calories, forKey: caloriesKey)
        UserDefaults.standard.set(protein, forKey: proteinKey)
    }
}
