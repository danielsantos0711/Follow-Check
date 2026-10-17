import SwiftUI
import Observation
import UniformTypeIdentifiers
import Security


private struct ClassicCleanup: View {
    let model:AppModel
    @State private var mode="following"
    @State private var query=""
    @State private var filter="Rever"
    @State private var selected=Set<String>()
    @State private var review=false
    @State private var profile:AppModel.Relation?
    @State private var intelligence=false
    @State private var relationship="Todos"
    private var store:NativeToolsStore {model.tools}
    private var decisions:[String:Any] {
        let value=store.workspace["cleanup-decisions"] as? [String:Any] ?? [:]
        return value[mode] as? [String:Any] ?? (value["following"] == nil && value["followers"] == nil && mode=="following" ? value:[:])
    }
    private func kept(_ person:AppModel.Relation)->Bool {
        store.protectedIDs.contains(person.id) || decisions[person.id] as? String == "keep"
    }
    private var people:[AppModel.Relation] {
        model.relations.filter { p in
            (mode=="following" ? p.following:p.follows) &&
            p.matches(relationship) &&
            (query.isEmpty || "\(p.username) \(p.name) \((store.metadata[p.id]?["tags"] as? [String] ?? []).joined(separator:" "))".localizedCaseInsensitiveContains(query)) &&
            (filter=="Todos" || filter=="Manter" && kept(p) || filter=="Remover" && decisions[p.id] as? String == "remove" || filter=="Rever" && !kept(p) && decisions[p.id] as? String != "remove")
        }
    }
    private func mark(_ ids:Set<String>,_ decision:String) {
        var root=store.workspace["cleanup-decisions"] as? [String:Any] ?? [:]
        if root["following"] == nil && root["followers"] == nil {root=["following":root,"followers":[:]]}
        var scoped=root[mode] as? [String:Any] ?? [:]
        for id in ids where !store.protectedIDs.contains(id) {scoped[id]=decision}
        root[mode]=scoped
        Task{await store.save("cleanup-decisions",root)}
    }
    private func keep(_ person:AppModel.Relation) {
        Task {
            var root=store.workspace["cleanup-decisions"] as? [String:Any] ?? [:]
            if root["following"] == nil && root["followers"] == nil {root=["following":root,"followers":[:]]}
            var scoped=root[mode] as? [String:Any] ?? [:]
            scoped[person.id]=kept(person) ? "review":"keep"
            root[mode]=scoped
            await store.save("cleanup-decisions",root)
            selected.remove(person.id)
        }
    }
    var body:some View {
        VStack(alignment:.leading,spacing:12) {
            VStack(alignment:.leading,spacing:12) {
                VStack(alignment:.leading,spacing:4) {
                    Text("Revê. Protege. Simplifica.").font(.title2.weight(.bold)).foregroundStyle(Theme.ink)
                    Text("Marca quem manter e revê cada ação antes de limpar as tuas relações.").font(.footnote).foregroundStyle(Theme.ink2)
                }
                HStack(spacing:10) {
                    Label("\(model.relations.filter{kept($0)}.count) a manter",systemImage:"shield.fill").foregroundStyle(Theme.signalInk)
                    Spacer()
                    Text("\(selected.count) selecionados").foregroundStyle(Theme.ink2).monospacedDigit()
                }
                .font(.footnote.weight(.semibold)).padding(12)
                .background(Theme.signal.opacity(0.12),in:.rect(cornerRadius:12,style:.continuous))
                Picker("Lista",selection:$mode){Text("A seguir").tag("following");Text("Seguidores").tag("followers")}.pickerStyle(.segmented)
                SearchField(text:$query,prompt:"Pesquisar perfis")
                ChipRow {
                    ForEach(["Rever","Manter","Remover","Todos"],id:\.self) { value in Chip(title:value,selected:filter==value){filter=value} }
                }
                HStack(spacing:10) {
                    Menu {
                        Picker("Relação",selection:$relationship){ForEach(["Todos","Mútuos","Não me seguem","Eu não sigo"],id:\.self){Text(RelationFilter.label($0)).tag($0)}}
                        if mode=="followers" {
                            Button("Marcar seguidores que não sigo",systemImage:"person.badge.minus") {
                                let ids=Set(model.relations.filter{$0.follows && !$0.following && !store.protectedIDs.contains($0.id)}.map(\.id))
                                mark(ids,"remove");selected=ids;filter="Remover"
                            }
                        }
                        Button("Círculo real · análise de ligações",systemImage:"circle.hexagongrid"){intelligence=true}
                    } label: {
                        Label(RelationFilter.label(relationship),systemImage:"line.3.horizontal.decrease.circle").font(.footnote.weight(.semibold))
                    }
                    Spacer()
                    if !selected.isEmpty {
                        Menu("Decidir \(selected.count)") {
                            Button("Manter",systemImage:"shield"){mark(selected,"keep");selected=[]}
                            Button("Rever depois",systemImage:"clock"){mark(selected,"review");selected=[]}
                            Button("Marcar para remover",systemImage:"minus.circle"){mark(selected,"remove")}
                        }
                        .font(.footnote.weight(.semibold))
                    }
                    Button(selected.isEmpty ? "Selecionar":"Limpar"){selected=selected.isEmpty ? Set(people.filter{!kept($0)}.map(\.id)):[]}
                        .font(.footnote.weight(.semibold)).disabled(store.operationRunning)
                }
            }
            if !model.relationsReady {
                EmptyState(icon:"person.2",title:"Começa com um check",message:"Precisamos de uma lista completa para rever as relações.",actionTitle:"Verificar agora",action:model.scan)
                    .disabled(!model.canScan).surface(padding:0)
            }
            ScrollView {
                LazyVStack(spacing:0) {
                    ForEach(people){person in
                        HStack(spacing:10) {
                            Button {if selected.contains(person.id){selected.remove(person.id)}else{selected.insert(person.id)}} label:{
                                Image(systemName:selected.contains(person.id) ? "checkmark.circle.fill":"circle").font(.title2)
                                    .foregroundStyle(selected.contains(person.id) ? Theme.signalInk:Theme.ink3).frame(width:32,height:44)
                            }.buttonStyle(.plain).disabled(kept(person)||store.operationRunning)
                            ProfileAvatar(photoURL:person.photoURL,size:42,name:person.username)
                            Button {profile=person} label:{
                                VStack(alignment:.leading,spacing:3) {
                                    Text("@"+person.username).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                                    HStack(spacing:6) {
                                        RelationBadge(kind:RelationKind(person))
                                        if decisions[person.id] as? String == "remove" {Text("A remover").font(.caption2.weight(.semibold)).foregroundStyle(Theme.loss)}
                                    }
                                }.frame(maxWidth:.infinity,alignment:.leading).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                            Button {keep(person)} label:{
                                Image(systemName:kept(person) ? "shield.fill":"shield").foregroundStyle(kept(person) ? Theme.signalInk:Theme.ink3).frame(width:44,height:44)
                            }.buttonStyle(.plain).disabled(store.busy || store.protectedIDs.contains(person.id)).accessibilityLabel(kept(person) ? "Marcado para manter":"Marcar para manter")
                        }
                        .padding(.leading,10).padding(.vertical,4)
                        Divider().overlay(Theme.line).padding(.leading,94)
                    }
                    if model.relationsReady && people.isEmpty {EmptyState(icon:"checkmark.circle",title:"Nada nesta lista",message:"Experimenta outro filtro.")}
                }
                .surface(padding:0)
            }
            if store.operationRunning {
                VStack(alignment:.leading,spacing:8) {
                    ProgressView(value:Double(store.operationDone),total:Double(max(1,store.operationTotal))).tint(Theme.signalInk)
                    Button("Parar fila"){store.operationPaused=true}.buttonStyle(QuietButtonStyle())
                }
            } else {
                Button {review=true} label:{Label(selected.isEmpty ? "Seleciona perfis para rever" : mode=="following" ? "Rever \(selected.count) para deixar de seguir" : "Rever \(selected.count) seguidores a remover",systemImage:"arrow.right")}
                    .buttonStyle(SignalButtonStyle())
                    .disabled(selected.isEmpty || !model.sessionAvailable || model.watchlistBlocked || store.busy)
            }
        }.padding(20).background(Theme.canvas)
        .task{await store.load();model.loadRelations()}
        .onChange(of:mode){_,_ in selected=[]}
        .onChange(of:model.accountId){_,_ in selected=[];Task{await store.load()}}
        .sheet(item:$profile){ProfileNotes(store:store,person:$0)}
        .sheet(isPresented:$review){NativeActionReview(model:model,people:model.relations.filter{selected.contains($0.id) && !kept($0)},action:mode=="following" ? "unfollow":"removeFollower")}
        .sheet(isPresented:$intelligence){NavigationStack{RelationshipIntelligence(model:model).toolbar{ToolbarItem(placement:.confirmationAction){Button("Concluído"){intelligence=false}}}}.tint(Theme.signalInk)}
    }
}


private enum IntegrationVault {
    static let service = "ch.dannysantos.followcheck.zernio"
    static func read() -> String? {
        let query: [String:Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:"api-key",kSecReturnData as String:true,kSecMatchLimit as String:kSecMatchLimitOne]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary,&item)==errSecSuccess,let data=item as? Data else{return nil}
        return String(data:data,encoding:.utf8)
    }
    static func write(_ value: String) throws {
        let query:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:"api-key"]
        let data=Data(value.utf8)
        var status=SecItemUpdate(query as CFDictionary,[kSecValueData as String:data] as CFDictionary)
        if status==errSecItemNotFound {
            var insert=query;insert[kSecValueData as String]=data;insert[kSecAttrAccessible as String]=kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status=SecItemAdd(insert as CFDictionary,nil)
        }
        guard status==errSecSuccess else{throw NSError(domain:"FollowCheck",code:Int(status),userInfo:[NSLocalizedDescriptionKey:"Não foi possível guardar a chave no Porta-chaves."])}
    }
    static func remove() {
        SecItemDelete([kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:"api-key"] as CFDictionary)
    }
}

struct NativeTool: Identifiable, Hashable {
    let id: String
    let name: String
    let detail: String
    let category: String
    let icon: String
    let professional: Bool
}

