import SwiftUI

public struct TCGZoomSlider: View {
    @Binding private var value: Double
    private let range: ClosedRange<Double>
    private let label: Text

    public init(value: Binding<Double>, range: ClosedRange<Double>, label: Text) {
        _value = value
        self.range = range
        self.label = label
    }

    public var body: some View {
        HStack {
            Image(systemName: "minus.magnifyingglass")
            Slider(value: $value, in: range).accessibilityLabel(label).help(label)
            Image(systemName: "plus.magnifyingglass")
        }
    }
}
