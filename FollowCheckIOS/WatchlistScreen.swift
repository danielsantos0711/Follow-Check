import SwiftUI

/// Watchlist follows other accounts. Each list is validated on its own: when Instagram
/// serves a shuffled, partial list, that list is not compared and the screen says so,
/// while the other list keeps reporting verified changes.
struct WatchlistScreen: View {
    let model: AppModel
    @State private var adding = false
    @State private var path: [String] = []

    var body: some View {
        NavigationStack(path: $path) {
            ScreenScroll(spacing: 16, refresh: model.refreshState) {
                ScreenHeader(title: "Watchlist", subtitle: "O que muda nas contas que escolhes.") {
                    IconButton(systemName: "plus", label: "Adicionar perfil") { adding = true }
                        .disabled(!model.sessionAvailable || model.watchlistBusy)
                }
                if model.watchCheckRunning { WatchRunningCard(model: model) }
                if let until = model.activeCooldown, model.watchlistBlocked {
                    InlineNotice(text: "Checks da Watchlist em pausa até \(until.formatted(date: .omitted, time: .shortened)). " + SafetyCopy.explanation(model.safetyReason), icon: "hourglass")
                }
                if model.targets.isEmpty {
                    EmptyState(icon: "eye", title: "Escolhe quem acompanhar",
                               message: "Adiciona uma conta pública ou que segues. O primeiro check cria a referência; os seguintes mostram quem entrou e quem saiu.",
                               actionTitle: "Adicionar perfil") { adding = true }
                        .surface(padding: 0)
                } else {
                    ForEach(model.targets) { target in
                        Button { path.append(target.id) } label: { TargetCard(model: model, target: target) }
                            .buttonStyle(PressStyle())
                    }
                    schedule
                }
            }
            .navigationDestination(for: String.self) { id in TargetDetail(model: model, targetID: id) }
        }
        .sheet(isPresented: $adding) { AddTargetSheet(model: model) }
        .onAppear {
            #if DEBUG
            if PreviewFlags.has("--preview-target"), let first = model.targets.first { path = [first.id] }
            #endif
        }
    }

    private var schedule: some View {
        Toggle(isOn: Binding(get: { model.schedulerEnabled }, set: model.setScheduler)) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Checks automáticos").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                Text("Só com a app aberta, no intervalo de cada perfil, um de cada vez.").font(.caption).foregroundStyle(Theme.ink2)
            }
        }
        .tint(Theme.signalInk)
        .disabled(!model.sessionAvailable)
        .surface(padding: 14, radius: 18)
    }
}

private struct WatchRunningCard: View {
    let model: AppModel
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                ProgressView().tint(Theme.signalInk)
                Text(model.watchStatus).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(2)
                Spacer()
                Button("Parar", role: .destructive, action: model.cancelCurrentScan).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.loss)
            }
            ProgressTrack(value: model.watchProgress)
            if !model.watchDetail.isEmpty { Text(model.watchDetail).font(.footnote).foregroundStyle(Theme.ink2) }
        }
        .surface(padding: 14, radius: 18, fill: Theme.signal.opacity(0.1))
    }
}

// MARK: - State

/// What we can honestly say about one list of a watched profile.
enum ListHealth {
    case pending, verified(Int), partial(observed: Int, reported: Int), off
    init(baselineReady: Bool, count: Int, partial: AppModel.PartialList?, monitored: Bool = true) {
        if !monitored || partial?.skipped == true { self = .off }
        else if let partial { self = .partial(observed: partial.observed, reported: partial.reported) }
        else if baselineReady { self = .verified(count) }
        else { self = .pending }
    }
    var compared: Bool { if case .verified = self { return true } else { return false } }
}

