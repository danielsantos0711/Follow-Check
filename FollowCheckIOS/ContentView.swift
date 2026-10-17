import SwiftUI
import UniformTypeIdentifiers


private struct ClassicCommands:View {
    let model:AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var query=""
    @State private var tool:NativeTool?
    private var matches:[NativeTool] {NativeTool.all.filter{query.isEmpty || "\($0.name) \($0.category) \($0.detail)".localizedCaseInsensitiveContains(query)}}
    var body:some View {
        NavigationStack {
            List {
                if query.isEmpty {
                    Section("Navegar") {
                        Button("Início",systemImage:"house"){model.select(.home);dismiss()}
                        Button("Relações",systemImage:"person.2"){model.select(.relations);dismiss()}
                        Button("Watchlist",systemImage:"eye"){model.select(.watchlist);dismiss()}
                        Button("Atividade",systemImage:"waveform.path"){model.select(.activity);dismiss()}
                        Button("Inbox",systemImage:"bubble.left.and.bubble.right"){model.select(.inbox);dismiss()}
                    }
                }
                Section("Ferramentas") {
                    ForEach(matches){item in Button {if item.id == "watchlist" {model.select(.watchlist);dismiss()} else {tool=item}} label:{
                        HStack(spacing:13){Image(systemName:item.icon).foregroundStyle(FCStyle.accent).frame(width:24);VStack(alignment:.leading,spacing:4){Text(item.name).foregroundStyle(.primary);Text(item.category).font(.caption).foregroundStyle(.secondary)};Spacer();Image(systemName:"arrow.up.right").font(.caption)}
                            .padding(.vertical,5)
                    }}
                }
                if matches.isEmpty {ContentUnavailableView.search(text:query)}
            }.searchable(text:$query,prompt:"Uma ferramenta, ação ou objetivo")
                .navigationTitle("Pesquisar").navigationBarTitleDisplayMode(.inline)
                .toolbar{ToolbarItem(placement:.confirmationAction){Button("Fechar"){dismiss()}}}
                .sheet(item:$tool){ToolDestination(model:model,tool:$0)}
        }.tint(FCStyle.accent)
    }
}



// Classic workspace: rebuilt from the preserved fc-classic-home and v7 catalog.
private struct ClassicHome: View {
    let model: AppModel
    @State private var settings = false
    @State private var selected: NativeTool?
    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                HStack(spacing: 15) {
                    ProfileAvatar(photoURL:model.profilePhotoURL,size:58)
                        .padding(4).background(FCStyle.background,in:.circle)
                        .overlay(Circle().stroke(FCStyle.accent,lineWidth:2.5))
                        .shadow(color:FCStyle.accent.opacity(0.2),radius:14,y:5)
                        .overlay(alignment:.bottomTrailing) {
                            Circle().fill(model.sessionAvailable ? FCStyle.mint : .gray).frame(width:14,height:14)
                                .overlay(Circle().stroke(FCStyle.background,lineWidth:3))
                        }
                    VStack(alignment:.leading,spacing:7) {
                        Text(model.username.isEmpty ? "O teu círculo" : "@\(model.username)").font(.title3.bold()).lineLimit(1)
                        HStack(spacing:5) {
                            Circle().fill(model.sessionAvailable ? FCStyle.mint : FCStyle.pink).frame(width:5,height:5)
                            Text(model.sessionAvailable ? "Ligado" : "A sincronizar")
                            Text("·")
                            Text(model.ownCheckRunning ? "check em curso" : model.paused ? "em pausa" : "pronto")
                        }.font(.caption2).foregroundStyle(.secondary)
                    }
                    Spacer(minLength:0)
                    Button {settings=true} label: {
                        Image(systemName:"gearshape").font(.title3).foregroundStyle(.white.opacity(0.8))
                            .frame(width:46,height:48).background(FCStyle.card,in:.rect(cornerRadius:16))
                            .overlay(RoundedRectangle(cornerRadius:16).strokeBorder(.white.opacity(0.1)))
                    }.accessibilityLabel("Definições").buttonStyle(PressStyle())
                }
                ClassicOrbit(model:model).padding(.top,6)
                Button {model.select(.activity)} label: {
                    HStack {Image(systemName:"magnifyingglass");Spacer();Text("Abrir atividade").fontWeight(.semibold);Spacer();Image(systemName:"arrow.right")}
                        .padding(.horizontal,22).frame(minHeight:54).foregroundStyle(.white)
                        .background(FCStyle.gradient,in:.rect(cornerRadius:18))
                        .overlay(RoundedRectangle(cornerRadius:18).strokeBorder(.white.opacity(0.2)))
                        .shadow(color:FCStyle.accent.opacity(0.18),radius:16,y:8)
                }.buttonStyle(PressStyle())
                if model.safetyBlocked || !model.sessionAvailable || model.ownCheckRunning {
                    checkStatus
                } else {
                    HStack {
                        Button("Novo check",systemImage:"arrow.clockwise",action:model.scan).disabled(!model.canScan)
                        Spacer()
                        Button("Relações",systemImage:"person.2"){model.select(.relations)}
                    }.font(.subheadline.weight(.medium)).padding(.vertical,3)
                    if model.paused { Button("Retomar verificações"){model.setPaused(false)}.font(.subheadline) }
                }
                VStack(alignment:.leading,spacing:14) {
                    sectionHeading("Atividade recente",action:"Ver tudo"){model.select(.activity)}
                    if let last=model.lastCompletedCheck {
                        ClassicStatusRow(icon:"checkmark.circle",title:"Último check",detail:"Análise concluída e guardada",date:last,tone:FCStyle.mint)
                    }
                    if let event=model.accountEvents.sorted(by:{$0.date>$1.date}).first {
                        WatchChangeRow(event:event)
                    } else {
                        ClassicStatusRow(icon:"waveform.path",title:model.lastCompletedCheck == nil ? "O teu primeiro check" : "O teu círculo, atualizado",detail:model.lastCompletedCheck == nil ? "Liga a conta e cria a primeira referência." : "As mudanças aparecem depois de comparar checks completos.",date:nil,tone:FCStyle.accent)
                    }
                }
                VStack(alignment:.leading,spacing:14) {
                    sectionHeading("A tua audiência",action:"Relações"){model.select(.relations)}
                    LazyVGrid(columns:[GridItem(.flexible()),GridItem(.flexible())],spacing:10) {
                        audience("Seguidores",model.snapshot?.followers,"person.badge.plus")
                        audience("A seguir",model.snapshot?.following,"person.2")
                        audience("Mútuos",model.snapshot?.mutuals,"arrow.left.arrow.right")
                        audience("Não me seguem",model.snapshot?.nonFollowers,"person.badge.minus")
                    }
                }
                VStack(alignment:.leading,spacing:14) {
                    sectionHeading("Os teus atalhos",action:"Todas"){model.select(.tools)}
                    HStack(spacing:10) {
                        shortcut("cleanup","Cleanup","person.2.badge.minus")
                        shortcut("unfollow","Unfollow","person.badge.minus")
                        shortcut("saved","Coleções","bookmark")
                    }
                }
            }.padding(.horizontal,20).padding(.top,16).padding(.bottom,28).frame(maxWidth:600)
                .frame(maxWidth:.infinity)
        }.scrollIndicators(.hidden).background(FCStyle.background)
        .sheet(isPresented:$settings){SessionView(model:model)}
        .sheet(item:$selected){ToolDestination(model:model,tool:$0)}
    }
    private var checkStatus: some View {
        VStack(alignment:.leading,spacing:12) {
            HStack {
                Label(model.statusText,systemImage:model.safetyBlocked ? "exclamationmark.shield" : "waveform.path").font(.subheadline.bold())
                Spacer()
                if model.ownCheckRunning {ProgressView().controlSize(.small)}
            }.foregroundStyle(model.safetyBlocked ? .orange : FCStyle.accent)
            Text(model.detailText).font(.caption).foregroundStyle(.secondary)
            if model.ownCheckRunning {
                if let progress=model.progress {ProgressView(value:progress)}
                HStack {
                    Button("Parar",action:model.cancelCurrentScan)
                    Spacer()
                    Button("Ver atividade") { model.select(.activity) }
                }.font(.caption.weight(.semibold))
            } else if model.safetyBlocked {
                HStack {Button("Abrir Instagram",action:model.openInstagram);Spacer();Button("Reavaliar",action:model.confirmSession).disabled(model.confirmingSession)}.font(.caption.bold())
                if let until=model.cooldownUntil,until>Date(){Text(until,style:.timer).font(.caption.monospacedDigit())}
            } else {
                Button("Ligar conta",systemImage:"arrow.right",action:model.openInstagram).font(.subheadline.bold())
            }
        }.fcCard()
    }
    private func sectionHeading(_ title:String,action:String,perform:@escaping()->Void)->some View {
        HStack {Text(title).font(.headline);Spacer();Button(action,action:perform).font(.caption.weight(.semibold))}
    }
    private func audience(_ title:String,_ count:Int?,_ icon:String)->some View {
        Button {model.requestedRelationFilter=title;model.select(.relations)} label: {
            VStack(alignment:.leading,spacing:8) {
                HStack {Image(systemName:icon).foregroundStyle(FCStyle.accent);Spacer();Image(systemName:"arrow.up.right").font(.caption2).foregroundStyle(.secondary)}
                Text(count.map{$0.formatted()} ?? "—").font(.system(.title,design:.rounded).weight(.semibold)).foregroundStyle(.primary).contentTransition(.numericText())
                Text(title).font(.caption).foregroundStyle(.secondary)
            }.frame(maxWidth:.infinity,alignment:.leading).fcCard()
        }.buttonStyle(PressStyle())
    }
    private func shortcut(_ id:String,_ title:String,_ icon:String)->some View {
        Button {selected=NativeTool.all.first{$0.id==id}} label: {
            VStack(spacing:10){Image(systemName:icon).font(.title3).foregroundStyle(FCStyle.accent);Text(title).font(.caption.weight(.medium)).foregroundStyle(.primary)}
                .frame(maxWidth:.infinity,minHeight:86).background(FCStyle.card,in:.rect(cornerRadius:16))
                .overlay(RoundedRectangle(cornerRadius:16).strokeBorder(.white.opacity(0.06)))
        }.buttonStyle(PressStyle())
    }
}

