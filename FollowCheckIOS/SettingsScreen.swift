import Security
import SwiftUI
import UniformTypeIdentifiers

/// Account, safety and data. The pace is chosen as a preset; the raw numbers stay one level deeper.
struct SettingsScreen: View {
    let model: AppModel
    @AppStorage("followcheck.reminders.enabled") private var reminders = false
    @AppStorage("followcheck.keepAwake") private var keepAwake = true
    @AppStorage("followcheck.appearance") private var appearance = "system"
    @State private var confirmSession = false
    @State private var backupFile: URL?
    @State private var importingBackup = false
    @State private var backupBusy = false
    @State private var backupMessage: String?
    @State private var legacyKey = LegacyIntegrationKey.exists
    @State private var path: [String] = []

    private var version: String {
        let short = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—"
        return "\(short) (\(build))"
    }

    var body: some View {
        NavigationStack(path: $path) {
            ScreenScroll(spacing: 22) {
                ScreenHeader(title: "Conta")
                accountCard
                group("Proteção") {
                    NavigationLink(value: "pace") {
                        SettingsRow(icon: "tortoise", title: "Ritmo dos checks", value: PacePreset.current.title)
                    }
                    divider
                    if let until = model.activeCooldown {
                        SettingsRow(icon: "hourglass", title: "Pausa de proteção", tint: Theme.caution) {
                            Text(until, style: .relative).monospacedDigit().foregroundStyle(Theme.caution)
                        }
                        divider
                    }
                    Toggle(isOn: Binding(get: { model.paused }, set: model.setPaused)) {
                        SettingsLabel(icon: "pause.circle", title: "Pausar checks da minha conta")
                    }
                    .padding(.trailing, 14).disabled(!model.sessionAvailable)
                }
                group("Durante um check") {
                    Toggle(isOn: $keepAwake) { SettingsLabel(icon: "sun.max", title: "Manter o ecrã ligado") }.padding(.trailing, 14)
                    divider
                    Toggle(isOn: $reminders) { SettingsLabel(icon: "bell.badge", title: "Avisar quando terminar") }.padding(.trailing, 14)
                        .onChange(of: reminders) { _, enabled in
                            if enabled { model.requestNotificationPermission(); AppDelegate.scheduleRefresh() } else { AppDelegate.cancelRefresh() }
                        }
                }
                footnote("Os checks só correm com a app aberta. O iOS pode dar alguns minutos extra em segundo plano, sem garantias.")
                group("Aparência") {
                    Picker("Aparência", selection: $appearance) {
                        Text("Sistema").tag("system")
                        Text("Clara").tag("light")
                        Text("Escura").tag("dark")
                    }
                    .pickerStyle(.segmented).padding(12)
                }
                group("Dados") {
                    Button {
                        Task {
                            backupBusy = true; defer { backupBusy = false }
                            do { backupFile = try await model.exportScanBackup(); backupMessage = nil } catch { backupMessage = error.localizedDescription }
                        }
                    } label: { SettingsRow(icon: "externaldrive", title: backupBusy ? "A preparar…" : "Exportar cópia dos checks") }
                    .disabled(backupBusy || !model.sessionAvailable)
                    if let backupFile {
                        divider
                        ShareLink(item: backupFile) { SettingsRow(icon: "square.and.arrow.up", title: "Guardar a cópia", tint: Theme.signalInk) }
                    }
                    divider
                    Button { importingBackup = true } label: { SettingsRow(icon: "square.and.arrow.down", title: "Importar cópia") }
                        .disabled(backupBusy || !model.sessionAvailable)
                    if legacyKey {
                        divider
                        Button { LegacyIntegrationKey.remove(); legacyKey = LegacyIntegrationKey.exists } label: {
                            SettingsRow(icon: "key", title: "Apagar chave da integração antiga", tint: Theme.loss)
                        }
                    }
                }
                footnote(backupMessage ?? "Cada check completo fica guardado neste iPhone. Exporta uma cópia antes de reinstalar a app. Importar só acrescenta o que falta; nada é substituído.")
                group("Ajuda") {
                    NavigationLink(value: "diagnostics") { SettingsRow(icon: "stethoscope", title: "Diagnóstico") }
                    divider
                    Button {
                        UIPasteboard.general.string = model.problemsReport
                        model.notice = "Erros e avisos copiados (\(model.events.filter { ["warn", "error"].contains($0.level) }.count))."
                    } label: { SettingsRow(icon: "doc.on.doc", title: "Copiar só erros e avisos") }
                    divider
                    ShareLink(item: model.diagnosticReport) { SettingsRow(icon: "square.and.arrow.up", title: "Enviar diagnóstico completo") }
                    divider
                    SettingsRow(icon: "info.circle", title: "Versão", value: version)
                }
                footnote("O diagnóstico não inclui palavras-passe, cookies nem conteúdos de mensagens. O FollowCheck não tem servidores: os dados ficam neste iPhone.")
            }
            .navigationDestination(for: String.self) { destination in
                switch destination {
                case "pace": PaceScreen(model: model)
                default: DiagnosticScreen(model: model)
                }
            }
        }
        .fileImporter(isPresented: $importingBackup, allowedContentTypes: [.json]) { result in
            do {
                let url = try result.get(); let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
                guard (try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) <= 40 * 1024 * 1024 else { backupMessage = "A cópia excede 40 MB."; return }
                let data = try Data(contentsOf: url)
                Task {
                    backupBusy = true; defer { backupBusy = false }
                    do { try await model.importScanBackup(data); backupMessage = "Dados em falta recuperados. O que já existia foi mantido." } catch { backupMessage = error.localizedDescription }
                }
            } catch { backupMessage = error.localizedDescription }
        }
        .confirmationDialog("Já concluíste a verificação no Instagram?", isPresented: $confirmSession, titleVisibility: .visible) {
            Button("Reavaliar a sessão", action: model.confirmSession)
        }
        .onAppear {
            #if DEBUG
            if PreviewFlags.has("--preview-settings-pace") { path = ["pace"] }
            if PreviewFlags.has("--preview-settings-diagnostics") { path = ["diagnostics"] }
            #endif
        }
    }

