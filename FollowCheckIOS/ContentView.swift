import SwiftUI
import UniformTypeIdentifiers

// MARK: - App shell

struct ContentView: View {
    @Bindable var model: AppModel
    @State private var settings = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var tabs

    var body: some View {
        VStack(spacing: 0) {
            if webVisible { webBar }
            ZStack {
                // Always retain the same WebView. Tabs must never recreate the login context.
                if !model.isPreview {
                    InstagramWebView(model: model)
                        .opacity(webVisible ? 1 : 0)
                        .allowsHitTesting(webVisible)
                        .accessibilityHidden(!webVisible)
                }
                switch model.screen {
                case .home: HomeView(model: model) { settings = true }
                case .relations: RelationsView(model: model)
                case .watchlist: WatchlistView(model: model)
                case .activity: ActivityView(model: model)
                case .inbox: if !model.inboxWebMode { InboxView(model: model) }
                case .tools: ToolsView(model: model)
                case .instagram: EmptyView()
                }
                if webVisible, case .failed(let message) = model.phase {
                    EmptyState(icon: "wifi.exclamationmark", title: "Ligação interrompida", message: message, actionTitle: "Voltar a tentar", action: model.reload)
                        .frame(maxHeight: .infinity).background(Theme.canvas)
                }
                if webVisible && (model.phase == .loadingInstagram || model.isBusy) {
                    VStack {
                        HStack(spacing: 10) { ProgressView(); Text("A carregar").font(.footnote.weight(.medium)) }
                            .padding(.horizontal, 16).padding(.vertical, 10)
                            .background(.regularMaterial, in: .capsule)
                        Spacer()
                    }
                    .padding(.top, 12).allowsHitTesting(false)
                }
            }
            .clipped()
            if model.screen != .instagram { tabBar }
        }
        .background(Theme.canvas.ignoresSafeArea())
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
                        let seconds = min(12, 4 + Double(notice.count) / 25)
                        try? await Task.sleep(for: .seconds(seconds))
                        if model.notice == notice { model.notice = nil }
                    }
            }
        }
        .animation(reduceMotion ? nil : .spring(response: 0.4, dampingFraction: 0.85), value: model.notice)
        .sheet(isPresented: $settings) { SessionView(model: model) }
    }

    private var webVisible: Bool { model.screen == .instagram || (model.screen == .inbox && model.inboxWebMode) }

    private var webBar: some View {
        HStack(spacing: 10) {
            Button {
                if model.screen == .inbox { model.inboxWebMode = false } else { model.select(.home) }
            } label: {
                Label(model.screen == .inbox ? "Conversas" : "FollowCheck", systemImage: "chevron.left")
                    .font(.subheadline.weight(.semibold))
            }
            .disabled(model.screen == .instagram && model.requiresAuthentication && !model.sessionAvailable && model.accountId.isEmpty)
            Spacer()
            Text(model.screen == .inbox ? "Mensagens · Instagram" : "Sessão Instagram").font(.footnote.weight(.semibold)).foregroundStyle(Theme.ink2)
            Spacer()
            Button(action: model.reload) { Image(systemName: "arrow.clockwise").frame(width: 44, height: 44) }
                .accessibilityLabel("Recarregar página")
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 48)
        .background(Theme.surface)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 0.5) }
    }

    private var tabBar: some View {
        HStack(spacing: 0) {
            tab(.home, "Início", "house")
            tab(.relations, "Pessoas", "person.2")
            tab(.watchlist, "Watchlist", "eye")
            tab(.activity, "Atividade", "bell")
            tab(.tools, "Mais", "square.grid.2x2")
        }
        .padding(.horizontal, 6).padding(.top, 8).padding(.bottom, 4)
        .background(Theme.surface.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 0.5) }
    }

    private func tab(_ screen: AppModel.Screen, _ title: String, _ icon: String) -> some View {
        let selected = model.screen == screen || (screen == .tools && model.screen == .inbox)
        return Button {
            withAnimation(reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.85)) { model.select(screen) }
        } label: {
            VStack(spacing: 4) {
                ZStack {
                    if selected {
                        Capsule().fill(Theme.signal).frame(width: 54, height: 30)
                            .matchedGeometryEffect(id: "selectedTab", in: tabs)
                    }
                    Image(systemName: selected ? icon + ".fill" : icon)
                        .font(.system(size: 17, weight: selected ? .semibold : .regular))
                        .foregroundStyle(selected ? Theme.onSignal : Theme.ink2)
                        .overlay(alignment: .topTrailing) {
                            if screen == .activity && model.hasUnseenActivity && !selected {
                                Circle().fill(Theme.loss).frame(width: 8, height: 8).offset(x: 4, y: -2)
                            }
                        }
                }
                .frame(height: 30)
                Text(title).font(.caption2.weight(selected ? .semibold : .medium))
                    .foregroundStyle(selected ? Theme.ink : Theme.ink2)
            }
            .frame(maxWidth: .infinity, minHeight: 50)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

// MARK: - Home

private struct HomeView: View {
    let model: AppModel
    let openSettings: () -> Void
    @State private var tool: NativeTool?
    @State private var intelligence = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                header
                CircleOverview(model: model)
                CheckPanel(model: model)
                news
                shortcuts
                Label("A sessão e os resultados ficam neste iPhone.", systemImage: "lock.fill")
                    .font(.footnote).foregroundStyle(Theme.ink3)
                    .frame(maxWidth: .infinity)
            }
            .padding(.horizontal, 20).padding(.top, 10).padding(.bottom, 28)
            .frame(maxWidth: 640).frame(maxWidth: .infinity)
        }
        .scrollIndicators(.hidden)
        .background(Theme.canvas)
        .refreshable { model.refreshState() }
        .sheet(item: $tool) { ToolDestination(model: model, tool: $0) }
        .sheet(isPresented: $intelligence) {
            NavigationStack {
                RelationshipIntelligence(model: model)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Concluído") { intelligence = false } } }
            }
            .tint(Theme.signalInk)
        }
    }

    private var session: (text: String, tone: Tone) {
        if !model.sessionAvailable { return (model.phase == .loadingInstagram ? "A abrir a sessão" : "Sessão por ligar", .caution) }
        if model.safetyBlocked { return ("Verificações em pausa", .caution) }
        if model.ownCheckRunning { return ("A verificar", .signal) }
        if model.paused { return ("Em pausa", .neutral) }
        return ("Ligado", .gain)
    }

    private var header: some View {
        HStack(spacing: 12) {
            ProfileAvatar(photoURL: model.profilePhotoURL, size: 46, name: model.username)
            VStack(alignment: .leading, spacing: 4) {
                Text(model.username.isEmpty ? "FollowCheck" : "@" + model.username)
                    .font(.headline).foregroundStyle(Theme.ink).lineLimit(1)
                StatusPill(text: session.text, tone: session.tone)
            }
            Spacer(minLength: 0)
            IconButton(systemName: "gearshape", label: "Definições", action: openSettings)
        }
    }

    private var news: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "Novidades", action: model.accountEvents.isEmpty ? nil : "Ver tudo") { model.select(.activity) }
            let recent = model.accountEvents.sorted { $0.date > $1.date }.prefix(3)
            if recent.isEmpty {
                HStack(spacing: 12) {
                    Image(systemName: "sparkles").foregroundStyle(Theme.signalInk)
                        .frame(width: 40, height: 40).background(Theme.signal.opacity(0.16), in: .circle)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(model.lastCompletedCheck == nil ? "Ainda sem referência" : "Sem alterações registadas").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                        Text(model.lastCompletedCheck == nil ? "O primeiro check cria a referência. As mudanças aparecem a partir do segundo." : "Quem chega e quem sai aparece aqui depois de cada check completo.")
                            .font(.footnote).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .surface()
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(recent.enumerated()), id: \.element.id) { index, event in
                        WatchChangeRow(event: event).padding(.horizontal, 16).padding(.vertical, 12)
                        if index < recent.count - 1 { Divider().overlay(Theme.line).padding(.leading, 72) }
                    }
                }
                .surface(padding: 0)
            }
        }
    }

    private var shortcuts: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "Atalhos", action: "Todos") { model.select(.tools) }
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                ShortcutTile(icon: "person.2.badge.minus", title: "Limpeza", detail: "Rever quem segues") { tool = NativeTool.all.first { $0.id == "cleanup" } }
                ShortcutTile(icon: "eye", title: "Watchlist", detail: model.targets.isEmpty ? "Acompanhar perfis" : "\(model.targets.count) \(model.targets.count == 1 ? "perfil" : "perfis")") { model.select(.watchlist) }
                ShortcutTile(icon: "circle.hexagongrid", title: "Círculo real", detail: "Força das ligações") { intelligence = true }
                ShortcutTile(icon: "square.and.arrow.up", title: "Exportar", detail: "CSV e JSON") { tool = NativeTool.all.first { $0.id == "reports" } }
            }
        }
    }
}

