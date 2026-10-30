import Foundation

/// When polls close on Nov 3, 2026, ported from lib/midterms/polls.ts (270toWin's table).
nonisolated enum Polls {
    /// Midnight Eastern at the start of Nov 3 (Eastern is UTC-5 after daylight time ends Nov 1).
    static let electionDayStart = Date(timeIntervalSince1970: 1_793_682_000) // 2026-11-03T05:00:00Z
    /// The first polls open at 6 a.m. Eastern.
    static let firstPollsOpen = electionDayStart.addingTimeInterval(6 * 3600)

    /// Hours after that midnight when most of a state's polls close, and when the rest do for split states.
    static let close: [String: (Double, Double?)] = [
        "IN": (18, 19), "KY": (18, 19),
        "FL": (19, 20), "GA": (19, nil), "NH": (19, 20), "SC": (19, nil), "VT": (19, nil), "VA": (19, nil),
        "NC": (19.5, nil), "OH": (19.5, nil), "WV": (19.5, nil),
        "AL": (20, nil), "CT": (20, nil), "DE": (20, nil), "DC": (20, nil), "IL": (20, nil), "KS": (20, 21), "ME": (20, nil),
        "MD": (20, nil), "MA": (20, nil), "MI": (20, 21), "MS": (20, nil), "MO": (20, nil), "NJ": (20, nil), "ND": (20, 21),
        "OK": (20, nil), "PA": (20, nil), "RI": (20, nil), "SD": (20, 21), "TN": (20, nil), "TX": (20, 21),
        "AR": (20.5, nil),
        "AZ": (21, nil), "CO": (21, nil), "IA": (21, nil), "LA": (21, nil), "MN": (21, nil), "NE": (21, nil), "NM": (21, nil),
        "NY": (21, nil), "WI": (21, nil), "WY": (21, nil),
        "ID": (22, 23), "MT": (22, nil), "NV": (22, nil), "UT": (22, nil),
        "CA": (23, nil), "OR": (23, nil), "WA": (23, nil),
        "HI": (24, nil), "AK": (24, 25),
    ]

    struct Wave: Identifiable, Hashable {
        let at: Date
        /// State codes with "(most)" or "(rest)" for split states.
        let states: [(code: String, part: String)]
        var id: Date { at }
        static func == (a: Wave, b: Wave) -> Bool { a.at == b.at }
        func hash(into h: inout Hasher) { h.combine(at) }
        var list: String { states.map { $0.part == "all" ? $0.code : "\($0.code) (\($0.part))" }.joined(separator: ", ") }
    }

    private static func at(_ hours: Double) -> Date { electionDayStart.addingTimeInterval(hours * 3600) }

    static let waves: [Wave] = {
        var entries: [(Date, String, String)] = []
        for (state, (most, rest)) in close {
            if let rest {
                entries.append((at(most), state, "most"))
                entries.append((at(rest), state, "rest"))
            } else {
                entries.append((at(most), state, "all"))
            }
        }
        let times = Set(entries.map(\.0)).sorted()
        return times.map { t in
            Wave(at: t, states: entries.filter { $0.0 == t }.map { ($0.1, $0.2) }.sorted { $0.0 < $1.0 })
        }
    }()

    static func nextWave(after now: Date) -> Wave? { waves.first { $0.at > now } }

    /// When every poll in a state has closed, the earliest a race there can be called.
    static func final(_ state: String) -> Date? { close[state].map { at($0.1 ?? $0.0) } }

    /// Election mode starts at midnight Eastern on Nov 3.
    static func isElectionNight(_ now: Date = .now) -> Bool { now >= electionDayStart }

    static func countdown(to date: Date, from now: Date = .now) -> String {
        let s = max(0, Int(date.timeIntervalSince(now)))
        let days = s / 86_400
        let clock = String(format: "%02d:%02d:%02d", (s % 86_400) / 3600, (s % 3600) / 60, s % 60)
        return days > 0 ? "\(days)d \(clock)" : clock
    }
}
