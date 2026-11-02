import SwiftUI
import UIKit

/// Reads the tab button top and keeps a meal card that has come to rest a few
/// points under that line sitting fully above it. The inset is that overlap,
/// not a fixed y.
struct HomeTabClearanceReader: UIViewRepresentable {
    var onClearance: (CGFloat) -> Void

    func makeUIView(context: Context) -> HomeTabClearanceProbe {
        let view = HomeTabClearanceProbe()
        view.onClearance = onClearance
        view.isUserInteractionEnabled = false
        view.backgroundColor = .clear
        view.isAccessibilityElement = false
        return view
    }

    func updateUIView(_ uiView: HomeTabClearanceProbe, context: Context) {
        uiView.onClearance = onClearance
        uiView.refresh()
    }
}

/// Marker whose frame is the meal card. The clearance probe measures these.
struct MealCardFrameMarker: UIViewRepresentable {
    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.isUserInteractionEnabled = false
        view.backgroundColor = .clear
        view.isAccessibilityElement = false
        view.tag = HomeTabClearanceProbe.markerTag
        view.accessibilityIdentifier = HomeTabClearanceProbe.markerID
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        uiView.tag = HomeTabClearanceProbe.markerTag
        uiView.accessibilityIdentifier = HomeTabClearanceProbe.markerID
    }
}

final class HomeTabClearanceProbe: UIView {
    static let markerID = "today-meal-card-frame"
    static let markerTag = 71011

    var onClearance: ((CGFloat) -> Void)?
    private weak var scrollView: UIScrollView?
    private var stopWaits = 0
    private var correcting = false
    private var lastReported: CGFloat = -1
    private var addedInset: CGFloat = 0

    override func didMoveToWindow() {
        super.didMoveToWindow()
        refresh()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        refresh()
    }

    func refresh() {
        attachIfNeeded()
        publishClearance()
        guard let scroll = scrollView, !scroll.isTracking, !scroll.isDragging, !scroll.isDecelerating else { return }
        guard scroll.contentOffset.y > 1 else { return }
        correctSmallUnderlap()
    }

    private func attachIfNeeded() {
        guard let marker = firstMarker(), let scroll = enclosingScroll(from: marker) else { return }
        guard scrollView !== scroll else { return }
        if let old = scrollView {
            old.panGestureRecognizer.removeTarget(self, action: #selector(handlePan(_:)))
        }
        scrollView = scroll
        scroll.panGestureRecognizer.addTarget(self, action: #selector(handlePan(_:)))
    }

    @objc private func handlePan(_ gesture: UIPanGestureRecognizer) {
        guard gesture.state == .ended || gesture.state == .cancelled || gesture.state == .failed else { return }
        stopWaits = 0
        correctWhenStopped()
    }

    /// Deceleration finishes on a later turn of the run loop the test is already spinning.
    private func correctWhenStopped() {
        guard let scroll = scrollView else { return }
        if scroll.isDragging || scroll.isDecelerating || scroll.isTracking {
            stopWaits += 1
            guard stopWaits < 30 else { return }
            DispatchQueue.main.async { [weak self] in
                self?.correctWhenStopped()
            }
            return
        }
        stopWaits = 0
        correctSmallUnderlap()
    }

    /// Move the nearest card that still crosses the tab buttons up onto that line.
    private func correctSmallUnderlap() {
        guard !correcting, let scroll = scrollView, let window = window else { return }
        guard scroll.contentOffset.y > 1, scroll.contentSize.height > scroll.bounds.height else { return }
        guard let buttonTop = Self.tabButtonTop(in: window) else { return }
        var lift: CGFloat?
        for marker in markers(in: window) {
            let frame = marker.convert(marker.bounds, to: window)
            guard frame.width > 80, frame.width < window.bounds.width,
                  frame.height > 40, frame.height < 180 else { continue }
            let under = frame.maxY - buttonTop
            // Any card that starts above the buttons and ends below them is cut.
            guard under > 4, under < frame.height else { continue }
            lift = min(lift ?? under, under)
        }
        guard let lift else { return }

        correcting = true
        defer { correcting = false }

        let proposed = scroll.contentOffset.y + lift
        var limit = scroll.contentSize.height - scroll.bounds.height + scroll.adjustedContentInset.bottom
        if proposed > limit + 0.5, addedInset < 80 {
            let extra = min(80 - addedInset, proposed - limit)
            addedInset += extra
            var inset = scroll.contentInset
            inset.bottom += extra
            scroll.contentInset = inset
            limit = scroll.contentSize.height - scroll.bounds.height + scroll.adjustedContentInset.bottom
            let report = onClearance
            let total = max(lastReported, 0) + extra
            DispatchQueue.main.async {
                report?(total)
            }
        }
        let targetY = min(max(proposed, -scroll.adjustedContentInset.top), max(scroll.contentOffset.y, limit))
        guard targetY > scroll.contentOffset.y + 0.5 else { return }
        UIView.performWithoutAnimation {
            scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: targetY), animated: false)
        }
    }

