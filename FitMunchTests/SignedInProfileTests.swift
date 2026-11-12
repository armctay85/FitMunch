import XCTest
@testable import FitMunch

/// Me shows the signed-in account. Hardcoded identities stay behind Debug launch flags.
@MainActor
final class SignedInProfileTests: XCTestCase {
    func testRealUserSeesOwnNameAndEmail() {
        let lines = SignedInProfile.lines(name: "Drew Taylor", email: "drew@fitmunch.com.au")
        XCTAssertEqual(lines?.name, "Drew Taylor")
        XCTAssertEqual(lines?.email, "drew@fitmunch.com.au")
    }

    func testBlankAccountShowsNothing() {
        XCTAssertNil(SignedInProfile.lines(name: "  ", email: ""))
    }

    func testRetiredPlaceholderStaysOffMe() {
        XCTAssertNil(SignedInProfile.lines(name: "Alex Chen", email: "alex@fitmunch.com.au"))
    }

    func testReleaseHasNoHardcodedIdentity() {
        XCTAssertFalse(ProcessInfo.processInfo.arguments.contains(ScreenshotLaunch.argument))
        XCTAssertFalse(ProcessInfo.processInfo.arguments.contains(ReviewLaunch.argument))
        XCTAssertFalse(ScreenshotLaunch.PersonaGate.isPermitted)
        XCTAssertFalse(ReviewLaunch.isActive)
        let user = AuthManager.shared.user
        let fields = [user?.name, user?.email].compactMap { $0 }
        let banned = [
            "Sample",
            "Reviewer",
            "Alex Morgan",
            "sample.account@fitmunch.com.au",
            "review@fitmunch.com.au",
            "alex@example.com",
            "alex.morgan@example.com",
        ]
        for field in fields {
            XCTAssertFalse(banned.contains(field), "A hardcoded identity is signed in: \(field)")
            XCTAssertFalse(field.localizedCaseInsensitiveContains("sample"))
            XCTAssertFalse(field.contains("example.com"))
        }
        #if DEBUG
        XCTAssertEqual(ScreenshotLaunch.PersonaGate.name, "")
        XCTAssertEqual(ScreenshotLaunch.PersonaGate.email, "")
        XCTAssertFalse(ScreenshotLaunch.PersonaGate.name.contains("Alex Morgan"))
        XCTAssertFalse(ScreenshotLaunch.PersonaGate.email.contains("example.com"))
        XCTAssertFalse(ScreenshotLaunch.PersonaGate.email.localizedCaseInsensitiveContains("qa"))
        XCTAssertFalse(ScreenshotLaunch.PersonaGate.email.contains("+"))
        XCTAssertFalse(AuditLaunch.isAnyAudit)
        XCTAssertFalse(AuditLaunch.isFlowQA)
        #else
        XCTAssertEqual(ScreenshotLaunch.PersonaGate.name, "")
        XCTAssertEqual(ScreenshotLaunch.PersonaGate.email, "")
        XCTAssertEqual(ReviewLaunch.personaName, "")
        XCTAssertEqual(ReviewLaunch.personaEmail, "")
        XCTAssertFalse(AuditLaunch.isAnyAudit)
        XCTAssertFalse(AuditLaunch.isFlowQA)
        #endif
    }
}