private struct ClassicOrbit: View {
    let model: AppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var phase
    @Environment(\.dynamicTypeSize) private var typeSize
    private var title:String {model.ownCheckRunning ? "a verificar o teu círculo" : "alterações novas"}
    private var value:String {model.ownCheckRunning ? model.progress.map{"\(Int($0*100))%"} ?? "···" : model.snapshot?.newChanges.map{$0.formatted()} ?? "—"}
    var body: some View {
        Group {
            if typeSize.isAccessibilitySize {copy.padding(28).fcCard()}
            else {
                TimelineView(.animation(minimumInterval:1.0/30,paused:reduceMotion || phase != .active)) { context in
                    let period=model.ownCheckRunning ? 4.0 : 28.0
                    let angle=reduceMotion ? 0 : context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy:period)/period*360
                    ZStack {
                        Circle().fill(RadialGradient(colors:[FCStyle.accent.opacity(0.12),FCStyle.background],center:.center,startRadius:30,endRadius:180))
                        Circle().stroke(FCStyle.accent.opacity(0.17),lineWidth:1).padding(4)
                        Circle().stroke(FCStyle.accent.opacity(0.06),lineWidth:1).padding(-5)
                        Circle().trim(from:0.07,to:0.84).stroke(FCStyle.accent,style:StrokeStyle(lineWidth:2,lineCap:.round))
                            .padding(27).rotationEffect(.degrees(angle+132))
                            .shadow(color:FCStyle.accent.opacity(0.35),radius:5)
                        Circle().stroke(FCStyle.accent.opacity(0.22),style:StrokeStyle(lineWidth:3,dash:[1,12])).padding(49)
                        Circle().stroke(.white.opacity(0.18),lineWidth:1).padding(62)
                        copy.padding(.horizontal,48).offset(y:-13)
                        VStack {Spacer();nextCheck.padding(.bottom,15)}
                    }
                }.aspectRatio(1,contentMode:.fit).frame(maxWidth:362)
            }
        }.frame(maxWidth:.infinity).accessibilityElement(children:.combine)
    }
    private var copy:some View {
        VStack(spacing:8) {
            Text(value).font(.system(size:53,weight:.semibold,design:.rounded)).monospacedDigit().contentTransition(.numericText())
            Text(title).font(.system(.headline,design:.default)).foregroundStyle(FCStyle.mint).minimumScaleFactor(0.75).lineLimit(1)
            Text(model.ownCheckRunning ? "À procura de mudanças" : "desde o último check").font(.caption).foregroundStyle(.secondary)
            Rectangle().fill(.white.opacity(0.25)).frame(width:22,height:1).padding(.vertical,5)
            HStack(spacing:9) {
                Image(systemName:"waveform.path").foregroundStyle(FCStyle.accent).padding(7)
                    .overlay(Circle().stroke(FCStyle.accent.opacity(0.3)))
                VStack(alignment:.leading,spacing:4) {
                    Text(model.ownCheckRunning ? "Monitorização em curso" : model.safetyBlocked || model.paused ? "Monitorização em pausa" : "Pronto para verificar")
                        .font(.caption2.bold()).foregroundStyle(model.safetyBlocked || model.paused ? .orange : FCStyle.mint)
                    Text(model.ownCheckRunning ? "A tua conta" : "Resultados guardados")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
        }.multilineTextAlignment(.center)
    }
    private var nextCheck:some View {
        Button {if model.canScan {model.scan()}} label: {
            HStack(spacing:10) {
                Image(systemName:model.ownCheckRunning ? "waveform.path":"clock").foregroundStyle(FCStyle.accent)
                VStack(alignment:.leading,spacing:4) {
                    Text(model.ownCheckRunning ? "A verificar" : "Próximo check").font(.caption2).foregroundStyle(.secondary)
                    Text(model.ownCheckRunning ? "Em curso" : model.paused || model.safetyBlocked ? "Em pausa" : "Verificar agora").font(.subheadline.bold()).foregroundStyle(.primary)
                }
            }.padding(.horizontal,18).padding(.vertical,12)
                .background(LinearGradient(colors:[FCStyle.card,FCStyle.background],startPoint:.top,endPoint:.bottom),in:.rect(cornerRadius:21))
                .overlay(RoundedRectangle(cornerRadius:21).strokeBorder(.white.opacity(0.12)))
                .shadow(color:.black.opacity(0.3),radius:12,y:8)
        }.buttonStyle(PressStyle()).disabled(!model.canScan)
    }
}

private struct ClassicStatusRow: View {
    let icon:String
    let title:String
    let detail:String
    let date:Date?
    let tone:Color
    var body:some View {
        HStack(spacing:13) {
            Image(systemName:icon).font(.title3).foregroundStyle(tone).frame(width:38,height:38)
                .overlay(Circle().stroke(tone.opacity(0.5)))
            VStack(alignment:.leading,spacing:5) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(detail).font(.caption2).foregroundStyle(.secondary)
            }
            Spacer(minLength:0)
            if let date {Text(date,style:.relative).font(.caption2).foregroundStyle(.secondary)}
        }.padding(.vertical,8)
    }
}

