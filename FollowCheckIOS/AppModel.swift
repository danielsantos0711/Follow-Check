import BackgroundTasks
import Observation
import SwiftUI
import UserNotifications

@MainActor @Observable
final class AppModel {
    enum Phase: Equatable { case starting, loadingInstagram, ready, failed(String) }
    enum Screen: String, CaseIterable { case home, relations, inbox, watchlist, activity, tools, instagram }
    struct DiagnosticEvent: Identifiable, Codable {
        var id = UUID().uuidString
        var date = Date()
        var level = "info"
        let message: String
        var details: String? = nil
    }
    struct Snapshot: Codable {
        let accountId: String
        let followers: Int
        let following: Int
        let mutuals: Int
        let nonFollowers: Int
        let newChanges: Int?
        let lastScanAt: String
        init(_ value: [String: Any]) {
            accountId = value["accountId"] as? String ?? ""
            followers = max(0, (value["followers"] as? NSNumber)?.intValue ?? 0)
            following = max(0, (value["following"] as? NSNumber)?.intValue ?? 0)
            mutuals = max(0, (value["mutuals"] as? NSNumber)?.intValue ?? 0)
            newChanges = (value["newChanges"] as? NSNumber)?.intValue
            nonFollowers = max(0, (value["nonFollowers"] as? NSNumber)?.intValue ?? 0)
            lastScanAt = value["lastScanAt"] as? String ?? ""
        }
    }
    struct WatchTarget: Identifiable {
        let id: String
        let username: String
        let enabled: Bool
        let photoURL: String
        let running: Bool
        let baselineReady: Bool
        let comparisonReady: Bool
        let followers: Int
        let following: Int
        let intervalMinutes: Int
        let lastSuccess: Date?
        let error: String
        init(_ v: [String: Any]) {
            id = v["id"] as? String ?? ""
            username = v["username"] as? String ?? ""
            photoURL = v["profilePicUrl"] as? String ?? v["profile_pic_url"] as? String ?? ""
            enabled = v["enabled"] as? Bool ?? false
            running = v["running"] as? Bool ?? false
            baselineReady = v["baselineReady"] as? Bool ?? false
            comparisonReady = v["coverageVerified"] as? Bool == true && (v["lastError"] as? String ?? "").isEmpty
            followers = (v["followers"] as? NSNumber)?.intValue ?? 0
            following = (v["following"] as? NSNumber)?.intValue ?? 0
            intervalMinutes = (v["intervalMinutes"] as? NSNumber)?.intValue ?? 1440
            let ms = (v["lastSuccessAt"] as? NSNumber)?.doubleValue ?? 0
            lastSuccess = ms > 0 ? Date(timeIntervalSince1970: ms / 1000) : nil
            error = AppModel.redact(v["lastError"] as? String ?? "")
        }
    }
    struct Relation: Identifiable {
        let id: String
        let username: String
        let name: String
        let photoURL: String
        let follows: Bool
        let following: Bool
        func matches(_ filter: String) -> Bool {
            switch filter {
            case "Não me seguem": return following && !follows
            case "Eu não sigo": return follows && !following
            case "Mútuos": return follows && following
            case "Seguidores": return follows
            case "A seguir": return following
            default: return true
            }
        }
        func canPerform(_ action: String) -> Bool {
            switch action {
            case "follow": return !following
            case "unfollow", "mute": return following
            case "removeFollower": return follows
            case "disconnect": return follows && following
            default: return false
            }
        }
        init(_ v: [String: Any]) {
            id = v["id"] as? String ?? ""
            username = v["username"] as? String ?? ""
            name = v["name"] as? String ?? ""
            photoURL = v["photoURL"] as? String ?? ""
            follows = v["follows"] as? Bool ?? false
            following = v["following"] as? Bool ?? false
        }
    }
    struct Conversation: Identifiable {
        let id: String
        let title: String
        let preview: String
        let photoURL: String
        init(_ v: [String: Any]) {
            id = String(describing: v["thread_id"] ?? v["id"] ?? "")
            let users = v["users"] as? [[String: Any]] ?? []
            let names = users.compactMap { $0["username"] as? String }.joined(separator: ", ")
            title = (v["thread_title"] as? String ?? v["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? names
            preview = v["lastMessage"] as? String ?? ((v["items"] as? [[String: Any]])?.first?["text"] as? String) ?? "Abrir conversa"
            photoURL = v["imageUrl"] as? String ?? users.first?["profile_pic_url"] as? String ?? ""
        }
    }
    struct DirectMessage: Identifiable {
        let id: String
        let text: String
        let own: Bool
        init(_ v: [String: Any], owner: String) {
            id = String(describing: v["item_id"] ?? "")
            text = v["text"] as? String ?? "Conteúdo multimédia · disponível no Instagram"
            own = String(describing: v["user_id"] ?? "") == owner
        }
    }
    struct WatchEvent: Identifiable {
        let id: String
        let targetId: String
        let title: String
        let detail: String
        let date: Date
        let username: String
        let fullName: String
        let photoURL: String
        let type: String
        let comparisonVerified: Bool
        var isWatchChange: Bool {
            comparisonVerified && ["watch_new_follower", "watch_lost_follower", "watch_started_following", "watch_stopped_following", "watch_account_unavailable", "watch_profile_change"].contains(type)
        }
        init(_ value: [String:Any]) {
            id=value["id"] as? String ?? ""
            targetId=value["targetId"] as? String ?? ""
            title=value["title"] as? String ?? "Alteração"
            detail=value["detail"] as? String ?? ""
            username=value["username"] as? String ?? ""
            fullName=value["fullName"] as? String ?? ""
            photoURL=value["profilePicUrl"] as? String ?? ""
            type=value["type"] as? String ?? ""
            comparisonVerified=value["coverageVerified"] as? Bool ?? false
            date=Date(timeIntervalSince1970:((value["timestamp"] as? NSNumber)?.doubleValue ?? 0)/1000)
        }
    }
    var watchEvents: [WatchEvent] = []
    var accountEvents: [WatchEvent] = []
    var activeCheckScope = ""
    var ownCheckRunning: Bool { activeCheckScope == "account" }
    var watchCheckRunning: Bool { activeCheckScope == "watchlist" }
    var watchProgress: Double?
    var watchStatus = "Watchlist pronta"
    var watchDetail = ""
    var checkIsRunning: Bool { activeCheckScope == "account" || activeCheckScope == "watchlist" }
    var watchlistAccounts: [Relation] = []
    var watchlistListTarget = ""
    var watchlistListRelation = "followers"
    var watchlistListMore = false
    var conversations: [Conversation] = []
    var directMessages: [DirectMessage] = []
    var inboxLoading = false
    var inboxKind = "inbox"
    var inboxCursor = ""
    var inboxHasMore = false
    var inboxLoaded = false
    var inboxUnavailable = false
    var inboxWebMode = false
    var openThread = ""
    var relations: [Relation] = []
    var relationsReady = false
    var relationsLoading = false
    var confirmingSession = false
    var safetyReason = ""
    var cooldownUntil: Date?
    var serverCooldownUntil: Date?
    var isPreview: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.arguments.contains { $0.hasPrefix("--preview-") }
        #else
        return false
        #endif
    }
    @ObservationIgnored lazy var tools = NativeToolsStore(model: self)
    var phase: Phase = .starting
    var screen: Screen = .home
    var requestedRelationFilter = "Não me seguem"
    var statusText = "A recuperar a tua sessão"
    var legacyProgress = ""
    var detailText = "Os dados da sessão permanecem neste iPhone."
    var canGoBack = false
    var isPanelOpen = false
    var isBusy = false
    var isScanning = false
    var currentURL = ""
    var requiresAuthentication = false
    var accountId = ""
    var username = ""
    var profilePhotoURL = ""
    var sessionAvailable = false
    var safetyBlocked = false
    var watchlistBlocked = false
    var paused = false
    var schedulerEnabled = false
    var progress: Double?
    var snapshot: Snapshot?
    var targets: [WatchTarget] = []
    var events: [DiagnosticEvent] = []
    var notice: String?
    var watchlistBusy = false
    private static let fractionalISO: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let plainISO = ISO8601DateFormatter()
    var lastCompletedCheck: Date? {
        guard let raw = snapshot?.lastScanAt else { return nil }
        return Self.fractionalISO.date(from: raw) ?? Self.plainISO.date(from: raw)
    }
    var canScanWatchlist: Bool { phase == .ready && sessionAvailable && !requiresAuthentication && !watchlistBlocked && (!isScanning || activeCheckScope == "account") }
    var canScan: Bool { phase == .ready && sessionAvailable && !requiresAuthentication && (!isScanning || activeCheckScope == "watchlist") && !paused && !safetyBlocked }
    var canReadInbox: Bool { phase == .ready && sessionAvailable && !requiresAuthentication && !isScanning && !watchlistBusy && !safetyBlocked }
    @ObservationIgnored weak var webCoordinator: FollowCheckWebCoordinator?
    @ObservationIgnored private var persistenceTask: Task<Void, Never>?
    private let eventsKey = "followcheck.native.events.v2"

