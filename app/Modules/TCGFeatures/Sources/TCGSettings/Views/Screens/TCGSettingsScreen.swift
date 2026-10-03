//
//  TCGSettingsScreen.swift
//  TCGFeatures
//

import KamaalAuth
import SwiftUI

public struct TCGSettingsScreen: View {
    @Environment(KamaalAuth.self) private var auth
    #if os(macOS)
        @Environment(\.dismiss) private var dismiss
    #endif

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
                    Text("Sign Out", bundle: .module)
                        .fontWeight(.bold)
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity)
                }
                #if os(macOS)
                    .buttonStyle(.borderless)
                #endif
                .disabled(isSigningOut)
                .confirmationDialog(
                    Text("Sign out of TCG?", bundle: .module),
                    isPresented: $isConfirmingSignOut, titleVisibility: .visible
                ) {
                    Button(role: .destructive) {
                        signOut()
                    } label: {
                        Text("Sign Out", bundle: .module)
                    }
                }
            }

            if let versionText = version.displayText {
                Section {
                    LabeledContent {
                        Text(versionText)
                            .textSelection(.enabled)
                    } label: {
                        Text("Version", bundle: .module)
                    }
                } header: {
                    Text("About", bundle: .module)
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle(Text("Settings", bundle: .module))
    }

    private func signOut() {
        Task {
            isSigningOut = true
            await auth.signOut()
            isSigningOut = false
            #if os(macOS)
                dismiss()
            #endif
        }
    }
}
