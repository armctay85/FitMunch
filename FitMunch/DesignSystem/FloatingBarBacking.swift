import SwiftUI
import UIKit

/// Near-opaque fill for the floating tab bar: page colour at 0.94 over
/// ultra-thin material, plus a 0.5pt separator hairline. The fill is inserted
/// behind the tab buttons and clipped to the bar's existing corner radius.
enum FloatingBarBacking {
    static func applyGlobals() {
        let styled = makeAppearance()
        let proxy = UITabBar.appearance()
        proxy.standardAppearance = styled
        proxy.scrollEdgeAppearance = styled
        proxy.tintColor = TabBarContrast.selectedUIColor
        proxy.unselectedItemTintColor = TabBarContrast.normalUIColor
    }

    static func refresh(in window: UIWindow) {
        guard let bar = tabBar(in: window) else { return }
        styleIfNeeded(bar)
        placeFill(on: bar)
    }

    private static var styledKey: UInt8 = 0

    private static func styleIfNeeded(_ bar: UITabBar) {
        if objc_getAssociatedObject(bar, &styledKey) != nil { return }
        let styled = makeAppearance()
        bar.standardAppearance = styled
        bar.scrollEdgeAppearance = styled
        bar.tintColor = TabBarContrast.selectedUIColor
        bar.unselectedItemTintColor = TabBarContrast.normalUIColor
        objc_setAssociatedObject(bar, &styledKey, "styled" as NSString, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    }

    private static func makeAppearance() -> UITabBarAppearance {
        let appearance = UITabBarAppearance()
        appearance.configureWithDefaultBackground()
        appearance.backgroundEffect = UIBlurEffect(style: .systemUltraThinMaterial)
        appearance.backgroundColor = TabBarContrast.washUIColor
        appearance.shadowColor = .clear
        appearance.shadowImage = clearPixel
        let item = UITabBarItemAppearance()
        let normal = TabBarContrast.normalUIColor
        let selected = TabBarContrast.selectedUIColor
        item.normal.iconColor = normal
        item.normal.titleTextAttributes = [.foregroundColor: normal]
        item.selected.iconColor = selected
        item.selected.titleTextAttributes = [.foregroundColor: selected]
        appearance.stackedLayoutAppearance = item
        appearance.inlineLayoutAppearance = item
        appearance.compactInlineLayoutAppearance = item
        return appearance
    }

    private static let clearPixel: UIImage = {
        let format = UIGraphicsImageRendererFormat()
        format.opaque = false
        format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: 1, height: 1), format: format).image { _ in }
    }()

    /// The system bar, typed as UITabBar the whole way. A plain UIView is never stored in that type.
    private static func tabBar(in view: UIView) -> UITabBar? {
        if let bar = view as? UITabBar {
            return bar
        }
        for subview in view.subviews {
            if let found = tabBar(in: subview) {
                return found
            }
        }
        return nil
    }

    /// Rounded chrome that wraps the tab buttons. Its corner radius is copied onto the fill.
    private static func chrome(in bar: UITabBar) -> UIView? {
        if let button = firstButton(in: bar) {
            var best: UIView?
            var bestRadius: CGFloat = 0
            var view = button.superview
            while let current = view {
                if current is FloatingBarFill { break }
                let radius = current.layer.cornerRadius
                if radius > bestRadius {
                    best = current
                    bestRadius = radius
                }
                if current === bar { break }
                view = current.superview
            }
            if let best, bestRadius >= 12 {
                return best
            }
        }
        var found: UIView?
        var bestRadius: CGFloat = 0
        func walk(_ view: UIView) {
            if view is FloatingBarFill { return }
            let size = view.bounds.size
            let radius = view.layer.cornerRadius
            if radius >= 12, size.width > 120, size.height > 36, size.height < 140, radius > bestRadius {
                found = view
                bestRadius = radius
            }
            for subview in view.subviews {
                walk(subview)
            }
        }
        walk(bar)
        return found
    }

    private static func firstButton(in view: UIView) -> UIView? {
        if isTabButton(view) { return view }
        for subview in view.subviews {
            if let found = firstButton(in: subview) { return found }
        }
        return nil
    }

    private static func placeFill(on bar: UITabBar) {
        guard let pill = chrome(in: bar) else { return }
        let host: UIView
        if let effect = pill as? UIVisualEffectView {
            host = effect.contentView
        } else {
            host = pill
        }
        let fill = (bar.viewWithTag(FloatingBarFill.viewTag) as? FloatingBarFill) ?? FloatingBarFill()
        fill.tag = FloatingBarFill.viewTag
        fill.isUserInteractionEnabled = false
        fill.accessibilityElementsHidden = true
        let target = host.bounds
        let radius = pill.layer.cornerRadius
        let placed = fill.superview === host
            && abs(fill.frame.width - target.width) < 0.5
            && abs(fill.frame.height - target.height) < 0.5
            && abs(fill.frame.minX) < 0.5
            && abs(fill.frame.minY) < 0.5
            && abs(fill.layer.cornerRadius - radius) < 0.5
        if !placed {
            if fill.superview !== host {
                host.insertSubview(fill, at: 0)
            }
            fill.frame = target
            fill.layer.cornerRadius = radius
            fill.layer.maskedCorners = pill.layer.maskedCorners
            fill.clipsToBounds = true
            fill.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        }
        bringButtonsForward(in: host)
    }

    /// Moves tab buttons above the fill only when the fill is currently in front of one.
    private static func bringButtonsForward(in host: UIView) {
        guard let fillIndex = host.subviews.firstIndex(where: { $0 is FloatingBarFill }) else { return }
        let buttons = host.subviews.filter(isTabButton)
        guard let lowestButton = buttons.compactMap({ host.subviews.firstIndex(of: $0) }).min() else { return }
        guard fillIndex > lowestButton else { return }
        for button in buttons {
            host.bringSubviewToFront(button)
        }
    }

    private static func isTabButton(_ view: UIView) -> Bool {
        let name = NSStringFromClass(type(of: view))
        if name.contains("TabBarButton") || name.contains("TabButton") { return true }
        guard view is UIControl else { return false }
        let size = view.bounds.size
        return size.width > 24 && size.width < 140 && size.height > 24 && size.height < 90
    }
}