private struct ClassicActivity: View {
    let model:AppModel
    @State private var filter="Tudo"
    @State private var diagnostics=false
    @State private var likes=false
    private let filters=["Tudo","Deixaram de seguir","Novos seguidores","Indisponíveis"]
    private var events:[AppModel.WatchEvent] {
        model.accountEvents.filter { event in
            switch filter {
            case "Deixaram de seguir":return event.type=="unfollow_confirmed"
            case "Novos seguidores":return event.type=="new_follower"
            case "Indisponíveis":return event.type=="account_unavailable"
            default:return true
            }
        }.sorted{$0.date>$1.date}
    }
    var body:some View {
        ScrollView {
            VStack(alignment:.leading,spacing:22) {
                Button("Gostos nas minhas publicações",systemImage:"heart"){likes=true}.buttonStyle(.bordered)
                HStack {
                    VStack(alignment:.leading,spacing:6) {
                        Text("O TEU CÍRCULO").font(.caption2.bold()).tracking(2).foregroundStyle(FCStyle.accent)
                        Text("Atividade").font(.largeTitle.bold())
                    }
                    Spacer()
                    Button {diagnostics=true} label:{Image(systemName:"stethoscope").frame(width:44,height:44)}.accessibilityLabel("Diagnóstico técnico")
                }
                HStack(spacing:14) {
                    Image(systemName:"waveform.path").font(.title2).foregroundStyle(FCStyle.accent)
                    VStack(alignment:.leading,spacing:5) {
                        Text("Mudanças com contexto").font(.headline)
                        Text("Quem chegou, quem saiu e o que mudou.").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                }.fcCard()
                ScrollView(.horizontal,showsIndicators:false) {
                    HStack(spacing:8){ForEach(filters,id:\.self){name in Button {filter=name} label:{Text(name).font(.caption.weight(.medium)).padding(.horizontal,14).padding(.vertical,11).background(filter==name ? FCStyle.accent.opacity(0.18):FCStyle.card,in:.capsule)} }}
                }
                if events.isEmpty {
                    ContentUnavailableView("Ainda sem alterações nesta vista",systemImage:"waveform.path",description:Text("As mudanças aparecem após comparar dois checks completos. O diagnóstico está no botão do canto superior."))
                }
                LazyVStack(alignment:.leading,spacing:14) {
                    ForEach(events){event in WatchChangeRow(event:event).frame(maxWidth:.infinity,alignment:.leading).fcCard()}
                }
            }.padding(20).frame(maxWidth:700).frame(maxWidth:.infinity)
        }.background(FCStyle.background)
        .sheet(isPresented:$likes){MediaLikesView(model:model,targetID:"",title:"As minhas publicações")}
        .sheet(isPresented:$diagnostics) {
            NavigationStack {DiagnosticView(model:model).toolbar{ToolbarItem(placement:.confirmationAction){Button("Fechar"){diagnostics=false}}}}
        }
    }
}


struct ProfileAvatar: View {
    let photoURL: String
    var size: CGFloat = 40
    var body: some View {
        AsyncImage(url: URL(string: photoURL).flatMap { $0.scheme == "https" ? $0 : nil }) { phase in
            if let image = phase.image {
                image.resizable().scaledToFill()
            } else {
                ZStack { FCStyle.accent.opacity(0.15); Image(systemName: "person.fill").foregroundStyle(FCStyle.accent) }
            }
        }.frame(width:size,height:size).clipShape(Circle()).accessibilityHidden(true)
    }
}

enum FCStyle {
    static let background = Color(red: 0.035, green: 0.043, blue: 0.059)
    static let card = Color(red: 0.065, green: 0.071, blue: 0.094)
    static let accent = Color(red: 0.66, green: 0.42, blue: 1)
    static let mint = Color(red:0.38,green:0.9,blue:0.74)
    static let pink = Color(red: 0.96, green: 0.32, blue: 0.62)
    static let gradient = LinearGradient(colors: [pink, accent], startPoint: .leading, endPoint: .trailing)
}

struct ContentView: View {
    @Bindable var model: AppModel
    @State private var settings = false
    @State private var commands = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var tabs
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                FollowCheckFlower().frame(width: 25, height: 25)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text("FollowCheck").font(.headline)
                    Text("O teu círculo, em perspetiva")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                Button {commands=true} label:{Image(systemName:"magnifyingglass").frame(width:40,height:44)}.accessibilityLabel("Pesquisar ferramentas e navegar").tint(.white)
                Button { settings = true } label: {
                    Image(systemName: "slider.horizontal.3").frame(width: 44, height: 44)
                }.accessibilityLabel("Sessão e definições").tint(.white)
            }
            .padding(.horizontal, 20).padding(.vertical, 5)
            .background(FCStyle.background).zIndex(2)

            if model.screen == .inbox && model.inboxWebMode {
                HStack {
                    Text("Inbox · sessão Instagram").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Voltar às conversas guardadas") {model.inboxWebMode=false}.font(.caption)
                }.padding(.horizontal,20).padding(.vertical,8)
            }
            ZStack {
                // Always retain the same WebView. Tabs must never recreate the login context.
                if !model.isPreview { InstagramWebView(model: model)
                    .opacity(webVisible ? 1 : 0)
                    .allowsHitTesting(webVisible)
                    .accessibilityHidden(!webVisible) }
                switch model.screen {
                case .home: ClassicHome(model: model)
                case .watchlist: WatchlistView(model: model)
                case .activity: ClassicActivity(model: model)
                case .inbox: if !model.inboxWebMode { InboxView(model: model) }
                case .tools: ToolsView(model: model)
                case .relations: RelationsView(model: model)
                case .instagram: EmptyView()
                }
                if webVisible, case .failed(let message) = model.phase {
                    ContentUnavailableView {
                        Label("Ligação interrompida", systemImage: "wifi.exclamationmark")
                    } description: { Text(message) } actions: {
                        Button("Voltar a tentar", action: model.reload).buttonStyle(.borderedProminent)
                    }.background(FCStyle.background)
                }
                if webVisible && (model.phase == .loadingInstagram || model.isBusy) {
                    VStack { ProgressView().padding(14).background(.regularMaterial, in: .capsule); Spacer() }
                        .padding(.top, 12).allowsHitTesting(false)
                }
            }.clipped()
            if model.screen == .instagram {
                Button("Voltar ao painel", systemImage: "arrow.left") { model.select(.home) }
                    .buttonStyle(.bordered).padding(10)
            } else {
                HStack(spacing: 0) {
                    tab(.home, "Início", "house")
                    tab(.relations, "Relações", "person.2")
                    tab(.inbox, "Inbox", "bubble.left.and.bubble.right")
                    tab(.activity, "Atividade", "waveform.path")
                    tab(.tools, "Mais", "square.grid.2x2")
                }
                .padding(.horizontal, 8).padding(.top, 9).padding(.bottom, 7)
                .background(FCStyle.card)
                .overlay(alignment: .top) { Rectangle().fill(.white.opacity(0.09)).frame(height: 0.5) }
            }
        }
        .sensoryFeedback(.selection, trigger: model.screen)
        .background(FCStyle.background)
        .tint(FCStyle.accent)
        .sheet(isPresented: $settings) { SessionView(model: model) }
        .sheet(isPresented: $commands) { ClassicCommands(model:model) }
        .alert("FollowCheck", isPresented: Binding(get: {model.notice != nil}, set: {if !$0 {model.notice = nil}})) {
            Button("OK") { model.notice = nil }
        } message: { Text(model.notice ?? "") }
    }
    private var webVisible: Bool { model.screen == .instagram || (model.screen == .inbox && model.inboxWebMode) }
    private func tab(_ screen: AppModel.Screen, _ title: String, _ icon: String) -> some View {
        let selected = model.screen == screen || (screen == .tools && model.screen == .watchlist)
        return Button { withAnimation(reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.85)) { model.select(screen) } } label: {
            VStack(spacing: 5) {
                Image(systemName: icon + (selected && screen != .activity ? ".fill" : "")).font(.system(size: 19))
                Text(title).font(.caption2.weight(.medium))
            }
            .frame(maxWidth: .infinity, minHeight: 44)
            .foregroundStyle(selected ? FCStyle.accent : .gray)
            .background {
                if selected {
                    RoundedRectangle(cornerRadius: 18).fill(FCStyle.accent.opacity(0.07))
                        .overlay(alignment: .bottom) { Capsule().fill(FCStyle.gradient).frame(height: 3).padding(.horizontal, 16) }
                        .matchedGeometryEffect(id: "selectedTab", in: tabs)
                }
            }
        }
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

