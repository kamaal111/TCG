import KamaalLogger
import SwiftUI
import TCGDesignSystem

#if os(macOS)
    import AppKit
#elseif os(iOS)
    import UIKit
#endif

struct TCGAppLogsScreen: View {
    @State private var entries: [TCGAppLog]?

    var body: some View {
        TCGAppLogsContent(entries: entries)
            .task {
                entries = TCGAppLog.recent(in: await LogHolder.shared.logs, disclosure: .appBuild)
            }
    }
}

struct TCGAppLogsContent: View {
    let entries: [TCGAppLog]?

    var body: some View {
        content
            .tcgSheet(
                Text("App Logs", bundle: .module),
                closeLabel: Text("Close", bundle: .module),
                closeDisabled: false,
                onClose: nil
            )
            #if os(macOS)
                .frame(minWidth: 450, minHeight: 350)
            #endif
    }

    @ViewBuilder
    private var content: some View {
        if let entries {
            if entries.isEmpty {
                ContentUnavailableView {
                    Label {
                        Text("No logs available", bundle: .module)
                    } icon: {
                        Image(systemName: "list.bullet.rectangle")
                    }
                }
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(entries) { entry in
                            NavigationLink {
                                TCGAppLogDetail(entry: entry)
                            } label: {
                                row(entry)
                            }
                            .buttonStyle(.plain)
                            if entry.id != entries.last?.id { Divider() }
                        }
                    }
                    .padding(.horizontal)
                }
            }
        } else {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func row(_ entry: TCGAppLog) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: entry.source).font(.headline)
                logSeverity(entry.level).font(.caption)
                Text(verbatim: entry.message)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                if let context = entry.summaryContext {
                    Text(verbatim: context)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.forward")
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }
}

struct TCGAppLogDetail: View {
    let entry: TCGAppLog
    @State private var copiedField: Int?
    private var fields: [TCGAppLog.Field] { entry.fields }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(verbatim: entry.source).font(.headline)
                logSeverity(entry.level)
                Text(entry.timestamp, format: .dateTime.year().month().day().hour().minute().second())
                    .foregroundStyle(.secondary)
                ForEach(fields.indices, id: \.self) { index in
                    Divider()
                    fieldRow(fields[index], index: index)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
        }
        .navigationTitle(Text("Log Details", bundle: .module))
        .task(id: copiedField) {
            guard copiedField != nil else { return }
            do {
                try await Task.sleep(for: .seconds(2))
                copiedField = nil
            } catch {}
        }
    }

    private func fieldRow(_ field: TCGAppLog.Field, index: Int) -> some View {
        let label = field.key.map { Text(verbatim: $0) } ?? Text("Message", bundle: .module)
        return HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                label.font(.caption.weight(.semibold))
                Text(verbatim: field.value)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Button {
                if Self.copy(field.value) { copiedField = index }
            } label: {
                if copiedField == index {
                    Label {
                        Text("Copied", bundle: .module)
                    } icon: {
                        Image(systemName: "checkmark")
                    }
                } else {
                    Label {
                        Text("Copy", bundle: .module)
                    } icon: {
                        Image(systemName: "document.on.document")
                    }
                }
            }
            .labelStyle(.iconOnly)
            .accessibilityLabel(Text("Copy \(label)", bundle: .module))
        }
    }

    @MainActor
    static func copy(_ value: String) -> Bool {
        copy(value, to: .general)
    }

    #if os(macOS)
        @MainActor
        static func copy(_ value: String, to pasteboard: NSPasteboard) -> Bool {
            pasteboard.clearContents()
            return pasteboard.setString(value, forType: .string)
        }
    #elseif os(iOS)
        @MainActor
        static func copy(_ value: String, to pasteboard: UIPasteboard) -> Bool {
            pasteboard.string = value
            return true
        }
    #endif
}

private func logSeverity(_ level: LogLevels) -> Text {
    switch level {
    case .error: Text("Error", bundle: .module)
    case .warning: Text("Warning", bundle: .module)
    case .info: Text("Info", bundle: .module)
    case .debug: Text("Debug", bundle: .module)
    }
}
