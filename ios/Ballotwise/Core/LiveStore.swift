import Foundation
import Observation

/// Live results for every tracked race, polled from /api/midterms. The server sends a weak ETag, so an unchanged
/// poll costs a 304 instead of the full half-megabyte overview. With a Decision Desk HQ account connected, results come
/// from /api/ddhq/live instead: the same overview with DDHQ's counts and calls laid over it, as the website shows them.
@Observable
final class LiveStore {
    private(set) var overview: Overview?
    private(set) var byId: [Int: Race] = [:]
    private(set) var error: String?
    private(set) var loading = false
    private(set) var photos: [String: String] = [:]
    /// When this device last got an answer from the server, changed or not.
    private(set) var checkedAt: Date?

    private var etag: String?

    /// Results come from this account's Decision Desk HQ connection. Set from AccountStore.ddhqConnected.
    var deskEnabled = false {
        didSet { if deskEnabled != oldValue { etag = nil } }
    }
    /// The results on screen are DDHQ's (false while DDHQ is off or didn't answer).
    var fromDesk: Bool { overview?.desk ?? false }

    var races: [Race] { overview?.races ?? [] }

    /// Every 30 seconds once polls open, every 2 minutes before. DDHQ is asked once a minute, as the website does.
    var pollInterval: Duration {
        if deskEnabled { return .seconds(60) }
        return Date.now >= Polls.firstPollsOpen ? .seconds(30) : .seconds(120)
    }

    func races(_ office: Office) -> [Race] { races.filter { $0.office == office } }

    func refresh() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        if deskEnabled {
            do {
                show(try await API.shared.get("/api/ddhq/live", as: Overview.self))
                checkedAt = .now
                error = nil
                return
            } catch {
                // DDHQ didn't answer or the connection lapsed: the public results stand in until the next poll.
                deskError = error.localizedDescription
            }
        } else {
            deskError = nil
        }
        do {
            if let (fresh, tag) = try await API.shared.getIfChanged("/api/midterms", etag: fromDesk ? nil : etag, as: Overview.self) {
                show(fresh)
                etag = tag
            }
            checkedAt = .now
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Why DDHQ's results aren't showing, while it's connected.
    private(set) var deskError: String?

    private func show(_ fresh: Overview) {
        overview = fresh
        byId = Dictionary(fresh.races.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }

    /// Polls while the calling task lives (the app is in the foreground).
    func poll() async {
        while !Task.isCancelled {
            await refresh()
            try? await Task.sleep(for: pollInterval)
        }
    }

    func loadPhotos() async {
        guard photos.isEmpty else { return }
        photos = (try? await API.shared.get("/api/midterms/photos", as: [String: String].self)) ?? [:]
    }

    func photo(_ race: Race, _ name: String) -> URL? { Format.photoURL(photos, race: race, name: name) }
}
