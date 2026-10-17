import Observation
import SwiftUI
import WebKit

/// Native Instagram messages. A hidden page of the user's own session at /direct/
/// renders the conversations; direct-reader.js reads what it shows, and this store
/// mirrors it into native screens. No Instagram API is called by the app itself.
@MainActor @Observable
final class DirectStore: NSObject, WKNavigationDelegate {
    enum Phase: Equatable { case idle, loading, ready, needsLogin, unreadable }

    struct Chat: Identifiable, Equatable {
        let id: String
        let index: Int
        let name: String
        let snippet: String
        let time: String
        let unread: Bool
        let photoURL: String
        init(_ v: [String: Any]) {
            id = v["id"] as? String ?? ""
            index = (v["index"] as? NSNumber)?.intValue ?? 0
            name = v["name"] as? String ?? ""
            snippet = v["snippet"] as? String ?? ""
            time = v["time"] as? String ?? ""
            unread = v["unread"] as? Bool ?? false
            photoURL = v["photoURL"] as? String ?? ""
        }
        /// Rows without a stable id can only be opened by their position in the page.
        var stable: Bool { !id.hasPrefix("row:") }
    }

    struct Message: Identifiable, Equatable {
        let id: String
        let text: String
        let outgoing: Bool
        let photoURL: String
        var pending = false
        init(_ v: [String: Any]) {
            id = v["id"] as? String ?? UUID().uuidString
            text = v["text"] as? String ?? ""
            outgoing = v["outgoing"] as? Bool ?? false
            photoURL = v["photoURL"] as? String ?? ""
        }
        init(pendingText: String) {
            id = "pending-" + UUID().uuidString; text = pendingText; outgoing = true; photoURL = ""; pending = true
        }
    }

    unowned let model: AppModel
    var phase: Phase = .idle
    var threads: [Chat] = []
    var openThread: Chat?
    var threadTitle = ""
    var messages: [Message] = []
    var canSend = false
    var sending = false
    var failure: String?
    @ObservationIgnored private var web: WKWebView?
    @ObservationIgnored private var polling: Task<Void, Never>?
    @ObservationIgnored private var startedAt = Date()
    @ObservationIgnored private var pendingTexts: [Message] = []
    @ObservationIgnored private var lastLogged = ""

    init(model: AppModel) { self.model = model }

    var unreadCount: Int { threads.filter(\.unread).count }

