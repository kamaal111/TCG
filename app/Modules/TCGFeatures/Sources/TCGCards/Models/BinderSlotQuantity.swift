struct BinderSlotQuantity {
    let maximum: Int

    func clamped(_ quantity: Int) -> Int {
        max(1, min(maximum, quantity))
    }

    func permits(_ quantity: Int) -> Bool {
        quantity > 0 && quantity <= maximum
    }
}
