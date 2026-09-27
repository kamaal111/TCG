//
//  ScreenSnapshotAssertion.swift
//  TCGFeatures
//

import SnapshotTesting
import SwiftUI

/// Asserts `screen` renders identically to its recorded baseline, in both light and dark mode.
@MainActor
public func assertScreenSnapshot<Screen: View>(
    testName: String,
    fileID: StaticString = #fileID,
    file filePath: StaticString = #filePath,
    line: UInt = #line,
    column: UInt = #column,
    @ViewBuilder screen: () -> Screen
) {
    for scheme in [ColorScheme.light, .dark] {
        #if os(macOS)
            assertSnapshot(
                of: makeMacOSScreen(screen: screen(), scheme: scheme),
                as: .image,
                named: "\(scheme)",
                fileID: fileID,
                file: filePath,
                testName: testName,
                line: line,
                column: column
            )
        #elseif os(iOS)
            assertSnapshot(
                of: screen().environment(\.locale, Locale(identifier: "en_US")),
                as: .image(
                    layout: .device(config: .iPhone13),
                    traits: UITraitCollection(userInterfaceStyle: scheme == .dark ? .dark : .light)
                ),
                named: "iPhone-\(scheme)",
                fileID: fileID,
                file: filePath,
                testName: testName,
                line: line,
                column: column
            )
        #endif
    }
}

#if os(macOS)
    // Keep bitmap dimensions independent of the host display scale.
    private final class SnapshotHostingView<Content: View>: NSHostingView<Content> {
        override func bitmapImageRepForCachingDisplay(in rect: NSRect) -> NSBitmapImageRep? {
            let bitmap = NSBitmapImageRep(
                bitmapDataPlanes: nil,
                pixelsWide: Int(rect.width * 2),
                pixelsHigh: Int(rect.height * 2),
                bitsPerSample: 8,
                samplesPerPixel: 4,
                hasAlpha: true,
                isPlanar: false,
                colorSpaceName: .deviceRGB,
                bytesPerRow: 0,
                bitsPerPixel: 0
            )
            bitmap?.size = rect.size
            return bitmap
        }
    }

    @MainActor
    private func makeMacOSScreen<Screen: View>(screen: Screen, scheme: ColorScheme) -> SnapshotHostingView<some View> {
        let hostingView = SnapshotHostingView(
            rootView:
                screen
                .frame(width: 1_280, height: 960, alignment: .topLeading)
                .preferredColorScheme(scheme)
                .environment(\.locale, Locale(identifier: "en_US"))
                .tint(.blue)
        )
        hostingView.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
        hostingView.frame = NSRect(x: 0, y: 0, width: 1_280, height: 960)
        hostingView.wantsLayer = true
        hostingView.layer?.backgroundColor = (scheme == .dark ? NSColor.black : NSColor.white).cgColor

        return hostingView
    }
#endif
