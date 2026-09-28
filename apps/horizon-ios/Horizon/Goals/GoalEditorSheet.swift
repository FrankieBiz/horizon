import SwiftUI
import SwiftData
import HorizonKit

struct GoalEditorSheet: View {
    @Environment(AppState.self) private var app
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query private var allGoals: [WeeklyGoalRecord]

    let goal: WeeklyGoalRecord?
    let weekStart: String

    @State private var title = ""
    @State private var category = "Personal"
    @State private var isMain = false
    @State private var steps: [GoalStep] = []
    @State private var numberedLabel = "Essay"
    @State private var numberedCount = 4
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Goal") {
                    TextField("What will you accomplish?", text: $title)
                        .textInputAutocapitalization(.sentences)
                    TextField("Category", text: $category)
                        .textInputAutocapitalization(.words)
                    HStack {
                        ForEach(["School", "Work", "Fitness", "Personal"], id: \.self) { suggestion in
                            Button(suggestion) { category = suggestion }
                                .font(.caption)
                                .buttonStyle(.bordered)
                        }
                    }
                    .listRowSeparator(.hidden)
                    Toggle("Main goal for this week", isOn: $isMain)
                }

                Section {
                    ForEach($steps) { $step in
                        HStack {
                            TextField("Step", text: $step.title)
                            if step.isComplete {
                                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                            }
                            Button(role: .destructive) {
                                steps.removeAll { $0.id == step.id }
                            } label: {
                                Image(systemName: "minus.circle")
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Remove \(step.title)")
                        }
                    }
                    Button {
                        steps.append(GoalStep(title: ""))
                    } label: {
                        Label("Add step", systemImage: "plus.circle")
                    }
                    .disabled(steps.count >= 100)
                } header: {
                    Text("Steps")
                } footer: {
                    Text("Each completed step adds an equal share to this goal's percentage.")
                }

                Section("Add a numbered set") {
                    TextField("Item name, e.g. Essay", text: $numberedLabel)
                    Stepper("Quantity: \(numberedCount)", value: $numberedCount, in: 1...100)
                    Button("Add \(numberedCount) numbered steps") {
                        let label = numberedLabel.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !label.isEmpty, steps.count + numberedCount <= 100 else {
                            errorMessage = "Enter an item name and keep the total at 100 steps or fewer."
                            return
                        }
                        steps.append(contentsOf: GoalProgress.numberedSteps(label: label, count: numberedCount))
                        errorMessage = nil
                    }
                }

                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red) }
                }
            }
            .navigationTitle(goal == nil ? "New Goal" : "Edit Goal")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }.bold()
                }
            }
            .onAppear(perform: loadDraft)
        }
    }

    private func loadDraft() {
        guard let goal else { return }
        title = goal.title
        category = goal.category
        isMain = goal.isMain
        steps = (try? JSONDecoder().decode([GoalStep].self, from: goal.stepsJSON)) ?? []
    }

    private func save() {
        guard let owner = app.auth.userID else {
            errorMessage = "Sign in to save goals."
            return
        }
        guard let draft = GoalProgress.validated(title: title, category: category, steps: steps) else {
            errorMessage = "Add a goal name, category, and at least one named step."
            return
        }
        do {
            let data = try JSONEncoder().encode(draft.steps)
            let record = goal ?? WeeklyGoalRecord()
            if goal == nil {
                record.ownerID = owner
                record.weekStart = weekStart
                context.insert(record)
            }
            record.title = draft.title
            record.category = draft.category
            record.stepsJSON = data
            record.isMain = isMain
            record.updatedAt = .now
            record.syncedAt = nil
            if isMain {
                for other in allGoals where other.ownerID == owner
                    && other.weekStart == weekStart && other.localID != record.localID {
                    other.isMain = false
                    other.updatedAt = .now
                    other.syncedAt = nil
                }
            }
            try context.save()
            Task { await app.syncGoals() }
            dismiss()
        } catch {
            context.rollback()
            errorMessage = "Couldn't save this goal. Please try again."
        }
    }
}
