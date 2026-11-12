import SwiftUI

/// Settings for a signed-in voter: the linked Xanom account, or convert and link (xanom-accounts SPEC §2 and §5).
struct XanomAccountSection: View {
    @Environment(AccountStore.self) private var account
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Section {
            if let xanom = account.xanom {
                LabeledContent("Signed in with Xanom", value: xanom.email)
                Link("Manage at accounts.xanom.co", destination: URL(string: "https://accounts.xanom.co/")!)
            } else {
                Button("Convert to Xanom account") { Task { await run(.convert) } }.disabled(busy)
                Button("Link an existing Xanom account") { Task { await run(.link) } }.disabled(busy)
                if let error { Text(error).font(.footnote).foregroundStyle(Color.flagRed) }
            }
        } header: {
            Text("Xanom account")
        } footer: {
            if account.xanom == nil {
                Text("Use one account for Ballotwise and the other Xanom apps. Your email and password keep working.")
            }
        }
    }

    private func run(_ intent: XanomSignIn.Intent) async {
        busy = true
        defer { busy = false }
        error = nil
        do {
            try await account.continueWithXanom(intent)
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }
}