    init() {
        let defaults=UserDefaults.standard
        if !defaults.bool(forKey:"followcheck.referencePacing.v219") {
            for scope in ["own","watch"] {
                let keys=[scope+"Delay",scope+"Every",scope+"Pause"]
                let old=[5,5,30]
                if zip(keys,old).allSatisfy({ key,value in defaults.object(forKey:"followcheck.limits."+key) == nil || defaults.integer(forKey:"followcheck.limits."+key) == value }) {
                    for (key,value) in zip(keys,[1,15,10]) {defaults.set(value,forKey:"followcheck.limits."+key)}
                }
            }
            let actionKeys=["actionDelay","actionEvery","actionPause"]
            if zip(actionKeys,[10,5,30]).allSatisfy({key,value in defaults.object(forKey:"followcheck.limits."+key) == nil || defaults.integer(forKey:"followcheck.limits."+key) == value}) {
                for (key,value) in zip(actionKeys,[4,5,300]) {defaults.set(value,forKey:"followcheck.limits."+key)}
            }
            defaults.set(true,forKey:"followcheck.referencePacing.v219")
        }
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--preview-tools") { screen = .tools }
        if ProcessInfo.processInfo.arguments.contains("--preview-cleanup") { screen = .tools }
        if ProcessInfo.processInfo.arguments.contains(where:{["--preview-intelligence","--preview-calendar","--preview-operations","--preview-memories"].contains($0)}) {screen = .tools}
        if ProcessInfo.processInfo.arguments.contains("--preview-relations") { screen = .relations }
        if ProcessInfo.processInfo.arguments.contains("--preview-watchlist") { screen = .watchlist }
        if ProcessInfo.processInfo.arguments.contains("--preview-activity") { screen = .activity }
        if isPreview { loadPreviewData(ProcessInfo.processInfo.arguments) }
        #endif
        if let data = UserDefaults.standard.data(forKey: eventsKey),
           let saved = try? JSONDecoder().decode([DiagnosticEvent].self, from: data) { events = Array(saved.suffix(1000)) }
    }
    nonisolated static func redact(_ value: String) -> String {
        var text = String(value.prefix(2000))
        for pattern in ["https?://[^\\s]+", "(?i)Bearer\\s+[A-Za-z0-9._~+/=:-]+", "(?i)(sessionid|csrftoken|password|token|authorization|cookie)[\\\"']?\\s*[:=]\\s*[^\\s,;}]+"] {
            text = text.replacingOccurrences(of: pattern, with: "[REMOVIDO]", options: .regularExpression)
        }
        return String(text.prefix(600))
    }
    func record(_ message: String, level: String = "info") {
        let safe = Self.redact(message)
        if events.last?.message == safe, let date = events.last?.date, Date().timeIntervalSince(date) < 2 { return }
        events.append(DiagnosticEvent(level: level, message: safe))
        events = Array(events.suffix(1000))
        persistenceTask?.cancel()
        persistenceTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled else { return }
            self?.persistEvents()
        }
    }
    func persistEvents() {
        if let data = try? JSONEncoder().encode(events) { UserDefaults.standard.set(data, forKey: eventsKey) }
    }
    var diagnosticsRefreshing = false
    var diagnosticsRefreshedAt: Date?
    func refreshDiagnostics() async {
        guard !diagnosticsRefreshing, let coordinator = webCoordinator else { return }
        diagnosticsRefreshing = true
        defer { diagnosticsRefreshing = false }
        do {
            let result = try await coordinator.request("logs")
            controlCompleted("logs", result: result)
            if result["ok"] as? Bool == true { diagnosticsRefreshedAt = Date() }
        } catch { record("Não foi possível atualizar o diagnóstico: \(error.localizedDescription)", level: "warn") }
    }
    static func diagnosticMetadata(_ value: Any, depth: Int = 0) -> Any {
        guard depth <= 6 else { return "[limite]" }
        if let object = value as? [String: Any] {
            var safe: [String: Any] = [:]
            for key in object.keys.sorted().prefix(40) {
                if key.range(of: "cookie|token|password|passwd|authorization|header|body|payload|responseText|username|full_name|photo|pic_url|sessionid|secret", options: [.regularExpression, .caseInsensitive]) != nil { continue }
                safe[String(key.prefix(80))] = diagnosticMetadata(object[key]!, depth: depth + 1)
            }
            return safe
        }
        if let array = value as? [Any] { return array.prefix(24).map { diagnosticMetadata($0, depth: depth + 1) } }
        if let text = value as? String { return redact(text) }
        if value is NSNumber || value is NSNull { return value }
        return "[tipo omitido]"
    }
    var diagnosticReport: String {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—"
        let refreshed = diagnosticsRefreshedAt.map { iso.string(from: $0) } ?? "não atualizado nesta abertura"
        let header = "FollowCheck iOS \(version) (build \(build))\nDiagnóstico v2 | UTC | gerado: \(iso.string(from: Date()))\nSistema: \(ProcessInfo.processInfo.operatingSystemVersionString)\nÚltima atualização do motor: \(refreshed)\nEventos: \(events.count) / 1000; histórico limitado. Sem corpos de resposta nem credenciais.\n"
        return header + events.map { event in
            "\(iso.string(from: event.date)) | \(event.level) | \(event.message)" + (event.details.map { "\n  " + $0 } ?? "")
        }.joined(separator: "\n")
    }
    #if DEBUG
    /// Local design data for simulator screenshots. Never reaches release builds.
    private func loadPreviewData(_ arguments: [String]) {
        accountId = "preview"; username = "marta.lisboa"; sessionAvailable = true; phase = .ready
        statusText = "Sessão disponível"; detailText = "Pronto para verificar o teu círculo."
        let now = Date()
        func ms(_ seconds: Double) -> Double { now.addingTimeInterval(-seconds).timeIntervalSince1970 * 1000 }
        if arguments.contains("--preview-empty") {
            username = ""; sessionAvailable = false; phase = .failed("Sessão por ligar"); return
        }
        snapshot = Snapshot(["accountId": "preview", "followers": 1172, "following": 344, "mutuals": 301, "nonFollowers": 43, "newChanges": 5, "lastScanAt": ISO8601DateFormatter().string(from: now.addingTimeInterval(-7200))])
        if arguments.contains("--preview-checking") {
            isScanning = true; activeCheckScope = "account"; progress = 0.42
            statusText = "A recolher seguidores"; detailText = "492 de 1172 perfis · página 20"
        }
        let names = ["ana.ribeiro", "joao_m", "studio.norte", "ines.costa", "pedro.alves", "cafe.da.esquina", "rita.sousa", "miguel.ferreira", "lisboa.film", "sofia_mendes", "tiago.dias", "carolina.pt", "nuno.arq", "beatriz.lopes"]
        let fullNames = ["Ana Ribeiro", "João Martins", "Studio Norte", "Inês Costa", "Pedro Alves", "Café da Esquina", "Rita Sousa", "Miguel Ferreira", "Lisboa Film Club", "Sofia Mendes", "Tiago Dias", "Carolina", "Nuno · Arquitetura", "Beatriz Lopes"]
        relationsReady = true
        relations = names.indices.map { index in
            Relation(["id": "preview-\(index)", "username": names[index], "name": fullNames[index], "following": index % 4 != 3, "follows": index % 3 != 1])
        }
        targets = [
            WatchTarget(["id": "preview-target", "username": "studio.norte", "enabled": true, "baselineReady": true, "coverageVerified": true, "followers": 5204, "following": 341, "intervalMinutes": 1440, "lastSuccessAt": ms(1800)]),
            WatchTarget(["id": "preview-target-2", "username": "lisboa.film", "enabled": true, "baselineReady": false, "followers": 0, "following": 0, "intervalMinutes": 360]),
        ]
        watchEvents = [
            WatchEvent(["id": "w1", "targetId": "preview-target", "type": "watch_new_follower", "title": "Novo seguidor", "username": "rita.sousa", "fullName": "Rita Sousa", "coverageVerified": true, "timestamp": ms(1800)]),
            WatchEvent(["id": "w2", "targetId": "preview-target", "type": "watch_stopped_following", "title": "Deixou de seguir", "username": "cafe.da.esquina", "fullName": "Café da Esquina", "coverageVerified": true, "timestamp": ms(1800)]),
        ]
        accountEvents = [
            WatchEvent(["id": "a1", "type": "new_follower", "title": "Novo seguidor", "username": "ines.costa", "fullName": "Inês Costa", "detail": "Observado no último check completo.", "timestamp": ms(7200)]),
            WatchEvent(["id": "a2", "type": "unfollow_confirmed", "title": "Deixou de te seguir", "username": "pedro.alves", "fullName": "Pedro Alves", "detail": "Ausente em dois checks consecutivos.", "timestamp": ms(7300)]),
            WatchEvent(["id": "a3", "type": "new_follower", "title": "Novo seguidor", "username": "tiago.dias", "fullName": "Tiago Dias", "detail": "Observado no último check completo.", "timestamp": ms(7400)]),
            WatchEvent(["id": "a4", "type": "account_unavailable", "title": "Conta indisponível", "username": "lisboa.film", "fullName": "Lisboa Film Club", "detail": "O perfil deixou de estar acessível.", "timestamp": ms(90000)]),
            WatchEvent(["id": "a5", "type": "unfollow_confirmed", "title": "Deixou de te seguir", "username": "nuno.arq", "fullName": "Nuno · Arquitetura", "detail": "Ausente em dois checks consecutivos.", "timestamp": ms(95000)]),
        ]
    }
    #endif
    /// Pull-to-refresh: re-read the engine state and the saved relations.
    func refreshState() {
        guard !isPreview else { return }
        webCoordinator?.control("state")
        loadRelations()
    }
    func clearLogs() { events.removeAll(); persistEvents(); webCoordinator?.control("clearLogs") }
    func attach(_ coordinator: FollowCheckWebCoordinator) { webCoordinator = coordinator }
    /// The last check whose changes were opened in Activity, per account.
    var seenActivityStamp = ""
    var hasUnseenActivity: Bool {
        guard let snapshot, (snapshot.newChanges ?? 0) > 0, !accountId.isEmpty else { return false }
        let seen = seenActivityStamp.isEmpty ? UserDefaults.standard.string(forKey: "followcheck.activity.seen.\(accountId)") ?? "" : seenActivityStamp
        return seen != snapshot.lastScanAt
    }
    func select(_ destination: Screen) {
        if destination == .relations { loadRelations() }
        screen = destination
        if destination == .activity, let stamp = snapshot?.lastScanAt, !accountId.isEmpty {
            seenActivityStamp = stamp
            UserDefaults.standard.set(stamp, forKey: "followcheck.activity.seen.\(accountId)")
        }
        if destination == .activity { webCoordinator?.control("logs") }
        if destination == .watchlist { webCoordinator?.control("state") }
    }
    func loadInbox(threadId: String = "", more: Bool = false) {
        guard !inboxLoading, canReadInbox, let coordinator = webCoordinator else { return }
        inboxWebMode = false
        inboxLoading = true
        if openThread != threadId { directMessages = [] }
        openThread = threadId
        coordinator.control("inbox", args: ["threadId": threadId,"kind":inboxKind,"cursor":more ? inboxCursor:""])
    }
    func loadRelations() {
        guard !isPreview else { return }
        guard !relationsLoading else { return }
        relationsLoading = true
        webCoordinator?.control("relations")
    }
    func confirmSession() {
        guard !confirmingSession else { return }
        confirmingSession = true
        webCoordinator?.control("confirmSession")
    }
    func openPanel() { select(.relations) }
    func cancelCurrentScan() { CheckContinuation.shared.finish(success:false);webCoordinator?.control("cancelCurrent") }
    func openInstagram() { screen = .instagram; webCoordinator?.openInstagramHome() }
    func openInstagramInbox() {
        guard !checkIsRunning else {notice="Pára o check atual antes de abrir as mensagens na sessão Instagram.";return}
        inboxWebMode = true
        screen = .inbox
        webCoordinator?.openInstagramInbox()
    }
    func reload() { webCoordinator?.reload() }
    func goBack() { webCoordinator?.goBack() }
    func closePanel() { webCoordinator?.closeFollowCheck(); screen = .home }
    func scan() {
        guard canScan else { return }
        isScanning = true; progress = nil
        statusText = "A preparar o check"; detailText = "O último resultado completo mantém-se até à conclusão."
        record("Check manual solicitado.")
        beginCheckContinuation()
        webCoordinator?.control("scan")
    }
    func setPaused(_ value: Bool) { webCoordinator?.control("pause", args: ["paused": value]) }
    func setScheduler(_ value: Bool) { webCoordinator?.control("schedule", args: ["enabled": value]) }
    func loadWatchlistList(_ target: String, relation: String, more: Bool = false) {
        guard !watchlistBusy else { return }
        if !more { watchlistAccounts = []; watchlistListMore = false }
        watchlistListTarget = target; watchlistListRelation = relation
        watchlist("list", args: ["targetId": target, "relation": relation, "offset": more ? watchlistAccounts.count : 0, "limit": 100])
    }
    func watchlist(_ action: String, args: [String: Any] = [:]) {
        guard !watchlistBusy else { return }
        if action == "run" { beginCheckContinuation() }
        watchlistBusy = true
        var arguments = args; arguments["action"] = action
        webCoordinator?.control("watchlist", args: arguments)
    }
    func showError(_ message: String) {
        notice = Self.redact(message); isBusy = false
        record(message, level: "error")
    }
    func scenePhaseChanged(_ value: ScenePhase) {
        switch value {
        case .active:
            AppDelegate.cancelRefresh()
            webCoordinator?.resume()
        case .background:
            tools.operationPaused = true
            let continuing=checkIsRunning && CheckContinuation.shared.canContinue
            webCoordinator?.backgroundChecks(continuing)
            persistEvents()
            if !continuing {
                CheckContinuation.shared.finish(success:false)
                activeCheckScope = ""
                if isScanning {record("Check em espera; as páginas validadas serão retomadas ao regressar.")}
                isScanning=false;watchlistBusy=false;progress=nil
            } else {record("Continuação do check autorizada pelo iOS; a execução depende da disponibilidade do WebKit.")}
            inboxLoading=false;relationsLoading=false;confirmingSession=false
        case .inactive: break
        @unknown default: break
        }
    }
    private func beginCheckContinuation() {
        CheckContinuation.shared.begin(title:"FollowCheck · verificar alterações") { [weak self] in
            guard let self else{return}
            self.webCoordinator?.backgroundChecks(false)
            self.record("O iOS terminou o tempo de execução. O check retoma ao regressar.")
        }
    }
    func requestNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            Task { @MainActor [weak self] in
                if granted { AppDelegate.scheduleRefresh() }
                else { self?.notice = "As notificações estão desativadas. Podes ativá-las nas Definições do iPhone." }
            }
        }
    }
    func pageStarted(url: URL?) {
        activeCheckScope = ""
        requiresAuthentication = true; sessionAvailable = false; isScanning = false; watchlistBusy = false; progress = nil
        relationsLoading = false; inboxLoading = false; confirmingSession = false
        phase = .loadingInstagram; currentURL = url?.absoluteString ?? ""
        statusText = "A abrir a sessão"; record("Navegação iniciada.")
    }
    func pageFinished(url: URL?, canGoBack: Bool) {
        phase = .ready; currentURL = url?.absoluteString ?? ""; self.canGoBack = canGoBack
        isBusy = false; record("Navegação concluída.")
    }
    func pageFailed(_ message: String) {
        activeCheckScope = ""
        phase = .failed(Self.redact(message)); statusText = "Ligação interrompida"
        detailText = Self.redact(message); isBusy = false; isScanning = false
        record(message, level: "error")
    }
    func panelOpened() { isPanelOpen = true; isBusy = false; record("Área aberta.") }
    func panelClosed() { isPanelOpen = false; isBusy = false }
    private func acceptSnapshot(_ value: [String: Any]) {
        var enriched = value
        if value["newChanges"] == nil, snapshot?.lastScanAt == value["lastScanAt"] as? String { enriched["newChanges"] = snapshot?.newChanges }
        let next = Snapshot(enriched)
        guard !accountId.isEmpty, next.accountId == accountId, !next.lastScanAt.isEmpty else { return }
        snapshot = next
        if backupStamp != accountId+":"+next.lastScanAt {Task{await saveScanBackup()}}
        if let data = try? JSONEncoder().encode(next) { UserDefaults.standard.set(data, forKey: "followcheck.snapshot.\(accountId)") }
    }
    @ObservationIgnored private var savingBackup = false
    @ObservationIgnored private var backupStamp = ""
    @ObservationIgnored private var recoveredBackupOwner = ""
    @ObservationIgnored private var recoveringBackup = false
    private func backupURL(_ owner: String) throws -> URL {
        guard !owner.isEmpty,owner.allSatisfy(\.isNumber) else {throw NSError(domain:"FollowCheck",code:1,userInfo:[NSLocalizedDescriptionKey:"Confirma primeiro a conta."])}
        let folder=try FileManager.default.url(for:.applicationSupportDirectory,in:.userDomainMask,appropriateFor:nil,create:true).appendingPathComponent("FollowCheckBackups",isDirectory:true)
        try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
        return folder.appendingPathComponent("account-"+owner+".json")
    }
    func saveScanBackup() async {
        guard !savingBackup,sessionAvailable,let coordinator=webCoordinator else{return}
        savingBackup=true;defer{savingBackup=false}
        let owner=accountId
        do {
            let response=try await coordinator.request("backup",args:["accountId":owner])
            guard let backup=response["backup"] as? [String:Any],accountId==owner,
                  let storage=backup["storage"] as? [String:Any],storage["followcheck:monitor:v1:"+owner] != nil else{return}
            let data=try JSONSerialization.data(withJSONObject:backup,options:[.sortedKeys])
            try data.write(to:backupURL(owner),options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication])
            backupStamp=owner+":"+(snapshot?.lastScanAt ?? "")
        } catch {record("Cópia nativa: "+error.localizedDescription,level:"warn")}
    }
    func recoverScanBackup() async {
        guard !recoveringBackup,sessionAvailable,recoveredBackupOwner != accountId,let coordinator=webCoordinator else{return}
        recoveringBackup=true;defer{recoveringBackup=false}
        let owner=accountId
        do {
            let file=try backupURL(owner)
            if FileManager.default.fileExists(atPath:file.path) {
                let data=try Data(contentsOf:file)
                let backup=try JSONSerialization.jsonObject(with:data)
                _ = try await coordinator.request("backup",args:["operation":"restore","accountId":owner,"backup":backup])
            }
            guard owner==accountId else{return}
            recoveredBackupOwner=owner
            loadRelations()
            await saveScanBackup()
        } catch {record("Recuperação da cópia: "+error.localizedDescription,level:"warn")}
    }
    func exportScanBackup() async throws -> URL {
        await saveScanBackup()
        let source=try backupURL(accountId)
        guard FileManager.default.fileExists(atPath:source.path) else {throw NSError(domain:"FollowCheck",code:1,userInfo:[NSLocalizedDescriptionKey:"Ainda não existe um check completo guardado nesta conta."])}
        let output=FileManager.default.temporaryDirectory.appendingPathComponent("FollowCheck-backup-"+accountId+".json")
        try Data(contentsOf:source).write(to:output,options:.atomic)
        return output
    }
    func importScanBackup(_ data: Data) async throws {
        guard data.count <= 40*1024*1024,let coordinator=webCoordinator else{throw NSError(domain:"FollowCheck",code:1,userInfo:[NSLocalizedDescriptionKey:"Cópia demasiado grande ou sessão indisponível."])}
        let backup=try JSONSerialization.jsonObject(with:data)
        _ = try await coordinator.request("backup",args:["operation":"restore","accountId":accountId,"backup":backup])
        await saveScanBackup();loadRelations()
    }
    @ObservationIgnored private var appliedPacing = ""
    func configureCooldown(minutes:Int,release:Bool=false) async throws {
        guard let coordinator=webCoordinator,sessionAvailable else {throw NSError(domain:"FollowCheck",code:1,userInfo:[NSLocalizedDescriptionKey:"Liga a sessão para aplicar esta preferência."])}
        _ = try await coordinator.request("cooldown",args:["minutes":minutes,"release":release])
    }
    func applyPacing() async throws {
        let defaults=UserDefaults.standard
        func value(_ key: String,_ fallback: Double) -> Double {(defaults.object(forKey:"followcheck.limits."+key) as? NSNumber)?.doubleValue ?? fallback}
        func pacing(_ scope:String)->[String:Any] {
            let delay=value(scope+"Delay",1)*1000
            return ["pageDelayMinMs":delay+300,"pageDelayMaxMs":delay+1300,"pauseEveryPages":value(scope+"Every",15),"pauseDurationMs":value(scope+"Pause",10)*1000,"globalGapMinutes":scope == "own" ? value("ownGap",60):0,"manualRespectsGap":scope == "own" ? defaults.bool(forKey:"followcheck.limits.manualGap"):false]
        }
        let args:[String:Any]=["own":pacing("own"),"watchlist":pacing("watch")]
        let signature=String(decoding:try JSONSerialization.data(withJSONObject:args,options:.sortedKeys),as:UTF8.self)
        guard signature != appliedPacing else{return}
        guard let coordinator=webCoordinator,sessionAvailable else{return}
        _ = try await coordinator.request("pacing",args:args)
        appliedPacing=signature
    }
    func controlCompleted(_ command: String, result: [String: Any]) {
        if command == "inbox" {
            inboxLoading = false
            if result["code"] as? String == "inbox_route_unavailable" {
                inboxUnavailable = true
                record("A leitura nativa da Inbox não está disponível. As conversas guardadas foram preservadas.",level:"warn")
                if screen == .inbox && !checkIsRunning { openInstagramInbox() }
                return
            }
            if result["ok"] as? Bool == true, result["accountId"] as? String == accountId,
               let data = result["data"] as? [String: Any] {
                inboxUnavailable = false
                if let inbox = data["inbox"] as? [String: Any] {
                    guard (result["kind"] as? String ?? "inbox")==inboxKind else{return}
                    let incoming = (inbox["threads"] as? [[String: Any]] ?? []).map(Conversation.init).filter { !$0.id.isEmpty }
                    if result["append"] as? Bool == true {
                        let existing=Set(conversations.map(\.id))
                        conversations += incoming.filter{!existing.contains($0.id)}
                    } else {conversations=incoming}
                    let next=inbox["oldest_cursor"] as? String ?? inbox["next_cursor"] as? String ?? ""
                    inboxHasMore=(inbox["has_older"] as? Bool ?? inbox["has_more"] as? Bool ?? false) && !next.isEmpty && (result["append"] as? Bool != true || next != inboxCursor)
                    inboxCursor=next
                    inboxLoaded = true
                }
                if let thread = data["thread"] as? [String: Any], result["threadId"] as? String == openThread {
                    directMessages = (thread["items"] as? [[String: Any]] ?? []).map { DirectMessage($0, owner: accountId) }.filter { !$0.id.isEmpty }.reversed()
                }
            }
        }
        if command == "confirmSession" {
            confirmingSession = false
            if result["ok"] as? Bool == true {
                safetyBlocked = false
                statusText = "Sessão confirmada"
                detailText = "Podes iniciar uma nova verificação."
                notice = "Sessão confirmada. A pausa local foi removida."
            }
        }
        if command == "relations" {
            relationsLoading = false
            if result["accountId"] as? String == accountId {
                relationsReady = result["ready"] as? Bool ?? false
                relations = (result["accounts"] as? [[String: Any]] ?? []).map(Relation.init)
            }
        }
        if command == "watchlist" {
            watchlistBusy = false
            if let list = result["list"] as? [String: Any], list["targetId"] as? String == watchlistListTarget,
               list["relation"] as? String == watchlistListRelation {
                let people = (list["accounts"] as? [[String: Any]] ?? []).map { v in
                    Relation(["id": String(describing: v["id"] ?? v["pk"] ?? ""), "username": v["username"] ?? "", "name": v["full_name"] ?? "", "photoURL":v["profile_pic_url"] ?? v["profilePicUrl"] ?? ""])
                }.filter { !$0.id.isEmpty }
                let known = Set(watchlistAccounts.map(\.id))
                watchlistAccounts.append(contentsOf: people.filter { !known.contains($0.id) })
                watchlistListMore = list["hasMore"] as? Bool ?? false
            }
        }
        if command == "scan" { webCoordinator?.control("state") }
        if result["ok"] as? Bool == false {
            if ["scan","watchlist"].contains(command) && !checkIsRunning {CheckContinuation.shared.finish(success:false)}
            if !["state", "lifecycle", "logs"].contains(command) { showError(result["error"] as? String ?? "A operação não foi concluída.") }
            return
        }
        if command == "logs", let logs = result["logs"] as? [[String: Any]] {
            let known = Set(events.map(\.id))
            for log in logs {
                guard let id = log["id"] as? String, !known.contains(id) else { continue }
                var event = DiagnosticEvent(level: log["level"] as? String ?? "info", message: Self.redact(log["message"] as? String ?? ""))
                let metadata: [String: Any] = ["source": log["source"] ?? "", "event": log["event"] ?? "", "meta": log["meta"] ?? [:]]
                if let data = try? JSONSerialization.data(withJSONObject: Self.diagnosticMetadata(metadata), options: [.sortedKeys]), data.count <= 24000 {
                    event.details = String(data: data, encoding: .utf8)
                }
                event.id = id
                let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                if let raw = log["at"] as? String, let date = f.date(from: raw) { event.date = date }
                events.append(event)
            }
            events = Array(events.sorted { $0.date < $1.date }.suffix(1000)); persistEvents()
        }
    }
    func updateFromBridge(_ message: [String: Any]) {
        let kind = message["kind"] as? String ?? ""
        if kind == "legacyProgress", message["accountId"] as? String == accountId {
            legacyProgress=(message["progress"] as? [String:Any])?["detail"] as? String ?? "A analisar…"
            return
        }
        if kind == "javascriptError" { showError(message["message"] as? String ?? "Erro no motor."); return }
        if kind == "accountDataChanged", message["accountId"] as? String == accountId {
            loadRelations()
            Task { await tools.load() }
            return
        }
        if kind == "accountActivity", message["accountId"] as? String == accountId {
            accountEvents = (message["events"] as? [[String:Any]] ?? []).map(WatchEvent.init).filter{!$0.id.isEmpty}
            return
        }
        if kind == "iosState" {
            if let owner = message["accountId"] as? String, !owner.isEmpty, owner != accountId { return }
            activeCheckScope = message["busy"] as? Bool == true ? (message["scope"] as? String ?? "") : ""
            if !["account", "watchlist"].contains(activeCheckScope) && isScanning {
                isScanning = false
                progress = nil
            }
            paused = message["paused"] as? Bool ?? false
            schedulerEnabled = message["schedulerEnabled"] as? Bool ?? false
            let safety = message["safety"] as? [String: Any] ?? [:]
            cooldownUntil = (safety["cooldownUntil"] as? Double).flatMap { $0 > 0 ? Date(timeIntervalSince1970:$0/1000):nil }
            serverCooldownUntil = (safety["serverCooldownUntil"] as? Double).flatMap { $0 > 0 ? Date(timeIntervalSince1970:$0/1000):nil }
            safetyReason = safety["reason"] as? String ?? ""
            safetyBlocked = safety["blocked"] as? Bool ?? false
            if safetyBlocked { statusText = "Verificações em pausa"; detailText = Self.redact(safety["message"] as? String ?? "Confirma a conta no Instagram.") }
            if !safetyBlocked && sessionAvailable && !isScanning {
                statusText = paused ? "Verificações pausadas" : "Sessão disponível"
                detailText = paused ? "Retoma quando quiseres iniciar um novo check." : "Pronto para verificar o teu círculo."
            }
            watchlistBlocked = (message["watchlistSafety"] as? [String: Any])?["blocked"] as? Bool ?? safetyBlocked
            let watch = message["watchlist"] as? [String: Any] ?? [:]
            watchEvents = (watch["events"] as? [[String:Any]] ?? []).map(WatchEvent.init).filter{!$0.id.isEmpty}
            targets = (watch["targets"] as? [[String: Any]] ?? []).map(WatchTarget.init).filter { !$0.id.isEmpty }
            return
        }
        guard kind == "nativePort", let p = message["message"] as? [String: Any] else { return }
        switch p["event"] as? String ?? "" {
        case "session_state":
            let next = p["userId"] as? String ?? ""
            if accountId != next { profilePhotoURL = ""; inboxUnavailable = false; inboxWebMode = false }
            if p["connected"] as? Bool == true, let photo = p["profilePicUrl"] as? String, !photo.isEmpty { profilePhotoURL = photo }
            if p["connected"] as? Bool == true && !next.isEmpty {
                if accountId != next {
                    tools.resetAccount(); seenActivityStamp = ""
                    snapshot = nil; targets = []; watchEvents = []; accountEvents = []; watchlistAccounts = []; watchlistListTarget = ""; conversations = []; directMessages = []; inboxLoaded = false; relations = []; relationsReady = false; accountId = next
                    if let data = UserDefaults.standard.data(forKey: "followcheck.snapshot.\(next)") { snapshot = try? JSONDecoder().decode(Snapshot.self, from: data) }
                    Task { await tools.load() }
                }
                username = p["username"] as? String ?? ""; sessionAvailable = true; requiresAuthentication = false
                Task{await recoverScanBackup();do{try await applyPacing()}catch{record(error.localizedDescription,level:"warn")}}
                if !safetyBlocked && !isScanning { statusText = "Sessão disponível"; detailText = "Pronto para um check em primeiro plano." }
            } else {
                sessionAvailable = false
                if p["logoutConfirmed"] as? Bool == true { tools.resetAccount(); accountId = ""; username = ""; snapshot = nil; targets = []; watchEvents = []; accountEvents = []; relations = []; relationsReady = false; conversations = []; directMessages = []; inboxLoaded = false; watchlistAccounts = [] }
            }
        case "safety_state":
            let safety = p["safety"] as? [String: Any] ?? [:]
            cooldownUntil = (safety["cooldownUntil"] as? Double).flatMap { $0 > 0 ? Date(timeIntervalSince1970:$0/1000):nil }
            serverCooldownUntil = (safety["serverCooldownUntil"] as? Double).flatMap { $0 > 0 ? Date(timeIntervalSince1970:$0/1000):nil }
            safetyReason = safety["reason"] as? String ?? ""
            safetyBlocked = safety["blocked"] as? Bool ?? false
            if safetyBlocked { detailText = Self.redact(safety["message"] as? String ?? "Verificação necessária."); statusText = "Verificações em pausa" }
        case "native_snapshot": if let value = p["snapshot"] as? [String: Any] { acceptSnapshot(value) }
        case "workspace_state": if p["open"] as? Bool == true { panelOpened() } else { panelClosed() }
        case "progress", "monitor_progress":
            let running = p["active"] as? Bool ?? ((p["phase"] as? String ?? "running") == "running")
            isScanning = running
            if running {CheckContinuation.shared.progress((p["percentage"] as? NSNumber)?.doubleValue ?? 0)}
            else {CheckContinuation.shared.finish(success:p["phase"] as? String == "completed")}
            let scope = (p["scope"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? activeCheckScope
            if scope == "watchlist" {
                watchStatus = Self.redact(p["title"] as? String ?? "Watchlist")
                watchDetail = Self.redact(p["detail"] as? String ?? "")
                let percent = (p["percentage"] as? NSNumber)?.doubleValue ?? -1
                watchProgress = running && percent >= 0 ? min(1, percent / 100) : nil
                return
            }
            statusText = Self.redact(p["title"] as? String ?? "Check em curso")
            detailText = Self.redact(p["detail"] as? String ?? "")
            let percent = (p["percentage"] as? NSNumber)?.doubleValue ?? -1
            progress = running && percent >= 0 ? min(1, percent / 100) : nil
        case "monitor_result":
            CheckContinuation.shared.finish(success:true)
            if UserDefaults.standard.bool(forKey: "followcheck.reminders.enabled") {
                let content = UNMutableNotificationContent()
                content.title = "Check concluído"
                content.body = "O resultado completo do teu círculo foi guardado."
                content.sound = .default
                UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "followcheck-complete", content: content, trigger: nil))
            }
            isScanning = false; progress = nil
            if let value = p["snapshot"] as? [String: Any] { acceptSnapshot(value) }
            statusText = "Check concluído"; detailText = "O resultado completo foi guardado."
            record("Check concluído e confirmado pelo motor.")
            webCoordinator?.control("state")
            loadRelations()
            Task { await tools.load() }
        case "monitor_error":
            CheckContinuation.shared.finish(success:false)
            isScanning = false; progress = nil
            statusText = "Check não concluído"
            detailText = Self.redact(p["message"] as? String ?? "Consulta a atividade.")
            record(detailText, level: "error")
            webCoordinator?.control("state")
        default: break
        }
    }
}
