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
