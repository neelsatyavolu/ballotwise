import Foundation
import Observation
import UIKit
import UserNotifications

/// Which alerts this device wants. Sent to /api/push with the device token; the server's cron job does the sending.
nonisolated struct AlertSettings: Codable, Sendable, Equatable {
    var starred = true
    var control = true
    var allCalls = false
    var pollClose = true
}

@Observable
final class PushManager {
    private(set) var authorization: UNAuthorizationStatus = .notDetermined
    private(set) var token: String?
    private(set) var error: String?
    var settings: AlertSettings {
        didSet { if settings != oldValue { save(); scheduleRegister() } }
    }
    var homeState: String? {
        didSet { if homeState != oldValue { save(); scheduleRegister() } }
    }
    private var pending: Task<Void, Never>?
    /// A race to open, set when the voter taps a notification.
    var openRaceId: Int?

    /// Supplies the starred race ids at registration time.
    var starred: () -> [Int] = { [] }

    private enum Keys { static let settings = "alertSettings"; static let home = "homeState" }

    #if DEBUG
    private let environment = "sandbox"
    #else
    private let environment = "production"
    #endif

    init() {
        let d = UserDefaults.standard
        settings = d.data(forKey: Keys.settings).flatMap { try? JSONDecoder().decode(AlertSettings.self, from: $0) } ?? AlertSettings()
        homeState = d.string(forKey: Keys.home)
    }

    private func save() {
        UserDefaults.standard.set(try? JSONEncoder().encode(settings), forKey: Keys.settings)
        UserDefaults.standard.set(homeState, forKey: Keys.home)
    }

    func refreshAuthorization() async {
        authorization = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        if authorization == .authorized || authorization == .provisional || authorization == .ephemeral {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    /// Asks for permission (once; after that only Settings can change it) and registers with APNs.
    func requestPermission() async {
        do {
            _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        } catch {
            self.error = error.localizedDescription
        }
        await refreshAuthorization()
    }

    func didRegister(deviceToken: Data) {
        token = deviceToken.map { String(format: "%02x", $0) }.joined()
        scheduleRegister()
    }

    /// Registers a moment after the last change, so flipping several toggles or stars sends one request.
    func scheduleRegister() {
        pending?.cancel()
        pending = Task {
            try? await Task.sleep(for: .seconds(1.5))
            guard !Task.isCancelled else { return }
            await register()
        }
    }

    func didFail(_ error: Error) {
        self.error = "Couldn't set up alerts: \(error.localizedDescription)"
    }

    /// Sends this device's token and choices to the server. Safe to call often; the server upserts.
    func register() async {
        guard let token else { return }
        nonisolated struct Body: Encodable, Sendable {
            let token: String
            let environment: String
            let alerts: AlertSettings
            let starred: [Int]
            let homeState: String?
        }
        let body = Body(token: token, environment: environment, alerts: settings, starred: Array(starred().prefix(200)), homeState: homeState)
        do {
            _ = try await API.shared.send("POST", "/api/push", body: body, as: OK.self)
            error = nil
        } catch {
            self.error = "Couldn't save alert settings: \(error.localizedDescription)"
        }
    }
}
