import Foundation

// MARK: - Shared primitives

public enum MetricSource: String, Codable, Sendable, Equatable {
    case healthKit = "healthkit"
    case manual = "manual"
}

/// A user-timezone calendar date, e.g. "2026-07-06". The idempotency key
/// component for all daily aggregates.
public typealias LocalDate = String

// MARK: - Intermediate sample records (HealthKit-free)

/// Quantity types Horizon reads. Mirrors the HealthKit identifiers the app maps from,
/// without importing HealthKit so the engine stays pure and macOS-testable.
public enum QuantityKind: String, Codable, Sendable, CaseIterable {
    case stepCount
    case activeEnergyKcal
    case exerciseMinutes
    case restingHeartRate
    case hrvSDNNms
    case respiratoryRate
    case dietaryEnergyKcal
    case dietaryProteinG
    case dietaryCarbsG
    case dietaryFatG
    case dietaryWaterMl
    case bodyMassKg
    case bodyFatPercent

    /// Cumulative kinds are summed within a day; a single best source is chosen to
    /// avoid double counting (e.g. iPhone + Watch both writing steps).
    public var isCumulative: Bool {
        switch self {
        case .stepCount, .activeEnergyKcal, .exerciseMinutes,
             .dietaryEnergyKcal, .dietaryProteinG, .dietaryCarbsG,
             .dietaryFatG, .dietaryWaterMl:
            return true
        case .restingHeartRate, .hrvSDNNms, .respiratoryRate,
             .bodyMassKg, .bodyFatPercent:
            return false
        }
    }
}

public struct QuantitySample: Sendable, Equatable {
    public let kind: QuantityKind
    public let value: Double
    public let start: Date
    public let end: Date
    public let sourceBundleID: String

    public init(kind: QuantityKind, value: Double, start: Date, end: Date, sourceBundleID: String) {
        self.kind = kind
        self.value = value
        self.start = start
        self.end = end
        self.sourceBundleID = sourceBundleID
    }
}

public enum SleepStage: String, Codable, Sendable {
    case inBed
    case asleepUnspecified
    case asleepCore
    case asleepDeep
    case asleepREM
    case awake

    public var isAsleep: Bool {
        switch self {
        case .asleepUnspecified, .asleepCore, .asleepDeep, .asleepREM: return true
        case .inBed, .awake: return false
        }
    }
}

public struct SleepSample: Sendable, Equatable {
    public let stage: SleepStage
    public let start: Date
    public let end: Date
    public let sourceBundleID: String

    public init(stage: SleepStage, start: Date, end: Date, sourceBundleID: String) {
        self.stage = stage
        self.start = start
        self.end = end
        self.sourceBundleID = sourceBundleID
    }

    public var minutes: Double { end.timeIntervalSince(start) / 60 }
}

public struct WorkoutSample: Sendable, Equatable {
    public let activityType: String
    public let start: Date
    public let end: Date
    public let activeKcal: Double?
    public let avgHeartRate: Double?
    public let distanceM: Double?
    public let sourceBundleID: String
    public let syncIdentifier: String

    public init(activityType: String, start: Date, end: Date, activeKcal: Double?,
                avgHeartRate: Double?, distanceM: Double?, sourceBundleID: String,
                syncIdentifier: String) {
        self.activityType = activityType
        self.start = start
        self.end = end
        self.activeKcal = activeKcal
        self.avgHeartRate = avgHeartRate
        self.distanceM = distanceM
        self.sourceBundleID = sourceBundleID
        self.syncIdentifier = syncIdentifier
    }

    public var durationMin: Double { end.timeIntervalSince(start) / 60 }
}

// MARK: - Daily aggregates (what syncs to the backend)

public struct SleepDay: Codable, Sendable, Equatable {
    public var localDate: LocalDate
    public var totalMin: Int
    public var inBedMin: Int
    public var deepMin: Int?
    public var remMin: Int?
    public var coreMin: Int?
    public var awakeMin: Int?
    public var bedtimeAt: Date?
    public var waketimeAt: Date?
    public var source: MetricSource

