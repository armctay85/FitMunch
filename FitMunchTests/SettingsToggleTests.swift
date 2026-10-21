import XCTest
@testable import FitMunch

/// The Me toggles write through onChange. The view model must store that value,
/// not flip it a second time.
@MainActor
final class SettingsToggleTests: XCTestCase {
    func testOnChangeKeepsTheValueTheSwitchLandedOn() {
        let model = SettingsViewModel()

        model.notificationsEnabled = false
        model.setNotificationsEnabled(true)
        XCTAssertTrue(model.notificationsEnabled)

        model.setNotificationsEnabled(false)
        XCTAssertFalse(model.notificationsEnabled)

        model.useMetricUnits = false
        model.setMetricUnits(true)
        XCTAssertTrue(model.useMetricUnits)

        model.setMetricUnits(false)
        XCTAssertFalse(model.useMetricUnits)
    }
}