private struct ShortcutTile: View {
    let icon: String
    let title: String
    let detail: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 14) {
                Image(systemName: icon).font(.system(size: 18, weight: .semibold)).foregroundStyle(Theme.signalInk)
                    .frame(width: 38, height: 38).background(Theme.signal.opacity(0.16), in: .rect(cornerRadius: 11, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                    Text(detail).font(.footnote).foregroundStyle(Theme.ink2).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .surface(padding: 14, radius: 18)
        }
        .buttonStyle(PressStyle())
    }
}

/// The reciprocity ring with its legend: the app's signature view.
private struct CircleOverview: View {
    let model: AppModel
    private var snapshot: AppModel.Snapshot? { model.snapshot }
    private var onlyFollowers: Int { max(0, (snapshot?.followers ?? 0) - (snapshot?.mutuals ?? 0)) }
    private var segments: [RingSegment] {
        guard let snapshot else { return [] }
        return [
            RingSegment(id: "mutual", value: Double(snapshot.mutuals), color: Theme.signal),
            RingSegment(id: "out", value: Double(snapshot.nonFollowers), color: Theme.loss),
            RingSegment(id: "in", value: Double(onlyFollowers), color: Theme.reach),
        ]
    }

    var body: some View {
        VStack(spacing: 18) {
            ReciprocityRing(segments: segments, running: model.ownCheckRunning, progress: model.progress) { center }
                .frame(maxWidth: 250)
                .padding(.top, 4)
                .accessibilityElement(children: .combine)
            caption
            if snapshot != nil {
                HStack(spacing: 8) {
                    legend("Mútuos", snapshot?.mutuals, Theme.signal, filter: "Mútuos")
                    legend("Não te seguem", snapshot?.nonFollowers, Theme.loss, filter: "Não me seguem")
                    legend("Não segues", onlyFollowers, Theme.reach, filter: "Eu não sigo")
                }
            }
        }
        .frame(maxWidth: .infinity)
        .surface(padding: 20, radius: 28)
    }

    @ViewBuilder private var center: some View {
        VStack(spacing: 2) {
            if model.ownCheckRunning {
                Text(model.progress.map { "\(Int($0 * 100))%" } ?? "···")
                    .font(.system(size: 46, weight: .semibold, design: .rounded)).monospacedDigit()
                    .contentTransition(.numericText()).foregroundStyle(Theme.ink)
                Text("a verificar").font(.subheadline).foregroundStyle(Theme.ink2)
            } else if let snapshot {
                Text((snapshot.newChanges ?? 0).formatted())
                    .font(.system(size: 52, weight: .semibold, design: .rounded)).monospacedDigit()
                    .contentTransition(.numericText()).foregroundStyle(Theme.ink)
                Text((snapshot.newChanges ?? 0) == 1 ? "alteração nova" : "alterações novas")
                    .font(.subheadline).foregroundStyle(Theme.ink2).multilineTextAlignment(.center)
            } else {
                BrandMark(size: 44).padding(.bottom, 8)
                Text("Sem referência").font(.headline).foregroundStyle(Theme.ink)
                Text("faz o primeiro check").font(.footnote).foregroundStyle(Theme.ink2)
            }
        }
        .minimumScaleFactor(0.7)
    }

    private var caption: some View {
        VStack(spacing: 4) {
            if model.ownCheckRunning {
                Text(model.statusText).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                if !model.detailText.isEmpty { Text(model.detailText).font(.footnote).foregroundStyle(Theme.ink2) }
            } else if let snapshot {
                if let last = model.lastCompletedCheck {
                    Text("Último check \(RelativeTime.short(last))").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                }
                Text("\(snapshot.followers.formatted()) seguidores · \(snapshot.following.formatted()) a seguir")
                    .font(.footnote).foregroundStyle(Theme.ink2).monospacedDigit()
            } else {
                Text("O teu círculo, em perspetiva").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                Text("Quem te segue, quem segues e quem mudou, comparado entre checks completos.")
                    .font(.footnote).foregroundStyle(Theme.ink2)
            }
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
    }

    private func legend(_ title: String, _ value: Int?, _ color: Color, filter: String) -> some View {
        Button {
            model.requestedRelationFilter = filter
            model.select(.relations)
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 10, height: 10)
                    Text(title).font(.caption.weight(.medium)).foregroundStyle(Theme.ink2).lineLimit(1).minimumScaleFactor(0.8)
                }
                Text(value.map { $0.formatted() } ?? "—")
                    .font(.system(.title3, design: .rounded).weight(.semibold)).monospacedDigit()
                    .foregroundStyle(Theme.ink).contentTransition(.numericText())
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(Theme.raised, in: .rect(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(PressStyle())
        .accessibilityLabel("\(title): \(value ?? 0)")
        .accessibilityHint("Abre a lista em Pessoas")
    }
}

/// The single place that explains whether a check can run and what to do next.
private struct CheckPanel: View {
    let model: AppModel

    var body: some View {
        if !model.sessionAvailable {
            if model.phase == .starting || model.phase == .loadingInstagram {
                HStack(spacing: 12) {
                    ProgressView()
                    Text("A recuperar a tua sessão…").font(.subheadline).foregroundStyle(Theme.ink2)
                    Spacer()
                }
                .surface()
            } else {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Liga a tua conta").font(.headline).foregroundStyle(Theme.ink)
                    Text("Inicia sessão no Instagram dentro da app. A sessão fica guardada apenas neste iPhone e não é partilhada.")
                        .font(.subheadline).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                    Button(action: model.openInstagram) { Label("Abrir Instagram", systemImage: "arrow.right") }
                        .buttonStyle(SignalButtonStyle())
                }
                .surface(padding: 18)
            }
        } else if model.safetyBlocked {
            VStack(alignment: .leading, spacing: 12) {
                Label(model.statusText, systemImage: "exclamationmark.shield.fill").font(.headline).foregroundStyle(Theme.caution)
                Text(model.detailText).font(.subheadline).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                if let until = model.cooldownUntil, until > Date() {
                    HStack {
                        Text("Espera restante").font(.footnote).foregroundStyle(Theme.ink2)
                        Spacer()
                        Text(until, style: .timer).font(.footnote.weight(.semibold).monospacedDigit()).foregroundStyle(Theme.ink)
                    }
                }
                HStack(spacing: 10) {
                    Button("Abrir Instagram", action: model.openInstagram).buttonStyle(QuietButtonStyle(fill: true))
                    Button(model.confirmingSession ? "A reavaliar…" : "Reavaliar", action: model.confirmSession)
                        .buttonStyle(ProminentButtonStyle()).disabled(model.confirmingSession)
                }
            }
            .surface(padding: 18, fill: Theme.caution.opacity(0.08))
        } else if model.ownCheckRunning {
            HStack(spacing: 10) {
                Button("Parar check", role: .destructive, action: model.cancelCurrentScan).buttonStyle(QuietButtonStyle(fill: true))
                Button("Ver atividade") { model.select(.activity) }.buttonStyle(QuietButtonStyle(fill: true))
            }
        } else if model.paused {
            VStack(alignment: .leading, spacing: 12) {
                Label("As verificações estão em pausa", systemImage: "pause.circle.fill").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                Button("Retomar verificações") { model.setPaused(false) }.buttonStyle(SignalButtonStyle())
            }
        } else {
            VStack(spacing: 10) {
                Button(action: model.scan) { Label("Verificar agora", systemImage: "arrow.triangle.2.circlepath") }
                    .buttonStyle(SignalButtonStyle())
                    .disabled(!model.canScan)
                Text(model.watchCheckRunning ? "A Watchlist está a verificar. O teu check tem prioridade e retoma-a depois." : "O resultado anterior mantém-se até o novo check estar completo.")
                    .font(.footnote).foregroundStyle(Theme.ink3).multilineTextAlignment(.center)
            }
        }
    }
}

// MARK: - Activity

private struct ActivityView: View {
    let model: AppModel
    @State private var filter = "Tudo"
    @State private var diagnostics = false
    @State private var likes = false
    private let filters = ["Tudo", "Deixaram de seguir", "Novos seguidores", "Indisponíveis"]