@MainActor @Observable
final class NativeToolsStore {
    unowned let model: AppModel
    var workspace: [String: Any] = [:]
    var config: [String: Any] = [:]
    var busy = false
    var error: String?
    var operationRunning = false
    var operationPaused = false
    var operationDone = 0
    var operationTotal = 0
    var operationCurrent = ""
    var queueRows:[[String:Any]]=[]
    var queueAction=""
    var queueStartedAt:Date?
    var queueWaitUntil:Date?
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
        queueRows=[];queueAction="";queueStartedAt=nil;queueWaitUntil=nil
        failedPerson = nil
    }
    var protectedIDs: Set<String> { Set(workspace["protected"] as? [String] ?? []) }
    var metadata: [String: [String: Any]] { workspace["profile-meta"] as? [String: [String: Any]] ?? [:] }
    var favorites: Set<String> { Set((workspace["tool-preferences"] as? [String: Any])?["favorites"] as? [String] ?? []) }
    var recentTools: [NativeTool] {
        ((workspace["tool-preferences"] as? [String:Any])?["recent"] as? [String] ?? []).compactMap { id in NativeTool.all.first{$0.id==id} }
    }
    func remember(_ id:String) async {
        var preferences=workspace["tool-preferences"] as? [String:Any] ?? [:]
        let previous=preferences["recent"] as? [String] ?? []
        preferences["recent"]=Array(([id]+previous.filter{$0 != id}).prefix(6))
        await save("tool-preferences",preferences)
    }
    func records(_ name: String) -> [[String: Any]] { workspace[name] as? [[String: Any]] ?? [] }
    private func nativeConfig() -> [String:Any] {
        var value=UserDefaults.standard.dictionary(forKey:"followcheck.integration.config") ?? [:]
        value["configured"]=IntegrationVault.read()?.isEmpty == false
        return value
    }
    func request(_ command: String, _ args: [String: Any] = [:]) async throws -> [String: Any] {
        if command == "integration", let operation=args["operation"] as? String, ["config","configure","disconnect"].contains(operation) {
            if operation == "disconnect" { IntegrationVault.remove();UserDefaults.standard.removeObject(forKey:"followcheck.integration.config");UserDefaults.standard.set(true,forKey:"followcheck.integration.migrated") }
            if operation == "configure", let patch=args["config"] as? [String:Any] {
                if let key=patch["apiKey"] as? String,!key.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty {try IntegrationVault.write(key.trimmingCharacters(in:.whitespacesAndNewlines))}
                var current=UserDefaults.standard.dictionary(forKey:"followcheck.integration.config") ?? [:]
                for key in ["selectedAccountId","selectedProfileId"] {if let value=patch[key] as? String{current[key]=value}}
                UserDefaults.standard.set(current,forKey:"followcheck.integration.config")
                UserDefaults.standard.set(true,forKey:"followcheck.integration.migrated")
            }
            return ["ok":true,"config":nativeConfig()]
        }
        guard let coordinator = model.webCoordinator else { throw NSError(domain: "FollowCheck", code: 1, userInfo: [NSLocalizedDescriptionKey: "A sessão ainda está a iniciar."]) }
        var scoped = args
        if ["likes","memories","legacy","workspace","relationship","requests","discover","lookup"].contains(command) { scoped["accountId"] = model.accountId }
        return try await coordinator.request(command, args: scoped)
    }
    func load() async {
        guard !model.isPreview else { return }
        await workspaceWrite?.value
        let account = model.accountId
        let revision = workspaceRevision
        config=nativeConfig()
        if !UserDefaults.standard.bool(forKey:"followcheck.integration.migrated"), let coordinator=model.webCoordinator,
           let response=try? await coordinator.request("integration",args:["operation":"nativeCredentials"]),
           let legacy=response["config"] as? [String:Any], let key=legacy["apiKey"] as? String,!key.isEmpty {
            if let imported=try? await request("integration",["operation":"configure","config":legacy]) {config=imported["config"] as? [String:Any] ?? config}
        }
        if owner != model.accountId { workspace = [:]; owner = model.accountId }
        guard model.sessionAvailable else{return}
        do {
            let response = try await request("workspace")
            guard account == model.accountId, revision == workspaceRevision,
                  response["accountId"] as? String == account else { return }
            workspace = response["workspace"] as? [String: Any] ?? [:]
            config = (try await request("integration", ["operation":"config"]))["config"] as? [String: Any] ?? [:]
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
    func professional(_ path: String, method: String = "GET", body: [String: Any]? = nil, query: [String: Any] = [:]) async throws -> [String: Any] {
        guard path.hasPrefix("/v1/"), !path.contains(".."), !path.contains("\\"), !path.contains("//") else {
            throw NSError(domain: "FollowCheck", code: 4, userInfo: [NSLocalizedDescriptionKey:"Destino da integração inválido."])
        }
        let secret = IntegrationVault.read() ?? ""
        guard !secret.isEmpty else { throw NSError(domain:"FollowCheck",code:4,userInfo:[NSLocalizedDescriptionKey:"Liga primeiro a integração."]) }
        var components = URLComponents(string:"https://zernio.com/api" + path)!
        components.queryItems = query.flatMap { key,value in
            if let values=value as? [String] { return values.map{URLQueryItem(name:key,value:$0)} }
            return [URLQueryItem(name:key,value:String(describing:value))]
        }
        var outgoing=URLRequest(url:components.url!)
        outgoing.httpMethod=method; outgoing.timeoutInterval=60
        outgoing.setValue("application/json",forHTTPHeaderField:"Accept")
        outgoing.setValue("Bearer " + secret,forHTTPHeaderField:"Authorization")
        if let body {
            outgoing.setValue("application/json",forHTTPHeaderField:"Content-Type")
            outgoing.setValue(UUID().uuidString,forHTTPHeaderField:"x-request-id")
            outgoing.httpBody=try JSONSerialization.data(withJSONObject:body)
        }
        let (bytes,response)=try await URLSession.shared.data(for:outgoing)
        let payload=(try? JSONSerialization.jsonObject(with:bytes)) as? [String:Any] ?? [:]
        guard let http=response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw NSError(domain:"FollowCheck",code:4,userInfo:[NSLocalizedDescriptionKey:AppModel.redact(payload["message"] as? String ?? "O serviço não confirmou o pedido.")])
        }
        return payload
    }

    func upload(_ file: URL, name: String, contentType: String) async throws -> [String:String] {
        let presign = try await professional("/v1/media/presign",method:"POST",body:["filename":name,"contentType":contentType])
        guard let raw=presign["uploadUrl"] as? String,let url=URL(string:raw),url.scheme=="https",
              let host=url.host, host=="media.zernio.com" || host=="r2.cloudflarestorage.com" || host.hasSuffix(".r2.cloudflarestorage.com"),
              let publicURL=presign["publicUrl"] as? String else {
            throw NSError(domain:"FollowCheck",code:5,userInfo:[NSLocalizedDescriptionKey:"O serviço devolveu um destino de upload inesperado."])
        }
        var request=URLRequest(url:url);request.httpMethod="PUT";request.timeoutInterval=300
        request.setValue(contentType,forHTTPHeaderField:"Content-Type")
        let (_,response)=try await URLSession.shared.upload(for:request,fromFile:file)
        guard let http=response as? HTTPURLResponse,(200...299).contains(http.statusCode) else {
            throw NSError(domain:"FollowCheck",code:5,userInfo:[NSLocalizedDescriptionKey:"O ficheiro não foi confirmado pelo armazenamento."])
        }
        return ["type":contentType.hasPrefix("video/") ? "video":"image","url":publicURL,"title":name]
    }
    var csv: String {
        func cell(_ value: String) -> String { "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }
        return "username,nome,segue_te,segues,protegido\n" + model.relations.map { "\(cell($0.username)),\(cell($0.name)),\($0.follows),\($0.following),\(protectedIDs.contains($0.id))" }.joined(separator: "\n")
    }
}

extension NativeTool {
    static let all: [NativeTool] = [
        NativeTool(id: "watchlist", name: "Watchlist", detail: "Abre listas completas de seguidores e seguidos e monitoriza alterações com agenda própria.", category: "Inteligência", icon: "eye", professional: false),
        NativeTool(id: "hashtag-radar", name: "Radar de hashtags", detail: "Encontra autores de publicações e prepara uma fila de follow totalmente revista.", category: "Descoberta", icon: "number", professional: false),
        NativeTool(id: "comment-dm", name: "Comentário → DM", detail: "Responde a palavras-chave e envia uma mensagem privada dentro da mesma ferramenta.", category: "Engagement", icon: "bubble.left.and.text.bubble.right", professional: true),
        NativeTool(id: "publish", name: "Publicar conteúdo", detail: "Publica ou agenda imagens, carrosséis, Reels e Stories com estado real.", category: "Conteúdo", icon: "square.and.arrow.up", professional: true),
        NativeTool(id: "cleanup", name: "Limpeza", detail: "Revê quem segues e quem te segue, marca quem manter e limpa o resto.", category: "Audiência", icon: "person.2.badge.minus", professional: false),
        NativeTool(id: "follow", name: "Seguir perfis", detail: "Segue uma lista confirmada com fila, pausas, ETA e histórico por perfil.", category: "Crescimento", icon: "person.badge.plus", professional: false),
        NativeTool(id: "unfollow", name: "Deixar de seguir", detail: "Processa todos os selecionados; proteção por ritmo, não por cortes artificiais.", category: "Audiência", icon: "person.badge.minus", professional: false),
        NativeTool(id: "remove-followers", name: "Remover seguidores", detail: "Remove seguidores selecionados sem bloquear e atualiza a relação no fim.", category: "Audiência", icon: "person.crop.circle.badge.minus", professional: false),
        NativeTool(id: "follow-back", name: "Follow-back", detail: "Localiza seguidores que ainda não segues e prepara a fila completa.", category: "Crescimento", icon: "arrow.left.arrow.right", professional: false),
        NativeTool(id: "competitors", name: "Radar de concorrentes", detail: "Acompanha perfis marcados, alterações observadas e notas da equipa.", category: "Inteligência", icon: "scope", professional: false),
        NativeTool(id: "audience-search", name: "Pesquisa de audiência", detail: "Filtra por relação, estado, etiquetas, alterações e sinais do perfil.", category: "Audiência", icon: "magnifyingglass", professional: false),
        NativeTool(id: "comment-manager", name: "Gerir comentários", detail: "Consulta, responde, oculta ou elimina comentários suportados.", category: "Engagement", icon: "text.bubble", professional: true),
        NativeTool(id: "inbox", name: "Inbox unificado", detail: "Conversas e pedidos num painel com pesquisa e scroll independentes.", category: "Inbox", icon: "bubble.left.and.bubble.right", professional: true),
        NativeTool(id: "keyword-dm", name: "Automação por palavra", detail: "Cria regras de comentário, resposta pública e DM privada.", category: "Inbox", icon: "bolt", professional: true),
        NativeTool(id: "analytics", name: "Analytics profissional", detail: "Alcance, impressões, interações e saúde da conta num painel.", category: "Inteligência", icon: "chart.bar", professional: true),
        NativeTool(id: "calendar", name: "Calendário editorial", detail: "Planeia cadência, estado e publicação de conteúdo.", category: "Conteúdo", icon: "calendar", professional: false),
        NativeTool(id: "reels", name: "Reels & vídeo", detail: "Prepara uploads de vídeo e acompanha validação e publicação.", category: "Conteúdo", icon: "play.rectangle", professional: true),
        NativeTool(id: "content-library", name: "Biblioteca de conteúdo", detail: "Organiza rascunhos, publicações e ativos por estado.", category: "Conteúdo", icon: "photo.on.rectangle", professional: false),
        NativeTool(id: "history", name: "Histórico auditável", detail: "Vê cada ação, resposta, perfil afetado e resultado final.", category: "Inteligência", icon: "clock.arrow.circlepath", professional: false),
        NativeTool(id: "reports", name: "Relatórios & exportação", detail: "Exporta a audiência e alterações em formatos reutilizáveis.", category: "Inteligência", icon: "square.and.arrow.up", professional: false),
        NativeTool(id: "api-webhooks", name: "API & Webhooks", detail: "Liga ações profissionais e eventos a fluxos externos.", category: "Integrações", icon: "point.3.connected.trianglepath.dotted", professional: true),
        NativeTool(id: "mentions", name: "Menções", detail: "Centraliza menções e transforma-as em tarefas de engagement.", category: "Engagement", icon: "at", professional: true),
        NativeTool(id: "saved", name: "Coleções guardadas", detail: "Agrupa listas, perfis e filtros para reutilizar em operações.", category: "Organização", icon: "bookmark", professional: false),
        NativeTool(id: "random-actions", name: "Rotinas assistidas", detail: "Cria sequências manuais com passos, pausas e confirmação obrigatória.", category: "Organização", icon: "list.bullet.rectangle", professional: false)
    ]
}

struct ToolsView: View {
    let model: AppModel
    @State private var query = ""
    @State private var selected: NativeTool?
    @State private var settings = false
    @State private var diagnostics = false
    private var store: NativeToolsStore { model.tools }
    private var connected: Bool { store.config["configured"] as? Bool == true }
    private var results: [NativeTool] {
        NativeTool.all.filter { "\($0.name) \($0.detail) \($0.category)".localizedCaseInsensitiveContains(query) }
    }
    private var everyday: [NativeTool] {
        NativeTool.all.filter { !$0.professional && !["watchlist", "reports", "history"].contains($0.id) }
    }
    private var professional: [NativeTool] { NativeTool.all.filter(\.professional) }
    private var favorites: [NativeTool] { NativeTool.all.filter { store.favorites.contains($0.id) } }
    private func open(_ tool: NativeTool) {
        Task { await store.remember(tool.id) }
        if tool.id == "watchlist" { model.select(.watchlist); return }
        selected = tool
    }
    private func tool(_ id: String) -> NativeTool? { NativeTool.all.first { $0.id == id } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                ScreenHeader(title: "Mais", subtitle: "Ferramentas, dados e definições.") {
                    IconButton(systemName: "gearshape", label: "Definições") { settings = true }
                }
                SearchField(text: $query, prompt: "Procurar ferramenta ou ação")
                taskStrip
                if !query.isEmpty {
                    if results.isEmpty {
                        EmptyState(icon: "magnifyingglass", title: "Nenhuma ferramenta encontrada", message: "Experimenta outro termo, como “seguir”, “exportar” ou “mensagens”.")
                            .surface(padding: 0)
                    } else {
                        group { ForEach(results) { row($0) } }
                    }
                } else {
                    if !store.recentTools.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Eyebrow(text: "Recentes")
                            ChipRow {
                                ForEach(store.recentTools) { tool in
                                    Button { open(tool) } label: {
                                        Label(tool.name, systemImage: tool.icon).font(.subheadline.weight(.medium)).foregroundStyle(Theme.ink)
                                            .padding(.horizontal, 14).frame(minHeight: 38)
                                            .background(Theme.surface, in: .capsule).overlay(Capsule().strokeBorder(Theme.line))
                                    }
                                    .buttonStyle(PressStyle())
                                }
                            }
                        }
                    }
                    if !favorites.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionHeader(title: "Favoritos")
                            group { ForEach(favorites) { row($0) } }
                        }
                    }
                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeader(title: "A tua conta")
                        group {
                            linkRow(icon: "bubble.left.and.bubble.right", title: "Inbox", detail: "Conversas e pedidos de mensagem") { model.select(.inbox) }
                            if let reports = tool("reports") { row(reports) }
                            if let history = tool("history") { row(history) }
                            linkRow(icon: "list.bullet.rectangle", title: "Centro de operações", detail: "Filas de ações e o estado de cada perfil") {
                                selected = NativeTool(id: "operations", name: "Centro de operações", detail: "", category: "Organização", icon: "list.bullet.rectangle", professional: false)
                            }
                            linkRow(icon: "stethoscope", title: "Diagnóstico", detail: "Eventos técnicos, sem dados sensíveis") { diagnostics = true }
                        }
                    }
                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeader(title: "Ferramentas")
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: 12)], spacing: 12) {
                            ForEach(everyday) { card($0) }
                        }
                    }
                    VStack(alignment: .leading, spacing: 12) {
                        HStack(alignment: .firstTextBaseline) {
                            SectionHeader(title: "Conta profissional")
                            StatusPill(text: connected ? "Ligada" : "Por ligar", tone: connected ? .gain : .neutral)
                        }
                        if !connected {
                            Text("Publicação, comentários, automações e analytics usam a integração Zernio. Liga-a a partir de qualquer uma destas ferramentas.")
                                .font(.footnote).foregroundStyle(Theme.ink2)
                        }
                        group { ForEach(professional) { row($0) } }
                    }
                }
            }
            .padding(.horizontal, 20).padding(.top, 10).padding(.bottom, 28)
            .frame(maxWidth: 760).frame(maxWidth: .infinity)
        }
        .background(Theme.canvas).scrollIndicators(.hidden)
        .defaultScrollAnchor(PreviewFlags.has("--preview-tools-lower") ? .bottom : .top)
        .task { await store.load(); model.loadRelations() }
        .onAppear {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--preview-cleanup") { selected = NativeTool.all.first { $0.id == "cleanup" } }
            if ProcessInfo.processInfo.arguments.contains(where: { ["--preview-intelligence", "--preview-memories"].contains($0) }) { selected = NativeTool(id: "relationship-intelligence", name: "Círculo real", detail: "", category: "Audiência", icon: "person.2", professional: false) }
            if ProcessInfo.processInfo.arguments.contains("--preview-calendar") { selected = NativeTool.all.first { $0.id == "calendar" } }
            if ProcessInfo.processInfo.arguments.contains("--preview-operations") { selected = NativeTool(id: "operations", name: "Centro de operações", detail: "", category: "Organização", icon: "list.bullet.rectangle", professional: false) }
            #endif
        }
        .sheet(item: $selected) { ToolDestination(model: model, tool: $0) }
        .sheet(isPresented: $settings) { SessionView(model: model) }
        .sheet(isPresented: $diagnostics) {
            NavigationStack {
                DiagnosticView(model: model)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fechar") { diagnostics = false } } }
            }
            .tint(Theme.signalInk)
        }
        .alert("FollowCheck", isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) {
            Button("OK") { store.error = nil }
        } message: { Text(store.error ?? "") }
    }

    private func group<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0) { content() }.surface(padding: 0)
    }

    private var taskStrip: some View {
        Button {
            if model.checkIsRunning { model.select(model.activeCheckScope == "watchlist" ? .watchlist : .home) }
            else { selected = NativeTool(id: "operations", name: "Centro de operações", detail: "", category: "Organização", icon: "list.bullet.rectangle", professional: false) }
        } label: {
            HStack(spacing: 14) {
                ZStack {
                    if model.checkIsRunning || store.operationRunning { ProgressView().tint(Theme.onSignal) }
                    else { Image(systemName: "checkmark").font(.system(size: 16, weight: .bold)).foregroundStyle(Theme.onSignal) }
                }
                .frame(width: 40, height: 40).background(Theme.signal, in: .circle)
                VStack(alignment: .leading, spacing: 3) {
                    Eyebrow(text: "Centro de tarefas")
                    Text(store.operationRunning ? "@" + store.operationCurrent : model.checkIsRunning ? model.statusText : "Nenhuma tarefa em curso")
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                    Text(store.operationRunning ? "\(store.operationDone) de \(store.operationTotal) confirmados" : model.checkIsRunning ? model.detailText : "Checks, filas e histórico num só lugar.")
                        .font(.footnote).foregroundStyle(Theme.ink2).lineLimit(2)
                    if store.operationRunning {
                        ProgressView(value: Double(store.operationDone), total: Double(max(1, store.operationTotal))).tint(Theme.signalInk)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3)
            }
            .surface(padding: 14, radius: 20)
        }
        .buttonStyle(PressStyle())
    }

    private func iconTile(_ icon: String, professional: Bool = false) -> some View {
        Image(systemName: icon).font(.system(size: 16, weight: .semibold))
            .foregroundStyle(professional ? Theme.reach : Theme.signalInk)
            .frame(width: 36, height: 36)
            .background((professional ? Theme.reach : Theme.signal).opacity(0.14), in: .rect(cornerRadius: 10, style: .continuous))
    }

    private func linkRow(icon: String, title: String, detail: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                iconTile(icon)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                    Text(detail).font(.footnote).foregroundStyle(Theme.ink2).lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3)
            }
            .padding(.horizontal, 14).padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 0.5).padding(.leading, 62) }
    }

    private func row(_ tool: NativeTool) -> some View {
        Button { open(tool) } label: {
            HStack(spacing: 12) {
                iconTile(tool.icon, professional: tool.professional)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(tool.name).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                        if store.favorites.contains(tool.id) { Image(systemName: "star.fill").font(.caption2).foregroundStyle(Theme.caution) }
                    }
                    Text(tool.detail).font(.footnote).foregroundStyle(Theme.ink2).lineLimit(2)
                }
                Spacer(minLength: 0)
                if tool.professional && !connected {
                    Image(systemName: "link").font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3)
                        .accessibilityLabel("Requer integração")
                }
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3)
            }
            .padding(.horizontal, 14).padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 0.5).padding(.leading, 62) }
        .contextMenu { favoriteButton(tool) }
    }

    private func card(_ tool: NativeTool) -> some View {
        Button { open(tool) } label: {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top) {
                    iconTile(tool.icon)
                    Spacer()
                    if store.favorites.contains(tool.id) { Image(systemName: "star.fill").font(.caption).foregroundStyle(Theme.caution) }
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(tool.name).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                    Text(tool.detail).font(.footnote).foregroundStyle(Theme.ink2).lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
            .surface(padding: 14, radius: 18)
        }
        .buttonStyle(PressStyle())
        .contextMenu { favoriteButton(tool) }
        .accessibilityHint("Mantém premido para adicionar aos favoritos")
    }

    private func favoriteButton(_ tool: NativeTool) -> some View {
        Button(store.favorites.contains(tool.id) ? "Remover dos favoritos" : "Adicionar aos favoritos",
               systemImage: store.favorites.contains(tool.id) ? "star.slash" : "star") {
            Task { await store.favorite(tool.id) }
        }
    }
}

