import Foundation
import SwiftData
import Observation
import HorizonKit

/// Single app-level source of truth, injected via .environment (house pattern).
@Observable @MainActor
final class AppState {

    // MARK: Navigation
    enum Tab: Hashable { case review, dashboard, log, settings }
    var selectedTab: Tab = .review

    /// horizon://review/<weekStart> deep link (from the weekly push).
    func handleDeepLink(_ url: URL) {
        guard url.scheme == "horizon" else { return }
        if url.host() == "review" { selectedTab = .review }
    }

    // MARK: Gating flags (drive RootView's top-level fork)
    var isAuthenticated = false
    var hasConsented: Bool {
        didSet { UserDefaults.standard.set(hasConsented, forKey: "horizon.hasConsented") }
    }
    var hasCompletedOnboarding: Bool {
        didSet { UserDefaults.standard.set(hasCompletedOnboarding, forKey: "horizon.hasCompletedOnboarding") }
    }

    // MARK: Profile / goals (mirrored to UserDefaults; synced to profile later)
    var timezoneID: String = TimeZone.current.identifier
    var sleepNeedMin: Int {
        didSet { UserDefaults.standard.set(sleepNeedMin, forKey: "horizon.sleepNeedMin") }
    }
    var proteinTargetG: Int {
        didSet { UserDefaults.standard.set(proteinTargetG, forKey: "horizon.proteinTargetG") }
    }

    // MARK: Services
    private(set) var auth = AuthService()
    private(set) var healthKit = HealthKitService()
    private(set) var api = APIClient()
    private(set) var sync: SyncEngine?
    private var modelContainer: ModelContainer?

    var lastSyncAt: Date?
    var lastSyncError: String?

    init() {
        let d = UserDefaults.standard
        hasConsented = d.bool(forKey: "horizon.hasConsented")
        hasCompletedOnboarding = d.bool(forKey: "horizon.hasCompletedOnboarding")
        sleepNeedMin = d.object(forKey: "horizon.sleepNeedMin") as? Int ?? 450
        proteinTargetG = d.object(forKey: "horizon.proteinTargetG") as? Int ?? 140
    }

    func configure(modelContainer: ModelContainer) {
        self.modelContainer = modelContainer
        self.sync = SyncEngine(container: modelContainer, api: api, auth: auth)
    }

    func onLaunch() async {
        isAuthenticated = await auth.restoreSession()
        guard hasConsented, isAuthenticated else { return }
        healthKit.startObservers { [weak self] in
            await self?.refreshFromHealthKit()
        }
        await refreshFromHealthKit()
    }

    /// Pull new HealthKit data → normalize → store locally → sync in background.
    /// Local-first: the store write always succeeds even if the network doesn't.
    func refreshFromHealthKit() async {
        guard hasConsented, let container = modelContainer else { return }
        do {
            let tz = TimeZone(identifier: timezoneID) ?? .current
            let batch = try await healthKit.fetchNewSamples()
            let store = LocalStore(container: container)
            try await store.upsert(
                sleep: Normalizer.sleepDays(batch.sleep, timeZone: tz),
                vitals: Normalizer.vitalsDays(batch.quantities, timeZone: tz),
                activity: Normalizer.activityDays(batch.quantities, timeZone: tz),
                nutrition: Normalizer.nutritionDays(batch.quantities, timeZone: tz),
                body: Normalizer.bodyDays(batch.quantities, timeZone: tz),
                workouts: Normalizer.dedupedWorkouts(batch.workouts)
            )
            await pushSync()
            healthKit.commitAnchors(from: batch)
        } catch {
            lastSyncError = String(describing: error)
        }
    }

    func pushSync() async {
        guard isAuthenticated, let sync else { return }
        do {
            try await sync.pushPending()
            lastSyncAt = .now
            lastSyncError = nil
        } catch {
            lastSyncError = String(describing: error) // retried on next refresh
        }
    }
}
