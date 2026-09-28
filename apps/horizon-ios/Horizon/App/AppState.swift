import Foundation
import SwiftData
import Observation
import HorizonKit

/// Single app-level source of truth, injected via .environment (house pattern).
@Observable @MainActor
final class AppState {

    // MARK: Navigation
    enum Tab: Hashable { case review, dashboard, goals, log, settings }
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
        didSet {
            UserDefaults.standard.set(sleepNeedMin, forKey: "horizon.sleepNeedMin")
            UserDefaults.standard.set(true, forKey: "horizon.healthTargetsPending")
        }
    }
    var proteinTargetG: Int {
        didSet {
            UserDefaults.standard.set(proteinTargetG, forKey: "horizon.proteinTargetG")
            UserDefaults.standard.set(true, forKey: "horizon.healthTargetsPending")
        }
    }

    // MARK: Services
    private(set) var auth = AuthService()
    private(set) var healthKit = HealthKitService()
    private(set) var api = APIClient()
    private(set) var sync: SyncEngine?
    private var modelContainer: ModelContainer?

    var lastSyncAt: Date?
    var lastSyncError: String?
    var goalsSyncError: String?
    var hasGoalConflict = false
    var localStoreUnavailable = false

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
        if let owner = UserDefaults.standard.string(forKey: "horizon.pendingGoalPurgeOwner") {
            _ = purgeGoals(for: owner)
        }
    }

    @discardableResult
    func purgeGoals(for owner: String) -> Bool {
        guard let modelContainer else { return false }
        UserDefaults.standard.set(owner, forKey: "horizon.pendingGoalPurgeOwner")
        do {
            let context = ModelContext(modelContainer)
            for goal in try context.fetch(FetchDescriptor<WeeklyGoalRecord>())
                where goal.ownerID == owner {
                context.delete(goal)
            }
            try context.save()
            UserDefaults.standard.removeObject(forKey: "horizon.pendingGoalPurgeOwner")
            return true
        } catch {
            return false
        }
    }

    func onLaunch() async {
        isAuthenticated = await auth.restoreSession()
        guard hasConsented, isAuthenticated else { return }
        prepareHealthTargetsForCurrentUser()
        await reconcileHealthTargets()
        await syncGoals()
        healthKit.startObservers { [weak self] in
            await self?.refreshFromHealthKit()
        }
        await refreshFromHealthKit()
    }

    func prepareHealthTargetsForCurrentUser() {
        guard let owner = auth.userID else { return }
        let defaults = UserDefaults.standard
        if let previous = defaults.string(forKey: "horizon.healthTargetsOwnerID"),
           previous != owner {
            sleepNeedMin = 450
            proteinTargetG = 140
            defaults.set(false, forKey: "horizon.healthTargetsPending")
        }
        defaults.set(owner, forKey: "horizon.healthTargetsOwnerID")
    }

    func syncGoals() async {
        guard isAuthenticated, let sync else { return }
        do {
            try await sync.syncWeeklyGoals()
            goalsSyncError = nil
            hasGoalConflict = false
        } catch ApiError.badStatus(409, _) {
            hasGoalConflict = true
            goalsSyncError = "A goal changed on another device. Choose which version to keep."
        } catch {
            goalsSyncError = "Goals are saved on this device. They'll sync when you reconnect."
        }
    }

    func resolveGoalConflicts(keepLocal: Bool) async {
        guard let sync else { return }
        do {
            try await sync.resolveWeeklyGoalConflicts(keepLocal: keepLocal)
            await syncGoals()
        } catch {
            goalsSyncError = "Couldn't resolve the goal conflict. Please try again."
        }
    }

    /// Local edits survive a failed request and are retried at the next launch.
    func saveHealthTargets() async -> Bool {
        guard let token = auth.accessToken else { return false }
        UserDefaults.standard.set(true, forKey: "horizon.healthTargetsPending")
        struct ProfileBody: Encodable {
            let timezone: String
            let goals: Goals
            struct Goals: Encodable { let sleepNeedMin: Int; let proteinTargetG: Int }
        }
        do {
            let _: APIClient.EmptyResponse = try await api.put(
                "/v1/profile",
                body: ProfileBody(timezone: timezoneID,
                    goals: .init(sleepNeedMin: sleepNeedMin, proteinTargetG: proteinTargetG)),
                token: token)
            UserDefaults.standard.set(false, forKey: "horizon.healthTargetsPending")
            return true
        } catch {
            return false
        }
    }

    private func reconcileHealthTargets() async {
        guard let token = auth.accessToken else { return }
        if UserDefaults.standard.bool(forKey: "horizon.healthTargetsPending") {
            _ = await saveHealthTargets()
            return
        }
        struct Profile: Decodable {
            let goalsJson: Goals
            struct Goals: Decodable {
                let sleepNeedMin: Int?
                let proteinTargetG: Int?
            }
        }
        do {
            let profile: Profile = try await api.get("/v1/profile", token: token)
            if let sleep = profile.goalsJson.sleepNeedMin { sleepNeedMin = sleep }
            if let protein = profile.goalsJson.proteinTargetG { proteinTargetG = protein }
            UserDefaults.standard.set(false, forKey: "horizon.healthTargetsPending")
        } catch ApiError.badStatus(404, _) {
            _ = await saveHealthTargets()
        } catch {
            // Read failed; local values remain available and we retry next launch.
        }
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

    /// Upload the APNs device token so the weekly job can notify this device.
    func uploadPushToken(_ token: String) async {
        guard let auth = auth.accessToken else { return }
        struct TokenBody: Encodable { let apnsToken: String }
        let _: APIClient.EmptyResponse? = try? await api.put(
            "/v1/profile", body: TokenBody(apnsToken: token), token: auth)
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
