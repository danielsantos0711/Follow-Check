import SwiftUI
import UniformTypeIdentifiers

struct NativeQueueView:View {
    let model:AppModel
    @State private var review=false
    private var store:NativeToolsStore {model.tools}
    private var draft:[String:Any] {store.workspace["operation-draft"] as? [String:Any] ?? [:]}
    private var rows:[[String:Any]] {store.queueRows.isEmpty ? draft["rows"] as? [[String:Any]] ?? []:store.queueRows}
    private var action:String {store.queueAction.isEmpty ? draft["action"] as? String ?? "unfollow":store.queueAction}
    private var pending:[AppModel.Relation] {rows.filter{$0["status"] as? String=="pending"}.map(AppModel.Relation.init)}
    var body:some View {
        ScrollView {LazyVStack(alignment:.leading,spacing:16){
            VStack(alignment:.leading,spacing:4) {
                Text("Centro de operações").font(.title2.weight(.bold)).foregroundStyle(Theme.ink)
                Text("Cada perfil tem um estado. Ações sem confirmação não são repetidas automaticamente.").font(.footnote).foregroundStyle(Theme.ink2)
            }
            if store.operationRunning {
                VStack(alignment:.leading,spacing:10) {
                    HStack {
                        Text("\(store.operationDone) de \(store.operationTotal)").font(.title3.weight(.semibold)).monospacedDigit().foregroundStyle(Theme.ink)
                        Spacer()
                        Text("@"+store.operationCurrent).font(.footnote.weight(.semibold)).foregroundStyle(Theme.ink2)
                    }
                    ProgressView(value:Double(store.operationDone),total:Double(max(store.operationTotal,1))).tint(Theme.signalInk)
                    if let until=store.queueWaitUntil {
                        HStack{Text("Próxima ação").foregroundStyle(Theme.ink2);Spacer();Text(until,style:.relative).monospacedDigit()}.font(.footnote)
                    }
                    Button("Parar após a operação atual",role:.destructive){store.operationPaused=true}.buttonStyle(QuietButtonStyle())
                }.surface(fill:Theme.signal.opacity(0.08))
            }else if !pending.isEmpty {
                Button("Rever \(pending.count) perfis ainda não iniciados"){review=true}.buttonStyle(SignalButtonStyle())
            }
            if rows.isEmpty {
                EmptyState(icon:"list.bullet.rectangle",title:"Ainda sem operações",message:"Prepara uma seleção em Pessoas, Limpeza ou Coleções.").surface(padding:0)
            } else {
                VStack(spacing:0) {
                    ForEach(rows.compactMap{row -> QueueRecord? in guard let id=row["id"] as? String else{return nil};return QueueRecord(id:id,value:row)}){item in
                        let status=item.value["status"] as? String ?? "pending"
                        HStack(spacing:12) {
                            ProfileAvatar(photoURL:item.value["photoURL"] as? String ?? "",size:40,name:item.value["username"] as? String ?? "")
                            VStack(alignment:.leading,spacing:3){
                                Text("@"+(item.value["username"] as? String ?? "")).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                                Text(Self.labels[status] ?? status).font(.footnote).foregroundStyle(status=="confirmed" ? Theme.signalInk:status=="unconfirmed" ? Theme.caution:Theme.ink2)
                                if let message=item.value["message"] as? String{Text(message).font(.caption).foregroundStyle(Theme.ink2)}
                            }
                            Spacer()
                            Image(systemName:status=="confirmed" ? "checkmark.circle.fill":status=="unconfirmed" ? "exclamationmark.triangle.fill":status=="running" ? "arrow.triangle.2.circlepath":"clock")
                                .foregroundStyle(status=="confirmed" ? Theme.signalInk:status=="unconfirmed" ? Theme.caution:Theme.ink3)
                        }.padding(.horizontal,14).padding(.vertical,10)
                        Divider().overlay(Theme.line).padding(.leading,66)
                    }
                }.surface(padding:0)
            }
        }.padding(20)}.background(Theme.canvas).task{await store.load()}
            .sheet(isPresented:$review){NativeActionReview(model:model,people:pending,action:action)}
    }
    private struct QueueRecord:Identifiable {let id:String;let value:[String:Any]}
    private static let labels=["pending":"Ainda não iniciada","running":"Em curso / por confirmar","confirmed":"Confirmada","unconfirmed":"Sem confirmação — revisão necessária"]
}

