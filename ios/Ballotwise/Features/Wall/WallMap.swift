import SwiftUI

/// Shapes drawn so `focus` (in map units) fills the frame. It's animatable, so changing the focus inside
/// `withAnimation` flies the camera from the country into a state and back.
struct MapLayer: View, Animatable {
    var focus: CGRect
    let shapes: [MapShapeData]
    var lines: CGPath?
    /// Each shape's color by id, worked out once per change; looking races up per shape every frame made the
    /// House map lag.
    let fills: [String: Color]
    /// Shapes striped as seats changing party.
    var flips: Set<String> = []
    /// With a state open, shapes outside it go grey so it stands out.
    var focusState: String?
    var selected: String?
    var zoom: CGFloat = 1
    var pan: CGSize = .zero

    typealias Pair = AnimatablePair<CGFloat, CGFloat>
    /// The focus, then the zoom and pan, so the camera eases back after a pinch as well as between states.
    var animatableData: AnimatablePair<AnimatablePair<Pair, Pair>, AnimatablePair<CGFloat, Pair>> {
        get {
            AnimatablePair(AnimatablePair(Pair(focus.minX, focus.minY), Pair(focus.width, focus.height)),
                           AnimatablePair(zoom, Pair(pan.width, pan.height)))
        }
        set {
            let (f, z) = (newValue.first, newValue.second)
            focus = CGRect(x: f.first.first, y: f.first.second, width: f.second.first, height: f.second.second)
            zoom = z.first
            pan = CGSize(width: z.second.first, height: z.second.second)
        }
    }

    var body: some View {
        Canvas { ctx, size in
            let camera = WallLogic.camera(focus, in: size, zoom: zoom, pan: pan)
            // Line widths are in screen points whatever the zoom.
            let unit = 1 / max(camera.a, 0.0001)
            // Shapes wholly off screen are skipped: zoomed into a state, that's most of the country's districts.
            let visible = CGRect(origin: .zero, size: size).applying(camera.inverted())
            let stripes = flips.isEmpty ? nil : Self.stripes(over: visible, spacing: 10 * unit)
            ctx.concatenate(camera)
            for shape in shapes where shape.bounds.intersects(visible) {
                let path = Path(shape.path)
                let dim = focusState.map { !shape.id.hasPrefix($0) } ?? false
                ctx.fill(path, with: .color(dim ? Color.unrated.opacity(0.25) : fills[shape.id] ?? .clear))
                if !dim, let stripes, flips.contains(shape.id) {
                    ctx.drawLayer { layer in
                        layer.clip(to: path)
                        layer.stroke(stripes, with: .color(Color.paper.opacity(0.45)), lineWidth: 4 * unit)
                    }
                }
                ctx.stroke(path, with: .color(.paper), lineWidth: 0.7 * unit)
            }
            if let lines { ctx.stroke(Path(lines), with: .color(.paper), lineWidth: 1.6 * unit) }
            if let selected, let shape = shapes.first(where: { $0.id == selected }) {
                ctx.stroke(Path(shape.path), with: .color(.ink), lineWidth: 3 * unit)
            }
        }
    }

    /// Diagonal lines across `rect`, on a fixed grid so they don't crawl as the map pans.
    static func stripes(over rect: CGRect, spacing: CGFloat) -> Path {
        var p = Path()
        guard spacing > 0 else { return p }
        var x = ((rect.minX - rect.height) / spacing).rounded(.down) * spacing
        while x < rect.maxX {
            p.move(to: CGPoint(x: x, y: rect.maxY))
            p.addLine(to: CGPoint(x: x + rect.height, y: rect.minY))
            x += spacing
        }
        return p
    }
}

enum WallTap { case shape(String), county(String), background }

/// The wall's map: the whole country, or one state. Senate and governor states open into counties; House states
/// stay in the national projection and show their districts with the neighbors dimmed.
struct WallMap: View {
    let nation: LoadedMap
    let districts: [MapShapeData]
    /// The focused state's counties, once loaded.
    let counties: LoadedMap?
    let office: Office
    let state: String?
    let selected: String?
    let shapeFills: [String: Color]
    let countyFills: [String: Color]
    let flips: Set<String>
    let onTap: (WallTap) -> Void
    /// A pinch out past the state's own size goes back to the whole country.
    let onPinchOut: () -> Void