extension AppModel.WatchTarget {
    var followersMonitored: Bool { lists != "following" }
    var followersHealth: ListHealth { ListHealth(baselineReady: baselineReady, count: followers, partial: partialFollowers, monitored: followersMonitored) }
    var followingHealth: ListHealth { ListHealth(baselineReady: baselineReady, count: following, partial: partialFollowing) }
    var hasPartialList: Bool { (partialFollowers.map { !$0.skipped } ?? false) && followersMonitored || partialFollowing != nil }
    var statusLine: (String, Tone) {
        if running { return ("A verificar", .signal) }
        if !error.isEmpty { return ("Último check incompleto", .caution) }
        if !enabled { return ("Em pausa", .neutral) }
        if !baselineReady { return ("A criar referência", .reach) }
        if partialFollowers != nil && partialFollowing != nil && followersMonitored { return ("Listas parciais", .caution) }
        if hasPartialList { return ("Comparação parcial", .caution) }
        return ("A comparar", .gain)
    }
}

struct TargetCard: View {
    let model: AppModel
    let target: AppModel.WatchTarget
    private var latest: [AppModel.WatchEvent] {
        model.watchEvents.filter { $0.targetId == target.id && $0.isWatchChange && abs($0.date.timeIntervalSince(target.lastSuccess ?? .distantPast)) < 1 }
    }
    var body: some View {
        let state = target.statusLine
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                ProfileAvatar(photoURL: target.photoURL, size: 48, name: target.username)
                VStack(alignment: .leading, spacing: 4) {
                    Text("@" + target.username).font(.headline).foregroundStyle(Theme.ink).lineLimit(1)
                    StatusPill(text: state.0, tone: state.1)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3)
            }
            HStack(spacing: 8) {
                ListTile(title: "Seguidores", health: target.followersHealth)
                ListTile(title: "A seguir", health: target.followingHealth)
            }
            .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 6) {
                if target.baselineReady && !latest.isEmpty {
                    Text("\(latest.count) \(latest.count == 1 ? "mudança" : "mudanças")").foregroundStyle(Theme.signalInk).fontWeight(.semibold)
                    Text("·").foregroundStyle(Theme.ink3)
                }
                Text(target.lastSuccess.map { "Verificado " + RelativeTime.short($0) } ?? "Ainda sem check concluído").foregroundStyle(Theme.ink2)
            }
            .font(.footnote)
        }
        .surface(padding: 16, radius: 22)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Abre o detalhe")
    }
}

struct ListTile: View {
    let title: String
    let health: ListHealth
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(Theme.ink2)
            switch health {
            case .pending:
                Text("—").font(.system(.title3, design: .rounded).weight(.semibold)).foregroundStyle(Theme.ink3)
                Text("Por recolher").font(.caption2).foregroundStyle(Theme.ink3)
            case .verified(let count):
                Text(count.formatted()).font(.system(.title3, design: .rounded).weight(.semibold)).monospacedDigit().foregroundStyle(Theme.ink)
                Label("Verificada", systemImage: "checkmark.seal.fill").font(.caption2.weight(.semibold)).foregroundStyle(Theme.signalInk)
            case .partial(let observed, let reported):
                HStack(alignment: .firstTextBaseline, spacing: 3) {
                    Text(observed.formatted()).font(.system(.title3, design: .rounded).weight(.semibold)).monospacedDigit().foregroundStyle(Theme.ink)
                    Text("/ \(reported.formatted())").font(.caption.weight(.medium)).monospacedDigit().foregroundStyle(Theme.ink3)
                }
                Label("Parcial", systemImage: "circle.lefthalf.filled").font(.caption2.weight(.semibold)).foregroundStyle(Theme.caution)
            case .off:
                Text("—").font(.system(.title3, design: .rounded).weight(.semibold)).foregroundStyle(Theme.ink3)
                Label("Não monitorizada", systemImage: "eye.slash").font(.caption2.weight(.semibold)).foregroundStyle(Theme.ink3)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(12)
        .background(Theme.raised, in: .rect(cornerRadius: 14, style: .continuous))
    }
}

// MARK: - Detail