    private func matches(_ event: AppModel.WatchEvent, _ name: String) -> Bool {
        switch name {
        case "Deixaram de seguir": return event.type == "unfollow_confirmed"
        case "Novos seguidores": return event.type == "new_follower"
        case "Indisponíveis": return event.type == "account_unavailable"
        default: return true
        }
    }
    private var events: [AppModel.WatchEvent] {
        model.accountEvents.filter { matches($0, filter) }.sorted { $0.date > $1.date }
    }
    private var days: [(day: Date, events: [AppModel.WatchEvent])] {
        let calendar = Calendar.current
        let grouped = Dictionary(grouping: events) { calendar.startOfDay(for: $0.date) }
        return grouped.keys.sorted(by: >).map { ($0, grouped[$0] ?? []) }
    }
    private func dayTitle(_ day: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(day) { return "Hoje" }
        if calendar.isDateInYesterday(day) { return "Ontem" }
        return day.formatted(.dateTime.weekday(.wide).day().month(.wide))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                ScreenHeader(title: "Atividade", subtitle: "Quem chegou e quem saiu, entre checks completos.") {
                    IconButton(systemName: "heart", label: "Gostos nas minhas publicações") { likes = true }
                    IconButton(systemName: "stethoscope", label: "Diagnóstico técnico") { diagnostics = true }
                }
                ChipRow {
                    ForEach(filters, id: \.self) { name in
                        Chip(title: name, count: model.accountEvents.filter { matches($0, name) }.count, selected: filter == name) { filter = name }
                    }
                }
                if events.isEmpty {
                    EmptyState(icon: "bell", title: filter == "Tudo" ? "Ainda sem alterações" : "Nada neste filtro",
                               message: "As mudanças aparecem depois de comparar dois checks completos. A data é a da observação, não a hora exata da mudança.")
                        .surface(padding: 0)
                }
                LazyVStack(alignment: .leading, spacing: 22) {
                    ForEach(days, id: \.day) { group in
                        VStack(alignment: .leading, spacing: 10) {
                            Eyebrow(text: dayTitle(group.day))
                            VStack(spacing: 0) {
                                ForEach(Array(group.events.enumerated()), id: \.element.id) { index, event in
                                    WatchChangeRow(event: event).padding(.horizontal, 16).padding(.vertical, 12)
                                    if index < group.events.count - 1 { Divider().overlay(Theme.line).padding(.leading, 72) }
                                }
                            }
                            .surface(padding: 0)
                        }
                    }
                }
            }
            .padding(.horizontal, 20).padding(.top, 10).padding(.bottom, 28)
            .frame(maxWidth: 700).frame(maxWidth: .infinity)
        }
        .background(Theme.canvas)
        .refreshable { model.refreshState() }
        .sheet(isPresented: $likes) { MediaLikesView(model: model, targetID: "", title: "As minhas publicações") }
        .sheet(isPresented: $diagnostics) {
            NavigationStack {
                DiagnosticView(model: model)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fechar") { diagnostics = false } } }
            }
            .tint(Theme.signalInk)
        }
    }
}