    func start() {
        guard web == nil else { return }
        #if DEBUG
        if model.isPreview { loadPreview(); return }
        #endif
        guard let coordinator = model.webCoordinator, let store = coordinator.sessionDataStore, let script = coordinator.directScript(),
              let url = URL(string: "https://www.instagram.com/direct/inbox/") else {
            phase = .unreadable; failure = "A sessão ainda está a iniciar. Tenta daqui a pouco."; return
        }
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = store
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isUserInteractionEnabled = false
        view.accessibilityElementsHidden = true
        view.navigationDelegate = self
        guard coordinator.hostHidden(view) else { phase = .unreadable; failure = "A sessão ainda está a iniciar. Tenta daqui a pouco."; return }
        web = view
        phase = .loading; failure = nil; startedAt = Date()
        view.load(URLRequest(url: url))
        model.record("Mensagens: a abrir a caixa de entrada.")
        polling = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(700))
                guard let self, !Task.isCancelled else { return }
                await self.poll()
            }
        }
    }

    func stop() {
        polling?.cancel(); polling = nil
        web?.navigationDelegate = nil; web?.stopLoading(); web?.removeFromSuperview(); web = nil
        openThread = nil; messages = []; pendingTexts = []
        if phase != .needsLogin { phase = .idle }
    }

    func reload() {
        stop(); threads = []; start()
    }

    func open(_ thread: Chat) {
        openThread = thread; threadTitle = thread.name; messages = []; pendingTexts = []; canSend = false
        #if DEBUG
        if model.isPreview { messages = Self.previewMessages; canSend = true; return }
        #endif
        Task { _ = try? await web?.callAsyncJavaScript("return globalThis.__FC_DIRECT__?.open(id, index)", arguments: ["id": thread.id, "index": thread.index], in: nil, contentWorld: .page) }
        startedAt = Date()
    }

    func closeThread() {
        openThread = nil; messages = []; pendingTexts = []
        guard !model.isPreview, let url = URL(string: "https://www.instagram.com/direct/inbox/") else { return }
        web?.load(URLRequest(url: url))
    }

    func loadOlder() {
        Task { _ = try? await web?.callAsyncJavaScript("return globalThis.__FC_DIRECT__?.scrollUp()", arguments: [:], in: nil, contentWorld: .page) }
    }

    func send(_ text: String) async -> Bool {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !sending else { return false }
        #if DEBUG
        if model.isPreview { messages.append(Message(pendingText: value)); return true }
        #endif
        sending = true; defer { sending = false }
        do {
            let result = try await web?.callAsyncJavaScript("return globalThis.__FC_DIRECT__?.send(text)", arguments: ["text": value], in: nil, contentWorld: .page) as? [String: Any]
            guard result?["ok"] as? Bool == true else {
                failure = "Não foi possível escrever na conversa. Abre-a no Instagram para enviar."
                model.record("Mensagens: envio não confirmado (\(result?["code"] as? String ?? "sem resposta")).", level: "warn")
                return false
            }
            let pending = Message(pendingText: value)
            pendingTexts.append(pending); messages.append(pending)
            return true
        } catch {
            failure = "Não foi possível enviar: \(error.localizedDescription)"
            return false
        }
    }

    private func poll() async {
        guard let web else { return }
        guard let value = try? await web.callAsyncJavaScript("return globalThis.__FC_DIRECT__?.snapshot() ?? null", arguments: [:], in: nil, contentWorld: .page),
              let snapshot = value as? [String: Any] else {
            checkTimeout(shape: nil); return
        }
        let page = snapshot["page"] as? String ?? ""
        if page == "login" { phase = .needsLogin; return }
        if page == "inbox" {
            let rows = (snapshot["threads"] as? [[String: Any]] ?? []).map(Chat.init).filter { !$0.name.isEmpty }
            if !rows.isEmpty {
                if rows != threads { threads = rows }
                if phase != .ready { phase = .ready; log("\(rows.count) conversas lidas (\(rows.first?.stable == true ? "ligações" : "linhas")).") }
            } else { checkTimeout(shape: snapshot["shape"]) }
        }
        if page == "thread", openThread != nil {
            threadTitle = (snapshot["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? threadTitle
            canSend = snapshot["canSend"] as? Bool ?? false
            var read = (snapshot["messages"] as? [[String: Any]] ?? []).map(Message.init).filter { !$0.text.isEmpty || !$0.photoURL.isEmpty }
            // A sent message stays as pending until the page shows it.
            pendingTexts.removeAll { pending in read.contains { $0.outgoing && $0.text == pending.text } }
            read.append(contentsOf: pendingTexts)
            if read != messages { messages = read }
            if phase != .ready { phase = .ready }
        }
    }

    private func checkTimeout(shape: Any?) {
        guard phase == .loading, Date().timeIntervalSince(startedAt) > 20 else { return }
        phase = .unreadable
        failure = "O Instagram não mostrou conversas legíveis nesta página."
        // Structure only (counts of elements), never message content.
        if let shape, let data = try? JSONSerialization.data(withJSONObject: shape, options: [.sortedKeys]) {
            log("página sem conversas legíveis: " + String(decoding: data, as: UTF8.self), level: "warn")
        } else { log("o leitor não respondeu na página de mensagens.", level: "warn") }
    }

    private func log(_ message: String, level: String = "info") {
        guard message != lastLogged else { return }
        lastLogged = message
        model.record("Mensagens: " + message, level: level)
    }

    // MARK: Navigation

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = action.request.url
        let allowed = url?.scheme == "https" && ["www.instagram.com", "instagram.com"].contains(url?.host?.lowercased() ?? "")
        let path = url?.path.lowercased() ?? ""
        if allowed && (path.hasPrefix("/accounts/login") || path.hasPrefix("/challenge") || path.hasPrefix("/checkpoint")) { phase = .needsLogin }
        // Only Instagram pages may load in the hidden view; subframes such as media keep loading.
        decisionHandler(allowed || action.targetFrame?.isMainFrame == false ? .allow : .cancel)
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { reload() }

    #if DEBUG
    private func loadPreview() {
        phase = .ready
        threads = [
            Chat(["id": "1", "index": 0, "name": "Ana Ribeiro", "snippet": "Combinado, sexta às 8 🙌", "time": "2 min", "unread": true]),
            Chat(["id": "2", "index": 1, "name": "Studio Norte", "snippet": "Enviaste: obrigado pela partilha!", "time": "1 h"]),
            Chat(["id": "3", "index": 2, "name": "João Martins", "snippet": "Viste o filme?", "time": "3 h", "unread": true]),
            Chat(["id": "4", "index": 3, "name": "Inês Costa", "snippet": "Gostou de uma mensagem", "time": "ontem"]),
            Chat(["id": "5", "index": 4, "name": "Lisboa Film Club", "snippet": "Bilhetes para sábado já disponíveis", "time": "2 d"]),
        ]
        if PreviewFlags.has("--preview-chat"), let first = threads.first { open(first) }
    }
    static let previewMessages = [
        Message(["id": "a", "text": "Olá! Ainda vens jantar na sexta?", "outgoing": false]),
        Message(["id": "b", "text": "Sim, claro. Que horas?", "outgoing": true]),
        Message(["id": "c", "text": "Às 8 no sítio do costume", "outgoing": false]),
        Message(["id": "d", "text": "Combinado, sexta às 8 🙌", "outgoing": true]),
    ]
    #endif
}

// MARK: - Screens

struct MessagesScreen: View {
    let model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var path: [String] = []
    private var store: DirectStore { model.direct }
    private var visible: [DirectStore.Chat] {
        store.threads.filter { query.isEmpty || "\($0.name) \($0.snippet)".localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        Text("Mensagens").font(.largeTitle.weight(.bold)).foregroundStyle(Theme.ink).accessibilityAddTraits(.isHeader)
                        Spacer()
                        IconButton(systemName: "xmark", label: "Fechar") { dismiss() }
                    }
                    content
                }
                .padding(.horizontal, 20).padding(.vertical, 12)
                .frame(maxWidth: 680).frame(maxWidth: .infinity)
            }
            .background(Theme.canvas)
            .refreshable { store.reload() }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { id in
                if let thread = store.threads.first(where: { $0.id == id }) { ChatScreen(model: model, thread: thread) }
            }
        }
        .tint(Theme.signalInk)
        .onAppear {
            store.start()
            #if DEBUG
            if PreviewFlags.has("--preview-chat"), let first = store.threads.first { path = [first.id] }
            #endif
        }
        .onDisappear { store.stop() }
    }

    @ViewBuilder private var content: some View {
        switch store.phase {
        case .loading, .idle:
            VStack(spacing: 12) {
                ProgressView().tint(Theme.signalInk)
                Text("A abrir as tuas conversas…").font(.subheadline).foregroundStyle(Theme.ink2)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 60)
        case .needsLogin:
            EmptyState(icon: "lock", title: "Confirma a sessão", message: "O Instagram pediu para entrares de novo antes de mostrar as mensagens.",
                       actionTitle: "Abrir Instagram") { dismiss(); model.openInstagram() }
                .surface(padding: 0)
        case .unreadable:
            EmptyState(icon: "bubble.left.and.exclamationmark.bubble.right", title: "Não consegui ler as conversas",
                       message: (store.failure ?? "") + " Isto pode acontecer quando o Instagram muda a página. O diagnóstico guardou a estrutura da página, sem conteúdos.",
                       actionTitle: "Tentar de novo") { store.reload() }
                .surface(padding: 0)
            Button("Abrir as mensagens no Instagram") { dismiss(); model.openInstagramMessagesPage() }
                .buttonStyle(QuietButtonStyle(fill: true))
        case .ready:
            SearchField(text: $query, prompt: "Pesquisar conversas")
            if visible.isEmpty {
                EmptyState(icon: "bubble.left.and.bubble.right", title: query.isEmpty ? "Sem conversas" : "Sem resultados", message: query.isEmpty ? "As conversas aparecem aqui." : "Nenhuma conversa corresponde.")
                    .surface(padding: 0)
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(Array(visible.enumerated()), id: \.element.id) { index, thread in
                        NavigationLink(value: thread.id) { ThreadRow(thread: thread) }
                            .buttonStyle(.plain)
                        if index < visible.count - 1 { Divider().overlay(Theme.line).padding(.leading, 76) }
                    }
                }
                .surface(padding: 0, radius: 20)
                Text("As conversas são lidas da tua sessão, sem pedidos extra ao Instagram, e não ficam guardadas na app.")
                    .font(.caption).foregroundStyle(Theme.ink3)
            }
        }
    }
}

