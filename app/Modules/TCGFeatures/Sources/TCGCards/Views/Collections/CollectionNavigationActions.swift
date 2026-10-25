import TCGClient

struct CollectionNavigationActions {
    let create: () -> Void
    let rename: (CardBinderCollection) -> Void
    let delete: () -> Void
    let editLayout: () -> Void
}
