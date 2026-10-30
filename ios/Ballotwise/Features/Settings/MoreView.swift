import SwiftUI

struct MoreView: View {
    @Environment(AccountStore.self) private var account
    @State private var signingIn = false

    var body: some View {
        List {
            Section {
                NavigationLink { AlertsView() } label: { Label("Alerts", systemImage: "bell.badge") }
                NavigationLink { CallsView() } label: { Label("Every race call", systemImage: "checkmark.seal") }
                NavigationLink { SearchView() } label: { Label("Find any race", systemImage: "magnifyingglass") }
                NavigationLink { DashboardsView() } label: { Label("Dashboards", systemImage: "square.grid.2x2") }
            }
            Section("Account") {
                if let user = account.user {
                    LabeledContent("Signed in as", value: user.email)
                    LabeledContent("Grok", value: account.grokConnected ? "Connected" : "Not connected")
                    Button("Sign out", role: .destructive) { Task { await account.signOut() } }
                } else {
                    Button("Sign in or create an account") { signingIn = true }
                    Text("Your starred races and dashboards follow your account to ballotwise.xanom.co.").font(.caption).foregroundStyle(.secondary)
                }
            }
            Section("Voter guide") {
                Link(destination: API.base) { Label("Your ballot and candidate comparisons", systemImage: "checklist") }
                Text("The voter guide opens on the website for now: look up your ballot, compare every candidate's sourced positions and track what you've voted on.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("About") {
                Link("How the forecast works", destination: API.base.appendingPathComponent("midterms/methodology"))
                Link("Data sources and credits", destination: API.base.appendingPathComponent("midterms/credits"))
                Link("Privacy Policy", destination: API.base.appendingPathComponent("privacy"))
                Link("Terms of Service", destination: API.base.appendingPathComponent("terms"))
                Text("Results from civicAPI. Ratings from Kalshi and Polymarket prices, VoteHub polls and expert ratings.").font(.caption).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("More")
        .sheet(isPresented: $signingIn) { SignInView() }
    }
}

struct AlertsView: View {
    @Environment(PushManager.self) private var push

    var body: some View {
        @Bindable var push = push
        Form {
            Section {
                switch push.authorization {
                case .denied:
                    Text("Notifications are off for Ballotwise.")
                    Button("Open Settings") {
                        if let url = URL(string: UIApplication.openNotificationSettingsURLString) { UIApplication.shared.open(url) }
                    }
                case .notDetermined:
                    Button("Turn on alerts") { Task { await push.requestPermission() } }
                default:
                    Label(push.token == nil ? "Connecting to Apple…" : "Alerts are on", systemImage: push.token == nil ? "hourglass" : "checkmark.circle")
                }
                if let error = push.error { Text(error).font(.caption).foregroundStyle(Color.flagRed) }
            }
            Section {
                Toggle("Races I starred", isOn: $push.settings.starred)
                Toggle("Chamber control and flips", isOn: $push.settings.control)
                Toggle("Every race call", isOn: $push.settings.allCalls)
                Toggle("Polls closing", isOn: $push.settings.pollClose)
            } header: {
                Text("Tell me when")
            } footer: {
                Text("Chamber control covers the Senate and House being decided and Senate or governor seats changing party. Every race call includes all 470 House and Senate races and the governors, so it gets busy; several at once arrive as one summary.")
            }
            Section {
                Picker("My state", selection: $push.homeState) {
                    Text("None").tag(String?.none)
                    ForEach(Format.states, id: \.self) { Text(Format.stateName($0)).tag(Optional($0)) }
                }
            } footer: {
                Text("Poll-closing alerts lead with your state when its polls close.")
            }
        }
        .navigationTitle("Alerts")
        .task { await push.refreshAuthorization() }
    }
}

struct SignInView: View {
    @Environment(AccountStore.self) private var account
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var password = ""
    @State private var creating = false
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Picker("", selection: $creating) {
                    Text("Sign in").tag(false)
                    Text("Create account").tag(true)
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                Section {
                    TextField("Email", text: $email).textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Password", text: $password).textContentType(creating ? .newPassword : .password)
                } footer: {
                    if creating {
                        Text("At least 10 characters. Creating an account means you accept the [Terms of Service](https://ballotwise.xanom.co/terms) and [Privacy Policy](https://ballotwise.xanom.co/privacy).")
                    }
                }
                if let error { Text(error).foregroundStyle(Color.flagRed).font(.footnote) }
                Button {
                    Task { await submit() }
                } label: {
                    if busy { ProgressView() } else { Text(creating ? "Create account" : "Sign in").frame(maxWidth: .infinity) }
                }
                .disabled(busy || email.isEmpty || password.isEmpty)
                if !creating {
                    Link("Forgot your password?", destination: API.base.appendingPathComponent("forgot")).font(.footnote)
                }
            }
            .navigationTitle(creating ? "Create account" : "Sign in")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private func submit() async {
        busy = true
        defer { busy = false }
        do {
            try await account.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password, create: creating)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
