// swift-tools-version: 6.4
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "TCGImageLoading",
    platforms: [.macOS(.v15), .iOS(.v18)],
    products: [
        .library(name: "TCGImageLoading", targets: ["TCGImageLoading"])
    ],
    dependencies: [
        .package(url: "https://github.com/Kamaalio/KamaalSwift", .upToNextMajor(from: "3.6.0"))
    ],
    targets: [
        .target(
            name: "TCGImageLoading",
            dependencies: [
                .product(name: "KamaalLogger", package: "KamaalSwift"),
                .product(name: "KamaalUtils", package: "KamaalSwift"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ],
        ),
        .testTarget(
            name: "TCGImageLoadingTests",
            dependencies: ["TCGImageLoading"],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ],
        ),
    ]
)
