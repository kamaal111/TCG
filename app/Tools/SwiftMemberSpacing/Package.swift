// swift-tools-version: 6.4

import PackageDescription

let package = Package(
    name: "SwiftMemberSpacing",
    platforms: [.macOS(.v15)],
    products: [.executable(name: "swift-member-spacing", targets: ["SwiftMemberSpacing"])],
    dependencies: [
        .package(url: "https://github.com/swiftlang/swift-syntax", exact: "604.0.0")
    ],
    targets: [
        .executableTarget(
            name: "SwiftMemberSpacing",
            dependencies: [
                .product(name: "SwiftSyntax", package: "swift-syntax"),
                .product(name: "SwiftParser", package: "swift-syntax"),
            ]
        ),
        .testTarget(name: "SwiftMemberSpacingTests", dependencies: ["SwiftMemberSpacing"]),
    ]
)
