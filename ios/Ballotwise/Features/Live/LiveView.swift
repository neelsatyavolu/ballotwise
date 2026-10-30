import SwiftUI

/// The home screen: the countdown or next poll closing, the balance of power, your starred races, the latest calls
/// and the closest races.
struct LiveView: View {
    @Binding var tab: AppTab
    @Environment(LiveStore.self) private var live
    @Environment(AccountStore.self) private var account
    @Environment(ForecastStore.self) private var forecast
    @Environment(PushManager.self) private var push

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                ClockCard()
                if let error = live.error { ErrorBanner(message: error) }
                if push.authorization == .notDetermined { AlertsPrompt() }

                if let balance = live.overview?.balance {
                    VStack(spacing: 16) {
                        ForEach([Office.senate, .house, .governor]) { office in
                            NavigationLink(value: office) {
                                SeatBar(title: office == .governor ? "Governors" : office.label, tally: balance.tally(office)!, projected: forecast.projected(office))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .panel()
                } else if live.loading {
                    ProgressView("Loading results").frame(maxWidth: .infinity).padding(40)
                }

                let starred = account.starred.compactMap { live.byId[$0] }
                if !starred.isEmpty {
                    SectionTitle("Your races")
                    ForEach(starred) { race in
                        NavigationLink(value: RaceLink(id: race.id)) { RaceCard(race: race) }.buttonStyle(.plain)
                    }
                }

                if let events = live.overview?.callEvents, !events.isEmpty {
                    SectionTitle("Latest calls")
                    CallsList(events: Array(events.prefix(8)))
                }

                let close = closest
                if !close.isEmpty {
                    SectionTitle(Polls.isElectionNight() ? "Closest races" : "Races to watch")
                    ForEach(close) { race in
                        NavigationLink(value: RaceLink(id: race.id)) { RaceCard(race: race) }.buttonStyle(.plain)
                    }
                    Button("See every race") { tab = .races }.frame(maxWidth: .infinity)
                }

                UpdatedFooter()
            }
            .padding()
        }
        .background(Color.paper)
        .navigationTitle("Midterms 2026")
        .refreshable {
            await live.refresh()
            await forecast.load(force: true)
        }
        .task {
            await live.loadPhotos()
            await forecast.load()
        }
    }

    /// Senate and governor races: uncalled ones with the smallest lead once counting, else the forecast's toss-ups.
    private var closest: [Race] {
        let pool = live.races.filter { ($0.office == .senate || $0.office == .governor) && !$0.isCalled }
        let counting = pool.filter { $0.total > 0 && !Format.isEarly($0) }
        if counting.count >= 3 {
            return Array(counting.sorted { (Format.lead($0.candidates)?.margin ?? 100) < (Format.lead($1.candidates)?.margin ?? 100) }.prefix(6))
        }
        return Array(pool.filter { $0.rating != nil }.sorted(by: Format.compare).prefix(6))
    }
}

struct SectionTitle: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text).font(.serif(.title3)).padding(.top, 4)
    }
}

/// Before Nov 3, a countdown to Election Day. On the night, the next poll closing and which states it covers.
struct ClockCard: View {
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let now = context.date
            VStack(alignment: .leading, spacing: 6) {
                if now < Polls.firstPollsOpen {
                    Text("Polls open in").font(.subheadline).foregroundStyle(.secondary)
                    Text(Polls.countdown(to: Polls.firstPollsOpen, from: now)).font(.system(.largeTitle, design: .monospaced, weight: .bold))
                    Text("First polls open at 6 a.m. ET on Tuesday, Nov 3.").font(.caption).foregroundStyle(.secondary)
                } else if let wave = Polls.nextWave(after: now) {
                    Text("Next polls close at \(Format.eastern(wave.at))").font(.subheadline).foregroundStyle(.secondary)
                    Text(Polls.countdown(to: wave.at, from: now)).font(.system(.largeTitle, design: .monospaced, weight: .bold)).foregroundStyle(Color.flagRed)
                    Text(wave.list).font(.caption).foregroundStyle(.secondary)
                } else {
                    Text("All polls have closed").font(.serif(.title2))
                    Text("Counting continues; races are called as results come in.").font(.caption).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .panel()
        }
    }
}

struct AlertsPrompt: View {
    @Environment(PushManager.self) private var push
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Get alerts on election night", systemImage: "bell.badge").font(.headline)
            Text("When a race you starred is called, when a chamber is decided, and when polls close.").font(.subheadline).foregroundStyle(.secondary)
            Button("Turn on alerts") { Task { await push.requestPermission() } }.buttonStyle(.borderedProminent)
        }
        .panel()
    }
}

struct UpdatedFooter: View {
    @Environment(LiveStore.self) private var live
    var body: some View {
        TimelineView(.periodic(from: .now, by: 5)) { context in
            HStack(spacing: 6) {
                if live.overview?.stale ?? false {
                    Image(systemName: "exclamationmark.circle").foregroundStyle(Color.flagRed)
                    Text("Results may be behind; civicAPI is slow.")
                } else if let fetched = live.overview?.fetchedAt {
                    Text("Results from civicAPI, \(Format.ago(fetched, now: context.date))")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity)
        }
    }
}

/// Race calls, newest first.
struct CallsList: View {
    @Environment(LiveStore.self) private var live
    let events: [CallEvent]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(events) { e in
                NavigationLink(value: RaceLink(id: e.raceId)) {
                    HStack(alignment: .top, spacing: 10) {
                        Circle().fill(e.winner == nil ? Color.muted : Theme.sideColor(Format.partyTag(e.party ?? ""))).frame(width: 10, height: 10).padding(.top, 5)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(live.byId[e.raceId].map(Format.label) ?? "Race").font(.subheadline.weight(.semibold))
                            Text(describe(e)).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(Format.eastern(Date(timeIntervalSince1970: e.at / 1000))).font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 8)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if e.id != events.last?.id { Divider() }
            }
        }
        .panel(padding: 12)
    }

    private func describe(_ e: CallEvent) -> String {
        let tag = Format.partyTag(e.party ?? "")
        let who = (e.winner ?? "") + (tag.isEmpty ? "" : " (\(tag))")
        switch e.kind {
        case "withdrawal": return "Call for \(e.previous ?? "the leader") withdrawn"
        case "change": return "Now \(who), was \(e.previous ?? "another candidate")"
        default: return e.office == .measure ? (Format.isYes(e.winner ?? "") ? "Passed" : "Failed") : "\(who) wins"
        }
    }
}
