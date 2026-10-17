import SwiftUI
import UniformTypeIdentifiers

/// Connection analysis: crosses the current lists with history the user imports
/// from Instagram (their own data download) to show who they actually interact with.
/// Everything is computed on this iPhone. The analysis suggests; the user decides.
struct CircleScreen: View {
    let model: AppModel
    @State private var rows: [Evidence] = []
    @State private var source: [String: Any] = [:]
    @State private var filter = Lens.all
    @State private var query = ""
    @State private var loading = false
    @State private var failure: String?
    @State private var importing = false
    @State private var detail: Evidence?
    @State private var memories = false
    @State private var selecting = false
    @State private var selected = Set<String>()
    @State private var review: ReviewRequest?
    private var store: NativeToolsStore { model.tools }

    enum Lens: String, CaseIterable, Identifiable {
        case all = "Todos", dormant = "Adormecidos", oneWay = "Unilaterais", silent = "Mútuos silenciosos", suspicious = "Suspeitos"
        var id: String { rawValue }
    }

    struct Evidence: Identifiable {
        let raw: [String: Any]
        var user: [String: Any] { raw["user"] as? [String: Any] ?? [:] }
        var features: [String: Any] { raw["features"] as? [String: Any] ?? [:] }
        var profile: [String: Any] { raw["profile"] as? [String: Any] ?? [:] }
        var proof: [String: Any] { features["proofGraph"] as? [String: Any] ?? [:] }
        var id: String { user["id"] as? String ?? "" }
        var protected: Bool { raw["isProtected"] as? Bool ?? false }
        var score: Int { (features["relationshipScore"] as? NSNumber)?.intValue ?? 0 }
        var confidence: Int { (proof["calibratedConfidence"] as? NSNumber ?? features["hybridConfidence"] as? NSNumber)?.intValue ?? 0 }
        var circle: String { features["relationshipCircle"] as? String ?? "unknown" }
        var person: AppModel.Relation {
            AppModel.Relation(["id": id, "username": user["username"] ?? "", "name": user["full_name"] ?? "", "photoURL": user["profile_pic_url"] ?? "",
                               "follows": user["follows_viewer"] ?? false, "following": user["followed_by_viewer"] ?? false])
        }
        func matches(_ lens: Lens) -> Bool {
            switch lens {
            case .all: return true
            case .dormant: return (features["dormantYears"] as? Double ?? 0) >= 1
            case .oneWay: return ["outbound", "inbound"].contains(features["energy"] as? String ?? "")
            case .silent: return features["silentMutual"] as? Bool == true
            case .suspicious: return features["suspicious"] as? Bool == true || features["inactive"] as? Bool == true
            }
        }
    }

    static let circles = ["close": "Círculo próximo", "active": "Ligação ativa", "occasional": "Contacto ocasional", "weak": "Ligação fraca",
                          "dormant": "Adormecida", "none": "Sem contacto", "unknown": "Dados insuficientes"]

