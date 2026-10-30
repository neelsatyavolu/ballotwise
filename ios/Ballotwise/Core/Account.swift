import Foundation
import Observation

/// The voter's Ballotwise account (the same one as the website) and the races they starred.
/// Stars live on the device so alerts work without an account; signing in merges them with the account's.
@Observable
final class AccountStore {
    private(set) var me: Me?
    private(set) var starred: [Int] = UserDefaults.standard.array(forKey: Keys.starred) as? [Int] ?? []
    /// Called after stars change, so push registration can follow them.
    var onStarsChanged: (() -> Void)?

    var user: User? { me?.user }
    var grokConnected: Bool { me?.grok == "connected" }

    private enum Keys { static let starred = "starredRaceIds" }
    static let maxStars = 200

    func isStarred(_ id: Int) -> Bool { starred.contains(id) }

    func load() async {
        me = try? await API.shared.get("/api/account/me", as: Me.self)
        if user != nil { await syncStars() }
    }

    func signIn(email: String, password: String, create: Bool) async throws {
        // Creating an account means accepting the Terms and Privacy Policy, which the sign-up screen links to.
        nonisolated struct Body: Encodable, Sendable { let email: String; let password: String; let acceptTerms: Bool? }
        nonisolated struct Reply: Decodable, Sendable { let user: User }
        let body = Body(email: email, password: password, acceptTerms: create ? true : nil)
        _ = try await API.shared.send("POST", create ? "/api/account/signup" : "/api/account/signin", body: body, as: Reply.self)
        await load()
    }

    func signOut() async {
        _ = try? await API.shared.send("POST", "/api/account/signout", body: Empty(), as: OK.self)
        API.shared.signOutLocally()
        me = nil
    }

    func toggleStar(_ id: Int) {
        if let i = starred.firstIndex(of: id) {
            starred.remove(at: i)
            if user != nil { Task { await self.removeRemote(id) } }
        } else {
            guard starred.count < Self.maxStars else { return }
            starred.append(id)
            if user != nil { Task { await self.addRemote([id]) } }
        }
        save()
    }

    private func save() {
        UserDefaults.standard.set(starred, forKey: Keys.starred)
        onStarsChanged?()
    }

    nonisolated private struct Favorites: Decodable, Sendable { let raceIds: [Int] }

    /// Puts this device's stars on the account and the account's on this device.
    private func syncStars() async {
        guard let remote = try? await API.shared.get("/api/midterms/favorites", as: Favorites.self) else { return }
        let missing = starred.filter { !remote.raceIds.contains($0) }
        if !missing.isEmpty { await addRemote(missing) }
        let merged = Array(NSOrderedSet(array: starred + remote.raceIds)) as? [Int] ?? starred
        if merged != starred {
            starred = merged
            save()
        }
    }

    private func addRemote(_ ids: [Int]) async {
        nonisolated struct Body: Encodable, Sendable { let raceIds: [Int] }
        _ = try? await API.shared.send("POST", "/api/midterms/favorites", body: Body(raceIds: ids), as: Favorites.self)
    }

    private func removeRemote(_ id: Int) async {
        nonisolated struct Body: Encodable, Sendable { let raceId: Int }
        _ = try? await API.shared.send("DELETE", "/api/midterms/favorites", body: Body(raceId: id), as: Favorites.self)
    }
}
