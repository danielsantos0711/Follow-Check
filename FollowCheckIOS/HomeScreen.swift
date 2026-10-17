import SwiftUI

/// Home answers three questions in order: what does my circle look like,
/// what changed since the last check, and can I check again now.
struct HomeScreen: View {
    let model: AppModel

    var body: some View {
        NavigationStack {
            ScreenScroll(spacing: 22, refresh: model.refreshState) {
                header
                if model.accountId.isEmpty && !model.sessionAvailable {
                    ConnectCard(model: model)
                } else {
                    if let snapshot = model.snapshot { circleCard(snapshot) } else { firstCheckCard }
                    CheckCard(model: model)
                    changes
                    watchlistSummary
                }
            }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            BrandMark(size: 30)
            Text("FollowCheck").font(.headline).foregroundStyle(Theme.ink)
            Spacer()
            if !model.username.isEmpty {
                Button { model.select(.settings) } label: {
                    ProfileAvatar(photoURL: model.profilePhotoURL, size: 38, name: model.username)
                }
                .buttonStyle(PressStyle())
                .accessibilityLabel("Conta @\(model.username)")
            }
        }
        .padding(.top, 4)
    }

    // MARK: Circle

    private func headline(_ s: AppModel.Snapshot) -> String {
        if s.nonFollowers == 0 { return "Toda a gente que segues segue-te de volta." }
        return s.nonFollowers == 1 ? "1 conta que segues não te segue de volta." : "\(s.nonFollowers.formatted()) contas que segues não te seguem de volta."
    }

    private func circleCard(_ s: AppModel.Snapshot) -> some View {
        let fans = max(0, s.followers - s.mutuals)
        return VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
                Eyebrow(text: model.username.isEmpty ? "O teu círculo" : "@" + model.username)
                Text(headline(s)).font(.title2.weight(.bold)).foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            CircleVenn(followers: s.followers, following: s.following, mutuals: s.mutuals)
                .frame(height: 190)
                .padding(.vertical, 4)
            HStack(spacing: 0) {
                axis("Seguem-te", s.followers, alignment: .leading)
                axis("Segues", s.following, alignment: .trailing)
            }
            VStack(spacing: 0) {
                lens("Não me seguem", count: s.nonFollowers, color: Theme.chartOut, caption: "Segues, não te seguem")
                Divider().overlay(Theme.line).padding(.leading, 34)
                lens("Eu não sigo", count: fans, color: Theme.chartIn, caption: "Seguem-te, não segues")
                Divider().overlay(Theme.line).padding(.leading, 34)
                lens("Mútuos", count: s.mutuals, color: Theme.chartMutual, caption: "Nos dois sentidos")
            }
            .background(Theme.raised, in: .rect(cornerRadius: 16, style: .continuous))
        }
        .surface(padding: 18, radius: 26)
    }

    private func axis(_ title: String, _ value: Int, alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 2) {
            Text(value.formatted()).font(.system(.title3, design: .rounded).weight(.semibold)).monospacedDigit().foregroundStyle(Theme.ink)
            Text(title).font(.caption).foregroundStyle(Theme.ink2)
        }
        .frame(maxWidth: .infinity, alignment: alignment == .leading ? .leading : .trailing)
        .accessibilityElement(children: .combine)
    }

    private func lens(_ filter: String, count: Int, color: Color, caption: String) -> some View {
        Button {
            model.requestedRelationFilter = filter
            model.select(.people)
        } label: {
            HStack(spacing: 12) {
                Circle().fill(color).frame(width: 10, height: 10).padding(.leading, 2)
                VStack(alignment: .leading, spacing: 1) {
                    Text(RelationFilter.label(filter)).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                    Text(caption).font(.caption).foregroundStyle(Theme.ink2)
                }
                Spacer()
                Text(count.formatted()).font(.system(.body, design: .rounded).weight(.semibold)).monospacedDigit().foregroundStyle(Theme.ink)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3)
            }
            .padding(.horizontal, 12).frame(minHeight: 54)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Abre a lista em Pessoas")
    }

    private var firstCheckCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Eyebrow(text: model.username.isEmpty ? "O teu círculo" : "@" + model.username)
            Text("Faz o primeiro check para veres quem te segue de volta.").font(.title2.weight(.bold)).foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: -18) {
                Circle().fill(Theme.chartIn.opacity(0.2)).overlay(Circle().strokeBorder(Theme.ink.opacity(0.25), style: StrokeStyle(lineWidth: 2, dash: [5, 5])))
                Circle().fill(Theme.chartOut.opacity(0.2)).overlay(Circle().strokeBorder(Theme.ink.opacity(0.25), style: StrokeStyle(lineWidth: 2, dash: [5, 5])))
            }
            .frame(height: 120).frame(maxWidth: .infinity)
            .accessibilityHidden(true)
            Text("O check lê as tuas listas de seguidores e de quem segues, devagar, e guarda tudo só neste iPhone.")
                .font(.footnote).foregroundStyle(Theme.ink2)
        }
        .surface(padding: 18, radius: 26)
    }

    // MARK: Changes

    @ViewBuilder private var changes: some View {
        let events = model.latestAccountEvents
        if model.snapshot != nil {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader(title: "Desde o último check", action: events.isEmpty ? nil : "Ver tudo") { model.select(.activity) }
                if events.isEmpty {
                    Text("Sem entradas nem saídas no último check.").font(.subheadline).foregroundStyle(Theme.ink2)
                        .frame(maxWidth: .infinity, alignment: .leading).surface(padding: 16, radius: 18)
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(events.prefix(4).enumerated()), id: \.element.id) { index, event in
                            AccountEventRow(event: event).padding(.horizontal, 14).padding(.vertical, 10)
                            if index < min(events.count, 4) - 1 { Divider().overlay(Theme.line).padding(.leading, 66) }
                        }
                    }
                    .surface(padding: 0, radius: 20)
                }
            }
        }
    }

    @ViewBuilder private var watchlistSummary: some View {
        if !model.targets.isEmpty {
            let latest = model.targets.map { target in
                model.watchEvents.filter { $0.targetId == target.id && $0.isWatchChange && abs($0.date.timeIntervalSince(target.lastSuccess ?? .distantPast)) < 1 }.count
            }.reduce(0, +)
            Button { model.select(.watchlist) } label: {
                HStack(spacing: 14) {
                    HStack(spacing: -10) {
                        ForEach(model.targets.prefix(3)) { target in
                            ProfileAvatar(photoURL: target.photoURL, size: 36, name: target.username)
                                .overlay(Circle().strokeBorder(Theme.surface, lineWidth: 2))
                        }
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Watchlist").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                        Text("\(model.targets.count) \(model.targets.count == 1 ? "perfil" : "perfis") · \(latest == 0 ? "sem mudanças" : "\(latest) \(latest == 1 ? "mudança" : "mudanças")") no último check")
                            .font(.caption).foregroundStyle(Theme.ink2)
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3)
                }
                .surface(padding: 14, radius: 20)
            }
            .buttonStyle(PressStyle())
        }
    }
}

