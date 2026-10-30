import Charts
import SwiftUI

/// The chamber forecast: each party's chance of control, projected seats, the range of outcomes and the trend.
struct ForecastView: View {
    @Environment(ForecastStore.self) private var store
    @Environment(LiveStore.self) private var live
    @State private var office: Office = .senate

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Picker("Chamber", selection: $office) {
                    ForEach([Office.senate, .house, .governor]) { Text($0 == .governor ? "Governors" : $0.label).tag($0) }
                }
                .pickerStyle(.segmented)

                if let chamber = store.chamber(office) {
                    ControlCard(office: office, chamber: chamber)
                    DistributionChart(chamber: chamber)
                    RatingsCard(ratings: chamber.ratings)
                    if let history = store.forecast?.history[office.rawValue], history.count > 1 {
                        ControlHistory(points: history)
                    }
                    let tossups = live.races(office).filter { $0.rating == "tossup" }.sorted(by: Format.compare)
                    if !tossups.isEmpty {
                        SectionTitle("Toss-ups")
                        ForEach(tossups) { race in
                            NavigationLink(value: RaceLink(id: race.id)) { RaceCard(race: race) }.buttonStyle(.plain)
                        }
                    }
                    Text("The forecast blends polls, prediction markets, expert ratings and fundamentals, simulated thousands of times. Updated \(Format.ago(store.forecast?.updatedAt ?? 0)).")
                        .font(.caption).foregroundStyle(.secondary)
                    Link("How the forecast works", destination: API.base.appendingPathComponent("midterms/methodology")).font(.footnote)
                } else if let error = store.error {
                    ErrorBanner(message: error)
                } else {
                    ProgressView().frame(maxWidth: .infinity, minHeight: 200)
                }
            }
            .padding()
        }
        .background(Color.paper)
        .navigationTitle("Forecast")
        .refreshable { await store.load(force: true) }
        .task { await store.load() }
    }
}

private struct ControlCard: View {
    let office: Office
    let chamber: Chamber

    var body: some View {
        let d = chamber.dControl
        VStack(alignment: .leading, spacing: 10) {
            Text(office == .governor ? "Chance of a majority of governorships" : "Chance of controlling the \(office.label)").font(.serif(.headline))
            HStack(alignment: .lastTextBaseline) {
                VStack(alignment: .leading) {
                    Text("Democrats").font(.caption)
                    Text(Format.chance(d)).font(.system(size: 40, weight: .bold).monospacedDigit()).foregroundStyle(Color.dem)
                }
                Spacer()
                VStack(alignment: .trailing) {
                    Text("Republicans").font(.caption)
                    Text(Format.chance(1 - d)).font(.system(size: 40, weight: .bold).monospacedDigit()).foregroundStyle(Color.rep)
                }
            }
            GeometryReader { g in
                HStack(spacing: 2) {
                    Rectangle().fill(Color.dem).frame(width: g.size.width * d)
                    Rectangle().fill(Color.rep)
                }
            }
            .frame(height: 12)
            .clipShape(RoundedRectangle(cornerRadius: 3))
            Text("Projected seats: \(chamber.dSeats) D, \(chamber.rSeats) R. \(chamber.majority) for a majority.").font(.caption).foregroundStyle(.secondary)
        }
        .panel()
    }
}

private struct DistributionChart: View {
    let chamber: Chamber
    var body: some View {
        let points = chamber.distribution.filter { $0.p >= 0.001 }
        VStack(alignment: .leading, spacing: 8) {
            Text("Democratic seats across simulations").font(.serif(.headline))
            Chart(points, id: \.seats) { pt in
                BarMark(x: .value("Seats", pt.seats), y: .value("Chance", pt.p))
                    .foregroundStyle(pt.seats >= chamber.majority ? Color.dem : Color.rep)
            }
            .chartXScale(domain: (points.first?.seats ?? 0)...(points.last?.seats ?? 1))
            .chartYAxis(.hidden)
            .frame(height: 150)
            Text("Blue bars are outcomes where Democrats reach \(chamber.majority).").font(.caption2).foregroundStyle(.secondary)
        }
        .panel()
    }
}

private struct RatingsCard: View {
    let ratings: RatingCounts
    var body: some View {
        let rows: [(String, Int, Color)] = [
            ("Safe D", ratings.safeD, .safeD), ("Likely D", ratings.likelyD, .likelyD), ("Lean D", ratings.leanD, .leanD),
            ("Toss-up", ratings.tossup, .tossup),
            ("Lean R", ratings.leanR, .leanR), ("Likely R", ratings.likelyR, .likelyR), ("Safe R", ratings.safeR, .safeR),
        ]
        let total = max(1, rows.reduce(0) { $0 + $1.1 })
        VStack(alignment: .leading, spacing: 8) {
            Text("Seats up, by rating").font(.serif(.headline))
            GeometryReader { g in
                HStack(spacing: 1) {
                    ForEach(rows, id: \.0) { _, n, color in
                        if n > 0 { Rectangle().fill(color).frame(width: g.size.width * CGFloat(n) / CGFloat(total)) }
                    }
                }
            }
            .frame(height: 18)
            .clipShape(RoundedRectangle(cornerRadius: 3))
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), alignment: .leading)], spacing: 6) {
                ForEach(rows, id: \.0) { label, n, color in
                    HStack(spacing: 4) {
                        RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 10, height: 10)
                        Text("\(label) \(n)").font(.caption.monospacedDigit())
                    }
                }
            }
        }
        .panel()
    }
}

private struct ControlHistory: View {
    let points: [ChamberHistoryPoint]
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Democratic chance over time").font(.serif(.headline))
            Chart(points) { pt in
                LineMark(x: .value("Day", pt.date), y: .value("Chance", pt.dControl)).foregroundStyle(Color.dem)
                RuleMark(y: .value("Even", 0.5)).foregroundStyle(Color.rule).lineStyle(StrokeStyle(dash: [3, 3]))
            }
            .chartYScale(domain: 0...1)
            .chartYAxis { AxisMarks(values: [0, 0.5, 1]) { v in AxisGridLine(); AxisValueLabel { Text("\(Int((v.as(Double.self) ?? 0) * 100))%") } } }
            .frame(height: 150)
        }
        .panel()
    }
}
