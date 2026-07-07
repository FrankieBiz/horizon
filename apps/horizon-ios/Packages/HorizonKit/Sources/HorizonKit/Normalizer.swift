import Foundation

/// Collapses raw samples into one-row-per-day aggregates, handling the
/// cross-source duplication HealthKit deliberately does not resolve
/// (e.g. iPhone + Watch both writing steps, Watch + Oura both writing sleep).
///
/// Strategy (prep spec §3/§6):
/// - Cumulative quantities: per day, total each source separately and keep the
///   single source with the largest total — never sum across sources.
/// - Discrete quantities: prefer the highest-priority source present; average
///   its values for the day.
/// - Sleep: attribute each sample to the LocalDate of its END (a night belongs
///   to the morning it ends on); pick the primary source per night by most
///   asleep minutes; aggregate only that source.
/// - Workouts: drop a workout that overlaps ≥ 80% (of the shorter one) with an
///   already-kept, higher-priority workout.
public enum Normalizer {

    /// Lower rank = higher priority. Apple first-party (Watch/iPhone Health)
    /// beats third-party writers, which beat unknowns.
    public static func sourceRank(_ bundleID: String) -> Int {
        if bundleID.hasPrefix("com.apple.health") { return 0 } // Watch/Health app writers
        if bundleID.hasPrefix("com.apple.") { return 1 }
        return 2
    }

    // MARK: Quantities

    /// Group quantity samples into per-day values for a single kind.
    public static func dailyQuantities(
        _ samples: [QuantitySample],
        kind: QuantityKind,
        timeZone: TimeZone
    ) -> [LocalDate: Double] {
        let relevant = samples.filter { $0.kind == kind }
        guard !relevant.isEmpty else { return [:] }

        var byDay: [LocalDate: [QuantitySample]] = [:]
        for s in relevant {
            // Cumulative samples are attributed to their start date (a step chunk
            // belongs to the day it happened); discrete overnight measurements
            // (RHR/HRV measured during sleep) to their end date.
            let anchor = kind.isCumulative ? s.start : s.end
            byDay[HorizonDates.localDate(from: anchor, timeZone: timeZone), default: []].append(s)
        }

        var result: [LocalDate: Double] = [:]
        for (day, daySamples) in byDay {
            if kind.isCumulative {
                // Sum per source, keep the max-total source.
                var totals: [String: Double] = [:]
                for s in daySamples { totals[s.sourceBundleID, default: 0] += s.value }
                if let best = totals.values.max() { result[day] = best }
            } else {
                // Prefer best-ranked source present; average its samples.
                let bestRank = daySamples.map { sourceRank($0.sourceBundleID) }.min()!
                let preferred = daySamples.filter { sourceRank($0.sourceBundleID) == bestRank }
                result[day] = preferred.map(\.value).reduce(0, +) / Double(preferred.count)
            }
        }
        return result
    }

    // MARK: Sleep

    public static func sleepDays(_ samples: [SleepSample], timeZone: TimeZone) -> [SleepDay] {
        var byDay: [LocalDate: [SleepSample]] = [:]
        for s in samples {
            byDay[HorizonDates.localDate(from: s.end, timeZone: timeZone), default: []].append(s)
        }

        var days: [SleepDay] = []
        for (day, daySamples) in byDay {
            // Primary source = most asleep minutes that night; ties broken by rank.
            var asleepBySource: [String: Double] = [:]
            for s in daySamples where s.stage.isAsleep {
                asleepBySource[s.sourceBundleID, default: 0] += s.minutes
            }
            // A day with only inBed/awake samples still needs a source pick.
            let candidates = asleepBySource.isEmpty
                ? Dictionary(grouping: daySamples, by: \.sourceBundleID).mapValues { _ in 0.0 }
                : asleepBySource
            guard let primary = candidates.max(by: { (a, b) in
                a.value != b.value ? a.value < b.value
                                   : sourceRank(a.key) > sourceRank(b.key)
            })?.key else { continue }

            let primarySamples = daySamples.filter { $0.sourceBundleID == primary }

            func stageMinutes(_ stage: SleepStage) -> Double {
                primarySamples.filter { $0.stage == stage }.map(\.minutes).reduce(0, +)
            }

            let asleep = primarySamples.filter { $0.stage.isAsleep }
            let totalAsleep = asleep.map(\.minutes).reduce(0, +)
            let explicitInBed = stageMinutes(.inBed)
            let hasStages = primarySamples.contains {
                [.asleepCore, .asleepDeep, .asleepREM].contains($0.stage)
            }

            let sessionSamples = primarySamples.filter { $0.stage != .awake || true }
            let bedtime = sessionSamples.map(\.start).min()
            let waketime = sessionSamples.map(\.end).max()

            days.append(SleepDay(
                localDate: day,
                totalMin: Int(totalAsleep.rounded()),
                inBedMin: Int(max(explicitInBed, totalAsleep + stageMinutes(.awake)).rounded()),
                deepMin: hasStages ? Int(stageMinutes(.asleepDeep).rounded()) : nil,
                remMin: hasStages ? Int(stageMinutes(.asleepREM).rounded()) : nil,
                coreMin: hasStages ? Int(stageMinutes(.asleepCore).rounded()) : nil,
                awakeMin: primarySamples.contains(where: { $0.stage == .awake })
                    ? Int(stageMinutes(.awake).rounded()) : nil,
                bedtimeAt: bedtime,
                waketimeAt: waketime,
                source: .healthKit
            ))
        }
        return days.sorted { $0.localDate < $1.localDate }
    }

