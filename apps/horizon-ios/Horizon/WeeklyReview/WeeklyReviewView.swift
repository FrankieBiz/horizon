import SwiftUI
import SwiftData
import HorizonKit

/// The product moment: Monday's coaching review. Check-in sheet on first open
/// for the current week, then the coach message, wins, focus areas, per-domain
/// analyses, and ≤3 recommendations with read/acted actions.
struct WeeklyReviewView: View {
    @Environment(AppState.self) private var app
    @Environment(\.modelContext) private var ctx

    @State private var review: WeeklyReview?
    @State private var loadState: LoadState = .loading
    @State private var showCheckin = false

    enum LoadState { case loading, loaded, empty, error(String) }

    var body: some View {
        NavigationStack {
            Group {
                switch loadState {
                case .loading:
                    ProgressView("Loading your review…")
                case .empty:
                    ContentUnavailableView(
                        "No review yet",
                        systemImage: "sparkles",
                        description: Text("Your first weekly review arrives Monday morning once Horizon has a week of data.")
                    )
                case .error(let message):
                    ContentUnavailableView {
                        Label("Couldn't load", systemImage: "wifi.slash")
                    } description: {
                        Text(message)
                    } actions: {
                        Button("Retry") { Task { await load() } }
                    }
                case .loaded:
                    if let review { reviewBody(review) }
                }
            }
            .navigationTitle("Weekly Review")
            .refreshable { await load() }
            .task { await load() }
            .sheet(isPresented: $showCheckin) {
                CheckinSheet(weekStart: currentWeekStart)
            }
        }
    }

    private var currentWeekStart: String {
        HorizonDates.weekStart(containing: .now,
                               timeZone: TimeZone(identifier: app.timezoneID) ?? .current)
    }

    private func reviewBody(_ review: WeeklyReview) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Week of \(review.weekStart)")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Text(review.coachMessage)
                    .font(.body)
                    .lineSpacing(3)
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 14))

                if !review.wins.isEmpty {
                    section("Wins", icon: "trophy.fill", tint: .green) {
                        ForEach(review.wins, id: \.self) { win in
                            bullet(win)
                        }
                    }
                }

                if !review.recommendations.isEmpty {
                    section("This week", icon: "target", tint: .blue) {
                        ForEach(review.recommendations) { rec in
                            recommendationCard(rec)
                        }
                    }
                }

                if !review.domainAnalyses.isEmpty {
                    section("Details", icon: "chart.bar.doc.horizontal", tint: .secondary) {
                        ForEach(review.domainAnalyses, id: \.domain) { domain in
                            DisclosureGroup {
                                VStack(alignment: .leading, spacing: 6) {
                                    ForEach(domain.observations, id: \.self) { bullet($0) }
                                }
                                .padding(.top, 4)
                            } label: {
                                Label(domain.displayName, systemImage: domain.icon)
                                    .font(.subheadline.weight(.medium))
                            }
                        }
                    }
                }

                Text("Horizon provides general wellness information, not medical advice, diagnosis, or treatment.")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
                    .padding(.top, 8)
            }
            .padding()
        }
    }

    private func section(_ title: String, icon: String, tint: Color,
                         @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: icon)
                .font(.headline)
                .foregroundStyle(tint)
            content()
        }
    }

    private func bullet(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text("•").foregroundStyle(.secondary)
            Text(text).font(.callout)
        }
    }

    private func recommendationCard(_ rec: WeeklyReview.Recommendation) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(rec.category.capitalized)
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(.blue.opacity(0.15), in: Capsule())
                Spacer()
                if rec.status == "acted" {
                    Label("Done", systemImage: "checkmark.circle.fill")
                        .font(.caption).foregroundStyle(.green)
                }
            }
            Text(rec.message).font(.callout.weight(.medium))
            Text(rec.rationale).font(.caption).foregroundStyle(.secondary)
            if rec.status != "acted", let id = rec.id {
                Button("Mark as done") {
                    Task { await markActed(id) }
                }
                .font(.caption.weight(.semibold))
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: Data

    private func load() async {
        guard let token = app.auth.accessToken else {
            loadState = .error("Sign in to see your review.")
            return
        }
        do {
            let fetched: WeeklyReview = try await app.api.get("/v1/reviews/latest", token: token)
            review = fetched
            loadState = .loaded
            maybeShowCheckin()
            markDeliveredAsRead(fetched)
        } catch ApiError.badStatus(404, _) {
            loadState = .empty
        } catch {
            loadState = .error("Check your connection and pull to refresh.")
        }
    }

    private func maybeShowCheckin() {
        let week = currentWeekStart
        let existing = try? ctx.fetch(FetchDescriptor<WeeklyCheckinRecord>(
            predicate: #Predicate { $0.weekStart == week })).first
        if existing == nil { showCheckin = true }
    }

    private func markDeliveredAsRead(_ review: WeeklyReview) {
        guard let token = app.auth.accessToken else { return }
        for rec in review.recommendations where rec.status == "delivered" {
            guard let id = rec.id else { continue }
            Task {
                struct Empty: Codable {}
                let _: APIClient.EmptyResponse? = try? await app.api.post(
                    "/v1/recommendations/\(id)/status",
                    body: ["status": "read"], token: token)
            }
        }
    }

    private func markActed(_ id: String) async {
        guard let token = app.auth.accessToken else { return }
        let _: APIClient.EmptyResponse? = try? await app.api.post(
            "/v1/recommendations/\(id)/status",
            body: ["status": "acted"], token: token)
        await load()
    }
}