struct WatchChangeRow: View {
    let event: AppModel.WatchEvent
    private var style: (icon: String, tone: Tone) {
        switch event.type {
        case "new_follower", "watch_new_follower": return ("plus", .gain)
        case "watch_started_following": return ("arrow.up.right", .gain)
        case "unfollow_confirmed", "watch_lost_follower": return ("minus", .loss)
        case "watch_stopped_following": return ("arrow.down.right", .loss)
        case "account_unavailable", "watch_account_unavailable": return ("questionmark", .caution)
        case "watch_profile_change": return ("pencil", .reach)
        default: return ("flag.fill", .neutral)
        }
    }
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ProfileAvatar(photoURL: event.photoURL, size: 44, name: event.username)
                .overlay(alignment: .bottomTrailing) {
                    Image(systemName: style.icon).font(.system(size: 9, weight: .heavy)).foregroundStyle(Theme.surface)
                        .frame(width: 18, height: 18).background(style.tone.color, in: .circle)
                        .overlay(Circle().stroke(Theme.surface, lineWidth: 2))
                        .offset(x: 3, y: 3)
                }
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(event.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                    Spacer(minLength: 8)
                    Text(event.date, format: .dateTime.hour().minute()).font(.caption).foregroundStyle(Theme.ink3)
                }
                if !event.username.isEmpty {
                    if let encoded = event.username.addingPercentEncoding(withAllowedCharacters: .alphanumerics),
                       let url = URL(string: "https://www.instagram.com/" + encoded + "/") {
                        Link("@" + event.username, destination: url).font(.subheadline.weight(.medium)).foregroundStyle(Theme.signalInk)
                    }
                    if !event.fullName.isEmpty { Text(event.fullName).font(.footnote).foregroundStyle(Theme.ink2) }
                }
                if !event.detail.isEmpty {
                    Text(event.detail).font(.footnote).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Watchlist

struct WatchlistView: View {
    let model: AppModel
    @State private var adding = false
    @State private var username = ""
    @State private var interval = 1440
    @State private var removing: AppModel.WatchTarget?
    @State private var viewing: AppModel.WatchTarget?
    @State private var history: AppModel.WatchTarget?
    @State private var likesTarget: AppModel.WatchTarget?
    @State private var historyFilter = ""
    private let intervals = [60, 120, 360, 720, 1440, 2880, 10080, 43200]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ScreenHeader(title: "Watchlist", subtitle: "O que muda nas contas que escolhes.") {
                    IconButton(systemName: "plus", label: "Adicionar perfil") { adding = true }
                        .disabled(!model.canScanWatchlist || model.watchlistBusy)
                }
                if model.watchCheckRunning { runningCard }
                HStack(spacing: 12) {
                    Image(systemName: "clock.arrow.2.circlepath").font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.signalInk)
                        .frame(width: 38, height: 38).background(Theme.signal.opacity(0.16), in: .rect(cornerRadius: 11, style: .continuous))
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Checks automáticos").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                        Text("Com a app aberta, no intervalo de cada perfil.").font(.footnote).foregroundStyle(Theme.ink2)
                    }
                    Spacer(minLength: 8)
                    Toggle("Checks automáticos", isOn: Binding(get: { model.schedulerEnabled }, set: model.setScheduler))
                        .labelsHidden().disabled(!model.sessionAvailable)
                }
                .surface(padding: 14, radius: 18)
                if model.targets.isEmpty {
                    EmptyState(icon: "eye", title: "O teu radar começa aqui",
                               message: "Adiciona uma conta. O primeiro check cria a referência; os seguintes mostram quem entrou e quem saiu.",
                               actionTitle: "Adicionar perfil") { adding = true }
                        .surface(padding: 0)
                        .disabled(!model.canScanWatchlist || model.watchlistBusy)
                }
                ForEach(model.targets) { target in targetCard(target) }
            }
            .padding(.horizontal, 20).padding(.top, 10).padding(.bottom, 28)
            .frame(maxWidth: 700).frame(maxWidth: .infinity)
        }
        .background(Theme.canvas)
        .refreshable { model.refreshState() }
        .sheet(isPresented: $adding) { addSheet }
        .sheet(item: $history) { target in WatchHistorySheet(model: model, target: target, initialFilter: historyFilter) }
        .sheet(item: $likesTarget) { target in MediaLikesView(model: model, targetID: target.id, title: "@" + target.username) }
        .sheet(item: $viewing) { target in WatchlistDetailView(model: model, target: target) }
        .confirmationDialog("Remover este perfil e o seu histórico da Watchlist?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Remover", role: .destructive) {
                if let target = removing { model.watchlist("remove", args: ["targetId": target.id]) }
                removing = nil
            }
        }
    }

    private var runningCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                ProgressView()
                Text(model.watchStatus).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                Spacer()
            }
            if !model.watchDetail.isEmpty { Text(model.watchDetail).font(.footnote).foregroundStyle(Theme.ink2) }
            if let progress = model.watchProgress {
                ProgressView(value: progress).tint(Theme.signalInk)
            }
            Button("Parar este check", role: .destructive, action: model.cancelCurrentScan).buttonStyle(QuietButtonStyle())
        }
        .surface(padding: 16, radius: 20, fill: Theme.signal.opacity(0.08))
    }

    private func status(_ target: AppModel.WatchTarget) -> (String, Tone) {
        if target.running { return ("A verificar", .signal) }
        if !target.error.isEmpty { return ("Último check incompleto", .caution) }
        if !target.enabled { return ("Em pausa", .neutral) }
        if target.comparisonReady { return ("A comparar", .gain) }
        return ("Referência em preparação", .reach)
    }

    private func targetCard(_ target: AppModel.WatchTarget) -> some View {
        let changes = model.watchEvents.filter { $0.targetId == target.id && $0.isWatchChange && abs($0.date.timeIntervalSince(target.lastSuccess ?? .distantPast)) < 0.001 }
        let state = status(target)
        return VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                ProfileAvatar(photoURL: target.photoURL, size: 50, name: target.username)
                VStack(alignment: .leading, spacing: 5) {
                    Text("@\(target.username)").font(.headline).foregroundStyle(Theme.ink).lineLimit(1)
                    StatusPill(text: state.0, tone: state.1)
                }
                Spacer(minLength: 0)
                Menu {
                    Button("Ver listas guardadas", systemImage: "list.bullet") {
                        model.loadWatchlistList(target.id, relation: "followers")
                        viewing = target
                    }
                    .disabled(!target.baselineReady || model.watchlistBusy)
                    Button("Histórico de alterações", systemImage: "clock.arrow.circlepath") { historyFilter = ""; history = target }
                    Button("Gostos nas publicações", systemImage: "heart") { likesTarget = target }.disabled(!target.baselineReady)
                    Menu("Intervalo: \(RelativeTime.interval(target.intervalMinutes))") {
                        ForEach(intervals, id: \.self) { minutes in
                            Button(RelativeTime.interval(minutes)) { model.watchlist("update", args: ["targetId": target.id, "intervalMinutes": minutes]) }
                        }
                    }
                    Button("Abrir Instagram", systemImage: "arrow.up.forward.app", action: model.openInstagram)
                    Button(target.enabled ? "Pausar perfil" : "Ativar perfil", systemImage: target.enabled ? "pause" : "play") {
                        model.watchlist("update", args: ["targetId": target.id, "enabled": !target.enabled])
                    }
                    Button("Remover perfil", systemImage: "trash", role: .destructive) { removing = target }
                } label: {
                    IconGlyph(systemName: "ellipsis")
                }
                .accessibilityLabel("Opções de \(target.username)")
            }
            HStack(spacing: 0) {
                metric("Seguidores", target.baselineReady ? target.followers.formatted() : "—")
                Divider().overlay(Theme.line).frame(height: 34)
                metric("A seguir", target.baselineReady ? target.following.formatted() : "—")
                Divider().overlay(Theme.line).frame(height: 34)
                metric("Mudanças", target.comparisonReady ? changes.count.formatted() : "—", highlight: !changes.isEmpty)
            }
            .padding(.vertical, 10)
            .background(Theme.raised, in: .rect(cornerRadius: 14, style: .continuous))
            Text(target.comparisonReady ? (changes.isEmpty ? "Sem mudanças no último check." : "\(changes.count) \(changes.count == 1 ? "mudança" : "mudanças") no último check.") : "A recolha ainda não foi validada contra os totais do perfil.")
                .font(.footnote).foregroundStyle(Theme.ink2)
            if !target.error.isEmpty { InlineNotice(text: target.error) }
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    if let date = target.lastSuccess {
                        Text(RelativeTime.short(date)).font(.footnote.weight(.medium)).foregroundStyle(Theme.ink)
                    } else {
                        Text("Sem check concluído").font(.footnote.weight(.medium)).foregroundStyle(Theme.ink)
                    }
                    Text("a cada \(RelativeTime.interval(target.intervalMinutes))").font(.caption).foregroundStyle(Theme.ink3)
                }
                Spacer(minLength: 0)
                Button("Alterações") { historyFilter = ""; history = target }.buttonStyle(QuietButtonStyle())
                Button(model.activeCheckScope == "account" ? "Verificar a seguir" : "Verificar") { model.watchlist("run", args: ["targetId": target.id]) }
                    .buttonStyle(ProminentButtonStyle())
                    .disabled(!model.canScanWatchlist || model.watchlistBusy || target.running)
            }
        }
        .surface(padding: 16, radius: 22)
    }

    private func metric(_ title: String, _ value: String, highlight: Bool = false) -> some View {
        VStack(spacing: 3) {
            Text(value).font(.system(.title3, design: .rounded).weight(.semibold)).monospacedDigit()
                .foregroundStyle(highlight ? Theme.signalInk : Theme.ink)
            Text(title).font(.caption).foregroundStyle(Theme.ink2)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    private var addSheet: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Text("@").foregroundStyle(Theme.ink3)
                        TextField("username", text: $username).textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                    Picker("Intervalo mínimo", selection: $interval) {
                        ForEach(intervals, id: \.self) { minutes in Text(RelativeTime.interval(minutes)).tag(minutes) }
                    }
                } header: { Text("Conta Instagram") } footer: {
                    Text("O primeiro check cria a referência. A frequência só se aplica com a app ativa e respeita as pausas do motor.")
                }
                .listRowBackground(Theme.surface)
            }
            .fcForm()
            .navigationTitle("Adicionar perfil").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { adding = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Adicionar") {
                        let name = username.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "@", with: "")
                        model.watchlist("add", args: ["username": name, "intervalMinutes": interval])
                        adding = false; username = ""
                    }
                    .disabled(username.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "@", with: "").isEmpty || model.watchlistBusy)
                }
            }
        }
        .tint(Theme.signalInk)
        .presentationDetents([.medium, .large])
    }
}

private struct WatchlistDetailView: View {
    let model: AppModel
    let target: AppModel.WatchTarget
    @Environment(\.dismiss) private var dismiss
    @State private var relation = "followers"
    @State private var query = ""
    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                Picker("Lista", selection: $relation) {
                    Text("Seguidores").tag("followers")
                    Text("A seguir").tag("following")
                }
                .pickerStyle(.segmented).disabled(model.watchlistBusy)
                .onChange(of: relation) { _, value in model.loadWatchlistList(target.id, relation: value) }
                SearchField(text: $query, prompt: "Pesquisar nesta lista")
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(model.watchlistAccounts.filter { query.isEmpty || "\($0.username) \($0.name)".localizedCaseInsensitiveContains(query) }) { person in
                            HStack(spacing: 12) {
                                ProfileAvatar(photoURL: person.photoURL, size: 40, name: person.username)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("@\(person.username)").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                                    if !person.name.isEmpty { Text(person.name).font(.footnote).foregroundStyle(Theme.ink2) }
                                }
                                Spacer()
                            }
                            .padding(.horizontal, 14).padding(.vertical, 10)
                            Divider().overlay(Theme.line).padding(.leading, 66)
                        }
                        if model.watchlistBusy { ProgressView("A carregar lista…").frame(maxWidth: .infinity).padding() }
                        if model.watchlistListMore {
                            Button("Carregar mais") { model.loadWatchlistList(target.id, relation: relation, more: true) }
                                .buttonStyle(QuietButtonStyle()).disabled(model.watchlistBusy).frame(maxWidth: .infinity).padding()
                        }
                    }
                    .background(Theme.surface, in: .rect(cornerRadius: 20, style: .continuous))
                }
            }
            .padding(.horizontal, 20).padding(.top, 8)
            .background(Theme.canvas)
            .navigationTitle("@\(target.username)").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Concluído") { dismiss() } } }
        }
        .tint(Theme.signalInk)
    }
}

