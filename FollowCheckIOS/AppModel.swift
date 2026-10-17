import BackgroundTasks
import Observation
import SwiftUI
import UserNotifications

/// Native state for the whole app. The JavaScript engine is the source of truth for
/// Instagram data; this model mirrors what it publishes and sends it commands.
@MainActor @Observable
final class AppModel {
    enum Phase: Equatable { case starting, loadingInstagram, ready, failed(String) }
    enum Screen: String, CaseIterable { case home, people, watchlist, activity, settings, instagram }

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
    /// One list of a watched profile that Instagram served only partially.
    struct PartialList: Equatable {
        let observed: Int
        let reported: Int
        /// Instagram stopped the list with a limit; otherwise the list was shuffled.
        let interrupted: Bool
        init?(_ value: Any?) {
            guard let value = value as? [String: Any], let observed = (value["observed"] as? NSNumber)?.intValue,
                  let reported = (value["reported"] as? NSNumber)?.intValue else { return nil }
            self.observed = observed; self.reported = reported
            interrupted = value["interrupted"] as? Bool ?? false
        }
    }
    struct WatchTarget: Identifiable {
        let id: String
        let username: String
        let fullName: String
        let enabled: Bool
        let photoURL: String
        let running: Bool
        let baselineReady: Bool
        let comparisonReady: Bool
        let followers: Int
        let following: Int
        let reportedFollowers: Int?
        let reportedFollowing: Int?
        let partialFollowers: PartialList?
        let partialFollowing: PartialList?
        let intervalMinutes: Int
        let lastSuccess: Date?
        let nextRun: Date?
        let error: String
        let errorCode: String
        init(_ v: [String: Any]) {
            id = v["id"] as? String ?? ""
            username = v["username"] as? String ?? ""
            fullName = v["fullName"] as? String ?? ""
            photoURL = v["profilePicUrl"] as? String ?? v["profile_pic_url"] as? String ?? ""
            enabled = v["enabled"] as? Bool ?? false
            running = v["running"] as? Bool ?? false
            baselineReady = v["baselineReady"] as? Bool ?? false
            let partial = v["partialLists"] as? [String: Any] ?? [:]
            partialFollowers = PartialList(partial["followers"])
            partialFollowing = PartialList(partial["following"])
            comparisonReady = baselineReady && (v["lastError"] as? String ?? "").isEmpty
            followers = (v["followers"] as? NSNumber)?.intValue ?? 0
            following = (v["following"] as? NSNumber)?.intValue ?? 0
            reportedFollowers = (v["reportedFollowers"] as? NSNumber)?.intValue
            reportedFollowing = (v["reportedFollowing"] as? NSNumber)?.intValue
            intervalMinutes = (v["intervalMinutes"] as? NSNumber)?.intValue ?? 1440
            let ms = (v["lastSuccessAt"] as? NSNumber)?.doubleValue ?? 0
            lastSuccess = ms > 0 ? Date(timeIntervalSince1970: ms / 1000) : nil
            let next = (v["nextRunAt"] as? NSNumber)?.doubleValue ?? 0
            nextRun = next > 0 ? Date(timeIntervalSince1970: next / 1000) : nil
            error = AppModel.redact(v["lastError"] as? String ?? "")
            errorCode = v["lastErrorCode"] as? String ?? ""
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
            comparisonVerified=value["coverageVerified"] as? Bool ?? value["comparisonVerified"] as? Bool ?? false
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
    @ObservationIgnored lazy var direct = DirectStore(model: self)
    var messagesOpen = false
    var phase: Phase = .starting
    var screen: Screen = .home
    /// The People lens to open next (set by the Home legend).
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
    /// A pause requested by Instagram (or local protection) that is still running.
    var activeCooldown: Date? {
        let until = [cooldownUntil, serverCooldownUntil].compactMap { $0 }.max()
        return until.flatMap { $0 > Date() ? $0 : nil }
    }
    var canScanWatchlist: Bool { phase == .ready && sessionAvailable && !requiresAuthentication && !watchlistBlocked && (!isScanning || activeCheckScope == "account") }
    var canScan: Bool { phase == .ready && sessionAvailable && !requiresAuthentication && (!isScanning || activeCheckScope == "watchlist") && !paused && !safetyBlocked }
    @ObservationIgnored weak var webCoordinator: FollowCheckWebCoordinator?
    @ObservationIgnored private var persistenceTask: Task<Void, Never>?
    private let eventsKey = "followcheck.native.events.v2"

    init() {
        Self.migratePacing(UserDefaults.standard)
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("--preview-people") || arguments.contains("--preview-review") { screen = .people }
        if arguments.contains("--preview-watchlist") { screen = .watchlist }
        if arguments.contains("--preview-activity") { screen = .activity }
        if arguments.contains(where: { $0.hasPrefix("--preview-settings") }) { screen = .settings }
        if arguments.contains("--preview-circle") { screen = .people }
        if arguments.contains("--preview-messages") || arguments.contains("--preview-chat") { messagesOpen = true }
        if isPreview { loadPreviewData(arguments) }
        #endif
        if let data = UserDefaults.standard.data(forKey: eventsKey),
           let saved = try? JSONDecoder().decode([DiagnosticEvent].self, from: data) { events = Array(saved.suffix(1000)) }
    }

    /// Device diagnostic 2026-10-17: the 1 s reference pace reached Instagram's spam
    /// limit within one Watchlist check. Untouched reference values move to safer presets.
    private static func migratePacing(_ defaults: UserDefaults) {
        if !defaults.bool(forKey:"followcheck.referencePacing.v219") {
            for scope in ["own","watch"] {
                let keys=[scope+"Delay",scope+"Every",scope+"Pause"]
                if zip(keys,[5,5,30]).allSatisfy({ key,value in defaults.object(forKey:"followcheck.limits."+key) == nil || defaults.integer(forKey:"followcheck.limits."+key) == value }) {
                    for (key,value) in zip(keys,[1,15,10]) {defaults.set(value,forKey:"followcheck.limits."+key)}
                }
            }
            let actionKeys=["actionDelay","actionEvery","actionPause"]
            if zip(actionKeys,[10,5,30]).allSatisfy({key,value in defaults.object(forKey:"followcheck.limits."+key) == nil || defaults.integer(forKey:"followcheck.limits."+key) == value}) {
                for (key,value) in zip(actionKeys,[4,5,300]) {defaults.set(value,forKey:"followcheck.limits."+key)}
            }
            defaults.set(true,forKey:"followcheck.referencePacing.v219")
        }
        if !defaults.bool(forKey: "followcheck.referencePacing.v26") {
            // Matches PacePreset.balanced: own 2 s / 12 pages / 20 s, Watchlist 3 s / 10 pages / 30 s.
            for (scope, values) in [("own", [2, 12, 20]), ("watch", [3, 10, 30])] {
                let keys = [scope + "Delay", scope + "Every", scope + "Pause"].map { "followcheck.limits." + $0 }
                let untouched = zip(keys, [1, 15, 10]).allSatisfy { key, value in defaults.object(forKey: key) == nil || defaults.integer(forKey: key) == value }
                if untouched { for (key, value) in zip(keys, values) { defaults.set(value, forKey: key) } }
            }
            defaults.set(true, forKey: "followcheck.referencePacing.v26")
        }
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
            accountId = ""; username = ""; sessionAvailable = false; phase = .failed("Sessão por ligar"); return
        }
        snapshot = Snapshot(["accountId": "preview", "followers": 1172, "following": 344, "mutuals": 301, "nonFollowers": 43, "newChanges": 5, "lastScanAt": ISO8601DateFormatter().string(from: now.addingTimeInterval(-7200))])
        if arguments.contains("--preview-checking") {
            isScanning = true; activeCheckScope = "account"; progress = 0.42
            statusText = "A recolher seguidores"; detailText = "492 de 1172 perfis · página 20"
        }
        if arguments.contains("--preview-cooldown") {
            safetyBlocked = true; watchlistBlocked = true; safetyReason = "soft_throttle"
            cooldownUntil = now.addingTimeInterval(52 * 60)
            statusText = "Verificações em pausa"
            detailText = "O Instagram sinalizou uma restrição temporária de atividade. O check parou e a referência anterior foi preservada."
        }
        let names = ["ana.ribeiro", "joao_m", "studio.norte", "ines.costa", "pedro.alves", "cafe.da.esquina", "rita.sousa", "miguel.ferreira", "lisboa.film", "sofia_mendes", "tiago.dias", "carolina.pt", "nuno.arq", "beatriz.lopes"]
        let fullNames = ["Ana Ribeiro", "João Martins", "Studio Norte", "Inês Costa", "Pedro Alves", "Café da Esquina", "Rita Sousa", "Miguel Ferreira", "Lisboa Film Club", "Sofia Mendes", "Tiago Dias", "Carolina", "Nuno · Arquitetura", "Beatriz Lopes"]
        relationsReady = true
        relations = names.indices.map { index in
            Relation(["id": "preview-\(index)", "username": names[index], "name": fullNames[index], "following": index % 4 != 3, "follows": index % 3 != 1])
        }
        targets = [
            WatchTarget(["id": "preview-target", "username": "priscila.pinto", "fullName": "Priscila Pinto", "enabled": true, "baselineReady": true, "followers": 916, "following": 344, "reportedFollowers": 1171, "reportedFollowing": 343,
                         "partialLists": ["followers": ["observed": 916, "reported": 1171, "duplicates": 257]], "intervalMinutes": 1440, "lastSuccessAt": ms(1800), "nextRunAt": -ms(-84600)]),
            WatchTarget(["id": "preview-target-2", "username": "studio.norte", "fullName": "Studio Norte", "enabled": true, "baselineReady": true, "followers": 5204, "following": 341, "reportedFollowers": 5204, "reportedFollowing": 341, "intervalMinutes": 360, "lastSuccessAt": ms(20000)]),
            WatchTarget(["id": "preview-target-3", "username": "lisboa.film", "enabled": true, "baselineReady": false, "intervalMinutes": 1440]),
        ]
        watchEvents = [
            WatchEvent(["id": "w1", "targetId": "preview-target", "type": "watch_started_following", "title": "Começou a seguir", "username": "rita.sousa", "fullName": "Rita Sousa", "coverageVerified": true, "timestamp": ms(1800)]),
            WatchEvent(["id": "w2", "targetId": "preview-target", "type": "watch_stopped_following", "title": "Deixou de seguir", "username": "cafe.da.esquina", "fullName": "Café da Esquina", "coverageVerified": true, "timestamp": ms(1800)]),
            WatchEvent(["id": "w3", "targetId": "preview-target-2", "type": "watch_new_follower", "title": "Novo seguidor", "username": "tiago.dias", "fullName": "Tiago Dias", "coverageVerified": true, "timestamp": ms(20000)]),
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

    // MARK: Account events

    /// The last check whose changes were opened in Activity, per account.
    var seenActivityStamp = ""
    var hasUnseenActivity: Bool {
        guard let snapshot, (snapshot.newChanges ?? 0) > 0, !accountId.isEmpty else { return false }
        let seen = seenActivityStamp.isEmpty ? UserDefaults.standard.string(forKey: "followcheck.activity.seen.\(accountId)") ?? "" : seenActivityStamp
        return seen != snapshot.lastScanAt
    }
    /// Account events observed in the most recent check.
    var latestAccountEvents: [WatchEvent] {
        guard let latest = accountEvents.map(\.date).max() else { return [] }
        return accountEvents.filter { abs($0.date.timeIntervalSince(latest)) < 600 }.sorted { $0.date > $1.date }
    }
    func count(_ filter: String) -> Int { relations.filter { $0.matches(filter) }.count }

    // MARK: Commands

    func select(_ destination: Screen) {
        if destination == .people { loadRelations() }
        screen = destination
        if destination == .activity, let stamp = snapshot?.lastScanAt, !accountId.isEmpty {
            seenActivityStamp = stamp
            UserDefaults.standard.set(stamp, forKey: "followcheck.activity.seen.\(accountId)")
        }
        if destination == .activity || destination == .settings { webCoordinator?.control("logs") }
        if destination == .watchlist { webCoordinator?.control("state") }
    }
    /// Pull-to-refresh: re-read the engine state and the saved relations.
    func refreshState() {
        guard !isPreview else { return }
        webCoordinator?.control("state")
        loadRelations()
    }
    func clearLogs() { events.removeAll(); persistEvents(); webCoordinator?.control("clearLogs") }
    func attach(_ coordinator: FollowCheckWebCoordinator) { webCoordinator = coordinator }
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
    func cancelCurrentScan() { CheckContinuation.shared.finish(success:false);webCoordinator?.control("cancelCurrent") }
    func openInstagram() { screen = .instagram; webCoordinator?.openInstagramHome() }
    /// Native messages, read from the user's own session page (DirectMessages.swift).
    func openInstagramMessages() { messagesOpen = true }
    func openInstagramMessagesPage() {
        messagesOpen = false
        screen = .instagram
        webCoordinator?.openInstagramInbox()
    }
    func openInstagramThread(_ id: String) {
        guard id.range(of: "^[A-Za-z0-9_-]{1,64}$", options: .regularExpression) != nil,
              let url = URL(string: "https://www.instagram.com/direct/t/\(id)/") else { return }
        messagesOpen = false
        screen = .instagram
        webCoordinator?.open(url)
    }
    func openProfile(_ handle: String) {
        guard handle.range(of: "^[A-Za-z0-9._]{1,30}$", options: .regularExpression) != nil,
              let url = URL(string: "https://www.instagram.com/\(handle)/") else { return }
        screen = .instagram
        webCoordinator?.open(url)
    }
    func reload() { webCoordinator?.reload() }
    func goBack() { webCoordinator?.goBack() }
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
            relationsLoading=false;confirmingSession=false
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

    // MARK: WebKit lifecycle

    func pageStarted(url: URL?) {
        activeCheckScope = ""
        requiresAuthentication = true; sessionAvailable = false; isScanning = false; watchlistBusy = false; progress = nil
        relationsLoading = false; confirmingSession = false
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

    // MARK: Snapshot and backup

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

    // MARK: Pacing

    @ObservationIgnored private var appliedPacing = ""
    func configureCooldown(minutes:Int,release:Bool=false) async throws {
        guard let coordinator=webCoordinator,sessionAvailable else {throw NSError(domain:"FollowCheck",code:1,userInfo:[NSLocalizedDescriptionKey:"Liga a sessão para aplicar esta preferência."])}
        _ = try await coordinator.request("cooldown",args:["minutes":minutes,"release":release])
    }
    /// Ends the local protection pause now. A deadline sent by Instagram and a security hold stay.
    func endPause() async {
        let minutes = (UserDefaults.standard.object(forKey: "followcheck.limits.cooldownMinutes") as? NSNumber)?.intValue ?? 60
        do {
            try await configureCooldown(minutes: max(1, min(1440, minutes)), release: true)
            webCoordinator?.control("state")
            if let server = serverCooldownUntil, server > Date() {
                notice = "A pausa local terminou, mas o Instagram indicou esperar até às \(server.formatted(date: .omitted, time: .shortened))."
            } else { notice = "Pausa terminada. Podes voltar a verificar." }
        } catch { notice = error.localizedDescription }
    }
    func applyPacing() async throws {
        let defaults=UserDefaults.standard
        func value(_ key: String,_ fallback: Double) -> Double {(defaults.object(forKey:"followcheck.limits."+key) as? NSNumber)?.doubleValue ?? fallback}
        func pacing(_ scope:String)->[String:Any] {
            let delay=value(scope+"Delay",scope == "own" ? 2 : 3)*1000
            return ["pageDelayMinMs":delay+300,"pageDelayMaxMs":delay+1300,"pauseEveryPages":value(scope+"Every",scope == "own" ? 12 : 10),"pauseDurationMs":value(scope+"Pause",scope == "own" ? 20 : 30)*1000,"globalGapMinutes":scope == "own" ? value("ownGap",60):0,"manualRespectsGap":scope == "own" ? defaults.bool(forKey:"followcheck.limits.manualGap"):false]
        }
        let args:[String:Any]=["own":pacing("own"),"watchlist":pacing("watch")]
        let signature=String(decoding:try JSONSerialization.data(withJSONObject:args,options:.sortedKeys),as:UTF8.self)
        guard signature != appliedPacing else{return}
        guard let coordinator=webCoordinator,sessionAvailable else{return}
        _ = try await coordinator.request("pacing",args:args)
        appliedPacing=signature
        // The pause length after a limit is a user preference too; the engine reads it when a limit happens.
        if let minutes = (defaults.object(forKey: "followcheck.limits.cooldownMinutes") as? NSNumber)?.intValue, !checkIsRunning {
            _ = try? await coordinator.request("cooldown", args: ["minutes": max(1, min(1440, minutes))])
        }
    }

    // MARK: Engine replies

    func controlCompleted(_ command: String, result: [String: Any]) {
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
                if let raw = log["at"] as? String, let date = Self.fractionalISO.date(from: raw) { event.date = date }
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
            applySafety(message["safety"] as? [String: Any] ?? [:])
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
            if accountId != next { profilePhotoURL = "" }
            if p["connected"] as? Bool == true, let photo = p["profilePicUrl"] as? String, !photo.isEmpty { profilePhotoURL = photo }
            if p["connected"] as? Bool == true && !next.isEmpty {
                if accountId != next {
                    tools.resetAccount(); seenActivityStamp = ""
                    snapshot = nil; targets = []; watchEvents = []; accountEvents = []; watchlistAccounts = []; watchlistListTarget = ""; relations = []; relationsReady = false; accountId = next
                    if let data = UserDefaults.standard.data(forKey: "followcheck.snapshot.\(next)") { snapshot = try? JSONDecoder().decode(Snapshot.self, from: data) }
                    Task { await tools.load() }
                }
                username = p["username"] as? String ?? ""; sessionAvailable = true; requiresAuthentication = false
                Task{await recoverScanBackup();do{try await applyPacing()}catch{record(error.localizedDescription,level:"warn")}}
                if !safetyBlocked && !isScanning { statusText = "Sessão disponível"; detailText = "Pronto para um check em primeiro plano." }
            } else {
                sessionAvailable = false
                if p["logoutConfirmed"] as? Bool == true { tools.resetAccount(); accountId = ""; username = ""; snapshot = nil; targets = []; watchEvents = []; accountEvents = []; relations = []; relationsReady = false; watchlistAccounts = [] }
            }
        case "safety_state":
            applySafety(p["safety"] as? [String: Any] ?? [:])
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
    private func applySafety(_ safety: [String: Any]) {
        cooldownUntil = (safety["cooldownUntil"] as? Double).flatMap { $0 > 0 ? Date(timeIntervalSince1970:$0/1000):nil }
        serverCooldownUntil = (safety["serverCooldownUntil"] as? Double).flatMap { $0 > 0 ? Date(timeIntervalSince1970:$0/1000):nil }
        safetyReason = safety["reason"] as? String ?? ""
        safetyBlocked = safety["blocked"] as? Bool ?? false
        if safetyBlocked { statusText = "Verificações em pausa"; detailText = Self.redact(safety["message"] as? String ?? "Confirma a conta no Instagram.") }
    }
}