struct ToolDestination: View {
    let model: AppModel
    let tool: NativeTool
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Group {
                if tool.professional { ProfessionalToolView(model:model,tool:tool) }
                else {
                    switch tool.id {
                    case "watchlist": WatchlistView(model:model)
                    case "cleanup": ClassicCleanup(model:model)
                    case "relationship-intelligence": RelationshipIntelligence(model:model)
                    case "operations": NativeQueueView(model:model)
                    case "follow","unfollow","remove-followers","follow-back","audience-search","competitors": OperationStudio(model:model,tool:tool)
                    case "reports": ReportsStudio(model:model)
                    case "history": HistoryStudio(store:model.tools)
                    case "calendar","content-library": LocalStudio(model:model,tool:tool,key:"content-items")
                    case "saved","random-actions": CampaignStudio(model:model,tool:tool)
                    default: DiscoveryStudio(model:model,tool:tool)
                    }
                }
            }.background(FCStyle.background)
            .navigationTitle(tool.name).navigationBarTitleDisplayMode(.inline)
            .task {await model.tools.load()}
            .toolbar { ToolbarItem(placement:.confirmationAction){Button("Fechar"){dismiss()}} }
            .alert("FollowCheck",isPresented:Binding(get:{model.tools.error != nil},set:{if !$0 {model.tools.error=nil}})) { Button("OK"){model.tools.error=nil} } message:{Text(model.tools.error ?? "")}
        }.tint(Theme.signalInk)
    }
}

