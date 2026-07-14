//
//  View+Toast.swift
//  TCGDesignSystem
//
//  Created by Kamaal M Farah on 7/18/26.
//

import KamaalPopUp
import SwiftUI

extension View {
    public func toast(isPresented: Binding<Bool>, style: KPopUpStyles) -> some View {
        modifier(ToastModifier(isPresented: isPresented, style: style))
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
