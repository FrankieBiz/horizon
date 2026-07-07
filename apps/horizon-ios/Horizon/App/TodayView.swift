import SwiftUI
import SwiftData

/// Stage-1 verification surface: shows the last 7 days of synced aggregates so
/// the exit gate ("7 real days of correct data on device") is checkable by eye.
/// Replaced by the full dashboard in Stage 5.
struct TodayView: View {
    @Environment(AppState.self) private var app
    @Query(sort: \SleepDayRecord.localDate, order: .reverse) private var sleep: [SleepDayRecord]
    @Query(sort: \VitalsDayRecord.localDate, order: .reverse) private var vitals: [VitalsDayRecord]
    @Query(sort: \ActivityDayRecord.localDate, order: .reverse) private var activity: [ActivityDayRecord]
    @Query(sort: \NutritionDayRecord.localDate, order: .reverse) private var nutrition: [NutritionDayRecord]
    @Query(sort: \WorkoutRecordModel.startAt, order: .reverse) private var workouts: [WorkoutRecordModel]

    var body: some View {
        NavigationStack {
            List {
                if sleep.isEmpty && vitals.isEmpty && activity.isEmpty {
                    ContentUnavailableView(
                        "No data yet",
                        systemImage: "heart.text.square",
                        description: Text("Wear your device and check back — Horizon syncs from Apple Health automatically.")
                    )
                }

                if !sleep.isEmpty {
                    Section("Sleep") {
                        ForEach(sleep.prefix(7), id: \.localDate) { d in
                            row(d.localDate, "\(d.totalMin / 60)h \(d.totalMin % 60)m asleep"
                                + (d.deepMin.map { " · deep \($0)m" } ?? ""), synced: d.syncedAt != nil)
                        }
                    }
                }
                if !vitals.isEmpty {
                    Section("Vitals") {
                        ForEach(vitals.prefix(7), id: \.localDate) { d in
                            row(d.localDate,
                                [d.restingHr.map { "RHR \(Int($0))" },
                                 d.hrvSdnnMs.map { "HRV \(Int($0))ms" }]
                                    .compactMap(\.self).joined(separator: " · "),
                                synced: d.syncedAt != nil)
                        }
                    }
                }
                if !activity.isEmpty {
                    Section("Activity") {
                        ForEach(activity.prefix(7), id: \.localDate) { d in
                            row(d.localDate, "\(d.steps) steps · \(Int(d.activeEnergyKcal)) kcal · \(d.exerciseMin)m exercise",
                                synced: d.syncedAt != nil)
                        }
                    }
                }
                if !nutrition.isEmpty {
                    Section("Nutrition") {
                        ForEach(nutrition.prefix(7), id: \.localDate) { d in
                            row(d.localDate,
                                [d.caloriesKcal.map { "\(Int($0)) kcal" },
                                 d.proteinG.map { "P \(Int($0))g" }]
                                    .compactMap(\.self).joined(separator: " · "),
                                synced: d.syncedAt != nil)
                        }
                    }
                }
                if !workouts.isEmpty {
                    Section("Workouts") {
                        ForEach(workouts.prefix(7), id: \.syncIdentifier) { w in
                            row(w.workoutType, "\(Int(w.durationMin))m"
                                + (w.activeKcal.map { " · \(Int($0)) kcal" } ?? ""),
                                synced: w.syncedAt != nil)
                        }
                    }
                }

                Section {
                    if let at = app.lastSyncAt {
                        LabeledContent("Last sync", value: at.formatted(date: .omitted, time: .shortened))
                    }
                    if let err = app.lastSyncError {
                        Text(err).font(.caption2).foregroundStyle(.red).lineLimit(3)
                    }
                }
            }
            .navigationTitle("Horizon")
            .refreshable { await app.refreshFromHealthKit() }
            .toolbar {
                Button {
                    Task { await app.refreshFromHealthKit() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
            }
        }
    }

    private func row(_ title: String, _ detail: String, synced: Bool) -> some View {
        HStack {
            VStack(alignment: .leading) {
                Text(title).font(.subheadline.weight(.medium))
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: synced ? "checkmark.icloud" : "icloud.slash")
                .font(.caption)
                .foregroundStyle(synced ? .green : .secondary)
        }
    }
}