struct OperationStudio: View {
    let model: AppModel
    let tool: NativeTool
    @State private var query = ""
    @State private var imported: [AppModel.Relation] = []
    @State private var usernames = ""
    @State private var importing = false
    @State private var selected = Set<String>()
    @State private var action = "unfollow"
    @State private var reviewing = false
    @State private var profile: AppModel.Relation?
    @State private var onlyUnprotected = false
    @State private var relationshipFilter = "Todos"
    private var actionTitle: String { ["mute": "Silenciar publicações e Stories", "follow": "Seguir", "unfollow": "Deixar de seguir", "removeFollower": "Remover seguidor", "disconnect": "Remover nos dois sentidos"][action] ?? "Ação" }
    private let relationshipFilters = ["Não me seguem", "Eu não sigo", "Mútuos", "Seguidores", "A seguir", "Todos"]
    private func selectable(_ person: AppModel.Relation) -> Bool {
        person.canPerform(action) && !store.protectedIDs.contains(person.id)
    }
    private var store: NativeToolsStore { model.tools }
    private var pool: [AppModel.Relation] {
        let existing = Set(model.relations.map(\.id))
        return (model.relations + imported.filter { !existing.contains($0.id) }).filter { person in
            switch tool.id {
            case "follow": return !person.following
            case "follow-back": return person.follows && !person.following
            case "unfollow": return person.following
            case "remove-followers": return person.follows
            case "competitors": return store.metadata[person.id]?["watchlist"] as? Bool == true
            default: return true
            }
        }
    }
    private var people: [AppModel.Relation] {
        pool.filter { person in
            let tags = (store.metadata[person.id]?["tags"] as? [String] ?? []).joined(separator: " ")
            return person.matches(relationshipFilter) && (query.isEmpty || "\(person.username) \(person.name) \(tags)".localizedCaseInsensitiveContains(query)) && (!onlyUnprotected || !store.protectedIDs.contains(person.id))
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 12) {
                SearchField(text: $query, prompt: "Nome, username ou etiqueta")
                ChipRow {
                    ForEach(relationshipFilters, id: \.self) { filter in
                        Chip(title: RelationFilter.label(filter), count: model.relationsReady ? pool.filter { $0.matches(filter) }.count : nil, selected: relationshipFilter == filter) {
                            relationshipFilter = filter
                        }
                    }
                }
                Text(RelationFilter.explanation(relationshipFilter)).font(.footnote).foregroundStyle(Theme.ink2)
                if tool.id == "follow" { lookup }
            }
            .padding(.horizontal, 20).padding(.top, 14)
            if !model.relationsReady {
                ScrollView {
                    EmptyState(icon: "person.2", title: "Primeiro, analisa a conta",
                               message: "Ainda não há uma lista completa guardada. Um check recolhe seguidores e contas seguidas para as poderes rever aqui.",
                               actionTitle: "Verificar agora", action: model.scan)
                        .disabled(!model.canScan)
                        .surface(padding: 0)
                        .padding(.horizontal, 20).padding(.top, 8)
                }
            } else {
                HStack(spacing: 10) {
                    Text("\(people.count.formatted()) perfis\(selected.isEmpty ? "" : " · \(selected.count) selecionados")")
                        .font(.footnote.weight(.medium)).foregroundStyle(Theme.ink2).monospacedDigit()
                    Spacer()
                    Menu {
                        Toggle("Esconder protegidos", isOn: $onlyUnprotected)
                    } label: {
                        Image(systemName: onlyUnprotected ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                            .font(.title3).foregroundStyle(Theme.ink2).frame(width: 36, height: 36)
                    }
                    .accessibilityLabel("Filtros")
                    Button(selected.isEmpty ? "Selecionar todos" : "Limpar") {
                        selected = selected.isEmpty ? Set(people.filter { selectable($0) }.map(\.id)) : []
                    }
                    .font(.footnote.weight(.semibold)).disabled(store.operationRunning)
                }
                .padding(.horizontal, 20)
                ScrollView {
                    VStack(spacing: 12) {
                        if let person = store.failedPerson, let encoded = person.username.addingPercentEncoding(withAllowedCharacters: .alphanumerics), let url = URL(string: "https://www.instagram.com/" + encoded + "/") {
                            VStack(alignment: .leading, spacing: 8) {
                                InlineNotice(text: "A ação automática não foi confirmada para @\(person.username). Podes concluí-la no perfil; abrir o perfil não a marca como concluída.")
                                Link("Abrir perfil no Instagram", destination: url).font(.footnote.weight(.semibold))
                            }
                        }
                        if people.isEmpty {
                            EmptyState(icon: "checkmark.circle", title: "Nada nesta lista", message: query.isEmpty ? "Experimenta outro filtro." : "Nenhum perfil corresponde a “\(query)”.")
                                .surface(padding: 0)
                        } else {
                            LazyVStack(spacing: 0) {
                                ForEach(people) { person in
                                    personRow(person)
                                    Divider().overlay(Theme.line).padding(.leading, 104)
                                }
                            }
                            .surface(padding: 0)
                        }
                    }
                    .padding(.horizontal, 20).padding(.top, 4).padding(.bottom, 24)
                }
                .scrollDismissesKeyboard(.immediately)
            }
        }
        .safeAreaInset(edge: .bottom) { if model.relationsReady { actionBar } }
        .task { await store.load() }
        .onChange(of: relationshipFilter) { _, value in if tool.id == "relations" { action = value == "Eu não sigo" ? "follow" : value == "Seguidores" ? "removeFollower" : "unfollow" } }
        .onChange(of: action) { _, _ in selected.formIntersection(Set((model.relations + imported).filter { selectable($0) }.map(\.id))) }
        .onChange(of: model.accountId) { _, _ in selected = []; imported = []; store.failedPerson = nil; Task { await store.load() } }
        .onAppear {
            relationshipFilter = tool.id == "relations" ? model.requestedRelationFilter : tool.id == "unfollow" ? "Não me seguem" : tool.id == "follow-back" ? "Eu não sigo" : "Todos"
            action = ["follow", "follow-back"].contains(tool.id) ? "follow" : tool.id == "remove-followers" ? "removeFollower" : relationshipFilter == "Eu não sigo" && tool.id == "relations" ? "follow" : relationshipFilter == "Seguidores" && tool.id == "relations" ? "removeFollower" : "unfollow"
            model.loadRelations()
        }
        .sheet(isPresented: $reviewing) {
            NativeActionReview(model: model, people: (model.relations + imported.filter { person in !model.relations.contains(where: { $0.id == person.id }) }).filter { selected.contains($0.id) }, action: action)
        }
        .sheet(item: $profile) { person in ProfileNotes(store: store, person: person) }
    }

    private var lookup: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                TextField("Usernames separados por vírgula", text: $usernames)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .padding(.horizontal, 14).frame(minHeight: 44)
                    .background(Theme.surface, in: .rect(cornerRadius: 14, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.line))
                Button("Identificar") {
                    Task {
                        importing = true; defer { importing = false }
                        do {
                            for name in usernames.split(whereSeparator: { $0.isWhitespace || $0 == "," || $0 == ";" }) {
                                let result = try await store.request("lookup", ["username": String(name).replacingOccurrences(of: "@", with: "")])
                                if let data = result["person"] as? [String: Any] {
                                    let person = AppModel.Relation(data)
                                    if !imported.contains(where: { $0.id == person.id }) { imported.append(person) }
                                }
                            }
                            usernames = ""
                        } catch { store.error = error.localizedDescription }
                    }
                }
                .buttonStyle(QuietButtonStyle()).disabled(importing || usernames.isEmpty)
            }
            if importing { ProgressView("A identificar perfis…").font(.footnote) }
        }
    }

    private func personRow(_ person: AppModel.Relation) -> some View {
        let isSelected = selected.contains(person.id)
        let isProtected = store.protectedIDs.contains(person.id)
        let canSelect = selectable(person) && !store.operationRunning
        return HStack(spacing: 12) {
            Button {
                if isSelected { selected.remove(person.id) } else { selected.insert(person.id) }
            } label: {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.title2).foregroundStyle(isSelected ? Theme.signalInk : canSelect ? Theme.ink3 : Theme.line)
                    .frame(width: 30, height: 44)
            }
            .buttonStyle(.plain).disabled(!canSelect)
            .accessibilityLabel(isSelected ? "Desselecionar @\(person.username)" : "Selecionar @\(person.username)")
            Button { profile = person } label: {
                HStack(spacing: 12) {
                    ProfileAvatar(photoURL: person.photoURL, size: 44, name: person.username)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("@\(person.username)").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                        HStack(spacing: 6) {
                            RelationBadge(kind: RelationKind(person))
                            if !person.name.isEmpty { Text(person.name).font(.footnote).foregroundStyle(Theme.ink2).lineLimit(1) }
                        }
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Button { Task { await store.protect(person.id); selected.remove(person.id) } } label: {
                Image(systemName: isProtected ? "shield.fill" : "shield")
                    .font(.body.weight(.medium)).foregroundStyle(isProtected ? Theme.signalInk : Theme.ink3)
                    .frame(width: 40, height: 44)
            }
            .buttonStyle(.plain).disabled(store.busy)
            .accessibilityLabel(isProtected ? "Retirar proteção de @\(person.username)" : "Proteger @\(person.username)")
        }
        .padding(.leading, 12).padding(.trailing, 6).padding(.vertical, 6)
    }

    private var actionBar: some View {
        VStack(spacing: 10) {
            if store.operationRunning {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("\(store.operationDone) de \(store.operationTotal) · @\(store.operationCurrent)").font(.footnote.weight(.semibold)).foregroundStyle(Theme.ink)
                        Spacer()
                        Button("Parar após a atual") { store.operationPaused = true }.font(.footnote.weight(.semibold)).foregroundStyle(Theme.loss)
                    }
                    ProgressView(value: Double(store.operationDone), total: Double(max(1, store.operationTotal))).tint(Theme.signalInk)
                }
            } else {
                HStack(spacing: 10) {
                    Menu {
                        Picker("Ação", selection: $action) {
                            Text("Seguir").tag("follow")
                            Text("Deixar de seguir").tag("unfollow")
                            Text("Remover seguidor").tag("removeFollower")
                            Text("Remover nos dois sentidos").tag("disconnect")
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Text(actionTitle).lineLimit(1)
                            Image(systemName: "chevron.up.chevron.down").font(.caption2.weight(.bold))
                        }
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                        .padding(.horizontal, 14).frame(minHeight: 44)
                        .background(Theme.raised, in: .rect(cornerRadius: 14, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.line))
                    }
                    .accessibilityLabel("Ação: \(actionTitle)")
                    Button(selected.isEmpty ? "Seleciona perfis" : "Rever \(selected.count)") { reviewing = true }
                        .buttonStyle(ProminentButtonStyle())
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .disabled(selected.isEmpty || !model.sessionAvailable || model.watchlistBlocked || store.busy)
                }
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
        .background(.bar)
        .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 0.5) }
    }
}

private struct ProfileNotes: View {
    let store: NativeToolsStore
    let person: AppModel.Relation
    @Environment(\.dismiss) private var dismiss
    @State private var notes = ""
    @State private var tags = ""
    @State private var watched = false
    var body: some View {
        NavigationStack {
            Form {
                Section("Perfil"){Text("@\(person.username)");Text(person.name);Toggle("Adicionar ao radar de concorrentes",isOn:$watched)}
                Section("Etiquetas, separadas por vírgula"){TextField("VIP, Amigos, Cliente…",text:$tags)}
                Section("Notas"){TextEditor(text:$notes).frame(minHeight:130)}
            }.fcForm().navigationTitle("Perfil")
            .toolbar { ToolbarItem(placement:.confirmationAction){Button("Guardar"){Task{var data=store.metadata;var meta=data[person.id] ?? [:];meta["notes"]=notes;meta["tags"]=tags.split(separator:",").map{$0.trimmingCharacters(in:.whitespaces)};meta["watchlist"]=watched;data[person.id]=meta;await store.save("profile-meta",data);if store.error == nil {dismiss()}}}.disabled(store.busy)} }
            .onAppear{let meta=store.metadata[person.id] ?? [:];notes=meta["notes"] as? String ?? "";tags=(meta["tags"] as? [String] ?? []).joined(separator:", ");watched=meta["watchlist"] as? Bool ?? false}
        }.tint(Theme.signalInk)
    }
}