    private var visible: [Evidence] {
        rows.filter { row in
            row.matches(filter) && (query.isEmpty || "\(row.person.username) \(row.person.name)".localizedCaseInsensitiveContains(query))
        }
        .sorted { $0.score == $1.score ? $0.person.username < $1.person.username : $0.score < $1.score }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Análise de ligações").font(.largeTitle.weight(.bold)).foregroundStyle(Theme.ink)
                    Text("Cruza as tuas listas com o histórico que descarregas do Instagram para ver com quem tens contacto real. Calculado só neste iPhone.")
                        .font(.subheadline).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                }
                sources
                if loading {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text(model.legacyProgress.isEmpty ? "A cruzar o histórico…" : model.legacyProgress).font(.footnote).foregroundStyle(Theme.ink2)
                        Spacer()
                        Button("Cancelar") { model.webCoordinator?.cancelArchiveImport() }.font(.footnote.weight(.semibold))
                    }
                    .surface(padding: 14, radius: 16)
                }
                if let failure { InlineNotice(text: failure) }
                if rows.isEmpty && !loading {
                    EmptyState(icon: "circle.hexagongrid", title: "Importa o teu histórico",
                               message: "No Instagram: Centro de contas › As tuas informações › Transferir as tuas informações, em formato JSON. Depois importa o ZIP aqui.")
                        .surface(padding: 0)
                } else if !rows.isEmpty {
                    ChipRow {
                        ForEach(Lens.allCases) { lens in
                            Chip(title: lens.rawValue, count: rows.filter { $0.matches(lens) }.count, selected: filter == lens) { filter = lens; selected = [] }
                        }
                    }
                    SearchField(text: $query, prompt: "Pesquisar")
                    HStack {
                        Text("Do contacto mais fraco para o mais forte").font(.footnote).foregroundStyle(Theme.ink2)
                        Spacer()
                        Button(selecting ? "OK" : "Selecionar") { selecting.toggle(); selected = [] }.font(.footnote.weight(.semibold)).foregroundStyle(Theme.signalInk)
                    }
                    LazyVStack(spacing: 0) {
                        ForEach(visible) { row in
                            Button {
                                if selecting {
                                    guard !row.protected else { return }
                                    if selected.contains(row.id) { selected.remove(row.id) } else { selected.insert(row.id) }
                                } else { detail = row }
                            } label: { evidenceRow(row) }
                            .buttonStyle(.plain)
                            Divider().overlay(Theme.line).padding(.leading, selecting ? 106 : 68)
                        }
                    }
                    .surface(padding: 0, radius: 20)
                    Text("A ausência de sinais não prova ausência de relação: o histórico só inclui o que o Instagram exporta.")
                        .font(.caption).foregroundStyle(Theme.ink3)
                }
            }
            .padding(.horizontal, 20).padding(.vertical, 12)
            .frame(maxWidth: 680).frame(maxWidth: .infinity)
        }
        .background(Theme.canvas)
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if selecting {
                let chosen = rows.filter { selected.contains($0.id) && !$0.protected }.map(\.person)
                HStack {
                    Text("\(chosen.count) selecionados").font(.subheadline.weight(.semibold)).monospacedDigit()
                    Spacer()
                    Menu {
                        Button("Manter", systemImage: "hand.thumbsup") { decide("keep") }
                        ForEach(PeopleAction.allCases) { action in
                            Button(action.title, systemImage: action.icon) { review = ReviewRequest(people: chosen, action: action) }
                        }
                    } label: {
                        Text("Ação").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.onSignal)
                            .padding(.horizontal, 18).frame(minHeight: 44).background(Theme.signal, in: .rect(cornerRadius: 14, style: .continuous))
                    }
                    .disabled(chosen.isEmpty || store.operationRunning)
                }
                .padding(.horizontal, 20).padding(.vertical, 10).background(.bar)
            }
        }
        .sheet(item: $detail) { EvidenceSheet(model: model, row: $0) }
        .sheet(isPresented: $memories) { MemoriesSheet(model: model) }
        .sheet(item: $review) { ActionReview(model: model, people: $0.people, action: $0.action) { selecting = false; selected = [] } }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.zip, .json], allowsMultipleSelection: true) { result in
            Task {
                do { let urls = try result.get(); await refresh("import", urls: urls) } catch { failure = error.localizedDescription }
            }
        }
        .task { await refresh() }
        .onChange(of: store.operationRunning) { _, running in if !running { Task { await refresh() } } }
        .onDisappear { model.webCoordinator?.cancelArchiveImport() }
    }

    private var sources: some View {
        VStack(spacing: 0) {
            sourceRow("square.and.arrow.down", "Importar histórico", "ZIP ou JSON transferido do Instagram") { importing = true }
            Divider().overlay(Theme.line).padding(.leading, 62)
            sourceRow("bubble.left.and.bubble.right", "Juntar conversas recentes", "Lê a caixa de entrada desta sessão") { Task { await refresh("conversations") } }
            Divider().overlay(Theme.line).padding(.leading, 62)
            sourceRow("heart.text.square", "Juntar gostos e comentários", "Das tuas publicações recentes") { Task { await refresh("engagement") } }
            Divider().overlay(Theme.line).padding(.leading, 62)
            sourceRow("lock.rectangle.stack", "Excertos privados", "Mensagens importadas, só neste iPhone") { memories = true }
        }
        .surface(padding: 0, radius: 20)
        .disabled(loading || !model.sessionAvailable)
        .overlay(alignment: .bottomTrailing) {
            if let count = source["matchedProfiles"] as? Int {
                Text("Histórico de \(count) perfis").font(.caption2.weight(.semibold)).foregroundStyle(Theme.signalInk).padding(10)
            }
        }
    }

    private func sourceRow(_ icon: String, _ title: String, _ detail: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.signalInk)
                    .frame(width: 34, height: 34).background(Theme.signal.opacity(0.16), in: .rect(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                    Text(detail).font(.caption).foregroundStyle(Theme.ink2)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3)
            }
            .padding(.horizontal, 14).frame(minHeight: 58).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func evidenceRow(_ row: Evidence) -> some View {
        let decision = (store.workspace["relationship-decisions"] as? [String: String])?[row.id]
        return HStack(spacing: 12) {
            if selecting {
                Image(systemName: row.protected ? "shield.fill" : selected.contains(row.id) ? "checkmark.circle.fill" : "circle")
                    .font(.title3).foregroundStyle(selected.contains(row.id) ? Theme.signalInk : Theme.ink3).frame(width: 26)
            }
            ProfileAvatar(photoURL: row.person.photoURL, size: 42, name: row.person.username)
            VStack(alignment: .leading, spacing: 4) {
                Text("@" + row.person.username).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                HStack(spacing: 8) {
                    StrengthBar(score: row.score)
                    Text(Self.circles[row.circle] ?? row.circle).font(.caption).foregroundStyle(Theme.ink2).lineLimit(1)
                }
            }
            Spacer(minLength: 6)
            if decision == "keep" { Image(systemName: "hand.thumbsup.fill").font(.caption).foregroundStyle(Theme.reach).accessibilityLabel("Manter") }
            if row.protected { Image(systemName: "shield.fill").font(.caption).foregroundStyle(Theme.signalInk).accessibilityLabel("Protegido") }
            RelationBadge(kind: RelationKind(row.person))
        }
        .padding(.horizontal, 14).padding(.vertical, 9).contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private func decide(_ value: String) {
        var next = store.workspace["relationship-decisions"] as? [String: Any] ?? [:]
        for row in rows where selected.contains(row.id) && !row.protected { next[row.id] = value }
        Task { await store.save("relationship-decisions", next) }
        selected = []; selecting = false
    }

    private func refresh(_ operation: String = "derive", urls: [URL] = []) async {
        #if DEBUG
        if model.isPreview {
            rows = model.relations.enumerated().map { index, person in
                Evidence(raw: ["user": ["id": person.id, "username": person.username, "full_name": person.name, "followed_by_viewer": person.following, "follows_viewer": person.follows],
                               "features": ["relationshipScore": [8, 64, 31, 90, 12, 47][index % 6], "hybridConfidence": 70, "relationshipCircle": ["dormant", "active", "occasional", "close", "none", "weak"][index % 6], "dormantYears": index % 6 == 0 ? 2.0 : 0.0],
                               "profile": ["evidenceSummary": "12 mensagens trocadas; último contacto em 2024."]])
            }
            source = ["matchedProfiles": 11]
            return
        }
        #endif
        guard !loading else { return }
        loading = true; failure = nil; model.legacyProgress = ""
        defer { loading = false }
        let account = model.accountId
        do {
            let result: [String: Any]
            if operation == "import", !urls.isEmpty {
                guard let coordinator = model.webCoordinator else { throw NSError(domain: "FollowCheck", code: 1, userInfo: [NSLocalizedDescriptionKey: "A sessão ainda está a iniciar."]) }
                result = try await coordinator.importArchive(urls, target: 300)
            } else {
                result = try await store.request("legacy", ["operation": operation, "target": 300, "files": [], "username": model.username, "ids": Array(selected)])
            }
            guard account == model.accountId, result["accountId"] as? String == account else { return }
            rows = (result["rows"] as? [[String: Any]] ?? []).map { Evidence(raw: $0) }
            source = result["source"] as? [String: Any] ?? [:]
            await store.load()
            if operation != "derive" { await model.saveScanBackup() }
        } catch { if account == model.accountId { failure = error.localizedDescription } }
    }
}

