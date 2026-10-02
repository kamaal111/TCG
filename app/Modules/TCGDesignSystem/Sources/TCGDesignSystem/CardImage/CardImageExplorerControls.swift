import SwiftUI

struct CardImageExplorerControls: View {
    struct Actions {
        let zoomOut: () -> Void
        let zoomIn: () -> Void
        let reset: () -> Void
    }

    let scale: CGFloat
    let isLoaded: Bool
    let actions: Actions

    var body: some View {
        HStack(spacing: 20) {
            Button {
                actions.zoomOut()
            } label: {
                Label {
                    Text("Zoom out", bundle: .module)
                } icon: {
                    Image(systemName: "minus.magnifyingglass")
                }
            }
            .disabled(!isLoaded || scale <= 1)
            Text(scale, format: .percent.precision(.fractionLength(0)))
                .monospacedDigit().frame(minWidth: 48)
            Button {
                actions.zoomIn()
            } label: {
                Label {
                    Text("Zoom in", bundle: .module)
                } icon: {
                    Image(systemName: "plus.magnifyingglass")
                }
            }
            .disabled(!isLoaded || scale >= 6)
            Button {
                actions.reset()
            } label: {
                Text("Reset", bundle: .module)
            }
            .disabled(!isLoaded || scale == 1)
        }
        .labelStyle(.iconOnly)
        .padding()
        .background(.background.secondary, in: Capsule())
        .padding()
    }

}
