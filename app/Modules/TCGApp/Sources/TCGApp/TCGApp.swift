//
//  TCGApp.swift
//  TCGApp
//
//  Created by Kamaal M Farah on 6/28/26.
//

import SwiftUI
import TCGAuth

public struct TCGScene: Scene {
    @State private var auth = TCGAuth.default()

    public init() {}

    public var body: some Scene {
        WindowGroup {
            ContentView()
                .tcgAuth(auth)
        }
    }
}

struct ContentView: View {
    var body: some View {
        ContentUnavailableView(
            "Signed in",
            systemImage: "checkmark.circle.fill",
            description: Text("Your session loaded successfully.")
        )
    }
}
