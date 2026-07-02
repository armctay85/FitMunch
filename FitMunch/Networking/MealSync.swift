import Foundation

/// Pushes locally-logged meals up to the FitMunch backend so the same account's
/// web history, weekly review and AI coach context stay in sync with the phone.
/// Fire-and-forget: a network failure never blocks local logging.
enum MealSync {
    /// Map a saved Meal to POST /api/meals/log. No-op if not signed in.
    static func push(name: String, calories: Int, protein: Int, carbs: Int, fats: Int, date: Date = Date()) {
        guard KeychainStore.token != nil else { return }
        let iso = ISO8601DateFormatter().string(from: date)
        let body: [String: Any] = [
            "mealType": "meal",
            "foodName": name,
            "calories": calories,
            "protein": protein,
            "carbs": carbs,
            "fat": fats,
            "date": iso,
        ]
        Task.detached {
            do {
                _ = try await APIClient.request("/meals/log", method: "POST", body: body, as: GenericResponse.self)
            } catch {
                // Non-fatal — local copy is the source of truth on-device.
                print("[MealSync] push failed (non-fatal): \(error.localizedDescription)")
            }
        }
    }
}
