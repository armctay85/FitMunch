# Fitmunch Design Specification

## TASK 1 — SCREEN INVENTORY

### 1. Onboarding / Paywall
- **Purpose**: Introduce the app's value proposition, guide new users through initial setup, and present subscription options to unlock premium features.
- **Key UI elements**:
  - Welcome text and app logo
  - Carousel or slides explaining key features (e.g., meal tracking, progress monitoring)
  - Input fields: Name, email, fitness goals (e.g., weight loss, muscle gain)
  - Buttons: "Get Started" (free tier), "Subscribe Now" (paid tiers)
  - Paywall section with pricing tiers and benefits
  - Restore purchases button
- **Data it displays or collects**: Collects user profile data (name, email, goals); displays subscription pricing and features.
- **Navigation**: From app launch to Home (after onboarding); links to Settings for subscription management.

### 2. Home
- **Purpose**: Provide a daily dashboard for quick meal logging and overview of today's nutrition intake, serving as the core daily return point.
- **Key UI elements**:
  - Date picker or current day header
  - Progress rings or bars for daily macros (calories, protein, carbs, fats)
  - List of logged meals for the day (cards with summary: meal name, total calories)
  - Button: "Log New Meal"
  - Summary card: Total daily intake vs. goals
  - Navigation tab bar (Home, Log Meal, History, Settings)
- **Data it displays or collects**: Displays today's meals and aggregated nutrition totals; collects no new data but triggers navigation to logging.
- **Navigation**: Links from Onboarding, tab bar; to Detail / Action (for logging), History / Progress, Settings.

### 3. Detail / Action
- **Purpose**: Allow users to log a new meal or edit an existing one by adding foods and calculating nutrition details.
- **Key UI elements**:
  - Input field: Meal name (e.g., "Breakfast")
  - Search bar for foods (integrated with website's database or basic list)
  - List of added foods (cards with name, quantity, calories, macros)
  - Buttons: "Add Food", "Save Meal", "Delete Food"
  - Real-time total calculator for meal macros
  - Quantity inputs (sliders or text fields) for each food
- **Data it displays or collects**: Displays search results and nutrition data; collects meal details (foods, quantities).
- **Navigation**: From Home ("Log New Meal"); back to Home after saving.

### 4. History / Progress
- **Purpose**: Show past meal logs and progress charts to help users track long-term fitness goals and maintain retention.
- **Key UI elements**:
  - Calendar view or date range selector
  - List of past days/meals (expandable cards with details)
  - Charts: Weekly/monthly trends for weight, macros intake
  - Progress summary: Goals met, streaks
  - Button: "Export Data" (premium)
- **Data it displays or collects**: Displays historical meal data and derived progress metrics; collects no new data.
- **Navigation**: From tab bar; to Detail / Action for editing past meals (if allowed).

### 5. Settings
- **Purpose**: Manage user preferences, subscription, and app settings including profile updates and support.
- **Key UI elements**:
  - List sections: Profile (edit name, goals), Subscription (view plan, upgrade, cancel)
  - Toggle switches: Notifications, dark mode, units (e.g., kg vs. lbs)
  - Buttons: "Restore Purchases", "Contact Support", "Log Out"
  - Link to privacy policy and terms
- **Data it displays or collects**: Displays current settings and subscription status; collects updated preferences.
- **Navigation**: From tab bar; back to Home or other tabs.

## TASK 2 — FREEMIUM GATES

- **FREE TIER**: Users can log up to 3 meals per day, view daily totals and basic history (last 7 days), set basic fitness goals, and access a limited food database aligned with fitmunch.com.au.
- **PAID TIER**: Unlocks unlimited meal logging, full historical data and advanced progress charts, premium food database with recipes from fitmunch.com.au, export options, and personalized insights (e.g., macro recommendations).
- **PAYWALL TRIGGER**: Appears after logging the 4th meal in a day or when attempting to access premium features like full history or advanced charts.

## TASK 3 — DATA MODEL

- **Model: UserProfile**
  - id: UUID
  - name: String
  - email: String
  - fitnessGoal: String (e.g., "weight_loss")
  - dailyCalorieGoal: Int
  - dailyProteinGoal: Int
  - dailyCarbGoal: Int
  - dailyFatGoal: Int
  - Relationships: One-to-many with Meal (user's meals)

- **Model: Meal**
  - id: UUID
  - name: String (e.g., "Breakfast")
  - date: Date
  - totalCalories: Int
  - totalProtein: Int
  - totalCarbs: Int
  - totalFats: Int
  - Relationships: Many-to-one with UserProfile; One-to-many with FoodItem (foods in this meal)

- **Model: FoodItem**
  - id: UUID
  - name: String
  - quantity: Double
  - calories: Int
  - protein: Int
  - carbs: Int
  - fats: Int
  - Relationships: Many-to-one with Meal

## TASK 4 — PRICING (AUD)

- Weekly: $4.99
- Monthly: $9.99
- Annual: $79.99
- Lifetime (optional): $149.99
