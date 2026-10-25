import SwiftUI

struct CardImageZoom {
    static let minimumScale: CGFloat = 1
    static let maximumScale: CGFloat = 6
    static let controlStepFactor: CGFloat = 1.5
    static let doubleTapScale: CGFloat = 2

    private(set) var scale: CGFloat = CardImageZoom.minimumScale
    private(set) var offset: CGSize = .zero

    mutating func setScale(_ value: CGFloat, viewport: CGSize, artwork: CGSize) {
        scale = min(max(value, Self.minimumScale), Self.maximumScale)
        pan(to: offset, viewport: viewport, artwork: artwork)
    }

    mutating func pan(to value: CGSize, viewport: CGSize, artwork: CGSize) {
        let horizontalLimit = max(0, (artwork.width * scale - viewport.width) / 2)
        let verticalLimit = max(0, (artwork.height * scale - viewport.height) / 2)
        offset = CGSize(
            width: min(max(value.width, -horizontalLimit), horizontalLimit),
            height: min(max(value.height, -verticalLimit), verticalLimit)
        )
    }

    mutating func reset() {
        scale = Self.minimumScale
        offset = .zero
    }
}
