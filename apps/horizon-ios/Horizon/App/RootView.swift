import SwiftUI

/// Single top-level fork on auth/onboarding state (house pattern) —
/// no scattered per-screen gating.
struct RootView: View {
    @Environment(AppState.self) private var app

    var body: some View {
        Group {
            if !app.hasCompletedOnboarding || !app.isAuthenticated {
                OnboardingView()
            } else {
                MainTabView()
            }
        }
        .animation(.default, value: app.hasCompletedOnboarding)
        .animation(.default, value: app.isAuthenticated)
    }
}

struct MainTabView: View {
    var body: some View {
        TabView {
            TodayView()
                .tabItem { Label("Today", systemImage: "heart.text.square") }
            ManualEntryHubView()
                .tabItem { Label("Log", systemImage: "square.and.pencil") }
        }
    }
}
