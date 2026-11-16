import Foundation

@MainActor
final class SharedCollectionReads<Key: Hashable, Value: Sendable> {
    private struct Request {
        let id: UUID
        let task: Task<Value, Never>
    }

    private var pending: [Key: Request] = [:]

    func read(_ key: Key, perform: @escaping @MainActor () async -> Value) async -> Value {
        if let request = pending[key] { return await request.task.value }

        let request = Request(id: UUID(), task: Task { await perform() })
        pending[key] = request
        let value = await request.task.value
        if pending[key]?.id == request.id { pending.removeValue(forKey: key) }
        return value
    }

    func clear() {
        for request in pending.values { request.task.cancel() }
        pending.removeAll()
    }
}