    private func publishClearance() {
        guard let scroll = scrollView ?? enclosingScroll(from: self), let window = window else { return }
        guard let buttonTop = Self.tabButtonTop(in: window) else { return }
        let obscured = Self.obscuredHeight(in: scroll, window: window, buttonTop: buttonTop)
        // Never shrink below the shared clearance. A short measurement left the
        // last meal card about 46pt under the tab buttons.
        let clearance = max(obscured, Theme.Spacing.tabClearance)
        guard abs(clearance - lastReported) > 0.5 else { return }
        lastReported = clearance
        let report = onClearance
        DispatchQueue.main.async {
            report?(clearance)
        }
    }

    /// How far this scroll view extends below the tab buttons.
    private static func obscuredHeight(in scroll: UIScrollView, window: UIWindow, buttonTop: CGFloat) -> CGFloat {
        let visible = scroll.convert(scroll.bounds, to: window)
        let obscured = visible.maxY - buttonTop
        guard obscured > 1, obscured < 220 else { return 0 }
        return obscured.rounded()
    }

    /// Highest of the tab bar container and its buttons. Matches the UI test,
    /// which uses the button top when the glass sits above the bar bounds.
    private static func tabButtonTop(in window: UIWindow) -> CGFloat? {
        guard let tabBar = findTabBar(in: window) else { return nil }
        let barFrame = tabBar.convert(tabBar.bounds, to: window)
        guard barFrame.height > 20, barFrame.minY > 1 else { return nil }
        var top = barFrame.minY
        let names: Set<String> = ["Today", "Plan", "Scan", "Coach", "Me"]
        let bottom = window.bounds.maxY
        func consider(_ view: UIView) {
            let frame = view.convert(view.bounds, to: window)
            // Chrome that reaches the bottom band. The bar container sits below
            // the buttons, and aligning to that container leaves the card cut.
            guard frame.maxY >= bottom - 48, frame.minY >= bottom - 130 else { return }
            guard frame.height >= 20, frame.width >= 36 else { return }
            let className = NSStringFromClass(type(of: view))
            let label = view.accessibilityLabel ?? ""
            if className.contains("Button") || className.contains("Tab") || names.contains(label) || frame.width < 200 {
                top = min(top, frame.minY)
            }
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

    private func firstMarker() -> UIView? {
        guard let window else { return nil }
        return markers(in: window).first
    }

    private func markers(in root: UIView) -> [UIView] {
        var found: [UIView] = []
        func walk(_ view: UIView) {
            if view.tag == Self.markerTag || view.accessibilityIdentifier == Self.markerID {
                found.append(view)
            }
            for subview in view.subviews {
                walk(subview)
            }
        }
        walk(root)
        return found
    }

    private func enclosingScroll(from view: UIView) -> UIScrollView? {
        var current: UIView? = view
        while let node = current {
            if let scroll = node as? UIScrollView { return scroll }
            current = node.superview
        }
        return nil
    }
}
