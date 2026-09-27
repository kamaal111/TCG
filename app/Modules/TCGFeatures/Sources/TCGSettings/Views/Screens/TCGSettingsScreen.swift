//
//  TCGSettingsScreen.swift
//  TCGFeatures
//

import KamaalAuth
import SwiftUI

#if os(macOS)
    import AppKit
#endif

public struct TCGSettingsScreen: View {
    @Environment(KamaalAuth.self) private var auth

    @State private var isConfirmingSignOut = false
    @State private var isSigningOut = false

    private let version: AppVersion

    public init() {
        self.init(version: .main)
    }

    init(version: AppVersion) {
        self.version = version
    }

    public var body: some View {
        Form {
            Section {
                Button(role: .destructive, action: { isConfirmingSignOut = true }) {
                    Text("Sign Out")
                        .fontWeight(.bold)
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity)
                }
                #if os(macOS)
                    .buttonStyle(.borderless)
                #endif
                .disabled(isSigningOut)
                .confirmationDialog("Sign out of TCG?", isPresented: $isConfirmingSignOut, titleVisibility: .visible) {
                    Button("Sign Out", role: .destructive) { signOut() }
                }
            }

            if let versionText = version.displayText {
                Section("About") {
                    LabeledContent("Version") {
                        Text(versionText)
                            .textSelection(.enabled)
                    }
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Settings")
    }

    private func signOut() {
        #if os(macOS)
            // The Settings window is only reachable while signed in, so close it rather than leave it open.
            let settingsWindow = NSApplication.shared.keyWindow
        #endif
        Task {
            isSigningOut = true
            await auth.signOut()
            isSigningOut = false
            #if os(macOS)
                settingsWindow?.performClose(nil)
            #endif
        }
    }
}
