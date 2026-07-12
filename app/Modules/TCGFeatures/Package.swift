// swift-tools-version: 6.4
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "TCGFeatures",
    platforms: [.macOS(.v13), .iOS(.v16)],
    products: [
        .library(
            name: "TCGAuth",
            targets: ["TCGAuth"]
        )
    ],
    dependencies: [
        .package(path: "../TCGClient")
    ],
    targets: [
        .target(
            name: "TCGAuth",
            dependencies: [
                "TCGClient"
            ],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ],
        ),
        .testTarget(
            name: "TCGAuthTests",
            dependencies: ["TCGAuth"],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ],
        ),
    ]
)
