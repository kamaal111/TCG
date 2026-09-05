// swift-tools-version: 6.4
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "TCGModels",
    defaultLocalization: "en",
    platforms: [.macOS(.v15), .iOS(.v18)],
    products: [
        .library(name: "TCGModels", targets: ["TCGModels"])
    ],
    dependencies: [
        .package(path: "../TCGClient")
    ],
    targets: [
        .target(
            name: "TCGModels",
            dependencies: [
                "TCGClient"
            ],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ],
        )
    ]
)
