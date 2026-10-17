import SwiftUI

/// App shell. The Instagram WebView lives here once and is never recreated by navigation,
/// so the login context survives every tab change.
struct RootView: View {
    @Bindable var model: AppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var webVisible: Bool { model.screen == .instagram }

    var body: some View {
        ZStack {
            if !model.isPreview {
                InstagramWebView(model: model)
                    .opacity(webVisible ? 1 : 0)
                    .allowsHitTesting(webVisible)
                    .accessibilityHidden(!webVisible)
                    .safeAreaInset(edge: .top, spacing: 0) { if webVisible { webBar } }
            }
            if webVisible {
                if case .failed(let message) = model.phase {
                    EmptyState(icon: "wifi.exclamationmark", title: "Ligação interrompida", message: message, actionTitle: "Voltar a tentar", action: model.reload)
                        .frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.canvas)
                }
                if model.phase == .loadingInstagram || model.isBusy {
                    VStack {
                        HStack(spacing: 10) { ProgressView(); Text("A carregar").font(.footnote.weight(.medium)) }
                            .padding(.horizontal, 16).padding(.vertical, 10)
                            .background(.regularMaterial, in: .capsule)
                        Spacer()
                    }
                    .padding(.top, 64).allowsHitTesting(false)
                }
            } else {
                screen
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Theme.canvas.ignoresSafeArea())
                    .safeAreaInset(edge: .bottom, spacing: 0) { TabBar(model: model) }
            }
        }
        .tint(Theme.signalInk)
        .sensoryFeedback(.selection, trigger: model.screen)
        .sensoryFeedback(.success, trigger: model.snapshot?.lastScanAt)
        .overlay(alignment: .top) {
            if let notice = model.notice {
                NoticeToast(text: notice) { model.notice = nil }
                    .padding(.top, 6)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .task(id: notice) {
                        AccessibilityNotification.Announcement(notice).post()
                        try? await Task.sleep(for: .seconds(min(12, 4 + Double(notice.count) / 25)))
                        if model.notice == notice { model.notice = nil }
                    }
            }
        }
        .animation(reduceMotion ? nil : .spring(response: 0.4, dampingFraction: 0.85), value: model.notice)
    }

    @ViewBuilder private var screen: some View {
        switch model.screen {
        case .home: HomeScreen(model: model)
        case .people: PeopleScreen(model: model)
        case .watchlist: WatchlistScreen(model: model)
        case .activity: ActivityScreen(model: model)
        case .settings, .instagram: SettingsScreen(model: model)
        }
    }

    /// Leaving the Instagram page is blocked only while there is no account at all to return to.
    private var canLeaveWeb: Bool { !(model.requiresAuthentication && !model.sessionAvailable && model.accountId.isEmpty) }

    private var webBar: some View {
        HStack(spacing: 6) {
            Button { model.select(.home) } label: {
                HStack(spacing: 8) {
                    Image(systemName: "chevron.left").font(.subheadline.weight(.semibold))
                    BrandMark(size: 22)
                    Text("FollowCheck").font(.subheadline.weight(.semibold))
                }
                .frame(minHeight: 44)
            }
            .disabled(!canLeaveWeb)
            Spacer()
            if model.canGoBack {
                Button(action: model.goBack) { Image(systemName: "arrow.uturn.backward").frame(width: 44, height: 44) }
                    .accessibilityLabel("Página anterior")
            }
            Button(action: model.reload) { Image(systemName: "arrow.clockwise").frame(width: 44, height: 44) }
                .accessibilityLabel("Recarregar página")
        }
        .foregroundStyle(Theme.ink)
        .padding(.horizontal, 12)
        .background(Theme.surface.ignoresSafeArea(edges: .top))
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 0.5) }
    }
}

/// Floating tab bar. The selected tab carries the signal colour, like the lens in the icon.
private struct TabBar: View {
    let model: AppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var selection

    private let tabs: [(AppModel.Screen, String, String)] = [
        (.home, "Início", "circle.circle"),
        (.people, "Pessoas", "person.2"),
        (.watchlist, "Watchlist", "eye"),
        (.activity, "Atividade", "bell"),
        (.settings, "Conta", "person.crop.circle"),
    ]

    var body: some View {
        HStack(spacing: 2) {
            ForEach(tabs.indices, id: \.self) { index in item(tabs[index].0, tabs[index].1, tabs[index].2) }
        }
        .padding(5)
        .background(Theme.surface, in: .capsule)
        .overlay(Capsule().strokeBorder(Theme.lineStrong))
        .shadow(color: .black.opacity(0.14), radius: 18, y: 8)
        .padding(.horizontal, 14).padding(.top, 6).padding(.bottom, 4)
        .frame(maxWidth: 560)
    }

    private func item(_ screen: AppModel.Screen, _ title: String, _ icon: String) -> some View {
        let selected = model.screen == screen
        return Button {
            withAnimation(reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.85)) { model.select(screen) }
        } label: {
            VStack(spacing: 3) {
                Image(systemName: selected ? icon + ".fill" : icon)
                    .font(.system(size: 17, weight: selected ? .semibold : .regular))
                    .frame(height: 22)
                    .overlay(alignment: .topTrailing) {
                        if screen == .activity && model.hasUnseenActivity && !selected {
                            Circle().fill(Theme.loss).frame(width: 8, height: 8)
                                .overlay(Circle().strokeBorder(Theme.surface, lineWidth: 1.5))
                                .offset(x: 5, y: -1)
                        }
                    }
                Text(title).font(.caption2.weight(selected ? .semibold : .medium)).lineLimit(1).minimumScaleFactor(0.8)
            }
            .foregroundStyle(selected ? Theme.onSignal : Theme.ink2)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background {
                if selected { Capsule().fill(Theme.signal).matchedGeometryEffect(id: "tab", in: selection) }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(screen == .activity && model.hasUnseenActivity ? title + ", alterações por ver" : title)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Shared scroll scaffold: custom header, readable width, canvas background.
struct ScreenScroll<Content: View>: View {
    var spacing: CGFloat = 20
    var refresh: (() -> Void)? = nil
    @ViewBuilder var content: () -> Content
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: spacing) { content() }
                .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 24)
                .frame(maxWidth: 680).frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.canvas)
        .refreshable { refresh?() }
        .toolbar(.hidden, for: .navigationBar)
    }
}