private let watchChangeKinds: [(id: String, title: String, icon: String)] = [
    ("watch_new_follower", "Novos seguidores", "person.badge.plus"),
    ("watch_lost_follower", "Perdeu seguidores", "person.badge.minus"),
    ("watch_started_following", "Começou a seguir", "arrow.up.right"),
    ("watch_stopped_following", "Deixou de seguir", "arrow.down.right"),
]

private struct WatchHistorySheet: View {
    let model: AppModel
    let target: AppModel.WatchTarget
    @State private var query = ""
    @State private var filter = ""
    @Environment(\.dismiss) private var dismiss
    init(model: AppModel, target: AppModel.WatchTarget, initialFilter: String) {
        self.model = model; self.target = target; _filter = State(initialValue: initialFilter)
    }
    var body: some View {
        NavigationStack {
            ScrollView { WatchHistoryContent(events: model.watchEvents.filter { $0.targetId == target.id }, query: $query, filter: $filter).padding(20) }
                .background(Theme.canvas).navigationTitle("@\(target.username)")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fechar") { dismiss() } } }
        }
        .tint(Theme.signalInk)
    }
}

private struct WatchHistoryContent: View {
    let events: [AppModel.WatchEvent]
    var targetNames: [String: String] = [:]
    @Binding var query: String
    @Binding var filter: String
    private var matches: [AppModel.WatchEvent] {
        events.filter { event in
            event.isWatchChange && (filter.isEmpty || event.type == filter) &&
            (query.isEmpty || "\(event.username) \(event.fullName) \(event.title)".localizedCaseInsensitiveContains(query))
        }.sorted { $0.date > $1.date }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("O que mudou").font(.title2.weight(.bold)).foregroundStyle(Theme.ink)
                Text("Comparação entre checks completos. A data é a da observação; não indica a hora exata da mudança.")
                    .font(.footnote).foregroundStyle(Theme.ink2)
            }
            SearchField(text: $query, prompt: "Pesquisar perfil ou alteração")
            ChipRow {
                Chip(title: "Todas", count: events.filter(\.isWatchChange).count, selected: filter.isEmpty) { filter = "" }
                ForEach(watchChangeKinds, id: \.id) { kind in
                    Chip(title: kind.title, count: events.filter { $0.isWatchChange && $0.type == kind.id }.count, selected: filter == kind.id) { filter = kind.id }
                }
                Chip(title: "Perfil", selected: filter == "watch_profile_change") { filter = "watch_profile_change" }
            }
            if matches.isEmpty {
                EmptyState(icon: "eye", title: "Sem alterações neste filtro", message: "O primeiro check cria a referência. Os seguintes identificam as contas que mudaram.")
                    .surface(padding: 0)
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(Array(matches.enumerated()), id: \.element.id) { index, event in
                        VStack(alignment: .leading, spacing: 4) {
                            if let name = targetNames[event.targetId] { Text("@" + name).font(.caption.weight(.semibold)).foregroundStyle(Theme.signalInk) }
                            WatchChangeRow(event: event)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 12)
                        if index < matches.count - 1 { Divider().overlay(Theme.line).padding(.leading, 72) }
                    }
                }
                .surface(padding: 0)
            }
        }
    }
}

// MARK: - Inbox

private struct InboxView: View {
    let model: AppModel
    @State private var query = ""
    @State private var selected: AppModel.Conversation?
    @State private var professionalInbox = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Button { model.select(.tools) } label: { Label("Mais", systemImage: "chevron.left").font(.subheadline.weight(.semibold)) }
                ScreenHeader(title: "Inbox", subtitle: "As tuas conversas, num espaço mais tranquilo.") {
                    IconButton(systemName: "arrow.clockwise", label: "Atualizar conversas") { model.loadInbox() }
                        .disabled(model.inboxLoading || !model.canReadInbox)
                }
                Picker("Caixa", selection: Binding(get: { model.inboxKind }, set: {
                    model.inboxKind = $0; model.conversations = []; model.inboxLoaded = false; model.inboxCursor = ""; model.inboxHasMore = false; model.loadInbox()
                })) {
                    Text("Conversas").tag("inbox")
                    Text("Pedidos").tag("pending")
                }
                .pickerStyle(.segmented).disabled(model.inboxLoading)
                if model.inboxUnavailable {
                    InlineNotice(text: "A leitura nativa respondeu 404 nesta sessão. Abre as mensagens na sessão Instagram já existente; não é uma conversa recriada pela FollowCheck.")
                }
                HStack(spacing: 10) {
                    Button { model.openInstagramInbox() } label: { Label("Abrir no Instagram", systemImage: "arrow.up.forward.app") }
                        .buttonStyle(QuietButtonStyle(fill: true)).disabled(model.checkIsRunning || !model.sessionAvailable)
                    Button { professionalInbox = true } label: { Label("Profissional", systemImage: "paperplane") }
                        .buttonStyle(QuietButtonStyle(fill: true))
                }
                if model.inboxLoaded { SearchField(text: $query, prompt: "Pesquisar conversas") }
                if model.inboxLoading { ProgressView("A carregar…").frame(maxWidth: .infinity) }
                if !model.inboxLoaded {
                    EmptyState(icon: "bubble.left.and.bubble.right", title: "Abre as tuas conversas",
                               message: "A Inbox só é consultada quando pedes. Mensagens e multimédia que o Instagram não disponibilize aqui continuam na app oficial.",
                               actionTitle: "Carregar Inbox") { model.loadInbox() }
                        .surface(padding: 0)
                        .disabled(!model.canReadInbox || model.inboxLoading)
                } else {
                    let threads = model.conversations.filter { query.isEmpty || "\($0.title) \($0.preview)".localizedCaseInsensitiveContains(query) }
                    LazyVStack(spacing: 0) {
                        ForEach(Array(threads.enumerated()), id: \.element.id) { index, thread in
                            Button {
                                model.loadInbox(threadId: thread.id)
                                selected = thread
                            } label: {
                                HStack(spacing: 12) {
                                    ProfileAvatar(photoURL: thread.photoURL, size: 46, name: thread.title)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(thread.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                                        Text(thread.preview).font(.footnote).foregroundStyle(Theme.ink2).lineLimit(2)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3)
                                }
                                .padding(.horizontal, 14).padding(.vertical, 12)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain).disabled(model.inboxLoading)
                            if index < threads.count - 1 { Divider().overlay(Theme.line).padding(.leading, 72) }
                        }
                    }
                    .surface(padding: 0)
                    Text(model.conversations.isEmpty ? "O Instagram não devolveu conversas nesta consulta." : "Conversas recentes · leitura disponibilizada pelo Instagram")
                        .font(.footnote).foregroundStyle(Theme.ink3)
                    if model.inboxHasMore {
                        Button("Carregar mais") { model.loadInbox(more: true) }.buttonStyle(QuietButtonStyle()).disabled(model.inboxLoading)
                    }
                }
            }
            .padding(.horizontal, 20).padding(.top, 10).padding(.bottom, 28)
            .frame(maxWidth: 700).frame(maxWidth: .infinity)
        }
        .background(Theme.canvas)
        .sheet(isPresented: $professionalInbox) {
            if let tool = NativeTool.all.first(where: { $0.id == "inbox" }) { ToolDestination(model: model, tool: tool) }
        }
        .sheet(item: $selected) { thread in
            NavigationStack {
                ScrollView {
                    LazyVStack(spacing: 10) {
                        if model.inboxLoading { ProgressView("A carregar conversa…").padding() }
                        ForEach(model.directMessages) { message in
                            HStack {
                                if message.own { Spacer(minLength: 48) }
                                Text(message.text).font(.body)
                                    .foregroundStyle(message.own ? Theme.onSignal : Theme.ink)
                                    .padding(.horizontal, 14).padding(.vertical, 10)
                                    .background(message.own ? Theme.signal : Theme.surface, in: .rect(cornerRadius: 20, style: .continuous))
                                    .textSelection(.enabled)
                                if !message.own { Spacer(minLength: 48) }
                            }
                        }
                        Text("Leitura das mensagens recentes. Para responder, abre o Instagram.").font(.footnote).foregroundStyle(Theme.ink3).padding(.top, 8)
                    }
                    .padding(16)
                }
                .background(Theme.canvas)
                .navigationTitle(thread.title).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Concluído") { selected = nil } } }
            }
            .tint(Theme.signalInk)
        }
    }
}