struct WatchlistView: View {
    let model: AppModel
    @State private var adding = false
    @State private var username = ""
    @State private var interval = 1440
    @State private var removing: AppModel.WatchTarget?
    @State private var viewing: AppModel.WatchTarget?
    @State private var history: AppModel.WatchTarget?
    @State private var eventFilter = ""
    @State private var eventSearch = ""
    @State private var likesTarget: AppModel.WatchTarget?
    @State private var historyFilter = ""
    private let intervals = [60,120,360,720,1440,2880,10080,43200]
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Watchlist").font(.largeTitle.weight(.semibold))
                        Text("O que muda, nas contas que escolhes.").font(.subheadline).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button { adding = true } label: { Image(systemName: "plus").frame(width: 44, height: 44) }
                        .buttonStyle(.bordered).accessibilityLabel("Adicionar perfil").disabled(!model.canScanWatchlist || model.watchlistBusy)
                }
                if model.watchCheckRunning {
                    VStack(alignment:.leading,spacing:12) {
                        HStack { Label(model.watchStatus,systemImage:"eye").font(.headline);Spacer();ProgressView().controlSize(.small) }
                        Text(model.watchDetail).font(.caption).foregroundStyle(.secondary)
                        if let progress=model.watchProgress {ProgressView(value:progress).tint(FCStyle.accent)}
                        Button("Parar este check",action:model.cancelCurrentScan).font(.caption.bold())
                    }.fcCard()
                }
                Toggle("Checks automáticos",isOn:Binding(get:{model.schedulerEnabled},set:model.setScheduler))
                    .font(.subheadline).disabled(!model.sessionAvailable)
                if model.targets.isEmpty {
                    ContentUnavailableView("O teu radar começa aqui", systemImage: "eye", description: Text("Adiciona uma conta para criar uma primeira referência e acompanhar alterações nos checks seguintes."))
                }
                ForEach(model.targets) { target in
                    VStack(alignment: .leading, spacing: 14) {
                        HStack {
                            ProfileAvatar(photoURL:target.photoURL,size:48)
                            VStack(alignment: .leading, spacing: 4) {
                                Text("@\(target.username)").font(.headline)
                                Text(target.running ? "A verificar…" : !target.error.isEmpty ? "Última tentativa não concluída" : target.comparisonReady ? "Pronto para comparar" : "Próximo check prepara a comparação").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Menu {
                                Button("Ver listas guardadas") {
                                    model.loadWatchlistList(target.id, relation: "followers")
                                    viewing = target
                                }.disabled(!target.baselineReady || model.watchlistBusy)
                                Button("Histórico de alterações") { historyFilter="";history = target }
                                Button("Gostos nas publicações") { likesTarget = target }.disabled(!target.baselineReady)
                                Menu("Intervalo: \(target.intervalMinutes / 60) h") {
                                    ForEach(intervals,id:\.self){minutes in Button("\(minutes / 60) horas"){model.watchlist("update",args:["targetId":target.id,"intervalMinutes":minutes])}}
                                }
                                if let until=model.cooldownUntil,until>Date() {
                                HStack {Text("Espera restante");Text(until,style:.timer).monospacedDigit()}.font(.caption)
                            }
                            Button("Abrir Instagram", action: model.openInstagram)
                                Button(target.enabled ? "Pausar perfil" : "Ativar perfil") { model.watchlist("update", args: ["targetId": target.id, "enabled": !target.enabled]) }
                                Button("Remover perfil", role: .destructive) { removing = target }
                            } label: { Image(systemName: "ellipsis").frame(width: 44, height: 44) }.accessibilityLabel("Opções de \(target.username)")
                        }
                        if target.baselineReady {
                            HStack { Text("\(target.followers.formatted()) seguidores recolhidos"); Spacer(); Text("\(target.following.formatted()) seguidos recolhidos") }
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                        let changes=model.watchEvents.filter{$0.targetId==target.id && $0.isWatchChange && abs($0.date.timeIntervalSince(target.lastSuccess ?? .distantPast)) < 0.001}
                        Text(target.comparisonReady ? (changes.isEmpty ? "Sem mudanças no último check" : "\(changes.count) mudanças no último check") : "A recolha ainda não foi validada contra os totais do perfil.")
                            .font(.caption).foregroundStyle(.secondary)
                        if !target.error.isEmpty { Text(target.error).font(.caption).foregroundStyle(.orange) }
                        HStack {
                            if let date = target.lastSuccess { Text(date, style: .relative).font(.caption).foregroundStyle(.secondary) }
                            Spacer()
                            Button("Alterações") { historyFilter="";history = target }.buttonStyle(.bordered)
                            Button(model.activeCheckScope == "account" ? "Verificar agora" : "Verificar") { model.watchlist("run", args: ["targetId": target.id]) }
                                .buttonStyle(.bordered).disabled(!model.canScanWatchlist || model.watchlistBusy || target.running)
                        }
                    }.fcCard()
                }
            }.padding(20)
        }.background(FCStyle.background)
        .sheet(isPresented: $adding) {
            NavigationStack {
                Form {
                    Section("Conta Instagram") {
                        TextField("username", text: $username).textInputAutocapitalization(.never).autocorrectionDisabled()
                        Picker("Intervalo mínimo", selection: $interval) {
                            ForEach(intervals,id:\.self){minutes in Text("\(minutes / 60) horas").tag(minutes)}
                        }
                    }
                    Section { Text("O primeiro check cria a referência. A frequência escolhida só se aplica com a app ativa e respeita as pausas do motor.").font(.footnote).foregroundStyle(.secondary) }
                }
                .navigationTitle("Adicionar perfil")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { adding = false } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Adicionar") {
                            model.watchlist("add", args: ["username": username.trimmingCharacters(in: .whitespacesAndNewlines), "intervalMinutes": interval]); adding = false; username = ""
                        }.disabled(username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.watchlistBusy)
                    }
                }
            }.tint(FCStyle.accent)
        }
        .sheet(item: $history) { target in
            WatchHistorySheet(model:model,target:target,initialFilter:historyFilter)
        }
        .sheet(item: $likesTarget) { target in MediaLikesView(model:model,targetID:target.id,title:"@"+target.username) }
        .sheet(item: $viewing) { target in
            WatchlistDetailView(model: model, target: target)
        }
        .confirmationDialog("Remover este perfil e o seu histórico da Watchlist?", isPresented: Binding(get: {removing != nil}, set: {if !$0 {removing = nil}}), titleVisibility: .visible) {
            Button("Remover", role: .destructive) { if let target = removing { model.watchlist("remove", args: ["targetId":target.id]) }; removing = nil }
        }
    }
}

struct DiagnosticView: View {
    let model: AppModel
    @State private var onlyErrors = false
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Diagnóstico").font(.largeTitle.weight(.semibold)); Spacer()
                ShareLink(item: model.diagnosticReport) { Image(systemName: "square.and.arrow.up").frame(width: 44, height: 44) }.accessibilityLabel("Exportar diagnóstico").disabled(model.diagnosticsRefreshing)
            }
            Button { Task { await model.refreshDiagnostics() } } label: {
                Label(model.diagnosticsRefreshing ? "A recolher detalhes…" : "Atualizar diagnóstico", systemImage: "arrow.clockwise")
            }.disabled(model.diagnosticsRefreshing)
            Text("Exporta depois de reproduzir o problema. O relatório inclui os detalhes técnicos mesmo com o filtro ativo.").font(.caption).foregroundStyle(.secondary)
            Toggle("Mostrar apenas avisos e erros", isOn: $onlyErrors).font(.subheadline)
            if model.events.isEmpty { ContentUnavailableView("Tudo começa aqui", systemImage: "waveform.path", description: Text("Os eventos da app aparecem aqui, sem passwords nem cookies.")) }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(model.events.reversed().filter { !onlyErrors || ["warn","error"].contains($0.level) }) { event in
                        HStack(alignment: .top, spacing: 12) {
                            Circle().fill(event.level == "error" ? .red : event.level == "warn" ? .orange : FCStyle.accent).frame(width: 7, height: 7).padding(.top, 6)
                            VStack(alignment: .leading, spacing: 5) {
                                Text(event.message).font(.subheadline).textSelection(.enabled)
                                if let details = event.details {
                                    DisclosureGroup("Detalhes técnicos") { Text(details).font(.caption.monospaced()).textSelection(.enabled) }
                                }
                                Text(event.date, format: .dateTime.day().month().hour().minute().second()).font(.caption).foregroundStyle(.secondary)
                            }
                        }.padding(.vertical, 14)
                        Divider().overlay(.white.opacity(0.03))
                    }
                }
            }
        }.padding(20).background(FCStyle.background)
        .task { await model.refreshDiagnostics() }
    }
}

