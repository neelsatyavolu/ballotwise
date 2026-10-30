import SwiftUI

/// The country shaded by result (or rating before votes): states for Senate, Governor and measures, every
/// district for the House. Tap a shape for the race.
struct NationMapView: View {
    @Environment(LiveStore.self) private var live
    @State private var office: Office = .senate
    @State private var nation: LoadedMap?
    @State private var districts: [MapShapeData] = []
    @State private var selected: String?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Picker("Office", selection: $office) {
                    ForEach([Office.senate, .house, .governor]) { Text($0 == .governor ? "Governor" : $0.label).tag($0) }
                }
                .pickerStyle(.segmented)

                if let nation {
                    let shapes = office == .house && !districts.isEmpty ? districts : nation.shapes
                    MapCanvas(viewBox: nation.viewBox, shapes: shapes, lines: office == .house ? nation.lines : nil, fill: fill, selected: selected) { shape in
                        selected = selected == shape.id ? nil : shape.id
                    }
                    .panel(padding: 6)
                    if office == .house && districts.isEmpty { ProgressView("Loading districts").frame(maxWidth: .infinity) }
                } else if let error {
                    ErrorBanner(message: error)
                } else {
                    ProgressView().frame(maxWidth: .infinity, minHeight: 240)
                }

                Legend()

                if let id = selected {
                    if let race = raceFor(id) {
                        NavigationLink(value: RaceLink(id: race.id)) { RaceCard(race: race, showCandidates: 3) }.buttonStyle(.plain)
                    } else {
                        Text("No \(office == .governor ? "governor's" : office.label) race in \(Format.stateName(String(id.prefix(2)))) this year.")
                            .font(.subheadline).foregroundStyle(.secondary).panel()
                    }
                    NavigationLink(value: StateLink(code: String(id.prefix(2)))) {
                        Label("Every race in \(Format.stateName(String(id.prefix(2))))", systemImage: "chevron.right")
                    }
                    .font(.subheadline)
                } else {
                    Text("Tap a \(office == .house ? "district" : "state") to see its race. Pinch to zoom.").font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding()
        }
        .background(Color.paper)
        .navigationTitle("Map")
        .task {
            do { nation = try await MapLoader.shared.nation() } catch { self.error = "The map didn't load. Pull to try again." }
        }
        .task(id: office) {
            selected = nil
            guard office == .house, districts.isEmpty else { return }
            districts = await loadDistricts()
        }
    }

    private func loadDistricts() async -> [MapShapeData] {
        let states = Format.stateNames.keys.filter { $0 != "DC" }
        return await withTaskGroup(of: [MapShapeData].self) { group in
            for s in states { group.addTask { (try? await MapLoader.shared.districts(s).shapes) ?? [] } }
            var all: [MapShapeData] = []
            for await shapes in group { all += shapes }
            return all
        }
    }

    /// The race for a state ("PA") or district ("PA-7") shape.
    private func raceFor(_ id: String) -> Race? {
        if office == .house {
            let parts = id.split(separator: "-")
            guard parts.count == 2, let d = Int(parts[1]) else { return nil }
            return live.races.first { $0.office == .house && $0.state == parts[0] && ($0.district ?? 0) == d }
        }
        // A state with two Senate races shows the regular one.
        return live.races.filter { $0.office == office && $0.state == id }.sorted { !$0.title.localizedCaseInsensitiveContains("special") && $1.title.localizedCaseInsensitiveContains("special") }.first
    }

    private func fill(_ shape: MapShapeData) -> Color {
        guard let race = raceFor(shape.id) else { return Color.rule.opacity(0.5) }
        return Theme.fill(race)
    }
}

private struct Legend: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                swatch(.dem, "Dem won or leads")
                swatch(.rep, "Rep won or leads")
            }
            HStack(spacing: 10) {
                swatch(.tossup, "Toss-up")
                swatch(.leanD, "Lean")
                swatch(.likelyD, "Likely")
                swatch(.safeD, "Safe")
            }
            Text("Before votes are counted, races are shaded by the forecast's rating. Paler means an early or narrow lead.")
                .font(.caption2).foregroundStyle(.secondary)
        }
    }

    private func swatch(_ color: Color, _ label: String) -> some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 12, height: 12)
            Text(label).font(.caption)
        }
    }
}