// MARK: - Check card

/// The single place to start, follow and stop a check of your own account.
struct CheckCard: View {
    let model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if model.ownCheckRunning || (model.isScanning && model.activeCheckScope != "watchlist") {
                running
            } else if let until = model.activeCooldown, model.safetyBlocked {
                cooldown(until)
            } else if model.safetyBlocked {
                blocked
            } else {
                ready
            }
        }
        .surface(padding: 16, radius: 22)
        .animation(.easeInOut(duration: 0.25), value: model.isScanning)
    }

    private var lastCheck: String {
        model.lastCompletedCheck.map { "Último check " + RelativeTime.short($0) } ?? "Ainda sem check completo"
    }

    private var ready: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(model.paused ? "Checks em pausa" : "Pronto para verificar").font(.headline).foregroundStyle(Theme.ink)
                    Text(lastCheck).font(.footnote).foregroundStyle(Theme.ink2)
                }
                Spacer()
                if model.watchCheckRunning { StatusPill(text: "Watchlist a correr", tone: .reach) }
            }
            Button(action: model.scan) {
                Label(model.snapshot == nil ? "Fazer o primeiro check" : "Verificar agora", systemImage: "arrow.triangle.2.circlepath")
            }
            .buttonStyle(SignalButtonStyle())
            .disabled(!model.canScan)
            if model.paused {
                Button("Retomar checks") { model.setPaused(false) }.buttonStyle(QuietButtonStyle(fill: true))
            } else if !model.sessionAvailable {
                Text("A recuperar a sessão do Instagram…").font(.caption).foregroundStyle(Theme.ink2)
            }
        }
    }

    private var running: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                ProgressView().tint(Theme.signalInk)
                Text(model.statusText).font(.headline).foregroundStyle(Theme.ink).lineLimit(2)
                Spacer()
                if let progress = model.progress {
                    Text(progress, format: .percent.precision(.fractionLength(0))).font(.subheadline.weight(.semibold)).monospacedDigit().foregroundStyle(Theme.signalInk)
                }
            }
            ProgressTrack(value: model.progress)
            if !model.detailText.isEmpty { Text(model.detailText).font(.footnote).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true) }
            HStack {
                Text("O resultado anterior mantém-se até ao fim.").font(.caption).foregroundStyle(Theme.ink3)
                Spacer()
                Button("Parar", role: .destructive, action: model.cancelCurrentScan).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.loss)
            }
        }
    }

    private func cooldown(_ until: Date) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: "hourglass").font(.system(size: 18, weight: .semibold)).foregroundStyle(Theme.caution)
                    .frame(width: 40, height: 40).background(Theme.caution.opacity(0.14), in: .circle)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Pausa de proteção").font(.headline).foregroundStyle(Theme.ink)
                    HStack(spacing: 4) {
                        Text("Termina")
                        Text(until, style: .relative).monospacedDigit()
                    }
                    .font(.footnote).foregroundStyle(Theme.ink2)
                }
            }
            Text(SafetyCopy.explanation(model.safetyReason)).font(.footnote).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
            Text(lastCheck + ". Os dados guardados continuam disponíveis.").font(.caption).foregroundStyle(Theme.ink3)
        }
    }

    private var blocked: some View {
        VStack(alignment: .leading, spacing: 12) {
            InlineNotice(text: model.detailText.isEmpty ? "O Instagram pediu uma confirmação da conta." : model.detailText)
            HStack(spacing: 10) {
                Button("Abrir Instagram", action: model.openInstagram).buttonStyle(QuietButtonStyle(fill: true))
                Button("Já confirmei", action: model.confirmSession).buttonStyle(ProminentButtonStyle())
                    .disabled(model.confirmingSession)
            }
        }
    }
}

