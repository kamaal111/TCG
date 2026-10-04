import SwiftUI

extension View {
    public func cardImage(url: Binding<URL?>) -> some View {
        modifier(CardImagePresentation(url: url))
    }
}

private struct CardImagePresentation: ViewModifier {
    @Binding private var url: URL?

    init(url: Binding<URL?>) {
        _url = url
    }

    func body(content: Content) -> some View {
        let image = Binding(
            get: { url.map(ImageRoute.init(url:)) },
            set: { url = $0?.url }
        )
        #if os(macOS)
            content.sheet(item: image) { image in CardImageExplorer(url: image.url) }
        #else
            content.fullScreenCover(item: image) { image in CardImageExplorer(url: image.url) }
        #endif
    }

    private struct ImageRoute: Identifiable {
        let url: URL
        var id: URL { url }
    }
}
