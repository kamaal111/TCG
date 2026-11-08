import KamaalLogger

func clientLogs(_ holder: LogHolder) async -> [HoldedLog] {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: .seconds(2))
    while clock.now < deadline {
        let logs = await holder.logs
        if !logs.isEmpty { return logs }
        await Task.yield()
    }
    return await holder.logs
}
