import SwiftUI

/// Opens a race's page from any list.
struct RaceLink: Hashable { let id: Int }

struct Avatar: View {
    let url: URL?
    let name: String
    let color: Color
    var size: CGFloat = 36

    var body: some View {
        AsyncImage(url: url) { phase in
            if let image = phase.image {
                image.resizable().scaledToFill()
            } else {
                Text(initials).font(.system(size: size * 0.36, weight: .semibold)).foregroundStyle(color)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(color.opacity(0.12))
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().stroke(color, lineWidth: 2))
        .accessibilityHidden(true)
    }

    private var initials: String {
        Format.isYes(name) ? "Y" : Format.isNo(name) ? "N" : name.split(separator: " ").compactMap(\.first).prefix(2).map(String.init).joined()
    }
}

struct RatingChip: View {
    let rating: String?
    var body: some View {
        if let rating, let label = Format.ratingLabel[rating] {
            Text(label)
                .font(.caption2.weight(.semibold))
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Theme.ratingColor(rating), in: RoundedRectangle(cornerRadius: 4))
                .foregroundStyle(rating == "tossup" || rating.hasPrefix("lean") ? Color.black : Color.white)
        }
    }
}

/// Where a race stands: called (and for whom), call pending, counting, or not started.
struct StatusLine: View {
    let race: Race
    var body: some View {
        HStack(spacing: 6) {
            if let w = race.winner {
                Image(systemName: "checkmark.seal.fill").foregroundStyle(Theme.color(w))
                Text(race.office == .measure ? (Format.isYes(w.name) ? "Passed" : "Failed") : "Called for \(Format.lastName(w.name))")
                    .fontWeight(.semibold)
            } else if race.callPending ?? false {
                Image(systemName: "hourglass")
                Text("Call being confirmed")
            } else if race.call?.withdrawn ?? false {
                Image(systemName: "arrow.uturn.backward")
                Text("Call withdrawn")
            }
            Text(Format.reporting(race)).foregroundStyle(.secondary)
            if race.missing ?? false { Text("· last known").foregroundStyle(.secondary) }
        }
        .font(.caption)
        .foregroundStyle(Color.ink)
    }
}

/// One candidate with a share bar. `max` scales bars against the race's top share.
struct CandidateRow: View {
    @Environment(LiveStore.self) private var live
    let race: Race
    let candidate: Candidate
    var chance: Double?
    var compact = false

    var body: some View {
        let color = Theme.color(candidate)
        HStack(spacing: 10) {
            Avatar(url: live.photo(race, candidate.name), name: candidate.name, color: color, size: compact ? 30 : 40)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(candidate.name).font(compact ? .subheadline : .body).fontWeight(candidate.isWinner ? .bold : .regular).lineLimit(1)
                    let tag = Format.partyTag(candidate.party)
                    if !tag.isEmpty { Text(tag).font(.caption).foregroundStyle(.secondary) }
                    if candidate.isIncumbent { Text("Inc.").font(.caption2).foregroundStyle(.secondary) }
                    if candidate.isWinner { Image(systemName: "checkmark.circle.fill").foregroundStyle(color).font(.caption) }
                    Spacer(minLength: 4)
                    if race.total > 0 {
                        Text(Format.pct(candidate.pct)).font(.subheadline.monospacedDigit().weight(.semibold))
                    } else if let chance {
                        Text(Format.chance(chance)).font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                    }
                }
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.rule.opacity(0.5))
                        Capsule().fill(color).frame(width: g.size.width * min(1, (race.total > 0 ? candidate.pct / 100 : chance ?? 0)))
                    }
                }
                .frame(height: compact ? 5 : 7)
                if !compact, race.total > 0 {
                    Text("\(Format.votes(candidate.votes)) votes").font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// A race in a list: name, rating, status and the top candidates.
struct RaceCard: View {
    @Environment(AccountStore.self) private var account
    let race: Race
    var showCandidates = 2

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(Format.label(race)).font(.serif(.headline))
                RatingChip(rating: race.rating)
                Spacer()
                Button {
                    account.toggleStar(race.id)
                } label: {
                    Image(systemName: account.isStarred(race.id) ? "star.fill" : "star")
                        .foregroundStyle(account.isStarred(race.id) ? Color.tossup : Color.muted)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(account.isStarred(race.id) ? "Unstar" : "Star for alerts")
            }
            if race.office == .measure, let about = race.about {
                Text(about.text).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            let ordered = Format.ballotOrder(race)
            ForEach(Array(ordered.prefix(showCandidates)), id: \.name) { c in
                CandidateRow(race: race, candidate: c, chance: chance(for: c), compact: true)
            }
            HStack {
                StatusLine(race: race)
                Spacer()
                if race.total == 0, let leader = Format.forecastLeader(race) {
                    Text("Forecast: \(leader)").font(.caption).foregroundStyle(.secondary)
                }
            }
            if let trend = race.trend, trend.votesAdded > 0 {
                Text("+\(Format.votes(trend.votesAdded)) votes since \(Format.ago(trend.since))").font(.caption2).foregroundStyle(Color.flagBlue)
            }
        }
        .panel(padding: 12)
    }

    private func chance(for c: Candidate) -> Double? {
        guard let f = race.signal?.forecast else { return nil }
        for (side, p) in f.odds.ranked where Format.nominee(race.candidates, side: side, forecast: f) == c { return p }
        return nil
    }
}