private struct ThreadRow: View {
    let thread: DirectStore.Chat
    var body: some View {
        HStack(spacing: 12) {
            ProfileAvatar(photoURL: thread.photoURL, size: 52, name: thread.name)
            VStack(alignment: .leading, spacing: 3) {
                Text(thread.name).font(.subheadline.weight(thread.unread ? .bold : .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                Text(thread.snippet.isEmpty ? " " : thread.snippet).font(.footnote.weight(thread.unread ? .semibold : .regular))
                    .foregroundStyle(thread.unread ? Theme.ink : Theme.ink2).lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 6) {
                Text(thread.time).font(.caption).foregroundStyle(Theme.ink3)
                if thread.unread { Circle().fill(Theme.signalInk).frame(width: 9, height: 9).accessibilityLabel("Não lida") }
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

struct ChatScreen: View {
    let model: AppModel
    let thread: DirectStore.Chat
    @State private var draft = ""
    @FocusState private var focused: Bool
    private var store: DirectStore { model.direct }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 6) {
                    if store.messages.isEmpty {
                        ProgressView().tint(Theme.signalInk).padding(.top, 60)
                    } else {
                        Button("Mensagens anteriores", action: store.loadOlder).font(.footnote.weight(.semibold)).foregroundStyle(Theme.signalInk).padding(.vertical, 8)
                    }
                    ForEach(store.messages) { message in Bubble(message: message).id(message.id) }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.canvas)
            .onChange(of: store.messages.count) { _, _ in withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("bottom", anchor: .bottom) } }
            .safeAreaInset(edge: .bottom, spacing: 0) { composer }
        }
        .navigationTitle(store.threadTitle.isEmpty ? thread.name : store.threadTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if thread.stable {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button("Abrir no Instagram", systemImage: "arrow.up.forward.app") { model.openInstagramThread(thread.id) }
                    } label: { Image(systemName: "ellipsis.circle") }
                }
            }
        }
        .onAppear { if store.openThread?.id != thread.id { store.open(thread) } }
        .onDisappear { store.closeThread() }
    }

