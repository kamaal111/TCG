// swift-tools-version: 6.4

import PackageDescription

let package = Package(
    name: "DefaultArgumentLint",
    platforms: [.macOS(.v15)],
    dependencies: [.package(url: "https://github.com/swiftlang/swift-syntax", exact: "604.0.0")],
    targets: [
        .executableTarget(
            name: "DefaultArgumentLint",
            dependencies: [
                .product(name: "SwiftParser", package: "swift-syntax"),
                .product(name: "SwiftSyntax", package: "swift-syntax"),
            ]
        ),
        .testTarget(name: "DefaultArgumentLintTests", dependencies: ["DefaultArgumentLint"]),
    ]
)