    public init(localDate: LocalDate, totalMin: Int, inBedMin: Int, deepMin: Int?,
                remMin: Int?, coreMin: Int?, awakeMin: Int?, bedtimeAt: Date?,
                waketimeAt: Date?, source: MetricSource) {
        self.localDate = localDate
        self.totalMin = totalMin
        self.inBedMin = inBedMin
        self.deepMin = deepMin
        self.remMin = remMin
        self.coreMin = coreMin
        self.awakeMin = awakeMin
        self.bedtimeAt = bedtimeAt
        self.waketimeAt = waketimeAt
        self.source = source
    }
}

public struct VitalsDay: Codable, Sendable, Equatable {
    public var localDate: LocalDate
    public var restingHr: Double?
    public var hrvSdnnMs: Double?
    public var respiratoryRate: Double?
    public var source: MetricSource

    public init(localDate: LocalDate, restingHr: Double?, hrvSdnnMs: Double?,
                respiratoryRate: Double?, source: MetricSource) {
        self.localDate = localDate
        self.restingHr = restingHr
        self.hrvSdnnMs = hrvSdnnMs
        self.respiratoryRate = respiratoryRate
        self.source = source
    }
}

public struct ActivityDay: Codable, Sendable, Equatable {
    public var localDate: LocalDate
    public var steps: Int
    public var activeEnergyKcal: Double
    public var exerciseMin: Int
    public var source: MetricSource

    public init(localDate: LocalDate, steps: Int, activeEnergyKcal: Double,
                exerciseMin: Int, source: MetricSource) {
        self.localDate = localDate
        self.steps = steps
        self.activeEnergyKcal = activeEnergyKcal
        self.exerciseMin = exerciseMin
        self.source = source
    }
}

public struct NutritionDay: Codable, Sendable, Equatable {
    public var localDate: LocalDate
    public var caloriesKcal: Double?
    public var proteinG: Double?
    public var carbsG: Double?
    public var fatG: Double?
    public var waterMl: Double?
    public var source: MetricSource
    public var isComplete: Bool

    public init(localDate: LocalDate, caloriesKcal: Double?, proteinG: Double?,
                carbsG: Double?, fatG: Double?, waterMl: Double?,
                source: MetricSource, isComplete: Bool) {
        self.localDate = localDate
        self.caloriesKcal = caloriesKcal
        self.proteinG = proteinG
        self.carbsG = carbsG
        self.fatG = fatG
        self.waterMl = waterMl
        self.source = source
        self.isComplete = isComplete
    }
}

public struct BodyDay: Codable, Sendable, Equatable {
    public var localDate: LocalDate
    public var weightKg: Double?
    public var bodyFatPct: Double?
    public var source: MetricSource

    public init(localDate: LocalDate, weightKg: Double?, bodyFatPct: Double?, source: MetricSource) {
        self.localDate = localDate
        self.weightKg = weightKg
        self.bodyFatPct = bodyFatPct
        self.source = source
    }
}

public struct WorkoutRecord: Codable, Sendable, Equatable {
    public var syncIdentifier: String
    public var workoutType: String
    public var startAt: Date
    public var endAt: Date
    public var durationMin: Double
    public var activeKcal: Double?
    public var avgHr: Double?
    public var distanceM: Double?
    public var source: MetricSource

    public init(syncIdentifier: String, workoutType: String, startAt: Date, endAt: Date,
                durationMin: Double, activeKcal: Double?, avgHr: Double?,
                distanceM: Double?, source: MetricSource) {
        self.syncIdentifier = syncIdentifier
        self.workoutType = workoutType
        self.startAt = startAt
        self.endAt = endAt
        self.durationMin = durationMin
        self.activeKcal = activeKcal
        self.avgHr = avgHr
        self.distanceM = distanceM
        self.source = source
    }
}
