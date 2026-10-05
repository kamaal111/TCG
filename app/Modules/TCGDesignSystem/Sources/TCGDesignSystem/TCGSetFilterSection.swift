import SwiftUI

public struct TCGSetFilterSection: View {
    private let availableSetNames: [String]
    @Binding private var selection: Set<String>

    public init(availableSetNames: [String], selection: Binding<Set<String>>) {
        self.availableSetNames = availableSetNames
        _selection = selection
    }

    public var body: some View {
        Section {
            Button {
                selection = []
            } label: {
                Text("All sets", bundle: .module)
            }
            ForEach(availableSetNames, id: \.self) { name in
                Toggle(isOn: selectionBinding(for: name)) { Text(verbatim: name) }
                    #if os(iOS)
                        .menuActionDismissBehavior(.disabled)
                    #endif
            }
        } header: {
            Text("Set name", bundle: .module)
        }
    }

    public static func summary(for selection: Set<String>) -> Text {
        guard let name = selection.sorted().first else { return Text("All sets", bundle: .module) }
        guard selection.count > 1 else { return Text(verbatim: name) }
        return Text("\(selection.count) sets", bundle: .module)
    }

    private func selectionBinding(for name: String) -> Binding<Bool> {
        Binding(
            get: { selection.contains(name) },
            set: { selected in
                if selected { selection.insert(name) } else { selection.remove(name) }
            }
        )
    }
}
