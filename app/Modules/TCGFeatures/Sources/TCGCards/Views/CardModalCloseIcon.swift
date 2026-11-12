import SwiftUI

struct CardModalCloseIcon: View {
    var body: some View {
        Image(systemName: "xmark")
            #if os(iOS)
                .font(.body.weight(.semibold))
                .foregroundStyle(.tint)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
            #endif
    }
}