// MARK: - People

private struct RelationsView: View {
    let model: AppModel
    @State private var requests = false
    @State private var intelligence = false
    private let tool = NativeTool(id: "relations", name: "Pessoas", detail: "", category: "Audiência", icon: "person.2", professional: false)
    private var subtitle: String {
        guard model.relationsReady else { return "Precisas de um check completo." }
        let base = "\(model.relations.count.formatted()) contas"
        if let last = model.lastCompletedCheck { return base + " · check " + RelativeTime.short(last) }
        return base
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ScreenHeader(title: "Pessoas", subtitle: subtitle) {
                Menu {
                    Button("Círculo real", systemImage: "circle.hexagongrid") { intelligence = true }
                    Button("Pedidos de seguimento", systemImage: "person.crop.circle.badge.clock") { requests = true }
                } label: { IconGlyph(systemName: "ellipsis") }
                .accessibilityLabel("Mais opções")
            }
            .padding(.horizontal, 20).padding(.top, 10)
            OperationStudio(model: model, tool: tool)
        }
        .background(Theme.canvas)
        .sheet(isPresented: $requests) { RequestsStudio(model: model) }
        .sheet(isPresented: $intelligence) {
            NavigationStack {
                RelationshipIntelligence(model: model)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Concluído") { intelligence = false } } }
            }
            .tint(Theme.signalInk)
        }
        .alert("FollowCheck", isPresented: Binding(get: { model.tools.error != nil }, set: { if !$0 { model.tools.error = nil } })) {
            Button("OK") { model.tools.error = nil }
        } message: { Text(model.tools.error ?? "") }
    }
}

// MARK: - Diagnostics

struct DiagnosticView: View {
    let model: AppModel
    @State private var onlyErrors = false
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ScreenHeader(title: "Diagnóstico", subtitle: "Exporta depois de reproduzir o problema. O relatório inclui os detalhes técnicos, mesmo com o filtro ativo.") {
                ShareLink(item: model.diagnosticReport) { IconGlyph(systemName: "square.and.arrow.up") }
                    .accessibilityLabel("Exportar diagnóstico").disabled(model.diagnosticsRefreshing)
            }
            HStack(spacing: 10) {
                Button { Task { await model.refreshDiagnostics() } } label: {
                    Label(model.diagnosticsRefreshing ? "A recolher…" : "Atualizar", systemImage: "arrow.clockwise")
                }
                .buttonStyle(QuietButtonStyle()).disabled(model.diagnosticsRefreshing)
                Spacer()
                Toggle("Só avisos e erros", isOn: $onlyErrors).font(.subheadline).fixedSize()
            }
            if model.events.isEmpty {
                EmptyState(icon: "waveform.path", title: "Tudo começa aqui", message: "Os eventos da app aparecem aqui, sem passwords nem cookies.")
            }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(model.events.reversed().filter { !onlyErrors || ["warn", "error"].contains($0.level) }) { event in
                        HStack(alignment: .top, spacing: 12) {
                            Circle().fill(event.level == "error" ? Theme.loss : event.level == "warn" ? Theme.caution : Theme.signalInk)
                                .frame(width: 8, height: 8).padding(.top, 6)
                            VStack(alignment: .leading, spacing: 5) {
                                Text(event.message).font(.subheadline).foregroundStyle(Theme.ink).textSelection(.enabled)
                                if let details = event.details {
                                    DisclosureGroup("Detalhes técnicos") {
                                        Text(details).font(.caption.monospaced()).foregroundStyle(Theme.ink2).textSelection(.enabled)
                                    }
                                    .font(.footnote)
                                }
                                Text(event.date, format: .dateTime.day().month().hour().minute().second()).font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                        .padding(.vertical, 12)
                        Divider().overlay(Theme.line)
                    }
                }
            }
        }
        .padding(20).background(Theme.canvas)
        .task { await model.refreshDiagnostics() }
    }
}

// MARK: - Settings

struct SessionView: View {
    let model: AppModel
    @Environment(\.dismiss) private var dismiss
    @AppStorage("followcheck.reminders.enabled") private var reminders = false
    @AppStorage("followcheck.keepAwake") private var keepAwake = true
    @AppStorage("followcheck.appearance") private var appearance = "system"
    @State private var clear = false
    @State private var confirmSession = false
    @State private var limits = false
    @State private var diagnostics = false
    @State private var backupFile: URL?
    @State private var importingBackup = false
    @State private var backupBusy = false
    @State private var backupMessage: String?

    private var version: String {
        let short = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—"
        return "\(short) (\(build))"
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 12) {
                        ProfileAvatar(photoURL: model.profilePhotoURL, size: 44, name: model.username)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(model.username.isEmpty ? "Conta por identificar" : "@\(model.username)").font(.headline)
                            StatusPill(text: model.sessionAvailable ? "Sessão disponível neste iPhone" : "Sessão por confirmar", tone: model.sessionAvailable ? .gain : .caution)
                        }
                    }
                    .padding(.vertical, 4)
                    Button("Abrir Instagram", systemImage: "arrow.up.forward.app") { model.openInstagram(); dismiss() }
                    Button("Recarregar sessão", systemImage: "arrow.clockwise") { model.reload(); dismiss() }
                    if model.safetyBlocked {
                        Button("Já confirmei a conta no Instagram", systemImage: "checkmark.shield") { confirmSession = true }
                    }
                } header: { Text("Conta") }
                .listRowBackground(Theme.surface)

                Section {
                    Picker("Aparência", selection: $appearance) {
                        Text("Sistema").tag("system")
                        Text("Clara").tag("light")
                        Text("Escura").tag("dark")
                    }
                    .pickerStyle(.segmented)
                } header: { Text("Aparência") }
                .listRowBackground(Theme.surface)

                Section {
                    Button("Ritmo e limites", systemImage: "speedometer") { limits = true }
                    Toggle("Manter ecrã ligado durante checks", isOn: $keepAwake)
                    Toggle("Pausar análise da minha conta", isOn: Binding(get: { model.paused }, set: model.setPaused)).disabled(!model.sessionAvailable)
                    Toggle("Notificações e lembretes", isOn: $reminders)
                        .onChange(of: reminders) { _, enabled in
                            if enabled { model.requestNotificationPermission(); AppDelegate.scheduleRefresh() }
                            else { AppDelegate.cancelRefresh() }
                        }
                } header: { Text("Execução") } footer: {
                    Text("O ecrã só fica ligado durante um check ativo. Os lembretes avisam uma hora depois de saíres e não executam checks; a entrega depende das definições de notificações e Foco do iPhone.")
                }
                .listRowBackground(Theme.surface)

                Section {
                    Button("Preparar cópia para guardar", systemImage: "externaldrive") {
                        Task {
                            backupBusy = true; defer { backupBusy = false }
                            do { backupFile = try await model.exportScanBackup(); backupMessage = "Cópia preparada. Usa Guardar/partilhar para a conservar fora da app." }
                            catch { backupMessage = error.localizedDescription }
                        }
                    }
                    .disabled(backupBusy || !model.sessionAvailable)
                    if let backupFile { ShareLink("Guardar ou partilhar cópia", item: backupFile) }
                    Button("Importar cópia e recuperar dados em falta", systemImage: "square.and.arrow.down") { importingBackup = true }
                        .disabled(backupBusy || !model.sessionAvailable)
                    if backupBusy { ProgressView() }
                    if let backupMessage { Text(backupMessage).font(.footnote).foregroundStyle(Theme.ink2) }
                } header: { Text("Cópia dos checks") } footer: {
                    Text("Cada check completo tem uma cópia nativa por conta. Exporta-a antes de apagar ou reinstalar a app com outra identidade.")
                }
                .listRowBackground(Theme.surface)

                Section {
                    Button("Ver diagnóstico", systemImage: "stethoscope") { diagnostics = true }
                    ShareLink(item: model.diagnosticReport) { Label("Exportar diagnóstico", systemImage: "square.and.arrow.up") }
                    Button("Limpar eventos", systemImage: "trash", role: .destructive) { clear = true }
                } header: { Text("Diagnóstico") }
                .listRowBackground(Theme.surface)

                Section {
                    LabeledContent("Versão", value: version)
                    LabeledContent("Motor", value: "2.5.11 · 10.20.8")
                } header: { Text("Sobre") } footer: {
                    Text("A sessão fica no armazenamento persistente do WebKit deste iPhone. A app não simula outro dispositivo. O Instagram pode pedir verificações adicionais.")
                }
                .listRowBackground(Theme.surface)
            }
            .fcForm()
            .fileImporter(isPresented: $importingBackup, allowedContentTypes: [.json]) { result in
                do {
                    let url = try result.get(); let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
                    let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                    guard size <= 40 * 1024 * 1024 else { backupMessage = "A cópia excede 40 MB."; return }
                    let data = try Data(contentsOf: url)
                    Task {
                        backupBusy = true; defer { backupBusy = false }
                        do { try await model.importScanBackup(data); backupMessage = "Dados em falta recuperados. Os dados já existentes foram preservados." }
                        catch { backupMessage = error.localizedDescription }
                    }
                } catch { backupMessage = error.localizedDescription }
            }
            .sheet(isPresented: $limits) { LimitsView(model: model) }
            .sheet(isPresented: $diagnostics) {
                NavigationStack {
                    DiagnosticView(model: model)
                        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fechar") { diagnostics = false } } }
                }
                .tint(Theme.signalInk)
            }
            .navigationTitle("Definições")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Concluído") { dismiss() } } }
            .confirmationDialog("Reavaliar a sessão após concluíres a verificação no Instagram?", isPresented: $confirmSession, titleVisibility: .visible) {
                Button("Reavaliar sessão") { model.confirmSession() }
            }
            .confirmationDialog("Limpar os eventos de diagnóstico?", isPresented: $clear, titleVisibility: .visible) {
                Button("Limpar", role: .destructive, action: model.clearLogs)
            }
        }
        .tint(Theme.signalInk)
    }
}