struct RelationshipEvidence: Identifiable {
    let raw: [String:Any]
    var user:[String:Any] { raw["user"] as? [String:Any] ?? [:] }
    var features:[String:Any] { raw["features"] as? [String:Any] ?? [:] }
    var profile:[String:Any] { raw["profile"] as? [String:Any] ?? [:] }
    var proof:[String:Any] { features["proofGraph"] as? [String:Any] ?? [:] }
    var id:String { user["id"] as? String ?? "" }
    var protected:Bool { raw["isProtected"] as? Bool ?? false }
    var score:Int { (features["relationshipScore"] as? NSNumber)?.intValue ?? 0 }
    var confidence:Int { (proof["calibratedConfidence"] as? NSNumber ?? features["hybridConfidence"] as? NSNumber)?.intValue ?? 0 }
    var circle:String { features["relationshipCircle"] as? String ?? "unknown" }
    var person:AppModel.Relation { AppModel.Relation(["id":id,"username":user["username"] ?? "","name":user["full_name"] ?? "","photoURL":user["profile_pic_url"] ?? "","follows":user["follows_viewer"] ?? false,"following":user["followed_by_viewer"] ?? false]) }
}

struct RelationshipIntelligence: View {
    let model:AppModel
    @State private var rows:[RelationshipEvidence]=[]
    @State private var plan:[String:Any]=[:]
    @State private var source:[String:Any]=[:]
    @State private var target=300
    @State private var query=""
    @State private var filter="Todos"
    @State private var relation="Todos"
    @State private var confidence="Todas"
    @State private var selected=Set<String>()
    @State private var detail:RelationshipEvidence?
    @State private var importing=false
    @State private var memories=false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var loading=false
    @State private var loadingAccount=""
    @State private var loadingOperation=""
    @State private var refreshPending=false
    @State private var loadToken=UUID()
    @State private var failure:String?
    @State private var review=false
    @State private var action="unfollow"
    @State private var undo:[[String:Any]]=[]
    private var store:NativeToolsStore {model.tools}
    private let filters=["Todos","Objetivo","Unilaterais","Adormecidos 1 ano","Adormecidos 2 anos","Adormecidos 3 anos","Suspeitos","Transformados","Mútuos silenciosos","Contradições","Verificação antiga"]
    private var candidateIDs:Set<String> {Set(plan["candidates"] as? [String] ?? [])}
    private var visible:[RelationshipEvidence] {
        rows.filter { row in
            let p=row.person,f=row.features
            let tags=(store.metadata[p.id]?["tags"] as? [String] ?? []).joined(separator:" ")
            guard query.isEmpty || "\(p.username) \(p.name) \(tags)".localizedCaseInsensitiveContains(query),p.matches(relation) else{return false}
            if confidence=="Alta" && row.confidence<80{return false}
            if confidence=="Média" && !(55..<80).contains(row.confidence){return false}
            if confidence=="Baixa" && row.confidence>=55{return false}
            switch filter {
            case "Objetivo":return candidateIDs.contains(row.id)
            case "Unilaterais":return ["outbound","inbound"].contains(f["energy"] as? String ?? "")
            case "Adormecidos 1 ano":return (f["dormantYears"] as? Double ?? 0)>=1
            case "Adormecidos 2 anos":return (f["dormantYears"] as? Double ?? 0)>=2
            case "Adormecidos 3 anos":return (f["dormantYears"] as? Double ?? 0)>=3
            case "Suspeitos":return f["suspicious"] as? Bool == true || f["inactive"] as? Bool == true
            case "Transformados":return f["transformed"] as? Bool == true
            case "Mútuos silenciosos":return f["silentMutual"] as? Bool == true
            case "Contradições":return !(row.proof["contradictions"] as? [Any] ?? []).isEmpty
            case "Verificação antiga":return f["verificationStale"] as? Bool == true
            default:return true
            }
        }.sorted{$0.score == $1.score ? $0.person.username<$1.person.username:$0.score<$1.score}
    }
    private var chosen:[AppModel.Relation] {rows.filter{selected.contains($0.id) && !$0.protected}.map(\.person)}
    private func refresh(_ operation:String="derive",files:[[String:Any]] = [],urls:[URL] = []) async {
        #if DEBUG
        if model.isPreview {
            rows=model.relations.map{person in RelationshipEvidence(raw:["user":["id":person.id,"username":person.username,"full_name":person.name,"followed_by_viewer":person.following,"follows_viewer":person.follows],"features":["relationshipScore":42,"hybridConfidence":65,"relationshipCircle":"occasional"],"profile":["evidenceSummary":"Pré-visualização local"]])}
            return
        }
        #endif
        guard !loading || loadingAccount != model.accountId else{if operation=="derive"{refreshPending=true};return};loading=true;failure=nil
        let account=model.accountId
        let token=UUID();loadToken=token;loadingAccount=account
        model.legacyProgress="";loadingOperation=operation
        defer{if loadToken==token{
            loading=false
            if refreshPending {refreshPending=false;Task{await refresh()}}
        }}
        do {
            let r:[String:Any]
            if operation=="import",!urls.isEmpty {
                guard let coordinator=model.webCoordinator else {throw NSError(domain:"FollowCheck",code:1,userInfo:[NSLocalizedDescriptionKey:"A sessão ainda está a iniciar."])}
                r=try await coordinator.importArchive(urls,target:target)
            } else {r=try await store.request("legacy",["operation":operation,"target":target,"files":files,"username":model.username,"ids":Array(selected)])}
            guard loadToken==token,account==model.accountId,r["accountId"] as? String==account else{return}
            rows=(r["rows"] as? [[String:Any]] ?? []).map{RelationshipEvidence(raw:$0)}
            plan=r["plan"] as? [String:Any] ?? [:];source=r["source"] as? [String:Any] ?? [:]
            selected.formIntersection(Set(rows.filter{!$0.protected}.map(\.id)))
            await store.load()
            if operation != "derive" {await model.saveScanBackup()}
        }catch{if account==model.accountId {failure=error.localizedDescription}}
    }
    private func decide(_ value:String) {
        let previous=store.workspace["relationship-decisions"] as? [String:Any] ?? [:]
        undo.append(previous)
        var next=previous
        for row in rows where selected.contains(row.id) && !row.protected {next[row.id]=value}
        Task{await store.save("relationship-decisions",next)}
    }
    var body:some View {
        ScrollView {
            LazyVStack(alignment:.leading,spacing:18) {
                VStack(alignment:.leading,spacing:4) {
                    Text("O teu círculo real").font(.largeTitle.weight(.bold)).foregroundStyle(Theme.ink)
                    Text("Histórico, relação atual e evidência por pessoa. Tu decides o resultado.").font(.subheadline).foregroundStyle(Theme.ink2)
                }
                sources
                HStack(spacing:10) {
                    metric("Analisados",rows.count);metric("Protegidos",rows.filter(\.protected).count)
                    metric("Candidatos",candidateIDs.count)
                }
                VStack(alignment:.leading,spacing:12) {
                    Eyebrow(text:"1 · Construir plano")
                    Stepper("Objetivo: \(target) mútuos",value:$target,in:0...10000,step:10).font(.subheadline)
                    Button("Construir plano de revisão",systemImage:"slider.horizontal.3") {Task{var preferences=store.workspace["relationship-preferences"] as? [String:Any] ?? [:];preferences["target"]=target;await store.save("relationship-preferences",preferences);await refresh();filter="Objetivo";selected=candidateIDs}}
                        .buttonStyle(ProminentButtonStyle()).disabled(loading || rows.isEmpty)
                    Text("Conversas, proteções, contradições e dados insuficientes ficam fora das sugestões automáticas.").font(.footnote).foregroundStyle(Theme.ink2)
                }.surface()
                SearchField(text:$query,prompt:"Nome, username ou etiqueta")
                ChipRow {
                    ForEach(filters,id:\.self){name in Chip(title:name,selected:filter==name){filter=name}}
                }
                HStack(spacing:14) {
                    Menu {Picker("Relação",selection:$relation){ForEach(["Todos","Mútuos","Não me seguem","Eu não sigo"],id:\.self){Text(RelationFilter.label($0)).tag($0)}}} label:{Label(relation=="Todos" ? "Relação":RelationFilter.label(relation),systemImage:"person.2")}
                    Menu {Picker("Confiança",selection:$confidence){ForEach(["Todas","Alta","Média","Baixa"],id:\.self){Text($0)}}} label:{Label(confidence=="Todas" ? "Confiança":confidence,systemImage:"gauge.with.dots.needle.33percent")}
                    Spacer()
                }.font(.footnote.weight(.semibold))
                HStack {
                    Text("\(visible.count) perfis · \(selected.count) selecionados").font(.footnote).foregroundStyle(Theme.ink2).monospacedDigit()
                    Spacer()
                    Button("Selecionar resultados"){selected=Set(visible.filter{!$0.protected}.map(\.id))}.font(.footnote.weight(.semibold))
                }
                if loading {HStack{ProgressView(model.legacyProgress.isEmpty ? "A cruzar evidências…":model.legacyProgress).font(.footnote);Spacer();Button("Cancelar"){model.webCoordinator?.cancelArchiveImport();if loadingOperation != "import" {model.cancelCurrentScan()}}.font(.footnote.weight(.semibold))}.surface()}
                if let failure {InlineNotice(text:failure)}
                if !visible.isEmpty {
                    VStack(spacing:0) {
                        ForEach(visible) {row in
                            HStack(spacing:12) {
                                Button {if selected.contains(row.id){selected.remove(row.id)}else{selected.insert(row.id)}} label:{
                                    Image(systemName:row.protected ? "shield.fill":selected.contains(row.id) ? "checkmark.circle.fill":"circle").font(.title2)
                                        .foregroundStyle(row.protected || selected.contains(row.id) ? Theme.signalInk:Theme.ink3).frame(width:30,height:44)
                                }.buttonStyle(.plain).disabled(row.protected)
                                ProfileAvatar(photoURL:row.person.photoURL,size:42,name:row.person.username)
                                Button {detail=row} label:{
                                    VStack(alignment:.leading,spacing:4) {
                                        Text("@"+row.person.username).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                                        Text(Self.circles[row.circle] ?? row.circle).font(.caption.weight(.semibold)).foregroundStyle(Theme.signalInk)
                                        HStack(spacing:8) {
                                            scoreBar(row.score)
                                            Text("ligação \(row.score)% · confiança \(row.confidence)%").font(.caption).foregroundStyle(Theme.ink2).monospacedDigit()
                                        }
                                        if (store.workspace["profile-meta"] as? [String:[String:Any]])?[row.id]?["mutedPosts"] as? Bool == true {Label("Silenciado",systemImage:"speaker.slash").font(.caption).foregroundStyle(Theme.ink2)}
                                        if let decision=(store.workspace["relationship-decisions"] as? [String:String])?[row.id] {Text(decision=="keep" ? "Manter":decision=="review" ? "Rever depois":decision).font(.caption.weight(.semibold)).foregroundStyle(Theme.reach)}
                                    }.frame(maxWidth:.infinity,alignment:.leading).contentShape(Rectangle())
                                }.buttonStyle(.plain)
                                Image(systemName:"chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3)
                            }.padding(.horizontal,12).padding(.vertical,8)
                            Divider().overlay(Theme.line).padding(.leading,96)
                        }
                    }.surface(padding:0)
                }
                if rows.isEmpty && !loading {EmptyState(icon:"circle.hexagongrid",title:"Começa pela audiência",message:"Faz um check e importa o histórico do Instagram para recuperar a análise de ligações.").surface(padding:0)}
            }.padding(20)
        }.background(Theme.canvas)
        .animation(reduceMotion ? nil:.easeInOut(duration:0.2),value:selected.count)
        .safeAreaInset(edge:.bottom){decisionsBar}
        .task{await store.load();target=(store.workspace["relationship-preferences"] as? [String:Any])?["target"] as? Int ?? 300;await refresh()
            #if DEBUG
            if model.isPreview,ProcessInfo.processInfo.arguments.contains("--preview-memories"){memories=true}
            #endif
        }
        .onChange(of:model.accountId){_,_ in rows=[];selected=[];undo=[];Task{await refresh()}}
        .onChange(of:store.operationDone){_,_ in Task{await refresh()}}
        .onChange(of:store.operationRunning){_,running in if !running {Task{await refresh()}}}
        .sheet(item:$detail){EvidenceDetail(model:model,row:$0)}
        .sheet(isPresented:$memories){PrivateMemoryGallery(model:model)}
        .onDisappear{model.webCoordinator?.cancelArchiveImport()}
        .sheet(isPresented:$review){NativeActionReview(model:model,people:chosen,action:action)}
        .fileImporter(isPresented:$importing,allowedContentTypes:[.zip,.json],allowsMultipleSelection:true){result in
            Task {
                do {
                    let urls=try result.get()
                    await refresh("import",urls:urls)
                }catch{failure=error.localizedDescription}
            }
        }
    }
    private func metric(_ title:String,_ count:Int)->some View {VStack(alignment:.leading,spacing:2){Text(count.formatted()).font(.system(.title2,design:.rounded).weight(.semibold)).monospacedDigit().foregroundStyle(Theme.ink);Text(title).font(.caption).foregroundStyle(Theme.ink2)}.frame(maxWidth:.infinity,alignment:.leading).surface(padding:12,radius:16)}
    private func scoreBar(_ score:Int)->some View {
        ZStack(alignment:.leading) {
            Capsule().fill(Theme.sunken)
            Capsule().fill(Theme.signal).frame(width:max(3,CGFloat(min(100,max(0,score)))*0.44))
        }.frame(width:44,height:5).accessibilityHidden(true)
    }
    private var sources:some View {
        VStack(alignment:.leading,spacing:12) {
            Label("Fontes da análise",systemImage:"square.stack.3d.up").font(.headline)
            Button("Importar histórico Instagram · ZIP / JSON",systemImage:"square.and.arrow.down"){importing=true}
            Text("ZIP até 1 GB · leitura por blocos no iPhone").font(.caption2).foregroundStyle(.secondary)
            HStack {
                Button("Memórias privadas",systemImage:"lock.rectangle.stack"){memories=true}
                Spacer()
                Button("Sincronizar conta profissional"){Task{await refresh("professional")}}
                    .disabled(store.config["configured"] as? Bool != true)
            }.font(.caption)
            HStack {
                Button("Conversas recentes"){Task{await refresh("conversations")}}
                Spacer();Button("Gostos e comentários"){Task{await refresh("engagement")}}
            }.font(.caption)
            if let count=source["matchedProfiles"] as? Int {Text("Histórico associado a \(count) perfis").font(.caption).foregroundStyle(FCStyle.mint)}
            Text("O histórico é analisado localmente. A ausência de sinais não prova ausência de relação.").font(.caption2).foregroundStyle(.secondary)
        }.fcCard().disabled(loading)
    }
    private var decisionsBar:some View {
        VStack(spacing:10) {
            HStack {
                Text("2 · Escolher ação").font(.caption.bold());Spacer()
                Button("Desfazer"){if let previous=undo.popLast(){Task{await store.save("relationship-decisions",previous)}}}.disabled(undo.isEmpty)
                Button("Limpar"){selected=[]}
            }
            HStack {
                Button("Manter"){decide("keep");selected=[]}
                Button("Rever depois"){decide("review");selected=[]}
                Spacer()
                Menu("Preparar ação") {
                    Button("Verificar perfis selecionados"){Task{await refresh("verify")}}
                    Button("Silenciar publicações e Stories"){action="mute";review=true}
                    Button("Só deixar de seguir"){action="unfollow";review=true}
                    Button("Só remover seguidor"){action="removeFollower";review=true}
                    Button("Desligar nos dois sentidos"){action="disconnect";review=true}
                }.buttonStyle(ProminentButtonStyle())
            }.disabled(chosen.isEmpty || store.operationRunning)
        }.font(.caption).padding(16).background(.ultraThinMaterial)
    }
    static let circles=["close":"Círculo próximo","active":"Ligação ativa","occasional":"Contacto ocasional","weak":"Ligação fraca","dormant":"Ligação adormecida","none":"Sem contacto","unknown":"Dados insuficientes"]
}

private struct EvidenceDetail:View {
    let model:AppModel
    @State private var memories=false
    let row:RelationshipEvidence
    @Environment(\.dismiss) private var dismiss
    var body:some View {
        NavigationStack {
            ScrollView {VStack(alignment:.leading,spacing:18){
                Button("Ver excertos privados",systemImage:"lock.rectangle.stack"){memories=true}
                    .sheet(isPresented:$memories){PrivateMemoryGallery(model:model,profileID:row.id)}
                HStack{ProfileAvatar(photoURL:row.person.photoURL,size:64);VStack(alignment:.leading){Text("@"+row.person.username).font(.title2.bold());Text(row.person.name).foregroundStyle(.secondary)}}
                LabeledContent("Força da ligação",value:"\(row.score)%")
                LabeledContent("Confiança",value:"\(row.confidence)%")
                Text(row.profile["evidenceSummary"] as? String ?? "Sem histórico associado").foregroundStyle(.secondary)
                ForEach(["reason","protectionReason","autoCleanupReason"],id:\.self){key in
                    if let values=row.profile[key] as? [String]{ForEach(values,id:\.self){Text($0).font(.subheadline)}}
                    if let value=row.features[key] as? String,!value.isEmpty{Text(value).font(.subheadline).foregroundStyle(Theme.caution)}
                }
                if let signals=row.profile["signals"] as? [String:Any] {
                    Text("Sinais do histórico").font(.headline)
                    ForEach(signals.keys.sorted(),id:\.self){key in if let number=signals[key] as? NSNumber {LabeledContent(Self.labels[key] ?? key,value:number.stringValue).font(.subheadline)}}
                }
                Text("Livro de prova").font(.headline)
                ForEach((row.proof["ledger"] as? [[String:Any]] ?? []).indices,id:\.self){index in
                    let evidence=(row.proof["ledger"] as? [[String:Any]] ?? [])[index]
                    VStack(alignment:.leading,spacing:6){
                        Text(evidence["label"] as? String ?? "Evidência").font(.subheadline.bold())
                        Text(evidence["providerLabel"] as? String ?? "").font(.caption).foregroundStyle(.secondary)
                        if let quality=evidence["quality"] as? NSNumber {Text("Qualidade da fonte: \(quality.intValue)%").font(.caption)}
                    }.frame(maxWidth:.infinity,alignment:.leading).fcCard()
                }
                ForEach(row.proof["abstentionReasons"] as? [String] ?? [],id:\.self){Text($0).font(.subheadline).foregroundStyle(Theme.caution)}
                if let next=row.proof["nextBestAction"] as? [String:Any] {
                    VStack(alignment:.leading,spacing:6){Text(next["label"] as? String ?? "Próximo passo").font(.headline);Text(next["reason"] as? String ?? "").font(.subheadline).foregroundStyle(.secondary)}.fcCard()
                }
                DisclosureGroup("Detalhes da análise"){Text(Self.formatted(row.proof)).font(.caption.monospaced()).textSelection(.enabled)}
            }.padding(20)}.navigationTitle("Evidência por perfil").navigationBarTitleDisplayMode(.inline)
                .toolbar{ToolbarItem(placement:.confirmationAction){Button("Concluído"){dismiss()}}}
        }.tint(Theme.signalInk)
    }
    private static let labels=["dmSent":"Mensagens enviadas","dmReceived":"Mensagens recebidas","dmDays":"Dias com mensagens","likesGiven":"Gostos teus","commentsGiven":"Comentários teus","mentions":"Menções","storyReactions":"Reações a Stories","total":"Total de sinais"]
    private static func formatted(_ value:[String:Any])->String {guard let data=try? JSONSerialization.data(withJSONObject:value,options:[.prettyPrinted,.sortedKeys])else{return "Sem evidência adicional"};return String(decoding:data,as:UTF8.self)}
}

struct NativeActionReview:View {
    let model:AppModel
    let people:[AppModel.Relation]
    let action:String
    @Environment(\.dismiss) private var dismiss
    @State private var excluded=Set<String>()
    private var eligible:[AppModel.Relation] {people.filter{!excluded.contains($0.id) && !model.tools.protectedIDs.contains($0.id) && $0.canPerform(action)}}
    private var title:String {action=="mute" ? "Silenciar publicações e Stories":action=="follow" ? "Seguir perfis":action=="removeFollower" ? "Remover seguidores":action=="disconnect" ? "Desligar nos dois sentidos":"Deixar de seguir"}
    private var pacingEstimate:String {
        let defaults=UserDefaults.standard
        func setting(_ name:String,_ fallback:Int)->Int {(defaults.object(forKey:"followcheck.limits."+name) as? NSNumber)?.intValue ?? fallback}
        let count=eligible.count*(action=="disconnect" ? 2:1),gaps=max(0,count-1)
        let every=max(0,min(50,setting("actionEvery",5)))
        let seconds=gaps*max(2,min(120,setting("actionDelay",4)))+(every>0 ? gaps/every:0)*max(0,min(600,setting("actionPause",300)))
        return seconds<60 ? "\(seconds) s":"\(seconds/60) min \(seconds%60) s"
    }
    var body:some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment:.leading,spacing:14) {
                        Text(title).font(.title2.weight(.bold)).foregroundStyle(Theme.ink)
                        HStack(alignment:.firstTextBaseline,spacing:8) {
                            Text(eligible.count.formatted()).font(.system(size:44,weight:.semibold,design:.rounded)).monospacedDigit().foregroundStyle(Theme.ink)
                            Text(eligible.count == 1 ? "perfil neste lote":"perfis neste lote").font(.subheadline).foregroundStyle(Theme.ink2)
                        }
                        HStack(spacing:10) {
                            summary("Excluídos",(people.count-eligible.count).formatted())
                            summary("Pausas previstas",pacingEstimate)
                        }
                        Text("Acresce o tempo de resposta do Instagram. Cada resultado é confirmado individualmente e podes retirar perfis antes de iniciar.")
                            .font(.footnote).foregroundStyle(Theme.ink2)
                    }.padding(.vertical,6)
                }.listRowBackground(Theme.surface)
                Section {
                    ForEach(people){person in
                        HStack(spacing:12) {
                            ProfileAvatar(photoURL:person.photoURL,size:38,name:person.username)
                            VStack(alignment:.leading,spacing:2){
                                Text("@"+person.username).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                                if model.tools.protectedIDs.contains(person.id) {Text("Protegido").font(.caption).foregroundStyle(Theme.signalInk)}
                                else if !person.canPerform(action) {Text("Não aplicável a esta relação").font(.caption).foregroundStyle(Theme.ink3)}
                                else if !person.name.isEmpty {Text(person.name).font(.caption).foregroundStyle(Theme.ink2)}
                            }
                            Spacer()
                            Toggle("Incluir "+person.username,isOn:Binding(get:{!excluded.contains(person.id) && !model.tools.protectedIDs.contains(person.id) && person.canPerform(action)},set:{if $0{excluded.remove(person.id)}else{excluded.insert(person.id)}})).labelsHidden()
                                .disabled(model.tools.protectedIDs.contains(person.id) || !person.canPerform(action))
                        }
                    }
                } header: {Text("Revisão final")}
                .listRowBackground(Theme.surface)
            }
            .fcForm()
            .navigationTitle("Rever operação").navigationBarTitleDisplayMode(.inline)
            .toolbar{ToolbarItem(placement:.cancellationAction){Button("Voltar"){dismiss()}}}
            .safeAreaInset(edge:.bottom){
                Button(eligible.isEmpty ? "Nenhum perfil incluído":"Confirmar \(eligible.count) \(eligible.count == 1 ? "perfil":"perfis")"){let confirmed=eligible;dismiss();Task{await model.tools.execute(action,people:confirmed)}}
                    .buttonStyle(SignalButtonStyle())
                    .disabled(eligible.isEmpty || model.tools.operationRunning)
                    .padding(.horizontal,20).padding(.vertical,12).frame(maxWidth:.infinity).background(.bar)
            }
        }.tint(Theme.signalInk)
    }
    private func summary(_ title:String,_ value:String)->some View {
        VStack(alignment:.leading,spacing:3) {
            Text(value).font(.headline).monospacedDigit().foregroundStyle(Theme.ink)
            Text(title).font(.caption).foregroundStyle(Theme.ink2)
        }.frame(maxWidth:.infinity,alignment:.leading).padding(12).background(Theme.raised,in:.rect(cornerRadius:12,style:.continuous))
    }
}


