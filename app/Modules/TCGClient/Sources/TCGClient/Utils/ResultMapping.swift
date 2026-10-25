enum ResultMapping {
    static func map<Input, Output, Failure: Error>(
        _ values: [Input],
        transform: (Input) -> Result<Output, Failure>
    ) -> Result<[Output], Failure> {
        var output: [Output] = []
        output.reserveCapacity(values.count)
        for value in values {
            switch transform(value) {
            case .success(let mapped): output.append(mapped)
            case .failure(let failure): return .failure(failure)
            }
        }
        return .success(output)
    }
}