/// Seats won by each side against the majority line, with uncalled seats in the middle.
struct SeatBar: View {
    let title: String
    let tally: Tally
    /// The forecast's projected seats, shown before any votes are counted.
    var projected: (d: Int, r: Int)?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.serif(.headline))
                Spacer()
                Text("\(tally.majority) for majority").font(.caption).foregroundStyle(.secondary)
            }
            HStack {
                Label("\(tally.d)", systemImage: "circle.fill").labelStyle(Dot(color: .dem))
                Spacer()
                if tally.uncalled > 0 { Text("\(tally.uncalled) uncalled").font(.caption).foregroundStyle(.secondary) }
                Spacer()
                Label("\(tally.r)", systemImage: "circle.fill").labelStyle(Dot(color: .rep, trailing: true))
            }
            .font(.title3.monospacedDigit().weight(.bold))
            GeometryReader { g in
                let w = g.size.width / CGFloat(max(tally.total, 1))
                ZStack(alignment: .leading) {
                    HStack(spacing: 0) {
                        Rectangle().fill(Color.dem).frame(width: w * CGFloat(tally.d))
                        Rectangle().fill(Color.oth).frame(width: w * CGFloat(tally.other))
                        Rectangle().fill(Color.rule.opacity(0.6))
                        Rectangle().fill(Color.rep).frame(width: w * CGFloat(tally.r))
                    }
                    if let projected {
                        HStack(spacing: 0) {
                            Rectangle().fill(Color.dem.opacity(0.35)).frame(width: w * CGFloat(max(0, projected.d - tally.d)))
                            Spacer(minLength: 0)
                            Rectangle().fill(Color.rep.opacity(0.35)).frame(width: w * CGFloat(max(0, projected.r - tally.r)))
                        }
                        .padding(.leading, w * CGFloat(tally.d + tally.other))
                        .padding(.trailing, w * CGFloat(tally.r))
                    }
                    Rectangle().fill(Color.ink).frame(width: 2, height: 22).offset(x: w * CGFloat(tally.majority) - 1)
                }
            }
            .frame(height: 16)
            .clipShape(RoundedRectangle(cornerRadius: 3))
            if let projected, tally.uncalled == tally.total {
                Text("Forecast: \(projected.d) D, \(projected.r) R").font(.caption).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title): Democrats \(tally.d), Republicans \(tally.r), \(tally.uncalled) uncalled, \(tally.majority) for majority")
    }
}

private struct Dot: LabelStyle {
    let color: Color
    var trailing = false
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            if trailing { configuration.title }
            Circle().fill(color).frame(width: 10, height: 10)
            if !trailing { configuration.title }
        }
    }
}

struct ErrorBanner: View {
    let message: String
    var body: some View {
        Label(message, systemImage: "exclamationmark.triangle")
            .font(.footnote)
            .foregroundStyle(Color.flagRed)
            .frame(maxWidth: .infinity, alignment: .leading)
            .panel(padding: 10)
    }
}
