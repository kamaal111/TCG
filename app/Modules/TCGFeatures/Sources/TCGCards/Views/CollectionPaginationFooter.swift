import SwiftUI

struct CollectionPaginationFooter: View {
    let isLoading: Bool
    let error: TCGCardsOperationError?
    let retry: () -> Void

    var body: some View {
        if let error {
            VStack(spacing: 8) {
                Text("Couldn't load more cards", bundle: .module)
                    .font(.headline)
                Text(verbatim: error.errorDescription ?? "")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button(action: retry) {
                    Text("Try again", bundle: .module)
                }
                .buttonStyle(.bordered)
            }
            .frame(maxWidth: .infinity)
            .padding()
        } else if isLoading {
            ProgressView {
                Text("Loading more cards…", bundle: .module)
            }
            .frame(maxWidth: .infinity)
            .padding()
        }
    }
}
