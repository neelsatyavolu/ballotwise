import SwiftUI

nonisolated private struct DashboardList: Decodable, Sendable { let dashboards: [Dashboard] }

/// The voter's saved dashboards, the same ones as on the website, and a chat with Grok to build or change them.
struct DashboardsView: View {
    @Environment(AccountStore.self) private var account
    @State private var dashboards: [Dashboard] = []
    @State private var error: String?
    @State private var loaded = false
    @State private var signingIn = false
    @State private var chatting = false

    var body: some View {
        List {
            if account.user == nil {
                ContentUnavailableView {
                    Label("Sign in for dashboards", systemImage: "square.grid.2x2")
                } description: {
                    Text("Dashboards group the races you care about. Build them on the website or by chatting with Grok here.")
                } actions: {
                    Button("Sign in") { signingIn = true }.buttonStyle(.borderedProminent)
                }
                .listRowBackground(Color.clear)
            } else {
                if let error { Text(error).foregroundStyle(Color.flagRed).font(.footnote) }
                if loaded && dashboards.isEmpty {
                    Text("No dashboards yet. Ask Grok to make one, like “the closest Senate races” or “every race in Pennsylvania”.").foregroundStyle(.secondary)
                }
                ForEach(dashboards) { d in
                    NavigationLink { DashboardDetail(dashboard: d) } label: {
                        VStack(alignment: .leading) {
                            Text(d.layout.title).font(.serif(.body))
                            Text(d.layout.kind == "grid" ? "\(d.layout.panels?.count ?? 0) panels" : "\(d.layout.sections?.count ?? 0) sections").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .onDelete { idx in Task { await delete(idx) } }
            }
        }
        .navigationTitle("Dashboards")
        .toolbar {
            if account.user != nil {
                Button { chatting = true } label: { Label("Ask Grok", systemImage: "bubble.left.and.text.bubble.right") }
            }
        }
        .sheet(isPresented: $signingIn) { SignInView() }
        .sheet(isPresented: $chatting, onDismiss: { Task { await load() } }) { DashboardChat(openId: nil) }
        .refreshable { await load() }
        .task(id: account.user?.id) { await load() }
    }

    private func load() async {
        guard account.user != nil else { return }
        do {
            dashboards = try await API.shared.get("/api/midterms/dashboards", as: DashboardList.self).dashboards
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }

    private func delete(_ idx: IndexSet) async {
        for i in idx {
            if let reply = try? await API.shared.send("DELETE", "/api/midterms/dashboards/\(dashboards[i].id)", body: Empty(), as: DashboardList.self) {
                dashboards = reply.dashboards
            }
        }
    }
}

/// A dashboard on a phone: Grok's sections as lists of race cards, or a Decision View grid as one column of its panels.
struct DashboardDetail: View {
    let dashboard: Dashboard
    @Environment(LiveStore.self) private var live
    @Environment(ForecastStore.self) private var forecast
    @State private var chatting = false

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if let sections = dashboard.layout.sections {
                    ForEach(sections, id: \.title) { section in
                        SectionTitle(section.title)
                        if let note = section.note, !note.isEmpty { Text(note).font(.caption).foregroundStyle(.secondary) }
                        ForEach(section.raceIds.compactMap { live.byId[$0] }) { race in
                            NavigationLink(value: RaceLink(id: race.id)) { RaceCard(race: race) }.buttonStyle(.plain)
                        }
                    }
                }
                if let panels = dashboard.layout.panels {
                    // Reading order: top to bottom, then left to right.
                    ForEach(panels.sorted { ($0.y, $0.x) < ($1.y, $1.x) }) { panel in
                        PanelView(panel: panel)
                    }
                }
            }
            .padding()
        }
        .background(Color.paper)
        .navigationTitle(dashboard.layout.title)
        .toolbar {
            if dashboard.layout.kind != "grid" {
                Button { chatting = true } label: { Label("Ask Grok", systemImage: "bubble.left.and.text.bubble.right") }
            }
        }
        .sheet(isPresented: $chatting) { DashboardChat(openId: dashboard.id) }
    }
}

private struct PanelView: View {
    let panel: DashboardPanel
    @Environment(LiveStore.self) private var live
    @Environment(ForecastStore.self) private var forecast

    var body: some View {
        switch panel.type {
        case "header":
            SectionTitle(panel.text ?? "")
        case "calls":
            if let events = live.overview?.callEvents, !events.isEmpty { CallsList(events: Array(events.prefix(10))) }
            else { Text("No race calls yet.").font(.caption).foregroundStyle(.secondary).panel() }
        case "pollClosings":
            ClockCard()
        case "chamberControl", "balanceTopline", "balanceMap", "winChart", "seatsChart":
            if let office = panel.office, let tally = live.overview?.balance.tally(office) {
                NavigationLink(value: office) {
                    SeatBar(title: office == .governor ? "Governors" : office.label, tally: tally, projected: forecast.projected(office)).panel()
                }
                .buttonStyle(.plain)
            }
        default:
            if let id = panel.raceId, let race = live.byId[id] {
                NavigationLink(value: RaceLink(id: id)) { RaceCard(race: race, showCandidates: 3) }.buttonStyle(.plain)
            }
        }
    }
}

/// A chat with Grok that answers questions about results and creates or edits dashboards.
struct DashboardChat: View {
    let openId: String?
    @Environment(AccountStore.self) private var account
    @Environment(\.dismiss) private var dismiss
    @State private var messages: [ChatMessage] = []
    @State private var draft = ""
    @State private var sending = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 10) {
                            if !account.grokConnected {
                                Text("Grok answers with your own Grok account. Connect it on ballotwise.xanom.co (Account), then come back.")
                                    .font(.footnote).foregroundStyle(.secondary).panel()
                            }
                            if messages.isEmpty {
                                Text("Ask for a dashboard, like “the closest Senate races” or “every California race”, or ask about the results.")
                                    .font(.subheadline).foregroundStyle(.secondary)
                            }
                            ForEach(messages) { m in
                                Text(m.content)
                                    .padding(10)
                                    .background(m.role == "user" ? Color.flagBlue.opacity(0.12) : Color.sheet, in: RoundedRectangle(cornerRadius: 10))
                                    .frame(maxWidth: .infinity, alignment: m.role == "user" ? .trailing : .leading)
                                    .id(m.id)
                            }
                            if sending { ProgressView().padding(.leading, 10) }
                            if let error { Text(error).font(.footnote).foregroundStyle(Color.flagRed) }
                        }
                        .padding()
                    }
                    .onChange(of: messages.count) { if let last = messages.last { withAnimation { proxy.scrollTo(last.id) } } }
                }
                Divider()
                HStack {
                    TextField("Message Grok", text: $draft, axis: .vertical).lineLimit(1...4).textFieldStyle(.roundedBorder)
                    Button { Task { await send() } } label: { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                        .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty || sending)
                }
                .padding()
            }
            .background(Color.paper)
            .navigationTitle("Ask Grok")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        messages.append(ChatMessage(role: "user", content: text))
        draft = ""
        sending = true
        defer { sending = false }
        nonisolated struct Body: Encodable, Sendable { let openId: String?; let messages: [ChatMessage] }
        nonisolated struct Reply: Decodable, Sendable { let reply: String; let changed: Bool }
        do {
            let reply = try await API.shared.send("POST", "/api/midterms/dashboards/chat", body: Body(openId: openId, messages: Array(messages.suffix(16))), as: Reply.self)
            messages.append(ChatMessage(role: "assistant", content: reply.reply + (reply.changed ? "\n\n(Dashboard saved.)" : "")))
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
