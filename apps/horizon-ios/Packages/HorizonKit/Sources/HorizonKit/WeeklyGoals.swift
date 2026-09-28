import Foundation

/// One independently checkable part of a weekly goal.
public struct GoalStep: Codable, Identifiable, Equatable, Sendable {
    public var id: UUID
    public var title: String
    public var isComplete: Bool

    public init(id: UUID = UUID(), title: String, isComplete: Bool = false) {
        self.id = id
        self.title = title
        self.isComplete = isComplete
    }
}

public struct GoalDraft: Equatable, Sendable {
    public var title: String
    public var category: String
    public var steps: [GoalStep]
}

public enum GoalProgress {
    /// A four-step goal advances by 25 points for each checked step.
    public static func percent(for steps: [GoalStep]) -> Int {
        guard !steps.isEmpty else { return 0 }
        return Int((Double(steps.filter(\.isComplete).count) / Double(steps.count) * 100).rounded())
    }

    /// Every goal contributes equally, regardless of how many steps it contains.
    public static func overallPercent(goals: [[GoalStep]]) -> Int {
        guard !goals.isEmpty else { return 0 }
        let fractions = goals.map { steps in
            steps.isEmpty ? 0 : Double(steps.filter(\.isComplete).count) / Double(steps.count)
        }
        return Int((fractions.reduce(0, +) / Double(goals.count) * 100).rounded())
    }

    public static func numberedSteps(label: String, count: Int) -> [GoalStep] {
        guard count > 0 else { return [] }
        return (1...min(count, 100)).map { GoalStep(title: "\(label) \($0)") }
    }

    public static func validated(title: String, category: String, steps: [GoalStep]) -> GoalDraft? {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let category = category.trimmingCharacters(in: .whitespacesAndNewlines)
        let steps = steps.map {
            GoalStep(id: $0.id,
                     title: $0.title.trimmingCharacters(in: .whitespacesAndNewlines),
                     isComplete: $0.isComplete)
        }
        guard !title.isEmpty, !category.isEmpty, !steps.isEmpty,
              steps.allSatisfy({ !$0.title.isEmpty }),
              title.count <= 120, category.count <= 40,
              steps.count <= 100, steps.allSatisfy({ $0.title.count <= 120 }) else { return nil }
        return GoalDraft(title: title, category: category, steps: steps)
    }
}
