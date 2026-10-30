import SwiftUI

enum RaceFilter: String, CaseIterable, Identifiable {
    case all = "All", competitive = "Competitive", counting = "Counting", called = "Called", starred = "Starred"
    var id: String { rawValue }
}

/// Every tracked race of one office, searchable by place or candidate and filterable by status.
struct RacesView: View {
    @State private var office: Office = .senate
    var body: some View {
        RaceList(office: $office, showPicker: true)
            .navigationTitle("Races")
    }
}

struct OfficeListView: View {
    @State var office: Office
    var body: some View {
        RaceList(office: $office, showPicker: false)
            .navigationTitle(office == .governor ? "Governors" : office.label)
    }
}

struct RaceList: View {
    @Binding var office: Office
    let showPicker: Bool
    @Environment(LiveStore.self) private var live
    @Environment(AccountStore.self) private var account
    @State private var query = ""
    @State private var filter: RaceFilter = .all
    @State private var state: String?

    var body: some View {
        let shown = filtered
        List {
            if showPicker {
                Picker("Office", selection: $office) {
                    ForEach(Office.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    ForEach(RaceFilter.allCases) { f in
                        Button(f.rawValue) { filter = f }
                            .buttonStyle(.bordered)
                            .tint(filter == f ? .flagBlue : .secondary)
                            .controlSize(.small)
                    }
                    Menu {
                        Button("All states") { state = nil }
                        ForEach(statesInOffice, id: \.self) { s in Button(Format.stateName(s)) { state = s } }
                    } label: {
                        Label(state.map(Format.stateName) ?? "State", systemImage: "line.3.horizontal.decrease.circle")
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 4, trailing: 0))

            if shown.isEmpty {
                ContentUnavailableView(live.overview == nil ? "Loading results" : "No races match", systemImage: live.overview == nil ? "hourglass" : "magnifyingglass")
                    .listRowBackground(Color.clear)
            }
            ForEach(shown) { race in
                NavigationLink(value: RaceLink(id: race.id)) { RaceCard(race: race, showCandidates: office == .house ? 2 : 3) }
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 5, leading: 0, bottom: 5, trailing: 0))
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .contentMargins(.horizontal, 16, for: .scrollContent)
        .background(Color.paper)
        .searchable(text: $query, prompt: "State, district or candidate")
        .refreshable { await live.refresh() }
        .onChange(of: office) { state = nil }
    }

    private var statesInOffice: [String] {
        Set(live.races(office).map(\.state)).sorted { Format.stateName($0) < Format.stateName($1) }
    }

    private var filtered: [Race] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return live.races(office)
            .filter { state == nil || $0.state == state }
            .filter { race in
                switch filter {
                case .all: true
                case .competitive: race.rating != nil
                case .counting: race.total > 0 && !race.isCalled
                case .called: race.isCalled
                case .starred: account.isStarred(race.id)
                }
            }
            .filter { race in
                q.isEmpty || Format.label(race).lowercased().contains(q) || Format.stateName(race.state).lowercased().contains(q)
                    || race.title.lowercased().contains(q) || race.candidates.contains { $0.name.lowercased().contains(q) }
            }
            // Most competitive first while browsing; by place once narrowed to a search or a state.
            .sorted(by: office != .measure && q.isEmpty && state == nil ? Format.compare : Self.byPlace)
    }

    private nonisolated static func byPlace(_ a: Race, _ b: Race) -> Bool {
        if a.state != b.state { return Format.stateName(a.state) < Format.stateName(b.state) }
        return (a.district ?? 0) < (b.district ?? 0)
    }
}

/// Every tracked race in one state.
struct StateView: View {
    let state: String
    @Environment(LiveStore.self) private var live

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if let headline = live.races.first(where: { $0.state == state && $0.office == .senate }) ?? live.races.first(where: { $0.state == state && $0.office == .governor }) {
                    CountyMap(raceId: headline.id, state: state)
                }
                ForEach(Office.allCases) { office in
                    let races = live.races.filter { $0.state == state && $0.office == office }.sorted { ($0.district ?? 0) < ($1.district ?? 0) }
                    if !races.isEmpty {
                        SectionTitle(office == .governor ? "Governor" : office.label)
                        ForEach(races) { race in
                            NavigationLink(value: RaceLink(id: race.id)) { RaceCard(race: race) }.buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding()
        }
        .background(Color.paper)
        .navigationTitle(Format.stateName(state))
    }
}
