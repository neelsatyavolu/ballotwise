import SwiftUI

/// The iPad's map wall, after the cable-news touchscreens: the country fills the screen, a tap flies into a state
/// and its counties, the rail beside it reads out the race, and a pen marks up the map.
struct WallView: View {
    @Environment(LiveStore.self) private var live
    @Environment(ForecastStore.self) private var forecast

    @State private var office: Office = .senate
    @State private var state: String?
    /// The House district or county picked on the map.
    @State private var selected: String?
    /// The race the rail shows, once a state is open.
    @State private var raceId: Int?
    @State private var lens: WallLens = .results

    @State private var nation: LoadedMap?
    @State private var districts: [MapShapeData] = []
    @State private var counties: StateCounties?
    @State private var detail: RaceResponse?
    @State private var mapError: String?

    @State private var drawing = false
    @State private var ink: Color = .tossup
    @State private var clearToken = 0
    /// On a phone, whether the results sheet is pulled up over the map.
    @State private var sheetUp = false
    /// Stripes seats set to change party, like a network's "flip" shading.
    @State private var showFlips = true
    @Environment(\.horizontalSizeClass) private var sizeClass

    private struct StateCounties { let state: String; let map: LoadedMap }

    private static let offices: [Office] = [.senate, .house, .governor]
    private static let inks: [Color] = [.tossup, .white, .flagRed]

