# FitMunch - iOS Meal Tracking App

FitMunch is a SwiftUI-based iOS application for tracking meals, monitoring nutrition, and achieving fitness goals. Built with modern Swift technologies and following Apple's best practices.

## Features

- **Meal Logging**: Easily log meals with detailed nutritional information
- **Nutrition Tracking**: Monitor calories, protein, carbs, and fats
- **Progress Charts**: Visualize your nutrition trends over time
- **Freemium Model**: Free tier with basic features, premium tier for advanced functionality
- **SwiftData Integration**: Local data persistence with SwiftData
- **RevenueCat Integration**: Subscription management and in-app purchases

## Tech Stack

- **Swift 5.9+**: Modern Swift with latest language features
- **SwiftUI**: Declarative UI framework
- **SwiftData**: Local data persistence
- **MVVM Architecture**: Clean separation of concerns
- **RevenueCat**: Subscription and IAP management
- **GitHub Actions**: CI/CD pipeline for automated testing

## Project Structure

```
FitMunch/
├── FitMunch.xcodeproj/          # Xcode project file
├── FitMunch/                    # Main app source
│   ├── FitMunchApp.swift        # App entry point
│   ├── ContentView.swift        # Main content view with tabs
│   ├── Models/                  # SwiftData models
│   │   ├── UserProfile.swift
│   │   ├── Meal.swift
│   │   └── FoodItem.swift
│   ├── ViewModels/              # ViewModels for screens
│   │   ├── OnboardingViewModel.swift
│   │   ├── HomeViewModel.swift
│   │   ├── DetailViewModel.swift
│   │   ├── HistoryViewModel.swift
│   │   └── SettingsViewModel.swift
│   ├── Views/                   # SwiftUI views
│   │   ├── OnboardingView.swift
│   │   ├── PaywallView.swift
│   │   ├── HomeView.swift
│   │   ├── DetailView.swift
│   │   ├── HistoryView.swift
│   │   └── SettingsView.swift
│   ├── Utilities/               # Utility classes
│   │   ├── Constants.swift
│   │   └── PremiumManager.swift
│   └── Resources/               # App resources
│       ├── Assets.xcassets/     # App assets (to be added)
│       ├── Info.plist           # App configuration
│       └── PrivacyInfo.xcprivacy # Privacy manifest
├── .github/workflows/           # CI/CD workflows
│   └── ios-build.yml           # GitHub Actions build config
├── Package.swift               # Swift Package Manager config
└── README.md                   # This file
```

## Setup Instructions

### 1. Prerequisites

- Xcode 15.0 or later
- iOS 17.0 or later
- Swift 5.9 or later
- GitHub account (for CI/CD)

### 2. Clone and Open

```bash
git clone [repository-url]
cd FitMunch
open FitMunch.xcodeproj
```

### 3. Configure RevenueCat

1. Create a RevenueCat account at [revenuecat.com](https://www.revenuecat.com/)
2. Create a new app in RevenueCat dashboard
3. Add your RevenueCat public SDK key to `FitMunch/Resources/Info.plist`:
   - Key: `REVENUECAT_API_KEY`
   - Value: `appl_your_api_key_here`
4. Keep `Constants.swift` unchanged; it now reads the key from `Info.plist` so local and release builds stay consistent.

### 4. Configure App Icons and Assets

1. Add app icons to `Resources/Assets.xcassets/AppIcon.appiconset`
2. Add any additional assets to the Assets catalog

### 5. Build and Run

1. Select the FitMunch scheme
2. Choose a simulator or connected device
3. Press ⌘R to build and run

## CI/CD Pipeline

The project includes a GitHub Actions workflow for automated testing:

- **Trigger**: On push to main branch or pull requests
- **Actions**:
  - Checkout code
  - Select latest Xcode
  - Resolve Swift package dependencies
  - Build the project
  - Run tests (if any)

## Development Guidelines

### Code Style

- Use SwiftUI's declarative syntax
- Follow MVVM architecture pattern
- Use `@MainActor` for UI-related code
- Prefer value types over reference types when appropriate
- Use Swift's modern concurrency (async/await)

### Error Handling

- Use `do-catch` for throwing functions
- Provide user-friendly error messages
- Log errors for debugging

### Testing

- Write unit tests for ViewModels
- Write UI tests for critical user flows
- Test freemium gate functionality

## Web app (Express) & Vercel

The same repo runs the **browser app** (`public/`, `server.js`). Deploy to **[Vercel](https://vercel.com)** with almost no config: import the GitHub project, paste env vars from **`.env.example`**, redeploy. Step-by-step: **`VERCEL.md`**.

## License

This project is proprietary. All rights reserved.

## Support

For support or questions, please contact the development team.