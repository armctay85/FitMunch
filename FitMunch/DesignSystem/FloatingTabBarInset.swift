import SwiftUI
import UIKit

/// One bottom safe-area inset for every tab. The height is the floating tab
/// bar's overlap above the existing safe area, so pinned controls sit on the
/// bar instead of under it. iOS 17's classic bar is already in the safe area,
/// so that overlap is zero and this does not add a second gap.
struct FloatingTabBarInset: ViewModifier {
    @State private var overlap: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .safeAreaPadding(.bottom, overlap)
            .background {
                TabBarOverlapReader { measured in
                    guard abs(measured - overlap) > 0.5 else { return }
                    overlap = measured
                }
                .frame(width: 0, height: 0)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
    }
}

extension View {
    /// Shared bottom inset equal to the floating tab bar's height.
    func floatingTabBarInset() -> some View {
        modifier(FloatingTabBarInset())
    }
}

/// Reads the on-screen tab bar. The inset is the part of that bar which
/// sits above the window's bottom safe area.
private struct TabBarOverlapReader: UIViewRepresentable {
    var onOverlap: (CGFloat) -> Void

    func makeUIView(context: Context) -> TabBarOverlapProbe {
        let view = TabBarOverlapProbe()
        view.onOverlap = onOverlap
        view.isUserInteractionEnabled = false
        view.backgroundColor = .clear
        return view
    }

    func updateUIView(_ uiView: TabBarOverlapProbe, context: Context) {
        uiView.onOverlap = onOverlap
        uiView.report()
    }
}

private final class TabBarOverlapProbe: UIView {
    var onOverlap: ((CGFloat) -> Void)?

    override func didMoveToWindow() {
        super.didMoveToWindow()
        report()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        report()
    }

    func report() {
        DispatchQueue.main.async { [weak self] in
            guard let self, let window = self.window else { return }
            guard let tabBar = Self.findTabBar(in: window) else { return }
            let frame = tabBar.convert(tabBar.bounds, to: window)
            guard frame.height > 20, frame.minY > 1 else { return }
            let safeBottom = window.bounds.maxY - window.safeAreaInsets.bottom
            let overlap = min(160, max(0, safeBottom - frame.minY))
            self.onOverlap?(overlap.rounded())
        }
    }

    /// Prefer UITabBar. A floating bar that is not that class still has TabBar in its name.
    private static func findTabBar(in view: UIView) -> UIView? {
        var fallback: UIView?
        func walk(_ candidate: UIView) {
            if let bar = candidate as? UITabBar, bar.bounds.height > 20 {
                fallback = bar
                return
            }
            if fallback is UITabBar { return }
            let name = NSStringFromClass(type(of: candidate))
            if name.contains("TabBar"),
               candidate.bounds.height > 44,
               candidate.bounds.height < 180,
               candidate.bounds.width > 200 {
                if fallback == nil || candidate.frame.minY > (fallback?.frame.minY ?? 0) {
                    fallback = candidate
                }
            }
            if fallback is UITabBar { return }
            for subview in candidate.subviews {
                walk(subview)
                if fallback is UITabBar { return }
            }
        }
        walk(view)
        return fallback
    }
}
