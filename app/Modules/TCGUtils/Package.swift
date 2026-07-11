// swift-tools-version: 6.4
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "TCGUtils",
    products: [
        .library(
            name: "TCGUtils",
            targets: ["TCGUtils"]
        )
    ],
    targets: [
        .target(
            name: "TCGUtils",
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ],
        ),
        .testTarget(
            name: "TCGUtilsTests",
            dependencies: ["TCGUtils"],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ],
        ),
    ]
)
