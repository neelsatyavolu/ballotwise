import Charts
import SwiftUI

/// Votes counted over the night and the leader's margin, from our own observations.
struct CountChart: View {
    let points: [VoteObservation]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("The count so far").font(.serif(.headline))
            Chart(points, id: \.at) { p in
                LineMark(x: .value("Time", Date(timeIntervalSince1970: p.at / 1000)), y: .value("Votes", p.total))
                    .interpolationMethod(.stepEnd)
                    .foregroundStyle(Color.ink)
            }
            .chartYAxis { AxisMarks(position: .leading) }
            .frame(height: 140)
            if let last = points.last, let name = last.leadName, let margin = last.margin {
                Text("\(name) leads by \(String(format: "%.1f", margin)) points").font(.caption).foregroundStyle(.secondary)
            }
        }
        .panel()
    }
}

/// Each side's chance in the forecast, day by day.
struct WinHistoryChart: View {
    let history: RaceForecastResponse.History

    var body: some View {
        let rows = zip(history.days, history.p).compactMap { day, p in Format.day(day).map { ($0, p) } }
        VStack(alignment: .leading, spacing: 8) {
            Text("Forecast over time").font(.serif(.headline))
            Chart {
                ForEach(rows, id: \.0) { date, p in
                    LineMark(x: .value("Day", date), y: .value("Chance", p), series: .value("Side", history.side))
                        .foregroundStyle(Theme.sideColor(history.side))
                    LineMark(x: .value("Day", date), y: .value("Chance", 1 - p), series: .value("Side", "other"))
                        .foregroundStyle(Theme.sideColor(history.side == "D" ? "R" : "D"))
                }
                RuleMark(y: .value("Even", 0.5)).foregroundStyle(Color.rule).lineStyle(StrokeStyle(dash: [3, 3]))
            }
            .chartYScale(domain: 0...1)
            .chartYAxis { AxisMarks(values: [0, 0.25, 0.5, 0.75, 1]) { v in AxisGridLine(); AxisValueLabel { Text("\(Int((v.as(Double.self) ?? 0) * 100))%") } } }
            .frame(height: 160)
        }
        .panel()
    }
}

/// Kalshi and Polymarket prices for the race's candidates.
struct MarketChart: View {
    let markets: MarketsResponse
    @State private var source = "Kalshi"

    var body: some View {
        let market = source == "Kalshi" ? (markets.kalshi ?? markets.polymarket) : (markets.polymarket ?? markets.kalshi)
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Prediction markets").font(.serif(.headline))
                Spacer()
                if markets.kalshi != nil, markets.polymarket != nil {
                    Picker("Market", selection: $source) {
                        Text("Kalshi").tag("Kalshi")
                        Text("Polymarket").tag("Polymarket")
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 190)
                }
            }
            if let market {
                Chart {
                    ForEach(market.lines, id: \.name) { line in
                        ForEach(line.all.filter { !($0.values.first ?? .nan).isNaN }) { pt in
                            LineMark(x: .value("Time", pt.date), y: .value("Price", pt.values[0]), series: .value("Candidate", line.name))
                                .foregroundStyle(Theme.sideColor(line.side ?? ""))
                        }
                    }
                }
                .chartYScale(domain: 0...1)
                .chartYAxis { AxisMarks(values: [0, 0.5, 1]) { v in AxisGridLine(); AxisValueLabel { Text("\(Int((v.as(Double.self) ?? 0) * 100))¢") } } }
                .frame(height: 160)
                ForEach(market.lines, id: \.name) { line in
                    HStack {
                        Circle().fill(Theme.sideColor(line.side ?? "")).frame(width: 8, height: 8)
                        Text(line.name).font(.caption)
                        Spacer()
                        Text(Format.chance(line.now)).font(.caption.monospacedDigit().weight(.semibold))
                    }
                }
                if let url = URL(string: market.url) { Link(market.question, destination: url).font(.caption2) }
            }
        }
        .panel()
    }
}

/// The polling average and every poll behind it.
struct PollsCard: View {
    let polls: RaceForecastResponse.Polls
    @State private var showAll = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Polls").font(.serif(.headline))
            if let avg = polls.average {
                HStack {
                    VStack(alignment: .leading) {
                        Text(polls.leftName).font(.caption)
                        Text(String(format: "%.1f%%", avg.left)).font(.title3.monospacedDigit().weight(.bold)).foregroundStyle(Theme.sideColor(polls.left))
                    }
                    Spacer()
                    Text("Average of \(avg.count)").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    VStack(alignment: .trailing) {
                        Text(polls.rightName).font(.caption)
                        Text(String(format: "%.1f%%", avg.right)).font(.title3.monospacedDigit().weight(.bold)).foregroundStyle(Theme.sideColor(polls.left == "D" ? "R" : "D"))
                    }
                }
            }
            ForEach(showAll ? polls.rows : Array(polls.rows.prefix(5)), id: \.self) { poll in
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(poll.pollster).font(.subheadline.weight(.semibold))
                        if poll.internal ?? false { Text("Internal").font(.caption2).foregroundStyle(.secondary) }
                        Spacer()
                        Text(Format.marginLabel(poll.margin)).font(.subheadline.monospacedDigit())
                    }
                    Text("\(poll.start) to \(poll.end)\(poll.n.map { ", \($0) \(poll.pop?.uppercased() ?? "")" } ?? "")").font(.caption2).foregroundStyle(.secondary)
                    if let why = poll.excluded { Text("Not in the average: \(why)").font(.caption2).foregroundStyle(.secondary) }
                }
                Divider()
            }
            if polls.rows.count > 5 {
                Button(showAll ? "Show fewer" : "Show all \(polls.rows.count) polls") { showAll.toggle() }.font(.footnote)
            }
        }
        .panel()
    }
}
