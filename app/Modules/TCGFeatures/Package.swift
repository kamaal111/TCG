// swift-tools-version: 6.4
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "TCGFeatures",
    defaultLocalization: "en",
    platforms: [.macOS(.v15), .iOS(.v18)],
    products: [
        .library(name: "TCGSnapshotTesting", targets: ["TCGSnapshotTesting"]),
        .library(name: "TCGCurrency", targets: ["TCGCurrency"]),
        .library(name: "TCGCards", targets: ["TCGCards"]),
        .library(name: "TCGListSupport", targets: ["TCGListSupport"]),
        .library(name: "TCGSearch", targets: ["TCGSearch"]),
        .library(name: "TCGSets", targets: ["TCGSets"]),
        .library(name: "TCGSettings", targets: ["TCGSettings"]),
        .library(name: "TCGWishlist", targets: ["TCGWishlist"]),
    ],
    dependencies: [
        .package(url: "https://github.com/gonzalezreal/textual", .upToNextMinor(from: "0.5.0")),
        .package(url: "https://github.com/Kamaalio/KamaalSwift", .upToNextMajor(from: "3.6.0")),
        .package(url: "https://github.com/apple/swift-http-types", .upToNextMajor(from: "1.8.0")),
        .package(url: "https://github.com/apple/swift-openapi-runtime", .upToNextMajor(from: "1.13.4")),
        .package(url: "https://github.com/pointfreeco/swift-snapshot-testing", .upToNextMajor(from: "1.19.7")),
        .package(url: "https://github.com/Kamaalio/kamaal-auth", .upToNextMinor(from: "0.1.2")),
        .package(path: "../TCGClient"),
        .package(path: "../TCGDesignSystem"),
        .package(path: "../TCGModels"),
        .package(path: "../TCGUtils"),
    ],
    targets: [
        .target(
            name: "TCGListSupport",
            dependencies: ["TCGClient", .product(name: "KamaalExtensions", package: "KamaalSwift")]
        ),
        .target(
            name: "TCGCurrency",
            dependencies: [
                "TCGClient", .product(name: "KamaalAuth", package: "kamaal-auth"),
                .product(name: "KamaalLogger", package: "KamaalSwift"),
            ],
            resources: [.process("Localizable.xcstrings")],
            swiftSettings: [.enableUpcomingFeature("ApproachableConcurrency"), .treatAllWarnings(as: .error)]
        ),
        .target(
            name: "TCGCardDetails",
            dependencies: [
                .product(name: "KamaalUI", package: "KamaalSwift"), "TCGClient", "TCGDesignSystem", "TCGCurrency",
                "TCGWishlist",
            ],
            resources: [.process("Localizable.xcstrings")],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ]
        ),
        .target(
            name: "TCGCards",
            dependencies: [
                "TCGListSupport",
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
                .product(name: "KamaalExtensions", package: "KamaalSwift"),
                .product(name: "KamaalUI", package: "KamaalSwift"),
                "TCGListSupport",
                "TCGCurrency",
                .product(name: "Textual", package: "textual"),
                .product(name: "KamaalLogger", package: "KamaalSwift"),
                .product(name: "TCGDesignSystem", package: "TCGDesignSystem"),
                "TCGCardDetails",
                "TCGClient",
                "TCGModels",
                "TCGWishlist",
            ],
            resources: [.process("Resources")],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ],
        ),
        .target(
            name: "TCGSets",
            dependencies: ["TCGCardDetails", "TCGClient", "TCGDesignSystem", "TCGListSupport", "TCGModels"],
            resources: [.process("Localizable.xcstrings")],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ],
        ),
        .target(
            name: "TCGWishlist",
            dependencies: ["TCGClient", "TCGListSupport"],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ],
        ),
        .target(
            name: "TCGSettings",
            dependencies: [
                .product(name: "KamaalExtensions", package: "KamaalSwift"),
                .product(name: "KamaalUI", package: "KamaalSwift"),
                "TCGCurrency",
                .product(name: "KamaalAuth", package: "kamaal-auth"),
                .product(name: "KamaalLogger", package: "KamaalSwift"),
                "TCGCards",
                "TCGDesignSystem",
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
                .product(name: "KamaalLogger", package: "KamaalSwift"),
            ],
            swiftSettings: [.enableUpcomingFeature("ApproachableConcurrency"), .treatAllWarnings(as: .error)]
        ),
        .testTarget(
            name: "TCGCardsTests",
            dependencies: [
                .product(name: "KamaalLogger", package: "KamaalSwift"),
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
                .product(name: "KamaalLogger", package: "KamaalSwift"),
                "TCGCurrency",
                .product(name: "KamaalAuth", package: "kamaal-auth"),
                "TCGSearch",
                "TCGCardDetails",
                "TCGClient",
                "TCGDesignSystem",
                "TCGListSupport",
                "TCGSnapshotTesting",
                "TCGWishlist",
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
            name: "TCGSetsTests",
            dependencies: ["TCGSets", "TCGClient", "TCGDesignSystem", "TCGListSupport", "TCGSnapshotTesting"],
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
                .product(name: "KamaalLogger", package: "KamaalSwift"),
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
