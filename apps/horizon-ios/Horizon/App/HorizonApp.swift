import SwiftUI
import SwiftData

@main
struct HorizonApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var appState = AppState()
    let container: ModelContainer
    let isMemoryOnly: Bool

    init() {
        // Never erase the on-disk store after a schema or migration failure.
        // An in-memory session keeps the app launchable while preserving the data
        // for recovery on a later launch.
        let schema = Schema(LocalStore.models)
        do {
            container = try ModelContainer(for: schema)
            isMemoryOnly = false
        } catch {
            let memoryOnly = ModelConfiguration(isStoredInMemoryOnly: true)
            container = try! ModelContainer(for: schema, configurations: memoryOnly)
            isMemoryOnly = true
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appState)
                .modelContainer(container)
                .task {
                    AppDelegate.appState = appState
                    appState.localStoreUnavailable = isMemoryOnly
                    appState.configure(modelContainer: container)
                    await appState.onLaunch()
                    if appState.hasCompletedOnboarding, appState.isAuthenticated {
                        await PushRegistration.requestAuthorizationAndRegister()
                    }
                }
                .onOpenURL { url in
                    appState.handleDeepLink(url)
                }
        }
    }
}
