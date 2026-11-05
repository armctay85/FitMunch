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
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Theme.fmBackground
                    .frame(height: overlap)
                    .accessibilityHidden(true)
            }
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
    var contentInset = false
    var onOverlap: (CGFloat) -> Void

    func makeUIView(context: Context) -> TabBarOverlapProbe {
        let view = TabBarOverlapProbe()
        view.measuresContentInset = contentInset
        view.onOverlap = onOverlap
        view.isUserInteractionEnabled = false
        view.backgroundColor = .clear
        return view
    }

    func updateUIView(_ uiView: TabBarOverlapProbe, context: Context) {
        uiView.measuresContentInset = contentInset
        uiView.onOverlap = onOverlap
        uiView.report()
    }
}

/// Bottom inset of the tab bar's height plus 16pt, after the safe area
/// the scroll view already applies. Today and Me use this so resting
/// content ends above the bar.
struct RestsClearOfTabBar: ViewModifier {
    @State private var inset: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Color.clear
                    .frame(height: inset)
                    .accessibilityHidden(true)
            }
            .background {
                TabBarOverlapReader(contentInset: true) { measured in
                    guard abs(measured - inset) > 0.5 else { return }
                    inset = measured
                }
                .frame(width: 0, height: 0)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
    }
}

extension View {
    func restsClearOfTabBar() -> some View {
        modifier(RestsClearOfTabBar())
    }
}

private final class TabBarOverlapProbe: UIView {
    var onOverlap: ((CGFloat) -> Void)?
    var measuresContentInset = false

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
            // UITabBar.bounds sits under the floating glass. Clear the glass,
            // which is the top of the tab buttons, or pinned controls stay out
            // of the accessibility tree.
            let chromeTop = Self.chromeTop(of: tabBar, in: window, containerTop: frame.minY)
            let safeBottom = window.bounds.maxY - window.safeAreaInsets.bottom
            let overlap = min(160, max(0, safeBottom - chromeTop))
            let reported: CGFloat
            if self.measuresContentInset {
                let barHeight = window.bounds.maxY - chromeTop
                reported = min(180, max(0, barHeight + 16 - window.safeAreaInsets.bottom))
            } else {
                reported = overlap
            }
            self.onOverlap?(reported.rounded())
        }
    }

    /// Highest edge of the tab bar or its glass, limited to the bottom band so
    /// page content cannot inflate the inset.
    private static func chromeTop(of tabBar: UIView, in window: UIView, containerTop: CGFloat) -> CGFloat {
        var top = containerTop
        let floor = window.bounds.maxY - 220
        func consider(_ view: UIView) {
            let frame = view.convert(view.bounds, to: window)
            guard frame.width > 36, frame.height > 16 else { return }
            guard frame.minY >= floor, frame.maxY <= window.bounds.maxY + 2 else { return }
            top = min(top, frame.minY)
        }
        func walk(_ view: UIView) {
            consider(view)
            for subview in view.subviews {
                walk(subview)
            }
        }
        walk(tabBar)
        if let parent = tabBar.superview {
            for sibling in parent.subviews {
                let name = NSStringFromClass(type(of: sibling))
                if sibling === tabBar || name.contains("Tab") {
                    walk(sibling)
                }
            }
        }
        return top
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
