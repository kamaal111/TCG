// swift-tools-version: 6.4
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "TCGFeatures",
    defaultLocalization: "en",
    platforms: [.macOS(.v15), .iOS(.v18)],
    products: [
        .library(name: "TCGCurrency", targets: ["TCGCurrency"]),
        .library(name: "TCGCards", targets: ["TCGCards"]),
        .library(name: "TCGSearch", targets: ["TCGSearch"]),
        .library(name: "TCGSettings", targets: ["TCGSettings"]),
    ],
    dependencies: [
        .package(url: "https://github.com/gonzalezreal/textual", .upToNextMinor(from: "0.5.0")),
        .package(url: "https://github.com/Kamaalio/KamaalSwift", .upToNextMajor(from: "3.5.0")),
        .package(url: "https://github.com/apple/swift-http-types", .upToNextMajor(from: "1.8.0")),
        .package(url: "https://github.com/apple/swift-openapi-runtime", .upToNextMajor(from: "1.13.0")),
        .package(url: "https://github.com/pointfreeco/swift-snapshot-testing", .upToNextMajor(from: "1.19.6")),
        .package(url: "https://github.com/Kamaalio/kamaal-auth", .upToNextMinor(from: "0.0.15")),
        .package(path: "../TCGClient"),
        .package(path: "../TCGDesignSystem"),
        .package(path: "../TCGModels"),
        .package(path: "../TCGUtils"),
    ],
    targets: [
        .target(
            name: "TCGCurrency",
            dependencies: ["TCGClient", .product(name: "KamaalAuth", package: "kamaal-auth")],
            resources: [.process("Localizable.xcstrings")],
            swiftSettings: [.enableUpcomingFeature("ApproachableConcurrency"), .treatAllWarnings(as: .error)]
        ),
        .target(
            name: "TCGCardDetails",
            dependencies: ["TCGClient", "TCGDesignSystem", "TCGCurrency"],
            resources: [.process("Localizable.xcstrings")],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ]
        ),
        .target(
            name: "TCGCards",
            dependencies: [
                "TCGCurrency",
                .product(name: "KamaalUI", package: "KamaalSwift"),
                .product(name: "KamaalUtils", package: "KamaalSwift"),
                .product(name: "KamaalLogger", package: "KamaalSwift"),
                .product(name: "KamaalExtensions", package: "KamaalSwift"),
                "TCGDesignSystem",
                "TCGClient",
                "TCGModels",
                "TCGCardDetails",
                "TCGUtils",
            ],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ],
        ),
        .target(
            name: "TCGSearch",
            dependencies: [
                "TCGCurrency",
                .product(name: "Textual", package: "textual"),
                .product(name: "KamaalLogger", package: "KamaalSwift"),
                .product(name: "TCGDesignSystem", package: "TCGDesignSystem"),
                "TCGCardDetails",
                "TCGClient",
                "TCGModels",
            ],
            resources: [.process("Resources")],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ],
        ),
        .target(
            name: "TCGSettings",
            dependencies: [
                "TCGCurrency",
                .product(name: "KamaalAuth", package: "kamaal-auth"),
                "TCGCards",
                "TCGUtils",
            ],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ],
        ),
        .target(
            name: "TCGSnapshotTesting",
            dependencies: [
                .product(name: "SnapshotTesting", package: "swift-snapshot-testing"),
                "TCGUtils",
            ],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ],
        ),
        .testTarget(
            name: "TCGCurrencyTests",
            dependencies: [
                "TCGCurrency", "TCGClient", .product(name: "HTTPTypes", package: "swift-http-types"),
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "KamaalAuth", package: "kamaal-auth"),
            ],
            swiftSettings: [.enableUpcomingFeature("ApproachableConcurrency"), .treatAllWarnings(as: .error)]
        ),
        .testTarget(
            name: "TCGCardsTests",
            dependencies: [
                "TCGCurrency",
                .product(name: "KamaalAuth", package: "kamaal-auth"),
                .product(name: "HTTPTypes", package: "swift-http-types"),
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                "TCGCards",
                "TCGClient",
                "TCGDesignSystem",
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
                "TCGDesignSystem",
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
        .testTarget(
            name: "TCGSettingsTests",
            dependencies: [
                "TCGCurrency",
                "TCGClient",
                .product(name: "KamaalAuth", package: "kamaal-auth"),
                "TCGSettings",
                "TCGSnapshotTesting",
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
