import Foundation
import Observation

/// The chamber forecast from /api/midterms/forecast: control odds, projected seats and their history.
@Observable
final class ForecastStore {
    private(set) var forecast: ForecastResponse?
    private(set) var error: String?
    private var loadedAt: Date?

    func chamber(_ office: Office) -> Chamber? { forecast?.chambers[office.rawValue] }

    /// Projected seats for a seat bar, or nil without a forecast.
    func projected(_ office: Office) -> (d: Int, r: Int)? { chamber(office).map { ($0.dSeats, $0.rSeats) } }

    /// Loads at most every 5 minutes; the server refreshes it on the same cadence.
    func load(force: Bool = false) async {
        if !force, let loadedAt, Date.now.timeIntervalSince(loadedAt) < 300 { return }
        do {
            forecast = try await API.shared.get("/api/midterms/forecast", as: ForecastResponse.self)
            loadedAt = .now
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
