//
//  View+Toast.swift
//  TCGDesignSystem
//
//  Created by Kamaal M Farah on 7/18/26.
//

import KamaalPopUp
import SwiftUI

public protocol ToastPresentable: Equatable {
    var title: String { get }
    var message: String { get }
}

extension View {
    public func toast(isPresented: Binding<Bool>, style: KPopUpStyles) -> some View {
        modifier(ToastModifier(isPresented: isPresented, style: style))
    }

    public func toast<T: ToastPresentable>(
        _ toast: T?,
        type: KPopUpBottomType = .error,
        dismiss: @escaping () -> Void
    ) -> some View {
        self.toast(
            isPresented: Binding(
                get: { toast != nil },
                set: { isPresented in if !isPresented { dismiss() } }
            ),
            style: .bottom(title: toast?.title ?? "", type: type, description: toast?.message)
        )
    }
}

private struct ToastModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme

    let isPresented: Binding<Bool>
    let style: KPopUpStyles

    func body(content: Content) -> some View {
        content
            .kPopUpLite(
                isPresented: isPresented,
                style: style,
                backgroundColor: colorScheme == .dark ? .black : .white
            )
    }
}
