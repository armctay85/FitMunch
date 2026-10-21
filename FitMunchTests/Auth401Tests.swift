import XCTest
@testable import FitMunch

/// Unauthenticated 401 keeps the server sentence. An authenticated 401 stays
/// "Session expired" even when the body has a message.
final class Auth401Tests: XCTestCase {
    override func setUp() {
        super.setUp()
        URLProtocol.registerClass(Auth401Stub.self)
    }

    override func tearDown() {
        URLProtocol.unregisterClass(Auth401Stub.self)
        super.tearDown()
    }

    func testUnauthenticated401ShowsTheServerSentence() async {
        do {
            _ = try await APIClient.request(
                "/auth/login",
                method: "POST",
                body: ["email": "a@fitmunch.com.au", "password": "nope"],
                authed: false,
                as: GenericResponse.self
            )
            XCTFail("Expected the server sentence")
        } catch let error as APIError {
            XCTAssertEqual(error.errorDescription, "Invalid email or password.")
        } catch {
            XCTFail("Unexpected error \(error)")
        }
    }

    func testAuthenticated401StaysSessionExpired() async {
        do {
            _ = try await APIClient.request("/auth/me", as: MeResponse.self)
            XCTFail("Expected session expired")
        } catch let error as APIError {
            XCTAssertEqual(error.errorDescription, "Session expired. Please sign in again.")
        } catch {
            XCTFail("Unexpected error \(error)")
        }
    }
}

private final class Auth401Stub: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "www.fitmunch.com.au"
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let url = request.url ?? URL(string: "https://www.fitmunch.com.au/api")!
        let response = HTTPURLResponse(
            url: url,
            statusCode: 401,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(#"{"error":"Invalid email or password."}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