struct TargetDetail: View {
    let model: AppModel
    let targetID: String
    @Environment(\.dismiss) private var dismiss
    @State private var tab = "changes"
    @State private var query = ""
    @State private var removing = false
    private let intervals = [360, 720, 1440, 2880, 10080]
    private var target: AppModel.WatchTarget? { model.targets.first { $0.id == targetID } }

    var body: some View {
        if let target {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    hero(target)
                    if target.hasPartialList { partialExplainer(target) }
                    if !target.error.isEmpty { InlineNotice(text: target.error) }
                    Button { model.watchlist("run", args: ["targetId": target.id]) } label: {
                        Label(model.activeCheckScope == "account" ? "Verificar a seguir ao teu check" : "Verificar agora", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .buttonStyle(SignalButtonStyle())
                    .disabled(!model.canScanWatchlist || model.watchlistBusy || target.running)
                    Picker("Vista", selection: $tab) {
                        Text("Mudanças").tag("changes")
                        Text("Seguidores").tag("followers")
                        Text("A seguir").tag("following")
                        Text("Gostos").tag("likes")
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: tab) { _, value in if value == "followers" || value == "following" { model.loadWatchlistList(target.id, relation: value) } }
                    switch tab {
                    case "followers", "following": savedList(target)
                    case "likes": MediaLikesPanel(model: model, targetID: target.id)
                    default: WatchChanges(events: model.watchEvents.filter { $0.targetId == target.id })
                    }
                    settings(target)
                }
                .padding(.horizontal, 20).padding(.vertical, 12)
                .frame(maxWidth: 680).frame(maxWidth: .infinity)
            }
            .background(Theme.canvas)
            .navigationTitle("@" + target.username).navigationBarTitleDisplayMode(.inline)
            .confirmationDialog("Remover @\(target.username) e o histórico da Watchlist?", isPresented: $removing, titleVisibility: .visible) {
                Button("Remover", role: .destructive) { model.watchlist("remove", args: ["targetId": target.id]); dismiss() }
            }
        } else {
            EmptyState(icon: "eye.slash", title: "Perfil removido", message: "Este perfil já não está na Watchlist.")
        }
    }

