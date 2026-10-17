import Foundation
import Observation

/// Per-account workspace (protections, notes, decisions) and the reviewed action queue.
/// Every action is sent one at a time, paced by the user's limits, and confirmed by the engine
/// before the next one starts. An unconfirmed action stops the queue and is never retried.
@MainActor @Observable
final class NativeToolsStore {
    unowned let model: AppModel
    var workspace: [String: Any] = [:]
    var busy = false
    var error: String?
    var operationRunning = false
    var operationPaused = false
    var operationDone = 0
    var operationTotal = 0
    var operationCurrent = ""
    var queueRows: [[String: Any]] = []
    var queueAction = ""
    var queueStartedAt: Date?
    var queueWaitUntil: Date?
    var failedPerson: AppModel.Relation?
    private var owner = ""
    private var workspaceWrite: Task<Void, Never>?
    private var workspaceRevision = 0
    init(model: AppModel) { self.model = model }

    func resetAccount() {
        workspaceRevision += 1
        workspace = [:]
        owner = model.accountId
        busy = false
        error = nil
        operationPaused = true
        queueRows = []; queueAction = ""; queueStartedAt = nil; queueWaitUntil = nil
        failedPerson = nil
    }
    var protectedIDs: Set<String> { Set(workspace["protected"] as? [String] ?? []) }
    var metadata: [String: [String: Any]] { workspace["profile-meta"] as? [String: [String: Any]] ?? [:] }
    var favorites: Set<String> { Set((workspace["tool-preferences"] as? [String: Any])?["favorites"] as? [String] ?? []) }
    /// The last queue, live while it runs and restored from the workspace afterwards.
    var lastQueue: (action: String, rows: [[String: Any]], updatedAt: Date?) {
        if !queueRows.isEmpty { return (queueAction, queueRows, queueStartedAt) }
        let draft = workspace["operation-draft"] as? [String: Any] ?? [:]
        let stamp = (draft["updatedAt"] as? String).flatMap { ISO8601DateFormatter().date(from: $0) }
        return (draft["action"] as? String ?? "", draft["rows"] as? [[String: Any]] ?? [], stamp)
    }
    var pendingInLastQueue: [AppModel.Relation] {
        lastQueue.rows.filter { $0["status"] as? String == "pending" }.map(AppModel.Relation.init)
    }

