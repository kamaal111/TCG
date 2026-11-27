import SwiftUI
import TCGDesignSystem

package struct WishlistFeedback: Identifiable {
    package let id = UUID()
    private let saved: Bool

    package init(saved: Bool) {
        self.saved = saved
    }

    var title: String {
        saved
            ? String(localized: "Added to Wishlist", bundle: .module)
            : String(localized: "Removed from Wishlist", bundle: .module)
    }
}

extension View {
    package func wishlistFeedback(_ feedback: Binding<WishlistFeedback?>) -> some View {
        toast(
            isPresented: Binding(
                get: { feedback.wrappedValue != nil },
                set: { if !$0 { feedback.wrappedValue = nil } }
            ),
            style: .bottom(title: feedback.wrappedValue?.title ?? "", type: .success, description: nil)
        )
        .task(id: feedback.wrappedValue?.id) {
            guard let notice = feedback.wrappedValue else { return }
            AccessibilityNotification.Announcement(notice.title).post()
            do { try await Task.sleep(for: .seconds(3)) } catch { return }
            if feedback.wrappedValue?.id == notice.id { feedback.wrappedValue = nil }
        }
    }
}
