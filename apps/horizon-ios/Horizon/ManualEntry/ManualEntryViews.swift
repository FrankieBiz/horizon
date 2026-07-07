import SwiftUI
import SwiftData
import HorizonKit

// Stage-1 manual entry: the mandatory fallbacks (nutrition totals, habit/
// supplement quick-log, biomarker panels). Manual rows overwrite HealthKit
// rows for the same day — explicit user intent wins (spec §3).

struct ManualEntryHubView: View {
    var body: some View {
        NavigationStack {
            List {
                NavigationLink("Nutrition totals", destination: NutritionEntryView())
                NavigationLink("Habits & supplements", destination: HabitLogView())
                NavigationLink("Blood test results", destination: BiomarkerEntryView())
            }
            .navigationTitle("Log")
        }
    }
}

// MARK: - Nutrition daily totals

struct NutritionEntryView: View {
    @Environment(AppState.self) private var app
    @Environment(\.modelContext) private var ctx
    @Environment(\.dismiss) private var dismiss

    @State private var date = Date.now
    @State private var calories = ""
    @State private var protein = ""
    @State private var carbs = ""
    @State private var fat = ""
    @State private var isComplete = true

    var body: some View {
        Form {
            DatePicker("Day", selection: $date, in: ...Date.now, displayedComponents: .date)
            TextField("Calories (kcal)", text: $calories).keyboardType(.numberPad)
            TextField("Protein (g)", text: $protein).keyboardType(.numberPad)
            TextField("Carbs (g)", text: $carbs).keyboardType(.numberPad)
            TextField("Fat (g)", text: $fat).keyboardType(.numberPad)
            Toggle("Full day (nothing missing)", isOn: $isComplete)
            Button("Save") { save() }
                .disabled(calories.isEmpty && protein.isEmpty)
        }
        .navigationTitle("Nutrition")
    }

    private func save() {
        let tz = TimeZone(identifier: app.timezoneID) ?? .current
        let day = HorizonDates.localDate(from: date, timeZone: tz)
        let existing = try? ctx.fetch(FetchDescriptor<NutritionDayRecord>(
            predicate: #Predicate { $0.localDate == day })).first
        let rec = existing ?? NutritionDayRecord()
        rec.localDate = day
        rec.caloriesKcal = Double(calories)
        rec.proteinG = Double(protein)
        rec.carbsG = Double(carbs)
        rec.fatG = Double(fat)
        rec.source = MetricSource.manual.rawValue
        rec.isComplete = isComplete
        rec.syncedAt = nil
        if existing == nil { ctx.insert(rec) }
        try? ctx.save()
        Task { await app.pushSync() }
        dismiss()
    }
}

// MARK: - Habit / supplement quick log

struct HabitLogView: View {
    @Environment(AppState.self) private var app
    @Environment(\.modelContext) private var ctx
    @Query(sort: \HabitModel.createdAt) private var habits: [HabitModel]
    @Query(sort: \HabitLogModel.completedAt, order: .reverse) private var logs: [HabitLogModel]
    @State private var newHabitName = ""
    @State private var newHabitKind = "habit"

    private var todayKey: String {
        HorizonDates.localDate(from: .now, timeZone: TimeZone(identifier: app.timezoneID) ?? .current)
    }

    var body: some View {
        List {
            Section("Today") {
                if habits.isEmpty {
                    Text("Add a habit or supplement below.").foregroundStyle(.secondary)
                }
                ForEach(habits, id: \.persistentModelID) { habit in
                    let done = logs.contains { $0.habitName == habit.name && $0.localDate == todayKey }
                    Button {
                        toggle(habit, done: done)
                    } label: {
                        HStack {
                            Text(habit.name)
                            Spacer()
                            Image(systemName: done ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(done ? .green : .secondary)
                        }
                    }
                    .foregroundStyle(.primary)
                }
            }
            Section("Add") {
                TextField("Name (e.g. Vitamin D)", text: $newHabitName)
                Picker("Type", selection: $newHabitKind) {
                    Text("Habit").tag("habit")
                    Text("Supplement").tag("supplement")
                }
                Button("Add") {
                    guard !newHabitName.trimmingCharacters(in: .whitespaces).isEmpty else { return }
                    let h = HabitModel()
                    h.name = newHabitName.trimmingCharacters(in: .whitespaces)
                    h.kind = newHabitKind
                    ctx.insert(h)
                    try? ctx.save()
                    newHabitName = ""
                }
            }
        }
        .navigationTitle("Habits")
    }

    private func toggle(_ habit: HabitModel, done: Bool) {
        let habitName = habit.name
        let today = todayKey
        if done {
            if let log = try? ctx.fetch(FetchDescriptor<HabitLogModel>(
                predicate: #Predicate { $0.habitName == habitName && $0.localDate == today })).first {
                ctx.delete(log)
            }
        } else {
            let log = HabitLogModel()
            log.habitName = habit.name
            log.localDate = today
            log.timezone = app.timezoneID
            ctx.insert(log)
        }
        try? ctx.save()
        Task { await app.pushSync() }
    }
}

// MARK: - Biomarker panel entry

struct BiomarkerEntryView: View {
    @Environment(AppState.self) private var app
    @Environment(\.modelContext) private var ctx
    @Environment(\.dismiss) private var dismiss

    @State private var drawnOn = Date.now
    @State private var labName = ""
    @State private var results: [DraftResult] = [DraftResult()]

    struct DraftResult: Identifiable {
        let id = UUID()
        var marker = ""
        var value = ""
        var unit = ""
        var refLow = ""
        var refHigh = ""
    }

    var body: some View {
        Form {
            Section("Panel") {
                DatePicker("Draw date", selection: $drawnOn, in: ...Date.now, displayedComponents: .date)
                TextField("Lab name", text: $labName)
            }
            ForEach($results) { $r in
                Section {
                    TextField("Marker (e.g. LDL-C)", text: $r.marker)
                    TextField("Value", text: $r.value).keyboardType(.decimalPad)
                    TextField("Unit (e.g. mg/dL)", text: $r.unit)
                    HStack {
                        TextField("Lab range low", text: $r.refLow).keyboardType(.decimalPad)
                        TextField("high", text: $r.refHigh).keyboardType(.decimalPad)
                    }
                } footer: {
                    Text("Enter your lab's own printed reference range.")
                }
            }
            Button("Add another marker") { results.append(DraftResult()) }
            Button("Save panel") { save() }
                .disabled(results.allSatisfy { $0.marker.isEmpty || $0.value.isEmpty })
        }
        .navigationTitle("Bloodwork")
    }

    private func save() {
        let tz = TimeZone(identifier: app.timezoneID) ?? .current
        let panel = BiomarkerPanelModel()
        panel.drawnOn = HorizonDates.localDate(from: drawnOn, timeZone: tz)
        panel.labName = labName
        panel.results = results.compactMap { draft in
            guard !draft.marker.isEmpty, let value = Double(draft.value) else { return nil }
            let r = BiomarkerResultModel()
            r.marker = draft.marker
            r.value = value
            r.unit = draft.unit
            r.refLow = Double(draft.refLow)
            r.refHigh = Double(draft.refHigh)
            return r
        }
        guard !(panel.results ?? []).isEmpty else { return }
        ctx.insert(panel)
        try? ctx.save()
        Task { await app.pushSync() }
        dismiss()
    }
}