struct StrengthBar: View {
    let score: Int
    var body: some View {
        HStack(spacing: 2) {
            ForEach(0..<5) { index in
                Capsule().fill(Double(index) < Double(score) / 20 ? Theme.signalInk : Theme.sunken).frame(width: 7, height: 5)
            }
        }
        .accessibilityLabel("Força da ligação \(score) por cento")
    }
}

private struct EvidenceSheet: View {
    let model: AppModel
    let row: CircleScreen.Evidence
    @Environment(\.dismiss) private var dismiss
    @State private var memories = false
    private static let labels = ["dmSent": "Mensagens enviadas", "dmReceived": "Mensagens recebidas", "dmDays": "Dias com mensagens", "likesGiven": "Gostos teus",
                                 "commentsGiven": "Comentários teus", "mentions": "Menções", "storyReactions": "Reações a Stories", "total": "Total de sinais"]
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(spacing: 14) {
                        ProfileAvatar(photoURL: row.person.photoURL, size: 64, name: row.person.username)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("@" + row.person.username).font(.title3.weight(.bold)).foregroundStyle(Theme.ink)
                            Text(CircleScreen.circles[row.circle] ?? row.circle).font(.subheadline).foregroundStyle(Theme.signalInk)
                        }
                    }
                    HStack(spacing: 10) {
                        stat("\(row.score)%", "Força da ligação")
                        stat("\(row.confidence)%", "Confiança")
                    }
                    Text(row.profile["evidenceSummary"] as? String ?? "Sem histórico associado a este perfil.").font(.subheadline).foregroundStyle(Theme.ink)
                    if let signals = row.profile["signals"] as? [String: Any], !signals.isEmpty {
                        VStack(spacing: 0) {
                            ForEach(signals.keys.sorted(), id: \.self) { key in
                                if let number = signals[key] as? NSNumber {
                                    HStack { Text(Self.labels[key] ?? key).foregroundStyle(Theme.ink2); Spacer(); Text(number.stringValue).monospacedDigit().foregroundStyle(Theme.ink) }
                                        .font(.subheadline).padding(.horizontal, 14).frame(minHeight: 40)
                                }
                            }
                        }
                        .surface(padding: 0, radius: 16)
                    }
                    ForEach(row.proof["abstentionReasons"] as? [String] ?? [], id: \.self) { InlineNotice(text: $0, tone: .neutral, icon: "info.circle") }
                    Button("Ver excertos privados", systemImage: "lock.rectangle.stack") { memories = true }.buttonStyle(QuietButtonStyle(fill: true))
                }
                .padding(20)
            }
            .background(Theme.canvas)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("OK") { dismiss() } } }
            .sheet(isPresented: $memories) { MemoriesSheet(model: model, profileID: row.id) }
        }
        .tint(Theme.signalInk)
        .presentationDetents([.medium, .large])
    }
    private func stat(_ value: String, _ title: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.system(.title2, design: .rounded).weight(.semibold)).monospacedDigit().foregroundStyle(Theme.ink)
            Text(title).font(.caption).foregroundStyle(Theme.ink2)
        }
        .frame(maxWidth: .infinity, alignment: .leading).surface(padding: 14, radius: 16)
    }
}

