import SwiftUI
import UIKit

/// Page colour at 0.98 over ultra-thin material, plus a 0.5pt separator hairline.
/// iOS 26 draws the floating tab bar as glass and ignores `UITabBarAppearance`
/// background colours, which left the store shots identical to the previous bar.
/// The wash is a view in the same container as the tab buttons, behind those
/// buttons, clipped to the bar's existing corner radius. It does not take taps.
enum FloatingBarBacking {
    static func applyGlobals() {
        let styled = makeAppearance()
        let proxy = UITabBar.appearance()
        proxy.standardAppearance = styled
        proxy.scrollEdgeAppearance = styled
        proxy.tintColor = TabBarContrast.selectedUIColor
        proxy.unselectedItemTintColor = TabBarContrast.normalUIColor
    }

    /// Styles the live bar and places the wash in front of the glass, behind the tabs.
    @discardableResult
    static func refresh(in window: UIWindow) -> Bool {
        guard let bar = tabBar(in: window) else { return false }
        styleIfNeeded(bar)
        placeCover(behind: bar)
        return placeFill(in: window, bar: bar)
    }

    /// Opaque page colour from the top of the tab bar to the bottom of the screen.
    /// The floating pill stays in front and keeps its corner radius. Text in the
    /// gap under the pill is covered.
    private static func placeCover(behind bar: UITabBar) {
        guard let parent = bar.superview else { return }
        let cover = (parent.viewWithTag(FloatingBarCover.viewTag) as? FloatingBarCover) ?? FloatingBarCover()
        cover.tag = FloatingBarCover.viewTag
        cover.isUserInteractionEnabled = false
        cover.backgroundColor = TabBarContrast.pageUIColor
        cover.accessibilityElementsHidden = true
        let barFrame = bar.convert(bar.bounds, to: parent)
        let top = min(barFrame.minY, parent.bounds.maxY - 1)
        let target = CGRect(x: 0, y: top, width: parent.bounds.width, height: max(0, parent.bounds.maxY - top))
        guard target.height > 20, target.width > 40 else { return }
        let coverIndex = parent.subviews.firstIndex(of: cover)
        let barIndex = parent.subviews.firstIndex(of: bar) ?? 0
        if cover.superview !== parent || (coverIndex ?? 0) > barIndex {
            parent.insertSubview(cover, belowSubview: bar)
        }
        if !framesClose(cover.frame, target) {
            cover.frame = target
        }
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

    /// The system bar, typed as UITabBar the whole way.
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

    /// The wash sits inside the floating pill, above its blur and behind the tab buttons.
    private static func placeFill(in window: UIWindow, bar: UITabBar) -> Bool {
        guard let pill = pill(in: window, bar: bar) else { return false }
        let host: UIView
        if let effect = pill as? UIVisualEffectView {
            host = effect.contentView
        } else {
            host = pill
        }
        guard host.bounds.width > 80, host.bounds.height > 20 else { return false }
        let fill = (window.viewWithTag(FloatingBarFill.viewTag) as? FloatingBarFill) ?? FloatingBarFill()
        fill.tag = FloatingBarFill.viewTag
        fill.isUserInteractionEnabled = false
        fill.accessibilityElementsHidden = true
        let radius = pill.layer.cornerRadius
        let samePlace = fill.superview === host
            && framesClose(fill.frame, host.bounds)
            && abs(fill.layer.cornerRadius - radius) < 0.5
        if !samePlace {
            if fill.superview !== host {
                host.insertSubview(fill, at: 0)
            }
            fill.frame = host.bounds
            fill.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            fill.layer.cornerRadius = radius
            fill.layer.maskedCorners = pill.layer.maskedCorners
            fill.clipsToBounds = true
        }
        keepButtonsInFront(of: fill, in: host)
        if host !== pill {
            keepButtonsInFront(of: fill, in: pill)
        }
        return fill.bounds.width > 80 && fill.bounds.height > 20
    }

    /// Rounded pill in the bottom band. Falls back to a bottom visual-effect view.
    private static func pill(in window: UIWindow, bar: UITabBar) -> UIView? {
        let bandTop = window.bounds.maxY - 240
        var rounded: UIView?
        var roundedRadius: CGFloat = 0
        var effect: UIView?
        func consider(_ view: UIView) {
            if view is FloatingBarFill || view is UITabBar { return }
            let frame = view.convert(view.bounds, to: window)
            guard frame.minY >= bandTop, frame.maxY <= window.bounds.maxY + 2 else { return }
            guard frame.width > 160, frame.height > 36, frame.height < 150 else { return }
            let radius = view.layer.cornerRadius
            let name = NSStringFromClass(type(of: view))
            let namedChrome = name.contains("Platter") || name.contains("Glass") || name.contains("Liquid") || name.contains("Pill")
            if (radius >= 16 || namedChrome), radius >= roundedRadius {
                rounded = view
                roundedRadius = max(radius, roundedRadius)
            }
            if view is UIVisualEffectView, effect == nil || frame.width > (effect?.bounds.width ?? 0) {
                effect = view
            }
        }
        func walk(_ view: UIView) {
            consider(view)
            for subview in view.subviews where !(subview is FloatingBarFill) {
                walk(subview)
            }
        }
        walk(window)
        if let rounded { return rounded }
        if let effect { return effect }
        return bar.bounds.height > 20 ? bar : nil
    }

    private static func keepButtonsInFront(of fill: FloatingBarFill, in parent: UIView) {
        guard let fillIndex = parent.subviews.firstIndex(of: fill) else { return }
        let buttons = parent.subviews.filter(isTabButton)
        guard let lowest = buttons.compactMap({ parent.subviews.firstIndex(of: $0) }).min() else { return }
        guard fillIndex > lowest else { return }
        for button in buttons {
            parent.bringSubviewToFront(button)
        }
    }

    private static func isTabButton(_ view: UIView) -> Bool {
        if view is FloatingBarFill || view is UITabBar { return false }
        let label = view.accessibilityLabel ?? ""
        let size = view.bounds.size
        if ["Today", "Plan", "Scan", "Coach", "Me"].contains(label),
           size.width > 20, size.height > 20, size.width < 160 {
            return true
        }
        let name = NSStringFromClass(type(of: view))
        if name.contains("TabBarButton") || name.contains("TabButton") { return true }
        guard view is UIControl else { return false }
        return size.width > 24 && size.width < 140 && size.height > 24 && size.height < 90
    }

    private static func framesClose(_ lhs: CGRect, _ rhs: CGRect) -> Bool {
        abs(lhs.minX - rhs.minX) < 0.5
            && abs(lhs.minY - rhs.minY) < 0.5
            && abs(lhs.width - rhs.width) < 0.5
            && abs(lhs.height - rhs.height) < 0.5
    }
}

/// Solid page colour behind the floating pill. It does not take taps.
final class FloatingBarCover: UIView {
    static let viewTag = 9054

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        backgroundColor = TabBarContrast.pageUIColor
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        nil
    }
}

/// Page colour at 0.98 over ultra-thin material, with a 0.5pt top hairline.
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

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        nil
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        blur.frame = bounds
        wash.frame = bounds
        hairline.frame = CGRect(x: 0, y: 0, width: bounds.width, height: 0.5)
    }
}

/// Installed from the tab view background. The probe itself does not draw.
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
