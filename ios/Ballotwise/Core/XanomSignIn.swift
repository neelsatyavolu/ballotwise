import AuthenticationServices
import UIKit

/// "Continue with Xanom": opens the website's /api/xanom/start in a web authentication sheet. The website runs the
/// whole sign-in with accounts.xanom.co and comes back to ballotwise://xanom with a one-time ticket, which
/// AccountStore trades for the usual `bw_session` cookie. The sheet shares Safari's cookies, so a voter already
/// signed in to Xanom in Safari (or another Xanom app) gets through in one tap.
@MainActor
final class XanomSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    enum Intent: String { case signin, link, convert }

    static let scheme = "ballotwise"

    /// Shown for the error codes the website's callback can send back.
    private static let messages: [String: String] = [
        "cancelled": "Sign-in with Xanom was cancelled.",
        "expired": "That sign-in took too long. Try again.",
        "state": "That sign-in didn't match. Try again.",
        "unavailable": "Sign-in with Xanom isn't available right now. Use your email and password.",
        "linked-elsewhere": "That Xanom account is already linked to a different Ballotwise account.",
        "already-linked": "This Ballotwise account is already linked to a different Xanom account.",
        "email-mismatch": "That Xanom account uses a different email. Use \u{201C}Link an existing Xanom account\u{201D} instead.",
        "signed-out": "Your session ended. Sign in and try again.",
    ]

    private var session: ASWebAuthenticationSession?

    /// The URL the sheet opens. `startTicket` names the signed-in voter for link and convert.
    static func startURL(intent: Intent, startTicket: String?) -> URL {
        var parts = URLComponents(url: API.base.appendingPathComponent("api/xanom/start"), resolvingAgainstBaseURL: false)!
        parts.queryItems = [URLQueryItem(name: "platform", value: "ios"), URLQueryItem(name: "intent", value: intent.rawValue)]
        if let startTicket { parts.queryItems?.append(URLQueryItem(name: "ticket", value: startTicket)) }
        return parts.url!
    }

    /// The ticket from ballotwise://xanom?ticket=…, or the error that came back instead.
    static func ticket(from url: URL) throws -> String {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let ticket = items.first(where: { $0.name == "ticket" })?.value, !ticket.isEmpty { return ticket }
        let code = items.first(where: { $0.name == "error" })?.value ?? "failed"
        throw APIError.server(messages[code] ?? "Sign-in with Xanom didn't finish. Try again.")
    }

    /// Runs the sheet and returns the one-time ticket. Throws CancellationError if the voter closes it.
    func run(intent: Intent, startTicket: String?) async throws -> String {
        let url = Self.startURL(intent: intent, startTicket: startTicket)
        let callback: URL = try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callback: .customScheme(Self.scheme)) { url, error in
                if let url {
                    continuation.resume(returning: url)
                } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    continuation.resume(throwing: CancellationError())
                } else {
                    continuation.resume(throwing: error ?? APIError.server("Sign-in with Xanom didn't finish. Try again."))
                }
            }
            // Share Safari's cookies so the Xanom session carries over between apps.
            session.prefersEphemeralWebBrowserSession = false
            session.presentationContextProvider = self
            self.session = session
            if !session.start() {
                continuation.resume(throwing: APIError.server("Couldn't open sign-in with Xanom. Try again."))
            }
        }
        session = nil
        return try Self.ticket(from: callback)
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
        return windows.first(where: \.isKeyWindow) ?? windows.first ?? ASPresentationAnchor()
    }
}