private struct LimitsView: View {
    let model: AppModel
    @Environment(\.dismiss) private var dismiss
    @AppStorage("followcheck.limits.batch") private var batch = 20
    @AppStorage("followcheck.limits.daily") private var daily = 50
    @AppStorage("followcheck.limits.actionDelay") private var actionDelay = 4
    @AppStorage("followcheck.limits.actionEvery") private var actionEvery = 5
    @AppStorage("followcheck.limits.actionPause") private var actionPause = 300
    @AppStorage("followcheck.limits.ownDelay") private var ownDelay = 1
    @AppStorage("followcheck.limits.ownEvery") private var ownEvery = 15
    @AppStorage("followcheck.limits.ownPause") private var ownPause = 10
    @AppStorage("followcheck.limits.ownGap") private var ownGap = 60
    @AppStorage("followcheck.limits.manualGap") private var manualGap = false
    @AppStorage("followcheck.limits.watchDelay") private var watchDelay = 1
    @AppStorage("followcheck.limits.watchEvery") private var watchEvery = 15
    @AppStorage("followcheck.limits.watchPause") private var watchPause = 10
    @AppStorage("followcheck.limits.cooldownMinutes") private var cooldownMinutes = 1440
    @State private var message: String?
    @State private var saving = false

    private var isReference: Bool {
        ownDelay == 1 && ownEvery == 15 && ownPause == 10 && watchDelay == 1 && watchEvery == 15 && watchPause == 10 && actionDelay == 4 && actionEvery == 5 && actionPause == 300
    }
    private var isConservative: Bool {
        ownDelay == 5 && ownEvery == 5 && ownPause == 30 && watchDelay == 5 && watchEvery == 5 && watchPause == 30
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    profileRow("Referência", detail: "1 s por página e pausa de 10 s a cada 15. Ações: 4 s e 5 min a cada 5.", selected: isReference) {
                        ownDelay = 1; ownEvery = 15; ownPause = 10; watchDelay = 1; watchEvery = 15; watchPause = 10
                        actionDelay = 4; actionEvery = 5; actionPause = 300
                        Task { do { try await model.applyPacing(); message = "Ritmo de referência aplicado aos próximos checks." } catch { message = error.localizedDescription } }
                    }
                    profileRow("Conservador", detail: "5 s por página e pausa de 30 s a cada 5. Mais lento, mais espaçado.", selected: isConservative) {
                        ownDelay = 5; ownEvery = 5; ownPause = 30; watchDelay = 5; watchEvery = 5; watchPause = 30
                        Task { do { try await model.applyPacing(); message = "Ritmo conservador aplicado aos próximos checks." } catch { message = error.localizedDescription } }
                    }
                } header: { Text("Perfis de ritmo") } footer: {
                    Text("Os perfis não garantem ausência de limitações do servidor.")
                }
                .listRowBackground(Theme.surface)

                Section {
                    Stepper("Duração local: \(cooldownMinutes) min", value: $cooldownMinutes, in: 1...1440, step: 1)
                    Picker("Escolha rápida", selection: $cooldownMinutes) {
                        ForEach([1, 5, 15, 30, 60, 180, 360, 1440], id: \.self) { Text("\($0) min").tag($0) }
                    }
                    if let until = model.cooldownUntil, until > Date() {
                        LabeledContent("Tempo restante") { Text(until, style: .timer).monospacedDigit() }
                    }
                    if let until = model.serverCooldownUntil, until > Date() {
                        LabeledContent("Prazo do servidor", value: until.formatted(date: .omitted, time: .shortened))
                    }
                    Button("Aplicar duração à pausa atual") {
                        Task { do { try await model.configureCooldown(minutes: cooldownMinutes); message = "Duração aplicada à pausa atual e às próximas." } catch { message = error.localizedDescription } }
                    }
                    Button("Terminar espera local agora") {
                        Task { do { try await model.configureCooldown(minutes: cooldownMinutes, release: true); message = "Espera local terminada. Prazos do servidor e verificações de segurança mantêm-se." } catch { message = error.localizedDescription } }
                    }
                } header: { Text("Pausa após limitação") } footer: {
                    Text("A duração conta desde a última limitação. Terminar a espera não confirma ações nem remove avisos de segurança. Um novo erro pode iniciar outra pausa.")
                }
                .listRowBackground(Theme.surface)

                Section {
                    Stepper("Até \(batch) perfis por execução", value: $batch, in: 1...10000)
                    Stepper("Até \(daily) tentativas / 24 h", value: $daily, in: 1...10000)
                    Stepper("\(actionDelay) s entre ações", value: $actionDelay, in: 2...120)
                    Stepper(actionEvery == 0 ? "Sem pausa adicional" : "Pausa a cada \(actionEvery) ações", value: $actionEvery, in: 0...50)
                    Stepper("Pausa de \(actionPause) s", value: $actionPause, in: 0...600, step: 5)
                } header: { Text("Ações sobre perfis") } footer: {
                    Text("Os limites contam tentativas por conta, incluindo falhas. Remover nos dois sentidos conta duas tentativas. As mudanças aplicam-se à próxima fila.")
                }
                .listRowBackground(Theme.surface)

                Section {
                    Stepper("\(ownDelay) s entre páginas", value: $ownDelay, in: 1...60)
                    Stepper(ownEvery == 0 ? "Sem pausa adicional" : "Pausa a cada \(ownEvery) páginas", value: $ownEvery, in: 0...50)
                    Stepper("Pausa de \(ownPause) s", value: $ownPause, in: 0...600, step: 5)
                    Stepper("Intervalo local: \(ownGap) min", value: $ownGap, in: 0...1440, step: 15)
                    Toggle("Aplicar intervalo também a checks manuais", isOn: $manualGap)
                } header: { Text("Análise da minha conta") }
                .listRowBackground(Theme.surface)

