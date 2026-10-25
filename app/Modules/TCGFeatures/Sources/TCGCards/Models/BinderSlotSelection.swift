import TCGClient

struct BinderSlotSelection: Identifiable {
    let position: BinderPosition
    let card: CardWithPrice?
    var id: BinderPosition { position }
}
