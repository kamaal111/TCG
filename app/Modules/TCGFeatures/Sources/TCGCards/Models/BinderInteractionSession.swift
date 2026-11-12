import Observation

@MainActor
@Observable
final class BinderInteractionSession {
    var payload: BinderSlotDragPayload?
    var suppressesMomentum = false

    func end() {
        payload = nil
    }
}
