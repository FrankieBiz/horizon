import SwiftUI
import UIKit
import UserNotifications

/// APNs registration + notification-tap routing. The push payload is
/// content-free (title + "Your weekly review is ready." + deep_link) — the
/// review itself is fetched over the authenticated API when the app opens.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    /// Set by HorizonApp so token/tap events reach app state.
    static weak var appState: AppState?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in
            await Self.appState?.uploadPushToken(token)
        }
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Push is optional; reviews remain fetchable in-app.
    }

    // Tap on the weekly push → route to the Review tab.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse) async {
        let userInfo = response.notification.request.content.userInfo
        if let link = userInfo["deep_link"] as? String, let url = URL(string: link) {
            await MainActor.run { Self.appState?.handleDeepLink(url) }
        } else {
            await MainActor.run { Self.appState?.selectedTab = .review }
        }
    }

    // Monday-morning push while the app is foregrounded: still show it.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}

enum PushRegistration {
    /// Ask once after onboarding completes; registers with APNs on grant.
    @MainActor
    static func requestAuthorizationAndRegister() async {
        let center = UNUserNotificationCenter.current()
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        guard granted else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }
}
