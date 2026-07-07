import SwiftUI
import SwiftData

@main
struct HorizonApp: App {
    @State private var appState = AppState()
    let container: ModelContainer

    init() {
        // Resilient container init (house pattern): try disk → wipe & retry → in-memory.
        // Launch must never fatalError.
        let schema = Schema(LocalStore.models)
        do {
            container = try ModelContainer(for: schema)
        } catch {
            let url = URL.applicationSupportDirectory.appending(path: "default.store")
            try? FileManager.default.removeItem(at: url)
            if let retried = try? ModelContainer(for: schema) {
                container = retried
            } else {
                let memoryOnly = ModelConfiguration(isStoredInMemoryOnly: true)
                container = try! ModelContainer(for: schema, configurations: memoryOnly)
            }
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appState)
                .modelContainer(container)
                .task {
                    appState.configure(modelContainer: container)
                    await appState.onLaunch()
                }
        }
    }
}
