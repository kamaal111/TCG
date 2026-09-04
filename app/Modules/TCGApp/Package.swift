// swift-tools-version: 6.4
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "TCGApp",
    defaultLocalization: "en",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [
        .library(name: "TCGApp", targets: ["TCGApp"])
    ],
    dependencies: [
        .package(url: "https://github.com/Kamaalio/kamaal-auth", .upToNextMinor(from: "0.0.9")),
        .package(path: "../TCGFeatures"),
        .package(path: "../TCGClient"),
    ],
    targets: [
        .target(
            name: "TCGApp",
            dependencies: [
                .product(name: "TCGCards", package: "TCGFeatures"),
                .product(name: "TCGSearch", package: "TCGFeatures"),
                .product(name: "KamaalAuth", package: "kamaal-auth"),
                "TCGClient",
            ],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ],
        )
    ]
)
