// swift-tools-version: 6.4
import PackageDescription

let package = Package(
    name: "MintomoDevportal",
    defaultLocalization: "en",
    platforms: [.macOS(.v15), .iOS(.v18)],
    products: [.library(name: "MintomoDevportal", targets: ["MintomoDevportal"])],
    dependencies: [
        .package(url: "https://github.com/apple/swift-http-types", .upToNextMajor(from: "1.8.0")),
        .package(url: "https://github.com/apple/swift-openapi-generator", .upToNextMajor(from: "1.14.0")),
        .package(url: "https://github.com/apple/swift-openapi-runtime", .upToNextMajor(from: "1.13.0")),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", .upToNextMajor(from: "1.3.2")),
        .package(url: "https://github.com/pointfreeco/swift-snapshot-testing", .upToNextMajor(from: "1.19.6")),
        .package(path: "../TCGFeatures"),
    ],
    targets: [
        .target(
            name: "MintomoDevportal",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
            ],
            resources: [.process("Localizable.xcstrings")],
            swiftSettings: [.enableUpcomingFeature("ApproachableConcurrency"), .treatAllWarnings(as: .error)],
            plugins: [.plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator")]
        ),
        .testTarget(
            name: "MintomoDevportalTests",
            dependencies: [
                "MintomoDevportal",
                .product(name: "HTTPTypes", package: "swift-http-types"),
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "TCGSnapshotTesting", package: "TCGFeatures"),
                .product(name: "SnapshotTesting", package: "swift-snapshot-testing"),
            ],
            exclude: ["__Snapshots__"],
            swiftSettings: [.enableUpcomingFeature("ApproachableConcurrency"), .treatAllWarnings(as: .error)]
        ),
    ]
)
