import SwiftUI

enum AppTab: Hashable { case live, races, map, forecast, more }

struct RootView: View {
    @Environment(PushManager.self) private var push
    @State private var tab: AppTab = .live
    @State private var alertRace: RaceLink?

    var body: some View {
        TabView(selection: $tab) {
            Tab("Live", systemImage: "dot.radiowaves.left.and.right", value: .live) {
                NavigationStack { LiveView(tab: $tab).withRaceDestinations() }
            }
            Tab("Races", systemImage: "list.bullet.rectangle", value: .races) {
                NavigationStack { RacesView().withRaceDestinations() }
            }
            Tab("Map", systemImage: "map", value: .map) {
                NavigationStack { NationMapView().withRaceDestinations() }
            }
            Tab("Forecast", systemImage: "chart.line.uptrend.xyaxis", value: .forecast) {
                NavigationStack { ForecastView().withRaceDestinations() }
            }
            Tab("More", systemImage: "ellipsis.circle", value: .more) {
                NavigationStack { MoreView().withRaceDestinations() }
            }
        }
        .onChange(of: push.openRaceId) { _, id in
            guard let id else { return }
            alertRace = RaceLink(id: id)
            push.openRaceId = nil
        }
        #if DEBUG
        // For screenshots in the simulator: `simctl launch <device> co.xanom.ballotwise -BWTab map -BWRace 81004`.
        .onAppear {
            let d = UserDefaults.standard
            if let t = d.string(forKey: "BWTab") { tab = ["races": .races, "map": .map, "forecast": .forecast, "more": .more][t] ?? .live }
            if d.integer(forKey: "BWRace") > 0 { alertRace = RaceLink(id: d.integer(forKey: "BWRace")) }
        }
        #endif
        .sheet(item: $alertRace) { link in
            NavigationStack {
                RaceDetailView(id: link.id)
                    .withRaceDestinations()
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { alertRace = nil } } }
            }
        }
    }
}

extension RaceLink: Identifiable {}

extension View {
    func withRaceDestinations() -> some View {
        navigationDestination(for: RaceLink.self) { RaceDetailView(id: $0.id) }
            .navigationDestination(for: Office.self) { OfficeListView(office: $0) }
            .navigationDestination(for: StateLink.self) { StateView(state: $0.code) }
    }
}

struct StateLink: Hashable { let code: String }