    private var accountCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                ProfileAvatar(photoURL: model.profilePhotoURL, size: 56, name: model.username)
                VStack(alignment: .leading, spacing: 4) {
                    Text(model.username.isEmpty ? "Sem conta ligada" : "@" + model.username).font(.title3.weight(.bold)).foregroundStyle(Theme.ink)
                    StatusPill(text: model.sessionAvailable ? "Sessão ativa neste iPhone" : "Sessão por confirmar", tone: model.sessionAvailable ? .gain : .caution)
                }
            }
            HStack(spacing: 8) {
                Button("Instagram", systemImage: "arrow.up.forward.app", action: model.openInstagram).buttonStyle(QuietButtonStyle(fill: true))
                Button("Mensagens", systemImage: "paperplane", action: model.openInstagramMessages).buttonStyle(QuietButtonStyle(fill: true))
                    .disabled(!model.sessionAvailable)
            }
            if model.safetyBlocked && model.activeCooldown == nil {
                Button("Já confirmei a conta no Instagram", systemImage: "checkmark.shield") { confirmSession = true }
                    .buttonStyle(ProminentButtonStyle())
            }
            Text("Para trocar de conta ou terminar sessão, usa o Instagram. Cada conta tem os seus dados separados.")
                .font(.caption).foregroundStyle(Theme.ink2)
        }
        .surface(padding: 16, radius: 22)
    }

    private var divider: some View { Divider().overlay(Theme.line).padding(.leading, 50) }
    private func footnote(_ text: String) -> some View {
        Text(text).font(.caption).foregroundStyle(Theme.ink2).padding(.horizontal, 4).padding(.top, -12).fixedSize(horizontal: false, vertical: true)
    }
    private func group<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Eyebrow(text: title).padding(.horizontal, 4)
            VStack(spacing: 0) { content() }
                .buttonStyle(.plain)
                .surface(padding: 0, radius: 18)
        }
    }
}

struct SettingsLabel: View {
    let icon: String
    let title: String
    var tint: Color = Theme.ink
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.system(size: 15, weight: .medium)).frame(width: 24).foregroundStyle(tint == Theme.ink ? Theme.ink2 : tint)
            Text(title).font(.subheadline.weight(.medium)).foregroundStyle(tint)
        }
        .padding(.leading, 14).frame(minHeight: 50)
    }
}