struct SessionView: View {
    let model: AppModel
    @Environment(\.dismiss) private var dismiss
    @AppStorage("followcheck.reminders.enabled") private var reminders = false
    @State private var clear = false
    @State private var confirmSession = false
    @AppStorage("followcheck.keepAwake") private var keepAwake = true
    @State private var limits = false
    @State private var backupFile: URL?
    @State private var importingBackup = false
    @State private var backupBusy = false
    @State private var backupMessage: String?
    var body: some View {
        NavigationStack {
            Form {
                Section("Sessão") {
                    LabeledContent("Conta", value: model.username.isEmpty ? "Por identificar" : "@\(model.username)")
                    LabeledContent("Estado", value: model.sessionAvailable ? "Disponível neste iPhone" : "Por confirmar")
                    Button("Abrir Instagram", systemImage: "person.crop.square") { model.openInstagram(); dismiss() }
                    Button("Recarregar página", systemImage: "arrow.clockwise") { model.reload(); dismiss() }
                    if model.safetyBlocked {
                        Button("Já confirmei a conta no Instagram") { confirmSession = true }
                    }
                }
                Section {
                    Button("Ritmo e limites",systemImage:"slider.horizontal.3"){limits=true}
                    Toggle("Manter ecrã ligado durante checks",isOn:$keepAwake)
                    Text("Só impede o bloqueio durante um check ativo, incluindo as pausas entre páginas. Ao terminar, cancelar ou sair da app, o bloqueio automático volta ao normal.").font(.caption).foregroundStyle(.secondary)
                    Toggle("Pausar análise da minha conta", isOn: Binding(get: {model.paused}, set: model.setPaused)).disabled(!model.sessionAvailable)
                    Toggle("Notificações e lembretes", isOn: $reminders)
                        .onChange(of: reminders) { _, enabled in
                            if enabled { model.requestNotificationPermission(); AppDelegate.scheduleRefresh() }
                            else { AppDelegate.cancelRefresh() }
                        }
                } header: { Text("Execução") } footer: {
                    Text("Recebe a conclusão dos checks e um lembrete uma hora depois de saíres. Os lembretes não executam checks; a entrega depende das definições de notificações e Foco do iPhone.")
                }
                Section("Cópia dos scans") {
                    Text("Os checks completos têm uma cópia nativa por conta. Exporta-a antes de apagar ou reinstalar a app com outra identidade.").font(.footnote)
                    Button("Preparar cópia para guardar") {Task{backupBusy=true;defer{backupBusy=false};do{backupFile=try await model.exportScanBackup();backupMessage="Cópia preparada. Usa Guardar/partilhar para a conservar fora da app."}catch{backupMessage=error.localizedDescription}}}.disabled(backupBusy || !model.sessionAvailable)
                    if let backupFile {ShareLink("Guardar/partilhar cópia",item:backupFile)}
                    Button("Importar cópia e recuperar dados em falta"){importingBackup=true}.disabled(backupBusy || !model.sessionAvailable)
                    if backupBusy {ProgressView()}
                    if let backupMessage {Text(backupMessage).font(.footnote)}
                }
                Section("Diagnóstico") {
                    Button("Atualizar eventos", systemImage: "arrow.clockwise") { model.webCoordinator?.control("logs") }
                    ShareLink("Exportar diagnóstico", item: model.diagnosticReport)
                    Button("Limpar eventos", role: .destructive) { clear = true }
                }
                Section { Text("A sessão mantém-se no armazenamento persistente do WebKit. A app não simula outro dispositivo. O Instagram pode pedir verificações adicionais.").font(.footnote).foregroundStyle(.secondary) }
            }
            .fileImporter(isPresented:$importingBackup,allowedContentTypes:[.json]) {result in
                do {
                    let url=try result.get();let access=url.startAccessingSecurityScopedResource();defer{if access{url.stopAccessingSecurityScopedResource()}}
                    let size=try url.resourceValues(forKeys:[.fileSizeKey]).fileSize ?? 0
                    guard size <= 40*1024*1024 else{backupMessage="A cópia excede 40 MB.";return}
                    let data=try Data(contentsOf:url)
                    Task{backupBusy=true;defer{backupBusy=false};do{try await model.importScanBackup(data);backupMessage="Dados em falta recuperados. Os dados já existentes foram preservados."}catch{backupMessage=error.localizedDescription}}
                }catch{backupMessage=error.localizedDescription}
            }
            .sheet(isPresented:$limits){LimitsView(model:model)}
            .navigationTitle("Definições")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Concluído") { dismiss() } } }
            .confirmationDialog("Reavaliar a sessão após concluíres a verificação no Instagram?", isPresented: $confirmSession, titleVisibility: .visible) {
                Button("Reavaliar sessão") { model.confirmSession() }
            }
            .confirmationDialog("Limpar os eventos de diagnóstico?", isPresented: $clear, titleVisibility: .visible) { Button("Limpar", role: .destructive, action: model.clearLogs) }
        }.tint(FCStyle.accent)
    }
}

extension View {
    func fcCard() -> some View {
        padding(16).background(LinearGradient(colors:[FCStyle.card,FCStyle.background],startPoint:.topLeading,endPoint:.bottomTrailing), in: .rect(cornerRadius: 17))
            .overlay(RoundedRectangle(cornerRadius: 17).strokeBorder(.white.opacity(0.085)))
    }
}

struct PressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(reduceMotion ? nil : .spring(response: 0.25), value: configuration.isPressed)
    }
}

private struct RelationsView: View {
    let model: AppModel
    @State private var requests = false
    @State private var intelligence = false
    private let tool = NativeTool(id:"relations",name:"Relações",detail:"",category:"Audiência",icon:"person.2",professional:false)
    var body: some View {
        VStack(alignment:.leading,spacing:0) {
            HStack {
                Text("Relações").font(.largeTitle.bold())
                Spacer()
                Button("Pedidos",systemImage:"person.crop.circle.badge.clock"){requests=true}
            }.padding(.horizontal,20).padding(.top,12)
            Button("Círculo real · histórico e análise de ligações",systemImage:"person.2.badge.gearshape"){intelligence=true}
                .font(.subheadline).padding(.horizontal,20).padding(.top,12)
            OperationStudio(model:model,tool:tool)
        }.background(FCStyle.background)
        .sheet(isPresented:$requests){RequestsStudio(model:model)}
        .sheet(isPresented:$intelligence){NavigationStack{RelationshipIntelligence(model:model).toolbar{ToolbarItem(placement:.confirmationAction){Button("Concluído"){intelligence=false}}}}}
        .alert("FollowCheck",isPresented:Binding(get:{model.tools.error != nil},set:{if !$0{model.tools.error=nil}})){Button("OK"){model.tools.error=nil}}message:{Text(model.tools.error ?? "")}
    }
}

