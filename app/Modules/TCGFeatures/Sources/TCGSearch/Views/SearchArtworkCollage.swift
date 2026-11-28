import SwiftUI
import TCGDesignSystem

struct SearchArtworkCollage: View {
    let urls: [URL]

    var body: some View {
        Collage(urls: urls).id(urls)
    }

    private struct Collage: View {
        @State private var leadSettled = false

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
                CardImageView(url: urls.first, priority: .searchLead)
            }
        }

        private func tiles(_ urls: ArraySlice<URL>, height: CGFloat) -> some View {
            HStack(spacing: 2) {
                ForEach(urls.indices, id: \.self) { index in
                    let isLead = index == 0
                    CardImageView(
                        url: urls[index],
                        size: .init(width: 28, height: height),
                        priority: isLead ? .searchLead : .searchSupplemental,
                        loads: isLead || leadSettled,
                        onSettled: isLead ? { leadSettled = true } : nil
                    )
                }
            }
        }
    }
}
