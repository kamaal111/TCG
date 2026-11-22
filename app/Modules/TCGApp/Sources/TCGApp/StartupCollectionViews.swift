import LocalAuthentication
import SwiftUI
import TCGCards

struct StartupCollectionUnlockControls: View {
    let isUnlocking: Bool
    let needsUnlockHelp: Bool
    let unlock: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            Button(action: unlock) {
                Text("Unlock cached cards", bundle: .module)
            }
            .buttonStyle(.borderedProminent)
            .disabled(isUnlocking)

            instructions
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var instructions: Text {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)

        #if os(macOS)
            if !needsUnlockHelp, context.biometryType == .touchID {
                return Text(
                    "Use Touch ID or your Mac password to browse saved cards, or wait for sign-in.",
                    bundle: .module
                )
            }
            return Text("Use your Mac password to browse saved cards, or wait for sign-in.", bundle: .module)
        #else
            if !needsUnlockHelp, context.biometryType == .faceID {
                return Text(
                    "Use Face ID or your device passcode to browse saved cards, or wait for sign-in.",
                    bundle: .module
                )
            }
            if !needsUnlockHelp, context.biometryType == .touchID {
                return Text(
                    "Use Touch ID or your device passcode to browse saved cards, or wait for sign-in.",
                    bundle: .module
                )
            }
            return Text("Use your device passcode to browse saved cards, or wait for sign-in.", bundle: .module)
        #endif
    }
}

struct StartupCollectionPreview: View {
    let preview: StartupCollection.Preview
    let isCheckingSession: Bool
    let dismiss: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                if isCheckingSession {
                    Text("Checking your session…", bundle: .module)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button(action: dismiss) { Text("Done", bundle: .module) }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)

            TCGDownloadedCollectionScreen(cards: preview.cards, collections: preview.collections)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.background)
    }
}
