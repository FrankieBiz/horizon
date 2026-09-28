import SwiftUI
import SwiftData
import HorizonKit

struct WeeklyGoalsView: View {
    @Environment(AppState.self) private var app
    @Environment(\.modelContext) private var context
    @Environment(\.scenePhase) private var scenePhase
    @Query(sort: \WeeklyGoalRecord.createdAt) private var allGoals: [WeeklyGoalRecord]

    @State private var selectedWeekStart = ""
    @State private var editingID: String?
    @State private var showEditor = false
    @State private var deletingID: String?
    @State private var errorMessage: String?

    private var currentWeek: String {
        HorizonDates.weekStart(containing: .now,
            timeZone: TimeZone(identifier: app.timezoneID) ?? .current)
    }

    private var displayedWeek: String { selectedWeekStart.isEmpty ? currentWeek : selectedWeekStart }
    private var isCurrentWeek: Bool { displayedWeek == currentWeek }
    private var myGoals: [WeeklyGoalRecord] {
        guard let owner = app.auth.userID else { return [] }
        return allGoals.filter { $0.ownerID == owner }
    }
    private var weekGoals: [WeeklyGoalRecord] {
        myGoals.filter { $0.weekStart == displayedWeek && !$0.isDeleted }
            .sorted { $0.isMain && !$1.isMain }
    }
    private var pastWeeks: [String] {
        Array(Set(myGoals.filter { !$0.isDeleted }.map(\.weekStart)
            .filter { $0 != currentWeek })).sorted(by: >)
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(isCurrentWeek ? "This week" : "Past week")
                                .font(.headline)
                            Text("Week of \(displayedWeek)")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if !pastWeeks.isEmpty {
                            Menu {
                                Button("This week") { selectedWeekStart = currentWeek }
                                ForEach(pastWeeks, id: \.self) { week in
                                    Button("Week of \(week)") { selectedWeekStart = week }
                                }
                            } label: {
                                Label("Choose week", systemImage: "calendar")
                            }
                        }
                    }
                }

                if weekGoals.isEmpty {
                    Section {
                        ContentUnavailableView(
                            isCurrentWeek ? "No goals this week" : "No goals for this week",
                            systemImage: "target",
                            description: Text(isCurrentWeek
                                ? "Add a goal and break it into steps you can check off."
                                : "This week has no saved goals."))
                        if isCurrentWeek && !app.localStoreUnavailable,
                           let prior = mostRecentPastWeek {
                            Button("Copy goals from week of \(prior)") { copyGoals(from: prior) }
                        }
                    }
                } else {
                    let allSteps = weekGoals.flatMap { steps(for: $0) }
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text("Overall progress").font(.headline)
                                Spacer()
                                Text("\(GoalProgress.overallPercent(goals: weekGoals.map { steps(for: $0) }))%")
                                    .font(.headline.monospacedDigit())
                            }
                            ProgressView(value: Double(GoalProgress.overallPercent(goals: weekGoals.map { steps(for: $0) })), total: 100)
                            Text("\(allSteps.filter(\.isComplete).count) of \(allSteps.count) steps done across \(weekGoals.count) goals")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }

                    ForEach(categories, id: \.self) { category in
                        Section(category) {
                            ForEach(weekGoals.filter { $0.category == category }, id: \.localID) { goal in
                                goalRow(goal)
                            }
                        }
                    }
                }

                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red) }
                }
                if app.localStoreUnavailable {
                    Section {
                        Text("On-device storage is unavailable. Goal changes are paused to protect your saved data.")
                            .foregroundStyle(.red)
                    }
                }
                if let syncError = app.goalsSyncError {
                    Section {
                        Text(syncError).font(.caption).foregroundStyle(.secondary)
                        if app.hasGoalConflict {
                            Button("Keep this device's changes") {
                                Task { await app.resolveGoalConflicts(keepLocal: true) }
                            }
                            Button("Use other device's changes") {
                                Task { await app.resolveGoalConflicts(keepLocal: false) }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Weekly Goals")
            .toolbar {
                if isCurrentWeek && !app.localStoreUnavailable {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            editingID = nil
                            showEditor = true
                        } label: {
                            Label("Add goal", systemImage: "plus")
                        }
                    }
                }
            }
            .sheet(isPresented: $showEditor) {
                GoalEditorSheet(goal: editingID.flatMap { id in myGoals.first { $0.localID == id } },
                                weekStart: currentWeek)
            }
            .confirmationDialog("Delete this goal?", isPresented: Binding(
                get: { deletingID != nil },
                set: { if !$0 { deletingID = nil } }
            )) {
                Button("Delete goal", role: .destructive) { deleteSelectedGoal() }
            } message: {
                Text("Its steps and progress will be removed from this week.")
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active, selectedWeekStart != currentWeek,
                   !pastWeeks.contains(selectedWeekStart) {
                    selectedWeekStart = currentWeek
                }
            }
            .task { await app.syncGoals() }
        }
    }

    private var categories: [String] {
        Array(Set(weekGoals.map(\.category))).sorted()
    }

    private var mostRecentPastWeek: String? { pastWeeks.first }

    private func steps(for goal: WeeklyGoalRecord) -> [GoalStep] {
        (try? JSONDecoder().decode([GoalStep].self, from: goal.stepsJSON)) ?? []
    }

    private func goalRow(_ goal: WeeklyGoalRecord) -> some View {
        let steps = steps(for: goal)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    if goal.isMain {
                        Label("Main goal", systemImage: "star.fill")
                            .font(.caption2.weight(.semibold)).foregroundStyle(.orange)
                    }
                    Text(goal.title).font(.headline)
                }
                Spacer()
                Text("\(GoalProgress.percent(for: steps))%")
                    .font(.subheadline.weight(.semibold).monospacedDigit())
            }
            ProgressView(value: Double(GoalProgress.percent(for: steps)), total: 100)
            ForEach(steps) { step in
                Button {
                    toggle(step, in: goal)
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: step.isComplete ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(step.isComplete ? .green : .secondary)
                        Text(step.title)
                            .strikethrough(step.isComplete)
                            .foregroundStyle(step.isComplete ? .secondary : .primary)
                        Spacer()
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!isCurrentWeek || app.localStoreUnavailable)
                .accessibilityLabel("\(step.title), \(step.isComplete ? "completed" : "incomplete")")
            }
            if isCurrentWeek && !app.localStoreUnavailable {
                HStack {
                    Button("Edit") {
                        editingID = goal.localID
                        showEditor = true
                    }
                    Spacer()
                    Button("Delete", role: .destructive) { deletingID = goal.localID }
                }
                .font(.caption)
            }
        }
        .padding(.vertical, 6)
    }

    private func toggle(_ step: GoalStep, in goal: WeeklyGoalRecord) {
        var updated = steps(for: goal)
        guard let index = updated.firstIndex(where: { $0.id == step.id }) else { return }
        updated[index].isComplete.toggle()
        do {
            goal.stepsJSON = try JSONEncoder().encode(updated)
            goal.updatedAt = .now
            goal.syncedAt = nil
            try context.save()
            Task { await app.syncGoals() }
            errorMessage = nil
        } catch {
            context.rollback()
            errorMessage = "Couldn't save progress. Please try again."
        }
    }

    private func copyGoals(from week: String) {
        guard let owner = app.auth.userID, weekGoals.isEmpty else { return }
        for source in myGoals where source.weekStart == week && !source.isDeleted {
            let copy = WeeklyGoalRecord()
            copy.ownerID = owner
            copy.weekStart = currentWeek
            copy.title = source.title
            copy.category = source.category
            copy.isMain = source.isMain
            let reset = steps(for: source).map { GoalStep(title: $0.title) }
            guard let data = try? JSONEncoder().encode(reset) else { continue }
            copy.stepsJSON = data
            context.insert(copy)
        }
        do {
            try context.save()
            Task { await app.syncGoals() }
            errorMessage = nil
        } catch {
            context.rollback()
            errorMessage = "Couldn't copy goals. Please try again."
        }
    }

    private func deleteSelectedGoal() {
        defer { deletingID = nil }
        guard let id = deletingID, let goal = myGoals.first(where: { $0.localID == id }) else { return }
        goal.isDeleted = true
        goal.updatedAt = .now
        goal.syncedAt = nil
        do {
            try context.save()
            Task { await app.syncGoals() }
            errorMessage = nil
        } catch {
            context.rollback()
            errorMessage = "Couldn't delete goal. Please try again."
        }
    }
}
