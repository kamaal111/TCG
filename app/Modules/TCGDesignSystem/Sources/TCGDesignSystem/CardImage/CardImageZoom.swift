import SwiftUI

struct CardImageZoom {
    static let minimumScale: CGFloat = 1
    static let maximumScale: CGFloat = 6
    static let controlStepFactor: CGFloat = 1.5
    static let doubleTapScale: CGFloat = 2

    private(set) var scale: CGFloat = CardImageZoom.minimumScale
    private(set) var offset: CGSize = .zero

    struct Interaction {
        var magnification: CGFloat = 1
        var anchor: UnitPoint = .center
        var translation: CGSize = .zero
    }

    func applying(_ interaction: Interaction, viewport: CGSize, artwork: CGSize) -> Self {
        var result = self
        result.scale = Self.clampedScale(scale * interaction.magnification)
        let ratio = result.scale / scale
        let anchorX = (interaction.anchor.x - 0.5) * viewport.width
        let anchorY = (interaction.anchor.y - 0.5) * viewport.height
        result.pan(
            to: CGSize(
                width: anchorX + (offset.width - anchorX) * ratio + interaction.translation.width,
                height: anchorY + (offset.height - anchorY) * ratio + interaction.translation.height
            ),
            viewport: viewport,
            artwork: artwork
        )
        return result
    }

    mutating func setScale(_ value: CGFloat, viewport: CGSize, artwork: CGSize) {
        scale = Self.clampedScale(value)
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

    private static func clampedScale(_ value: CGFloat) -> CGFloat {
        min(max(value, minimumScale), maximumScale)
    }
}
