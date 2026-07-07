import Foundation
import HealthKit
import HorizonKit

/// HealthKit ingestion, per the researched integration plan (prep spec §6):
/// - Anchored object queries: nil anchor for the historical import, persisted
///   anchors for incremental sync. Anchors are committed only AFTER the batch
///   is safely stored locally, so a crash mid-pipeline never loses samples.
/// - Observer queries + background delivery wake the app when sources write.
/// - Read-denial is deliberately unknowable: no "you denied access" UX exists
///   anywhere; absence of data renders as empty state.
/// - Cross-source dedup happens downstream in HorizonKit.Normalizer.
@MainActor
final class HealthKitService {

    private let store = HKHealthStore()
    private var observersStarted = false

    // MARK: Type sets

    private static let quantityTypes: [(HKQuantityTypeIdentifier, QuantityKind, HKUnit)] = [
        (.stepCount, .stepCount, .count()),
        (.activeEnergyBurned, .activeEnergyKcal, .kilocalorie()),
        (.appleExerciseTime, .exerciseMinutes, .minute()),
        (.restingHeartRate, .restingHeartRate, HKUnit.count().unitDivided(by: .minute())),
        (.heartRateVariabilitySDNN, .hrvSDNNms, .secondUnit(with: .milli)),
        (.respiratoryRate, .respiratoryRate, HKUnit.count().unitDivided(by: .minute())),
        (.dietaryEnergyConsumed, .dietaryEnergyKcal, .kilocalorie()),
        (.dietaryProtein, .dietaryProteinG, .gram()),
        (.dietaryCarbohydrates, .dietaryCarbsG, .gram()),
        (.dietaryFatTotal, .dietaryFatG, .gram()),
        (.dietaryWater, .dietaryWaterMl, .literUnit(with: .milli)),
        (.bodyMass, .bodyMassKg, .gramUnit(with: .kilo)),
        (.bodyFatPercentage, .bodyFatPercent, .percent()),
    ]

    private var readTypes: Set<HKObjectType> {
        var types: Set<HKObjectType> = [
            HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!,
            HKObjectType.workoutType(),
        ]
        for (id, _, _) in Self.quantityTypes {
            types.insert(HKObjectType.quantityType(forIdentifier: id)!)
        }
        return types
    }

    var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    // MARK: Authorization

    func requestAuthorization() async throws {
        guard isAvailable else { return }
        try await store.requestAuthorization(toShare: [], read: readTypes)
    }

    // MARK: Fetch

    struct SampleBatch {
        var quantities: [QuantitySample] = []
        var sleep: [SleepSample] = []
        var workouts: [WorkoutSample] = []
        /// New anchors keyed by identifier — persisted only after local save succeeds.
        var pendingAnchors: [String: HKQueryAnchor] = [:]
    }

    /// Historical window for the very first import.
    static let initialImportDays = 90

    /// Fetch everything new since the persisted anchors (or the initial window
    /// on first run) across all types. Anchors are NOT persisted here — call
    /// commitAnchors(from:) after the batch is stored locally.
    func fetchNewSamples() async throws -> SampleBatch {
        guard isAvailable else { return SampleBatch() }
        var batch = SampleBatch()

        // Quantities
        for (id, kind, unit) in Self.quantityTypes {
            let type = HKQuantityType.quantityType(forIdentifier: id)!
            let (samples, newAnchor) = try await anchoredFetch(type: type, anchorKey: id.rawValue)
            for s in samples.compactMap({ $0 as? HKQuantitySample }) {
                let value: Double
                if kind == .bodyFatPercent {
                    value = s.quantity.doubleValue(for: unit) * 100 // HK percent is 0…1
                } else {
                    value = s.quantity.doubleValue(for: unit)
                }
                batch.quantities.append(QuantitySample(
                    kind: kind, value: value, start: s.startDate, end: s.endDate,
                    sourceBundleID: s.sourceRevision.source.bundleIdentifier))
            }
            if let newAnchor { batch.pendingAnchors[id.rawValue] = newAnchor }
        }

        // Sleep
        let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis)!
        let (sleepSamples, sleepAnchor) = try await anchoredFetch(type: sleepType, anchorKey: "sleepAnalysis")
        for s in sleepSamples.compactMap({ $0 as? HKCategorySample }) {
            guard let stage = Self.sleepStage(from: s.value) else { continue }
            batch.sleep.append(SleepSample(
                stage: stage, start: s.startDate, end: s.endDate,
                sourceBundleID: s.sourceRevision.source.bundleIdentifier))
        }
        if let sleepAnchor { batch.pendingAnchors["sleepAnalysis"] = sleepAnchor }

