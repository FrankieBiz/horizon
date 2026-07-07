import Foundation
import SwiftData
import HorizonKit

// MARK: - SwiftData models (local-first mirror of the server schema)
// Every record carries `syncedAt` — nil means pending upload. Upserts are keyed
// on localDate (daily domains) or syncIdentifier (workouts), matching the
// server's idempotency keys. Manual entries overwrite HealthKit rows locally,
// mirroring the server conflict rule; HealthKit never overwrites manual.

@Model final class SleepDayRecord {
    #Unique<SleepDayRecord>([\.localDate])
    var localDate: String = ""
    var totalMin: Int = 0
    var inBedMin: Int = 0
    var deepMin: Int?
    var remMin: Int?
    var coreMin: Int?
    var awakeMin: Int?
    var bedtimeAt: Date?
    var waketimeAt: Date?
    var source: String = "healthkit"
    var syncedAt: Date?

    init() {}
}

@Model final class VitalsDayRecord {
    #Unique<VitalsDayRecord>([\.localDate])
    var localDate: String = ""
    var restingHr: Double?
    var hrvSdnnMs: Double?
    var respiratoryRate: Double?
    var source: String = "healthkit"
    var syncedAt: Date?

    init() {}
}

@Model final class ActivityDayRecord {
    #Unique<ActivityDayRecord>([\.localDate])
    var localDate: String = ""
    var steps: Int = 0
    var activeEnergyKcal: Double = 0
    var exerciseMin: Int = 0
    var source: String = "healthkit"
    var syncedAt: Date?

    init() {}
}

@Model final class NutritionDayRecord {
    #Unique<NutritionDayRecord>([\.localDate])
    var localDate: String = ""
    var caloriesKcal: Double?
    var proteinG: Double?
    var carbsG: Double?
    var fatG: Double?
    var waterMl: Double?
    var source: String = "healthkit"
    var isComplete: Bool = false
    var syncedAt: Date?

    init() {}
}

@Model final class BodyDayRecord {
    #Unique<BodyDayRecord>([\.localDate])
    var localDate: String = ""
    var weightKg: Double?
    var bodyFatPct: Double?
    var source: String = "healthkit"
    var syncedAt: Date?

    init() {}
}

@Model final class WorkoutRecordModel {
    #Unique<WorkoutRecordModel>([\.syncIdentifier])
    var syncIdentifier: String = ""
    var workoutType: String = ""
    var startAt: Date = Date.distantPast
    var endAt: Date = Date.distantPast
    var durationMin: Double = 0
    var activeKcal: Double?
    var avgHr: Double?
    var distanceM: Double?
    var source: String = "healthkit"
    var syncedAt: Date?

    init() {}
}

@Model final class HabitModel {
    var name: String = ""
    var kind: String = "habit" // habit | supplement
    var frequencyType: String = "daily"
    var freqNumerator: Int = 1
    var freqDenominator: Int = 1
    var weekdayMask: Int = 0
    var doseAmount: Double?
    var doseUnit: String?
    var timingOfDay: String?
    var createdAt: Date = Date.now
    var serverID: String?
    var syncedAt: Date?

    init() {}
}

@Model final class HabitLogModel {
    var habitName: String = ""
    var localDate: String = ""
    var value: Double = 1
    var completedAt: Date = Date.now
    var timezone: String = TimeZone.current.identifier
    var syncedAt: Date?

    init() {}
}

@Model final class BiomarkerPanelModel {
    var localID: String = UUID().uuidString
    var drawnOn: String = "" // LocalDate
    var labName: String = ""
    var notes: String?
    var serverID: String?
    var syncedAt: Date?
    @Relationship(deleteRule: .cascade) var results: [BiomarkerResultModel]? = []

    init() {}
}

@Model final class BiomarkerResultModel {
    var marker: String = ""
    var value: Double = 0
    var unit: String = ""
    var refLow: Double?
    var refHigh: Double?
    var labFlag: String?

    init() {}
}

@Model final class WeeklyCheckinRecord {
    #Unique<WeeklyCheckinRecord>([\.weekStart])
    var weekStart: String = ""
    var energy: Int = 3
    var soreness: Int = 3
    var sleepQuality: Int = 3
    var createdAt: Date = Date.now
    var syncedAt: Date?

    init() {}
}

/// Cache of the latest fetched weekly review for offline display.
@Model final class WeeklySummaryCache {
    #Unique<WeeklySummaryCache>([\.weekStart])
    var weekStart: String = ""
    var coachMessage: String = ""
    var payloadJSON: Data = Data()
    var fetchedAt: Date = Date.now

    init() {}
}

// MARK: - Store facade

