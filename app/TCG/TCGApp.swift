//
//  TCGApp.swift
//  TCGApp
//
//  Created by Kamaal M Farah on 6/28/26.
//

import SwiftUI
import TCGApp

@main struct TCGApp: App {
    #if os(iOS)
        @UIApplicationDelegateAdaptor(TCGApplicationDelegate.self) private var applicationDelegate
    #endif

    var body: some Scene {
        TCGApp::TCGScene()
    }
}
