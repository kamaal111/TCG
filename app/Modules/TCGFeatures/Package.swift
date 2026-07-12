// swift-tools-version: 6.4
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "TCGFeatures",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [
        .library(
            name: "TCGAuth",
            targets: ["TCGAuth"]
        )
    ],
    dependencies: [
        .package(url: "https://github.com/Kamaalio/KamaalSwift", .upToNextMajor(from: "3.5.0")),
        .package(path: "../TCGClient"),
    ],
    targets: [
        .target(
            name: "TCGAuth",
            dependencies: [
                .product(name: "KamaalUI", package: "KamaalSwift"),
                "TCGClient",
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
