import SwiftUI
import SwiftData
import HorizonKit

/// This week vs your own recent history, from the local store — works offline.
/// Deliberately simple: four cards, trend arrows, no invented scores.
struct DashboardView: View {
    @Environment(AppState.self) private var app
    @Query(sort: \SleepDayRecord.localDate, order: .reverse) private var sleep: [SleepDayRecord]
    @Query(sort: \VitalsDayRecord.localDate, order: .reverse) private var vitals: [VitalsDayRecord]
    @Query(sort: \ActivityDayRecord.localDate, order: .reverse) private var activity: [ActivityDayRecord]
    @Query(sort: \NutritionDayRecord.localDate, order: .reverse) private var nutrition: [NutritionDayRecord]

    var body: some View {
        NavigationStack {
            ScrollView {
                if sleep.isEmpty && activity.isEmpty && vitals.isEmpty {
                    ContentUnavailableView(
                        "Building your picture",
                        systemImage: "chart.line.uptrend.xyaxis",
                        description: Text("Data appears here as Horizon syncs from Apple Health.")
                    )
                    .padding(.top, 80)
                } else {
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                        metricCard("Sleep", icon: "moon.zzz.fill",
                                   value: sleepAvg(days: 7), baseline: sleepAvg(days: 28),
                                   format: { m in "\(Int(m) / 60)h \(Int(m) % 60)m" },
                                   higherIsBetter: true)
                        metricCard("Steps", icon: "figure.walk",
                                   value: stepsAvg(days: 7), baseline: stepsAvg(days: 28),
                                   format: { "\(Int($0))" }, higherIsBetter: true)
                        metricCard("Resting HR", icon: "heart.fill",
                                   value: rhrAvg(days: 7), baseline: rhrAvg(days: 28),
                                   format: { "\(Int($0)) bpm" }, higherIsBetter: false)
                        metricCard("HRV", icon: "waveform.path.ecg",
                                   value: hrvAvg(days: 7), baseline: hrvAvg(days: 28),
                                   format: { "\(Int($0)) ms" }, higherIsBetter: true)
                    }
                    .padding(.horizontal)

                    proteinRow
                        .padding()
                }
            }
            .navigationTitle("Dashboard")
            .refreshable { await app.refreshFromHealthKit() }
        }
    }

    private var proteinRow: some View {
        let recent = nutrition.prefix(7).filter { $0.proteinG != nil }
        let hits = recent.filter { ($0.proteinG ?? 0) >= Double(app.proteinTargetG) }.count
        return HStack {
            Label("Protein target", systemImage: "fork.knife")
                .font(.subheadline.weight(.medium))
            Spacer()
            Text(recent.isEmpty ? "No logged days" : "\(hits) of \(recent.count) logged days")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding()
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 12))
    }

    private func metricCard(_ title: String, icon: String,
                            value: Double?, baseline: Double?,
                            format: (Double) -> String,
                            higherIsBetter: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: icon)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value.map(format) ?? "—")
                .font(.title3.bold())
            if let value, let baseline, baseline > 0 {
                let delta = (value - baseline) / baseline
                let improving = higherIsBetter ? delta > 0.02 : delta < -0.02
                let declining = higherIsBetter ? delta < -0.02 : delta > 0.02
                HStack(spacing: 3) {
                    Image(systemName: delta > 0.02 ? "arrow.up" : delta < -0.02 ? "arrow.down" : "arrow.right")
                    Text("vs 28d")
                }
                .font(.caption2)
                .foregroundStyle(improving ? .green : declining ? .orange : .secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: Averages over the most recent N days present in the store

    private func sleepAvg(days: Int) -> Double? {
        let slice = sleep.prefix(days).map { Double($0.totalMin) }
        return slice.isEmpty ? nil : slice.reduce(0, +) / Double(slice.count)
    }
    private func stepsAvg(days: Int) -> Double? {
        let slice = activity.prefix(days).map { Double($0.steps) }
        return slice.isEmpty ? nil : slice.reduce(0, +) / Double(slice.count)
    }
    private func rhrAvg(days: Int) -> Double? {
        let slice = vitals.prefix(days).compactMap(\.restingHr)
        return slice.isEmpty ? nil : slice.reduce(0, +) / Double(slice.count)
    }
    private func hrvAvg(days: Int) -> Double? {
        let slice = vitals.prefix(days).compactMap(\.hrvSdnnMs)
        return slice.isEmpty ? nil : slice.reduce(0, +) / Double(slice.count)
    }
}
