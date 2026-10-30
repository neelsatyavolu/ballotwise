import SwiftUI

/// Any US race on civicAPI by name or place: mayors, school boards, local questions, as well as the tracked races.
struct SearchView: View {
    @State private var query = ""
    @State private var results: [FoundRace] = []
    @State private var error: String?
    @State private var searching = false

    var body: some View {
        List {
            if let error { Text(error).foregroundStyle(.secondary) }
            ForEach(results) { r in
                NavigationLink(value: RaceLink(id: r.id)) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(r.title).font(.body)
                        Text("\(r.type) · \(Format.stateName(r.state))").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            if results.isEmpty && !searching && error == nil {
                ContentUnavailableView("Search every race", systemImage: "magnifyingglass", description: Text("Try “Austin mayor”, “Ohio Supreme Court” or a school board."))
                    .listRowBackground(Color.clear)
            }
        }
        .overlay { if searching { ProgressView() } }
        .navigationTitle("Find any race")
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Office, city or county")
        .task(id: query) {
            let q = query.trimmingCharacters(in: .whitespaces)
            guard q.count >= 2 else { results = []; error = nil; return }
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            searching = true
            defer { searching = false }
            do {
                nonisolated struct Reply: Decodable, Sendable { let races: [FoundRace] }
                let encoded = q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? q
                results = try await API.shared.get("/api/midterms/search?q=\(encoded)", as: Reply.self).races
                error = results.isEmpty ? "No races match “\(q)”." : nil
            } catch {
                if !Task.isCancelled { self.error = error.localizedDescription }
            }
        }
    }
}

/// Every call, change and withdrawal, newest first, a page at a time.
struct CallsView: View {
    @Environment(LiveStore.self) private var live
    @State private var office: Office?
    @State private var events: [CallEvent] = []
    @State private var done = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                Picker("Office", selection: $office) {
                    Text("All").tag(Office?.none)
                    ForEach(Office.allCases) { Text($0.label).tag(Optional($0)) }
                }
                .pickerStyle(.segmented)
                if let error { ErrorBanner(message: error) }
                if events.isEmpty && done {
                    ContentUnavailableView("No calls yet", systemImage: "checkmark.seal", description: Text("Races are called after their polls close on Nov 3."))
                } else if !events.isEmpty {
                    CallsList(events: events)
                    if !done {
                        ProgressView().frame(maxWidth: .infinity).task { await loadMore() }
                    }
                }
            }
            .padding()
        }
        .background(Color.paper)
        .navigationTitle("Race calls")
        .refreshable { await reload() }
        .task(id: office) { await reload() }
    }

    private func reload() async {
        events = []
        done = false
        await loadMore()
    }

    private func loadMore() async {
        nonisolated struct Reply: Decodable, Sendable { let events: [CallEvent] }
        var path = "/api/midterms/calls?limit=50"
        if let office { path += "&office=\(office.rawValue)" }
        if let last = events.last { path += "&before=\(last.id)" }
        do {
            let page = try await API.shared.get(path, as: Reply.self).events
            events += page
            done = page.count < 50
            error = nil
        } catch {
            self.error = error.localizedDescription
            done = true
        }
    }
}
