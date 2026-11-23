import KamaalUI
import SwiftUI

public struct TCGCollectionPaginationFooter: View {
    let isLoading: Bool
    let errorDescription: String?
    let failureTitle: Text?
    let retry: () -> Void

    public init(
        isLoading: Bool,
        errorDescription: String?,
        failureTitle: Text?,
        retry: @escaping () -> Void
    ) {
        self.isLoading = isLoading
        self.errorDescription = errorDescription
        self.failureTitle = failureTitle
        self.retry = retry
    }

    public var body: some View {
        if isLoading {
            ProgressView {
                Text("Loading more cards…", bundle: .module)
            }
            .ktakeWidthEagerly()
            .padding()
        } else if let errorDescription {
            VStack(spacing: 8) {
                (failureTitle ?? Text("Couldn't load more cards", bundle: .module))
                    .font(.headline)
                Text(verbatim: errorDescription)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button(action: retry) {
                    Text("Try again", bundle: .module)
                }
                .buttonStyle(.bordered)
            }
            .ktakeWidthEagerly()
            .padding()
        }
    }
}
