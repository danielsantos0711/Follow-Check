import SwiftUI

/// People is one list seen through a lens. Selecting people and acting on them
/// always goes through a final review; protected people never enter a queue.
struct PeopleScreen: View {
    @Bindable var model: AppModel
    @State private var lens = "Não me seguem"
    @State private var query = ""
    @State private var selecting = false
    @State private var selected = Set<String>()
    @State private var person: AppModel.Relation?
    @State private var review: ReviewRequest?
    @State private var circle = false
    @State private var exportFile: URL?

    private let lenses = ["Não me seguem", "Eu não sigo", "Mútuos", "Todos"]
    private var store: NativeToolsStore { model.tools }

    private var visible: [AppModel.Relation] {
        model.relations.filter { person in
            person.matches(lens) && (query.isEmpty || "\(person.username) \(person.name)".localizedCaseInsensitiveContains(query))
        }
        .sorted { $0.username.localizedStandardCompare($1.username) == .orderedAscending }
    }
    private var chosen: [AppModel.Relation] { model.relations.filter { selected.contains($0.id) } }
    /// The natural action for each lens.
    private var primaryAction: PeopleAction {
        switch lens {
        case "Eu não sigo": return .follow
        default: return .unfollow
        }
    }

    var body: some View {
        NavigationStack {
            ScreenScroll(spacing: 16, refresh: model.refreshState) {
                header
                QueueBanner(model: model) { people, action in review = ReviewRequest(people: people, action: action) }
                ChipRow {
                    ForEach(lenses, id: \.self) { key in
                        Chip(title: RelationFilter.label(key), count: model.relationsReady ? model.count(key) : nil, selected: lens == key) {
                            lens = key; selected = []
                        }
                    }
                }
                SearchField(text: $query, prompt: "Pesquisar nome ou @username")
                content
            }
            .safeAreaInset(edge: .bottom, spacing: 0) { if selecting { selectionBar } }
            .navigationDestination(isPresented: $circle) { CircleScreen(model: model) }
        }
        .sheet(item: $person) { PersonSheet(model: model, person: $0) { people, action in review = ReviewRequest(people: people, action: action) } }
        .sheet(item: $review) { request in
            ActionReview(model: model, people: request.people, action: request.action) { selected = []; selecting = false }
        }
        .onAppear {
            lens = model.requestedRelationFilter
            #if DEBUG
            if PreviewFlags.has("--preview-review") { review = ReviewRequest(people: Array(model.relations.filter { $0.following && !$0.follows }), action: .unfollow) }
            if PreviewFlags.has("--preview-select") { selecting = true; selected = Set(model.relations.filter { $0.following && !$0.follows }.prefix(3).map(\.id)) }
            if PreviewFlags.has("--preview-circle") { circle = true }
            #endif
        }
        .onChange(of: model.requestedRelationFilter) { _, value in lens = value; selected = [] }
    }

