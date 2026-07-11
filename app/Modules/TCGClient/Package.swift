// swift-tools-version: 6.4
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "TCGClient",
    platforms: [.macOS(.v13), .iOS(.v16)],
    products: [
        .library(
            name: "TCGClient",
            targets: ["TCGClient"]
        )
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", .upToNextMajor(from: "1.13.0")),
        .package(url: "https://github.com/apple/swift-http-types", .upToNextMajor(from: "1.6.0")),
        .package(url: "https://github.com/apple/swift-openapi-runtime", .upToNextMajor(from: "1.12.0")),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", .upToNextMajor(from: "1.3.1")),
        .package(url: "https://github.com/Kamaalio/KamaalSwift", .upToNextMajor(from: "3.5.0")),
        .package(path: "../TCGUtils"),
    ],
    targets: [
        .target(
            name: "TCGClient",
            dependencies: [
                .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "KamaalLogger", package: "KamaalSwift"),
                "TCGUtils",
            ],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ],
            plugins: [
                .plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator")
            ],
        ),
        .testTarget(
            name: "TCGClientTests",
            dependencies: [
                "TCGClient",
                .product(name: "HTTPTypes", package: "swift-http-types"),
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("ApproachableConcurrency"),
                .treatAllWarnings(as: .error),
            ],
        ),
    ]
)
