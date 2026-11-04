import SwiftUI
import UIKit

/// Near-opaque fill for the floating tab bar: page colour at 0.94 over
/// ultra-thin material, plus a 0.5pt separator hairline. Applied as the
/// system bar's own background, behind the tab buttons. No extra subview,
/// so the buttons stay hittable.
enum FloatingBarBacking {
    static func applyGlobals() {
        let styled = makeAppearance()
        let proxy = UITabBar.appearance()
        proxy.standardAppearance = styled
        proxy.scrollEdgeAppearance = styled
        proxy.tintColor = TabBarContrast.selectedUIColor
        proxy.unselectedItemTintColor = TabBarContrast.normalUIColor
    }

    /// Styles the live bar once. Returns false until the bar is on screen.
    @discardableResult
    static func refresh(in window: UIWindow) -> Bool {
        guard let bar = tabBar(in: window) else { return false }
        if objc_getAssociatedObject(bar, &styledKey) != nil { return true }
        let styled = makeAppearance()
        bar.standardAppearance = styled
        bar.scrollEdgeAppearance = styled
        bar.tintColor = TabBarContrast.selectedUIColor
        bar.unselectedItemTintColor = TabBarContrast.normalUIColor
        objc_setAssociatedObject(bar, &styledKey, "styled" as NSString, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        return true
    }

    private static var styledKey: UInt8 = 0

    private static func makeAppearance() -> UITabBarAppearance {
        let appearance = UITabBarAppearance()
        appearance.configureWithDefaultBackground()
        appearance.backgroundEffect = UIBlurEffect(style: .systemUltraThinMaterial)
        appearance.backgroundColor = TabBarContrast.washUIColor
        appearance.shadowColor = TabBarContrast.separatorUIColor
        appearance.shadowImage = hairline
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

    /// 0.5pt separator. A 1x1 image at scale 2 is half a point tall.
    private static let hairline: UIImage = {
        let format = UIGraphicsImageRendererFormat()
        format.opaque = false
        format.scale = 2
        return UIGraphicsImageRenderer(size: CGSize(width: 1, height: 0.5), format: format).image { ctx in
            TabBarContrast.separatorUIColor.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: 1, height: 0.5))
        }
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
}

/// Lives in the tab view's background and styles the bar once. It does not draw.
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
    private var didInstall = false

    override func didMoveToWindow() {
        super.didMoveToWindow()
        refresh()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        refresh()
    }

    func refresh() {
        guard !didInstall, let window else { return }
        if FloatingBarBacking.refresh(in: window) {
            didInstall = true
        }
    }
}