private struct ReportsStudio: View {
    let model: AppModel
    private var json: String {
        let value: [String:Any] = ["accountId":model.accountId,"exportedAt":ISO8601DateFormatter().string(from:Date()),"profiles":model.relations.map{["id":$0.id,"username":$0.username,"name":$0.name,"follows":$0.follows,"following":$0.following] as [String:Any]},"protected":Array(model.tools.protectedIDs),"metadata":model.tools.metadata]
        guard let data=try? JSONSerialization.data(withJSONObject:value,options:[.prettyPrinted,.sortedKeys]) else{return "{}"}
        return String(decoding:data,as:UTF8.self)
    }
    var body: some View {
        ScrollView { VStack(alignment:.leading,spacing:20){
            VStack(alignment:.leading,spacing:4) {
                Text("Os teus dados, prontos a usar").font(.title2.weight(.bold)).foregroundStyle(Theme.ink)
                Text("Exporta o último resultado completo, com as proteções e notas que definiste.").font(.footnote).foregroundStyle(Theme.ink2)
            }
            LazyVGrid(columns:[GridItem(.flexible(),spacing:10),GridItem(.flexible(),spacing:10)],spacing:10) {
                stat("Perfis",model.relations.count)
                stat("Mútuos",model.relations.filter{$0.follows && $0.following}.count)
                stat("Não te seguem",model.relations.filter{$0.following && !$0.follows}.count)
                stat("Não segues",model.relations.filter{$0.follows && !$0.following}.count)
                stat("Protegidos",model.tools.protectedIDs.count)
                stat("Análises",model.tools.records("snapshots").count)
            }
            VStack(spacing:10) {
                ShareLink(item:model.tools.csv,preview:SharePreview("FollowCheck · audiência.csv")) {Label("Exportar CSV",systemImage:"tablecells")}
                    .buttonStyle(SignalButtonStyle()).disabled(!model.relationsReady)
                HStack(spacing:10) {
                    ShareLink(item:json,preview:SharePreview("FollowCheck · audiência.json")) {Label("JSON",systemImage:"curlybraces")}
                        .buttonStyle(QuietButtonStyle(fill:true)).disabled(!model.relationsReady)
                    ShareLink(item:model.diagnosticReport,preview:SharePreview("FollowCheck · diagnóstico")) {Label("Diagnóstico",systemImage:"stethoscope")}
                        .buttonStyle(QuietButtonStyle(fill:true))
                }
                if !model.relationsReady {Text("Faz um check completo para exportar a audiência.").font(.footnote).foregroundStyle(Theme.ink3)}
            }
            let snapshots=model.tools.records("snapshots").reversed().map{StudioRecord(value:$0)}
            if !snapshots.isEmpty {
                SectionHeader(title:"Análises guardadas")
                VStack(spacing:0) {
                    ForEach(snapshots){item in
                        HStack {
                            VStack(alignment:.leading,spacing:3){
                                Text("\(item.value["total"] as? Int ?? 0) contas · \(item.value["reciprocity"] as? Int ?? 0)% reciprocidade").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                                Text("\(item.value["mutual"] as? Int ?? 0) mútuos · \(item.value["nonFollowers"] as? Int ?? 0) sem reciprocidade").font(.footnote).foregroundStyle(Theme.ink2)
                            }
                            Spacer()
                            Text(Self.day(item.value["timestamp"] as? String ?? "")).font(.caption).foregroundStyle(Theme.ink3)
                        }.padding(.horizontal,14).padding(.vertical,11)
                        Divider().overlay(Theme.line).padding(.leading,14)
                    }
                }.surface(padding:0)
            }
        }.padding(20)}.task{model.loadRelations()}
    }
    private func stat(_ title:String,_ value:Int)->some View {
        VStack(alignment:.leading,spacing:2) {
            Text(value.formatted()).font(.system(.title3,design:.rounded).weight(.semibold)).monospacedDigit().foregroundStyle(Theme.ink)
            Text(title).font(.caption).foregroundStyle(Theme.ink2)
        }.frame(maxWidth:.infinity,alignment:.leading).surface(padding:12,radius:14)
    }
    private static func day(_ raw:String)->String {
        guard let date=ISO8601DateFormatter.fractional.date(from:raw) ?? ISO8601DateFormatter().date(from:raw) else{return raw}
        return date.formatted(date:.abbreviated,time:.shortened)
    }
}

private struct HistoryStudio: View {
    let store: NativeToolsStore
    @State private var query=""
    @State private var outcome="Todos"
    private var filtered:[[String:Any]] {store.records("history").filter{record in
        (query.isEmpty || "\(record["username"] ?? "") \(record["action"] ?? "")".localizedCaseInsensitiveContains(query)) &&
        (outcome=="Todos" || (record["success"] as? Bool==true)==(outcome=="Confirmadas"))
    }}
    var body: some View {
        ScrollView { LazyVStack(alignment:.leading,spacing:12){
            HStack{Label("\(store.records("snapshots").count) análises",systemImage:"chart.xyaxis.line");Spacer();Text("\(store.records("history").filter{$0["success"] as? Bool==true}.count) ações confirmadas")}.font(.caption).fcCard()
            TextField("Pesquisar perfil ou ação",text:$query).textInputAutocapitalization(.never).padding(14).background(FCStyle.card,in:.rect(cornerRadius:14))
            Picker("Resultado",selection:$outcome){ForEach(["Todos","Confirmadas","Não confirmadas"],id:\.self){Text($0)}}.pickerStyle(.segmented)
            if store.records("history").isEmpty {ContentUnavailableView("Ainda sem ações guardadas",systemImage:"clock.arrow.circlepath")}
            ForEach(filtered.map{StudioRecord(value:$0)}){item in
                let record = item.value
                VStack(alignment:.leading,spacing:8){
                    Text("\(record["action"] as? String ?? "Ação") · @\(record["username"] as? String ?? "")").font(.headline)
                    Label(record["success"] as? Bool == true ? "Confirmada":"Não confirmada",systemImage:record["success"] as? Bool == true ? "checkmark.circle":"exclamationmark.circle").foregroundStyle(record["success"] as? Bool == true ? Theme.signalInk:Theme.caution)
                    Text(record["timestamp"] as? String ?? "").font(.caption).foregroundStyle(.secondary)
                    if let message=record["message"] as? String{Text(message).font(.caption).foregroundStyle(.secondary)}
                }.frame(maxWidth:.infinity,alignment:.leading).fcCard()
            }
        }.padding(20)}.task{await store.load()}
    }
}

private struct StudioRecord: Identifiable {
    let value: [String:Any]
    var id: String { String(describing:value["id"] ?? value["_id"] ?? "\(value["timestamp"] ?? "")-\(value["username"] ?? "")-\(value["action"] ?? "")") }
    var title: String { value["title"] as? String ?? value["name"] as? String ?? value["participantName"] as? String ?? value["username"] as? String ?? "Registo" }
    var detail: String { value["content"] as? String ?? value["description"] as? String ?? value["notes"] as? String ?? value["lastMessage"] as? String ?? value["text"] as? String ?? "" }
}

private struct LocalStudio: View {
    let model: AppModel
    let tool: NativeTool
    let key: String
    @State private var editing: StudioRecord?
    @State private var removing: StudioRecord?
    @State private var query=""
    @State private var status="Todos"
    @State private var day=Date()
    @State private var allDates=true
    @State private var publishing:StudioRecord?
    @State private var collectionPeople:[AppModel.Relation]=[]
    @State private var collectionAction="follow"
    @State private var collectionReview=false
    @State private var resolving=false
    @State private var collectionError:String?
    private func prepareCollection(_ item:StudioRecord,_ action:String) async {
        guard !resolving else{return};resolving=true;collectionError=nil
        defer{resolving=false}
        let owner=model.accountId
        var resolved:[AppModel.Relation]=[]
        do {
            for value in item.value["usernames"] as? [String] ?? [] {
                let name=value.trimmingCharacters(in:.whitespacesAndNewlines).replacingOccurrences(of:"@",with:"")
                if let existing=model.relations.first(where:{$0.username.lowercased()==name.lowercased()}) {resolved.append(existing)}
                else {
                    let result=try await store.request("lookup",["username":name])
                    guard owner==model.accountId else{return}
                    guard let person=result["person"] as? [String:Any] else{throw NSError(domain:"FollowCheck",code:1,userInfo:[NSLocalizedDescriptionKey:"Não foi possível identificar @"+name])}
                    resolved.append(AppModel.Relation(person))
                }
            }
            guard owner==model.accountId else{return}
            var ids=Set<String>()
            collectionPeople=resolved.filter{ids.insert($0.id).inserted}
            collectionAction=action;collectionReview=true
        }catch{if owner==model.accountId{collectionError=error.localizedDescription}}
    }
    private var records:[[String:Any]] {store.records(key).filter{item in
        let record=StudioRecord(value:item)
        guard query.isEmpty || "\(record.title) \(record.detail)".localizedCaseInsensitiveContains(query) else{return false}
        guard status=="Todos" || item["status"] as? String==status else{return false}
        guard tool.id=="calendar" && !allDates else{return true}
        guard let raw=item["scheduledFor"] as? String,let date=ISO8601DateFormatter().date(from:raw) else{return false}
        return Calendar.current.isDate(date,inSameDayAs:day)
    }.sorted{String(describing:$0["scheduledFor"] ?? "")<String(describing:$1["scheduledFor"] ?? "")}}
    private var store: NativeToolsStore { model.tools }
    var body: some View {
        ScrollView { VStack(alignment:.leading,spacing:18){
            Text(tool.detail).font(.subheadline).foregroundStyle(.secondary)
            if tool.id=="calendar" {
                DatePicker("Dia",selection:$day,displayedComponents:.date).datePickerStyle(.graphical)
                Toggle("Mostrar todas as datas",isOn:$allDates)
            }
            HStack(spacing:10){Image(systemName:"magnifyingglass").foregroundStyle(.secondary);TextField("Pesquisar conteúdo",text:$query)}.padding(14).background(FCStyle.card,in:.rect(cornerRadius:14)).overlay(RoundedRectangle(cornerRadius:14).strokeBorder(Theme.line))
            if resolving {ProgressView("A identificar os perfis da coleção…")}
            if let collectionError {Text(collectionError).foregroundStyle(Theme.caution)}
            Picker("Estado",selection:$status){Text("Todos").tag("Todos");Text("Ideias").tag("idea");Text("Rascunhos").tag("draft");Text("Prontos").tag("ready");Text("Planeados").tag("planned")}.pickerStyle(.menu)
            Button(key == "collections" ? "Criar coleção":"Novo conteúdo",systemImage:"plus"){editing=StudioRecord(value:["id":UUID().uuidString,"status":"draft"])}.buttonStyle(ProminentButtonStyle())
            if store.records(key).isEmpty {ContentUnavailableView(key == "collections" ? "Cria a tua primeira coleção":"O teu próximo conteúdo começa aqui",systemImage:tool.icon)}
            ForEach(records.map{StudioRecord(value:$0)}){item in
                VStack(alignment:.leading,spacing:12){
                    Text(item.title).font(.headline)
                    Text(item.detail).font(.subheadline).foregroundStyle(.secondary)
                    if let url=(item.value["mediaURLs"] as? [String])?.first.flatMap(URL.init(string:)){AsyncImage(url:url){image in image.resizable().scaledToFit()}placeholder:{ProgressView()}.frame(maxHeight:220).clipShape(.rect(cornerRadius:14))}
                    if let date=item.value["scheduledFor"] as? String {Text(date).font(.caption).foregroundStyle(FCStyle.accent)}
                    HStack{Text(item.value["status"] as? String ?? "Rascunho local").font(.caption);Spacer();Button("Editar"){editing=item};Button("Eliminar",role:.destructive){removing=item}}
                    if key=="content-items" {Button("Preparar publicação",systemImage:"square.and.arrow.up"){publishing=item}.disabled(store.config["configured"] as? Bool != true)}
                    if key=="collections" {
                        Text((item.value["usernames"] as? [String] ?? []).map{"@"+$0}.joined(separator:" · ")).font(.caption).foregroundStyle(.secondary)
                        Menu("Preparar perfis") {
                            Button("Seguir"){Task{await prepareCollection(item,"follow")}}
                            Button("Deixar de seguir"){Task{await prepareCollection(item,"unfollow")}}
                            Button("Remover seguidores"){Task{await prepareCollection(item,"removeFollower")}}
                        }.disabled(resolving || store.operationRunning)
                    }
                }.frame(maxWidth:.infinity,alignment:.leading).fcCard()
            }
        }.padding(20)}
        .sheet(item:$editing){item in LocalEditor(store:store,item:item,key:key)}
        .sheet(item:$publishing){item in ProfessionalComposer(store:store,mode:"posts",video:false,seed:item.value)}
        .sheet(isPresented:$collectionReview){NativeActionReview(model:model,people:collectionPeople,action:collectionAction)}
        .confirmationDialog("Eliminar este registo?",isPresented:Binding(get:{removing != nil},set:{if !$0{removing=nil}}),titleVisibility:.visible){Button("Eliminar",role:.destructive){guard let item=removing else{return};Task{await store.save(key,store.records(key).filter{StudioRecord(value:$0).id != item.id})};removing=nil}}
    }
}