                Section {
                    Stepper("\(watchDelay) s entre páginas", value: $watchDelay, in: 1...60)
                    Stepper(watchEvery == 0 ? "Sem pausa adicional" : "Pausa a cada \(watchEvery) páginas", value: $watchEvery, in: 0...50)
                    Stepper("Pausa de \(watchPause) s", value: $watchPause, in: 0...600, step: 5)
                } header: { Text("Watchlist — ritmo independente") } footer: {
                    Text("A frequência é definida em cada perfil. O intervalo local da tua análise não a bloqueia. Os pedidos continuam a ser feitos um de cada vez.")
                }
                .listRowBackground(Theme.surface)

                Section {
                    Button(saving ? "A aplicar…" : "Aplicar e guardar") {
                        Task {
                            saving = true; defer { saving = false }
                            do { try await model.applyPacing(); message = model.sessionAvailable ? "Definições aplicadas." : "Guardado. Será aplicado quando a sessão estiver disponível." }
                            catch { message = error.localizedDescription }
                        }
                    }
                    .disabled(saving)
                    if let message { Text(message).font(.footnote).foregroundStyle(Theme.ink2) }
                } footer: {
                    Text("Preferências locais, não limites garantidos pelo Instagram. Uma resposta 429 interrompe a fila e mantém a pausa de proteção.")
                }
                .listRowBackground(Theme.surface)
            }
            .fcForm()
            .navigationTitle("Ritmo e limites")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fechar") { dismiss() } } }
            .onDisappear { Task { try? await model.applyPacing() } }
        }
        .tint(Theme.signalInk)
    }

    private func profileRow(_ title: String, detail: String, selected: Bool, apply: @escaping () -> Void) -> some View {
        Button(action: apply) {
            HStack(spacing: 12) {
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .font(.title3).foregroundStyle(selected ? Theme.signalInk : Theme.ink3)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                    Text(detail).font(.footnote).foregroundStyle(Theme.ink2)
                }
            }
        }
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

// MARK: - Likes

private struct MediaLikePerson: Identifiable {
    let id: String
    let username: String
    let fullName: String
    let photoURL: String
    init(_ value: [String: Any]) { id = value["id"] as? String ?? ""; username = value["username"] as? String ?? ""; fullName = value["fullName"] as? String ?? ""; photoURL = value["photoURL"] as? String ?? "" }
}
private struct MediaLikeChange: Identifiable {
    let id: String
    let removed: Bool
    let person: MediaLikePerson
    init(_ value: [String: Any]) { id = value["id"] as? String ?? ""; removed = value["type"] as? String == "removed"; person = MediaLikePerson(value["user"] as? [String: Any] ?? [:]) }
}
private struct MediaLikePost: Identifiable {
    let photoURL: String
    let id: String
    let code: String
    let caption: String
    let complete: Bool
    let people: [MediaLikePerson]
    let changes: [MediaLikeChange]
    init(_ value: [String: Any]) {
        photoURL = value["photoURL"] as? String ?? ""; id = value["id"] as? String ?? ""; code = value["code"] as? String ?? ""; caption = value["caption"] as? String ?? ""
        complete = value["complete"] as? Bool ?? false
        people = (value["users"] as? [[String: Any]] ?? []).map(MediaLikePerson.init)
        changes = (value["events"] as? [[String: Any]] ?? []).map(MediaLikeChange.init)
    }
}
private struct MediaLikesView: View {
    let model: AppModel
    let targetID: String
    let title: String
    @Environment(\.dismiss) private var dismiss
    @State private var posts: [MediaLikePost] = []
    @State private var loading = false
    @State private var error = ""
    @State private var amount = 3
    @State private var query = ""
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Gostos nas publicações").font(.title2.weight(.bold)).foregroundStyle(Theme.ink)
                        Text("Os perfis disponíveis nas publicações recentes. Um gosto removido só aparece depois de duas listas completas; a data é a da observação, não a do gosto.")
                            .font(.footnote).foregroundStyle(Theme.ink2)
                    }
                    HStack(spacing: 10) {
                        Picker("Publicações", selection: $amount) { ForEach([1, 3, 5, 8], id: \.self) { Text("\($0) publicações").tag($0) } }
                            .disabled(loading)
                        Spacer()
                        Button { Task { await load(refresh: true) } } label: { Label(loading ? "A consultar…" : "Atualizar", systemImage: "arrow.clockwise") }
                            .buttonStyle(ProminentButtonStyle()).disabled(loading || model.checkIsRunning || !model.sessionAvailable)
                    }
                    if !error.isEmpty { InlineNotice(text: error) }
                    if !posts.isEmpty { SearchField(text: $query, prompt: "Pesquisar quem gostou") }
                    if posts.isEmpty && !loading {
                        EmptyState(icon: "heart", title: "Ainda sem observações", message: "Atualiza para criar a primeira referência das publicações acessíveis nesta sessão.")
                            .surface(padding: 0)
                    }
                    ForEach(posts) { post in
                        VStack(alignment: .leading, spacing: 12) {
                            if let imageURL = URL(string: post.photoURL), imageURL.scheme == "https" {
                                AsyncImage(url: imageURL) { image in image.resizable().scaledToFill() } placeholder: { Theme.sunken }
                                    .frame(height: 220).frame(maxWidth: .infinity).clipped().clipShape(.rect(cornerRadius: 14, style: .continuous))
                            }
                            HStack {
                                Label(post.complete ? "Lista completa · \(post.people.count)" : "Lista parcial · \(post.people.count)", systemImage: post.complete ? "checkmark.circle.fill" : "circle.lefthalf.filled")
                                    .font(.footnote.weight(.semibold)).foregroundStyle(post.complete ? Theme.signalInk : Theme.caution)
                                Spacer()
                                if let url = URL(string: "https://www.instagram.com/p/" + post.code + "/"), !post.code.isEmpty {
                                    Link("Abrir", destination: url).font(.footnote.weight(.semibold))
                                }
                            }
                            if !post.caption.isEmpty { Text(post.caption).font(.subheadline).foregroundStyle(Theme.ink).lineLimit(3) }
                            if !post.changes.isEmpty {
                                DisclosureGroup("Mudanças observadas (\(post.changes.count))") {
                                    ForEach(post.changes) { change in
                                        VStack(alignment: .leading, spacing: 5) {
                                            Text(change.removed ? "Já não aparece na lista completa" : "Novo na lista de gostos").font(.caption.weight(.semibold))
                                                .foregroundStyle(change.removed ? Theme.loss : Theme.signalInk)
                                            person(change.person)
                                        }
                                    }
                                }
                                .font(.subheadline)
                            }
                            DisclosureGroup("Quem gostou") {
                                LazyVStack(spacing: 4) {
                                    ForEach(post.people.filter { query.isEmpty || "\($0.username) \($0.fullName)".localizedCaseInsensitiveContains(query) }) { person($0) }
                                }
                            }
                            .font(.subheadline)
                        }
                        .surface()
                    }
                }
                .padding(20)
            }
            .background(Theme.canvas).navigationTitle(title).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fechar") { dismiss() } } }
            .task(id: model.accountId) { posts = []; await load(refresh: false) }
        }
        .tint(Theme.signalInk)
    }
    private func person(_ person: MediaLikePerson) -> some View {
        HStack(spacing: 10) {
            ProfileAvatar(photoURL: person.photoURL, size: 32, name: person.username)
            VStack(alignment: .leading) {
                Text("@" + person.username).font(.subheadline).foregroundStyle(Theme.ink)
                if !person.fullName.isEmpty { Text(person.fullName).font(.caption).foregroundStyle(Theme.ink2) }
            }
            Spacer()
        }
        .padding(.vertical, 4)
    }
    private func load(refresh: Bool) async {
        let owner = model.accountId
        loading = true; error = ""; defer { loading = false }
        do {
            let result = try await model.tools.request("likes", ["targetId": targetID, "operation": refresh ? "refresh" : "get", "amount": amount])
            guard model.accountId == owner, result["accountId"] as? String == owner else { return }
            posts = (result["posts"] as? [[String: Any]] ?? []).map(MediaLikePost.init)
        } catch { self.error = error.localizedDescription }
    }
}