/// Page colour at 0.94 over ultra-thin material, with a 0.5pt top hairline.
final class FloatingBarFill: UIView {
    static let viewTag = 9053

    private let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterial))
    private let wash = UIView()
    private let hairline = UIView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        backgroundColor = .clear
        wash.backgroundColor = TabBarContrast.washUIColor
        wash.isUserInteractionEnabled = false
        hairline.backgroundColor = TabBarContrast.separatorUIColor
        hairline.isUserInteractionEnabled = false
        blur.isUserInteractionEnabled = false
        addSubview(blur)
        addSubview(wash)
        addSubview(hairline)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        blur.frame = bounds
        wash.frame = bounds
        hairline.frame = CGRect(x: 0, y: 0, width: bounds.width, height: 0.5)
    }
}

/// Lives in the tab view's background. It never draws over the tabs.
struct FloatingBarFillInstaller: UIViewRepresentable {
    func makeUIView(context: Context) -> FloatingBarFillProbe {
        let view = FloatingBarFillProbe()
        view.isUserInteractionEnabled = false
        view.backgroundColor = .clear
        return view
    }

    func updateUIView(_ uiView: FloatingBarFillProbe, context: Context) {
        uiView.refresh()
    }
}

final class FloatingBarFillProbe: UIView {
    override func didMoveToWindow() {
        super.didMoveToWindow()
        refresh()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        refresh()
    }

    func refresh() {
        guard let window else { return }
        FloatingBarBacking.refresh(in: window)
    }
}