struct LocalStore {
    static let models: [any PersistentModel.Type] = [
        SleepDayRecord.self, VitalsDayRecord.self, ActivityDayRecord.self,
        NutritionDayRecord.self, BodyDayRecord.self, WorkoutRecordModel.self,
        HabitModel.self, HabitLogModel.self,
        BiomarkerPanelModel.self, BiomarkerResultModel.self,
        WeeklyCheckinRecord.self, WeeklySummaryCache.self,
    ]

    let container: ModelContainer

    /// Upsert normalized HealthKit aggregates. Runs on a background context.
    /// Rule: healthkit data never overwrites a manual row.
    func upsert(sleep: [SleepDay], vitals: [VitalsDay], activity: [ActivityDay],
                nutrition: [NutritionDay], body: [BodyDay],
                workouts: [WorkoutRecord]) async throws {
        let ctx = ModelContext(container)
        ctx.autosaveEnabled = false

        for day in sleep {
            let key = day.localDate
            let existing = try ctx.fetch(FetchDescriptor<SleepDayRecord>(
                predicate: #Predicate { $0.localDate == key })).first
            if let existing, existing.source == "manual" { continue }
            let rec = existing ?? SleepDayRecord()
            rec.localDate = day.localDate
            rec.totalMin = day.totalMin
            rec.inBedMin = day.inBedMin
            rec.deepMin = day.deepMin
            rec.remMin = day.remMin
            rec.coreMin = day.coreMin
            rec.awakeMin = day.awakeMin
            rec.bedtimeAt = day.bedtimeAt
            rec.waketimeAt = day.waketimeAt
            rec.source = day.source.rawValue
            rec.syncedAt = nil
            if existing == nil { ctx.insert(rec) }
        }

        for day in vitals {
            let key = day.localDate
            let existing = try ctx.fetch(FetchDescriptor<VitalsDayRecord>(
                predicate: #Predicate { $0.localDate == key })).first
            if let existing, existing.source == "manual" { continue }
            let rec = existing ?? VitalsDayRecord()
            rec.localDate = day.localDate
            rec.restingHr = day.restingHr
            rec.hrvSdnnMs = day.hrvSdnnMs
            rec.respiratoryRate = day.respiratoryRate
            rec.source = day.source.rawValue
            rec.syncedAt = nil
            if existing == nil { ctx.insert(rec) }
        }

        for day in activity {
            let key = day.localDate
            let existing = try ctx.fetch(FetchDescriptor<ActivityDayRecord>(
                predicate: #Predicate { $0.localDate == key })).first
            if let existing, existing.source == "manual" { continue }
            let rec = existing ?? ActivityDayRecord()
            rec.localDate = day.localDate
            rec.steps = day.steps
            rec.activeEnergyKcal = day.activeEnergyKcal
            rec.exerciseMin = day.exerciseMin
            rec.source = day.source.rawValue
            rec.syncedAt = nil
            if existing == nil { ctx.insert(rec) }
        }

        for day in nutrition {
            let key = day.localDate
            let existing = try ctx.fetch(FetchDescriptor<NutritionDayRecord>(
                predicate: #Predicate { $0.localDate == key })).first
            if let existing, existing.source == "manual" { continue }
            let rec = existing ?? NutritionDayRecord()
            rec.localDate = day.localDate
            rec.caloriesKcal = day.caloriesKcal
            rec.proteinG = day.proteinG
            rec.carbsG = day.carbsG
            rec.fatG = day.fatG
            rec.waterMl = day.waterMl
            rec.source = day.source.rawValue
            rec.isComplete = day.isComplete
            rec.syncedAt = nil
            if existing == nil { ctx.insert(rec) }
        }

        for day in body {
            let key = day.localDate
            let existing = try ctx.fetch(FetchDescriptor<BodyDayRecord>(
                predicate: #Predicate { $0.localDate == key })).first
            if let existing, existing.source == "manual" { continue }
            let rec = existing ?? BodyDayRecord()
            rec.localDate = day.localDate
            rec.weightKg = day.weightKg
            rec.bodyFatPct = day.bodyFatPct
            rec.source = day.source.rawValue
            rec.syncedAt = nil
            if existing == nil { ctx.insert(rec) }
        }

        for w in workouts {
            let key = w.syncIdentifier
            let existing = try ctx.fetch(FetchDescriptor<WorkoutRecordModel>(
                predicate: #Predicate { $0.syncIdentifier == key })).first
            let rec = existing ?? WorkoutRecordModel()
            rec.syncIdentifier = w.syncIdentifier
            rec.workoutType = w.workoutType
            rec.startAt = w.startAt
            rec.endAt = w.endAt
            rec.durationMin = w.durationMin
            rec.activeKcal = w.activeKcal
            rec.avgHr = w.avgHr
            rec.distanceM = w.distanceM
            rec.source = w.source.rawValue
            rec.syncedAt = nil
            if existing == nil { ctx.insert(rec) }
        }

        try ctx.save()
    }
}
