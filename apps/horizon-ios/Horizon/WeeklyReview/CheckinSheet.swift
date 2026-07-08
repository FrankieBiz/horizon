import SwiftUI
import SwiftData
import HorizonKit

/// The 3-tap weekly check-in (energy / soreness / sleep quality, 1–5) shown
/// when the review opens — subjective signal at coaching cadence (spec §11 Q6).
/// Optional and skippable; feeds NEXT week's WeeklyData.
struct CheckinSheet: View {
    @Environment(AppState.self) private var app
    @Environment(\.modelContext) private var ctx
    @Environment(\.dismiss) private var dismiss

    let weekStart: String
    @State private var energy = 3
    @State private var soreness = 3
    @State private var sleepQuality = 3

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Before you read: how did last week feel?")
                        .font(.headline)
                        .listRowBackground(Color.clear)
                }
                ratingRow("Energy", systemImage: "bolt.fill", value: $energy,
                          low: "Drained", high: "Energized")
                ratingRow("Soreness", systemImage: "figure.strengthtraining.traditional", value: $soreness,
                          low: "None", high: "Very sore")
                ratingRow("Sleep quality", systemImage: "moon.zzz.fill", value: $sleepQuality,
                          low: "Poor", high: "Great")
            }
            .navigationTitle("Quick check-in")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Skip") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }.bold()
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func ratingRow(_ title: String, systemImage: String, value: Binding<Int>,
                           low: String, high: String) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                Label(title, systemImage: systemImage).font(.subheadline.weight(.medium))
                Picker(title, selection: value) {
                    ForEach(1...5, id: \.self) { Text("\($0)").tag($0) }
                }
                .pickerStyle(.segmented)
                HStack {
                    Text(low)
                    Spacer()
                    Text(high)
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
            }
        }
    }

    private func save() {
        let rec = WeeklyCheckinRecord()
        rec.weekStart = weekStart
        rec.energy = energy
        rec.soreness = soreness
        rec.sleepQuality = sleepQuality
        rec.syncedAt = nil
        ctx.insert(rec)
        try? ctx.save()
        Task { await app.pushSync() }
        dismiss()
    }
}
