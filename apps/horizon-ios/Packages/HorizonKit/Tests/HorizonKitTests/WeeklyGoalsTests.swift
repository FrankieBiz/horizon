import Foundation
import Testing
@testable import HorizonKit

@Suite("Weekly goals")
struct WeeklyGoalsTests {
    @Test func eachCompletedStepContributesAnEqualShare() {
        let steps = (1...4).map { GoalStep(title: "Essay \($0)") }
        #expect(GoalProgress.percent(for: steps) == 0)
        var updated = steps
        updated[0].isComplete = true
        #expect(GoalProgress.percent(for: updated) == 25)
        updated[1].isComplete = true
        #expect(GoalProgress.percent(for: updated) == 50)
        updated[2].isComplete = true
        updated[3].isComplete = true
        #expect(GoalProgress.percent(for: updated) == 100)
    }

    @Test func emptyGoalHasNoProgressAndCannotExceedOneHundredPercent() {
        #expect(GoalProgress.percent(for: []) == 0)
        #expect(GoalProgress.percent(for: [GoalStep(title: "Done", isComplete: true)]) == 100)
    }

    @Test func overallProgressWeightsGoalsEqually() {
        let essays = (1...4).map { GoalStep(title: "Essay \($0)", isComplete: $0 == 1) }
        let reading = [GoalStep(title: "Read", isComplete: true)]
        #expect(GoalProgress.overallPercent(goals: [essays, reading]) == 63)
        #expect(GoalProgress.overallPercent(goals: []) == 0)
    }

    @Test func generatedStepsUseTheRequestedCount() {
        let steps = GoalProgress.numberedSteps(label: "Essay", count: 4)
        #expect(steps.map(\.title) == ["Essay 1", "Essay 2", "Essay 3", "Essay 4"])
        #expect(Set(steps.map(\.id)).count == 4)
        #expect(GoalProgress.numberedSteps(label: "Essay", count: 0).isEmpty)
    }

    @Test func validationRejectsBlankNamesAndSteps() {
        #expect(GoalProgress.validated(title: "  ", category: "School", steps: [GoalStep(title: "Essay")]) == nil)
        #expect(GoalProgress.validated(title: "Write essays", category: " ", steps: [GoalStep(title: "Essay")]) == nil)
        #expect(GoalProgress.validated(title: "Write essays", category: "School", steps: []) == nil)
        #expect(GoalProgress.validated(title: " Write essays ", category: " School ", steps: [GoalStep(title: " Essay 1 ")])?.title == "Write essays")
    }

    @Test func stepStatusUsesTheAPIsSnakeCaseFormat() throws {
        let step = GoalStep(title: "Essay 1", isComplete: true)
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        let data = try encoder.encode(step)
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(json["is_complete"] as? Bool == true)

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        #expect(try decoder.decode(GoalStep.self, from: data) == step)
    }
}