struct SettingsRow<Trailing: View>: View {
    let icon: String
    let title: String
    var tint: Color = Theme.ink
    @ViewBuilder var trailing: () -> Trailing
    var body: some View {
        HStack {
            SettingsLabel(icon: icon, title: title, tint: tint)
            Spacer()
            trailing().font(.subheadline)
        }
        .padding(.trailing, 14)
        .contentShape(Rectangle())
    }
}

extension SettingsRow where Trailing == AnyView {
    init(icon: String, title: String, value: String? = nil, tint: Color = Theme.ink) {
        self.init(icon: icon, title: title, tint: tint) {
            AnyView(HStack(spacing: 8) {
                if let value { Text(value).foregroundStyle(Theme.ink2) }
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3)
            })
        }
    }
}

// MARK: - Pace

/// Preset over the stored per-scope limits. Values: seconds between pages, pages between pauses, pause seconds.
enum PacePreset: String, CaseIterable, Identifiable {
    case balanced, careful, slow, custom
    var id: String { rawValue }
    var title: String {
        switch self {
        case .balanced: return "Equilibrado"
        case .careful: return "Cuidadoso"
        case .slow: return "Lento"
        case .custom: return "Personalizado"
        }
    }
    var detail: String {
        switch self {
        case .balanced: return "Recomendado para a tua conta. Cerca de 2 s entre páginas e uma pausa a cada 12."
        case .careful: return "Mais espaçado. Bom para a Watchlist ou depois de um aviso do Instagram."
        case .slow: return "O mais seguro. Um check grande pode demorar vários minutos."
        case .custom: return "Valores escolhidos à mão."
        }
    }
    /// (own delay, own every, own pause, watch delay, watch every, watch pause)
    var values: [Int]? {
        switch self {
        case .balanced: return [2, 12, 20, 3, 10, 30]
        case .careful: return [3, 10, 30, 4, 8, 40]
        case .slow: return [5, 6, 45, 6, 5, 60]
        case .custom: return nil
        }
    }
    static let keys = ["ownDelay", "ownEvery", "ownPause", "watchDelay", "watchEvery", "watchPause"].map { "followcheck.limits." + $0 }
    static var current: PacePreset {
        let defaults = UserDefaults.standard
        let fallback = [2, 12, 20, 3, 10, 30]
        let stored = keys.enumerated().map { index, key in (defaults.object(forKey: key) as? NSNumber)?.intValue ?? fallback[index] }
        return allCases.first { $0.values == stored } ?? .custom
    }
    func apply() {
        guard let values else { return }
        for (key, value) in zip(Self.keys, values) { UserDefaults.standard.set(value, forKey: key) }
    }
}

private struct PaceScreen: View {
    let model: AppModel
    @State private var preset = PacePreset.current
    @State private var message: String?
    @AppStorage("followcheck.limits.cooldownMinutes") private var cooldownMinutes = 60
    @AppStorage("followcheck.limits.batch") private var batch = 20
    @AppStorage("followcheck.limits.daily") private var daily = 50
    @AppStorage("followcheck.limits.actionDelay") private var actionDelay = 4
    @AppStorage("followcheck.limits.actionEvery") private var actionEvery = 5
    @AppStorage("followcheck.limits.actionPause") private var actionPause = 300
    @AppStorage("followcheck.limits.ownDelay") private var ownDelay = 2
    @AppStorage("followcheck.limits.ownEvery") private var ownEvery = 12
    @AppStorage("followcheck.limits.ownPause") private var ownPause = 20
    @AppStorage("followcheck.limits.ownGap") private var ownGap = 60
    @AppStorage("followcheck.limits.manualGap") private var manualGap = false
    @AppStorage("followcheck.limits.watchDelay") private var watchDelay = 3
    @AppStorage("followcheck.limits.watchEvery") private var watchEvery = 10
    @AppStorage("followcheck.limits.watchPause") private var watchPause = 30

