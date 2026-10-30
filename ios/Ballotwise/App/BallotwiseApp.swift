import SwiftUI
import UserNotifications

@main
struct BallotwiseApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var live = LiveStore()
    @State private var account = AccountStore()
    @State private var forecast = ForecastStore()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(live)
                .environment(account)
                .environment(forecast)
                .environment(delegate.push)
                .tint(.flagBlue)
                .task {
                    let push = delegate.push
                    push.starred = { [account] in account.starred }
                    account.onStarsChanged = { push.scheduleRegister() }
                    await account.load()
                    await push.refreshAuthorization()
                }
                .task(id: phase) {
                    // Results poll only while the app is on screen; alerts cover the rest.
                    guard phase == .active else { return }
                    await live.poll()
                }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    let push = PushManager()

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        push.didRegister(deviceToken: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        push.didFail(error)
    }

    /// Shows alerts while the app is open too: a call matters even if you're looking at another race.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let raceId = response.notification.request.content.userInfo["raceId"] as? Int
        await MainActor.run { push.openRaceId = raceId }
    }
}
