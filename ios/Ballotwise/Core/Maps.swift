import SwiftUI

// The website's pre-projected maps (public/midterms/maps, built by scripts/build-maps.mjs): SVG paths using only
// M, L and Z. US.json and districts/{ST}.json share the national Albers projection; {ST}.json is one state's counties.

/// CGPath is immutable once built, so sharing it across threads is safe.
nonisolated struct MapShapeData: @unchecked Sendable, Identifiable {
    let id: String
    let name: String
    let path: CGPath
}

nonisolated struct LoadedMap: @unchecked Sendable {
    let viewBox: CGRect
    let shapes: [MapShapeData]
    /// Borders or the state outline, drawn above the fills.
    let lines: CGPath?
}

nonisolated enum SVGPath {
    /// Parses absolute M/L/Z commands. Anything else is skipped rather than failing the whole map.
    static func parse(_ d: String) -> CGPath {
        let path = CGMutablePath()
        var command: Character = "M"
        var numbers: [CGFloat] = []
        var token = ""
        func flushNumber() {
            if let v = Double(token) { numbers.append(CGFloat(v)) }
            token = ""
        }
        func apply() {
            var i = 0
            while i + 1 < numbers.count {
                let p = CGPoint(x: numbers[i], y: numbers[i + 1])
                if command == "M", i == 0 { path.move(to: p) } else { path.addLine(to: p) }
                i += 2
            }
            numbers.removeAll(keepingCapacity: true)
        }
        for ch in d {
            switch ch {
            case "M", "L", "Z", "m", "l", "z":
                flushNumber()
                apply()
                if ch == "Z" || ch == "z" { path.closeSubpath() }
                command = Character(ch.uppercased())
            case ",", " ":
                flushNumber()
            case "-":
                flushNumber()
                token = "-"
            default:
                token.append(ch)
            }
        }
        flushNumber()
        apply()
        return path
    }

    static func viewBox(_ s: String) -> CGRect {
        let v = s.split(separator: " ").compactMap { Double($0) }
        return v.count == 4 ? CGRect(x: v[0], y: v[1], width: v[2], height: v[3]) : .zero
    }
}

/// Downloads and parses maps once per launch; the URL cache keeps the files across launches.
actor MapLoader {
    static let shared = MapLoader()
    private var cache: [String: LoadedMap] = [:]
    private var inFlight: [String: Task<LoadedMap, Error>] = [:]

    private struct NationJSON: Decodable { let viewBox: String; let borders: String; let states: [Item] }
    private struct StateJSON: Decodable { let viewBox: String; let outline: String; let counties: [Item] }
    private struct DistrictsJSON: Decodable { let districts: [District] }
    private struct Item: Decodable { var state: String?; var fips: String?; let name: String; let d: String }
    private struct District: Decodable { let district: Int; let d: String }

    static let nationBox = CGRect(x: 0, y: 0, width: 975, height: 610)

    func nation() async throws -> LoadedMap {
        try await load("US") { data in
            let j = try JSONDecoder().decode(NationJSON.self, from: data)
            return LoadedMap(viewBox: SVGPath.viewBox(j.viewBox), shapes: j.states.map { MapShapeData(id: $0.state ?? $0.name, name: $0.name, path: SVGPath.parse($0.d)) }, lines: SVGPath.parse(j.borders))
        }
    }

    func counties(_ state: String) async throws -> LoadedMap {
        try await load(state) { data in
            let j = try JSONDecoder().decode(StateJSON.self, from: data)
            return LoadedMap(viewBox: SVGPath.viewBox(j.viewBox), shapes: j.counties.map { MapShapeData(id: $0.fips ?? $0.name, name: $0.name, path: SVGPath.parse($0.d)) }, lines: SVGPath.parse(j.outline))
        }
    }

    /// One state's districts, ids like "PA-7" (at-large is "WY-0").
    func districts(_ state: String) async throws -> LoadedMap {
        try await load("districts/\(state)") { data in
            let j = try JSONDecoder().decode(DistrictsJSON.self, from: data)
            return LoadedMap(viewBox: Self.nationBox, shapes: j.districts.map { MapShapeData(id: "\(state)-\($0.district)", name: "\(state)-\($0.district == 0 ? "AL" : String($0.district))", path: SVGPath.parse($0.d)) }, lines: nil)
        }
    }

    private func load(_ name: String, parse: @Sendable @escaping (Data) throws -> LoadedMap) async throws -> LoadedMap {
        if let hit = cache[name] { return hit }
        if let running = inFlight[name] { return try await running.value }
        let task = Task.detached {
            let (data, _) = try await URLSession.shared.data(from: API.base.appendingPathComponent("midterms/maps/\(name).json"))
            return try parse(data)
        }
        inFlight[name] = task
        defer { inFlight[name] = nil }
        let map = try await task.value
        cache[name] = map
        return map
    }
}

