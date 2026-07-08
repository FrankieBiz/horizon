import Foundation

// Client-side mirror of the WeeklyReview wire contract (@horizon/shared).
// Decoded with convertFromSnakeCase + ISO-8601 via APIClient.

struct WeeklyReview: Codable, Equatable {
    var weekStart: String
    var coachMessage: String
    var wins: [String]
    var focusAreas: [String]
    var domainAnalyses: [DomainAnalysis]
    var recommendations: [Recommendation]
    var createdAt: Date

    struct DomainAnalysis: Codable, Equatable {
        var domain: String
        var observations: [String]
        var severity: String
        var evidence: [String]

        var displayName: String {
            switch domain {
            case "sleep_recovery": return "Sleep & Recovery"
            case "nutrition": return "Nutrition"
            case "exercise": return "Exercise"
            case "habits": return "Habits"
            case "biomarkers": return "Bloodwork"
            default: return domain.capitalized
            }
        }

        var icon: String {
            switch domain {
            case "sleep_recovery": return "moon.zzz.fill"
            case "nutrition": return "fork.knife"
            case "exercise": return "figure.run"
            case "habits": return "checklist"
            case "biomarkers": return "testtube.2"
            default: return "chart.bar"
            }
        }
    }

    struct Recommendation: Codable, Equatable, Identifiable {
        var id: String?
        var category: String
        var priority: Int
        var message: String
        var rationale: String
        var status: String
    }
}