    private var countyMap: LoadedMap? { counties?.state == state ? counties?.map : nil }
    private var countyLevel: Bool { office != .house && state != nil }
    private var stateRaces: [Race] { state.map { MapRaces.races(live.races, office: office, state: $0) } ?? [] }
    private var race: Race? { raceId.flatMap { live.byId[$0] } }
    private var countyResults: [String: County] {
        guard let detail, detail.race.id == raceId else { return [:] }
        return Dictionary((detail.race.counties ?? []).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }

    var body: some View {
        GeometryReader { geo in
            if sizeClass == .regular {
                VStack(spacing: 0) {
                    FlagStripe()
                    if geo.size.width > geo.size.height {
                        HStack(spacing: 0) {
                            mapArea
                            Divider()
                            rail.frame(width: min(400, geo.size.width * 0.32))
                        }
                    } else {
                        VStack(spacing: 0) {
                            mapArea.frame(height: geo.size.height * 0.55)
                            Divider()
                            rail
                        }
                    }
                }
            } else {
                phone(geo.size)
            }
        }
        .background(Color.paper)
        .environment(\.colorScheme, .dark)
        // On an iPad a visible (empty) bar gives the floating tab bar its own row; hidden, the tab bar covered the
        // controls in windowed apps. A phone's tab bar is at the bottom, so the map can run to the top.
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.sheet, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar(sizeClass == .regular ? .visible : .hidden, for: .navigationBar)
        .task {
            await live.loadPhotos()
            await forecast.load()
        }
        .task {
            do { nation = try await MapLoader.shared.nation() } catch { mapError = "The map didn't load. Check your connection and reopen the wall." }
        }
        .task(id: office) {
            guard office == .house, districts.isEmpty else { return }
            districts = await MapLoader.shared.allDistricts()
        }
        .task(id: state) {
            guard let state, counties?.state != state, let map = try? await MapLoader.shared.counties(state) else { return }
            counties = StateCounties(state: state, map: map)
        }
        .task(id: raceId) { await followRace() }
        .onChange(of: office) { _, _ in
            selected = nil
            raceId = office == .house ? nil : stateRaces.first?.id
            fixLens()
        }
    }

    // MARK: Pieces

    /// The phone's wall: the map fills the screen and the results sit in a sheet under it that pulls up.
    private func phone(_ size: CGSize) -> some View {
        let peek = size.height * 0.5
        return ZStack(alignment: .bottom) {
            mapArea
                .padding(.bottom, peek - 16)
            VStack(spacing: 0) {
                Capsule().fill(Color.muted.opacity(0.7)).frame(width: 40, height: 5)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .contentShape(Rectangle())
                    .onTapGesture { withAnimation(.smooth) { sheetUp.toggle() } }
                    .gesture(DragGesture(minimumDistance: 8).onEnded { v in
                        withAnimation(.smooth) {
                            if v.translation.height < -30 { sheetUp = true } else if v.translation.height > 30 { sheetUp = false }
                        }
                    })
                    .accessibilityElement()
                    .accessibilityAddTraits(.isButton)
                    .accessibilityLabel(sheetUp ? "Show more of the map" : "Show more results")
                rail
            }
            .frame(height: sheetUp ? size.height * 0.86 : peek)
            .background(Color.paper, in: UnevenRoundedRectangle(topLeadingRadius: 18, topTrailingRadius: 18))
            .overlay(UnevenRoundedRectangle(topLeadingRadius: 18, topTrailingRadius: 18).stroke(Color.rule, lineWidth: 1))
        }
    }

    /// The controls float over the map as pills: back, the office, what the colors show, and the pen.
    private var pills: some View {
        HStack(spacing: 8) {
            if state != nil {
                Button { back() } label: {
                    Image(systemName: "chevron.left").font(.headline).frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .background(Color.sheet.opacity(0.92), in: Circle())
                .overlay(Circle().stroke(Color.rule, lineWidth: 1))
                .accessibilityLabel("United States")
            }
            if drawing {
                ForEach(Self.inks, id: \.self) { c in
                    Button { ink = c } label: {
                        Circle().fill(c).frame(width: 26, height: 26)
                            .overlay(Circle().stroke(Color.ink, lineWidth: ink == c ? 2 : 0).padding(-4))
                            .frame(width: 44, height: 44)
                    }
                    .accessibilityLabel(c == .tossup ? "Yellow ink" : c == .white ? "White ink" : "Red ink")
                }
                Button { clearToken += 1 } label: { Image(systemName: "trash").font(.headline).frame(width: 44, height: 44) }
                    .buttonStyle(.plain)
                    .background(Color.sheet.opacity(0.92), in: Circle())
                    .accessibilityLabel("Clear drawing")
            } else {
                Menu {
                    Picker("Office", selection: $office) {
                        ForEach(Self.offices) { Text($0 == .governor ? "Governor" : $0.label).tag($0) }
                    }
                } label: { pill(office == .governor ? "Governor" : office.label) }
                .accessibilityLabel("Office")
                Menu {
                    Picker("Shade by", selection: $lens) {
                        ForEach(WallLens.available(counties: countyLevel)) { Text($0.label).tag($0) }
                    }
                    if !countyLevel { Toggle("Stripe flips", isOn: $showFlips) }
                } label: { pill(lens.label) }
                .accessibilityLabel("Shade by")
            }
            Spacer(minLength: 0)
            Button { drawing.toggle() } label: {
                Image(systemName: drawing ? "pencil.tip.crop.circle.fill" : "pencil.tip.crop.circle").font(.title2).frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .background(Color.sheet.opacity(0.92), in: Circle())
            .overlay(Circle().stroke(Color.rule, lineWidth: 1))
            .accessibilityLabel(drawing ? "Stop drawing" : "Draw on the map")
        }
        .foregroundStyle(Color.ink)
    }

    private func pill(_ text: String) -> some View {
        HStack(spacing: 8) {
            Text(text).font(.headline)
            Image(systemName: "chevron.down").font(.caption.weight(.bold))
        }
        .padding(.horizontal, 18)
        .frame(height: 44)
        .background(Color.sheet.opacity(0.92), in: Capsule())
        .overlay(Capsule().stroke(Color.rule, lineWidth: 1))
    }

    @ViewBuilder private var mapArea: some View {
        ZStack(alignment: .bottomLeading) {
            if let nation {
                let races = MapRaces.index(live.races, office: office)
                WallMap(nation: nation, districts: districts, counties: countyMap, office: office, state: state, selected: selected,
                        shapeFills: shapeFills(office == .house && !districts.isEmpty ? districts : nation.shapes, races),
                        countyFills: office == .house ? [:] : countyFills(countyMap), flips: flipIds(races),
                        onTap: tapped, onPinchOut: back)
                    // Leaves room for the pills along the top.
                    .padding(.top, 52)
                if office == .house, districts.isEmpty { ProgressView("Loading districts").frame(maxWidth: .infinity, maxHeight: .infinity) }
            } else if let mapError {
                ErrorBanner(message: mapError).padding().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Telestrator(active: drawing, color: ink, clearToken: clearToken)
                .allowsHitTesting(drawing)
            WallLegend(lens: lens, flips: showFlips && !countyLevel, compact: sizeClass != .regular).padding(12).allowsHitTesting(false)
        }
        .overlay(alignment: .top) { pills.padding(12) }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
    }

    private var rail: some View {
        ScrollView {
            Group {
                if let state {
                    StateRail(office: office, state: state, races: stateRaces, race: race,
                              county: selected.flatMap { countyResults[$0] }, select: pick, showsTitle: sizeClass == .regular)
                } else {
                    NationRail(office: office, pick: pick)
                }
            }
            .padding(16)
        }
        .background(Color.paper)
    }

    // MARK: Shading

    /// Every state or district's color, by shape id, in one pass over the races.
    private func shapeFills(_ shapes: [MapShapeData], _ races: [String: Race]) -> [String: Color] {
        Dictionary(shapes.map { shape in
            let color = races[shape.id].map { lens == .forecast ? Theme.forecastFill($0) : Theme.fill($0) } ?? Color.rule.opacity(0.5)
            return (shape.id, color)
        }, uniquingKeysWith: { a, _ in a })
    }

    /// Seats set to change party, striped as on a network's map.
    private func flipIds(_ races: [String: Race]) -> Set<String> {
        guard showFlips, !countyLevel else { return [] }
        return Set(races.filter { Holders.flipTo($0.value) != nil }.keys)
    }

    private func countyFills(_ map: LoadedMap?) -> [String: Color] {
        let results = countyResults
        return Dictionary((map?.shapes ?? []).map { shape in
            let county = results[shape.id]
            switch lens {
            case .past: return (shape.id, Theme.pastFill(county))
            case .shift: return (shape.id, Theme.swingFill(county))
            case .results, .forecast: return (shape.id, Theme.countyFill(county))
            }
        }, uniquingKeysWith: { a, _ in a })
    }

    // MARK: Moves

    private func tapped(_ tap: WallTap) {
        switch tap {
        case .shape(let id) where office == .house:
            let st = String(id.prefix(2))
            if st != state { open(st) }
            selected = id
            raceId = MapRaces.race(live.races, office: .house, shape: id)?.id
        case .shape(let id):
            if id != state { open(id) }
        case .county(let fips):
            selected = selected == fips ? nil : fips
        case .background:
            selected = nil
            if office == .house { raceId = nil }
        }
    }

    /// Picks a race from the rail, flying to its state first.
    private func pick(_ race: Race) {
        if race.state != state { open(race.state) }
        raceId = race.id
        selected = race.office == .house ? "\(race.state)-\(race.district ?? 0)" : nil
    }

    private func open(_ newState: String) {
        withAnimation(.smooth(duration: 0.6)) {
            state = newState
            // On a phone, lower the sheet so the state shows.
            sheetUp = false
        }
        selected = nil
        raceId = office == .house ? nil : MapRaces.races(live.races, office: office, state: newState).first?.id
        clearToken += 1
        fixLens()
    }

    private func back() {
        withAnimation(.smooth(duration: 0.6)) { state = nil }
        selected = nil
        raceId = nil
        clearToken += 1
        fixLens()
    }

    private func fixLens() {
        if !WallLens.available(counties: countyLevel).contains(lens) { lens = .results }
    }

    /// Keeps the shown race's county results fresh on election night, until it's called.
    private func followRace() async {
        guard let raceId, office != .house else { return }
        if detail?.race.id != raceId { detail = nil }
        while !Task.isCancelled {
            if let fresh = try? await API.shared.get("/api/midterms/race/\(raceId)", as: RaceResponse.self) { detail = fresh }
            guard Polls.isElectionNight(), !(live.byId[raceId]?.isCalled ?? false) else { return }
            try? await Task.sleep(for: .seconds(30))
        }
    }
}

/// What the colors mean under the current lens.
private struct WallLegend: View {
    let lens: WallLens
    /// Whether striped seats are on the map, to explain them.
    var flips = false
    /// A phone shows the swatches without the notes.
    var compact = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            switch lens {
            case .results:
                HStack(spacing: 12) { swatch(.dem, "Dem"); swatch(.rep, "Rep"); swatch(.tossup, "Toss-up") }
                note("Paler means an early or narrow lead. Before votes, the forecast's rating.")
            case .forecast:
                HStack(spacing: 2) {
                    ForEach([Color.safeD, .likelyD, .leanD, .tossup, .leanR, .likelyR, .safeR], id: \.self) { Rectangle().fill($0).frame(width: 22, height: 10) }
                }
                note("Safe, likely and lean D, toss-up, then lean, likely and safe R")
            case .past:
                HStack(spacing: 12) { swatch(.dem, "Harris"); swatch(.rep, "Trump") }
                note("2024 presidential margin by county")
            case .shift:
                HStack(spacing: 12) { swatch(.dem, "Toward D"); swatch(.rep, "Toward R") }
                note("Swing since the 2024 presidential vote, counties with votes")
            }
            if flips {
                HStack(spacing: 4) {
                    flipSwatch(.dem)
                    flipSwatch(.rep)
                    Text("Flip: set to change party").font(.caption)
                }
            }
        }
        .padding(10)
        .background(Color.sheet.opacity(0.9), in: RoundedRectangle(cornerRadius: Theme.corner))
        .overlay(RoundedRectangle(cornerRadius: Theme.corner).stroke(Color.rule, lineWidth: 1))
    }

    private func swatch(_ color: Color, _ label: String) -> some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 12, height: 12)
            Text(label).font(.caption)
        }
    }

    /// A square striped like a flipped seat on the map.
    private func flipSwatch(_ color: Color) -> some View {
        Canvas { ctx, size in
            let rect = CGRect(origin: .zero, size: size)
            ctx.fill(Path(rect), with: .color(color))
            ctx.stroke(MapLayer.stripes(over: rect, spacing: 4), with: .color(Color.paper.opacity(0.45)), lineWidth: 1.6)
        }
        .frame(width: 12, height: 12)
        .clipShape(RoundedRectangle(cornerRadius: 2))
    }

    @ViewBuilder private func note(_ text: String) -> some View {
        if !compact { Text(text).font(.caption2).foregroundStyle(.secondary) }
    }
}
