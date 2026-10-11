//
//  TCGSettingsScreen.swift
//  TCGFeatures
//

import KamaalAuth
import SwiftUI
import TCGCards
import TCGUtils
import UniformTypeIdentifiers

public struct TCGSettingsScreen: View {
    @Environment(KamaalAuth.self) private var auth
    #if os(macOS)
        @Environment(\.dismiss) private var dismiss
    #endif

    @State private var isConfirmingSignOut = false
    @State private var isSigningOut = false

    @State private var isWorking = false
    @State private var isShowingImport = false
    @State private var isChoosingFile = false
    @State private var isExportingFile = false
    @State private var document: CSVFileDocument?
    @State private var exportFilename = "tcg-cards"
    @State private var feedback: String?
    @State private var isShowingFeedback = false
    private let exportAction: (@MainActor () async -> Result<URL, CardsExportError>)?
    private let templateAction: (@MainActor () -> Result<URL, CardsExportError>)?
    private let importAction: (@MainActor (URL) -> Void)?
    private let version: AppVersion

    public init(
        onExport: (@MainActor () async -> Result<URL, CardsExportError>)? = nil,
        onDownloadTemplate: (@MainActor () -> Result<URL, CardsExportError>)? = nil,
        onImport: (@MainActor (URL) -> Void)? = nil
    ) {
        version = .main
        exportAction = onExport
        templateAction = onDownloadTemplate
        importAction = onImport
    }

    init(
        version: AppVersion,
        onExport: (@MainActor () async -> Result<URL, CardsExportError>)? = nil,
        onDownloadTemplate: (@MainActor () -> Result<URL, CardsExportError>)? = nil,
        onImport: (@MainActor (URL) -> Void)? = nil
    ) {
        self.version = version
        exportAction = onExport
        templateAction = onDownloadTemplate
        importAction = onImport
    }

    public var body: some View {
        Form {
            if exportAction != nil && templateAction != nil && importAction != nil {
                Section {
                    Button {
                        exportCards()
                    } label: {
                        Text("Export Cards", bundle: .module)
                    }
                    Button {
                        isShowingImport = true
                    } label: {
                        Text("Import Cards", bundle: .module)
                    }
                    if isWorking { ProgressView() }
                } header: {
                    Text("Data", bundle: .module)
                } footer: {
                    Text(
                        "Export your entire collection to CSV, or review and import cards from a CSV file.",
                        bundle: .module
                    )
                }
                .disabled(isWorking)
            }
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
                .disabled(isSigningOut || isWorking)
                .confirmationDialog(
                    Text("Sign out of TCG?", bundle: .module),
                    isPresented: $isConfirmingSignOut,
                    titleVisibility: .visible
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
        .sheet(isPresented: $isShowingImport) { importIntroduction }
        .fileImporter(isPresented: $isChoosingFile, allowedContentTypes: [.commaSeparatedText, .plainText]) { result in
            switch result {
            case .success(let url):
                Task { @MainActor in
                    await Task.yield()
                    importAction?(url)
                }
            case .failure:
                showFeedback(
                    String(
                        localized:
                            "The file couldn’t be opened. Choose a CSV file saved on your device or in Files and try again.",
                        bundle: .module
                    )
                )
            }
        }
        .fileExporter(
            isPresented: $isExportingFile,
            document: document,
            contentType: .commaSeparatedText,
            defaultFilename: exportFilename
        ) { result in
            document = nil
            switch result {
            case .success:
                showFeedback(String(localized: "Your CSV was saved successfully.", bundle: .module))
            case .failure:
                showFeedback(
                    String(
                        localized: "The CSV couldn’t be saved. Check the destination’s available space and try again.",
                        bundle: .module
                    )
                )
            }
        }
        .alert(Text("CSV Transfer", bundle: .module), isPresented: $isShowingFeedback) {
            Button {
                feedback = nil
            } label: {
                Text("OK", bundle: .module)
            }
        } message: {
            Text(feedback ?? "")
        }
    }

    private var importIntroduction: some View {
        TCGCSVImportIntroduction(
            onDownloadTemplate: {
                isShowingImport = false
                Task { @MainActor in
                    await Task.yield()
                    do {
                        guard let templateAction else { return }
                        switch templateAction() {
                        case .success(let url): try prepareExport(url, filename: "tcg-cards-template")
                        case .failure(let error): showFeedback(error.localizedDescription)
                        }
                    } catch {
                        showFeedback(
                            String(localized: "The template couldn’t be created. Please try again.", bundle: .module)
                        )
                    }
                }
            },
            onChooseFile: {
                isShowingImport = false
                Task { @MainActor in
                    await Task.yield()
                    isChoosingFile = true
                }
            },
            onClose: { isShowingImport = false }
        )
    }

    private func prepareExport(_ url: URL, filename: String) throws {
        document = try CSVFileDocument(temporaryURL: url)
        exportFilename = filename
        isExportingFile = true
    }

    private func exportCards() {
        guard let exportAction else { return }
        isWorking = true
        Task { @MainActor in
            defer { isWorking = false }
            do {
                switch await exportAction() {
                case .success(let url): try prepareExport(url, filename: "tcg-cards")
                case .failure(let error): showFeedback(error.localizedDescription)
                }
            } catch {
                showFeedback(
                    String(
                        localized:
                            "Your collection couldn’t be exported. Check your connection and signed-in account, then try again.",
                        bundle: .module
                    )
                )
            }
        }
    }

    private func showFeedback(_ message: String) {
        feedback = message
        isShowingFeedback = true
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