private struct InboxView: View {
    let model: AppModel
    @State private var query = ""
    @State private var selected: AppModel.Conversation?
    @State private var professionalInbox = false
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text("Inbox").font(.largeTitle.bold())
                Spacer()
                Button { model.loadInbox() } label: { Image(systemName: "arrow.clockwise").frame(width: 44, height: 44) }
                    .accessibilityLabel("Atualizar conversas").disabled(model.inboxLoading || !model.canReadInbox)
            }
            Text("As tuas conversas, num espaço mais tranquilo.").font(.subheadline).foregroundStyle(.secondary)
            Picker("Caixa",selection:Binding(get:{model.inboxKind},set:{model.inboxKind=$0;model.conversations=[];model.inboxLoaded=false;model.inboxCursor="";model.inboxHasMore=false;model.loadInbox()})) {
                Text("Conversas").tag("inbox")
                Text("Pedidos").tag("pending")
            }.pickerStyle(.segmented).disabled(model.inboxLoading)
            TextField("Pesquisar conversas",text:$query).textFieldStyle(.roundedBorder)
            Button("Abrir mensagens na sessão Instagram",systemImage:"bubble.left.and.bubble.right",action:model.openInstagramInbox)
                .buttonStyle(.borderedProminent).disabled(model.checkIsRunning || !model.sessionAvailable)
            if model.inboxUnavailable {
                Text("A leitura nativa respondeu 404 nesta sessão. O acesso acima abre a Inbox do próprio Instagram, na sessão já existente; não é uma conversa nativa recriada pela FollowCheck.").font(.caption).foregroundStyle(.orange)
            }
            Button("Abrir Inbox profissional",systemImage:"paperplane"){professionalInbox=true}.buttonStyle(.bordered)
            if model.inboxLoading { ProgressView("A carregar…").frame(maxWidth: .infinity) }
            if !model.inboxLoaded {
                ContentUnavailableView {
                    Label("Abre as tuas conversas", systemImage: "bubble.left.and.bubble.right")
                } description: { Text("A Inbox é consultada apenas quando pedes. Mensagens e multimédia que o Instagram não disponibilize aqui continuam na app oficial.") } actions: {
                    Button("Carregar Inbox") { model.loadInbox() }.buttonStyle(.borderedProminent).disabled(!model.canReadInbox || model.inboxLoading)
                }
            } else {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(model.conversations.filter{query.isEmpty || "\($0.title) \($0.preview)".localizedCaseInsensitiveContains(query)}) { thread in
                            Button {
                                model.loadInbox(threadId: thread.id)
                                selected = thread
                            } label: {
                                HStack(spacing: 14) {
                                    ProfileAvatar(photoURL:thread.photoURL,size:42)
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text(thread.title).font(.headline).lineLimit(1)
                                        Text(thread.preview).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                                }.frame(maxWidth: .infinity, alignment: .leading).fcCard()
                            }.buttonStyle(PressStyle()).disabled(model.inboxLoading)
                        }
                        Text(model.conversations.isEmpty ? "O Instagram não devolveu conversas nesta consulta." : "Conversas recentes · leitura disponibilizada pelo Instagram")
                            .font(.caption).foregroundStyle(.secondary)
                        if model.inboxHasMore {Button("Carregar mais"){model.loadInbox(more:true)}.disabled(model.inboxLoading)}
                    }
                }
            }
            Spacer(minLength: 0)
        }.padding(20).background(FCStyle.background)
        .sheet(isPresented:$professionalInbox) {
            if let tool=NativeTool.all.first(where:{$0.id=="inbox"}) { ToolDestination(model:model,tool:tool) }
        }
        .sheet(item: $selected) { thread in
            NavigationStack {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        if model.inboxLoading { ProgressView("A carregar conversa…") }
                        ForEach(model.directMessages) { message in
                            HStack {
                                if message.own { Spacer(minLength: 30) }
                                Text(message.text).font(.body).padding(14)
                                    .background(message.own ? FCStyle.accent.opacity(0.25) : FCStyle.card, in: .rect(cornerRadius: 18))
                                    .textSelection(.enabled)
                                if !message.own { Spacer(minLength: 30) }
                            }
                        }
                        Text("Leitura das mensagens recentes. Para responder, abre o Instagram.").font(.caption).foregroundStyle(.secondary)
                    }.padding(20)
                }.background(FCStyle.background)
                .navigationTitle(thread.title).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Concluído") { selected = nil } } }
            }.tint(FCStyle.accent)
        }
    }
}

private struct WatchlistDetailView: View {
    let model: AppModel
    let target: AppModel.WatchTarget
    @Environment(\.dismiss) private var dismiss
    @State private var relation = "followers"
    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Picker("Lista", selection: $relation) {
                    Text("Seguidores").tag("followers")
                    Text("A seguir").tag("following")
                }.pickerStyle(.segmented).disabled(model.watchlistBusy)
                    .onChange(of: relation) { _, value in model.loadWatchlistList(target.id, relation: value) }
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(model.watchlistAccounts) { person in
                            HStack(spacing:12) {
                                ProfileAvatar(photoURL:person.photoURL)
                                VStack(alignment: .leading, spacing: 5) {
                                Text("@\(person.username)").font(.headline)
                                if !person.name.isEmpty { Text(person.name).font(.subheadline).foregroundStyle(.secondary) }
                                }
                            }.frame(maxWidth: .infinity, alignment: .leading).fcCard()
                        }
                        if model.watchlistBusy { ProgressView("A carregar lista…").frame(maxWidth: .infinity) }
                        if model.watchlistListMore {
                            Button("Carregar mais") { model.loadWatchlistList(target.id, relation: relation, more: true) }
                                .disabled(model.watchlistBusy).frame(maxWidth: .infinity)
                        }
                    }
                }
            }.padding(20).background(FCStyle.background)
            .navigationTitle("@\(target.username)").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Concluído") { dismiss() } } }
        }.tint(FCStyle.accent)
    }
}

private struct WatchChangeRow: View {
    let event: AppModel.WatchEvent
    var body: some View {
        HStack(alignment:.top,spacing:12) {
            ProfileAvatar(photoURL:event.photoURL,size:44)
            VStack(alignment:.leading,spacing:6) {
                Text(event.title).font(.headline)
                if !event.username.isEmpty {
                    if let encoded=event.username.addingPercentEncoding(withAllowedCharacters:.alphanumerics),
                       let url=URL(string:"https://www.instagram.com/"+encoded+"/") {
                        Link("@"+event.username,destination:url).font(.subheadline.bold())
                    }
                    if !event.fullName.isEmpty { Text(event.fullName).font(.caption).foregroundStyle(.secondary) }
                }
                Text(event.detail).font(.subheadline)
                Text(event.date,format:.dateTime.day().month().hour().minute()).font(.caption).foregroundStyle(.secondary)
            }
        }.padding(.vertical,6)
    }
}

