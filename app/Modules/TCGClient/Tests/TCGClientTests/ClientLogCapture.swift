import KamaalLogger

extension HoldedLog {
    func hasLogFields(_ expected: [String: String]) -> Bool {
        expected.allSatisfy { name, value in
            fields().contains { $0.name == name && $0.value.displayText == value }
        }
    }

    func hasLogText(_ marker: String) -> Bool {
        message.contains(marker) || fields(includingPrivate: true).contains { $0.value.displayText.contains(marker) }
    }
}
