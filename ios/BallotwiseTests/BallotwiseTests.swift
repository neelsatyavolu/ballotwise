import CoreGraphics
import Foundation
import Testing
@testable import Ballotwise

@MainActor
struct FormatTests {
    func race(office: Office = .senate, state: String = "GA", district: Int? = nil, title: String = "Georgia US Senate", candidates: [Candidate] = [], total: Int = 0, reporting: Double = 0) -> Race {
        Race(id: 1, office: office, state: state, district: district, title: title, reporting: reporting, total: total, candidates: candidates)
    }

    @Test func labels() {
        #expect(Format.label(race()) == "Georgia Senate")
        #expect(Format.label(race(title: "Ohio US Senate Special")) == "Georgia Senate (special)")
        #expect(Format.label(race(office: .house, state: "PA", district: 7)) == "PA-7")
        #expect(Format.label(race(office: .house, state: "WY", district: 0)) == "WY at-large")
        #expect(Format.label(race(office: .measure, state: "AR", title: "Arkansas Issue 1 - Citizenship")) == "Issue 1")
    }

    @Test func parties() {
        #expect(Format.partyTag("Democratic") == "D")
        #expect(Format.partyTag("Republican") == "R")
        #expect(Format.partyTag("Nonpartisan") == "")
        #expect(Format.partyTag("Libertarian") == "Lib")
        #expect(Format.partyTag("Grn") == "Grn")
    }

    @Test func leadAndEarly() {
        let cs = [Candidate(name: "A", party: "Democratic", votes: 600, pct: 60), Candidate(name: "B", party: "Republican", votes: 400, pct: 40)]
        #expect(Format.lead(cs)?.margin == 20)
        #expect(Format.isEarly(race(candidates: cs, total: 1000, reporting: 10)))
        #expect(!Format.isEarly(race(candidates: cs, total: 1000, reporting: 60)))
        #expect(Format.marginLabel(-4.5) == "R+4.5")
        #expect(Format.marginLabel(0.01) == "Even")
        #expect(Format.chance(0.999) == ">99%")
        #expect(Format.chance(0.641) == "64%")
    }

    @Test func forecastNomineeLeadsBeforeVotes() {
        let cs = [Candidate(name: "Minor R", party: "Republican", votes: 0, pct: 0), Candidate(name: "Jane Doe", party: "Democratic", votes: 0, pct: 0), Candidate(name: "Big R", party: "Republican", votes: 0, pct: 0, incumbent: true)]
        var r = race(candidates: cs)
        r.signal = Signal(forecast: RaceForecastSignal(odds: Odds(d: 0.3, r: 0.7), left: "D", names: ForecastNames(left: "Jane Doe", right: "Big R")))
        #expect(Format.ballotOrder(r).map(\.name) == ["Big R", "Jane Doe", "Minor R"])
        // The forecast names "Big R" as the Republican nominee, so the line uses his last name.
        #expect(Format.forecastLeader(r) == "R 70%")
    }

    @Test func photoURLs() {
        let r = race(office: .house, state: "PA", district: 7)
        let table = ["house:PA:7|Jane": "c:J000001", "house:PA:7|Bob": "b:Bob.webp", "house:PA:7|Al": "w:Al Smith.jpg"]
        #expect(Format.photoURL(table, race: r, name: "Jane")?.absoluteString == "https://unitedstates.github.io/images/congress/225x275/J000001.jpg")
        #expect(Format.photoURL(table, race: r, name: "Bob")?.absoluteString == "https://ballotwise.xanom.co/midterms/photos/Bob.webp")
        #expect(Format.photoURL(table, race: r, name: "Al")?.absoluteString.contains("Al%20Smith.jpg") == true)
        #expect(Format.photoURL(table, race: r, name: "Nobody") == nil)
    }
}

