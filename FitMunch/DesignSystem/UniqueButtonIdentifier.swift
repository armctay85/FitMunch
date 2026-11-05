import SwiftUI
import UIKit

/// Puts the identifier on the button and clears the same id from ancestors.
/// A toolbar item copies the id onto its container, so a query for any element
/// with that id matches the container and the button.
struct UniqueButtonIdentifier: UIViewRepresentable {
    var identifier: String

    func makeUIView(context: Context) -> Probe {
        let view = Probe()
        view.identifier = identifier
        view.isUserInteractionEnabled = false
        view.backgroundColor = .clear
        view.isAccessibilityElement = false
        return view
    }

    func updateUIView(_ uiView: Probe, context: Context) {
        uiView.identifier = identifier
        uiView.dedupe()
    }

    final class Probe: UIView {
        var identifier = ""

        override func didMoveToWindow() {
            super.didMoveToWindow()
            dedupe()
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            dedupe()
        }

        func dedupe() {
            let identifier = identifier
            DispatchQueue.main.async { [weak self] in
                guard let self, !identifier.isEmpty else { return }
                var button: UIView?
                var view: UIView? = self
                while let current = view {
                    if current !== self, Self.isButton(current), button == nil {
                        button = current
                    }
                    view = current.superview
                }
                guard let button else { return }
                button.accessibilityIdentifier = identifier
                var ancestor = button.superview
                while let current = ancestor {
                    if current.accessibilityIdentifier == identifier {
                        current.accessibilityIdentifier = nil
                    }
                    ancestor = current.superview
                }
            }
        }

        private static func isButton(_ view: UIView) -> Bool {
            if view is UIButton { return true }
            return view.accessibilityTraits.contains(.button)
        }
    }
}

extension View {
    /// Identifier for one button. Ancestors that mirror the id are cleared.
    func uniqueButtonIdentifier(_ identifier: String) -> some View {
        accessibilityIdentifier(identifier)
            .background {
                UniqueButtonIdentifier(identifier: identifier)
                    .frame(width: 0, height: 0)
                    .accessibilityHidden(true)
            }
    }
}
