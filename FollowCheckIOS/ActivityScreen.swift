import SwiftUI

/// Everything that changed, in three honest streams: your account, the Watchlist,
/// and the actions you queued yourself.
struct ActivityScreen: View {
    let model: AppModel
    @State private var stream = "account"

    var body: some View {
        NavigationStack {
            ScreenScroll(spacing: 16, refresh: model.refreshState) {
                ScreenHeader(title: "Atividade", subtitle: "Só mudanças observadas em checks completos.")
                Picker("Fonte", selection: $stream) {
                    Text("Conta").tag("account")
                    Text("Watchlist").tag("watchlist")
                    Text("Ações").tag("actions")
                }
                .pickerStyle(.segmented)
                switch stream {
                case "watchlist":
                    WatchChanges(events: model.watchEvents, targetNames: Dictionary(model.targets.map { ($0.id, $0.username) }, uniquingKeysWith: { a, _ in a }))
                case "actions": actions
                default: account
                }
            }
        }
        .onAppear {
            #if DEBUG
            if PreviewFlags.has("--preview-activity-watchlist") { stream = "watchlist" }
            #endif
        }
    }

    // MARK: Account

    private var groups: [(String, [AppModel.WatchEvent])] {
        let order = ["new_follower", "unfollow_confirmed", "lost_follower", "account_unavailable", "account_reactivated"]
        let titles = ["new_follower": "Novos seguidores", "unfollow_confirmed": "Deixaram de te seguir", "lost_follower": "Deixaram de te seguir",
                      "account_unavailable": "Contas indisponíveis", "account_reactivated": "Contas de volta"]
        var result: [(String, [AppModel.WatchEvent])] = []
        for type in order {
            let items = model.accountEvents.filter { $0.type == type }
            guard !items.isEmpty, let title = titles[type] else { continue }
            if let index = result.firstIndex(where: { $0.0 == title }) { result[index].1 += items } else { result.append((title, items)) }
        }
        return result
    }

    @ViewBuilder private var account: some View {
        if model.snapshot == nil {
            EmptyState(icon: "bell", title: "Ainda sem checks", message: "Depois do segundo check completo, vês aqui quem entrou e quem saiu.",
                       actionTitle: "Ir para o Início") { model.select(.home) }
                .surface(padding: 0)
        } else if groups.isEmpty {
            EmptyState(icon: "checkmark.circle", title: "Nada mudou", message: model.lastCompletedCheck.map { "No check de " + $0.formatted(date: .abbreviated, time: .shortened) + " não houve entradas nem saídas." } ?? "Sem entradas nem saídas.")
                .surface(padding: 0)
        } else {
            if let date = model.lastCompletedCheck {
                Text("Check de " + date.formatted(date: .abbreviated, time: .shortened)).font(.footnote.weight(.semibold)).foregroundStyle(Theme.ink2)
            }
            ForEach(groups.indices, id: \.self) { index in
                let title = groups[index].0, events = groups[index].1
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text(title).font(.headline).foregroundStyle(Theme.ink)
                        Spacer()
                        Text(events.count.formatted()).font(.headline).monospacedDigit().foregroundStyle(Theme.ink2)
                    }
                    VStack(spacing: 0) {
                        ForEach(Array(events.enumerated()), id: \.element.id) { index, event in
                            AccountEventRow(event: event).padding(.horizontal, 14).padding(.vertical, 10)
                            if index < events.count - 1 { Divider().overlay(Theme.line).padding(.leading, 66) }
                        }
                    }
                    .surface(padding: 0, radius: 20)
                }
            }
            Text("Uma saída só é confirmada quando a conta falta em dois checks seguidos, para não confundir com falhas do Instagram.")
                .font(.caption).foregroundStyle(Theme.ink3)
        }
    }

    // MARK: Actions

    private static let statusText = ["pending": "Por fazer", "running": "Por confirmar", "confirmed": "Feito", "unconfirmed": "Sem confirmação"]

    @ViewBuilder private var actions: some View {
        let queue = model.tools.lastQueue
        if queue.rows.isEmpty {
            EmptyState(icon: "list.bullet.rectangle", title: "Ainda sem ações", message: "Quando deixares de seguir ou removeres alguém em Pessoas, cada resultado fica registado aqui.")
                .surface(padding: 0)
        } else {
            let action = PeopleAction(rawValue: queue.action)
            let confirmed = queue.rows.filter { $0["status"] as? String == "confirmed" }.count
            VStack(alignment: .leading, spacing: 4) {
                Text(action?.title ?? "Última fila").font(.headline).foregroundStyle(Theme.ink)
                Text("\(confirmed) de \(queue.rows.count) confirmadas" + (queue.updatedAt.map { " · " + RelativeTime.short($0) } ?? ""))
                    .font(.footnote).foregroundStyle(Theme.ink2)
            }
            VStack(spacing: 0) {
                ForEach(Array(queue.rows.enumerated()), id: \.offset) { index, row in
                    let status = row["status"] as? String ?? "pending"
                    HStack(spacing: 12) {
                        ProfileAvatar(photoURL: row["photoURL"] as? String ?? "", size: 40, name: row["username"] as? String ?? "")
                        VStack(alignment: .leading, spacing: 2) {
                            Text("@" + (row["username"] as? String ?? "")).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                            if let message = row["message"] as? String, status == "unconfirmed" {
                                Text(AppModel.redact(message)).font(.caption).foregroundStyle(Theme.ink2).lineLimit(2)
                            }
                        }
                        Spacer()
                        Label(Self.statusText[status] ?? status, systemImage: status == "confirmed" ? "checkmark.circle.fill" : status == "unconfirmed" ? "exclamationmark.triangle.fill" : "clock")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(status == "confirmed" ? Theme.signalInk : status == "unconfirmed" ? Theme.caution : Theme.ink3)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    if index < queue.rows.count - 1 { Divider().overlay(Theme.line).padding(.leading, 66) }
                }
            }
            .surface(padding: 0, radius: 20)
            Text("Uma ação “sem confirmação” pode ter sido aplicada pelo Instagram. Confirma no perfil antes de repetir.")
                .font(.caption).foregroundStyle(Theme.ink3)
        }
    }
}