    private func hero(_ target: AppModel.WatchTarget) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                ProfileAvatar(photoURL: target.photoURL, size: 64, name: target.username)
                VStack(alignment: .leading, spacing: 4) {
                    Text("@" + target.username).font(.title3.weight(.bold)).foregroundStyle(Theme.ink)
                    if !target.fullName.isEmpty { Text(target.fullName).font(.subheadline).foregroundStyle(Theme.ink2) }
                    StatusPill(text: target.statusLine.0, tone: target.statusLine.1)
                }
            }
            HStack(spacing: 8) {
                ListTile(title: "Seguidores", health: target.followersHealth)
                ListTile(title: "A seguir", health: target.followingHealth)
            }
            .fixedSize(horizontal: false, vertical: true)
            Text((target.lastSuccess.map { "Último check " + RelativeTime.short($0) } ?? "Sem check concluído") + " · a cada " + RelativeTime.interval(target.intervalMinutes))
                .font(.footnote).foregroundStyle(Theme.ink2)
        }
        .surface(padding: 16, radius: 22)
    }

    private func partialExplainer(_ target: AppModel.WatchTarget) -> some View {
        let lists = [target.partialFollowers.flatMap { $0.skipped ? nil : ("seguidores", $0) }, target.partialFollowing.map { ("a seguir", $0) }].compactMap { $0 }
        let names = lists.map { $0.0 }.joined(separator: " e ")
        let compared = [target.partialFollowers == nil ? "seguidores" : nil, target.partialFollowing == nil ? "a seguir" : nil].compactMap { $0 }
        let interrupted = lists.contains { $0.1.interrupted }
        return VStack(alignment: .leading, spacing: 8) {
            Label("Porque é que a lista está incompleta", systemImage: "circle.lefthalf.filled").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
            Text(interrupted
                 ? "O Instagram pediu uma pausa enquanto o FollowCheck lia a lista de \(names). Esta lista não foi comparada; a última referência completa mantém-se e o próximo check volta a lê-la."
                 : "O Instagram devolveu a lista de \(names) baralhada: as páginas começaram a repetir perfis. Continuar só gastava pedidos e aproximava a conta do limite, por isso o FollowCheck parou essa lista (\(lists.map { "\($0.1.observed.formatted()) de \($0.1.reported.formatted())" }.joined(separator: "; ")) vistos). Não foi comparada: a última referência completa mantém-se e nada é inventado.")
                .font(.footnote).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
            if !compared.isEmpty {
                Text("A lista \(compared.joined(separator: " e ")) foi verificada e as mudanças dela são reais.").font(.footnote.weight(.medium)).foregroundStyle(Theme.signalInk)
            }
            if target.partialFollowers != nil && target.followersMonitored {
                Text("O Instagram limita muito mais a leitura dos seguidores de outras contas do que a lista de quem elas seguem. Para checks fiáveis, monitoriza só quem esta conta segue.")
                    .font(.footnote).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                Button("Monitorizar só quem segue") { model.watchlist("update", args: ["targetId": target.id, "lists": "following"]) }
                    .buttonStyle(QuietButtonStyle(fill: true))
            }
        }
        .padding(14)
        .background(Theme.caution.opacity(0.1), in: .rect(cornerRadius: 16, style: .continuous))
    }

    private func savedList(_ target: AppModel.WatchTarget) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SearchField(text: $query, prompt: "Pesquisar nesta lista")
            let people = model.watchlistAccounts.filter { query.isEmpty || "\($0.username) \($0.name)".localizedCaseInsensitiveContains(query) }
            if people.isEmpty && !model.watchlistBusy {
                EmptyState(icon: "list.bullet", title: target.baselineReady ? "Lista vazia" : "Lista por recolher", message: target.baselineReady ? "Nenhum perfil corresponde." : "O primeiro check guarda esta lista.")
                    .surface(padding: 0)
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(people) { person in
                        HStack(spacing: 12) {
                            ProfileAvatar(photoURL: person.photoURL, size: 40, name: person.username)
                            VStack(alignment: .leading, spacing: 1) {
                                Text("@" + person.username).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                                if !person.name.isEmpty { Text(person.name).font(.caption).foregroundStyle(Theme.ink2) }
                            }
                            Spacer()
                        }
                        .padding(.horizontal, 14).padding(.vertical, 9)
                        Divider().overlay(Theme.line).padding(.leading, 66)
                    }
                    if model.watchlistBusy { ProgressView().padding().frame(maxWidth: .infinity) }
                    if model.watchlistListMore {
                        Button("Carregar mais") { model.loadWatchlistList(target.id, relation: tab, more: true) }
                            .buttonStyle(QuietButtonStyle()).disabled(model.watchlistBusy).padding().frame(maxWidth: .infinity)
                    }
                }
                .surface(padding: 0, radius: 20)
            }
            Text("Lista guardada no último check completo desta lista.").font(.caption).foregroundStyle(Theme.ink3)
        }
    }

    private func settings(_ target: AppModel.WatchTarget) -> some View {
        VStack(spacing: 0) {
            Menu {
                Picker("Intervalo", selection: Binding(get: { target.intervalMinutes }, set: { model.watchlist("update", args: ["targetId": target.id, "intervalMinutes": $0]) })) {
                    ForEach(Array(Set(intervals + [target.intervalMinutes])).sorted(), id: \.self) { Text("A cada " + RelativeTime.interval($0)).tag($0) }
                }
            } label: {
                row("clock", "Intervalo mínimo", value: RelativeTime.interval(target.intervalMinutes))
            }
            Divider().overlay(Theme.line).padding(.leading, 50)
            Toggle(isOn: Binding(get: { target.followersMonitored }, set: { model.watchlist("update", args: ["targetId": target.id, "lists": $0 ? "both" : "following"]) })) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 12) { Image(systemName: "person.2").frame(width: 24); Text("Monitorizar também seguidores") }
                        .font(.subheadline.weight(.medium)).foregroundStyle(Theme.ink)
                    Text("Mais pedidos; o Instagram limita esta lista com frequência.").font(.caption).foregroundStyle(Theme.ink2).padding(.leading, 36)
                }
            }
            .tint(Theme.signalInk).padding(.horizontal, 14).padding(.vertical, 10)
            Divider().overlay(Theme.line).padding(.leading, 50)
            Button { model.watchlist("update", args: ["targetId": target.id, "enabled": !target.enabled]) } label: {
                row(target.enabled ? "pause.circle" : "play.circle", target.enabled ? "Pausar checks automáticos" : "Retomar checks automáticos")
            }
            Divider().overlay(Theme.line).padding(.leading, 50)
            Button { model.openProfile(target.username) } label: { row("arrow.up.forward.app", "Ver no Instagram") }
            Divider().overlay(Theme.line).padding(.leading, 50)
            Button { removing = true } label: { row("trash", "Remover da Watchlist", tint: Theme.loss) }
        }
        .buttonStyle(.plain)
        .disabled(model.watchlistBusy)
        .surface(padding: 0, radius: 20)
    }

    private func row(_ icon: String, _ title: String, value: String? = nil, tint: Color = Theme.ink) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).frame(width: 24)
            Text(title)
            Spacer()
            if let value { Text(value).foregroundStyle(Theme.ink2) }
        }
        .font(.subheadline.weight(.medium)).foregroundStyle(tint)
        .padding(.horizontal, 14).frame(minHeight: 50).contentShape(Rectangle())
    }
}

