import Foundation

/// Which party holds each seat going into Nov 3, and which races are set to flip it. Mirrors the website's
/// lib/midterms/holders.ts and flipTo in lib/midterms/explore.ts. Resources/holders.json is a copy of
/// lib/midterms/holders.json (built by scripts/build-holders.mjs); copy it again when that changes.
nonisolated enum Holders {
    private struct Table: Decodable, Sendable {
        let senate: [String: String]
        let special: [String: String]
        let house: [String: String]
    }

    private static let table: Table? = Bundle.main.url(forResource: "holders", withExtension: "json")
        .flatMap { try? Data(contentsOf: $0) }
        .flatMap { try? JSONDecoder().decode(Table.self, from: $0) }

    /// The 36 governors whose seats are up, by party, as of October 2026.
    private static let governors: [String: String] = Dictionary(uniqueKeysWithValues:
        ["AZ", "CA", "CO", "CT", "HI", "IL", "KS", "MA", "MD", "ME", "MI", "MN", "NM", "NY", "OR", "PA", "RI", "WI"].map { ($0, "D") }
        + ["AK", "AL", "AR", "FL", "GA", "IA", "ID", "NE", "NH", "NV", "OH", "OK", "SC", "SD", "TN", "TX", "VT", "WY"].map { ($0, "R") })

    /// "D", "R" or "I" for the party holding a race's seat now; nil for measures and seats with no record.
    static func holder(_ r: Race) -> String? {
        switch r.office {
        case .senate:
            let special = r.title.localizedCaseInsensitiveContains("special")
            return (special ? table?.special : table?.senate)?[r.state]
        case .house: return table?.house["\(r.state)-\(r.district ?? 0)"]
        case .governor: return governors[r.state]
        case .measure: return nil
        }
    }

    /// The side a race is set to take from the party holding the seat: the winner or leader once votes are in, else
    /// the pre-election favorite. Nil for a hold, a toss-up, an early count, or a seat with no known holder.
    static func flipTo(_ r: Race) -> String? {
        guard let holder = holder(r) else { return nil }
        if let w = r.winner { return gain(side(w.party), holder) }
        if Format.lead(r.candidates) != nil {
            guard !Format.isEarly(r), let first = r.candidates.first, first.votes != r.candidates.dropFirst().first?.votes else { return nil }
            return gain(side(first.party), holder)
        }
        if r.rating == "tossup" { return nil }
        return favoredSide(r).flatMap { gain($0, holder) }
    }

    private static func gain(_ side: String, _ holder: String) -> String? { side == holder ? nil : side }

    private static func side(_ party: String) -> String {
        switch Format.party(party) {
        case .d: return "D"
        case .r: return "R"
        case .other: return "I"
        }
    }

    /// The forecast's favorite, else the rating's side; nil on a dead heat or a toss-up.
    private static func favoredSide(_ r: Race) -> String? {
        if let ranked = r.signal?.forecast?.odds.ranked, let top = ranked.first, ranked.count < 2 || ranked[1].p != top.p { return top.side }
        guard let rating = r.rating, rating != "tossup" else { return nil }
        return rating.hasSuffix("-d") ? "D" : rating.hasSuffix("-r") ? "R" : "I"
    }
}
