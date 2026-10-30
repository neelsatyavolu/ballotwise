import SwiftUI

/// A state's counties shaded by who leads each one (deeper for wider leads), or by the 2024 presidential margin
/// before votes come in. Tap a county for its numbers.
struct CountyMap: View {
    let raceId: Int
    let state: String
    /// The race's county results; fetched here when not passed in.
    var counties: [County]?
    @State private var map: LoadedMap?
    @State private var fetched: [County]?
    @State private var selected: String?
    @State private var failed = false

    private var results: [String: County] {
        Dictionary((counties ?? fetched ?? []).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }
    private var counting: Bool { results.values.contains { $0.total > 0 } }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(counting ? "Results by county" : "2024 presidential vote by county").font(.serif(.headline))
            if let map {
                MapCanvas(viewBox: map.viewBox, shapes: map.shapes, lines: map.lines, fill: fill, selected: selected) { shape in
                    selected = selected == shape.id ? nil : shape.id
                }
                .frame(maxHeight: 360)
                if let id = selected, let county = results[id] { CountyDetail(county: county) }
                else { Text("Tap a county for its numbers. Pinch to zoom.").font(.caption).foregroundStyle(.secondary) }
            } else if failed {
                Text("The map didn't load.").font(.caption).foregroundStyle(.secondary)
            } else {
                ProgressView().frame(maxWidth: .infinity, minHeight: 200)
            }
        }
        .panel()
        .task(id: state) {
            do { map = try await MapLoader.shared.counties(state) } catch { failed = true }
            if counties == nil {
                fetched = try? await API.shared.get("/api/midterms/race/\(raceId)", as: RaceResponse.self).race.counties
            }
        }
    }

    private func fill(_ shape: MapShapeData) -> Color {
        guard let county = results[shape.id] else { return .unrated.opacity(0.4) }
        if county.total > 0, let lead = Format.lead(county.candidates) {
            let strength = county.reporting < 15 && !(county.reportingUnknown ?? false) ? 0.3 : lead.margin >= 20 ? 0.92 : lead.margin >= 10 ? 0.7 : lead.margin >= 5 ? 0.5 : 0.32
            return Theme.color(lead.leader).opacity(strength)
        }
        if let m = county.baseline2024 {
            let strength = abs(m) >= 20 ? 0.45 : abs(m) >= 10 ? 0.32 : 0.2
            return (m > 0 ? Color.dem : Color.rep).opacity(strength)
        }
        return .unrated.opacity(0.4)
    }
}

struct CountyDetail: View {
    let county: County
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(county.name).font(.subheadline.weight(.semibold))
                Spacer()
                if county.total > 0 {
                    Text(county.reportingUnknown ?? false ? "\(Format.votes(county.total)) votes" : "\(Int(county.reporting.rounded()))% reporting")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            ForEach(county.candidates.prefix(3), id: \.name) { c in
                HStack {
                    Circle().fill(Theme.color(c)).frame(width: 8, height: 8)
                    Text(c.name).font(.caption)
                    Spacer()
                    if county.total > 0 {
                        Text("\(Format.pct(c.pct))  \(Format.votes(c.votes))").font(.caption.monospacedDigit())
                    }
                }
            }
            if let m = county.baseline2024 {
                Text("2024 president: \(Format.marginLabel(m))").font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding(10)
        .background(Color.paper, in: RoundedRectangle(cornerRadius: Theme.corner))
    }
}

/// Counties with votes, largest first, with the leader and how the margin compares with 2024.
struct CountyTable: View {
    let race: Race
    let counties: [County]
    @State private var showAll = false

    var body: some View {
        let sorted = counties.filter { $0.total > 0 }.sorted { $0.total > $1.total }
        VStack(alignment: .leading, spacing: 8) {
            Text("Counties").font(.serif(.headline))
            ForEach(showAll ? sorted : Array(sorted.prefix(10))) { county in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(county.name).font(.subheadline)
                        Text(county.reportingUnknown ?? false ? "Reporting unknown" : "\(Int(county.reporting.rounded()))% in").font(.caption2).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if let lead = Format.lead(county.candidates) {
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("\(Format.lastName(lead.leader.name)) +\(String(format: "%.1f", lead.margin))")
                                .font(.subheadline.monospacedDigit().weight(.semibold))
                                .foregroundStyle(Theme.color(lead.leader))
                            if let now = twoWay(county.candidates), let then = county.baseline2024 {
                                let shift = now - then
                                Text("\(shift >= 0 ? "D" : "R") shift \(String(format: "%.1f", abs(shift))) vs 2024").font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                Divider()
            }
            if sorted.count > 10 {
                Button(showAll ? "Show fewer" : "Show all \(sorted.count) counties") { showAll.toggle() }.font(.footnote)
            }
        }
        .panel()
    }

    private func twoWay(_ cs: [Candidate]) -> Double? {
        guard let d = cs.first(where: { Format.party($0.party) == .d }), let r = cs.first(where: { Format.party($0.party) == .r }) else { return nil }
        return d.pct - r.pct
    }
}