// MARK: - Changes

private let watchChangeKinds: [(id: String, title: String)] = [
    ("watch_new_follower", "Novos seguidores"),
    ("watch_lost_follower", "Seguidores perdidos"),
    ("watch_started_following", "Começou a seguir"),
    ("watch_stopped_following", "Deixou de seguir"),
]

struct WatchChanges: View {
    let events: [AppModel.WatchEvent]
    var targetNames: [String: String] = [:]
    @State private var filter = ""
    private var changes: [AppModel.WatchEvent] { events.filter(\.isWatchChange).sorted { $0.date > $1.date } }
    private var matches: [AppModel.WatchEvent] { changes.filter { filter.isEmpty || $0.type == filter } }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ChipRow {
                Chip(title: "Todas", count: changes.count, selected: filter.isEmpty) { filter = "" }
                ForEach(watchChangeKinds, id: \.id) { kind in
                    let count = changes.filter { $0.type == kind.id }.count
                    if count > 0 { Chip(title: kind.title, count: count, selected: filter == kind.id) { filter = kind.id } }
                }
            }
            if matches.isEmpty {
                EmptyState(icon: "eye", title: "Sem mudanças verificadas", message: "Só aparecem mudanças de listas completas e validadas. O primeiro check cria a referência.")
                    .surface(padding: 0)
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(Array(matches.enumerated()), id: \.element.id) { index, event in
                        WatchChangeRow(event: event, targetName: targetNames[event.targetId]).padding(.horizontal, 14).padding(.vertical, 10)
                        if index < matches.count - 1 { Divider().overlay(Theme.line).padding(.leading, 66) }
                    }
                }
                .surface(padding: 0, radius: 20)
                Text("A data é a do check que observou a mudança, não a hora exata em que aconteceu.").font(.caption).foregroundStyle(Theme.ink3)
            }
        }
    }
}

