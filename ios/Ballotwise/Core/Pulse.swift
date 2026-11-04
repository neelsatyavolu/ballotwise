import Foundation
import Observation

// DDHQ Pulse, Decision Desk HQ's live election-night model, from /api/midterms/pulse (lib/ddhq/pulse.ts). The server
// reads DDHQ's public balance-of-power pages once a minute for everyone, so no DDHQ account is needed.

/** Each party's number in a chamber: chance of control in percent, or projected seats. */
nonisolated struct PulseChamber: Codable, Sendable, Hashable { let dem: Double; let rep: Double }
/** The candidate DDHQ's live model favors in one race, and their chance in percent. */
nonisolated struct PulseRace: Codable, Sendable, Hashable { let name: String; let side: String; let chance: Double }
/** DDHQ's call of a chamber: the party projected to win control, and when (ms). */
nonisolated struct PulseCall: Codable, Sendable, Hashable { let side: String; let at: Double }
/** Democrats' chance of control in percent at one moment; a chamber not read then is missing. */
nonisolated struct PulsePoint: Codable, Sendable, Hashable, Identifiable {
    let at: Double
    var senate: Double?
    var house: Double?
    var id: Double { at }
    var date: Date { Date(timeIntervalSince1970: at / 1000) }
    func value(_ office: Office) -> Double? { office == .senate ? senate : office == .house ? house : nil }
}

nonisolated struct Pulse: Codable, Sendable {
    var at: Double?
    var chambers: [String: PulseChamber]?
    var races: [String: PulseRace]?
    var calls: [String: PulseCall]?
    var projected: [String: PulseChamber]?
    var history: [PulsePoint]?
}

/// Who controls a chamber: a majority of seats won, or before that Decision Desk HQ's projection (lib/midterms/moments.ts).
nonisolated struct ChamberCall: Sendable, Hashable {
    let side: String
    let text: String
    /// When DDHQ projected it; nil when the seats won already make a majority.
    let ddhqAt: Double?

    private static let need: [Office: (d: Int, r: Int)] = [.senate: (51, 50), .house: (218, 218)]

    static func of(_ office: Office, tally: Tally, desk: PulseCall?) -> ChamberCall? {
        guard let need = need[office] else { return nil }
        let won = tally.d >= need.d ? "D" : tally.r >= need.r ? "R" : nil
        let deskSide = desk.flatMap { $0.side == "D" || $0.side == "R" ? $0.side : nil }
        guard let side = won ?? deskSide else { return nil }
        // Republicans held both chambers going in.
        let text = "\(side == "D" ? "Democrats" : "Republicans") \(side == "R" ? "keep" : "take") the \(office.label)"
        return ChamberCall(side: side, text: text, ddhqAt: won == nil ? desk?.at : nil)
    }
}

@Observable
final class PulseStore {
    private(set) var pulse: Pulse?

    /// The server reads DDHQ once a minute, so asking more often gains nothing.
    func poll() async {
        while !Task.isCancelled {
            await load()
            try? await Task.sleep(for: .seconds(60))
        }
    }

    func load() async {
        // Offline or DDHQ down: keep the last answer.
        if let fresh = try? await API.shared.get("/api/midterms/pulse", as: Pulse.self), fresh.at != nil { pulse = fresh }
    }

    /// The race's Pulse, or nil when DDHQ doesn't model it live or it's been called.
    func race(_ r: Race) -> PulseRace? {
        guard !r.isCalled, r.office != .measure else { return nil }
        let key = "\(r.office.rawValue):\(r.state):\(r.office == .house ? String(r.district ?? 0) : "")"
        return pulse?.races?[key]
    }

    func call(_ office: Office) -> PulseCall? { pulse?.calls?[office.rawValue] }

    /// Democrats' chance of controlling the chamber, 0...1.
    func control(_ office: Office) -> Double? {
        guard let c = pulse?.chambers?[office.rawValue], c.dem + c.rep > 0 else { return nil }
        return c.dem / (c.dem + c.rep)
    }

    func projected(_ office: Office) -> (d: Int, r: Int)? {
        guard let p = pulse?.projected?[office.rawValue], p.dem + p.rep > 0 else { return nil }
        return (Int(p.dem.rounded()), Int(p.rep.rounded()))
    }

    func history(_ office: Office) -> [PulsePoint] { (pulse?.history ?? []).filter { $0.value(office) != nil } }

    /// "DDHQ Pulse: Peltola 62%".
    static func line(_ p: PulseRace) -> String {
        "DDHQ Pulse: \(Format.lastName(p.name)) \(Int(min(99, max(1, p.chance)).rounded()))%"
    }
}
