import Foundation
import Observation

/// Live results for every tracked race, polled from /api/midterms. The server sends a weak ETag, so an unchanged
/// poll costs a 304 instead of the full half-megabyte overview.
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

    var races: [Race] { overview?.races ?? [] }

    /// Every 30 seconds once polls open, every 2 minutes before.
    var pollInterval: Duration { Date.now >= Polls.firstPollsOpen ? .seconds(30) : .seconds(120) }

    func races(_ office: Office) -> [Race] { races.filter { $0.office == office } }

    func refresh() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        do {
            if let (fresh, tag) = try await API.shared.getIfChanged("/api/midterms", etag: etag, as: Overview.self) {
                overview = fresh
                byId = Dictionary(fresh.races.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
                etag = tag
            }
            checkedAt = .now
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
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
