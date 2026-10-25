import SwiftUI
import TCGDesignSystem

struct BinderPageLoadError: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack {
            TCGInlineError(message)
            Button(action: retry) {
                Text("Retry", bundle: .module)
            }
        }
        .padding()
        .background(.regularMaterial)
    }
}
