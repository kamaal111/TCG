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
        .package(path: "../TCGFeatures")
    ],
    targets: [
        .target(
            name: "TCGApp",
            dependencies: [
                .product(name: "TCGAuth", package: "TCGFeatures"),
                .product(name: "TCGCards", package: "TCGFeatures"),
                .product(name: "TCGSearch", package: "TCGFeatures"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ],
        )
    ]
)
