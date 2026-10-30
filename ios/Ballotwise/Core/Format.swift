import Foundation

// Display rules ported from lib/midterms/view.ts so the app reads races the same way the website does.

nonisolated enum Format {
    static let stateNames: [String: String] = [
        "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
        "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia",
        "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
        "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts",
        "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
        "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico",
        "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
        "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
        "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
        "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
    ]
    static let states: [String] = stateNames.keys.filter { $0 != "DC" }.sorted { stateNames[$0]! < stateNames[$1]! }

    static func stateName(_ code: String) -> String { stateNames[code] ?? code }

    static let ratingLabel: [String: String] = [
        "tossup": "Toss-up", "lean-d": "Lean D", "lean-r": "Lean R", "lean-i": "Lean I",
        "likely-d": "Likely D", "likely-r": "Likely R", "likely-i": "Likely I",
    ]
    /// Most competitive first.
    static let ratingOrder = ["tossup", "lean-d", "lean-r", "lean-i", "likely-d", "likely-r", "likely-i"]

    static func party(_ party: String) -> Party {
        if party.range(of: "^Democrat", options: [.regularExpression, .caseInsensitive]) != nil { return .d }
        if party.range(of: "^Republican", options: [.regularExpression, .caseInsensitive]) != nil { return .r }
        return .other
    }

    /// Short party tag: D, R, or the first letters of anything else; empty for nonpartisan.
    static func partyTag(_ p: String) -> String {
        switch party(p) {
        case .d: return "D"
        case .r: return "R"
        case .other:
            if p.isEmpty || p.range(of: "nonpartisan", options: .caseInsensitive) != nil { return "" }
            return p.count <= 4 ? p : String(p.prefix(3))
        }
    }

    static func isYes(_ name: String) -> Bool { name.caseInsensitiveCompare("yes") == .orderedSame }
    static func isNo(_ name: String) -> Bool { name.caseInsensitiveCompare("no") == .orderedSame }

    static func label(_ r: Race) -> String {
        let state = stateName(r.state)
        switch r.office {
        case .senate: return "\(state) Senate" + (r.title.range(of: "special", options: .caseInsensitive) != nil ? " (special)" : "")
        case .governor: return "\(state) Governor"
        case .house: return r.district == 0 ? "\(r.state) at-large" : "\(r.state)-\(r.district ?? 0)"
        case .measure:
            let name = r.title.components(separatedBy: " - ").first ?? r.title
            return name.hasPrefix(state + " ") ? String(name.dropFirst(state.count + 1)).trimmingCharacters(in: .whitespaces) : name
        }
    }

    /// The leader and their lead over second place, in points, from raw votes; nil before any votes.
    static func lead(_ candidates: [Candidate]) -> (leader: Candidate, margin: Double)? {
        guard let first = candidates.first, first.votes > 0 else { return nil }
        let total = candidates.reduce(0) { $0 + $1.votes }
        let second = candidates.dropFirst().first?.votes ?? 0
        return (first, Double(first.votes - second) / Double(total) * 100)
    }

    static func marginLabel(_ dMinusR: Double) -> String {
        if abs(dMinusR) < 0.05 { return "Even" }
        return "\(dMinusR > 0 ? "D" : "R")+\(String(format: "%.1f", abs(dMinusR)))"
    }

    static let earlyReporting = 25.0

    static func isEarly(_ r: Race) -> Bool {
        r.total > 0 && !r.isCalled && !(r.reportingUnknown ?? false) && r.reporting < earlyReporting
    }

    static func votes(_ n: Int) -> String { n.formatted(.number) }
    static func pct(_ n: Double) -> String { String(format: "%.1f%%", n) }
    static func chance(_ p: Double) -> String { p >= 0.995 ? ">99%" : p <= 0.005 ? "<1%" : "\(Int((p * 100).rounded()))%" }

    static func reporting(_ r: Race) -> String {
        if r.total == 0 { return "No votes yet" }
        if r.reportingUnknown ?? false { return "\(votes(r.total)) votes" }
        return "\(Int(r.reporting.rounded()))% reporting"
    }

    // MARK: Forecast

    private static let sideParty: [String: String] = ["D": "^democrat", "R": "^republican", "I": "independent"]

    /// The candidate who carries `side`'s chance: the forecast's named nominee, else the party's incumbent, else the top vote-getter.
    static func nominee(_ candidates: [Candidate], side: String, forecast: RaceForecastSignal?) -> Candidate? {
        guard let pattern = sideParty[side] else { return nil }
        let pool = candidates.filter { $0.party.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil }
        var named: String?
        if let names = forecast?.names { named = side == "R" ? names.right : side == forecast?.left ? names.left : nil }
        if let named, let c = pool.first(where: { $0.name == named }) { return c }
        return pool.first(where: \.isIncumbent) ?? pool.max { $0.votes < $1.votes }
    }

    /// Candidates in display order: the count's order once votes are in; before then, the forecast's contenders first.
    static func ballotOrder(_ r: Race) -> [Candidate] {
        guard r.total == 0, let f = r.signal?.forecast else { return r.candidates }
        var first: [Candidate] = []
        for (side, _) in f.odds.ranked {
            if let c = nominee(r.candidates, side: side, forecast: f), !first.contains(c) { first.append(c) }
        }
        return first + r.candidates.filter { !first.contains($0) }
    }

    static func lastName(_ name: String) -> String {
        let cleaned = name.replacingOccurrences(of: "[\"“][^\"”]*[\"”]", with: " ", options: .regularExpression)
            .replacingOccurrences(of: "\\b(Jr|Sr|II|III|IV)\\.?$", with: "", options: [.regularExpression, .caseInsensitive])
            .trimmingCharacters(in: .whitespaces)
        return cleaned.split(separator: " ").last.map(String.init) ?? name
    }

    /// "Talarico 64%", or nil without a forecast or on a dead heat.
    static func forecastLeader(_ r: Race) -> String? {
        guard let f = r.signal?.forecast else { return nil }
        let ranked = f.odds.ranked
        guard let top = ranked.first, ranked.count < 2 || ranked[1].p != top.p else { return nil }
        let who = nominee(r.candidates, side: top.side, forecast: f).map { lastName($0.name) } ?? ["D": "Dem", "R": "Rep", "I": "Ind"][top.side]!
        return "\(who) \(chance(top.p))"
    }

    static func favoriteChance(_ r: Race) -> Double { r.signal?.forecast?.odds.ranked.first?.p ?? 1 }

    /// Rated races by competitiveness, then by how close the forecast is, then state and district.
    static func compare(_ a: Race, _ b: Race) -> Bool {
        let ra = a.rating.flatMap { ratingOrder.firstIndex(of: $0) } ?? 99
        let rb = b.rating.flatMap { ratingOrder.firstIndex(of: $0) } ?? 99
        if ra != rb { return ra < rb }
        let fa = favoriteChance(a), fb = favoriteChance(b)
        if fa != fb { return fa < fb }
        if a.state != b.state { return a.state < b.state }
        if (a.district ?? 0) != (b.district ?? 0) { return (a.district ?? 0) < (b.district ?? 0) }
        return a.title < b.title
    }

    // MARK: Time

    static func day(_ s: String) -> Date? {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        return f.date(from: s)
    }

    static func ago(_ ms: Double, now: Date = .now) -> String {
        let s = max(0, Int(now.timeIntervalSince1970 - ms / 1000))
        if s < 60 { return "\(s)s ago" }
        let m = s / 60
        return m < 60 ? "\(m) min ago" : "\(m / 60) hr ago"
    }

    static func eastern(_ date: Date, withDay: Bool = false) -> String {
        let f = DateFormatter()
        f.timeZone = TimeZone(identifier: "America/New_York")
        f.dateFormat = withDay ? "MMM d, h:mm a" : "h:mm a"
        return f.string(from: date) + " ET"
    }

    // MARK: Photos

    /// A candidate's photo URL from the table at /api/midterms/photos (see lib/midterms/photos.ts).
    static func photoURL(_ table: [String: String], race: Race, name: String) -> URL? {
        let key = "\(race.office.rawValue):\(race.state):\(race.office == .house ? String(race.district ?? 0) : "")|\(name)"
        guard let entry = table[key], entry.count > 2 else { return nil }
        let ref = String(entry.dropFirst(2))
        if entry.hasPrefix("c:") { return URL(string: "https://unitedstates.github.io/images/congress/225x275/\(ref).jpg") }
        if entry.hasPrefix("b:") { return API.base.appendingPathComponent("midterms/photos/\(ref)") }
        let encoded = ref.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? ref
        return URL(string: "https://commons.wikimedia.org/wiki/Special:FilePath/\(encoded)?width=192")
    }
}
