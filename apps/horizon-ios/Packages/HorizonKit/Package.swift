// swift-tools-version: 6.0
import PackageDescription

// Pure engine layer: value types + normalization logic, no HealthKit/UI/IO imports.
// Testable on macOS via `swift test` — the app target maps HKSamples into these types.
let package = Package(
    name: "HorizonKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "HorizonKit", targets: ["HorizonKit"])
    ],
    targets: [
        .target(name: "HorizonKit"),
        .testTarget(name: "HorizonKitTests", dependencies: ["HorizonKit"]),
    ]
)