    private var header: some View {
        ScreenHeader(title: "Pessoas", subtitle: RelationFilter.explanation(lens)) {
            Menu {
                Button("Análise de ligações", systemImage: "circle.hexagongrid") { circle = true }
                Button("Exportar lista (CSV)", systemImage: "tablecells") {
                    let url = FileManager.default.temporaryDirectory.appendingPathComponent("FollowCheck-pessoas.csv")
                    if (try? store.csv.write(to: url, atomically: true, encoding: .utf8)) != nil { exportFile = url }
                }
                .disabled(model.relations.isEmpty)
            } label: { IconGlyph(systemName: "ellipsis") }
            .accessibilityLabel("Mais opções")
            if !visible.isEmpty {
                Button(selecting ? "OK" : "Selecionar") { selecting.toggle(); if !selecting { selected = [] } }
                    .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.signalInk)
                    .frame(minHeight: 44)
            }
        }
        .sheet(item: Binding(get: { exportFile.map(ExportItem.init) }, set: { if $0 == nil { exportFile = nil } })) { item in
            ShareSheet(items: [item.url])
        }
    }

    @ViewBuilder private var content: some View {
        if !model.relationsReady && model.relations.isEmpty {
            if model.relationsLoading {
                HStack { Spacer(); ProgressView("A abrir a lista guardada…"); Spacer() }.padding(.vertical, 40)
            } else {
                EmptyState(icon: "person.2", title: "Ainda sem lista", message: "Faz um check no Início. A lista fica guardada neste iPhone e aparece aqui.",
                           actionTitle: "Ir para o Início") { model.select(.home) }
                    .surface(padding: 0)
            }
        } else if visible.isEmpty {
            EmptyState(icon: query.isEmpty ? "checkmark.circle" : "magnifyingglass",
                       title: query.isEmpty ? emptyTitle : "Sem resultados",
                       message: query.isEmpty ? "Esta lente está vazia no último check completo." : "Nenhum perfil corresponde a “\(query)”.")
                .surface(padding: 0)
        } else {
            HStack {
                Text("\(visible.count.formatted()) \(visible.count == 1 ? "perfil" : "perfis")").font(.footnote).foregroundStyle(Theme.ink2).monospacedDigit()
                Spacer()
                if selecting {
                    let eligible = visible.filter { !store.protectedIDs.contains($0.id) }
                    Button(selected.count >= eligible.count ? "Limpar seleção" : "Selecionar todos") {
                        if selected.count >= eligible.count { selected = [] } else { selected = Set(eligible.map(\.id)) }
                    }
                    .font(.footnote.weight(.semibold)).foregroundStyle(Theme.signalInk)
                }
            }
            LazyVStack(spacing: 0) {
                ForEach(Array(visible.enumerated()), id: \.element.id) { index, person in
                    PersonRow(person: person, protected: store.protectedIDs.contains(person.id), selecting: selecting, selected: selected.contains(person.id)) {
                        if selecting {
                            guard !store.protectedIDs.contains(person.id) else { return }
                            if selected.contains(person.id) { selected.remove(person.id) } else { selected.insert(person.id) }
                        } else { self.person = person }
                    }
                    .contextMenu {
                        Button(store.protectedIDs.contains(person.id) ? "Deixar de proteger" : "Proteger", systemImage: "shield") { Task { await store.protect(person.id) } }
                        Button("Ver no Instagram", systemImage: "arrow.up.forward.app") { model.openProfile(person.username) }
                    }
                    if index < visible.count - 1 { Divider().overlay(Theme.line).padding(.leading, selecting ? 108 : 70) }
                }
            }
            .surface(padding: 0, radius: 20)
            Text("Lista do último check completo. Uma conta pode ter mudado desde então.").font(.caption).foregroundStyle(Theme.ink3)
        }
    }

    private var emptyTitle: String {
        switch lens {
        case "Não me seguem": return "Toda a gente te segue de volta"
        case "Eu não sigo": return "Segues todos os teus seguidores"
        default: return "Ninguém aqui"
        }
    }

    private var selectionBar: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                Text("\(selected.count) \(selected.count == 1 ? "selecionado" : "selecionados")").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).monospacedDigit()
                Text(store.operationRunning ? "Há uma fila em curso" : "Revês antes de começar").font(.caption).foregroundStyle(Theme.ink2)
            }
            Spacer()
            Menu {
                ForEach(PeopleAction.allCases) { action in
                    let applicable = chosen.filter { $0.canPerform(action.rawValue) }.count
                    Button("\(action.title) · \(applicable)", systemImage: action.icon) { review = ReviewRequest(people: chosen, action: action) }
                        .disabled(applicable == 0)
                }
            } label: { IconGlyph(systemName: "ellipsis") }
            .accessibilityLabel("Outras ações")
            Button { review = ReviewRequest(people: chosen, action: primaryAction) } label: {
                Label(primaryAction.title, systemImage: primaryAction.icon)
            }
            .buttonStyle(ProminentButtonStyle())
        }
        .disabled(selected.isEmpty || store.operationRunning)
        .padding(.horizontal, 20).padding(.vertical, 10)
        .background(.bar)
        .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 0.5) }
    }
}