/// Plain-language reasons for a protection pause.
enum SafetyCopy {
    static func explanation(_ reason: String) -> String {
        switch reason {
        case "rate_limited", "http_429":
            return "O Instagram pediu para abrandar. O FollowCheck espera pelo menos uma hora antes de voltar a ler listas, para não agravar a restrição."
        case "soft_throttle":
            return "O Instagram sinalizou atividade invulgar. O check parou a tempo e a referência anterior foi preservada. Esperar evita um bloqueio mais longo."
        case "challenge_required", "checkpoint_required":
            return "O Instagram pediu uma verificação. Abre o Instagram, confirma a conta e volta aqui."
        default:
            return "As verificações estão em pausa para proteger a conta."
        }
    }
}

struct ProgressTrack: View {
    let value: Double?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.sunken)
                if let value {
                    Capsule().fill(Theme.signal).frame(width: max(8, proxy.size.width * min(1, max(0, value))))
                        .animation(reduceMotion ? nil : .easeInOut(duration: 0.5), value: value)
                } else {
                    TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { context in
                        let t = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.6) / 1.6
                        Capsule().fill(Theme.signal).frame(width: proxy.size.width * 0.3)
                            .offset(x: (proxy.size.width * 1.3) * t - proxy.size.width * 0.3)
                    }
                    .clipShape(Capsule())
                }
            }
        }
        .frame(height: 8)
        .accessibilityElement()
        .accessibilityLabel("Progresso")
        .accessibilityValue(value.map { "\(Int($0 * 100)) por cento" } ?? "em curso")
    }
}

// MARK: - Connect

struct ConnectCard: View {
    let model: AppModel
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            BrandMark(size: 64)
            VStack(alignment: .leading, spacing: 8) {
                Text("Vê quem te segue de volta.").font(.largeTitle.weight(.bold)).foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Entra no Instagram dentro da app. A sessão e os resultados ficam só neste iPhone; nada passa por servidores do FollowCheck.")
                    .font(.subheadline).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
            }
            VStack(alignment: .leading, spacing: 12) {
                promise("lock", "A palavra-passe é escrita na página do Instagram, não na app.")
                promise("tortoise", "As listas são lidas devagar, uma página de cada vez.")
                promise("hand.raised", "Nenhuma ação é feita sem a tua revisão.")
            }
            Button("Entrar no Instagram", action: model.openInstagram).buttonStyle(SignalButtonStyle())
        }
        .padding(.top, 20)
    }
    private func promise(_ icon: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.signalInk)
                .frame(width: 30, height: 30).background(Theme.signal.opacity(0.16), in: .circle)
            Text(text).font(.subheadline).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - Event rows

struct AccountEventRow: View {
    let event: AppModel.WatchEvent
    var showDate = false
    private var tone: Tone {
        switch event.type {
        case "new_follower": return .gain
        case "unfollow_confirmed", "lost_follower": return .loss
        case "account_unavailable": return .caution
        case "account_reactivated": return .reach
        default: return .neutral
        }
    }
    private var icon: String {
        switch event.type {
        case "new_follower": return "arrow.down.left"
        case "unfollow_confirmed", "lost_follower": return "arrow.up.right"
        case "account_unavailable": return "questionmark"
        case "account_reactivated": return "arrow.uturn.left"
        default: return "circle"
        }
    }
    var body: some View {
        HStack(spacing: 12) {
            ProfileAvatar(photoURL: event.photoURL, size: 42, name: event.username)
                .overlay(alignment: .bottomTrailing) {
                    Image(systemName: icon).font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.surface)
                        .frame(width: 18, height: 18).background(tone.color, in: .circle)
                        .overlay(Circle().strokeBorder(Theme.surface, lineWidth: 2))
                        .offset(x: 3, y: 3)
                }
            VStack(alignment: .leading, spacing: 2) {
                Text(event.username.isEmpty ? event.title : "@" + event.username).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                Text(event.title + (showDate ? " · " + RelativeTime.short(event.date) : "")).font(.footnote).foregroundStyle(tone == .neutral ? Theme.ink2 : tone.color).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}
