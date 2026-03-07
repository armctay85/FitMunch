// swift-tools-version: 5.9
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "FitMunch",
    platforms: [
        .iOS(.v17)
    ],
    products: [
        .library(
            name: "FitMunch",
            targets: ["FitMunch"]),
    ],
    dependencies: [
        .package(url: "https://github.com/RevenueCat/purchases-ios-spm", from: "4.0.0"),
    ],
    targets: [
        .target(
            name: "FitMunch",
            dependencies: [
                .product(name: "RevenueCat", package: "purchases-ios-spm"),
            ]),
        .testTarget(
            name: "FitMunchTests",
            dependencies: ["FitMunch"]),
    ]
)