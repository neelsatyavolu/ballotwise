import SwiftUI

/// What the wall's map is shaded by. The country can show results or the forecast; a state's counties can show
/// results, the 2024 presidential vote, or how far each county has swung since then.
enum WallLens: String, CaseIterable, Identifiable {
    case results, forecast, past, shift
    var id: String { rawValue }

    var label: String {
        switch self {
        case .results: "Results"
        case .forecast: "Forecast"
        case .past: "2024"
        case .shift: "Swing"
        }
    }

    static func available(counties: Bool) -> [WallLens] { counties ? [.results, .past, .shift] : [.results, .forecast] }
}

nonisolated enum WallLogic {
    /// Map units to screen points: `focus` fitted and centered in `size` with `inset` to spare, then the user's
    /// pinch (`zoom` around the center) and drag (`pan`).
    static func camera(_ focus: CGRect, in size: CGSize, inset: CGFloat = 28, zoom: CGFloat = 1, pan: CGSize = .zero) -> CGAffineTransform {
        let w = max(size.width - inset * 2, 1), h = max(size.height - inset * 2, 1)
        let fit = min(w / max(focus.width, 1), h / max(focus.height, 1))
        let base = CGAffineTransform(a: fit, b: 0, c: 0, d: fit, tx: size.width / 2 - focus.midX * fit, ty: size.height / 2 - focus.midY * fit)
        let user = CGAffineTransform(translationX: size.width / 2 + pan.width, y: size.height / 2 + pan.height)
            .scaledBy(x: zoom, y: zoom)
            .translatedBy(x: -size.width / 2, y: -size.height / 2)
        return base.concatenating(user)
    }

    /// Democrat's share minus Republican's, in points; nil without both parties on the ballot.
    static func twoWay(_ candidates: [Candidate]) -> Double? {
        guard let d = candidates.first(where: { Format.party($0.party) == .d }),
              let r = candidates.first(where: { Format.party($0.party) == .r }) else { return nil }
        return d.pct - r.pct
    }

    /// How far a county has moved since the 2024 presidential vote, positive toward Democrats. Nil until it has votes.
    static func swing(_ county: County) -> Double? {
        guard county.total > 0, let now = twoWay(county.candidates), let then = county.baseline2024 else { return nil }
        return now - then
    }

    /// One office's uncalled races worth watching: the closest once three or more are well into the count, else
    /// the forecast's most competitive.
    static func watchList(_ races: [Race], office: Office, limit: Int = 8) -> [Race] {
        let pool = races.filter { $0.office == office && !$0.isCalled }
        let counting = pool.filter { $0.total > 0 && !Format.isEarly($0) }
        if counting.count >= 3 {
            return Array(counting.sorted { (Format.lead($0.candidates)?.margin ?? 100) < (Format.lead($1.candidates)?.margin ?? 100) }.prefix(limit))
        }
        return Array(pool.filter { $0.rating != nil }.sorted(by: Format.compare).prefix(limit))
    }

    /// A race's name as a network's board reads it: "California 18th District", "Ohio Senate (special)".
    static func title(_ r: Race) -> String {
        guard r.office == .house else { return Format.label(r) }
        let state = Format.stateName(r.state)
        guard let d = r.district, d > 0 else { return "\(state) At-Large District" }
        let ordinal = NumberFormatter()
        ordinal.numberStyle = .ordinal
        ordinal.locale = Locale(identifier: "en_US")
        return "\(state) \(ordinal.string(from: d as NSNumber) ?? "\(d)") District"
    }

    /// "2026 Senate", "2026 House", "2026 Governor".
    static func subtitle(_ r: Race) -> String {
        "2026 " + (r.office == .house ? "House" : r.office == .governor ? "Governor" : r.office == .senate ? "Senate" : "Measure")
    }

    /// The line under a results table, as on the website's cards: called, the lead, when the state's polls close,
    /// or no results yet.
    static func status(_ candidates: [Candidate], state: String, now: Date = .now) -> String {
        if candidates.contains(where: \.isWinner) { return "Called" }
        if let lead = Format.lead(candidates) { return "Lead \(String(format: "%.1f", lead.margin)) pts" }
        if let close = Polls.final(state), close > now {
            return "Polls close \(close.formatted(.dateTime.hour().minute().timeZone(.specificName(.short))))"
        }
        return "No results yet"
    }
}

extension Theme {
    /// A race by its forecast alone, even once votes are in: its rating, else safe for the favorite.
    static func forecastFill(_ r: Race) -> Color {
        if r.rating != nil { return ratingColor(r.rating) }
        if let top = r.signal?.forecast?.odds.ranked.first { return top.side == "D" ? .safeD : top.side == "R" ? .safeR : .oth }
        return .unrated
    }

    /// The 2024 presidential margin, D positive, deeper the wider it was.
    static func pastFill(_ county: County?) -> Color {
        guard let m = county?.baseline2024 else { return .unrated.opacity(0.4) }
        let strength = abs(m) >= 30 ? 0.9 : abs(m) >= 15 ? 0.7 : abs(m) >= 5 ? 0.5 : 0.3
        return (m > 0 ? Color.dem : Color.rep).opacity(strength)
    }

    /// The swing since 2024: blue toward Democrats, red toward Republicans, grey before votes.
    static func swingFill(_ county: County?) -> Color {
        guard let county, let s = WallLogic.swing(county) else { return .unrated.opacity(0.4) }
        let strength = abs(s) >= 10 ? 0.9 : abs(s) >= 5 ? 0.65 : abs(s) >= 2 ? 0.4 : 0.18
        return (s > 0 ? Color.dem : Color.rep).opacity(strength)
    }
}