    private var composer: some View {
        VStack(spacing: 6) {
            if let failure = store.failure { Text(failure).font(.caption).foregroundStyle(Theme.loss).frame(maxWidth: .infinity, alignment: .leading) }
            HStack(alignment: .bottom, spacing: 10) {
                TextField("Mensagem…", text: $draft, axis: .vertical)
                    .lineLimit(1...5).focused($focused)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(Theme.surface, in: .rect(cornerRadius: 22, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Theme.line))
                Button {
                    let text = draft
                    Task { if await store.send(text) { draft = "" } }
                } label: {
                    Image(systemName: "arrow.up").font(.system(size: 16, weight: .bold)).foregroundStyle(Theme.onSignal)
                        .frame(width: 42, height: 42).background(Theme.signal, in: .circle)
                }
                .accessibilityLabel("Enviar")
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.sending || !store.canSend)
                .opacity(store.canSend ? 1 : 0.5)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(.bar)
    }
}

private struct Bubble: View {
    let message: DirectStore.Message
    var body: some View {
        HStack {
            if message.outgoing { Spacer(minLength: 48) }
            Group {
                if !message.photoURL.isEmpty {
                    AsyncImage(url: URL(string: message.photoURL)) { $0.resizable().scaledToFill() } placeholder: { Theme.sunken }
                        .frame(width: 200, height: 200).clipShape(.rect(cornerRadius: 18, style: .continuous))
                } else {
                    Text(message.text).font(.body).foregroundStyle(message.outgoing ? Theme.onSignal : Theme.ink).textSelection(.enabled)
                        .padding(.horizontal, 14).padding(.vertical, 9)
                        .background(message.outgoing ? Theme.signal : Theme.surface, in: .rect(cornerRadius: 20, style: .continuous))
                        .overlay {
                            if !message.outgoing { RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Theme.line) }
                        }
                }
            }
            .opacity(message.pending ? 0.6 : 1)
            if !message.outgoing { Spacer(minLength: 48) }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel((message.outgoing ? "Tu: " : "") + (message.text.isEmpty ? "Imagem" : message.text))
    }
}