struct ReviewRequest: Identifiable {
    let id = UUID()
    let people: [AppModel.Relation]
    let action: PeopleAction
}

private struct ExportItem: Identifiable {
    let url: URL
    var id: String { url.path }
}

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

struct PersonRow: View {
    let person: AppModel.Relation
    var protected = false
    var selecting = false
    var selected = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                if selecting {
                    Image(systemName: protected ? "shield.fill" : selected ? "checkmark.circle.fill" : "circle")
                        .font(.title3)
                        .foregroundStyle(protected ? Theme.ink3 : selected ? Theme.signalInk : Theme.ink3)
                        .frame(width: 26)
                        .transition(.move(edge: .leading).combined(with: .opacity))
                }
                ProfileAvatar(photoURL: person.photoURL, size: 44, name: person.username)
                VStack(alignment: .leading, spacing: 2) {
                    Text("@" + person.username).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                    if !person.name.isEmpty { Text(person.name).font(.footnote).foregroundStyle(Theme.ink2).lineLimit(1) }
                }
                Spacer(minLength: 8)
                if protected && !selecting {
                    Image(systemName: "shield.fill").font(.caption).foregroundStyle(Theme.signalInk).accessibilityLabel("Protegido")
                }
                RelationBadge(kind: RelationKind(person))
            }
            .padding(.horizontal, 14).padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selecting && selected ? .isSelected : [])
        .accessibilityHint(selecting ? (protected ? "Protegido, não pode ser selecionado" : "Toca para selecionar") : "Abre o perfil")
    }
}

// MARK: - Person

struct PersonSheet: View {
    let model: AppModel
    let person: AppModel.Relation
    let act: ([AppModel.Relation], PeopleAction) -> Void
    @Environment(\.dismiss) private var dismiss
    private var protected: Bool { model.tools.protectedIDs.contains(person.id) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    VStack(spacing: 10) {
                        ProfileAvatar(photoURL: person.photoURL, size: 88, name: person.username)
                        VStack(spacing: 3) {
                            Text("@" + person.username).font(.title2.weight(.bold)).foregroundStyle(Theme.ink)
                            if !person.name.isEmpty { Text(person.name).font(.subheadline).foregroundStyle(Theme.ink2) }
                        }
                        RelationBadge(kind: RelationKind(person))
                    }
                    HStack(spacing: 0) {
                        fact(person.follows ? "Sim" : "Não", "Segue-te")
                        Divider().overlay(Theme.line).frame(height: 32)
                        fact(person.following ? "Sim" : "Não", "Segues")
                    }
                    .padding(.vertical, 12)
                    .background(Theme.surface, in: .rect(cornerRadius: 18, style: .continuous))
                    Toggle(isOn: Binding(get: { protected }, set: { _ in Task { await model.tools.protect(person.id) } })) {
                        VStack(alignment: .leading, spacing: 2) {
                            Label("Proteger", systemImage: "shield").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                            Text("Nunca entra numa fila de ações.").font(.caption).foregroundStyle(Theme.ink2)
                        }
                    }
                    .tint(Theme.signalInk)
                    .surface(padding: 14, radius: 18)
                    VStack(spacing: 0) {
                        ForEach(PeopleAction.allCases.filter { person.canPerform($0.rawValue) }) { action in
                            Button {
                                dismiss(); act([person], action)
                            } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: action.icon).frame(width: 24)
                                    Text(action.title)
                                    Spacer()
                                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3)
                                }
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(action.destructive ? Theme.loss : Theme.ink)
                                .padding(.horizontal, 14).frame(minHeight: 50)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .disabled(protected || model.tools.operationRunning)
                            Divider().overlay(Theme.line).padding(.leading, 50)
                        }
                        Button { dismiss(); model.openProfile(person.username) } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "arrow.up.forward.app").frame(width: 24)
                                Text("Ver no Instagram")
                                Spacer()
                            }
                            .font(.subheadline.weight(.medium)).foregroundStyle(Theme.ink)
                            .padding(.horizontal, 14).frame(minHeight: 50).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                    .background(Theme.surface, in: .rect(cornerRadius: 18, style: .continuous))
                    .opacity(1)
                    if protected { Text("Remove a proteção para incluir este perfil numa ação.").font(.caption).foregroundStyle(Theme.ink2) }
                }
                .padding(20)
            }
            .background(Theme.canvas)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("OK") { dismiss() } } }
        }
        .tint(Theme.signalInk)
        .presentationDetents([.medium, .large])
    }

    private func fact(_ value: String, _ title: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.headline).foregroundStyle(Theme.ink)
            Text(title).font(.caption).foregroundStyle(Theme.ink2)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Review

