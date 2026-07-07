import Foundation
import Testing
@testable import HorizonKit

private let nyc = TimeZone(identifier: "America/New_York")!
private let watch = "com.apple.health.device123"
private let phone = "com.apple.Health"
private let oura = "com.ouraring.oura"

private func t(_ iso: String) -> Date { ISO8601DateFormatter().date(from: iso)! }

@Suite("Normalizer quantities")
struct QuantityTests {

    @Test func cumulativeKeepsBestSourceNotSum() {
        // Watch counted 9000 steps, iPhone counted 6000 the same day: the day
        // total must be 9000 (max source), never 15000 (double count).
        let samples = [
            QuantitySample(kind: .stepCount, value: 5000, start: t("2026-07-06T13:00:00Z"), end: t("2026-07-06T14:00:00Z"), sourceBundleID: watch),
            QuantitySample(kind: .stepCount, value: 4000, start: t("2026-07-06T19:00:00Z"), end: t("2026-07-06T20:00:00Z"), sourceBundleID: watch),
            QuantitySample(kind: .stepCount, value: 6000, start: t("2026-07-06T15:00:00Z"), end: t("2026-07-06T16:00:00Z"), sourceBundleID: phone),
        ]
        let byDay = Normalizer.dailyQuantities(samples, kind: .stepCount, timeZone: nyc)
        #expect(byDay["2026-07-06"] == 9000)
    }

    @Test func discreteAveragesPreferredSource() {
        // Watch (rank 0) present alongside Oura (rank 2): use Watch only, averaged.
        let samples = [
            QuantitySample(kind: .hrvSDNNms, value: 60, start: t("2026-07-06T06:00:00Z"), end: t("2026-07-06T06:00:00Z"), sourceBundleID: watch),
            QuantitySample(kind: .hrvSDNNms, value: 70, start: t("2026-07-06T07:00:00Z"), end: t("2026-07-06T07:00:00Z"), sourceBundleID: watch),
            QuantitySample(kind: .hrvSDNNms, value: 100, start: t("2026-07-06T06:30:00Z"), end: t("2026-07-06T06:30:00Z"), sourceBundleID: oura),
        ]
        let byDay = Normalizer.dailyQuantities(samples, kind: .hrvSDNNms, timeZone: nyc)
        #expect(byDay["2026-07-06"] == 65)
    }

    @Test func discreteFallsBackToThirdPartyWhenAlone() {
        let samples = [
            QuantitySample(kind: .restingHeartRate, value: 52, start: t("2026-07-06T09:00:00Z"), end: t("2026-07-06T09:00:00Z"), sourceBundleID: oura)
        ]
        let byDay = Normalizer.dailyQuantities(samples, kind: .restingHeartRate, timeZone: nyc)
        #expect(byDay["2026-07-06"] == 52)
    }

    @Test func cumulativeAttributedToStartDateInLocalTime() {
        // Sample at 01:30 UTC on the 7th = evening of the 6th in NY.
        let samples = [
            QuantitySample(kind: .stepCount, value: 500, start: t("2026-07-07T01:30:00Z"), end: t("2026-07-07T01:45:00Z"), sourceBundleID: watch)
        ]
        let byDay = Normalizer.dailyQuantities(samples, kind: .stepCount, timeZone: nyc)
        #expect(byDay["2026-07-06"] == 500)
        #expect(byDay["2026-07-07"] == nil)
    }
}

@Suite("Normalizer sleep")
struct SleepTests {

    /// Overnight Mon→Tue: in bed 23:00–07:00 EDT (03:00–11:00 UTC), with stages.
    private var watchNight: [SleepSample] {
        [
            SleepSample(stage: .inBed, start: t("2026-07-07T03:00:00Z"), end: t("2026-07-07T11:00:00Z"), sourceBundleID: watch),
            SleepSample(stage: .asleepCore, start: t("2026-07-07T03:20:00Z"), end: t("2026-07-07T07:00:00Z"), sourceBundleID: watch),
            SleepSample(stage: .asleepDeep, start: t("2026-07-07T07:00:00Z"), end: t("2026-07-07T08:00:00Z"), sourceBundleID: watch),
            SleepSample(stage: .asleepREM, start: t("2026-07-07T08:00:00Z"), end: t("2026-07-07T09:30:00Z"), sourceBundleID: watch),
            SleepSample(stage: .awake, start: t("2026-07-07T09:30:00Z"), end: t("2026-07-07T09:50:00Z"), sourceBundleID: watch),
            SleepSample(stage: .asleepCore, start: t("2026-07-07T09:50:00Z"), end: t("2026-07-07T10:55:00Z"), sourceBundleID: watch),
        ]
    }

    @Test func nightAttributedToWakeDate() {
        let days = Normalizer.sleepDays(watchNight, timeZone: nyc)
        #expect(days.count == 1)
        #expect(days[0].localDate == "2026-07-07") // woke Tuesday morning NY time
    }