    var body: some View {
        Form {
            Section {
                ForEach(PacePreset.allCases.filter { $0 != .custom }) { option in
                    Button { preset = option; option.apply(); apply() } label: {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: preset == option ? "checkmark.circle.fill" : "circle").font(.title3)
                                .foregroundStyle(preset == option ? Theme.signalInk : Theme.ink3)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(option.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                                Text(option.detail).font(.footnote).foregroundStyle(Theme.ink2)
                            }
                        }
                    }
                    .accessibilityAddTraits(preset == option ? .isSelected : [])
                }
                if preset == .custom { Text("A usar valores personalizados (em baixo).").font(.footnote).foregroundStyle(Theme.ink2) }
            } header: { Text("Ritmo") } footer: {
                Text("Nenhum ritmo garante que o Instagram não limite a conta. Um ritmo mais lento reduz o risco, sobretudo em listas grandes.")
            }
            .listRowBackground(Theme.surface)

            Section {
                Picker("Duração da pausa", selection: $cooldownMinutes) {
                    ForEach(Array(Set([1, 5, 15, 30, 60, 120, 360, 720, 1440, cooldownMinutes])).sorted(), id: \.self) { Text(RelativeTime.interval($0)).tag($0) }
                }
                .onChange(of: cooldownMinutes) { _, minutes in
                    Task { do { try await model.configureCooldown(minutes: minutes); message = "Duração guardada." } catch { message = error.localizedDescription } }
                }
                if let until = model.activeCooldown {
                    LabeledContent("Pausa atual termina") { Text(until, style: .relative).monospacedDigit() }
                    if model.serverCooldownUntil.map({ $0 > Date() }) != true {
                        Button("Terminar pausa agora", role: .destructive) { Task { await model.endPause() } }
                    }
                }
            } header: { Text("Pausa depois de um aviso do Instagram") } footer: {
                Text("Quando o Instagram pede para abrandar, os checks param durante este tempo. Podes terminar a pausa quando quiseres. Só um prazo enviado pelo próprio Instagram não pode ser encurtado pela app.")
            }
            .listRowBackground(Theme.surface)

            Section {
                Toggle("Sem limite de perfis nem de ações por dia", isOn: Binding(get: { batch >= 10000 && daily >= 10000 }, set: { off in
                    if off { batch = 10000; daily = 10000 } else { batch = 50; daily = 150 }
                }))
                if batch < 10000 || daily < 10000 {
                    Stepper("Até \(batch) perfis por fila", value: $batch, in: 1...10000, step: batch < 50 ? 5 : 25)
                    Stepper("Até \(daily) ações por 24 h", value: $daily, in: 1...10000, step: daily < 50 ? 5 : 25)
                }
                Stepper("\(actionDelay) s entre ações", value: $actionDelay, in: 2...120)
                Stepper(actionEvery == 0 ? "Sem pausa longa" : "Pausa longa a cada \(actionEvery)", value: $actionEvery, in: 0...50)
                if actionEvery > 0 {
                    Stepper("Pausa longa de \(RelativeTime.interval(max(1, actionPause / 60)))", value: $actionPause, in: 60...600, step: 30)
                }
            } header: { Text("Ações sobre perfis") } footer: {
                Text("Sem limites, a fila só para quando terminar, quando a parares ou quando o Instagram recusar uma ação. As pausas entre ações continuam a aplicar-se; quanto mais curtas, maior o risco.")
            }
            .listRowBackground(Theme.surface)

            Section {
                DisclosureGroup("A minha conta") {
                    Stepper("\(ownDelay) s entre páginas", value: $ownDelay, in: 1...60).onChange(of: ownDelay) { _, _ in preset = PacePreset.current }
                    Stepper(ownEvery == 0 ? "Sem pausa" : "Pausa a cada \(ownEvery) páginas", value: $ownEvery, in: 0...50).onChange(of: ownEvery) { _, _ in preset = PacePreset.current }
                    Stepper("Pausa de \(ownPause) s", value: $ownPause, in: 0...600, step: 5).onChange(of: ownPause) { _, _ in preset = PacePreset.current }
                    Stepper("Intervalo automático: \(RelativeTime.interval(max(ownGap, 1)))", value: $ownGap, in: 0...1440, step: 15)
                    Toggle("Aplicar também a checks manuais", isOn: $manualGap)
                }
                DisclosureGroup("Watchlist") {
                    Stepper("\(watchDelay) s entre páginas", value: $watchDelay, in: 1...60).onChange(of: watchDelay) { _, _ in preset = PacePreset.current }
                    Stepper(watchEvery == 0 ? "Sem pausa" : "Pausa a cada \(watchEvery) páginas", value: $watchEvery, in: 0...50).onChange(of: watchEvery) { _, _ in preset = PacePreset.current }
                    Stepper("Pausa de \(watchPause) s", value: $watchPause, in: 0...600, step: 5).onChange(of: watchPause) { _, _ in preset = PacePreset.current }
                }
            } header: { Text("Avançado") }
            .listRowBackground(Theme.surface)

