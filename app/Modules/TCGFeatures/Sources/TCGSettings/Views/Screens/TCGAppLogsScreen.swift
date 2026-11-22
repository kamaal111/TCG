import KamaalLogger
import SwiftUI
import TCGDesignSystem

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
                                detail(entry)
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
                severity(entry.level).font(.caption)
                Text(verbatim: entry.message)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
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

    private func detail(_ entry: TCGAppLog) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(verbatim: entry.source).font(.headline)
                severity(entry.level)
                Text(entry.timestamp, format: .dateTime.year().month().day().hour().minute().second())
                    .foregroundStyle(.secondary)
                Text(verbatim: entry.message)
                    .textSelection(.enabled)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
        }
        .navigationTitle(Text("Log Details", bundle: .module))
    }

    private func severity(_ level: LogLevels) -> Text {
        switch level {
        case .error: Text("Error", bundle: .module)
        case .warning: Text("Warning", bundle: .module)
        case .info: Text("Info", bundle: .module)
        case .debug: Text("Debug", bundle: .module)
        }
    }
}