private struct LocalEditor: View {
    let store: NativeToolsStore
    let item: StudioRecord
    let key: String
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var content = ""
    @State private var date = Date()
    @State private var planned = false
    @State private var usernames = ""
    @State private var status="draft"
    @State private var mediaURLs=""
    var body: some View {
        NavigationStack {
            Form {
                Section("Nome"){TextField("Título",text:$title)}
                Section(key == "collections" ? "Notas":"Legenda / briefing"){TextEditor(text:$content).frame(minHeight:140)}
                if key=="content-items" {
                    Section("Estado editorial"){Picker("Estado",selection:$status){Text("Ideia").tag("idea");Text("Rascunho").tag("draft");Text("Pronto").tag("ready");Text("Planeado").tag("planned")}}
                    Section("Media · um URL por linha"){TextEditor(text:$mediaURLs).frame(minHeight:90).textInputAutocapitalization(.never).autocorrectionDisabled()}
                }
                if key == "collections" {Section("Perfis — um username por linha"){TextEditor(text:$usernames).frame(minHeight:140).textInputAutocapitalization(.never)}}
                else {Section("Calendário editorial"){Toggle("Adicionar ao calendário",isOn:$planned);if planned {DatePicker("Data",selection:$date)}};Section{Text("Este é um rascunho local. Para publicar ou agendar no Instagram, usa Publicar conteúdo e confirma a operação na integração.").font(.footnote).foregroundStyle(.secondary)}}
            }.fcForm().navigationTitle(key == "collections" ? "Coleção":"Conteúdo")
            .toolbar {
                ToolbarItem(placement:.cancellationAction){Button("Cancelar"){dismiss()}}
                ToolbarItem(placement:.confirmationAction){Button("Guardar"){Task{var value=item.value;value["title"]=title;value["content"]=content;value["status"]=status;value["mediaURLs"]=mediaURLs.split(whereSeparator: \.isNewline).map(String.init);value["updatedAt"]=ISO8601DateFormatter().string(from:Date());if planned{value["scheduledFor"]=ISO8601DateFormatter().string(from:date)}else{value.removeValue(forKey:"scheduledFor")};if key == "collections" {value["usernames"]=usernames.split(whereSeparator:{$0.isWhitespace||$0==","}).map(String.init)};var values=store.records(key);if let index=values.firstIndex(where:{StudioRecord(value:$0).id==item.id}){values[index]=value}else{values.insert(value,at:0)};await store.save(key,values);if store.error == nil{dismiss()}}}.disabled(title.trimmingCharacters(in:.whitespaces).isEmpty||store.busy)}
            }
            .onAppear{title=item.title == "Registo" ? "":item.title;content=item.detail;status=item.value["status"] as? String ?? "draft";mediaURLs=(item.value["mediaURLs"] as? [String] ?? []).joined(separator:"\n");usernames=(item.value["usernames"] as? [String] ?? []).joined(separator:"\n");if let raw=item.value["scheduledFor"] as? String,let parsed=ISO8601DateFormatter().date(from:raw){date=parsed;planned=true}}
        }.tint(Theme.signalInk)
    }
}

private struct DiscoveryStudio: View {
    let model: AppModel
    let tool: NativeTool
    var initialTag:String=""
    @State private var tag = ""
    @State private var people: [AppModel.Relation] = []
    @State private var selected = Set<String>()
    @State private var loading = false
    @State private var confirm = false
    var body: some View {
        VStack(alignment:.leading,spacing:16){
            Text(tool.id == "hashtag-radar" ? "Descobre autores e revê os perfis antes de os seguir.":"Prepara uma rotina de follow a partir de perfis descobertos. Cada execução exige a tua confirmação.").font(.subheadline).foregroundStyle(.secondary)
            HStack{TextField("#hashtag",text:$tag).textInputAutocapitalization(.never).autocorrectionDisabled();Button("Pesquisar"){Task{loading=true;defer{loading=false};do{let result=try await model.tools.request("discover",["tag":tag]);people=(result["accounts"] as? [[String:Any]] ?? []).map(AppModel.Relation.init);selected=[]}catch{model.tools.error=error.localizedDescription}}}.disabled(loading||tag.isEmpty)}.fcCard()
            if loading{ProgressView("A consultar publicações…")}
            ScrollView{LazyVStack(spacing:12){ForEach(people){person in Button{if selected.contains(person.id){selected.remove(person.id)}else{selected.insert(person.id)}}label:{HStack{Image(systemName:selected.contains(person.id) ? "checkmark.circle.fill":"circle");Text("@\(person.username)");Spacer();Text(person.name).font(.caption).foregroundStyle(.secondary)}.fcCard()}.buttonStyle(.plain)}}}
            Button("Rever follow de \(selected.count) perfis"){confirm=true}.buttonStyle(ProminentButtonStyle()).disabled(selected.isEmpty||model.tools.operationRunning)
            Button("Guardar como coleção"){Task{let value:[String:Any]=["id":UUID().uuidString,"title":"#\(tag)","usernames":people.filter{selected.contains($0.id)}.map(\.username),"content":"Perfis descobertos no radar de hashtags."];await model.tools.save("collections",[value]+model.tools.records("collections"))}}.disabled(selected.isEmpty||model.tools.busy)
        }.padding(20).onAppear{if tag.isEmpty{tag=initialTag}}
        .sheet(isPresented:$confirm){NativeActionReview(model:model,people:people.filter{selected.contains($0.id)},action:"follow")}
    }
}

private struct ProfessionalToolView: View {
    let model: AppModel
    let tool: NativeTool
    @State private var records: [StudioRecord] = []
    @State private var metrics: [String:String] = [:]
    @State private var loading = false
    @State private var configure = false
    @State private var creating = false
    @State private var selected: StudioRecord?
    @State private var deleting: StudioRecord?
    @State private var failure: String?
    private var store: NativeToolsStore { model.tools }
    private var account: String { store.config["selectedAccountId"] as? String ?? "" }
    private var profile: String { store.config["selectedProfileId"] as? String ?? "" }
    private var mode: String {
        switch tool.id {
        case "publish","reels":return "posts"
        case "comment-dm","keyword-dm":return "automations"
        case "comment-manager","mentions":return "comments"
        case "inbox":return "inbox"
        case "analytics":return "analytics"
        default:return "diagnostic"
        }
    }
    private func load() async {
        guard !loading else{return};loading=true;failure=nil;defer{loading=false}
        guard store.config["configured"] as? Bool == true else{return}
        do {
            let data:[String:Any]
            switch mode {
            case "posts":data=try await store.professional("/v1/posts",query:["platform":"instagram","limit":50,"accountId":account])
            case "automations":data=try await store.professional("/v1/comment-automations",query:["profileId":profile])
            case "comments":data=try await store.professional("/v1/inbox/comments",query:["platform":"instagram","accountId":account,"limit":50])
            case "inbox":data=try await store.professional("/v1/inbox/conversations",query:["platform":"instagram","accountId":account,"limit":50])
            case "analytics":data=try await store.professional("/v1/analytics/instagram/account-insights",query:["accountId":account])
            default:data=try await store.professional("/v1/accounts/health",query:["platform":"instagram"])
            }
            let keys = mode == "posts" ? ["posts","data"] : mode == "automations" ? ["automations","data"] : mode == "inbox" ? ["conversations","data"] : mode == "comments" ? ["posts","data"] : ["accounts","data"]
            records=(keys.compactMap{data[$0] as? [[String:Any]]}.first ?? []).map{StudioRecord(value:$0)}
            var collected:[String:String]=[:]
            func collect(_ object:[String:Any],prefix:String="") {
                for (key,value) in object where !["id","accountId","_id","profileId"].contains(key) {
                    let label=prefix.isEmpty ? key:"\(prefix) · \(key)"
                    if let number=value as? NSNumber {collected[label]=number.stringValue}
                    else if let nested=value as? [String:Any] {collect(nested,prefix:label)}
                }
            }
            if ["analytics","diagnostic"].contains(mode){collect(data)}
            metrics=collected
        }catch{failure=error.localizedDescription}
    }
    var body: some View {
        ScrollView { VStack(alignment:.leading,spacing:18){
            Text(tool.detail).foregroundStyle(.secondary)
            HStack{Label(store.config["configured"] as? Bool == true ? "Integração ligada":"Ligar integração",systemImage:"link").font(.subheadline);Spacer();Button("Configurar"){configure=true}}
            if store.config["configured"] as? Bool != true {
                ContentUnavailableView("Liga a tua conta profissional",systemImage:"link",description:Text("Estas ferramentas utilizam a integração Zernio já presente na versão original. Configura a ligação para aceder às operações reais."))
                Button("Ligar integração"){configure=true}.buttonStyle(ProminentButtonStyle())
            }else{
                HStack{Button("Atualizar",systemImage:"arrow.clockwise"){Task{await load()}}.disabled(loading);Spacer();if ["posts","automations"].contains(mode){Button("Criar",systemImage:"plus"){creating=true}.disabled(account.isEmpty)}}
                if loading{ProgressView("A carregar…").frame(maxWidth:.infinity)}
                if let failure{Text(failure).foregroundStyle(Theme.caution).fcCard()}
                if !metrics.isEmpty {ForEach(metrics.keys.sorted(),id:\.self){key in LabeledContent(key.replacingOccurrences(of:"_",with:" "),value:metrics[key] ?? "").fcCard()}}
                ForEach(records){item in
                    VStack(alignment:.leading,spacing:12){
                        Text(item.title).font(.headline)
                        if !item.detail.isEmpty{Text(item.detail).font(.subheadline).foregroundStyle(.secondary)}
                        if let status=item.value["status"] as? String{Text(status).font(.caption).foregroundStyle(FCStyle.accent)}
                        if let date=item.value["scheduledFor"] as? String{Text(date).font(.caption)}
                        HStack{
                            if ["inbox","comments"].contains(mode){Button(mode == "inbox" ? "Abrir conversa":"Ver comentários"){selected=item}}
                            if mode == "automations"{Button(item.value["isActive"] as? Bool == true ? "Pausar":"Ativar"){Task{do{_ = try await store.professional("/v1/comment-automations/\(item.id)",method:"PATCH",body:["isActive":!(item.value["isActive"] as? Bool ?? false)]);await load()}catch{failure=error.localizedDescription}}}}
                            Spacer()
                            if ["posts","automations"].contains(mode){Button("Eliminar",role:.destructive){deleting=item}}
                        }
                    }.frame(maxWidth:.infinity,alignment:.leading).fcCard()
                }
                if records.isEmpty && metrics.isEmpty && !loading && failure == nil {Text("A consulta não devolveu registos.").foregroundStyle(.secondary).padding(.vertical,30)}
            }
        }.padding(20)}
        .task{await store.load();await load()}
        .sheet(isPresented:$configure,onDismiss:{Task{await load()}}){IntegrationSettings(store:store)}
        .sheet(isPresented:$creating,onDismiss:{Task{await load()}}){ProfessionalComposer(store:store,mode:mode,video:tool.id == "reels")}
        .sheet(item:$selected){item in ProfessionalConversation(store:store,item:item,comments:mode == "comments")}
        .confirmationDialog("Eliminar este registo no serviço?",isPresented:Binding(get:{deleting != nil},set:{if !$0{deleting=nil}}),titleVisibility:.visible){Button("Eliminar",role:.destructive){guard let item=deleting else{return};Task{do{_ = try await store.professional("/v1/\(mode == "posts" ? "posts":"comment-automations")/\(item.id)",method:"DELETE");await load()}catch{failure=error.localizedDescription}};deleting=nil}}
    }
}

