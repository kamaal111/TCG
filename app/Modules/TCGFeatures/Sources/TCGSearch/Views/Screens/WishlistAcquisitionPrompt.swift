import SwiftUI
import TCGClient

struct WishlistAcquisitionPrompt: ViewModifier {
    @Environment(\.tcgWishlist) private var wishlist
    @Binding var printingKey: String?
    let onComplete: (String?) -> Void

    @State private var task: Task<Void, Never>?
    @State private var failedRemoval: RemovalFailure?

    private struct RemovalFailure {
        let key: String
        let error: WishlistError
    }

    func body(content: Content) -> some View {
        content
            .disabled(task != nil)
            .onDisappear { task?.cancel() }
            .alert(
                Text("Keep this card on your wishlist?", bundle: .module),
                isPresented: Binding(get: { printingKey != nil }, set: { if !$0 { printingKey = nil } }),
                presenting: printingKey
            ) { key in
                Button(role: .cancel) {
                    onComplete(nil)
                } label: {
                    Text("Keep on Wishlist", bundle: .module)
                }
                Button(role: .destructive) {
                    remove(key)
                } label: {
                    Text("Remove from Wishlist", bundle: .module)
                }
            }
            .alert(
                Text("Wishlist unavailable", bundle: .module),
                isPresented: Binding(get: { failedRemoval != nil }, set: { if !$0 { failedRemoval = nil } }),
                presenting: failedRemoval
            ) { failure in
                Button {
                    remove(failure.key)
                } label: {
                    Text("Retry", bundle: .module)
                }
                Button(role: .cancel) {
                    onComplete(nil)
                } label: {
                    Text("Keep on Wishlist", bundle: .module)
                }
            } message: { failure in
                Text(failure.error.localizedDescription)
            }
    }

    private func remove(_ key: String) {
        guard let wishlist, task == nil else { return }
        task = Task {
            defer { task = nil }
            guard !Task.isCancelled else { return }
            let result = await wishlist.remove(printingKey: key)
            guard !Task.isCancelled else { return }
            switch result {
            case .success:
                onComplete(key)
            case .failure(let error):
                failedRemoval = RemovalFailure(key: key, error: error)
            }
        }
    }
}