@MainActor
struct PollTests {
    @Test func wavesMatchTheWebsite() {
        let first = Polls.waves.first!
        #expect(first.at == Date(timeIntervalSince1970: 1_793_746_800)) // 6 p.m. ET Nov 3 = 23:00Z
        #expect(first.states.map(\.code) == ["IN", "KY"])
        #expect(Polls.waves.last!.states.map(\.code) == ["AK"])
        #expect(Polls.final("TX") == Polls.electionDayStart.addingTimeInterval(21 * 3600))
        #expect(Polls.countdown(to: Date(timeIntervalSince1970: 90_061), from: Date(timeIntervalSince1970: 0)) == "1d 01:01:01")
    }
}

@MainActor
struct MapTests {
    @Test func parsesAbsolutePaths() {
        let path = SVGPath.parse("M0,0L10,0L10,-10Z M20,20L30,20L30,30Z")
        #expect(path.contains(CGPoint(x: 8, y: -2)))
        #expect(path.contains(CGPoint(x: 28, y: 22)))
        #expect(!path.contains(CGPoint(x: 15, y: 15)))
        #expect(SVGPath.viewBox("0 0 975 610") == CGRect(x: 0, y: 0, width: 975, height: 610))
    }
}

@MainActor
struct DecodingTests {
    @Test func decodesTheOverview() throws {
        let json = """
        {"fetchedAt":1,"stale":false,"races":[{"id":81004,"office":"senate","state":"MS","district":null,"title":"Mississippi US Senate","reporting":0,"total":0,
        "candidates":[{"name":"Scott Colom","party":"Democratic","votes":0,"pct":0,"winner":false,"incumbent":false}],"rating":"likely-r","call":null,"calledFor":null,
        "signal":{"market":{"odds":{"D":0.12,"R":0.88},"sources":["Kalshi"],"volume":1},"polls":null,"rating":"likely-r","forecast":{"odds":{"D":0.17,"R":0.83},"left":"D","names":{"left":"Scott Colom","right":"Cindy Hyde-Smith"},"margin":-8.8,"lean":-22.9}},"trend":null}],
        "balance":{"senate":{"D":34,"R":31,"other":0,"total":100,"majority":51,"uncalled":35},"house":{"D":0,"R":0,"other":0,"total":435,"majority":218,"uncalled":435},"governor":{"D":6,"R":8,"other":0,"total":50,"majority":26,"uncalled":36}},
        "callEvents":[{"id":3,"raceId":81004,"office":"senate","kind":"call","winner":"Scott Colom","party":"Democratic","previous":null,"at":5}],"coverage":{},"ratings":{"updatedAt":null}}
        """
        let o = try JSONDecoder().decode(Overview.self, from: Data(json.utf8))
        #expect(o.races.first?.signal?.forecast?.odds.r == 0.83)
        #expect(o.balance.senate.majority == 51)
        #expect(o.callEvents?.first?.winner == "Scott Colom")
    }

    @Test func decodesForecastHistoryRows() throws {
        let json = """
        {"updatedAt":1,"chambers":{"senate":{"dControl":0.59,"dSeats":51,"rSeats":49,"ratings":{"safeD":7,"likelyD":6,"leanD":1,"tossup":6,"leanR":2,"likelyR":5,"safeR":8,"other":0},"distribution":[{"seats":50,"p":0.2}],"notUp":{"D":34,"R":31,"other":0},"majority":51}},
        "history":{"senate":[["2026-10-29",0.559,51,49],["2026-10-30",0.59,51,49]],"backfilled":{"from":"2026-08-01"}}}
        """
        let f = try JSONDecoder().decode(ForecastResponse.self, from: Data(json.utf8))
        #expect(f.history["senate"]?.map(\.dControl) == [0.559, 0.59])
        #expect(f.history["backfilled"] == nil)
        #expect(f.chambers["senate"]?.ratings.tossup == 6)
    }

    @Test func decodesMarketSeries() throws {
        let json = #"{"kalshi":{"question":"Q","url":"https://k","lines":[{"name":"A","side":"R","now":0.89,"all":[[1793073600,0.88]],"live":[]}]}}"#
        let m = try JSONDecoder().decode(MarketsResponse.self, from: Data(json.utf8))
        #expect(m.kalshi?.lines.first?.all.first?.values == [0.88])
        #expect(m.polymarket == nil)
    }
}

