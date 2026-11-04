import SwiftUI

/// Connects a Decision Desk HQ Votes Pro account, as the website's account page does: Votes emails a code, and the code
/// finishes the connection. Once connected, results, calls and county counts come from DDHQ.
struct VotesConnectView: View {
    @Environment(AccountStore.self) private var account
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var code = ""
    @State private var codeSent = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if codeSent {
                        TextField("Code from the email", text: $code).keyboardType(.numberPad).textContentType(.oneTimeCode)
                    } else {
                        TextField("Votes account email", text: $email).textContentType(.emailAddress).keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                } footer: {
                    Text(codeSent
                         ? "Decision Desk HQ emailed a sign-in code to \(email)."
                         : "Use the email on your Decision Desk HQ Votes Pro account. Votes will email you a code. Your Votes password is never asked for.")
                }
                if let error { Text(error).foregroundStyle(Color.flagRed).font(.footnote) }
                Button {
                    Task { await submit() }
                } label: {
                    if busy { ProgressView().frame(maxWidth: .infinity) } else { Text(codeSent ? "Connect" : "Email me a code").frame(maxWidth: .infinity) }
                }
                .disabled(busy || (codeSent ? code.isEmpty : email.isEmpty))
                if codeSent {
                    Button("Use a different email") { codeSent = false; code = ""; error = nil }.font(.footnote)
                }
            }
            .navigationTitle("Connect Decision Desk HQ")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private func submit() async {
        busy = true
        defer { busy = false }
        do {
            if codeSent {
                try await account.confirmDdhqCode(code.trimmingCharacters(in: .whitespaces))
                dismiss()
            } else {
                try await account.sendDdhqCode(email: email.trimmingCharacters(in: .whitespaces))
                codeSent = true
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
