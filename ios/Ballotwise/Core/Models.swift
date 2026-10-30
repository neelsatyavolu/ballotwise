import Foundation

// Mirrors the JSON from ballotwise.xanom.co/api/midterms (lib/midterms/races.ts and view.ts). Every field the
// server marks optional is optional here, so a missing field never fails the whole decode.

nonisolated enum Office: String, Codable, Sendable, CaseIterable, Identifiable {
    case senate, house, governor, measure
    var id: String { rawValue }
    var label: String {
        switch self {
        case .senate: "Senate"
        case .house: "House"
        case .governor: "Governor"
        case .measure: "Measures"
        }
    }
}

nonisolated enum Party: String, Sendable { case d = "D", r = "R", other }

nonisolated struct Candidate: Codable, Sendable, Hashable {
    let name: String
    let party: String
    let votes: Int
    let pct: Double
    var winner: Bool?
    var incumbent: Bool?
    var color: String?

    var isWinner: Bool { winner ?? false }
    var isIncumbent: Bool { incumbent ?? false }
}

nonisolated struct Odds: Codable, Sendable, Hashable {
    var d: Double?
    var r: Double?
    var i: Double?
    enum CodingKeys: String, CodingKey { case d = "D", r = "R", i = "I" }

    /// Sides with a chance, highest first.
    var ranked: [(side: String, p: Double)] {
        [("D", d), ("R", r), ("I", i)].compactMap { s, p in p.map { (s, $0) } }.sorted { $0.1 > $1.1 }
    }
}

nonisolated struct ForecastNames: Codable, Sendable, Hashable { let left: String; let right: String }

nonisolated struct RaceForecastSignal: Codable, Sendable, Hashable {
    let odds: Odds
    var left: String?
    var names: ForecastNames?
    var margin: Double?
}

nonisolated struct MarketSignal: Codable, Sendable, Hashable {
    let odds: Odds
    var sources: [String]?
    var volume: Double?
}

nonisolated struct PollSignal: Codable, Sendable, Hashable {
    let margin: Double
    let count: Int
    var latest: String?
}

nonisolated struct Signal: Codable, Sendable, Hashable {
    var market: MarketSignal?
    var polls: PollSignal?
    var rating: String?
    var forecast: RaceForecastSignal?
}

nonisolated struct RaceCall: Codable, Sendable, Hashable {
    let id: Int
    let at: Double
    var winner: String?
    var replaced: String?
    let withdrawn: Bool
}

nonisolated struct Trend: Codable, Sendable, Hashable {
    let since: Double
    let votesAdded: Int
    var prevMargin: Double?
    var prevLeader: String?
    let lastChange: Double
}

nonisolated struct About: Codable, Sendable, Hashable { let text: String; var url: String? }
nonisolated struct LocalInfo: Codable, Sendable, Hashable { let kind: String; let type: String; let date: String }

nonisolated struct County: Codable, Sendable, Hashable, Identifiable {
    var fips: String?
    let name: String
    let reporting: Double
    let total: Int
    let candidates: [Candidate]
    var reportingUnknown: Bool?
    var baseline2024: Double?
    var id: String { fips ?? name }
}

nonisolated struct Race: Codable, Sendable, Hashable, Identifiable {
    let id: Int
    let office: Office
    let state: String
    var district: Int?
    let title: String
    let reporting: Double
    let total: Int
    let candidates: [Candidate]
    var rating: String?
    var reportingUnknown: Bool?
    var callUnknown: Bool?
    var rcv: Bool?
    var round: Int?
    var calledFor: String?
    var missing: Bool?
    var lastSeen: Double?
    var about: About?
    var local: LocalInfo?
    var signal: Signal?
    var call: RaceCall?
    var callPending: Bool?
    var trend: Trend?
    // Only on the race detail.
    var pollsClose: String?
    var updated: String?
    var counties: [County]?

    var winner: Candidate? { candidates.first(where: \.isWinner) }
    var isCalled: Bool { winner != nil }
}

nonisolated struct Tally: Codable, Sendable, Hashable {
    let d: Int
    let r: Int
    let other: Int
    let total: Int
    let majority: Int
    let uncalled: Int
    enum CodingKeys: String, CodingKey { case d = "D", r = "R", other, total, majority, uncalled }
}

nonisolated struct Balance: Codable, Sendable, Hashable {
    let senate: Tally
    let house: Tally
    let governor: Tally
    func tally(_ office: Office) -> Tally? {
        switch office {
        case .senate: senate
        case .house: house
        case .governor: governor
        case .measure: nil
        }
    }
}

nonisolated struct CallEvent: Codable, Sendable, Hashable, Identifiable {
    let id: Int
    let raceId: Int
    let office: Office
    let kind: String
    var winner: String?
    var party: String?
    var previous: String?
    let at: Double
}

nonisolated struct Overview: Codable, Sendable {
    let races: [Race]
    let balance: Balance
    let fetchedAt: Double
    let stale: Bool
    var callEvents: [CallEvent]?
}

nonisolated struct RaceResponse: Codable, Sendable {
    let race: Race
    let fetchedAt: Double
    let stale: Bool
    var callPending: Bool?
    var history: [VoteObservation]?
}

nonisolated struct VoteObservation: Codable, Sendable, Hashable {
    let at: Double
    let total: Int
    var leadName: String?
    var leadParty: String?
    var margin: Double?
    var reporting: Double?
}

