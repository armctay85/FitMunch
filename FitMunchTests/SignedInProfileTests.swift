import XCTest
@testable import FitMunch

/// Me shows the signed-in account. Alex Morgan exists only for the screenshot launch.
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

    func testScreenshotPersonaIsOffWithoutTheLaunchArgument() {
        XCTAssertFalse(
            ProcessInfo.processInfo.arguments.contains(ScreenshotLaunch.argument),
            "The unit-test host must not pass \(ScreenshotLaunch.argument)"
        )
        XCTAssertFalse(ScreenshotLaunch.isActive)
        XCTAssertFalse(ScreenshotLaunch.PersonaGate.isPermitted)
        let user = AuthManager.shared.user
        let seeded = user?.name == ScreenshotLaunch.PersonaGate.name
            && user?.email == ScreenshotLaunch.PersonaGate.email
        XCTAssertFalse(seeded, "Alex Morgan is installed without -AppStoreScreenshots")
    }
}
