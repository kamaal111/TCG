import SwiftUI
import TCGDesignSystem

struct SearchArtworkCollage: View {
    let urls: [URL]

    var body: some View {
        switch urls.count {
        case 4:
            VStack(spacing: 2) {
                tiles(urls.prefix(2), height: 30)
                tiles(urls.suffix(2), height: 30)
            }
        case 2:
            tiles(urls[...], height: 44)
        default:
            CardImageView(url: urls.first)
        }
    }

    private func tiles(_ urls: ArraySlice<URL>, height: CGFloat) -> some View {
        HStack(spacing: 2) {
            ForEach(urls, id: \.self) { url in
                CardImageView(url: url, size: .init(width: 28, height: height))
            }
        }
    }
}