// MARK: Forecast

nonisolated struct SeatProbability: Codable, Sendable, Hashable { let seats: Int; let p: Double }

nonisolated struct RatingCounts: Codable, Sendable, Hashable {
    let safeD, likelyD, leanD, tossup, leanR, likelyR, safeR: Int
}

nonisolated struct Chamber: Codable, Sendable, Hashable {
    let dControl: Double
    let dSeats: Int
    let rSeats: Int
    let ratings: RatingCounts
    let distribution: [SeatProbability]
    let majority: Int
}

nonisolated struct ChamberHistoryPoint: Sendable, Hashable, Identifiable {
    let day: String
    let dControl: Double
    var id: String { day }
    var date: Date { Format.day(day) ?? .distantPast }
}

nonisolated struct ForecastResponse: Decodable, Sendable {
    let updatedAt: Double
    let chambers: [String: Chamber]
    let history: [String: [ChamberHistoryPoint]]

    enum CodingKeys: String, CodingKey { case updatedAt, chambers, history }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        updatedAt = try c.decode(Double.self, forKey: .updatedAt)
        chambers = try c.decode([String: Chamber].self, forKey: .chambers)
        // Each office's history is rows of [day, dControl, dSeats, rSeats]; `backfilled` describes the rows and is skipped.
        let raw = try c.nestedContainer(keyedBy: AnyKey.self, forKey: .history)
        var out: [String: [ChamberHistoryPoint]] = [:]
        for key in raw.allKeys where key.stringValue != "backfilled" {
            guard var rows = try? raw.nestedUnkeyedContainer(forKey: key) else { continue }
            var points: [ChamberHistoryPoint] = []
            while !rows.isAtEnd {
                var row = try rows.nestedUnkeyedContainer()
                let day = try row.decode(String.self)
                let p = try row.decode(Double.self)
                points.append(ChamberHistoryPoint(day: day, dControl: p))
            }
            out[key.stringValue] = points
        }
        history = out
    }
}

nonisolated struct AnyKey: CodingKey {
    var stringValue: String
    var intValue: Int? { nil }
    init(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
}

/// A point on a time series sent as `[unixSeconds, value, ...]`.
nonisolated struct TimePoint: Decodable, Sendable, Hashable, Identifiable {
    let t: Double
    let values: [Double]
    var id: Double { t }
    var date: Date { Date(timeIntervalSince1970: t) }
    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        t = try c.decode(Double.self)
        var vs: [Double] = []
        while !c.isAtEnd { vs.append((try? c.decode(Double.self)) ?? .nan) }
        values = vs
    }
}

nonisolated struct RaceForecastResponse: Decodable, Sendable {
    struct History: Decodable, Sendable { let days: [String]; let side: String; let p: [Double] }
    struct Answer: Decodable, Sendable, Hashable { let name: String; var side: String?; let pct: Double }
    struct Poll: Decodable, Sendable, Hashable {
        let pollster: String
        let start: String
        let end: String
        var n: Int?
        var pop: String?
        let answers: [Answer]
        let margin: Double
        var `internal`: Bool?
        var url: String?
        var excluded: String?
    }
    struct Average: Decodable, Sendable { let margin: Double; let left: Double; let right: Double; let count: Int; var latest: String? }
    struct Polls: Decodable, Sendable {
        let left: String
        let leftName: String
        let rightName: String
        var average: Average?
        var trend: [TimePoint]?
        let rows: [Poll]
    }
    var history: History?
    var polls: Polls?
}

nonisolated struct MarketLine: Decodable, Sendable, Hashable {
    let name: String
    var side: String?
    let now: Double
    let all: [TimePoint]
    var live: [TimePoint]?
}

nonisolated struct Market: Decodable, Sendable {
    let question: String
    let url: String
    let lines: [MarketLine]
}

nonisolated struct MarketsResponse: Decodable, Sendable {
    var polymarket: Market?
    var kalshi: Market?
}

nonisolated struct FoundRace: Codable, Sendable, Hashable, Identifiable {
    let id: Int
    let title: String
    let state: String
    let type: String
    let date: String
    let kind: String
}

// MARK: Account and dashboards

nonisolated struct User: Codable, Sendable, Hashable { let id: String; let email: String }

nonisolated struct Me: Codable, Sendable {
    var user: User?
    let grok: String
    var provider: String?
}

nonisolated struct DashboardSection: Codable, Sendable, Hashable {
    let title: String
    var note: String?
    let raceIds: [Int]
}

nonisolated struct DashboardPanel: Codable, Sendable, Hashable, Identifiable {
    let id: String
    let type: String
    let x: Int
    let y: Int
    var raceId: Int?
    var office: Office?
    var text: String?
}

/// Either Grok's sections of race cards or a Decision View grid of panels (drawn on a phone as one column).
nonisolated struct DashboardLayout: Codable, Sendable, Hashable {
    let title: String
    var kind: String?
    var sections: [DashboardSection]?
    var panels: [DashboardPanel]?
}

nonisolated struct Dashboard: Codable, Sendable, Hashable, Identifiable {
    let id: String
    let layout: DashboardLayout
    let updatedAt: Double
}

nonisolated struct ChatMessage: Codable, Sendable, Hashable, Identifiable {
    var id = UUID()
    let role: String
    let content: String
    enum CodingKeys: String, CodingKey { case role, content }
}