@MainActor
struct WallTests {
    func race(id: Int, office: Office = .senate, state: String = "GA", district: Int? = nil, title: String = "US Senate", rating: String? = nil, candidates: [Candidate] = [], total: Int = 0, reporting: Double = 0) -> Race {
        var r = Race(id: id, office: office, state: state, district: district, title: title, reporting: reporting, total: total, candidates: candidates)
        r.rating = rating
        return r
    }

    func near(_ a: CGPoint, _ b: CGPoint) -> Bool { abs(a.x - b.x) < 0.001 && abs(a.y - b.y) < 0.001 }

    @Test func cameraCentersAndFitsTheFocus() {
        let focus = CGRect(x: 100, y: 50, width: 200, height: 100)
        let size = CGSize(width: 1000, height: 600)
        let t = WallLogic.camera(focus, in: size, inset: 0)
        #expect(near(CGPoint(x: 200, y: 100).applying(t), CGPoint(x: 500, y: 300)))
        // Width is the tighter fit: 200 map units span the full 1000 points.
        #expect(near(CGPoint(x: 100, y: 100).applying(t), CGPoint(x: 0, y: 300)))
        // A tap maps back to the same map point, zoomed and panned too.
        let zoomed = WallLogic.camera(focus, in: size, zoom: 3, pan: CGSize(width: 40, height: -20))
        let p = CGPoint(x: 150, y: 80)
        #expect(near(p.applying(zoomed).applying(zoomed.inverted()), p))
        #expect(near(CGPoint(x: 200, y: 100).applying(zoomed), CGPoint(x: 540, y: 280)))
    }

    @Test func swingComparesWithTwentyTwentyFour() {
        let cs = [Candidate(name: "A", party: "Democratic", votes: 550, pct: 55), Candidate(name: "B", party: "Republican", votes: 450, pct: 45)]
        #expect(WallLogic.swing(County(name: "X", reporting: 50, total: 1000, candidates: cs, baseline2024: -4)) == 14)
        #expect(WallLogic.swing(County(name: "X", reporting: 0, total: 0, candidates: cs, baseline2024: -4)) == nil)
        #expect(WallLogic.swing(County(name: "X", reporting: 50, total: 1000, candidates: cs)) == nil)
    }

    @Test func shapesFindTheirRaces() {
        let all = [
            race(id: 1, state: "OH", title: "Ohio US Senate Special"),
            race(id: 2, state: "OH"),
            race(id: 3, office: .house, state: "PA", district: 7),
            race(id: 4, office: .house, state: "WY", district: 0),
        ]
        #expect(MapRaces.race(all, office: .senate, shape: "OH")?.id == 2)
        #expect(MapRaces.races(all, office: .senate, state: "OH").map(\.id) == [2, 1])
        #expect(MapRaces.race(all, office: .house, shape: "PA-7")?.id == 3)
        #expect(MapRaces.race(all, office: .house, shape: "WY-0")?.id == 4)
        #expect(MapRaces.race(all, office: .house, shape: "PA") == nil)
        #expect(MapRaces.race(all, office: .governor, shape: "OH") == nil)
    }

    @Test func watchListPrefersCloseCounts() {
        func counted(_ id: Int, _ d: Int) -> Race {
            race(id: id, candidates: [Candidate(name: "A", party: "Democratic", votes: d, pct: Double(d) / 10), Candidate(name: "B", party: "Republican", votes: 1000 - d, pct: Double(1000 - d) / 10)], total: 1000, reporting: 80)
        }
        let rated = [race(id: 10, rating: "likely-d"), race(id: 11, rating: "tossup"), race(id: 12)]
        #expect(WallLogic.watchList(rated, office: .senate).map(\.id) == [11, 10])
        let counting = [counted(1, 700), counted(2, 510), counted(3, 600)] + rated
        #expect(WallLogic.watchList(counting, office: .senate).map(\.id) == [2, 3, 1])
        #expect(WallLogic.watchList(counting, office: .house).isEmpty)
    }