private struct PrivateMemoryGallery:View {
    let model:AppModel
    var profileID:String?=nil
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var entries:[String:[[String:Any]]]=[:]
    @State private var query=""
    @State private var loading=false
    @State private var failure:String?
    @State private var deleting=false
    private var ids:[String] {entries.keys.filter{id in
        (profileID==nil || profileID==id) && (query.isEmpty || name(id).localizedCaseInsensitiveContains(query))
    }.sorted{ name($0)<name($1) }}
    private func name(_ id:String)->String {model.relations.first{$0.id==id}.map{"@"+$0.username} ?? id}
    private func load(_ operation:String="get") async {
        #if DEBUG
        if model.isPreview {
            entries=["preview-1":[["text":"Temos de combinar qualquer coisa esta semana.","direction":"incoming","timestamp":"15/10/2026"],["text":"Adorei rever estas fotografias!","direction":"outgoing","timestamp":"14/10/2026"]]]
            return
        }
        #endif
        let owner=model.accountId;loading=true;failure=nil
        defer{loading=false}
        do {
            let result=try await model.tools.request("memories",["operation":operation])
            guard owner==model.accountId,scenePhase == .active else{return}
            entries=result["memories"] as? [String:[[String:Any]]] ?? [:]
        }catch{if owner==model.accountId{failure=error.localizedDescription}}
    }
    var body:some View {
        NavigationStack {
            ScrollView {LazyVStack(alignment:.leading,spacing:18){
                Label("Só neste dispositivo",systemImage:"lock.shield").font(.caption.bold()).foregroundStyle(FCStyle.mint)
                Text("Excertos do histórico que importaste. Não são incluídos nas cópias exportadas.").font(.caption).foregroundStyle(.secondary)
                if loading {ProgressView("A abrir memórias…")}
                if let failure {Text(failure).foregroundStyle(Theme.caution)}
                if ids.isEmpty && !loading {ContentUnavailableView("Sem excertos",systemImage:"text.bubble",description:Text("Importa o histórico com mensagens para ver as memórias por pessoa."))}
                ForEach(ids,id:\.self){id in
                    VStack(alignment:.leading,spacing:14){
                        HStack{ProfileAvatar(photoURL:model.relations.first{$0.id==id}?.photoURL ?? "",size:36);Text(name(id)).font(.headline)}
                        ForEach(Array((entries[id] ?? []).enumerated()),id:\.offset){_,entry in
                            VStack(alignment:.leading,spacing:6){
                                Text(entry["text"] as? String ?? "").font(.body).textSelection(.enabled)
                                HStack{Text(entry["direction"] as? String == "outgoing" ? "Enviado por ti":"Recebido");Spacer();Text(entry["timestamp"] as? String ?? "").lineLimit(1)}.font(.caption2).foregroundStyle(.secondary)
                            }.padding(12).background(FCStyle.accent.opacity(0.08),in:RoundedRectangle(cornerRadius:14))
                        }
                    }.fcCard()
                }
            }.padding(20)}
            .background(FCStyle.background).navigationTitle("Memórias privadas")
            .searchable(text:$query,prompt:"Procurar pessoa")
            .toolbar {
                ToolbarItem(placement:.cancellationAction){Button("Fechar"){dismiss()}}
                ToolbarItem(placement:.primaryAction){Button("Apagar",role:.destructive){deleting=true}.disabled(entries.isEmpty || loading)}
            }
            .confirmationDialog("Apagar todos os excertos privados desta conta?",isPresented:$deleting,titleVisibility:.visible){Button("Apagar excertos",role:.destructive){Task{await load("clear")}}}
            .task{await load()}
            .onChange(of:model.accountId){_,_ in entries=[:];Task{await load()}}
            .onChange(of:scenePhase){_,phase in if phase != .active {entries=[:]}else{Task{await load()}}}
            .privacySensitive()
        }.tint(Theme.signalInk)
    }
}