struct WatchChangeRow: View {
    let event: AppModel.WatchEvent
    var targetName: String? = nil
    private var tone: Tone {
        switch event.type {
        case "watch_new_follower", "watch_started_following": return .gain
        case "watch_lost_follower", "watch_stopped_following": return .loss
        case "watch_account_unavailable": return .caution
        default: return .reach
        }
    }
    var body: some View {
        HStack(spacing: 12) {
            ProfileAvatar(photoURL: event.photoURL, size: 42, name: event.username)
            VStack(alignment: .leading, spacing: 2) {
                if let targetName { Text("@" + targetName).font(.caption.weight(.semibold)).foregroundStyle(Theme.ink2) }
                Text(event.username.isEmpty ? event.title : "@" + event.username).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                Text(event.title + " · " + RelativeTime.short(event.date)).font(.footnote).foregroundStyle(tone.color).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Add

private struct AddTargetSheet: View {
    let model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var username = ""
    @State private var interval = 1440
    @State private var followers = false
    @FocusState private var focused: Bool
    private var clean: String { username.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "@", with: "").lowercased() }
    private var valid: Bool { clean.range(of: "^[a-z0-9._]{1,30}$", options: .regularExpression) != nil }
    private var duplicate: Bool { model.targets.contains { $0.username.lowercased() == clean } }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 6) {
                    Text("@").font(.title2.weight(.semibold)).foregroundStyle(Theme.ink3)
                    TextField("username", text: $username).font(.title2.weight(.semibold))
                        .textInputAutocapitalization(.never).autocorrectionDisabled().focused($focused)
                        .submitLabel(.done).onSubmit(add)
                }
                .padding(.horizontal, 16).frame(minHeight: 60)
                .background(Theme.surface, in: .rect(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(focused ? Theme.signalInk : Theme.line, lineWidth: focused ? 2 : 1))
                Group {
                    if !clean.isEmpty && !valid { Text("Um username tem até 30 letras, números, pontos ou underscores.").foregroundStyle(Theme.loss) }
                    else if duplicate { Text("Esta conta já está na tua Watchlist.").foregroundStyle(Theme.caution) }
                    else { Text("Tem de ser uma conta pública ou que segues.").foregroundStyle(Theme.ink2) }
                }
                .font(.footnote)
                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow(text: "Verificar no máximo")
                    Picker("Intervalo", selection: $interval) {
                        Text("4× por dia").tag(360)
                        Text("Diariamente").tag(1440)
                        Text("Semanalmente").tag(10080)
                    }
                    .pickerStyle(.segmented)
                    Text("Intervalos longos são mais seguros: cada check lê listas inteiras.").font(.caption).foregroundStyle(Theme.ink2)
                }
                Toggle(isOn: $followers) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Monitorizar também seguidores").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                        Text("Por omissão só quem esta conta segue: é a lista que o Instagram deixa ler sem bloquear.").font(.caption).foregroundStyle(Theme.ink2)
                    }
                }
                .tint(Theme.signalInk)
                Spacer()
                Button("Adicionar", action: add).buttonStyle(SignalButtonStyle()).disabled(!valid || duplicate || model.watchlistBusy)
            }
            .padding(20)
            .background(Theme.canvas)
            .navigationTitle("Adicionar perfil").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } } }
            .onAppear { focused = true }
        }
        .tint(Theme.signalInk)
        .presentationDetents([.medium, .large])
    }

    private func add() {
        guard valid, !duplicate else { return }
        model.watchlist("add", args: ["username": clean, "intervalMinutes": interval, "lists": followers ? "both" : "following"])
        dismiss()
    }
}

// MARK: - Likes

private struct LikePerson: Identifiable {
    let id: String, username: String, fullName: String, photoURL: String
    init(_ v: [String: Any]) { id = v["id"] as? String ?? ""; username = v["username"] as? String ?? ""; fullName = v["fullName"] as? String ?? ""; photoURL = v["photoURL"] as? String ?? "" }
}
private struct LikePost: Identifiable {
    let id: String, code: String, caption: String, photoURL: String, complete: Bool
    let people: [LikePerson]
    let added: [LikePerson]
    let removed: [LikePerson]
    init(_ v: [String: Any]) {
        id = v["id"] as? String ?? ""; code = v["code"] as? String ?? ""; caption = v["caption"] as? String ?? ""; photoURL = v["photoURL"] as? String ?? ""
        complete = v["complete"] as? Bool ?? false
        people = (v["users"] as? [[String: Any]] ?? []).map(LikePerson.init)
        let events = v["events"] as? [[String: Any]] ?? []
        added = events.filter { $0["type"] as? String != "removed" }.map { LikePerson($0["user"] as? [String: Any] ?? [:]) }
        removed = events.filter { $0["type"] as? String == "removed" }.map { LikePerson($0["user"] as? [String: Any] ?? [:]) }
    }
}