/// Draws a map's shapes with fills, scaled to fit, with pinch-to-zoom, drag and tap-to-select.
struct MapCanvas: View {
    let viewBox: CGRect
    let shapes: [MapShapeData]
    var lines: CGPath?
    let fill: (MapShapeData) -> Color
    var selected: String?
    var onTap: ((MapShapeData) -> Void)?

    @State private var scale: CGFloat = 1
    @State private var committedScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var committedOffset: CGSize = .zero

    var body: some View {
        GeometryReader { geo in
            let fit = min(geo.size.width / max(viewBox.width, 1), geo.size.height / max(viewBox.height, 1))
            let base = CGAffineTransform(translationX: (geo.size.width - viewBox.width * fit) / 2, y: (geo.size.height - viewBox.height * fit) / 2)
                .scaledBy(x: fit, y: fit)
                .translatedBy(x: -viewBox.minX, y: -viewBox.minY)
            let zoom = CGAffineTransform(translationX: geo.size.width / 2 + offset.width, y: geo.size.height / 2 + offset.height)
                .scaledBy(x: scale, y: scale)
                .translatedBy(x: -geo.size.width / 2, y: -geo.size.height / 2)
            let transform = base.concatenating(zoom)

            Canvas { ctx, _ in
                for shape in shapes {
                    let p = Path(shape.path).applying(transform)
                    ctx.fill(p, with: .color(fill(shape)))
                    ctx.stroke(p, with: .color(Color.sheet), lineWidth: 0.6)
                }
                if let lines {
                    ctx.stroke(Path(lines).applying(transform), with: .color(Color.sheet), lineWidth: 1.2)
                }
                if let selected, let shape = shapes.first(where: { $0.id == selected }) {
                    ctx.stroke(Path(shape.path).applying(transform), with: .color(Color.ink), lineWidth: 2)
                }
            }
            .contentShape(Rectangle())
            .gesture(
                SpatialTapGesture().onEnded { tap in
                    guard let onTap else { return }
                    let point = tap.location.applying(transform.inverted())
                    if let hit = shapes.last(where: { $0.path.contains(point) }) { onTap(hit) }
                }
            )
            .simultaneousGesture(
                MagnifyGesture()
                    .onChanged { scale = min(12, max(1, committedScale * $0.magnification)) }
                    .onEnded { _ in
                        committedScale = scale
                        if scale == 1 { reset() }
                    }
            )
            .simultaneousGesture(
                DragGesture(minimumDistance: 10)
                    .onChanged { v in
                        guard scale > 1 else { return }
                        offset = CGSize(width: committedOffset.width + v.translation.width, height: committedOffset.height + v.translation.height)
                    }
                    .onEnded { _ in committedOffset = offset }
            )
            .onTapGesture(count: 2) { withAnimation(.snappy) { reset() } }
        }
        .aspectRatio(viewBox.width / max(viewBox.height, 1), contentMode: .fit)
        .accessibilityElement()
        .accessibilityLabel("Map. Pinch to zoom, tap a shape for details.")
    }

    private func reset() {
        scale = 1
        committedScale = 1
        offset = .zero
        committedOffset = .zero
    }
}
