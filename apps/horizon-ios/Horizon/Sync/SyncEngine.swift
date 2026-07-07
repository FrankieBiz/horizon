import Foundation
import SwiftData
import HorizonKit

/// Local-first background sync: reads unsynced rows from SwiftData, pushes
/// per-domain batches to horizon-api's idempotent upsert endpoints, and stamps
/// syncedAt on success. Failures leave rows pending — retried on next refresh.
actor SyncEngine {

    private let container: ModelContainer
    private let api: APIClient
    private let auth: AuthService

    init(container: ModelContainer, api: APIClient, auth: AuthService) {
        self.container = container
        self.api = api
        self.auth = auth
    }

    struct UpsertResponse: Decodable { let upserted: Int }

    func pushPending() async throws {
        guard let token = await auth.accessToken else { throw ApiError.notAuthenticated }
        let ctx = ModelContext(container)
        ctx.autosaveEnabled = false
        let now = Date.now

        // Sleep
        let sleep = try ctx.fetch(FetchDescriptor<SleepDayRecord>(
            predicate: #Predicate { $0.syncedAt == nil }))
        if !sleep.isEmpty {
            let payload = sleep.map { r in
                SleepDay(localDate: r.localDate, totalMin: r.totalMin, inBedMin: r.inBedMin,
                         deepMin: r.deepMin, remMin: r.remMin, coreMin: r.coreMin,
                         awakeMin: r.awakeMin, bedtimeAt: r.bedtimeAt, waketimeAt: r.waketimeAt,
                         source: MetricSource(rawValue: r.source) ?? .healthKit)
            }
            let _: UpsertResponse = try await api.post("/v1/sync/sleep", body: ["days": payload], token: token)
            sleep.forEach { $0.syncedAt = now }
        }

        // Vitals
        let vitals = try ctx.fetch(FetchDescriptor<VitalsDayRecord>(
            predicate: #Predicate { $0.syncedAt == nil }))
        if !vitals.isEmpty {
            let payload = vitals.map { r in
                VitalsDay(localDate: r.localDate, restingHr: r.restingHr, hrvSdnnMs: r.hrvSdnnMs,
                          respiratoryRate: r.respiratoryRate,
                          source: MetricSource(rawValue: r.source) ?? .healthKit)
            }
            let _: UpsertResponse = try await api.post("/v1/sync/vitals", body: ["days": payload], token: token)
            vitals.forEach { $0.syncedAt = now }
        }

        // Activity
        let activity = try ctx.fetch(FetchDescriptor<ActivityDayRecord>(
            predicate: #Predicate { $0.syncedAt == nil }))
        if !activity.isEmpty {
            let payload = activity.map { r in
                ActivityDay(localDate: r.localDate, steps: r.steps,
                            activeEnergyKcal: r.activeEnergyKcal, exerciseMin: r.exerciseMin,
                            source: MetricSource(rawValue: r.source) ?? .healthKit)
            }
            let _: UpsertResponse = try await api.post("/v1/sync/activity", body: ["days": payload], token: token)
            activity.forEach { $0.syncedAt = now }
        }

        // Nutrition
        let nutrition = try ctx.fetch(FetchDescriptor<NutritionDayRecord>(
            predicate: #Predicate { $0.syncedAt == nil }))
        if !nutrition.isEmpty {
            let payload = nutrition.map { r in
                NutritionDay(localDate: r.localDate, caloriesKcal: r.caloriesKcal,
                             proteinG: r.proteinG, carbsG: r.carbsG, fatG: r.fatG,
                             waterMl: r.waterMl,
                             source: MetricSource(rawValue: r.source) ?? .healthKit,
                             isComplete: r.isComplete)
            }
            let _: UpsertResponse = try await api.post("/v1/sync/nutrition", body: ["days": payload], token: token)
            nutrition.forEach { $0.syncedAt = now }
        }

        // Body
        let body = try ctx.fetch(FetchDescriptor<BodyDayRecord>(
            predicate: #Predicate { $0.syncedAt == nil }))
        if !body.isEmpty {
            let payload = body.map { r in
                BodyDay(localDate: r.localDate, weightKg: r.weightKg,
                        bodyFatPct: r.bodyFatPct,
                        source: MetricSource(rawValue: r.source) ?? .healthKit)
            }
            let _: UpsertResponse = try await api.post("/v1/sync/body", body: ["days": payload], token: token)
            body.forEach { $0.syncedAt = now }
        }

        // Workouts
        let workouts = try ctx.fetch(FetchDescriptor<WorkoutRecordModel>(
            predicate: #Predicate { $0.syncedAt == nil }))
        if !workouts.isEmpty {
            let payload = workouts.map { r in
                WorkoutRecord(syncIdentifier: r.syncIdentifier, workoutType: r.workoutType,
                              startAt: r.startAt, endAt: r.endAt, durationMin: r.durationMin,
                              activeKcal: r.activeKcal, avgHr: r.avgHr, distanceM: r.distanceM,
                              source: MetricSource(rawValue: r.source) ?? .healthKit)
            }
            let _: UpsertResponse = try await api.post("/v1/sync/workouts", body: ["workouts": payload], token: token)
            workouts.forEach { $0.syncedAt = now }
        }

        // Habit logs
        struct HabitLogPayload: Encodable {
            let habitName: String
            let localDate: String
            let value: Double
            let completedAt: Date
            let timezone: String
        }
        let habitLogs = try ctx.fetch(FetchDescriptor<HabitLogModel>(
            predicate: #Predicate { $0.syncedAt == nil }))
        if !habitLogs.isEmpty {
            let payload = habitLogs.map { r in
                HabitLogPayload(habitName: r.habitName, localDate: r.localDate,
                                value: r.value, completedAt: r.completedAt, timezone: r.timezone)
            }
            let _: UpsertResponse = try await api.post("/v1/sync/habit-logs", body: ["logs": payload], token: token)
            habitLogs.forEach { $0.syncedAt = now }
        }

        // Weekly check-ins
        struct CheckinPayload: Encodable {
            let weekStart: String
            let energy: Int
            let soreness: Int
            let sleepQuality: Int
        }
        let checkins = try ctx.fetch(FetchDescriptor<WeeklyCheckinRecord>(
            predicate: #Predicate { $0.syncedAt == nil }))
        if !checkins.isEmpty {
            let payload = checkins.map { r in
                CheckinPayload(weekStart: r.weekStart, energy: r.energy,
                               soreness: r.soreness, sleepQuality: r.sleepQuality)
            }
            let _: UpsertResponse = try await api.post("/v1/sync/checkins", body: ["checkins": payload], token: token)
            checkins.forEach { $0.syncedAt = now }
        }

        // Biomarker panels
        struct PanelPayload: Encodable {
            struct Result: Encodable {
                let marker: String
                let value: Double
                let unit: String
                let refLow: Double?
                let refHigh: Double?
                let labFlag: String?
            }
            let clientId: String
            let drawnOn: String
            let labName: String
            let notes: String?
            let results: [Result]
        }
        let panels = try ctx.fetch(FetchDescriptor<BiomarkerPanelModel>(
            predicate: #Predicate { $0.syncedAt == nil }))
        if !panels.isEmpty {
            let payload = panels.map { p in
                PanelPayload(
                    clientId: p.localID, drawnOn: p.drawnOn, labName: p.labName, notes: p.notes,
                    results: (p.results ?? []).map {
                        PanelPayload.Result(marker: $0.marker, value: $0.value, unit: $0.unit,
                                            refLow: $0.refLow, refHigh: $0.refHigh, labFlag: $0.labFlag)
                    })
            }
            let _: UpsertResponse = try await api.post("/v1/biomarkers/panels", body: ["panels": payload], token: token)
            panels.forEach { $0.syncedAt = now }
        }

        try ctx.save()
    }
}