/// The last step before anything is sent to Instagram.
struct ActionReview: View {
    let model: AppModel
    let people: [AppModel.Relation]
    let action: PeopleAction
    var started: () -> Void = {}
    @Environment(\.dismiss) private var dismiss
    @State private var excluded = Set<String>()

    private var protectedIDs: Set<String> { model.tools.protectedIDs }
    private func eligible(_ person: AppModel.Relation) -> Bool { !protectedIDs.contains(person.id) && person.canPerform(action.rawValue) }
    private var included: [AppModel.Relation] { people.filter { eligible($0) && !excluded.contains($0.id) } }
    private func setting(_ name: String, _ fallback: Int) -> Int { (UserDefaults.standard.object(forKey: "followcheck.limits." + name) as? NSNumber)?.intValue ?? fallback }
    private var batch: Int { max(1, min(10000, setting("batch", 20))) }
    private var estimate: String {
        let calls = included.count * action.steps, gaps = max(0, calls - 1)
        let every = max(0, min(50, setting("actionEvery", 5)))
        let seconds = gaps * max(2, min(120, setting("actionDelay", 4))) + (every > 0 ? gaps / every : 0) * max(0, min(600, setting("actionPause", 300)))
        if seconds < 60 { return "\(seconds) s" }
        return Duration.seconds(seconds).formatted(.units(allowed: [.hours, .minutes], width: .abbreviated))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 10) {
                        Label(action.title, systemImage: action.icon).font(.subheadline.weight(.semibold)).foregroundStyle(action.destructive ? Theme.loss : Theme.signalInk)
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(included.count.formatted()).font(.system(size: 52, weight: .bold, design: .rounded)).monospacedDigit().foregroundStyle(Theme.ink)
                                .contentTransition(.numericText())
                            Text(included.count == 1 ? "perfil" : "perfis").font(.title3).foregroundStyle(Theme.ink2)
                        }
                        HStack(spacing: 10) {
                            summary("Duração estimada", estimate)
                            summary("Fora da fila", (people.count - included.count).formatted())
                        }
                    }
                    if included.count > batch {
                        InlineNotice(text: "O teu limite é de \(batch) perfis por fila. Retira \(included.count - batch) ou ajusta o limite em Conta › Ritmo.")
                    }
                    Text("As ações são enviadas uma a uma, com pausas. Cada resultado é confirmado antes da seguinte; se uma não for confirmada, a fila para e nada é repetido automaticamente.")
                        .font(.footnote).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                    LazyVStack(spacing: 0) {
                        ForEach(people) { person in
                            let can = eligible(person)
                            Button {
                                guard can else { return }
                                if excluded.contains(person.id) { excluded.remove(person.id) } else { excluded.insert(person.id) }
                            } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: !can ? "minus.circle" : excluded.contains(person.id) ? "circle" : "checkmark.circle.fill")
                                        .font(.title3).foregroundStyle(can && !excluded.contains(person.id) ? Theme.signalInk : Theme.ink3)
                                    ProfileAvatar(photoURL: person.photoURL, size: 38, name: person.username)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text("@" + person.username).font(.subheadline.weight(.semibold)).foregroundStyle(can ? Theme.ink : Theme.ink3)
                                        Text(protectedIDs.contains(person.id) ? "Protegido" : !person.canPerform(action.rawValue) ? "Não se aplica a esta relação" : person.name)
                                            .font(.caption).foregroundStyle(Theme.ink2).lineLimit(1)
                                    }
                                    Spacer()
                                }
                                .padding(.horizontal, 14).padding(.vertical, 8).contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(can && !excluded.contains(person.id) ? .isSelected : [])
                            Divider().overlay(Theme.line).padding(.leading, 100)
                        }
                    }
                    .surface(padding: 0, radius: 20)
                }
                .padding(20)
            }
            .background(Theme.canvas)
            .navigationTitle("Rever").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } } }
            .safeAreaInset(edge: .bottom) {
                Button(included.isEmpty ? "Nenhum perfil incluído" : "Começar · \(included.count) \(included.count == 1 ? "perfil" : "perfis")") {
                    let confirmed = included
                    dismiss(); started()
                    Task { await model.tools.execute(action.rawValue, people: confirmed) }
                }
                .buttonStyle(SignalButtonStyle())
                .disabled(included.isEmpty || included.count > batch || model.tools.operationRunning)
                .padding(.horizontal, 20).padding(.vertical, 12).background(.bar)
            }
        }
        .tint(Theme.signalInk)
    }

    private func summary(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.headline).monospacedDigit().foregroundStyle(Theme.ink)
            Text(title).font(.caption).foregroundStyle(Theme.ink2)
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(12)
        .background(Theme.surface, in: .rect(cornerRadius: 14, style: .continuous))
    }
}

