// swift-tools-version: 6.4
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "TCGFeatures",
    defaultLocalization: "en",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [
        .library(name: "TCGCards", targets: ["TCGCards"]),
        .library(name: "TCGSearch", targets: ["TCGSearch"]),
    ],
    dependencies: [
        .package(url: "https://github.com/Kamaalio/KamaalSwift", .upToNextMajor(from: "3.5.0")),
        .package(url: "https://github.com/apple/swift-http-types", .upToNextMajor(from: "1.6.0")),
        .package(url: "https://github.com/apple/swift-openapi-runtime", .upToNextMajor(from: "1.12.0")),
        .package(url: "https://github.com/pointfreeco/swift-snapshot-testing", .upToNextMajor(from: "1.19.3")),
        .package(url: "https://github.com/Kamaalio/kamaal-auth", .upToNextMinor(from: "0.0.2")),
        .package(path: "../TCGClient"),
        .package(path: "../TCGDesignSystem"),
        .package(path: "../TCGModels"),
    ],
    targets: [
        .target(
            name: "TCGCards",
            dependencies: [
                .product(name: "KamaalUI", package: "KamaalSwift"),
                .product(name: "KamaalUtils", package: "KamaalSwift"),
                .product(name: "KamaalLogger", package: "KamaalSwift"),
                .product(name: "KamaalExtensions", package: "KamaalSwift"),
                "TCGDesignSystem",
                "TCGClient",
                "TCGModels",
            ],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ],
        ),
        .target(
            name: "TCGSearch",
            dependencies: [
                .product(name: "KamaalLogger", package: "KamaalSwift"),
                .product(name: "TCGDesignSystem", package: "TCGDesignSystem"),
                "TCGClient",
                "TCGModels",
            ],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ],
        ),
        .target(
            name: "TCGSnapshotTesting",
            dependencies: [
                .product(name: "SnapshotTesting", package: "swift-snapshot-testing")
            ],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ],
        ),
        .testTarget(
            name: "TCGCardsTests",
            dependencies: [
                .product(name: "KamaalAuth", package: "kamaal-auth"),
                "TCGCards",
                "TCGClient",
                "TCGSnapshotTesting",
                .product(name: "SnapshotTesting", package: "swift-snapshot-testing"),
            ],
            exclude: ["__Snapshots__"],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ],
        ),
        .testTarget(
            name: "TCGSearchTests",
            dependencies: [
                .product(name: "KamaalAuth", package: "kamaal-auth"),
                "TCGSearch",
                "TCGClient",
                "TCGSnapshotTesting",
                .product(name: "HTTPTypes", package: "swift-http-types"),
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
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
