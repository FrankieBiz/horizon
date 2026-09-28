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
    @Environment(AppState.self) private var app

    var body: some View {
        @Bindable var app = app
        TabView(selection: $app.selectedTab) {
            WeeklyReviewView()
                .tabItem { Label("Review", systemImage: "sparkles") }
                .tag(AppState.Tab.review)
            DashboardView()
                .tabItem { Label("Dashboard", systemImage: "chart.line.uptrend.xyaxis") }
                .tag(AppState.Tab.dashboard)
            WeeklyGoalsView()
                .tabItem { Label("Goals", systemImage: "checkmark.circle") }
                .tag(AppState.Tab.goals)
            ManualEntryHubView()
                .tabItem { Label("Log", systemImage: "square.and.pencil") }
                .tag(AppState.Tab.log)
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .tag(AppState.Tab.settings)
        }
    }
}
