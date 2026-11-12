// swift-tools-version: 6.4
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "TCGApp",
    defaultLocalization: "en",
    platforms: [.macOS(.v15), .iOS(.v18)],
    products: [
        .library(name: "TCGApp", targets: ["TCGApp"])
    ],
    dependencies: [
        .package(url: "https://github.com/Kamaalio/kamaal-auth", .upToNextMinor(from: "0.1.1")),
        .package(path: "../TCGFeatures"),
        .package(path: "../TCGClient"),
        .package(path: "../TCGDesignSystem"),
    ],
    targets: [
        .target(
            name: "TCGApp",
            dependencies: [
                .product(name: "TCGCards", package: "TCGFeatures"),
                .product(name: "TCGCurrency", package: "TCGFeatures"),
                .product(name: "TCGSearch", package: "TCGFeatures"),
                .product(name: "TCGSettings", package: "TCGFeatures"),
                .product(name: "KamaalAuth", package: "kamaal-auth"),
                "TCGClient",
                "TCGDesignSystem",
            ],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ],
        ),
        .testTarget(name: "TCGAppTests", dependencies: ["TCGApp"]),
    ]
)
