// swift-tools-version: 6.4
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "TCGDesignSystem",
    defaultLocalization: "en",
    platforms: [.macOS(.v15), .iOS(.v18)],
    products: [
        .library(name: "TCGDesignSystem", targets: ["TCGDesignSystem"])
    ],
    dependencies: [
        .package(url: "https://github.com/Kamaalio/KamaalSwift", .upToNextMajor(from: "3.5.0")),
        .package(url: "https://github.com/pointfreeco/swift-snapshot-testing", .upToNextMajor(from: "1.19.4")),
        .package(path: "../TCGModels"),
    ],
    targets: [
        .target(
            name: "TCGDesignSystem",
            dependencies: [
                .product(name: "KamaalPopUp", package: "KamaalSwift"),
                .product(name: "KamaalLogger", package: "KamaalSwift"),
                .product(name: "KamaalUI", package: "KamaalSwift"),
                "TCGModels",
            ],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ],
        ),
        .testTarget(
            name: "TCGDesignSystemTests",
            dependencies: [
                "TCGDesignSystem",
                .product(name: "SnapshotTesting", package: "swift-snapshot-testing"),
            ],
            exclude: ["__Snapshots__"],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ],
        ),
    ]
)