private struct LimitsView: View {
    let model: AppModel
    @Environment(\.dismiss) private var dismiss
    @AppStorage("followcheck.limits.batch") private var batch=20
    @AppStorage("followcheck.limits.daily") private var daily=50
    @AppStorage("followcheck.limits.actionDelay") private var actionDelay=4
    @AppStorage("followcheck.limits.actionEvery") private var actionEvery=5
    @AppStorage("followcheck.limits.actionPause") private var actionPause=300
    @AppStorage("followcheck.limits.ownDelay") private var ownDelay=1
    @AppStorage("followcheck.limits.ownEvery") private var ownEvery=15
    @AppStorage("followcheck.limits.ownPause") private var ownPause=10
    @AppStorage("followcheck.limits.ownGap") private var ownGap=60
    @AppStorage("followcheck.limits.manualGap") private var manualGap=false
    @AppStorage("followcheck.limits.watchDelay") private var watchDelay=1
    @AppStorage("followcheck.limits.watchEvery") private var watchEvery=15
    @AppStorage("followcheck.limits.watchPause") private var watchPause=10
    @State private var message: String?
    @State private var saving=false
    @AppStorage("followcheck.limits.cooldownMinutes") private var cooldownMinutes=1440
    var body: some View {
        NavigationStack {
            Form {
                Section("Perfis de ritmo") {
                    Button("Aplicar ritmo de referência") {
                        ownDelay=1;ownEvery=15;ownPause=10;watchDelay=1;watchEvery=15;watchPause=10
                        actionDelay=4;actionEvery=5;actionPause=300
                        Task { do {try await model.applyPacing();message="Ritmo de referência aplicado aos próximos checks."} catch {message=error.localizedDescription} }
                    }
                    Button("Aplicar ritmo conservador") {
                        ownDelay=5;ownEvery=5;ownPause=30;watchDelay=5;watchEvery=5;watchPause=30
                        Task {try? await model.applyPacing()}
                    }
                    Text("Referência: 1 s base + 0,3–1,3 s de espaçamento por página; pausa de 10 s a cada 15 páginas. Ações: 4 s e pausa de 5 min a cada 5. Não garante ausência de limitações do servidor.").font(.caption)
                }
                Section("Pausa após limitação") {
                    Stepper("Duração local: \(cooldownMinutes) min",value:$cooldownMinutes,in:1...1440,step:1)
                    Picker("Escolha rápida",selection:$cooldownMinutes) {
                        ForEach([1,5,15,30,60,180,360,1440],id:\.self) { Text("\($0) min").tag($0) }
                    }
                    if let until=model.cooldownUntil,until>Date() {
                        HStack {Text("Tempo restante");Spacer();Text(until,style:.timer).monospacedDigit()}
                    }
                    if let until=model.serverCooldownUntil,until>Date() {
                        Text("Prazo comunicado pelo servidor: \(until.formatted(date:.omitted,time:.shortened))").font(.caption)
                    }
                    Button("Aplicar duração à pausa atual") {Task{do{try await model.configureCooldown(minutes:cooldownMinutes);message="Duração aplicada à pausa atual e às próximas."}catch{message=error.localizedDescription}}}
                    Button("Terminar espera local agora") {Task{do{try await model.configureCooldown(minutes:cooldownMinutes,release:true);message="Espera local terminada. Prazos do servidor e verificações de segurança mantêm-se."}catch{message=error.localizedDescription}}}
                    Text("A duração conta desde a última limitação. Terminar a espera não confirma ações nem remove avisos de segurança. Um novo erro pode iniciar outra pausa.").font(.caption)
                }
                Section("Ações sobre perfis") {
                    Stepper("Até \(batch) perfis por execução",value:$batch,in:1...10000)
                    Stepper("Até \(daily) tentativas / 24 h",value:$daily,in:1...10000)
                    Stepper("\(actionDelay) s entre ações",value:$actionDelay,in:2...120)
                    Stepper(actionEvery == 0 ? "Sem pausa adicional":"Pausa a cada \(actionEvery) ações",value:$actionEvery,in:0...50)
                    Stepper("Pausa de \(actionPause) s",value:$actionPause,in:0...600,step:5)
                    Text("Os limites contam tentativas por conta, incluindo falhas. Remover nos dois sentidos conta duas tentativas. Mudanças aplicam-se à próxima fila.").font(.caption)
                }
                Section("Análise da minha conta") {
                    Stepper("\(ownDelay) s entre páginas",value:$ownDelay,in:1...60)
                    Stepper(ownEvery == 0 ? "Sem pausa adicional":"Pausa a cada \(ownEvery) páginas",value:$ownEvery,in:0...50)
                    Stepper("Pausa de \(ownPause) s",value:$ownPause,in:0...600,step:5)
                    Stepper("Intervalo local: \(ownGap) min",value:$ownGap,in:0...1440,step:15)
                    Toggle("Aplicar intervalo também a checks manuais",isOn:$manualGap)
                }
                Section("Watchlist — ritmo independente") {
                    Stepper("\(watchDelay) s entre páginas",value:$watchDelay,in:1...60)
                    Stepper(watchEvery == 0 ? "Sem pausa adicional":"Pausa a cada \(watchEvery) páginas",value:$watchEvery,in:0...50)
                    Stepper("Pausa de \(watchPause) s",value:$watchPause,in:0...600,step:5)
                    Text("A frequência é definida em cada perfil da Watchlist. O intervalo local da tua análise não a bloqueia. Os pedidos continuam a ser executados um de cada vez.").font(.caption)
                }
                Section {
                    Text("Estas são preferências locais, não limites garantidos pelo Instagram. Uma resposta 429 interrompe a fila e mantém a pausa de proteção. O ritmo novo aplica-se ao próximo check.").font(.footnote)
                    Button("Aplicar e guardar") {Task{saving=true;defer{saving=false};do{try await model.applyPacing();message=model.sessionAvailable ? "Definições aplicadas.":"Guardado. Será aplicado quando a sessão estiver disponível."}catch{message=error.localizedDescription}}}.disabled(saving)
                    if let message{Text(message).font(.footnote)}
                }
            }.navigationTitle("Ritmo e limites")
            .toolbar{ToolbarItem(placement:.confirmationAction){Button("Fechar"){dismiss()}}}
            .onDisappear{Task{try? await model.applyPacing()}}
        }.tint(FCStyle.accent)
    }
}

// Seven circles reproduce the original brand mark without replacing it with an SF Symbol.
private struct FollowCheckFlower: View {
    var body:some View {
        GeometryReader { proxy in
            let size=min(proxy.size.width,proxy.size.height)
            ZStack {
                Circle().fill(FCStyle.mint).frame(width:size*0.29,height:size*0.29)
                ForEach(0..<6,id:\.self) { index in
                    let angle=Double(index)*Double.pi/3
                    Circle().fill(FCStyle.mint).frame(width:size*0.29,height:size*0.29)
                        .offset(x:cos(angle)*size*0.33,y:sin(angle)*size*0.33)
                }
            }.frame(width:proxy.size.width,height:proxy.size.height)
        }.accessibilityHidden(true)
    }
}