    @Test func tableStatusReadsLikeTheWebsite() {
        let d = Candidate(name: "A", party: "Democratic", votes: 520, pct: 52)
        let r = Candidate(name: "B", party: "Republican", votes: 480, pct: 48)
        #expect(WallLogic.status([d, r], state: "TX") == "Lead 4.0 pts")
        let before = Candidate(name: "A", party: "Democratic", votes: 0, pct: 0)
        let closes = Polls.final("TX")!
        #expect(WallLogic.status([before], state: "TX", now: closes.addingTimeInterval(-60)).hasPrefix("Polls close "))
        #expect(WallLogic.status([before], state: "TX", now: closes.addingTimeInterval(60)) == "No results yet")
    }

    @Test func signalLineAndPartyCodes() {
        var r = race(id: 1)
        #expect(Format.signalLine(r) == nil)
        r.signal = Signal(market: MarketSignal(odds: Odds(d: 0.71, r: 0.29)), polls: PollSignal(margin: 3.1, count: 73))
        #expect(Format.signalLine(r) == "Markets: Dem 71% · Polls: D+3.1 (73)")
        #expect(Format.partyCode("Democratic") == "DEM")
        #expect(Format.partyCode("Republican") == "GOP")
        #expect(Format.partyCode("Libertarian Party") == "LIB")
        #expect(Format.partyCode("Green") == "GRE")
    }

    @Test func boardTitlesReadLikeANetwork() {
        #expect(WallLogic.title(race(id: 1, office: .house, state: "CA", district: 18, title: "US House CA-18")) == "California 18th District")
        #expect(WallLogic.title(race(id: 2, office: .house, state: "AK", district: 0, title: "US House AK")) == "Alaska At-Large District")
        #expect(WallLogic.title(race(id: 3, state: "OH", title: "US Senate special")) == "Ohio Senate (special)")
        #expect(WallLogic.subtitle(race(id: 1, office: .house, state: "CA", district: 18)) == "2026 House")
        #expect(WallLogic.subtitle(race(id: 4, office: .governor, state: "GA", title: "Governor")) == "2026 Governor")
    }

    @Test func indexMatchesTheLookup() {
        let all = [
            race(id: 1, state: "OH", title: "Ohio US Senate Special"),
            race(id: 2, state: "OH"),
            race(id: 3, office: .house, state: "PA", district: 7),
        ]
        #expect(MapRaces.index(all, office: .senate).mapValues(\.id) == ["OH": 2])
        #expect(MapRaces.index(all, office: .house).mapValues(\.id) == ["PA-7": 3])
    }

    @Test func flipsFollowTheWebsite() {
        let dem = Candidate(name: "D", party: "Democratic", votes: 0, pct: 0)
        let rep = Candidate(name: "R", party: "Republican", votes: 0, pct: 0)
        // Texas's Senate seat is Republican: a Democratic favorite, leader or winner flips it; a toss-up doesn't.
        var tx = race(id: 1, state: "TX", rating: "lean-d", candidates: [dem, rep])
        #expect(Holders.holder(tx) == "R")
        #expect(Holders.flipTo(tx) == "D")
        tx.rating = "tossup"
        #expect(Holders.flipTo(tx) == nil)
        let counted = race(id: 2, state: "TX", candidates: [Candidate(name: "R", party: "Republican", votes: 600, pct: 60), Candidate(name: "D", party: "Democratic", votes: 400, pct: 40)], total: 1000, reporting: 80)
        #expect(Holders.flipTo(counted) == nil)
        let won = race(id: 3, state: "TX", candidates: [Candidate(name: "D", party: "Democratic", votes: 510, pct: 51, winner: true), rep], total: 1000, reporting: 99)
        #expect(Holders.flipTo(won) == "D")
        // The special elections and governors have their own holders.
        #expect(Holders.holder(race(id: 4, state: "OH", title: "US Senate special")) == "R")
        #expect(Holders.holder(race(id: 5, office: .governor, state: "KS", title: "Governor")) == "D")
        #expect(Holders.holder(race(id: 6, office: .house, state: "NE", district: 2)) == "R")
    }

    @Test func lensesFollowTheLevel() {
        #expect(WallLens.available(counties: false) == [.results, .forecast])
        #expect(WallLens.available(counties: true) == [.results, .past, .shift])
    }
}
