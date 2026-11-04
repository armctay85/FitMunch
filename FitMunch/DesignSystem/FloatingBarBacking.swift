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

    /// Styles the live bar and places the wash. Returns true once the wash has a real frame.
    @discardableResult
    static func refresh(in window: UIWindow) -> Bool {
        guard let bar = tabBar(in: window) else { return false }
        styleIfNeeded(bar)
        return placeFill(on: bar)
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

    /// Wash shares the buttons' superview and stays behind them, so taps hit the tabs.
    private static func placeFill(on bar: UITabBar) -> Bool {
        guard let anchor = firstButton(in: bar), let parent = anchor.superview else { return false }
        guard parent.bounds.width > 40, parent.bounds.height > 20 else { return false }
        let fill = (bar.viewWithTag(FloatingBarFill.viewTag) as? FloatingBarFill) ?? FloatingBarFill()
        fill.tag = FloatingBarFill.viewTag
        fill.isUserInteractionEnabled = false
        fill.accessibilityElementsHidden = true
        let shape = shapeView(around: parent)
        let target = shape.convert(shape.bounds, to: parent)
        guard target.width > 80, target.height > 20 else { return false }
        let radius = shape.layer.cornerRadius
        let samePlace = fill.superview === parent
            && framesClose(fill.frame, target)
            && abs(fill.layer.cornerRadius - radius) < 0.5
        if !samePlace {
            if shape !== parent, shape.superview === parent {
                parent.insertSubview(fill, aboveSubview: shape)
            } else if fill.superview !== parent {
                parent.insertSubview(fill, at: 0)
            }
            fill.frame = target
            fill.layer.cornerRadius = radius
            fill.layer.maskedCorners = shape.layer.maskedCorners
            fill.clipsToBounds = true
        }
        keepButtonsInFront(of: fill, in: parent)
        return fill.bounds.width > 80 && fill.bounds.height > 20
    }

    /// The rounded chrome when the buttons sit on a pill. Otherwise the button container.
    private static func shapeView(around parent: UIView) -> UIView {
        if parent.layer.cornerRadius >= 12 { return parent }
        var best: UIView?
        var bestRadius: CGFloat = 0
        func consider(_ view: UIView) {
            if view is FloatingBarFill || isTabButton(view) { return }
            let radius = view.layer.cornerRadius
            let size = view.bounds.size
            guard radius > bestRadius, radius >= 12, size.width > 80, size.height > 20, size.height < 160 else { return }
            let frame = view.convert(view.bounds, to: parent)
            guard frame.width <= parent.bounds.width + 8, frame.height <= parent.bounds.height + 8 else { return }
            best = view
            bestRadius = radius
        }
        func walk(_ view: UIView) {
            consider(view)
            for subview in view.subviews where !(subview is FloatingBarFill) {
                walk(subview)
            }
        }
        for subview in parent.subviews {
            walk(subview)
        }
        if let above = parent.superview {
            consider(above)
        }
        return best ?? parent
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

    private static func firstButton(in view: UIView) -> UIView? {
        if isTabButton(view) { return view }
        for subview in view.subviews {
            if let found = firstButton(in: subview) { return found }
        }
        return nil
    }

    private static func isTabButton(_ view: UIView) -> Bool {
        if view is FloatingBarFill || view is UITabBar { return false }
        let name = NSStringFromClass(type(of: view))
        if name.contains("TabBarButton") || name.contains("TabButton") { return true }
        guard view is UIControl else { return false }
        let size = view.bounds.size
        return size.width > 24 && size.width < 140 && size.height > 24 && size.height < 90
    }

    private static func framesClose(_ lhs: CGRect, _ rhs: CGRect) -> Bool {
        abs(lhs.minX - rhs.minX) < 0.5
            && abs(lhs.minY - rhs.minY) < 0.5
            && abs(lhs.width - rhs.width) < 0.5
            && abs(lhs.height - rhs.height) < 0.5
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
        if window.viewWithTag(FloatingBarFill.viewTag) is FloatingBarFill,
           let fill = window.viewWithTag(FloatingBarFill.viewTag),
           fill.bounds.width > 80, fill.bounds.height > 20 {
            return
        }
        FloatingBarBacking.refresh(in: window)
    }
}