// MARK: - Queue

/// Live status of the action queue, or the unfinished part of the last one.
struct QueueBanner: View {
    let model: AppModel
    let resume: ([AppModel.Relation], PeopleAction) -> Void
    private var store: NativeToolsStore { model.tools }

    var body: some View {
        if store.operationRunning {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label(PeopleAction(rawValue: store.queueAction)?.title ?? "Fila", systemImage: "list.bullet").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                    Spacer()
                    Text("\(store.operationDone) de \(store.operationTotal)").font(.subheadline.weight(.semibold)).monospacedDigit().foregroundStyle(Theme.signalInk)
                }
                ProgressTrack(value: Double(store.operationDone) / Double(max(store.operationTotal, 1)))
                HStack(spacing: 4) {
                    if let until = store.queueWaitUntil {
                        Text("Próxima ação")
                        Text(until, style: .relative).monospacedDigit()
                    } else if !store.operationCurrent.isEmpty {
                        Text("A tratar @" + store.operationCurrent)
                    }
                    Spacer()
                    Button("Parar") { store.operationPaused = true }.fontWeight(.semibold).foregroundStyle(Theme.loss)
                }
                .font(.footnote).foregroundStyle(Theme.ink2)
            }
            .surface(padding: 14, radius: 18, fill: Theme.signal.opacity(0.1))
        } else if let error = store.error {
            InlineNotice(text: error)
        } else if !store.pendingInLastQueue.isEmpty, let action = PeopleAction(rawValue: store.lastQueue.action) {
            Button { resume(store.pendingInLastQueue, action) } label: {
                HStack(spacing: 12) {
                    Image(systemName: "pause.circle").font(.title3).foregroundStyle(Theme.caution)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Fila interrompida").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                        Text("\(store.pendingInLastQueue.count) por fazer · \(action.title.lowercased())").font(.caption).foregroundStyle(Theme.ink2)
                    }
                    Spacer()
                    Text("Rever").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.signalInk)
                }
                .surface(padding: 14, radius: 18)
            }
            .buttonStyle(PressStyle())
        }
    }
}
