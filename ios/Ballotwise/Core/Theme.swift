import SwiftUI

// Colors from DESIGN.md (paper, ink, flag blue and red) and the tracker's party palette (app/midterms/midterms.css).
extension Color {
    nonisolated init(hex: UInt32) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }

    /// A color for light and dark mode. UIKit may resolve it on any thread (Canvas drawing does), so the provider is
    /// nonisolated and Sendable: under the project's main-actor default it would otherwise trap off the main thread.
    nonisolated static func adaptive(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { @Sendable traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
        })
    }

    static let paper = adaptive(0xF6F7F9, 0x0D1526)
    static let sheet = adaptive(0xFFFFFF, 0x142039)
    static let ink = adaptive(0x18213A, 0xEDF0F5)
    static let muted = adaptive(0x586379, 0x9BA7BC)
    static let rule = adaptive(0xD5DBE5, 0x26334D)
    static let flagBlue = adaptive(0x0A3161, 0x8FB0E8)
    static let flagRed = adaptive(0xB31942, 0xF0647F)
    static let navy = adaptive(0x0A3161, 0x0A2552)

    static let dem = Color(hex: 0x0059C2)
    static let rep = Color(hex: 0xCD332E)
    static let oth = Color(hex: 0x8B5CF6)
    static let yes = Color(hex: 0x00BB7F)
    static let no = Color(hex: 0xF99C00)

    static let safeD = Color(hex: 0x1A4FD6)
    static let likelyD = Color(hex: 0x3D8BFF)
    static let leanD = Color(hex: 0x93C0FF)
    static let safeR = Color(hex: 0xE0261D)
    static let likelyR = Color(hex: 0xF2564C)
    static let leanR = Color(hex: 0xF79A93)
    static let tossup = Color(hex: 0xFFCD1F)
    static let unrated = adaptive(0xC9CED8, 0x3A4560)
}

enum Theme {
    static let corner: CGFloat = 6

    /// Party colors for partisan races, yes/no colors for measures, civicAPI's own color for local races.
    static func color(_ c: Candidate) -> Color {
        if Format.isYes(c.name) { return .yes }
        if Format.isNo(c.name) { return .no }
        switch Format.party(c.party) {
        case .d: return .dem
        case .r: return .rep
        case .other:
            if let hex = c.color, let v = UInt32(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) { return Color(hex: v) }
            return .oth
        }
    }

    static func sideColor(_ side: String) -> Color { side == "D" ? .dem : side == "R" ? .rep : .oth }

    static func ratingColor(_ rating: String?) -> Color {
        switch rating {
        case "tossup": .tossup
        case "lean-d": .leanD
        case "likely-d": .likelyD
        case "lean-r": .leanR
        case "likely-r": .likelyR
        case "lean-i": .oth.opacity(0.5)
        case "likely-i": .oth.opacity(0.75)
        default: .unrated
        }
    }

    /// Map fill for a race: its result once votes are in (deeper the wider the lead), else its rating or forecast.
    static func fill(_ r: Race) -> Color {
        if let w = r.winner { return color(w) }
        if let lead = Format.lead(r.candidates), lead.margin > 0 {
            let strength = Format.isEarly(r) ? 0.3 : lead.margin >= 20 ? 0.9 : lead.margin >= 10 ? 0.7 : lead.margin >= 5 ? 0.5 : 0.32
            return color(lead.leader).opacity(strength)
        }
        if r.rating != nil { return ratingColor(r.rating) }
        if let top = r.signal?.forecast?.odds.ranked.first {
            // A race the forecast doesn't rate competitive is safe for the favorite.
            return top.side == "D" ? .safeD : top.side == "R" ? .safeR : .oth
        }
        return .unrated
    }

    /// A county shaded by who leads it (deeper for wider leads), or by the 2024 presidential margin before votes.
    static func countyFill(_ county: County?) -> Color {
        guard let county else { return .unrated.opacity(0.4) }
        if county.total > 0, let lead = Format.lead(county.candidates) {
            let strength = county.reporting < 15 && !(county.reportingUnknown ?? false) ? 0.3 : lead.margin >= 20 ? 0.92 : lead.margin >= 10 ? 0.7 : lead.margin >= 5 ? 0.5 : 0.32
            return color(lead.leader).opacity(strength)
        }
        if let m = county.baseline2024 {
            let strength = abs(m) >= 20 ? 0.45 : abs(m) >= 10 ? 0.32 : 0.2
            return (m > 0 ? Color.dem : Color.rep).opacity(strength)
        }
        return .unrated.opacity(0.4)
    }
}

extension Font {
    static func serif(_ style: Font.TextStyle, weight: Font.Weight = .semibold) -> Font { .system(style, design: .serif, weight: weight) }
}

/// A raised sheet with a 1px rule, the design's panel (no shadows).
struct Panel: ViewModifier {
    var padding: CGFloat = 14
    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(Color.sheet, in: RoundedRectangle(cornerRadius: Theme.corner))
            .overlay(RoundedRectangle(cornerRadius: Theme.corner).stroke(Color.rule, lineWidth: 1))
    }
}

extension View {
    func panel(padding: CGFloat = 14) -> some View { modifier(Panel(padding: padding)) }
}

/// The red-white-blue stripe under the header.
struct FlagStripe: View {
    var body: some View {
        HStack(spacing: 0) {
            Color.flagRed
            Color.white
            Color.flagBlue
        }
        .frame(height: 3)
    }
}
