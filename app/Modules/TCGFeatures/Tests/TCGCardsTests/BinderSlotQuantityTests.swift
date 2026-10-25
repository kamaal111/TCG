import Testing

@testable import TCGCards

struct BinderSlotQuantityTests {
    @Test(arguments: [-1, 0, 1, 4])
    func `Fully allocated cards retain a positive quantity and cannot be saved`(quantity: Int) {
        let policy = BinderSlotQuantity(maximum: 0)
        #expect(policy.clamped(quantity) == 1)
        #expect(!policy.permits(quantity))
    }

    @Test(arguments: [1, 2, 3, 4])
    func `Available copies can be split across slots`(quantity: Int) {
        let policy = BinderSlotQuantity(maximum: 4)
        #expect(policy.permits(quantity))
        #expect(policy.clamped(quantity) == quantity)
    }

    @Test(arguments: [-1, 0, 5])
    func `Rejects quantities outside the available copies`(quantity: Int) {
        let policy = BinderSlotQuantity(maximum: 4)
        #expect(!policy.permits(quantity))
        #expect((1...4).contains(policy.clamped(quantity)))
    }
}