    @State private var zoom: CGFloat = 1
    @State private var committedZoom: CGFloat = 1
    @State private var pan: CGSize = .zero
    @State private var committedPan: CGSize = .zero

    private static let pinchOutFloor: CGFloat = 0.6
    private static let pinchOutTrigger: CGFloat = 0.85

    private var shapes: [MapShapeData] { office == .house && !districts.isEmpty ? districts : nation.shapes }
    private var showCounties: Bool { office != .house && state != nil && counties != nil }

    private var focus: CGRect {
        guard let state, let box = nation.shapes.first(where: { $0.id == state })?.path.boundingBox else { return nation.viewBox }
        return box
    }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                MapLayer(focus: focus, shapes: shapes, lines: office == .house ? nation.lines : nil, fills: shapeFills, flips: flips,
                         focusState: state, selected: office == .house ? selected : nil, zoom: zoom, pan: pan)
                    .opacity(showCounties ? 0 : 1)
                // The House stays on districts, so the counties aren't drawn at all there.
                // Hidden counties aren't drawn at all: redrawing a state's counties under the map on every frame of a
                // pan or zoom is wasted work.
                if let counties, office != .house, showCounties {
                    MapLayer(focus: counties.viewBox, shapes: counties.shapes, lines: counties.lines, fills: countyFills,
                             selected: selected, zoom: zoom, pan: pan)
                        .transition(.opacity)
                        .allowsHitTesting(false)
                }
            }
            // Counties appear once the camera has nearly reached the state; on the way out they go first.
            .animation(showCounties ? .easeInOut(duration: 0.35).delay(0.45) : .easeOut(duration: 0.2), value: showCounties)
            .contentShape(Rectangle())
            .gesture(SpatialTapGesture().onEnded { tap(at: $0.location, in: geo.size) })
            .simultaneousGesture(
                MagnifyGesture()
                    // Inside a state the map can shrink a little past its fit, to show a pinch out will leave.
                    .onChanged { zoom = min(10, max(state == nil ? 1 : Self.pinchOutFloor, committedZoom * $0.magnification)) }
                    .onEnded { _ in
                        if state != nil, zoom < Self.pinchOutTrigger {
                            onPinchOut()
                        } else if zoom <= 1 {
                            withAnimation(.smooth(duration: 0.3)) { resetCamera() }
                        } else {
                            committedZoom = zoom
                        }
                    }
            )
            .simultaneousGesture(
                DragGesture(minimumDistance: 10)
                    .onChanged { v in
                        guard zoom > 1 else { return }
                        pan = CGSize(width: committedPan.width + v.translation.width, height: committedPan.height + v.translation.height)
                    }
                    .onEnded { _ in committedPan = pan }
            )
        }
        .onChange(of: state) { withAnimation(.smooth(duration: 0.6)) { resetCamera() } }
        .onChange(of: office) { resetCamera() }
        .accessibilityElement()
        .accessibilityIdentifier("wallMap")
        .accessibilityLabel(state.map { "Map of \(Format.stateName($0))" } ?? "Map of the United States")
        .accessibilityHint("Tap a \(office == .house ? "district" : state == nil ? "state" : "county") for its results. Pinch to zoom\(state == nil ? "" : ", or pinch out to go back to the country").")
    }

    private func tap(at location: CGPoint, in size: CGSize) {
        if showCounties, let counties {
            let p = location.applying(WallLogic.camera(counties.viewBox, in: size, zoom: zoom, pan: pan).inverted())
            onTap(counties.shapes.last { $0.path.contains(p) }.map { .county($0.id) } ?? .background)
        } else {
            let p = location.applying(WallLogic.camera(focus, in: size, zoom: zoom, pan: pan).inverted())
            onTap(shapes.last { $0.path.contains(p) }.map { .shape($0.id) } ?? .background)
        }
    }

    private func resetCamera() {
        zoom = 1
        committedZoom = 1
        pan = .zero
        committedPan = .zero
    }
}