    func request(_ command: String, _ args: [String: Any] = [:]) async throws -> [String: Any] {
        guard let coordinator = model.webCoordinator else { throw NSError(domain: "FollowCheck", code: 1, userInfo: [NSLocalizedDescriptionKey: "A sessão ainda está a iniciar."]) }
        var scoped = args
        if ["likes", "memories", "legacy", "workspace", "relationship", "requests", "discover", "lookup"].contains(command) { scoped["accountId"] = model.accountId }
        return try await coordinator.request(command, args: scoped)
    }
    func load() async {
        guard !model.isPreview else { return }
        await workspaceWrite?.value
        let account = model.accountId
        let revision = workspaceRevision
        if owner != model.accountId { workspace = [:]; owner = model.accountId }
        guard model.sessionAvailable else { return }
        do {
            let response = try await request("workspace")
            guard account == model.accountId, revision == workspaceRevision,
                  response["accountId"] as? String == account else { return }
            workspace = response["workspace"] as? [String: Any] ?? [:]
        } catch { self.error = error.localizedDescription }
    }
    func save(_ name: String, _ value: Any) async {
        error = nil
        let account = model.accountId
        let previous = workspaceWrite
        let previousValue = workspace[name]
        workspace[name] = value
        workspaceRevision += 1
        let revision = workspaceRevision
        busy = true
        let write = Task { @MainActor [weak self] in
            await previous?.value
            guard let self else { return }
            defer { if revision == self.workspaceRevision { self.busy = false } }
            guard account == self.model.accountId else { return }
            do {
                let response = try await self.request("workspace", ["operation":"set","name":name,"value":value])
                if account == self.model.accountId, revision == self.workspaceRevision,
                   response["accountId"] as? String == account {
                    self.workspace = response["workspace"] as? [String: Any] ?? [:]
                }
            } catch {
                if account == self.model.accountId {
                    if revision == self.workspaceRevision { self.workspace[name] = previousValue }
                    self.error = error.localizedDescription
                }
            }
        }
        workspaceWrite = write
        await write.value
    }
    func favorite(_ id: String) async {
        var values = favorites
        if values.contains(id) { values.remove(id) } else { values.insert(id) }
        var preferences = workspace["tool-preferences"] as? [String: Any] ?? [:]
        preferences["favorites"] = Array(values)
        await save("tool-preferences", preferences)
    }
    func protect(_ id: String) async {
        var ids = protectedIDs
        if ids.contains(id) { ids.remove(id) } else { ids.insert(id) }
        await save("protected",Array(ids))
    }
    func execute(_ action: String, people: [AppModel.Relation]) async {
        guard !operationRunning, !people.isEmpty else { return }
        error=nil
        let defaults=UserDefaults.standard
        func setting(_ name:String,_ fallback:Int)->Int {(defaults.object(forKey:"followcheck.limits."+name) as? NSNumber)?.intValue ?? fallback}
        let batch=max(1,min(10000,setting("batch",20))),daily=max(1,min(10000,setting("daily",50)))
        let delay=max(2,min(120,setting("actionDelay",4)))
        let every=max(0,min(50,setting("actionEvery",5))),pause=max(0,min(600,setting("actionPause",300)))
        guard people.count <= batch else {error="Selecionaste \(people.count) perfis. O teu limite por execução é \(batch); ajusta a seleção ou as definições.";return}
        failedPerson=nil
        operationRunning=true;operationPaused=false;operationDone=0;operationTotal=people.count
        let account=model.accountId
        let batchID=UUID().uuidString
        queueAction=action;queueStartedAt=Date()
        queueRows=people.map{["id":$0.id,"username":$0.username,"name":$0.name,"photoURL":$0.photoURL,"follows":$0.follows,"following":$0.following,"status":"pending"]}
        let quotaKey="followcheck.actionAttempts."+account
        defer{operationRunning=false;operationCurrent="";queueWaitUntil=nil}
        func wait(_ seconds:Int) async throws {
            queueWaitUntil=Date().addingTimeInterval(Double(seconds))
            defer{queueWaitUntil=nil}
            for _ in 0..<seconds {
                guard !operationPaused,account==model.accountId else{return}
                try await Task.sleep(for:.seconds(1))
            }
        }
        func persistQueue() async {
            let operationError=self.error
            await save("operation-draft",["id":batchID,"action":action,"accountId":account,"rows":queueRows,"updatedAt":ISO8601DateFormatter().string(from:Date())])
            if let operationError {self.error=operationError}
        }
        var sent=0
        do {
            _ = try await request("relationshipBatch",["operation":"begin","accountId":account,"batchId":batchID])
        } catch { self.error=error.localizedDescription; return }
        await persistQueue()
        for person in people {
            guard !Task.isCancelled,!operationPaused,account==model.accountId else{break}
            operationCurrent=person.username
            do {
                for step in action == "disconnect" ? ["unfollow","removeFollower"]:[action] {
                    guard !operationPaused,account==model.accountId else{break}
                    if sent>0 {try await wait(delay + (every>0 && sent % every == 0 ? pause:0))}
                    guard !operationPaused,account==model.accountId else{break}
                    let now=Date().timeIntervalSince1970
                    var attempts=(defaults.array(forKey:quotaKey) as? [Double] ?? []).filter{now-$0<86400}
                    guard attempts.count<daily else{self.error="Atingiste o teu limite de \(daily) tentativas nas últimas 24 horas. A fila ficou parada.";operationPaused=true;break}
                    attempts.append(now);defaults.set(attempts,forKey:quotaKey);sent+=1
                    if let i=queueRows.firstIndex(where:{$0["id"] as? String==person.id}){queueRows[i]["status"]="running"}
                    await persistQueue()
                    if let saveError=self.error {throw NSError(domain:"FollowCheck",code:1,userInfo:[NSLocalizedDescriptionKey:saveError])}
                    _ = try await request("relationship",["action":step,"targetId":person.id,"username":person.username,"name":person.name,"photoURL":person.photoURL,"batchId":batchID])
                    model.loadRelations()
                    await model.saveScanBackup()
                }
                if operationPaused || account != model.accountId {break}
                operationDone+=1
                if let i=queueRows.firstIndex(where:{$0["id"] as? String==person.id}){queueRows[i]["status"]="confirmed"}
                await persistQueue()
            }catch{
                if let i=queueRows.firstIndex(where:{$0["id"] as? String==person.id}){queueRows[i]["status"]="unconfirmed";queueRows[i]["message"]=error.localizedDescription}
                failedPerson=person;self.error=error.localizedDescription;model.record(error.localizedDescription,level:"warn");break
            }
        }
        if account==model.accountId {await persistQueue()}
        _ = try? await request("relationshipBatch",["operation":"end","accountId":account,"batchId":batchID])
        await load()
    }
    var csv: String {
        func cell(_ value: String) -> String { "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }
        return "username,nome,segue_te,segues,protegido\n" + model.relations.map { "\(cell($0.username)),\(cell($0.name)),\($0.follows),\($0.following),\(protectedIDs.contains($0.id))" }.joined(separator: "\n")
    }
}

/// What a queued action does, in the user's words.
enum PeopleAction: String, CaseIterable, Identifiable {
    case unfollow, follow, removeFollower, disconnect, mute
    var id: String { rawValue }
    var title: String {
        switch self {
        case .unfollow: return "Deixar de seguir"
        case .follow: return "Seguir"
        case .removeFollower: return "Remover seguidor"
        case .disconnect: return "Desligar nos dois sentidos"
        case .mute: return "Silenciar publicações"
        }
    }
    var icon: String {
        switch self {
        case .unfollow: return "person.badge.minus"
        case .follow: return "person.badge.plus"
        case .removeFollower: return "person.crop.circle.badge.xmark"
        case .disconnect: return "arrow.left.arrow.right"
        case .mute: return "speaker.slash"
        }
    }
    var verbPast: String {
        switch self {
        case .unfollow: return "Deixaste de seguir"
        case .follow: return "Passaste a seguir"
        case .removeFollower: return "Removido dos seguidores"
        case .disconnect: return "Desligado nos dois sentidos"
        case .mute: return "Silenciado"
        }
    }
    /// Instagram calls per person; the daily attempt limit counts each one.
    var steps: Int { self == .disconnect ? 2 : 1 }
    var destructive: Bool { self != .follow && self != .mute }
}
