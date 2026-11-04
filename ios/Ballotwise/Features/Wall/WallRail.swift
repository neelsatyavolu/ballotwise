import SwiftUI

/// The wall's rail with the whole country on the map: the clock, the office's seats, races to watch and the
/// latest calls. Picking a race flies the map to it.
struct NationRail: View {
    @Environment(LiveStore.self) private var live
    let office: Office
    let pick: (Race) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ClockCard()
            if let tally = live.overview?.balance.tally(office) {
                ChamberBar(office: office, tally: tally).panel()
            }
            let watch = WallLogic.watchList(live.races, office: office)
            if !watch.isEmpty {
                SectionTitle(Polls.isElectionNight() ? "Closest races" : "Races to watch")
                VStack(spacing: 0) {
                    ForEach(watch) { race in
                        Button { pick(race) } label: { WatchRow(race: race) }.buttonStyle(.plain)
                        if race.id != watch.last?.id { Divider() }
                    }
                }
                .panel(padding: 10)
            }
            if let events = live.overview?.callEvents?.filter({ $0.office == office }), !events.isEmpty {
                SectionTitle("Latest calls")
                CallsList(events: Array(events.prefix(6)))
            }
            UpdatedFooter()
        }
    }
}

/// The rail with one state on the map: its race (or a picker for a second Senate race or its House districts),
/// the county you tapped, and links to the full pages.
struct StateRail: View {
    let office: Office
    let state: String
    let races: [Race]
    let race: Race?
    let county: County?
    let select: (Race) -> Void
    /// A phone's sheet skips the state's name; the map already shows it, and the sheet's first rows matter more.
    var showsTitle = true

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if showsTitle { Text(Format.stateName(state)).font(.largeTitle.weight(.heavy)) }
            if office != .house, races.count > 1 {
                Picker("Race", selection: Binding(get: { race?.id ?? races[0].id }, set: { id in races.first { $0.id == id }.map(select) })) {
                    ForEach(races) { Text(Format.label($0)).tag($0.id) }
                }
                .pickerStyle(.segmented)
            }
            // A tapped county comes first, so it shows without scrolling.
            if let county, let race { CountyBoard(race: race, county: county) }
            if let race {
                RaceBoard(race: race)
            } else if races.isEmpty {
                Text("No \(office == .governor ? "governor's" : office.label) race in \(Format.stateName(state)) this year.")
                    .font(.subheadline).foregroundStyle(.secondary).panel()
            }
            if office == .house {
                districtList
            } else if !races.isEmpty, county == nil {
                Text("Tap a county for its results. Pinch out to go back.").font(.caption).foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 10) {
                if let race {
                    NavigationLink(value: RaceLink(id: race.id)) { Label("Full race page", systemImage: "chevron.right") }
                }
                NavigationLink(value: StateLink(code: state)) { Label("Every race in \(Format.stateName(state))", systemImage: "chevron.right") }
            }
            .font(.subheadline)
        }
    }

    private var districtList: some View {
        VStack(alignment: .leading, spacing: 8) {
            if race == nil { Text("Tap a district, or pick one here.").font(.caption).foregroundStyle(.secondary) }
            VStack(spacing: 0) {
                ForEach(races) { r in
                    Button { select(r) } label: { WatchRow(race: r, highlighted: r.id == race?.id) }.buttonStyle(.plain)
                    if r.id != races.last?.id { Divider() }
                }
            }
            .panel(padding: 10)
        }
    }
}

/// A race in one line: its map color, name, who leads and how much is counted.
struct WatchRow: View {
    let race: Race
    var highlighted = false

    var body: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 2).fill(Theme.fill(race)).frame(width: 6, height: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text(Format.label(race)).font(.subheadline.weight(.semibold))
                Text(Format.reporting(race)).font(.caption2).foregroundStyle(.secondary)
            }
            Spacer()
            Text(standing).font(.subheadline.monospacedDigit().weight(.semibold)).foregroundStyle(standingColor)
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 4)
        .background(highlighted ? Color.rule.opacity(0.5) : .clear, in: RoundedRectangle(cornerRadius: 4))
        .contentShape(Rectangle())
    }

    private var standing: String {
        if let w = race.winner { return "\(Format.lastName(w.name)) won" }
        if let lead = Format.lead(race.candidates) { return "\(Format.lastName(lead.leader.name)) +\(String(format: "%.1f", lead.margin))" }
        return Format.forecastLeader(race) ?? Format.ratingLabel[race.rating ?? ""] ?? ""
    }

    private var standingColor: Color {
        if let w = race.winner { return Theme.color(w) }
        if let lead = Format.lead(race.candidates) { return Theme.color(lead.leader) }
        return .secondary
    }
}