private let watchChangeKinds:[(id:String,title:String,icon:String)] = [
    ("watch_new_follower","Novos seguidores","person.badge.plus"),
    ("watch_lost_follower","Perdeu seguidores","person.badge.minus"),
    ("watch_started_following","Começou a seguir","arrow.up.right"),
    ("watch_stopped_following","Deixou de seguir","arrow.down.right")
]
private struct WatchChangeSummary:View {
    let events:[AppModel.WatchEvent]
    let open:(String)->Void
    var body:some View {
        LazyVGrid(columns:[GridItem(.flexible()),GridItem(.flexible())],spacing:10) {
            ForEach(watchChangeKinds,id:\.id) { kind in
                Button {open(kind.id)} label: {
                    VStack(alignment:.leading,spacing:7) {
                        HStack {Image(systemName:kind.icon);Spacer();Text(events.filter{$0.type==kind.id}.count.formatted()).monospacedDigit().bold()}
                        Text(kind.title).font(.caption2).foregroundStyle(.secondary)
                    }.padding(12).foregroundStyle(FCStyle.accent).background(FCStyle.background,in:.rect(cornerRadius:12))
                }.buttonStyle(PressStyle())
            }
        }
        Text("Alterações no histórico guardado · toca para ver os perfis").font(.caption2).foregroundStyle(.secondary)
    }
}
private struct WatchHistorySheet:View {
    let model:AppModel
    let target:AppModel.WatchTarget
    @State private var query=""
    @State private var filter=""
    @Environment(\.dismiss) private var dismiss
    init(model:AppModel,target:AppModel.WatchTarget,initialFilter:String) {self.model=model;self.target=target;_filter=State(initialValue:initialFilter)}
    var body:some View {
        NavigationStack {
            ScrollView {WatchHistoryContent(events:model.watchEvents.filter{$0.targetId==target.id},query:$query,filter:$filter).padding(20)}
                .background(FCStyle.background).navigationTitle("@\(target.username)")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar{ToolbarItem(placement:.confirmationAction){Button("Fechar"){dismiss()}}}
        }.tint(FCStyle.accent)
    }
}
private struct WatchHistoryContent:View {
    let events:[AppModel.WatchEvent]
    var targetNames:[String:String]=[:]
    @Binding var query:String
    @Binding var filter:String
    private var matches:[AppModel.WatchEvent] {
        events.filter { event in
            event.isWatchChange && (filter.isEmpty || event.type==filter) &&
            (query.isEmpty || "\(event.username) \(event.fullName) \(event.title)".localizedCaseInsensitiveContains(query))
        }.sorted{$0.date>$1.date}
    }
    var body:some View {
        VStack(alignment:.leading,spacing:16) {
            Text("O que mudou").font(.title2.bold())
            Text("Comparação entre checks completos. A data é a da observação; não indica a hora exata da mudança.").font(.caption).foregroundStyle(.secondary)
            HStack {Image(systemName:"magnifyingglass");TextField("Pesquisar perfil ou alteração",text:$query).textInputAutocapitalization(.never)}.padding(13).background(FCStyle.card,in:.rect(cornerRadius:14))
            ScrollView(.horizontal) {
                HStack(spacing:8) {
                    filterButton("Todas","")
                    ForEach(watchChangeKinds,id:\.id){kind in filterButton(kind.title,kind.id)}
                    filterButton("Perfil","watch_profile_change")
                }
            }.scrollIndicators(.hidden)
            if matches.isEmpty {ContentUnavailableView("Sem alterações neste filtro",systemImage:"eye",description:Text("O primeiro check cria a referência. Os seguintes identificam as contas que mudaram."))}
            LazyVStack(spacing:12) {ForEach(matches){event in VStack(alignment:.leading,spacing:4){if let name=targetNames[event.targetId]{Text("@"+name).font(.caption.bold()).foregroundStyle(FCStyle.mint)};WatchChangeRow(event:event)}.fcCard()}}
        }
    }
    private func filterButton(_ title:String,_ id:String)->some View {
        Button {filter=id} label:{Text(title).font(.caption.weight(.semibold)).padding(.horizontal,14).padding(.vertical,10).foregroundStyle(filter==id ? FCStyle.accent:.secondary).background(filter==id ? FCStyle.accent.opacity(0.14):FCStyle.card,in:.capsule)}.buttonStyle(.plain)
    }
}

private struct MediaLikePerson: Identifiable {
    let id:String
    let username:String
    let fullName:String
    let photoURL:String
    init(_ value:[String:Any]) {id=value["id"] as? String ?? "";username=value["username"] as? String ?? "";fullName=value["fullName"] as? String ?? "";photoURL=value["photoURL"] as? String ?? ""}
}
private struct MediaLikeChange:Identifiable {
    let id:String
    let removed:Bool
    let person:MediaLikePerson
    init(_ value:[String:Any]) {id=value["id"] as? String ?? "";removed=value["type"] as? String == "removed";person=MediaLikePerson(value["user"] as? [String:Any] ?? [:])}
}
private struct MediaLikePost:Identifiable {
    let photoURL:String
    let id:String
    let code:String
    let caption:String
    let complete:Bool
    let people:[MediaLikePerson]
    let changes:[MediaLikeChange]
    init(_ value:[String:Any]) {photoURL=value["photoURL"] as? String ?? "";id=value["id"] as? String ?? "";code=value["code"] as? String ?? "";caption=value["caption"] as? String ?? "";complete=value["complete"] as? Bool ?? false;people=(value["users"] as? [[String:Any]] ?? []).map(MediaLikePerson.init);changes=(value["events"] as? [[String:Any]] ?? []).map(MediaLikeChange.init)}
}
private struct MediaLikesView:View {
    let model:AppModel
    let targetID:String
    let title:String
    @Environment(\.dismiss) private var dismiss
    @State private var posts:[MediaLikePost]=[]
    @State private var loading=false
    @State private var error=""
    @State private var amount=3
    @State private var query=""
    var body:some View {
        NavigationStack {
            ScrollView {
                VStack(alignment:.leading,spacing:18) {
                    Text("Gostos nas publicações").font(.title2.bold())
                    Text("Observa os perfis disponíveis nas publicações recentes. Gostos removidos só aparecem após duas listas completas; a data de observação não é a data do like.").font(.caption).foregroundStyle(.secondary)
                    Picker("Publicações por consulta",selection:$amount){ForEach([1,3,5,8],id:\.self){Text("\($0) publicações").tag($0)}}.disabled(loading)
                    Button(loading ? "A consultar…":"Atualizar gostos",systemImage:"arrow.clockwise"){Task{await load(refresh:true)}}.buttonStyle(.borderedProminent).disabled(loading || model.checkIsRunning || !model.sessionAvailable)
                    if loading {ProgressView()}
                    if !error.isEmpty {Text(error).font(.caption).foregroundStyle(.orange)}
                    TextField("Pesquisar quem gostou",text:$query).textFieldStyle(.roundedBorder).textInputAutocapitalization(.never)
                    if posts.isEmpty && !loading {ContentUnavailableView("Ainda sem observações",systemImage:"heart",description:Text("Atualiza para criar a primeira referência das publicações acessíveis nesta sessão."))}
                    ForEach(posts){post in
                        VStack(alignment:.leading,spacing:12) {
                            if let imageURL=URL(string:post.photoURL),imageURL.scheme=="https" {
                                AsyncImage(url:imageURL){image in image.resizable().scaledToFill()} placeholder:{Rectangle().fill(FCStyle.accent.opacity(0.08))}.frame(height:220).clipped().clipShape(.rect(cornerRadius:14))
                            }
                            if let url=URL(string:"https://www.instagram.com/p/"+post.code+"/"),!post.code.isEmpty {Link("Abrir publicação",destination:url).font(.headline)}
                            Text(post.caption).font(.subheadline).lineLimit(3)
                            Label(post.complete ? "Lista completa · \(post.people.count) perfis":"Lista parcial · \(post.people.count) perfis observados",systemImage:post.complete ? "checkmark.circle":"circle.lefthalf.filled").font(.caption).foregroundStyle(post.complete ? FCStyle.mint:.orange)
                            if !post.changes.isEmpty {
                                DisclosureGroup("Mudanças observadas (\(post.changes.count))") {
                                    ForEach(post.changes){change in
                                        VStack(alignment:.leading,spacing:5){Text(change.removed ? "Já não aparece na lista completa":"Novo na lista de gostos").font(.caption).foregroundStyle(change.removed ? FCStyle.pink:FCStyle.mint);person(change.person)}
                                    }
                                }
                            }
                            DisclosureGroup("Quem gostou") {
                                LazyVStack(spacing:12){ForEach(post.people.filter{query.isEmpty || "\($0.username) \($0.fullName)".localizedCaseInsensitiveContains(query)}){person($0)}}
                            }
                        }.fcCard()
                    }
                }.padding(20)
            }.background(FCStyle.background).navigationTitle(title).navigationBarTitleDisplayMode(.inline)
                .toolbar{ToolbarItem(placement:.confirmationAction){Button("Fechar"){dismiss()}}}
                .task(id:model.accountId){posts=[];await load(refresh:false)}
        }.tint(FCStyle.accent)
    }
    private func person(_ person:MediaLikePerson)->some View {
        HStack(spacing:10){ProfileAvatar(photoURL:person.photoURL,size:32);VStack(alignment:.leading){Text("@"+person.username).font(.subheadline);Text(person.fullName).font(.caption).foregroundStyle(.secondary)};Spacer()}.padding(.vertical,4)
    }
    private func load(refresh:Bool) async {
        let owner=model.accountId
        loading=true;error="";defer{loading=false}
        do {let result=try await model.tools.request("likes",["targetId":targetID,"operation":refresh ? "refresh":"get","amount":amount]);guard model.accountId==owner,result["accountId"] as? String==owner else{return};posts=(result["posts"] as? [[String:Any]] ?? []).map(MediaLikePost.init)}
        catch {self.error=error.localizedDescription}
    }
}
