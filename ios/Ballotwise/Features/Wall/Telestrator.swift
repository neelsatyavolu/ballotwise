import PencilKit
import SwiftUI

/// A clear PencilKit sheet over the map for marking it up with a finger or Apple Pencil. It only takes touches
/// while `active`; bumping `clearToken` wipes it.
struct Telestrator: UIViewRepresentable {
    var active: Bool
    var color: Color
    var clearToken: Int

    func makeUIView(context: Context) -> PKCanvasView {
        let canvas = PKCanvasView()
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        canvas.drawingPolicy = .anyInput
        // Keeps the ink the color picked; in a dark interface PencilKit would otherwise adjust it.
        canvas.overrideUserInterfaceStyle = .light
        canvas.minimumZoomScale = 1
        canvas.maximumZoomScale = 1
        return canvas
    }

    func updateUIView(_ canvas: PKCanvasView, context: Context) {
        canvas.tool = PKInkingTool(.pen, color: UIColor(color), width: 7)
        canvas.isUserInteractionEnabled = active
        if context.coordinator.clearToken != clearToken {
            canvas.drawing = PKDrawing()
            context.coordinator.clearToken = clearToken
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(clearToken: clearToken) }

    final class Coordinator {
        var clearToken: Int
        init(clearToken: Int) { self.clearToken = clearToken }
    }
}
