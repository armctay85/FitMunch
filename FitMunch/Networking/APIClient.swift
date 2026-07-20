import Foundation

/// Errors surfaced by the FitMunch API layer.
enum APIError: LocalizedError {
    case badURL
    case unauthorised
    case server(String)
    case network(String)
    case decoding

    var errorDescription: String? {
        switch self {
        case .badURL: return "Invalid request."
        case .unauthorised: return "Session expired — please sign in again."
        case .server(let message): return message
        case .network(let message): return "Network problem: \(message)"
        case .decoding: return "Unexpected server response."
        }
    }
}

/// Thin async client for the live FitMunch backend.
enum APIClient {
    static let base = URL(string: "https://www.fitmunch.com.au/api")!

    static func request<T: Decodable>(
        _ path: String,
        method: String = "GET",
        body: [String: Any]? = nil,
        authed: Bool = true,
        as type: T.Type
    ) async throws -> T {
        guard let url = URL(string: base.absoluteString + path) else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if authed, let token = KeychainStore.token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body = body {
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        req.timeoutInterval = 60

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            throw APIError.network(error.localizedDescription)
        }

        if let http = response as? HTTPURLResponse, http.statusCode == 401 {
            throw APIError.unauthorised
        }

        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            // Try to surface a server-side error message before giving up.
            if let generic = try? JSONDecoder().decode(GenericResponse.self, from: data),
               let message = generic.error ?? generic.message {
                throw APIError.server(message)
            }
            throw APIError.decoding
        }
    }
}

// MARK: - Shared response models

struct GenericResponse: Decodable {
    let success: Bool?
    let error: String?
    let message: String?
}

struct APIUser: Decodable {
    let id: String
    let name: String
    let email: String
    let subscriptionTier: String?
    let role: String?
}

struct AuthResponse: Decodable {
    let success: Bool
    let token: String?
    let user: APIUser?
    let error: String?
}

struct MeResponse: Decodable {
    let success: Bool
    let user: APIUser?
    let error: String?
}

struct MealPlanGenerateResponse: Decodable {
    let success: Bool?
    let upgrade: Bool?
    let error: String?
    let plan: MealPlanPayload?
}

struct MealPlanPayload: Decodable {
    let planName: String?
    let summary: String?
    let days: [MealPlanDay]?
    let weeklyBudgetEst: Int?
    let avgDailyCalories: Int?
    let avgDailyProtein: Int?
}

struct MealPlanDay: Decodable {
    let day: String?
    let meals: MealPlanMeals?
    let dailyTotals: MealPlanTotals?
}

struct MealPlanMeals: Decodable {
    let breakfast: MealPlanMeal?
    let lunch: MealPlanMeal?
    let dinner: MealPlanMeal?
    let snack: MealPlanMeal?
}

struct MealPlanMeal: Decodable {
    let name: String?
    let calories: Int?
    let protein: Int?
    let carbs: Int?
    let fat: Int?
    let prepMins: Int?
}

struct MealPlanTotals: Decodable {
    let calories: Int?
    let protein: Int?
    let carbs: Int?
    let fat: Int?
}

struct ChatResponse: Decodable {
    let success: Bool
    let reply: String?
    let error: String?
    let remaining: Int?
    let upgrade: Bool?
}

struct AIUsageResponse: Decodable {
    let success: Bool
    let used: Int?
    let limit: Int?
    let remaining: Int?
    let tier: String?
}

/// Decodes numbers that may arrive as Int, Double or String.
struct FlexDouble: Decodable {
    let value: Double?
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let d = try? container.decode(Double.self) { value = d }
        else if let s = try? container.decode(String.self) { value = Double(s) }
        else { value = nil }
    }
}

struct ReceiptScanResponse: Decodable {
    struct Nutrition: Decodable {
        let protein: FlexDouble?
        let carbs: FlexDouble?
        let fat: FlexDouble?
        let calories: FlexDouble?
    }
    struct Item: Decodable {
        let name: String
        let quantity: FlexDouble?
        let unit: String?
        let price: FlexDouble?
        let category: String?
        let nutrition: Nutrition?
    }
    struct Totals: Decodable {
        let protein: FlexDouble?
        let carbs: FlexDouble?
        let fat: FlexDouble?
        let calories: FlexDouble?
    }
    let success: Bool
    let error: String?
    let items: [Item]?
    let weeklyTotals: Totals?
    let grade: String?
    let shareText: String?
}