            if let message { Section { Text(message).font(.footnote).foregroundStyle(Theme.ink2) }.listRowBackground(Theme.surface) }
        }
        .fcForm()
        .tint(Theme.signalInk)
        .navigationTitle("Ritmo").navigationBarTitleDisplayMode(.inline)
        .onDisappear(perform: apply)
    }

    private func apply() {
        Task {
            do {
                try await model.applyPacing()
                message = model.sessionAvailable ? "Aplicado aos próximos checks." : "Guardado. Aplica-se quando a sessão estiver disponível."
            } catch { message = error.localizedDescription }
        }
    }
}

// MARK: - Diagnostics

private struct DiagnosticScreen: View {
    let model: AppModel
    @State private var onlyProblems = false
    @State private var clearing = false
    private var events: [AppModel.DiagnosticEvent] { model.events.reversed().filter { !onlyProblems || ["warn", "error"].contains($0.level) } }

    var body: some View {
        List {
            Section {
                Toggle("Só avisos e erros", isOn: $onlyProblems)
                Button(model.diagnosticsRefreshing ? "A recolher…" : "Atualizar do motor") { Task { await model.refreshDiagnostics() } }
                    .disabled(model.diagnosticsRefreshing)
            } footer: { Text("Reproduz o problema e depois envia o diagnóstico. O relatório inclui todos os eventos, mesmo com o filtro ativo.") }
            .listRowBackground(Theme.surface)
            Section {
                if events.isEmpty { Text("Sem eventos.").foregroundStyle(Theme.ink2) }
                ForEach(events) { event in
                    HStack(alignment: .top, spacing: 10) {
                        Circle().fill(event.level == "error" ? Theme.loss : event.level == "warn" ? Theme.caution : Theme.ink3).frame(width: 7, height: 7).padding(.top, 6)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(event.message).font(.footnote).foregroundStyle(Theme.ink).textSelection(.enabled)
                            if let details = event.details {
                                DisclosureGroup("Detalhes") { Text(details).font(.caption2.monospaced()).foregroundStyle(Theme.ink2).textSelection(.enabled) }
                                    .font(.caption)
                            }
                            Text(event.date, format: .dateTime.day().month().hour().minute().second()).font(.caption2).foregroundStyle(Theme.ink3)
                        }
                    }
                }
            }
            .listRowBackground(Theme.surface)
        }
        .fcForm()
        .navigationTitle("Diagnóstico").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button("Copiar só erros e avisos", systemImage: "doc.on.doc") { UIPasteboard.general.string = model.problemsReport }
                    ShareLink(item: model.problemsReport) { Label("Enviar só erros e avisos", systemImage: "exclamationmark.triangle") }
                    ShareLink(item: model.diagnosticReport) { Label("Enviar tudo", systemImage: "square.and.arrow.up") }
                    Button("Limpar eventos", systemImage: "trash", role: .destructive) { clearing = true }
                } label: { Image(systemName: "ellipsis.circle") }
            }
        }
        .confirmationDialog("Limpar os eventos de diagnóstico?", isPresented: $clearing, titleVisibility: .visible) {
            Button("Limpar", role: .destructive, action: model.clearLogs)
        }
        .task { await model.refreshDiagnostics() }
    }
}

/// The professional integration was removed in 2.6. Its API key may still sit in the Keychain;
/// it is left untouched until the user chooses to delete it.
enum LegacyIntegrationKey {
    private static let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "ch.dannysantos.followcheck.zernio", kSecAttrAccount as String: "api-key"]
    static var exists: Bool { SecItemCopyMatching(query as CFDictionary, nil) == errSecSuccess }
    static func remove() {
        SecItemDelete(query as CFDictionary)
        UserDefaults.standard.removeObject(forKey: "followcheck.integration.config")
    }
}
