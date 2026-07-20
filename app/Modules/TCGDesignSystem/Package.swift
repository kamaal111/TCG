// swift-tools-version: 6.4
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "TCGDesignSystem",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [
        .library(name: "TCGDesignSystem", targets: ["TCGDesignSystem"])
    ],
    dependencies: [
        .package(url: "https://github.com/Kamaalio/KamaalSwift", .upToNextMajor(from: "3.5.0"))
    ],
    targets: [
        .target(
            name: "TCGDesignSystem",
            dependencies: [
                .product(name: "KamaalPopUp", package: "KamaalSwift"),
                .product(name: "KamaalUI", package: "KamaalSwift"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ],
        )
    ]
)
