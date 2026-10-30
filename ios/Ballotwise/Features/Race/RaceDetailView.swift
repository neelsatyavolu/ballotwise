import SwiftUI

/// One race in full: every candidate, its call, forecast, markets, polls, the count over time and county results.
struct RaceDetailView: View {
    let id: Int
    @Environment(LiveStore.self) private var live
    @Environment(AccountStore.self) private var account
    @State private var detail: RaceResponse?
    @State private var odds: RaceForecastResponse?
    @State private var markets: MarketsResponse?
    @State private var error: String?

    private var race: Race? { detail?.race ?? live.byId[id] }

    var body: some View {
        ScrollView {
            if let race {
                LazyVStack(alignment: .leading, spacing: 16) {
                    header(race)
                    if let error { ErrorBanner(message: error) }
                    candidates(race)
                    if let about = race.about { aboutCard(about) }
                    if race.signal != nil { ForecastCard(race: race) }
                    if let history = detail?.history, history.count > 1 { CountChart(points: history) }
                    if race.local == nil { CountyMap(raceId: race.id, state: race.state, counties: detail?.race.counties) }
                    if let counties = detail?.race.counties, counties.contains(where: { $0.total > 0 }) { CountyTable(race: race, counties: counties) }
                    if let markets { MarketChart(markets: markets) }
                    if let p = odds?.history, p.days.count > 1 { WinHistoryChart(history: p) }
                    if let polls = odds?.polls { PollsCard(polls: polls) }
                    Link(destination: API.base.appendingPathComponent("midterms/\(race.id)")) {
                        Label("Open on ballotwise.xanom.co", systemImage: "safari")
                    }
                    .font(.footnote)
                }
                .padding()
            } else if let error {
                ContentUnavailableView("Couldn't load this race", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                ProgressView().padding(60)
            }
        }
        .background(Color.paper)
        .navigationTitle(race.map(Format.label) ?? "Race")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    account.toggleStar(id)
                } label: {
                    Image(systemName: account.isStarred(id) ? "star.fill" : "star")
                }
                .accessibilityLabel(account.isStarred(id) ? "Unstar" : "Star for alerts")
                ShareLink(item: API.base.appendingPathComponent("midterms/\(id)"))
            }
        }
        .refreshable { await load() }
        .task(id: id) {
            await live.loadPhotos()
            async let extras: Void = loadExtras()
            // Keep the count fresh while the page is open on election night, until the race is called.
            while !Task.isCancelled {
                await load()
                guard Polls.isElectionNight(), !(race?.isCalled ?? false) else { break }
                try? await Task.sleep(for: .seconds(30))
            }
            await extras
        }
    }

    private func load() async {
        do {
            detail = try await API.shared.get("/api/midterms/race/\(id)", as: RaceResponse.self)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func loadExtras() async {
        guard live.byId[id]?.office != .measure else { return }
        async let f = try? API.shared.get("/api/midterms/race/\(id)/forecast", as: RaceForecastResponse.self)
        async let m = try? API.shared.get("/api/midterms/race/\(id)/markets", as: MarketsResponse.self)
        odds = await f
        let loaded = await m
        if loaded?.kalshi != nil || loaded?.polymarket != nil { markets = loaded }
    }

    private func header(_ race: Race) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(Format.label(race)).font(.serif(.largeTitle, weight: .bold))
                RatingChip(rating: race.rating)
            }
            Text(race.title).font(.subheadline).foregroundStyle(.secondary)
            StatusLine(race: race)
            if race.total == 0, let close = Polls.final(race.state), close > .now {
                Text("Polls close at \(Format.eastern(close, withDay: true))").font(.caption).foregroundStyle(.secondary)
            }
            if race.rcv ?? false {
                Text("Ranked-choice race: the leader can change between rounds\(race.round.map { " (round \($0))" } ?? "").").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func candidates(_ race: Race) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(Format.ballotOrder(race), id: \.name) { c in
                CandidateRow(race: race, candidate: c, chance: chance(race, c))
            }
            if race.total > 0 {
                Text("\(Format.votes(race.total)) votes counted").font(.caption).foregroundStyle(.secondary)
            }
        }
        .panel()
    }

    private func chance(_ race: Race, _ c: Candidate) -> Double? {
        guard let f = race.signal?.forecast else { return nil }
        return f.odds.ranked.first { Format.nominee(race.candidates, side: $0.side, forecast: f) == c }?.p
    }

    private func aboutCard(_ about: About) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("What it does").font(.serif(.headline))
            Text(about.text).font(.body)
            if let s = about.url, let url = URL(string: s) {
                Link("Source: Ballotpedia", destination: url).font(.footnote)
            }
        }
        .panel()
    }
}

/// The forecast's odds for each side, with the evidence behind the rating.
struct ForecastCard: View {
    let race: Race

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Forecast").font(.serif(.headline))
            if let f = race.signal?.forecast {
                let ranked = f.odds.ranked
                GeometryReader { g in
                    HStack(spacing: 2) {
                        ForEach(ranked, id: \.side) { side, p in
                            Rectangle().fill(Theme.sideColor(side)).frame(width: max(2, g.size.width * p - 2))
                        }
                    }
                }
                .frame(height: 12)
                .clipShape(RoundedRectangle(cornerRadius: 3))
                HStack {
                    ForEach(ranked, id: \.side) { side, p in
                        let who = Format.nominee(race.candidates, side: side, forecast: f).map { Format.lastName($0.name) } ?? side
                        Text("\(who) \(Format.chance(p))").font(.subheadline.monospacedDigit().weight(.semibold)).foregroundStyle(Theme.sideColor(side))
                        if side != ranked.last?.side { Spacer() }
                    }
                }
                if let m = f.margin { Text("Projected margin: \(Format.marginLabel(m))").font(.caption).foregroundStyle(.secondary) }
            }
            if let market = race.signal?.market, let top = market.odds.ranked.first {
                Text("Markets (\((market.sources ?? []).joined(separator: ", "))): \(["D": "Dem", "R": "Rep", "I": "Ind"][top.side] ?? top.side) \(Format.chance(top.p))")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let polls = race.signal?.polls {
                Text("Polling average: \(Format.marginLabel(polls.margin)) across \(polls.count) poll\(polls.count == 1 ? "" : "s")").font(.caption).foregroundStyle(.secondary)
            }
        }
        .panel()
    }
}