private struct IntegrationSettings: View {
    let store: NativeToolsStore
    @Environment(\.dismiss) private var dismiss
    @State private var apiKey = ""
    @State private var accounts: [StudioRecord] = []
    @State private var profiles: [StudioRecord] = []
    @State private var account = ""
    @State private var profile = ""
    @State private var busy = false
    @State private var message: String?
    @State private var disconnect = false
    private func connect() async {
        busy=true;defer{busy=false}
        do {
            if !apiKey.isEmpty{store.config=(try await store.request("integration",["operation":"configure","config":["apiKey":apiKey]]))["config"] as? [String:Any] ?? [:];apiKey=""}
            let a=try await store.professional("/v1/accounts",query:["platform":"instagram"])
            accounts=(a["accounts"] as? [[String:Any]] ?? []).map{StudioRecord(value:$0)}
            let p=try await store.professional("/v1/profiles")
            profiles=(p["profiles"] as? [[String:Any]] ?? []).map{StudioRecord(value:$0)}
            account=store.config["selectedAccountId"] as? String ?? ""
            profile=store.config["selectedProfileId"] as? String ?? ""
            message="Ligação confirmada. Escolhe a conta e o perfil."
        }catch{message=error.localizedDescription}
    }
    var body: some View {
        NavigationStack {
            Form {
                Section("Ligação profissional"){
                    SecureField("Chave API Zernio",text:$apiKey).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("Validar ligação"){Task{await connect()}}.disabled(busy)
                    if busy{ProgressView()}
                    if let message{Text(message).font(.footnote)}
                }
                if !accounts.isEmpty {
                    Section("Destino"){
                        Picker("Conta",selection:$account){Text("Selecionar").tag("");ForEach(accounts){item in Text(item.title).tag(item.id)}}
                        Picker("Perfil",selection:$profile){Text("Selecionar").tag("");ForEach(profiles){item in Text(item.title).tag(item.id)}}
                        Button("Guardar seleção"){Task{do{store.config=(try await store.request("integration",["operation":"configure","config":["selectedAccountId":account,"selectedProfileId":profile]]))["config"] as? [String:Any] ?? [:];dismiss()}catch{message=error.localizedDescription}}}.disabled(account.isEmpty||busy)
                    }
                }
                if store.config["configured"] as? Bool == true {Section{Button("Desligar integração",role:.destructive){disconnect=true}}}
            }.fcForm().navigationTitle("Integração")
            .toolbar{ToolbarItem(placement:.confirmationAction){Button("Fechar"){dismiss()}}}
            .task{if store.config["configured"] as? Bool == true{await connect()}}
            .confirmationDialog("Remover a chave guardada neste dispositivo?",isPresented:$disconnect,titleVisibility:.visible){Button("Desligar",role:.destructive){Task{do{store.config=(try await store.request("integration",["operation":"disconnect"]))["config"] as? [String:Any] ?? [:];dismiss()}catch{message=error.localizedDescription}}}}
        }.tint(Theme.signalInk)
    }
}

private struct ProfessionalComposer: View {
    let store: NativeToolsStore
    let mode: String
    let video: Bool
    var seed:[String:Any]=[:]
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var content = ""
    @State private var urls = ""
    @State private var importing = false
    @State private var files: [URL] = []
    @State private var uploaded: [String:[String:String]] = [:]
    @State private var format = "feed"
    @State private var delivery = "draft"
    @State private var date = Date().addingTimeInterval(3600)
    @State private var keywords = ""
    @State private var reply = ""
    @State private var confirm = false
    @State private var busy = false
    @State private var message: String?
    private var account: String {store.config["selectedAccountId"] as? String ?? ""}
    private var payload: [String:Any] {
        if mode == "automations" {
            return ["name":title,"accountId":account,"profileId":store.config["selectedProfileId"] as? String ?? "","trigger":"comment","keywords":keywords.split(separator:",").map{$0.trimmingCharacters(in:.whitespaces)},"matchMode":"contains","dmMessage":content,"commentReply":reply,"linkTracking":true]
        }
        let media=urls.split(whereSeparator:\.isNewline).map{String($0).trimmingCharacters(in:.whitespaces)}.filter{!$0.isEmpty}.map{["url":$0,"type":$0.lowercased().contains(".mp4") || $0.lowercased().contains(".mov") ? "video":"image"]}
        var body:[String:Any]=["title":title,"content":content,"mediaItems":media + files.compactMap{uploaded[$0.path]},"platforms":[["platform":"instagram","accountId":account,"platformSpecificData":format == "feed" ? [:]:["contentType":format]]],"timezone":TimeZone.current.identifier]
        if delivery == "draft"{body["isDraft"]=true}else if delivery == "now"{body["publishNow"]=true}else{body["scheduledFor"]=ISO8601DateFormatter().string(from:date)}
        return body
    }
    var body: some View {
        NavigationStack{
            Form{
                Section("Nome"){TextField("Título",text:$title)}
                if mode == "automations"{
                    Section("Palavras-chave, separadas por vírgulas"){TextField("GUIA, PREÇO…",text:$keywords)}
                    Section("Mensagem privada"){TextEditor(text:$content).frame(minHeight:110)}
                    Section("Resposta pública opcional"){TextField("Resposta ao comentário",text:$reply)}
                    Section{Text("Depois de confirmada pelo serviço, a regra é executada no Zernio, incluindo com a app fechada.").font(.footnote)}
                }else{
                    Section("Formato"){Picker("Tipo",selection:$format){Text("Publicação").tag("feed");Text("Reel").tag("reels");Text("Story").tag("story")}}
                    Section("Legenda"){TextEditor(text:$content).frame(minHeight:110)}
                    Section("Ficheiros deste iPhone") {
                        Button("Escolher imagens ou vídeos",systemImage:"photo.on.rectangle") { importing = true }.disabled(busy)
                        ForEach(files,id:\.path) { file in
                            HStack { Text(file.lastPathComponent).lineLimit(1);Spacer();Button("Remover",role:.destructive){files.removeAll{$0==file};try? FileManager.default.removeItem(at:file)}.disabled(busy) }
                        }
                    }
                    Section("URLs públicas dos ficheiros — uma por linha"){TextEditor(text:$urls).frame(minHeight:110).textInputAutocapitalization(.never).autocorrectionDisabled()}
                    Section("Entrega"){Picker("Quando",selection:$delivery){Text("Rascunho").tag("draft");Text("Publicar agora").tag("now");Text("Agendar").tag("schedule")};if delivery == "schedule"{DatePicker("Data",selection:$date,in:Date()...)}}
                }
                if let message{Section{Text(message).foregroundStyle(Theme.caution)}}
                Section{Button(mode == "automations" ? "Rever automação":"Rever publicação"){confirm=true}.disabled(busy||title.isEmpty||account.isEmpty||(mode == "automations" ? keywords.isEmpty||content.isEmpty:urls.isEmpty && files.isEmpty));if busy{ProgressView()}}
            }.fcForm().navigationTitle(mode == "automations" ? "Nova automação":"Publicar conteúdo")
            .toolbar{ToolbarItem(placement:.cancellationAction){Button("Fechar"){dismiss()}.disabled(busy)}}
            .onAppear{
                if video{format="reels"}
                title=seed["title"] as? String ?? "";content=seed["content"] as? String ?? ""
                keywords=seed["keywords"] as? String ?? ""
                urls=(seed["mediaURLs"] as? [String] ?? []).joined(separator:"\n")
                if let raw=seed["scheduledFor"] as? String,let parsed=ISO8601DateFormatter().date(from:raw),parsed>Date(){date=parsed;delivery="schedule"}
            }
            .confirmationDialog(mode == "automations" ? "Criar esta automação no serviço?":"Confirmar o envio desta publicação ao serviço?",isPresented:$confirm,titleVisibility:.visible){Button("Confirmar"){Task{busy=true;defer{busy=false};do{if mode != "automations" {
                            for file in files where uploaded[file.path] == nil {
                                message = "A enviar \(file.lastPathComponent)…"
                                let mime=UTType(filenameExtension:file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                                uploaded[file.path]=try await store.upload(file,name:file.lastPathComponent,contentType:mime)
                            }
                        }
                        let response = try await store.professional(mode == "automations" ? "/v1/comment-automations":"/v1/posts",method:"POST",body:payload)
                        if mode != "automations",let id=seed["id"] as? String {
                            var items=store.records("content-items")
                            if let index=items.firstIndex(where:{$0["id"] as? String==id}) {
                                items[index]["submittedAt"]=ISO8601DateFormatter().string(from:Date())
                                items[index]["delivery"]=delivery
                                items[index]["status"]="submitted"
                                if let remote=response["id"] {items[index]["remoteId"]=remote}
                                await store.save("content-items",items)
                            }
                        }
                        dismiss()}catch{message=error.localizedDescription}}}}
        }.tint(Theme.signalInk)
        .interactiveDismissDisabled(busy)
        .fileImporter(isPresented:$importing,allowedContentTypes:[.image,.movie],allowsMultipleSelection:true) { result in
            do {
                for source in try result.get() {
                    let granted=source.startAccessingSecurityScopedResource()
                    defer { if granted { source.stopAccessingSecurityScopedResource() } }
                    let size=(try source.resourceValues(forKeys:[.fileSizeKey])).fileSize ?? 0
                    guard size <= 350 * 1024 * 1024 else { message="O limite por ficheiro é 350 MB.";continue }
                    let directory=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
                    try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
                    let target=directory.appendingPathComponent(source.lastPathComponent)
                    try FileManager.default.copyItem(at:source,to:target);files.append(target)
                }
            } catch { message=error.localizedDescription }
        }
        .onDisappear { if !busy { for file in files { try? FileManager.default.removeItem(at:file.deletingLastPathComponent()) } } }
    }
}

private struct ProfessionalConversation: View {
    let store: NativeToolsStore
    let item: StudioRecord
    let comments: Bool
    @Environment(\.dismiss) private var dismiss
    @State private var records: [StudioRecord] = []
    @State private var text = ""
    @State private var commentID = ""
    @State private var privateReply = false
    @State private var busy = false
    @State private var failure: String?
    @State private var confirming = false
    private var account: String {item.value["accountId"] as? String ?? store.config["selectedAccountId"] as? String ?? ""}
    private var path: String {comments ? "/v1/inbox/comments/\(item.id)":"/v1/inbox/conversations/\(item.id)/messages"}
    private func load() async {
        busy=true;defer{busy=false}
        do{let data=try await store.professional(path,query:["accountId":account,"limit":100,"sortOrder":"asc"]);records=(data[comments ? "comments":"messages"] as? [[String:Any]] ?? []).map{StudioRecord(value:$0)}}catch{failure=error.localizedDescription}
    }
    var body: some View {
        NavigationStack{
            VStack(spacing:14){
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(records) { record in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(record.title).font(.caption.bold()).foregroundStyle(FCStyle.accent)
                                Text(record.detail).textSelection(.enabled)
                                if comments {
                                    HStack {
                                        Button("Responder") { commentID = record.id; privateReply = false }
                                        Button("DM") { commentID = record.id; privateReply = true }
                                        Spacer()
                                        Button("Ocultar") {
                                            Task {
                                                do {
                                                    _ = try await store.professional("\(path)/\(record.id)/hide", method: "POST", body: ["accountId": account])
                                                    await load()
                                                } catch { failure = error.localizedDescription }
                                            }
                                        }
                                    }
                                }
                            }.frame(maxWidth: .infinity, alignment: .leading).fcCard()
                        }
                    }
                }
                if let failure{Text(failure).font(.footnote).foregroundStyle(Theme.caution)}
                if busy{ProgressView()}
                if comments && !commentID.isEmpty{Text(privateReply ? "Resposta privada ao comentário selecionado":"Resposta pública ao comentário selecionado").font(.caption)}
                HStack{TextField("Mensagem",text:$text,axis:.vertical).lineLimit(1...5);Button("Enviar"){confirming=true}.disabled(text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty||busy||(comments&&commentID.isEmpty))}.fcCard()
            }.padding(16).background(FCStyle.background).navigationTitle(item.title).navigationBarTitleDisplayMode(.inline)
            .toolbar{ToolbarItem(placement:.confirmationAction){Button("Fechar"){dismiss()}}}.task{await load()}
            .confirmationDialog("Enviar esta mensagem?",isPresented:$confirming,titleVisibility:.visible){Button("Enviar"){Task{busy=true;defer{busy=false};do{var body:[String:Any]=["accountId":account,"message":text];if comments{body["commentId"]=commentID};let destination=comments&&privateReply ? "\(path)/\(commentID)/private-reply":path;_ = try await store.professional(destination,method:"POST",body:body);text="";await load()}catch{failure=error.localizedDescription}}}}
        }.tint(Theme.signalInk)
    }
}

