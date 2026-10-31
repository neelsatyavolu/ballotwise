import SwiftUI

/// Candidates as a network's board shows them: each row carries a bar in the party's color as wide as the
/// candidate's share, with the name and party on the left and the share and votes on the right. Then where the
/// count stands. Used for a whole race or one county.
struct ResultsTable: View {
    @Environment(LiveStore.self) private var live
    /// The race the candidates run in, for their photos.
    let race: Race
    let candidates: [Candidate]
    let total: Int
    let reporting: Double
    let reportingUnknown: Bool
    let status: String
    /// Before votes, each contender's forecast chance shows where the share will go.
    var chance: (Candidate) -> Double? = { _ in nil }
    var limit = 5

    var body: some View {
        let shown = Array(candidates.prefix(limit))
        VStack(spacing: 0) {
            HStack {
                Text("Candidates")
                Spacer()
                Text(total == 0 && candidates.contains { chance($0) != nil } ? "Chance" : "Votes")
            }
            .font(.caption.weight(.bold))
            .textCase(.uppercase)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
            .accessibilityHidden(true)
            ForEach(shown, id: \.name) { c in
                Divider()
                row(c)
            }
            if candidates.count > shown.count {
                Divider()
                Text("+\(candidates.count - shown.count) more").font(.caption).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
            }
            Divider()
            footer
        }
    }

    private func row(_ c: Candidate) -> some View {
        let color = Theme.color(c)
        let share = total > 0 ? min(1, c.pct / 100) : 0
        return HStack(spacing: 12) {
            Avatar(url: live.photo(race, c.name), name: c.name, color: color, size: 38)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(c.name).font(.headline).lineLimit(1).minimumScaleFactor(0.8)
                    if c.isIncumbent { Text("*").font(.headline).accessibilityLabel("incumbent") }
                    if c.isWinner { Image(systemName: "checkmark.seal.fill").accessibilityLabel("projected winner") }
                }
                if !c.party.isEmpty { Text(c.party).font(.subheadline).foregroundStyle(.secondary).lineLimit(1) }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                if total > 0 {
                    Text(Format.pct(c.pct)).font(.headline.monospacedDigit())
                    Text(Format.votes(c.votes)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                } else if let p = chance(c) {
                    Text(Format.chance(p)).font(.headline.monospacedDigit())
                    Text("to win").font(.caption).foregroundStyle(.secondary)
                } else {
                    Text("–").font(.headline).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.leading, 20)
        .padding(.trailing, 16)
        .padding(.vertical, 10)
        .background(alignment: .leading) {
            GeometryReader { g in Rectangle().fill(color.opacity(0.45)).frame(width: g.size.width * share) }
        }
        .overlay(alignment: .leading) { Rectangle().fill(color).frame(width: 6) }
        .accessibilityElement(children: .combine)
    }

    private var footer: some View {
        let known = total > 0 && !reportingUnknown && reporting > 0
        return HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text(status).fontWeight(.semibold).foregroundStyle(Color.ink)
                Text(total == 0 ? "No results yet" : known ? "\(Int(min(100, reporting).rounded()))% reporting" : "Reporting not given")
                if total > 0 { Text("\(Format.votes(total)) votes").monospacedDigit() }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                if candidates.contains(where: \.isWinner) { Label("Projected winner", systemImage: "checkmark.seal.fill") }
                if candidates.contains(where: \.isIncumbent) { Text("* Incumbent") }
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(16)
    }
}

/// One race as a network's board shows it, large enough to read from across the room.
struct RaceBoard: View {
    @Environment(AccountStore.self) private var account
    let race: Race

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Text(WallLogic.title(race)).font(.title2.weight(.heavy)).lineLimit(2).minimumScaleFactor(0.8)
                    Spacer(minLength: 6)
                    Button { account.toggleStar(race.id) } label: {
                        Image(systemName: account.isStarred(race.id) ? "star.fill" : "star")
                            .font(.title3)
                            .foregroundStyle(account.isStarred(race.id) ? Color.tossup : Color.muted)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(account.isStarred(race.id) ? "Unstar" : "Star for alerts")
                }
                HStack(spacing: 8) {
                    Text(WallLogic.subtitle(race)).font(.headline)
                    RatingChip(rating: race.rating)
                }
                if race.total == 0, let sub = Format.signalLine(race) {
                    Text(sub).font(.subheadline).foregroundStyle(.secondary)
                }
                if let trend = race.trend, trend.votesAdded > 0 {
                    Text("+\(Format.votes(trend.votesAdded)) votes since \(Format.ago(trend.since))").font(.caption).foregroundStyle(Color.flagBlue)
                }
            }
            .padding(16)
            ResultsTable(race: race, candidates: Format.ballotOrder(race), total: race.total, reporting: race.reporting,
                         reportingUnknown: race.reportingUnknown ?? false, status: WallLogic.status(race.candidates, state: race.state),
                         chance: chance)
        }
        .panel(padding: 0)
    }

    private func chance(_ c: Candidate) -> Double? {
        guard let f = race.signal?.forecast else { return nil }
        return f.odds.ranked.first { Format.nominee(race.candidates, side: $0.side, forecast: f) == c }?.p
    }
}

/// The county tapped on the map: its own results, and how it voted for president in 2024.
struct CountyBoard: View {
    let race: Race
    let county: County

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                Text(county.name).font(.title2.weight(.heavy))
                Text(WallLogic.title(race)).font(.headline)
                HStack {
                    if let m = county.baseline2024 { Text("2024 president: \(Format.marginLabel(m))").foregroundStyle(.secondary) }
                    if let s = WallLogic.swing(county) {
                        Text("Swing: \(Format.marginLabel(s))").fontWeight(.semibold).foregroundStyle(s > 0 ? Color.dem : Color.rep)
                    }
                }
                .font(.subheadline)
            }
            .padding(16)
            ResultsTable(race: race, candidates: ordered, total: county.total, reporting: county.reporting,
                         reportingUnknown: county.reportingUnknown ?? false, status: WallLogic.status(county.candidates, state: race.state))
        }
        .panel(padding: 0)
    }

    /// Before votes, the race's contenders first, as on the race's own board.
    private var ordered: [Candidate] {
        guard county.total == 0 else { return county.candidates }
        let order = Format.ballotOrder(race).map(\.name)
        return county.candidates.sorted { (order.firstIndex(of: $0.name) ?? .max) < (order.firstIndex(of: $1.name) ?? .max) }
    }
}