        // Workouts
        let workoutType = HKObjectType.workoutType()
        let (workoutSamples, workoutAnchor) = try await anchoredFetch(type: workoutType, anchorKey: "workouts")
        for w in workoutSamples.compactMap({ $0 as? HKWorkout }) {
            let energy = w.statistics(for: HKQuantityType(.activeEnergyBurned))?
                .sumQuantity()?.doubleValue(for: .kilocalorie())
            let avgHR = w.statistics(for: HKQuantityType(.heartRate))?
                .averageQuantity()?.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
            let distance = w.statistics(for: HKQuantityType(.distanceWalkingRunning))?
                .sumQuantity()?.doubleValue(for: .meter())
            let syncID = (w.metadata?[HKMetadataKeySyncIdentifier] as? String) ?? w.uuid.uuidString
            batch.workouts.append(WorkoutSample(
                activityType: Self.workoutName(w.workoutActivityType),
                start: w.startDate, end: w.endDate,
                activeKcal: energy, avgHeartRate: avgHR, distanceM: distance,
                sourceBundleID: w.sourceRevision.source.bundleIdentifier,
                syncIdentifier: syncID))
        }
        if let workoutAnchor { batch.pendingAnchors["workouts"] = workoutAnchor }

        return batch
    }

    /// Persist the batch's anchors after its samples are safely stored.
    func commitAnchors(from batch: SampleBatch) {
        for (key, anchor) in batch.pendingAnchors { Self.persistAnchor(anchor, key: key) }
    }

    private func anchoredFetch(
        type: HKSampleType, anchorKey: String
    ) async throws -> ([HKSample], HKQueryAnchor?) {
        let anchor = Self.loadAnchor(key: anchorKey)
        // First run: bound the historical import window; incremental runs are
        // bounded by the anchor itself.
        let predicate: NSPredicate? = anchor == nil
            ? HKQuery.predicateForSamples(
                withStart: Calendar.current.date(byAdding: .day, value: -Self.initialImportDays, to: .now),
                end: nil)
            : nil

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKAnchoredObjectQuery(
                type: type, predicate: predicate, anchor: anchor,
                limit: HKObjectQueryNoLimit
            ) { _, samples, _, newAnchor, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: (samples ?? [], newAnchor)) }
            }
            store.execute(query)
        }
    }

    // MARK: Background delivery

    /// Observer queries must be registered at every launch, before iOS delivers
    /// pending background updates. The completion handler MUST be called or
    /// HealthKit stops delivering after 3 misses.
    func startObservers(onUpdate: @escaping @Sendable () async -> Void) {
        guard isAvailable, !observersStarted else { return }
        observersStarted = true

        for type in readTypes.compactMap({ $0 as? HKSampleType }) {
            let query = HKObserverQuery(sampleType: type, predicate: nil) { _, completionHandler, error in
                guard error == nil else { completionHandler(); return }
                Task {
                    await onUpdate()
                    completionHandler()
                }
            }
            store.execute(query)
            store.enableBackgroundDelivery(for: type, frequency: .hourly) { _, _ in }
        }
    }

    // MARK: Anchor persistence

    private static func anchorDefaultsKey(_ key: String) -> String { "horizon.hkanchor.\(key)" }

    private static func loadAnchor(key: String) -> HKQueryAnchor? {
        guard let data = UserDefaults.standard.data(forKey: anchorDefaultsKey(key)) else { return nil }
        return try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
    }

    private static func persistAnchor(_ anchor: HKQueryAnchor, key: String) {
        guard let data = try? NSKeyedArchiver.archivedData(
            withRootObject: anchor, requiringSecureCoding: true) else { return }
        UserDefaults.standard.set(data, forKey: anchorDefaultsKey(key))
    }

    // MARK: Mapping

    private static func sleepStage(from value: Int) -> SleepStage? {
        switch HKCategoryValueSleepAnalysis(rawValue: value) {
        case .inBed: return .inBed
        case .asleepUnspecified: return .asleepUnspecified
        case .asleepCore: return .asleepCore
        case .asleepDeep: return .asleepDeep
        case .asleepREM: return .asleepREM
        case .awake: return .awake
        default: return nil
        }
    }

    private static func workoutName(_ type: HKWorkoutActivityType) -> String {
        switch type {
        case .running: return "running"
        case .walking: return "walking"
        case .cycling: return "cycling"
        case .swimming: return "swimming"
        case .traditionalStrengthTraining: return "strength_training"
        case .functionalStrengthTraining: return "functional_training"
        case .highIntensityIntervalTraining: return "hiit"
        case .yoga: return "yoga"
        case .rowing: return "rowing"
        case .hiking: return "hiking"
        case .elliptical: return "elliptical"
        case .stairClimbing: return "stair_climbing"
        case .pilates: return "pilates"
        case .coreTraining: return "core_training"
        case .soccer: return "soccer"
        case .basketball: return "basketball"
        case .tennis: return "tennis"
        case .golf: return "golf"
        case .boxing: return "boxing"
        case .martialArts: return "martial_arts"
        default: return "other_\(type.rawValue)"
        }
    }
}
