import SwiftUI

#if os(iOS)
    import UIKit
#endif

extension View {
    func tcgNavigationAccent() -> some View {
        #if os(macOS)
            tint(.accentColor).modifier(NavigationAccent())
        #else
            tint(.accentColor)
        #endif
    }
}

@MainActor
public enum TCGNavigationAppearance {
    /// Installs the accent-colored system Back indicator before any navigation bars are created.
    public static func install() {
        #if os(iOS)
            _ = backIndicatorInstallation
        #endif
    }

    #if os(iOS)
        private static let backIndicatorInstallation: Void = {
            // Liquid Glass uses a neutral Back indicator even when the bar is tinted.
            guard #available(iOS 26, *),
                let indicator = UIImage(
                    systemName: "chevron.backward",
                    withConfiguration: UIImage.SymbolConfiguration(pointSize: 19, weight: .semibold)
                ),
                let accented = indicator.applyingSymbolConfiguration(
                    UIImage.SymbolConfiguration(paletteColors: [UIColor(Color.accentColor)])
                )
            else { return }

            let bar = UINavigationBar.appearance()
            bar.backIndicatorImage = accented.withRenderingMode(.alwaysOriginal)
            bar.backIndicatorTransitionMaskImage = indicator
        }()
    #endif
}

#if os(macOS)
    private struct NavigationAccent: ViewModifier {
        @Environment(\.isEnabled) private var isEnabled

        func body(content: Content) -> some View {
            // Mac glass controls can ignore tint when resolving their foreground color.
            content.foregroundStyle(isEnabled ? Color.accentColor : Color.secondary)
        }
    }
#endif