/// Who liked the watched profile's recent posts, compared between complete lists.
private struct MediaLikesPanel: View {
    let model: AppModel
    let targetID: String
    @State private var posts: [LikePost] = []
    @State private var loading = false
    @State private var error = ""
    @State private var amount = 3

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Picker("Publicações", selection: $amount) { ForEach([1, 3, 5], id: \.self) { Text("\($0) publicações").tag($0) } }
                    .disabled(loading)
                Spacer()
                Button { Task { await load(refresh: true) } } label: { Label(loading ? "A consultar…" : "Atualizar", systemImage: "arrow.clockwise") }
                    .buttonStyle(QuietButtonStyle()).disabled(loading || model.checkIsRunning || !model.sessionAvailable)
            }
            if !error.isEmpty { InlineNotice(text: error) }
            if posts.isEmpty && !loading {
                EmptyState(icon: "heart", title: "Ainda sem observações", message: "Atualiza para guardar quem gostou das publicações recentes. A comparação começa na segunda leitura.")
                    .surface(padding: 0)
            }
            ForEach(posts) { post in
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .top, spacing: 12) {
                        AsyncImage(url: URL(string: post.photoURL).flatMap { $0.scheme == "https" ? $0 : nil }) { $0.resizable().scaledToFill() } placeholder: { Theme.sunken }
                            .frame(width: 64, height: 64).clipShape(.rect(cornerRadius: 12, style: .continuous))
                        VStack(alignment: .leading, spacing: 4) {
                            if !post.caption.isEmpty { Text(post.caption).font(.footnote).foregroundStyle(Theme.ink).lineLimit(2) }
                            Label(post.complete ? "\(post.people.count) gostos · lista completa" : "\(post.people.count) gostos · lista parcial", systemImage: post.complete ? "checkmark.seal.fill" : "circle.lefthalf.filled")
                                .font(.caption.weight(.semibold)).foregroundStyle(post.complete ? Theme.signalInk : Theme.caution)
                        }
                    }
                    if !post.added.isEmpty { names("Novos", post.added, Theme.signalInk) }
                    if !post.removed.isEmpty { names("Retirados", post.removed, Theme.loss) }
                    DisclosureGroup("Quem gostou") {
                        LazyVStack(alignment: .leading, spacing: 6) {
                            ForEach(post.people) { person in
                                HStack(spacing: 10) {
                                    ProfileAvatar(photoURL: person.photoURL, size: 28, name: person.username)
                                    Text("@" + person.username).font(.subheadline).foregroundStyle(Theme.ink)
                                }
                            }
                        }
                        .padding(.top, 6)
                    }
                    .font(.subheadline.weight(.medium)).foregroundStyle(Theme.ink)
                }
                .surface(padding: 14, radius: 18)
            }
        }
        .task(id: model.accountId) { posts = []; await load(refresh: false) }
    }

    private func names(_ title: String, _ people: [LikePerson], _ color: Color) -> some View {
        Text("\(title): ").font(.footnote.weight(.semibold)).foregroundStyle(color)
        + Text(people.map { "@" + $0.username }.joined(separator: ", ")).font(.footnote).foregroundStyle(Theme.ink)
    }

    private func load(refresh: Bool) async {
        guard !model.isPreview else { return }
        let owner = model.accountId
        loading = true; error = ""; defer { loading = false }
        do {
            let result = try await model.tools.request("likes", ["targetId": targetID, "operation": refresh ? "refresh" : "get", "amount": amount])
            guard model.accountId == owner, result["accountId"] as? String == owner else { return }
            posts = (result["posts"] as? [[String: Any]] ?? []).map(LikePost.init)
        } catch { self.error = error.localizedDescription }
    }
}
