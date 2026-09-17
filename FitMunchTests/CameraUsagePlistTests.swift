import XCTest
@testable import FitMunch

/// ITMS-90683: processed host Info.plist must still carry the camera string
/// when camera APIs exist. Source-file checks live in scripts/check-ios-camera-usage.sh.
final class CameraUsagePlistTests: XCTestCase {
    func testHostInfoPlistHasCameraUsageDescription() {
        let desc = Bundle.main.object(forInfoDictionaryKey: "NSCameraUsageDescription") as? String
        XCTAssertNotNil(desc, "Processed Info.plist dropped NSCameraUsageDescription (ITMS-90683)")
        XCTAssertFalse(
            desc?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true,
            "NSCameraUsageDescription is empty"
        )
        XCTAssertTrue(
            (desc ?? "").contains("receipt"),
            "Camera usage string should explain receipt scanning: \(desc ?? "")"
        )
    }

    func testHostInfoPlistHasPhotoLibraryUsageDescription() {
        let desc = Bundle.main.object(forInfoDictionaryKey: "NSPhotoLibraryUsageDescription") as? String
        XCTAssertNotNil(desc, "Photo library fallback needs NSPhotoLibraryUsageDescription")
        XCTAssertFalse(desc?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
    }
}
