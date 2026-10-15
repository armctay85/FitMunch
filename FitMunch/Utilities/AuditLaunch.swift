import Foundation

/// Debug-only launch hooks for the build 11 screen audit.
/// Release builds ignore every flag. The app does not start an SKTestSession.
enum AuditLaunch {
    static let onboarding = "-AuditOnboarding"
    static let consentPrompt = "-AuditConsentPrompt"
    static let offline = "-AuditOffline"
    static let planLoading = "-AuditPlanLoading"
    static let scanLoading = "-AuditScanLoading"
    static let scanError = "-AuditScanError"
    static let scanFinished = "-AuditScanFinished"
    static let todayLoading = "-AuditTodayLoading"
    static let todayError = "-AuditTodayError"
    static let coachLoading = "-AuditCoachLoading"

    static var isOnboarding: Bool { flag(onboarding) }
    static var isConsentPrompt: Bool { flag(consentPrompt) }
    static var isOffline: Bool { flag(offline) }
    static var isPlanLoading: Bool { flag(planLoading) }
    static var isScanLoading: Bool { flag(scanLoading) }
    static var isScanError: Bool { flag(scanError) }
    static var isScanFinished: Bool { flag(scanFinished) }
    static var isTodayLoading: Bool { flag(todayLoading) }
    static var isTodayError: Bool { flag(todayError) }
    static var isCoachLoading: Bool { flag(coachLoading) }

    private static func flag(_ name: String) -> Bool {
        #if DEBUG
        return ProcessInfo.processInfo.arguments.contains(name)
        #else
        return false
        #endif
    }
}
