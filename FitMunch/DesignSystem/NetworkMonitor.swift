import Foundation
import Network

/// Reachability for the offline empty state. Screenshot and review launches stay online
/// so capture does not depend on the runner network.
final class NetworkMonitor: ObservableObject {
    static let shared = NetworkMonitor()

    @Published private(set) var isOnline: Bool = true

    private let monitor = NWPathMonitor()

    private init() {
        let args = ProcessInfo.processInfo.arguments
        if args.contains("-AppStoreScreenshots") || args.contains("-ReviewGuards") {
            return
        }
        monitor.pathUpdateHandler = { path in
            let online = path.status == .satisfied
            DispatchQueue.main.async {
                if self.isOnline != online {
                    self.isOnline = online
                }
            }
        }
        monitor.start(queue: DispatchQueue(label: "fitmunch.network"))
    }
}