    // MARK: Vitals / Activity / Nutrition / Body assembly

    public static func vitalsDays(_ samples: [QuantitySample], timeZone: TimeZone) -> [VitalsDay] {
        let rhr = dailyQuantities(samples, kind: .restingHeartRate, timeZone: timeZone)
        let hrv = dailyQuantities(samples, kind: .hrvSDNNms, timeZone: timeZone)
        let rr = dailyQuantities(samples, kind: .respiratoryRate, timeZone: timeZone)
        let allDays = Set(rhr.keys).union(hrv.keys).union(rr.keys)
        return allDays.sorted().map {
            VitalsDay(localDate: $0, restingHr: rhr[$0], hrvSdnnMs: hrv[$0],
                      respiratoryRate: rr[$0], source: .healthKit)
        }
    }

    public static func activityDays(_ samples: [QuantitySample], timeZone: TimeZone) -> [ActivityDay] {
        let steps = dailyQuantities(samples, kind: .stepCount, timeZone: timeZone)
        let energy = dailyQuantities(samples, kind: .activeEnergyKcal, timeZone: timeZone)
        let exercise = dailyQuantities(samples, kind: .exerciseMinutes, timeZone: timeZone)
        let allDays = Set(steps.keys).union(energy.keys).union(exercise.keys)
        return allDays.sorted().map {
            ActivityDay(localDate: $0,
                        steps: Int((steps[$0] ?? 0).rounded()),
                        activeEnergyKcal: energy[$0] ?? 0,
                        exerciseMin: Int((exercise[$0] ?? 0).rounded()),
                        source: .healthKit)
        }
    }

    public static func nutritionDays(_ samples: [QuantitySample], timeZone: TimeZone) -> [NutritionDay] {
        let kcal = dailyQuantities(samples, kind: .dietaryEnergyKcal, timeZone: timeZone)
        let protein = dailyQuantities(samples, kind: .dietaryProteinG, timeZone: timeZone)
        let carbs = dailyQuantities(samples, kind: .dietaryCarbsG, timeZone: timeZone)
        let fat = dailyQuantities(samples, kind: .dietaryFatG, timeZone: timeZone)
        let water = dailyQuantities(samples, kind: .dietaryWaterMl, timeZone: timeZone)
        let allDays = Set(kcal.keys).union(protein.keys).union(carbs.keys)
            .union(fat.keys).union(water.keys)
        return allDays.sorted().map {
            NutritionDay(localDate: $0, caloriesKcal: kcal[$0], proteinG: protein[$0],
                         carbsG: carbs[$0], fatG: fat[$0], waterMl: water[$0],
                         source: .healthKit,
                         // HealthKit-sourced days are never user-confirmed complete.
                         isComplete: false)
        }
    }

    public static func bodyDays(_ samples: [QuantitySample], timeZone: TimeZone) -> [BodyDay] {
        // Latest sample of the day wins for body metrics.
        func latestByDay(_ kind: QuantityKind) -> [LocalDate: Double] {
            var latest: [LocalDate: QuantitySample] = [:]
            for s in samples where s.kind == kind {
                let day = HorizonDates.localDate(from: s.end, timeZone: timeZone)
                if let existing = latest[day], existing.end >= s.end { continue }
                latest[day] = s
            }
            return latest.mapValues(\.value)
        }
        let weight = latestByDay(.bodyMassKg)
        let fat = latestByDay(.bodyFatPercent)
        let allDays = Set(weight.keys).union(fat.keys)
        return allDays.sorted().map {
            BodyDay(localDate: $0, weightKg: weight[$0], bodyFatPct: fat[$0], source: .healthKit)
        }
    }

    // MARK: Workouts

    public static func dedupedWorkouts(_ workouts: [WorkoutSample]) -> [WorkoutRecord] {
        // Higher-priority sources first; longer workouts first within a source.
        let sorted = workouts.sorted {
            let (ra, rb) = (sourceRank($0.sourceBundleID), sourceRank($1.sourceBundleID))
            if ra != rb { return ra < rb }
            return $0.durationMin > $1.durationMin
        }
        var kept: [WorkoutSample] = []
        outer: for w in sorted {
            for k in kept {
                let overlapStart = max(w.start, k.start)
                let overlapEnd = min(w.end, k.end)
                let overlap = max(0, overlapEnd.timeIntervalSince(overlapStart))
                let shorter = min(w.end.timeIntervalSince(w.start), k.end.timeIntervalSince(k.start))
                if shorter > 0, overlap / shorter >= 0.8 { continue outer }
            }
            kept.append(w)
        }
        return kept
            .sorted { $0.start < $1.start }
            .map {
                WorkoutRecord(syncIdentifier: $0.syncIdentifier,
                              workoutType: $0.activityType,
                              startAt: $0.start, endAt: $0.end,
                              durationMin: $0.durationMin,
                              activeKcal: $0.activeKcal, avgHr: $0.avgHeartRate,
                              distanceM: $0.distanceM, source: .healthKit)
            }
    }
}