    @Test func stagesAggregateFromPrimarySourceOnly() {
        // Oura also recorded the night with a larger asleep total → Oura wins as
        // primary; Watch's stages must not blend in.
        let ouraNight = [
            SleepSample(stage: .asleepUnspecified, start: t("2026-07-07T02:50:00Z"), end: t("2026-07-07T11:05:00Z"), sourceBundleID: oura)
        ]
        let days = Normalizer.sleepDays(watchNight + ouraNight, timeZone: nyc)
        #expect(days.count == 1)
        let d = days[0]
        // Oura total: 495 min unspecified, no stage detail.
        #expect(d.totalMin == 495)
        #expect(d.deepMin == nil)
        #expect(d.remMin == nil)
    }

    @Test func watchStagesComputedCorrectly() {
        let days = Normalizer.sleepDays(watchNight, timeZone: nyc)
        let d = days[0]
        // Asleep: core 220 + 65, deep 60, rem 90 = 435; awake 20.
        #expect(d.totalMin == 435)
        #expect(d.deepMin == 60)
        #expect(d.remMin == 90)
        #expect(d.coreMin == 285)
        #expect(d.awakeMin == 20)
        #expect(d.inBedMin == 480) // explicit inBed sample 8h beats asleep+awake 455
        #expect(d.bedtimeAt == t("2026-07-07T03:00:00Z"))
        #expect(d.waketimeAt == t("2026-07-07T11:00:00Z"))
    }

    @Test func durationOnlySourceYieldsNilStages() {
        let ouraOnly = [
            SleepSample(stage: .asleepUnspecified, start: t("2026-07-07T03:00:00Z"), end: t("2026-07-07T10:00:00Z"), sourceBundleID: oura)
        ]
        let d = Normalizer.sleepDays(ouraOnly, timeZone: nyc)[0]
        #expect(d.totalMin == 420)
        #expect(d.deepMin == nil && d.remMin == nil && d.coreMin == nil)
        #expect(d.awakeMin == nil)
    }
}

@Suite("Normalizer workouts")
struct WorkoutTests {

    @Test func overlappingCrossSourceWorkoutDropped() {
        // Same run recorded by Watch and a third-party app: keep Watch's.
        let a = WorkoutSample(activityType: "running", start: t("2026-07-06T12:00:00Z"), end: t("2026-07-06T12:45:00Z"), activeKcal: 400, avgHeartRate: 150, distanceM: 7000, sourceBundleID: watch, syncIdentifier: "watch-1")
        let b = WorkoutSample(activityType: "running", start: t("2026-07-06T12:01:00Z"), end: t("2026-07-06T12:44:00Z"), activeKcal: 390, avgHeartRate: 149, distanceM: 6900, sourceBundleID: oura, syncIdentifier: "oura-1")
        let deduped = Normalizer.dedupedWorkouts([b, a])
        #expect(deduped.count == 1)
        #expect(deduped[0].syncIdentifier == "watch-1")
    }

    @Test func distinctWorkoutsBothKept() {
        let morning = WorkoutSample(activityType: "running", start: t("2026-07-06T12:00:00Z"), end: t("2026-07-06T12:45:00Z"), activeKcal: 400, avgHeartRate: 150, distanceM: 7000, sourceBundleID: watch, syncIdentifier: "w-1")
        let evening = WorkoutSample(activityType: "traditionalStrengthTraining", start: t("2026-07-06T22:00:00Z"), end: t("2026-07-06T23:00:00Z"), activeKcal: 250, avgHeartRate: 120, distanceM: nil, sourceBundleID: watch, syncIdentifier: "w-2")
        let deduped = Normalizer.dedupedWorkouts([evening, morning])
        #expect(deduped.count == 2)
        #expect(deduped[0].syncIdentifier == "w-1") // sorted by start
    }
}

@Suite("Normalizer assembly")
struct AssemblyTests {

    @Test func nutritionDaysNeverMarkedComplete() {
        let samples = [
            QuantitySample(kind: .dietaryEnergyKcal, value: 2200, start: t("2026-07-06T16:00:00Z"), end: t("2026-07-06T16:00:00Z"), sourceBundleID: phone),
            QuantitySample(kind: .dietaryProteinG, value: 140, start: t("2026-07-06T16:00:00Z"), end: t("2026-07-06T16:00:00Z"), sourceBundleID: phone),
        ]
        let days = Normalizer.nutritionDays(samples, timeZone: nyc)
        #expect(days.count == 1)
        #expect(days[0].caloriesKcal == 2200)
        #expect(days[0].proteinG == 140)
        #expect(days[0].carbsG == nil) // partial macro day preserved as partial
        #expect(days[0].isComplete == false)
    }

    @Test func bodyLatestSampleWins() {
        let samples = [
            QuantitySample(kind: .bodyMassKg, value: 80.0, start: t("2026-07-06T11:00:00Z"), end: t("2026-07-06T11:00:00Z"), sourceBundleID: phone),
            QuantitySample(kind: .bodyMassKg, value: 79.4, start: t("2026-07-06T21:00:00Z"), end: t("2026-07-06T21:00:00Z"), sourceBundleID: phone),
        ]
        let days = Normalizer.bodyDays(samples, timeZone: nyc)
        #expect(days.count == 1)
        #expect(days[0].weightKg == 79.4)
    }
}