/// Message excerpts from the imported history. Hidden when the app leaves the foreground
/// and never part of exported backups.
private struct MemoriesSheet: View {
    let model: AppModel
    var profileID: String? = nil
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var entries: [String: [[String: Any]]] = [:]
    @State private var loading = false
    @State private var failure: String?
    @State private var deleting = false
    private var ids: [String] { entries.keys.filter { profileID == nil || profileID == $0 }.sorted { name($0) < name($1) } }
    private func name(_ id: String) -> String { model.relations.first { $0.id == id }.map { "@" + $0.username } ?? id }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    Label("Só neste iPhone · fora das cópias", systemImage: "lock.shield").font(.caption.weight(.semibold)).foregroundStyle(Theme.signalInk)
                    if loading { ProgressView().frame(maxWidth: .infinity) }
                    if let failure { InlineNotice(text: failure) }
                    if ids.isEmpty && !loading {
                        EmptyState(icon: "text.bubble", title: "Sem excertos", message: "Importa o histórico com mensagens para ver excertos por pessoa.").surface(padding: 0)
                    }
                    ForEach(ids, id: \.self) { id in
                        VStack(alignment: .leading, spacing: 10) {
                            Text(name(id)).font(.headline).foregroundStyle(Theme.ink)
                            ForEach(Array((entries[id] ?? []).enumerated()), id: \.offset) { _, entry in
                                let outgoing = entry["direction"] as? String == "outgoing"
                                VStack(alignment: outgoing ? .trailing : .leading, spacing: 4) {
                                    Text(entry["text"] as? String ?? "").font(.subheadline).foregroundStyle(outgoing ? Theme.onSignal : Theme.ink).textSelection(.enabled)
                                        .padding(.horizontal, 12).padding(.vertical, 8)
                                        .background(outgoing ? Theme.signal : Theme.raised, in: .rect(cornerRadius: 16, style: .continuous))
                                    Text(entry["timestamp"] as? String ?? "").font(.caption2).foregroundStyle(Theme.ink3)
                                }
                                .frame(maxWidth: .infinity, alignment: outgoing ? .trailing : .leading)
                            }
                        }
                        .surface()
                    }
                }
                .padding(20)
            }
            .background(Theme.canvas)
            .navigationTitle("Excertos privados").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Fechar") { dismiss() } }
                ToolbarItem(placement: .primaryAction) { Button("Apagar", role: .destructive) { deleting = true }.disabled(entries.isEmpty || loading) }
            }
            .confirmationDialog("Apagar todos os excertos desta conta?", isPresented: $deleting, titleVisibility: .visible) {
                Button("Apagar excertos", role: .destructive) { Task { await load("clear") } }
            }
            .task { await load() }
            .onChange(of: scenePhase) { _, phase in if phase != .active { entries = [:] } else { Task { await load() } } }
            .privacySensitive()
        }
        .tint(Theme.signalInk)
    }

    private func load(_ operation: String = "get") async {
        #if DEBUG
        if model.isPreview {
            entries = ["preview-1": [["text": "Temos de combinar qualquer coisa esta semana.", "direction": "incoming", "timestamp": "15/10/2026"],
                                     ["text": "Sim! Sexta?", "direction": "outgoing", "timestamp": "15/10/2026"]]]
            return
        }
        #endif
        let owner = model.accountId
        loading = true; failure = nil
        defer { loading = false }
        do {
            let result = try await model.tools.request("memories", ["operation": operation])
            guard owner == model.accountId, scenePhase == .active else { return }
            entries = result["memories"] as? [String: [[String: Any]]] ?? [:]
        } catch { if owner == model.accountId { failure = error.localizedDescription } }
    }
}
