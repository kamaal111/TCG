// swift-tools-version: 6.4
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "TCGApp",
    products: [
        .library(name: "TCGApp", targets: ["TCGApp"])
    ],
    dependencies: [
        .package(path: "../TCGClient")
    ],
    targets: [
        .target(
            name: "TCGApp",
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
