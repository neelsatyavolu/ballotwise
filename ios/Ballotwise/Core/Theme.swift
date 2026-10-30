import SwiftUI

// Colors from DESIGN.md (paper, ink, flag blue and red) and the tracker's party palette (app/midterms/midterms.css).
extension Color {
    init(hex: UInt32) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }

    static func adaptive(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(Color(hex: dark)) : UIColor(Color(hex: light)) })
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
