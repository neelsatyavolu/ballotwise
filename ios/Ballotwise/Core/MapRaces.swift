import Foundation

/// Which race a map shape stands for. State shapes are ids like "PA" and House districts "PA-7" (at-large "WY-0").
nonisolated enum MapRaces {
    /// One office's races in a state: districts in order, and a regular Senate race before a special one.
    static func races(_ all: [Race], office: Office, state: String) -> [Race] {
        all.filter { $0.office == office && $0.state == state }.sorted { a, b in
            let specialA = isSpecial(a)
            let specialB = isSpecial(b)
            if specialA != specialB { return !specialA }
            return (a.district ?? 0) < (b.district ?? 0)
        }
    }

    /// The race for a state or district shape. A state with two Senate races gives the regular one.
    static func race(_ all: [Race], office: Office, shape id: String) -> Race? { index(all, office: office)[id] }

    /// Every shape's race in one pass, keyed by shape id, so a map can color hundreds of districts without
    /// searching the races for each. A regular race wins over a special for the same seat.
    static func index(_ all: [Race], office: Office) -> [String: Race] {
        var out: [String: Race] = [:]
        for r in all where r.office == office {
            let key = office == .house ? "\(r.state)-\(r.district ?? 0)" : r.state
            if let held = out[key], !isSpecial(held) || isSpecial(r) { continue }
            out[key] = r
        }
        return out
    }

    private static func isSpecial(_ r: Race) -> Bool { r.title.localizedCaseInsensitiveContains("special") }
}