struct RequestsStudio: View {
    let model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var kind = "outgoing"
    @State private var people: [AppModel.Relation] = []
    @State private var selected = Set<String>()
    @State private var busy = false
    @State private var loaded = false
    @State private var failure: String?
    @State private var confirm = false
    private func load() async {
        busy=true;failure=nil;defer{busy=false}
        do{let result=try await model.tools.request("requests",["kind":kind]);people=(result["accounts"] as? [[String:Any]] ?? []).map(AppModel.Relation.init);loaded=true;selected=[]}catch{failure=error.localizedDescription}
    }
    var body: some View {
        NavigationStack {
            VStack(spacing:16){
                Picker("Pedidos",selection:$kind){Text("Enviados").tag("outgoing");Text("Recebidos").tag("incoming")}.pickerStyle(.segmented).disabled(busy).onChange(of:kind){_,_ in people=[];loaded=false;selected=[]}
                Button("Consultar pedidos",systemImage:"arrow.clockwise"){Task{await load()}}.disabled(busy)
                if busy{ProgressView("A consultar…")}
                if let failure{Text(failure).foregroundStyle(Theme.caution)}
                if loaded && people.isEmpty{ContentUnavailableView("Nenhum pedido nesta consulta",systemImage:"person.crop.circle.badge.checkmark")}
                ScrollView{LazyVStack(spacing:10){ForEach(people){person in HStack{if kind == "outgoing"{Button{if selected.contains(person.id){selected.remove(person.id)}else{selected.insert(person.id)}}label:{Image(systemName:selected.contains(person.id) ? "checkmark.circle.fill":"circle").font(.title2)}};VStack(alignment:.leading){Text("@\(person.username)").font(.headline);Text(person.name).font(.caption).foregroundStyle(.secondary)};Spacer()}.fcCard()}}}
                if kind == "outgoing"{Button("Cancelar \(selected.count) pedidos"){confirm=true}.buttonStyle(ProminentButtonStyle()).disabled(selected.isEmpty||busy||model.tools.operationRunning)}
            }.padding(20).background(FCStyle.background).navigationTitle("Pedidos")
            .toolbar{ToolbarItem(placement:.confirmationAction){Button("Fechar"){dismiss()}}}
            .confirmationDialog("Cancelar os pedidos selecionados?",isPresented:$confirm,titleVisibility:.visible){Button("Cancelar pedidos",role:.destructive){let chosen=people.filter{selected.contains($0.id)};selected=[];Task{await model.tools.execute("unfollow",people:chosen);failure=model.tools.error;loaded=false}}}
        }.tint(Theme.signalInk)
    }
}

private struct CampaignStudio: View {
    let model: AppModel
    let tool: NativeTool
    @State private var recipes: [StudioRecord] = []
    @State private var reviewing: StudioRecord?
    @State private var naming: StudioRecord?
    @State private var name = ""
    @State private var keywords = ""
    @State private var templates:[StudioRecord]=[]
    @State private var selectedTool:NativeTool?
    @State private var preparedCampaign:[String:Any]=[:]
    @State private var failure: String?
    @State private var loading = false
    private var store: NativeToolsStore {model.tools}
    private func reload() async {
        loading=true; defer{loading=false}
        let owner=model.accountId
        await store.load()
        do {
            let result=try await store.request("legacy",["operation":"recipes"])
            guard owner==model.accountId else{return}
            recipes=(result["recipes"] as? [[String:Any]] ?? []).map{StudioRecord(value:$0)}
            templates=(result["templates"] as? [[String:Any]] ?? []).map{StudioRecord(value:$0)}
            failure=result["needsSnapshot"] as? Bool == true ? "Faz um check para calcular os candidatos das receitas.":nil
        }catch{if owner==model.accountId{failure=error.localizedDescription}}
    }
    private func people(_ recipe:StudioRecord)->[AppModel.Relation] {
        (recipe.value["candidates"] as? [[String:Any]] ?? []).map{RelationshipEvidence(raw:["user":$0]).person}
    }
    private func prepare(_ campaign:StudioRecord) {
        let template=campaign.value["templateId"] as? String ?? ""
        let routes=["hashtag-radar":"hashtag-radar","comment-assistant":"comment-manager","keyword-dm":"keyword-dm","content-cadence":"calendar","competitor-watch":"competitors"]
        if let route=routes[template] {preparedCampaign=campaign.value;selectedTool=NativeTool.all.first{$0.id==route};return}
        guard let recipe=recipes.first(where:{$0.id==campaign.value["sourceRecipeId"] as? String}) else {
            failure="Atualiza as receitas para preparar esta campanha.";return
        }
        reviewing=recipe
        var rows=store.records("automation-campaigns")
        if let index=rows.firstIndex(where:{StudioRecord(value:$0).id==campaign.id}) {
            rows[index]["status"]="prepared"
            rows[index]["candidateCount"]=people(recipe).count
            rows[index]["runs"]=(rows[index]["runs"] as? Int ?? 0)+1
            rows[index]["lastRunAt"]=ISO8601DateFormatter().string(from:Date())
            Task{await store.save("automation-campaigns",rows)}
        }
    }
    var body: some View {
        ScrollView {
            LazyVStack(alignment:.leading,spacing:18) {
                Text("As tuas rotinas e coleções").font(.title2.bold())
                Text("Receitas com os critérios originais. Prepara os candidatos e revê cada perfil antes de agir.").foregroundStyle(.secondary)
                if loading {ProgressView("A preparar receitas…")}
                if let failure {Text(failure).foregroundStyle(Theme.caution)}
                ForEach(recipes) {recipe in
                    VStack(alignment:.leading,spacing:12) {
                        HStack {Text(recipe.title).font(.headline);Spacer();Text(people(recipe).count.formatted()).font(.title2.bold()).foregroundStyle(FCStyle.accent)}
                        Text(recipe.detail).font(.subheadline).foregroundStyle(.secondary)
                        Text((recipe.value["rules"] as? [String] ?? []).joined(separator:" · ")).font(.caption)
                        HStack {
                            Button("Rever candidatos"){reviewing=recipe}.buttonStyle(ProminentButtonStyle()).disabled(people(recipe).isEmpty)
                            Button("Guardar rotina"){name=recipe.title;keywords="";naming=recipe}.buttonStyle(QuietButtonStyle())
                        }
                    }.frame(maxWidth:.infinity,alignment:.leading).fcCard()
                }
                Text("Modelos originais").font(.title3.bold())
                ForEach(templates){template in
                    Button{name=template.title;keywords="";naming=template}label:{VStack(alignment:.leading,spacing:8){Text(template.title).font(.headline);Text(template.detail).font(.caption).foregroundStyle(.secondary)}.frame(maxWidth:.infinity,alignment:.leading).fcCard()}.buttonStyle(.plain)
                }
                Text("Campanhas guardadas").font(.title3.bold())
                ForEach(store.records("automation-campaigns").map{StudioRecord(value:$0)}) {campaign in
                    VStack(alignment:.leading,spacing:10) {
                        Text(campaign.title).font(.headline)
                        Text(campaign.detail).font(.subheadline).foregroundStyle(.secondary)
                        Text("Preparações: \(campaign.value["runs"] as? Int ?? 0)").font(.caption)
                        HStack {
                            Button("Preparar"){prepare(campaign)}
                            Spacer()
                            Button("Eliminar",role:.destructive){Task{await store.save("automation-campaigns",store.records("automation-campaigns").filter{StudioRecord(value:$0).id != campaign.id})}}
                        }
                    }.fcCard()
                }
                LocalStudio(model:model,tool:tool,key:"collections")
            }.padding(20)
        }
        .task(id:model.accountId){recipes=[];await reload()}
        .refreshable{await reload()}
        .sheet(item:$reviewing){recipe in NativeActionReview(model:model,people:people(recipe),action:recipe.value["action"] as? String ?? "unfollow")}
        .sheet(item:$selectedTool){tool in
            if tool.id=="hashtag-radar" {NavigationStack{DiscoveryStudio(model:model,tool:tool,initialTag:preparedCampaign["keywords"] as? String ?? "").navigationTitle(tool.name).toolbar{ToolbarItem(placement:.confirmationAction){Button("Fechar"){selectedTool=nil}}}}}
            else if tool.id=="keyword-dm",store.config["configured"] as? Bool == true {ProfessionalComposer(store:store,mode:"automations",video:false,seed:["title":preparedCampaign["name"] ?? "","keywords":preparedCampaign["keywords"] ?? ""])}
            else {ToolDestination(model:model,tool:tool)}
        }
        .alert("Guardar rotina",isPresented:Binding(get:{naming != nil},set:{if !$0{naming=nil}})) {
            TextField("Nome",text:$name)
            TextField("Hashtags ou palavras-chave",text:$keywords)
            Button("Guardar"){
                if let recipe=naming {
                    let isTemplate=templates.contains{$0.id==recipe.id}
                    let row:[String:Any]=["id":UUID().uuidString,"name":name,"description":recipe.detail,"keywords":keywords,"sourceRecipeId":recipe.value["sourceRecipeId"] as? String ?? (isTemplate ? "":recipe.id),"templateId":isTemplate ? recipe.id:recipe.id+"-campaign","status":"ready","runs":0,"createdAt":ISO8601DateFormatter().string(from:Date())]
                    Task{await store.save("automation-campaigns",store.records("automation-campaigns")+[row])}
                };naming=nil
            }.disabled(name.trimmingCharacters(in:.whitespaces).isEmpty)
            Button("Cancelar",role:.cancel){naming=nil}
        }
    }
}
