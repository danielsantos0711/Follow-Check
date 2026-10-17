import Foundation
import UIKit
import UserNotifications
import WebKit

@MainActor
final class FollowCheckWebCoordinator: NSObject {
    private let model: AppModel
    private let followCheckWorld = WKContentWorld.world(name: "FollowCheck")
    private weak var webView: WKWebView?
    private var shouldRestorePanel = false
    private var mountingPanel = false
    private var panelSection = "relations"
    private var panelRequest = UUID()
    private var navigationGeneration = 0
    private var loadingTimeout: Task<Void, Never>?
    private var profileReader: RenderedProfileReader?

    init(model: AppModel) {
        self.model = model
        super.init()
    }

    func makeWebView() -> WKWebView {
        let controller = WKUserContentController()
        controller.add(self, contentWorld: followCheckWorld, name: "followcheckIOS")
        controller.addScriptMessageHandler(self, contentWorld: followCheckWorld, name: "followcheckRPC")

        addBootstrapScripts(to: controller)

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        // Use WebKit’s actual user agent; do not impersonate another browser.

        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        view.uiDelegate = self
        view.allowsBackForwardNavigationGestures = true
        view.scrollView.keyboardDismissMode = .interactive
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.isOpaque = false
        view.backgroundColor = Theme.webBackground
        view.scrollView.backgroundColor = view.backgroundColor
        webView = view

        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--verify-profile-reader") {
            DispatchQueue.main.asyncAfter(deadline:.now()+0.3) { [weak self, weak view] in
                guard let self, let view, let container=view.superview, let source=self.script(named:"profile-reader") else{return}
                let reader=RenderedProfileReader(requestId:"fixture-profile-reader",dataStore:.nonPersistent())
                reader.fixture=true;self.profileReader=reader
                reader.start(username:"watched",expectedId:"7",owner:"42",source:source,in:container,behind:view) { [weak self] result in
                    guard let self else{return}
                    let listReader=RenderedProfileReader(requestId:"fixture-list-reader",dataStore:.nonPersistent())
                    listReader.fixture=true;self.profileReader=listReader
                    listReader.start(username:"watched",expectedId:"7",owner:"42",source:source,options:["goal":"list","listKind":"followers","expectedCount":4,"viewerUsername":"viewer","pageDelayMinMs":300,"pageDelayMaxMs":300],in:container,behind:view) { [weak self] listResult in
                        var combined=result;combined["relations"]=listResult
                        combined["ok"]=(result["ok"] as? Bool == true) && (listResult["ok"] as? Bool == true)
                        let destination=FileManager.default.urls(for:.documentDirectory,in:.userDomainMask)[0].appendingPathComponent("profile-reader-verification.json")
                        if let data=try? JSONSerialization.data(withJSONObject:combined,options:[.sortedKeys]) {try? data.write(to:destination,options:.atomic)}
                        self?.profileReader=nil
                    }
                }
            }
            return view
        }
        #endif
        guard let url = URL(string: "https://www.instagram.com/") else {
            model.pageFailed("URL de arranque inválido.")
            return view
        }
        view.load(URLRequest(url: url, cachePolicy: .useProtocolCachePolicy))
        return view
    }

    func tearDown() {
        profileReader?.cancel(); profileReader = nil
        guard let webView else { return }
        loadingTimeout?.cancel()
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "followcheckIOS", contentWorld: followCheckWorld)
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "followcheckRPC", contentWorld: followCheckWorld)
    }

    func openFollowCheck() {
        guard let webView, isInstagramURL(webView.url) else {
            model.pageFailed("Abre primeiro uma página do Instagram dentro da app.")
            return
        }
        guard !mountingPanel, !webView.isLoading, !isAuthenticationURL(webView.url) else {
            model.isBusy = false
            return
        }
        mountingPanel = true
        let generation = navigationGeneration
        shouldRestorePanel = true
        evaluateSequentially(
            files: ["keepalive-shim", "hardening", "followcheck", "ios-theme"],
            in: webView
        ) { [weak self] result in
            guard let self, self.navigationGeneration == generation else { return }
            self.mountingPanel = false
            switch result {
            case .success:
                self.model.panelOpened()
            case .failure(let error):
                self.model.pageFailed("Falha ao montar a interface: \(error.localizedDescription)")
            }
        }
    }

    func closeFollowCheck() {
        shouldRestorePanel = false
        evaluateInFollowCheckWorld("""
            try {
              if (typeof globalThis.__FOLLOWCHECK_UNMOUNT__ === 'function') {
                globalThis.__FOLLOWCHECK_UNMOUNT__();
              } else {
                document.getElementById('followcheck-app-host')?.remove();
              }
              true;
            } catch (_) { false; }
            """) { [weak self] _, _ in
                self?.model.panelClosed()
            }
    }

    func openInstagramHome() {
        shouldRestorePanel = false
        model.panelClosed()
        guard let url = URL(string: "https://www.instagram.com/") else { return }
        if webView?.url == nil || isAuthenticationURL(webView?.url) == false && model.phase != .ready { webView?.load(URLRequest(url: url)) }
    }

    func openInstagramInbox() {
        shouldRestorePanel = false
        model.panelClosed()
        guard let url = URL(string:"https://www.instagram.com/direct/inbox/") else {return}
        webView?.load(URLRequest(url:url))
    }

    func openAccountSwitcher() {
        shouldRestorePanel = false
        model.panelClosed()
        guard let url = URL(string: "https://www.instagram.com/accounts/edit/") else { return }
        webView?.load(URLRequest(url: url))
    }

    func reload() {
        webView?.reload()
    }

    func goBack() {
        guard let webView, webView.canGoBack else { return }
        webView.goBack()
    }

    func backgroundChecks(_ allowed: Bool) {
        if !allowed { profileReader?.cancel(); profileReader = nil }
        webView?.evaluateJavaScript("globalThis.__FOLLOWCHECK_BACKGROUND_READ__ = \(allowed ? "true" : "false");", in:nil,in:.page) { _ in }
        control("lifecycle",args:["active":false,"continueChecks":allowed])
    }
    func resume() {
        webView?.evaluateJavaScript("globalThis.__FOLLOWCHECK_BACKGROUND_READ__ = false;",in:nil,in:.page) { _ in }
        // WebKit emits its own lifecycle events. Synthetic focus/pageshow events
        // caused multiple recovery paths to fire on each foreground transition.
        control("lifecycle", args: ["active": true])
        if model.phase == .ready { control("state") }
    }

    private var archiveFiles:[String:(url:URL,owner:String,generation:Int,size:Int)]=[:]
    func cancelArchiveImport() {archiveFiles.removeAll()}
    func importArchive(_ urls:[URL],target:Int) async throws -> [String:Any] {
        let owner=model.accountId
        var accessed:[URL]=[],ids:[String]=[],files:[[String:Any]]=[]
        defer {for id in ids{archiveFiles.removeValue(forKey:id)};for url in accessed{url.stopAccessingSecurityScopedResource()}}
        for url in urls {
            if url.startAccessingSecurityScopedResource(){accessed.append(url)}
            let size=try url.resourceValues(forKeys:[.fileSizeKey]).fileSize ?? 0
            guard ["zip","json"].contains(url.pathExtension.lowercased()),size>0,size<=1024*1024*1024 else {throw NSError(domain:"FollowCheck",code:1,userInfo:[NSLocalizedDescriptionKey:"Escolhe ZIP ou JSON até 1 GB por ficheiro."])}
            let id=UUID().uuidString;ids.append(id)
            archiveFiles[id]=(url,owner,navigationGeneration,size)
            files.append(["nativeId":id,"name":url.lastPathComponent,"size":size])
        }
        return try await request("legacy",args:["operation":"import","nativeFiles":files,"accountId":owner,"username":model.username,"target":target])
    }

    func request(_ command: String, args: [String: Any] = [:]) async throws -> [String: Any] {
        guard let webView, !isAuthenticationURL(webView.url) else { throw NSError(domain: "FollowCheck", code: 1, userInfo: [NSLocalizedDescriptionKey: "Conclui primeiro a autenticação no Instagram."]) }
        let generation = navigationGeneration
        return try await withCheckedThrowingContinuation { continuation in
            webView.callAsyncJavaScript("""
                if (!globalThis.__FOLLOWCHECK_IOS_CONTROL__) return {ok:false,error:'O motor ainda não está pronto.'};
                try { return await globalThis.__FOLLOWCHECK_IOS_CONTROL__(command,args); }
                catch(e) { return {ok:false,error:String(e.message || 'Falha na operação')}; }
                """, arguments: ["command":command,"args":args], in: nil, in: followCheckWorld) { [weak self] result in
                    guard let self, generation == self.navigationGeneration else {
                        continuation.resume(throwing: NSError(domain: "FollowCheck", code: 2, userInfo: [NSLocalizedDescriptionKey: "A sessão mudou durante a operação."])); return
                    }
                    switch result {
                    case .failure(let error): continuation.resume(throwing: error)
                    case .success(let value):
                        let output = value as? [String: Any] ?? [:]
                        if output["ok"] as? Bool == true { continuation.resume(returning: output) }
                        else { continuation.resume(throwing: NSError(domain: "FollowCheck", code: 3, userInfo: [NSLocalizedDescriptionKey: output["error"] as? String ?? "A operação não foi confirmada."])) }
                    }
                }
        }
    }

    func control(_ command: String, args: [String: Any] = [:]) {
        guard let webView, !isAuthenticationURL(webView.url) else {
            model.controlCompleted(command, result: ["ok": false, "error": "Conclui primeiro a autenticação no Instagram."])
            return
        }
        let generation = navigationGeneration
        webView.callAsyncJavaScript("""
            if (!globalThis.__FOLLOWCHECK_IOS_CONTROL__) return {ok:false,error:'O motor ainda não está pronto.'};
            try { return await globalThis.__FOLLOWCHECK_IOS_CONTROL__(command, args); }
            catch(e) { return {ok:false,error:String(e.message || 'Falha na operação'),code:String(e.code || '')}; }
            """, arguments: ["command": command, "args": args], in: nil, in: followCheckWorld) { [weak self] result in
                guard let self, self.navigationGeneration == generation else { return }
                switch result {
                case .success(let value): self.model.controlCompleted(command, result: value as? [String: Any] ?? [:])
                case .failure: self.model.controlCompleted(command, result: ["ok": false, "error": "A operação foi interrompida pela navegação ou pelo sistema."])
                }
            }
    }

    func openSection(_ section: String) {
        guard let webView, !isAuthenticationURL(webView.url), !webView.isLoading else {
            model.isBusy = false; return
        }
        let request = UUID()
        panelRequest = request
        panelSection = section
        let generation = navigationGeneration
        shouldRestorePanel = true
        evaluateSequentially(files: ["keepalive-shim", "hardening", "followcheck", "ios-theme"], in: webView) { [weak self] result in
            guard let self, self.panelRequest == request, self.navigationGeneration == generation else { return }
            if case .failure = result { self.model.showError("Não foi possível abrir esta área."); return }
            webView.callAsyncJavaScript("""
                for (let i = 0; i < 30; i++) {
                    const r = await browser.tabs.sendMessage(1, {type:'FOLLOWCHECK_NATIVE_NAVIGATE',view:section});
                    if(r?.ok) return true;
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                return false;
                """, arguments: ["section": section], in: nil, in: self.followCheckWorld) { [weak self] result in
                    guard let self, self.panelRequest == request, self.navigationGeneration == generation else { return }
                    if case .success(let value) = result, value as? Bool == true { self.model.panelOpened() }
                    else { self.model.showError("A área não confirmou a abertura. Tenta novamente.") }
                }
        }
    }

    private func isAuthenticationURL(_ url: URL?) -> Bool {
        guard let url else { return true }
        let path = url.path.lowercased()
        return !isInstagramURL(url) || ["/accounts", "/challenge", "/checkpoint", "/two_factor", "/oauth"].contains { path == $0 || path.hasPrefix($0 + "/") }
    }

    private func addBootstrapScripts(to controller: WKUserContentController) {
        let scripts: [(String?, String, WKContentWorld)] = [
            (nil, "globalThis.__fcBridgeContext = 'bootstrap';", followCheckWorld),
            ("ios-polyfill", "", followCheckWorld),
            ("ios-policy", "", followCheckWorld),
            (nil, "globalThis.__fcBridgeContext = 'background';", followCheckWorld),
            ("background", "", followCheckWorld),
            (nil, "globalThis.__fcBridgeContext = 'content';", followCheckWorld),
            ("page-executor", "", .page),
            ("mobile-bridge", "", followCheckWorld),
            ("legacy-core", "", followCheckWorld),
        ]

        for (resource, inline, world) in scripts {
            let source: String
            if let resource {
                guard let loaded = script(named: resource) else { continue }
                source = loaded
            } else {
                source = inline
            }
            controller.addUserScript(WKUserScript(
                source: """
                if (location.protocol === 'https:' &&
                    (location.hostname === 'instagram.com' || location.hostname.endsWith('.instagram.com')) &&
                    !/^\\/(accounts|challenge|checkpoint|two_factor|oauth)(\\/|$)/i.test(location.pathname)) {
                \(source)
                }
                """,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true,
                in: world
            ))
        }
    }

    private func script(named name: String) -> String? {
        if name == "legacy-core" {
            guard let original = script(named: "followcheck"),
                  let boundary = original.range(of: "if(!window.location.hostname.endsWith", options: .backwards),
                  let bridge = script(named: "native-legacy") else { return nil }
            return String(original[..<boundary.lowerBound]) + bridge
        }
        guard let url = Bundle.main.url(forResource: name, withExtension: "js", subdirectory: "Extension") else {
            return nil
        }
        guard let source = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        if name == "background", let extensionURL = Bundle.main.url(forResource: "ios-engine", withExtension: "js", subdirectory: "Extension"),
           let integration = try? String(contentsOf: extensionURL, encoding: .utf8) {
            return source + "\n" + integration
        }
        return source
    }

    private func evaluateInFollowCheckWorld(
        _ source: String,
        completion: ((Any?, Error?) -> Void)? = nil
    ) {
        guard let webView else {
            completion?(nil, FollowCheckWebError.webViewUnavailable)
            return
        }
        webView.evaluateJavaScript(source, in: nil, in: followCheckWorld) { result in
            switch result {
            case .success(let value):
                completion?(value, nil)
            case .failure(let error):
                completion?(nil, error)
            }
        }
    }

    private func evaluateSequentially(
        files: [String],
        in webView: WKWebView,
        generation expectedGeneration: Int? = nil,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        let generation = expectedGeneration ?? navigationGeneration
        guard generation == navigationGeneration, !isAuthenticationURL(webView.url) else {
            completion(.failure(FollowCheckWebError.navigationChanged)); return
        }
        guard let first = files.first else {
            completion(.success(()))
            return
        }
        guard let source = script(named: first) else {
            completion(.failure(FollowCheckWebError.missingResource(first)))
            return
        }
        webView.evaluateJavaScript(source, in: nil, in: followCheckWorld) { [weak self] result in
            guard self != nil else { return }
            if case .failure(let error) = result {
                completion(.failure(error))
                return
            }
            self?.evaluateSequentially(files: Array(files.dropFirst()), in: webView, generation: generation, completion: completion)
        }
    }

    private func evaluateRequestedScripts(_ files: [String]) {
        let safeFiles = files.compactMap { raw -> String? in
            let name = URL(fileURLWithPath: raw).deletingPathExtension().lastPathComponent
            return ["keepalive-shim", "hardening", "followcheck", "mobile-bridge", "page-executor", "ios-theme"].contains(name) ? name : nil
        }
        guard let webView, !safeFiles.isEmpty, !isAuthenticationURL(webView.url) else { return }
        evaluateSequentially(files: safeFiles, in: webView) { [weak self] result in
            if case .success = result, safeFiles.contains("followcheck") {
                self?.model.panelOpened()
            }
        }
    }

    private func runManualCheckFromNativeRoute() {
        guard let webView, !webView.isLoading, !isAuthenticationURL(webView.url) else { return }
        model.scan()
    }

    private func isInstagramURL(_ url: URL?) -> Bool {
        guard url?.scheme?.lowercased() == "https", let host = url?.host?.lowercased() else { return false }
        return host == "instagram.com" || host.hasSuffix(".instagram.com")
    }

    private func scheduleNotification(title: String, body: String, identifier: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }
}

extension FollowCheckWebCoordinator: WKNavigationDelegate {
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        loadingTimeout?.cancel()
        model.isScanning = false
        model.pageFailed("O iOS interrompeu o conteúdo. O último resultado guardado mantém-se. Reabre a página para continuar.")
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation?) {
        loadingTimeout?.cancel()
        loadingTimeout = Task { [weak self] in
            try? await Task.sleep(for: .seconds(35))
            guard !Task.isCancelled, let self else { return }
            if self.model.phase == .loadingInstagram { self.model.pageFailed("O carregamento demorou demasiado. Verifica a ligação e volta a tentar.") }
        }
        profileReader?.cancel(); profileReader = nil
        navigationGeneration += 1
        mountingPanel = false
        model.panelClosed()
        model.pageStarted(url: webView.url)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
        loadingTimeout?.cancel()
        model.pageFinished(url: webView.url, canGoBack: webView.canGoBack)
        model.requiresAuthentication = isAuthenticationURL(webView.url)
        if model.requiresAuthentication {
            model.statusText = "Confirma a tua sessão"
            model.detailText = "Conclui o login ou a verificação do Instagram. O painel aguarda."
            model.record("Página de autenticação: painel suspenso.")
            model.screen = .instagram
        } else {
            control("state")
            // Native screens never mount the legacy web interface.
        }
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation?,
        withError error: Error
    ) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        model.pageFailed(error.localizedDescription)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation?, withError error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        model.pageFailed(error.localizedDescription)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url,
              let scheme = url.scheme?.lowercased(),
              scheme == "https" else {
            decisionHandler(.cancel)
            return
        }

        let host = url.host?.lowercased() ?? ""
        let staysInAuthenticationContext = host == "instagram.com"
            || host.hasSuffix(".instagram.com")
            || host == "facebook.com"
            || host.hasSuffix(".facebook.com")
        if staysInAuthenticationContext {
            decisionHandler(.allow)
        } else {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
        }
    }
}

extension FollowCheckWebCoordinator: WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard let url = navigationAction.request.url, url.scheme == "https" else { return nil }
        let host = url.host?.lowercased() ?? ""
        if isInstagramURL(url) || host == "facebook.com" || host.hasSuffix(".facebook.com") {
            webView.load(navigationAction.request)
        } else {
            UIApplication.shared.open(url)
        }
        return nil
    }
}

extension FollowCheckWebCoordinator: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, isInstagramURL(message.frameInfo.request.url), message.name == "followcheckIOS", let body = message.body as? [String: Any] else { return }
        model.updateFromBridge(body)
        guard let kind = body["kind"] as? String else { return }
        switch kind {
        case "executeScripts":
            evaluateRequestedScripts(body["files"] as? [String] ?? [])
        case "openExternal":
            if let value = body["url"] as? String, let url = URL(string: value), ["https", "http"].contains(url.scheme?.lowercased() ?? "") {
                if isInstagramURL(url) { model.screen = .instagram; webView?.load(URLRequest(url: url)) }
                else { UIApplication.shared.open(url) }
            }
        case "notification":
            let identifier = body["id"] as? String ?? UUID().uuidString
            scheduleNotification(
                title: body["title"] as? String ?? "FollowCheck",
                body: body["message"] as? String ?? "A Watchlist foi atualizada.",
                identifier: identifier
            )
        case "nativePort":
            if let payload = body["message"] as? [String: Any],
               payload["event"] as? String == "native_navigation" {
                let destination = payload["destination"] as? String ?? ""
                if destination == "monitor-run" { runManualCheckFromNativeRoute() }
                if destination == "account-manager" { openAccountSwitcher() }
                if destination == "session-check" {
                    evaluateInFollowCheckWorld("globalThis.__FOLLOWCHECK_IOS_NATIVE_RECEIVE__?.({ command: 'inspect_session' });")
                }
                if destination == "settings" {
                    if let settingsURL = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(settingsURL)
                    }
                }
                if destination == "home" { closeFollowCheck() }
            }
        default:
            break
        }
    }
}

extension FollowCheckWebCoordinator: WKScriptMessageHandlerWithReply {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard message.frameInfo.isMainFrame, isInstagramURL(message.frameInfo.request.url), message.name == "followcheckRPC", let body = message.body as? [String: Any] else {
            replyHandler(nil, "Pedido RPC inválido")
            return
        }
        let kind = body["kind"] as? String ?? ""
        let details = body["details"] as? [String: Any] ?? [:]
        switch kind {
        case "session.profile", "session.relations":
            let requestId = details["requestId"] as? String ?? ""
            let owner = details["accountId"] as? String ?? ""
            if details["operation"] as? String == "cancel" {
                if profileReader?.requestId == requestId { profileReader?.cancel(); profileReader = nil }
                replyHandler(["ok":true], nil); return
            }
            let username = details["username"] as? String ?? ""
            let expectedId = details["userId"] as? String ?? ""
            guard owner == model.accountId, !owner.isEmpty, username.range(of:"^[A-Za-z0-9._]{1,30}$",options:.regularExpression) != nil,
                  expectedId.isEmpty || expectedId.range(of:"^[0-9]{1,32}$",options:.regularExpression) != nil,
                  requestId.range(of:"^[A-Za-z0-9_-]{8,120}$",options:.regularExpression) != nil,
                  let host = webView, let container = host.superview, !isAuthenticationURL(host.url), profileReader == nil,
                  let readerSource = script(named:"profile-reader") else {
                replyHandler(["ok":false,"code":"profile_reader_unavailable","status":0],nil); return
            }
            let listKind=details["listKind"] as? String ?? ""
            let expectedCount=(details["expectedCount"] as? NSNumber)?.intValue ?? -1
            if kind == "session.relations" && (!["followers","following"].contains(listKind) || expectedId.isEmpty || expectedCount<0 || expectedCount>50000) {
                replyHandler(["ok":false,"code":"list_request_invalid","status":0],nil);return
            }
            var options:[String:Any] = ["goal":kind == "session.relations" ? "list":"profile","listKind":listKind,"expectedCount":expectedCount,"viewerUsername":details["viewerUsername"] as? String ?? ""]
            for key in ["pageDelayMinMs","pageDelayMaxMs","pauseEveryPages","pauseDurationMs"] {
                if let number=details[key] as? NSNumber {options[key]=min(300000,max(0,number.intValue))}
            }
            let generation = navigationGeneration
            let reader = RenderedProfileReader(requestId:requestId, dataStore:host.configuration.websiteDataStore)
            profileReader = reader
            reader.start(username:username, expectedId:expectedId, owner:owner, source:readerSource, options:options, in:container, behind:host, progress: { [weak self] value in
                guard let self, self.navigationGeneration == generation, self.model.accountId == owner,
                      let data=try? JSONSerialization.data(withJSONObject:value),let json=String(data:data,encoding:.utf8) else{return}
                self.evaluateInFollowCheckWorld("globalThis.__FOLLOWCHECK_IOS_RENDERED_PROGRESS__?.("+json+");")
            }) { [weak self, weak reader] result in
                guard let self else { replyHandler(["ok":false,"code":"ios_paused","status":0],nil); return }
                if self.profileReader === reader { self.profileReader = nil }
                guard owner == self.model.accountId, generation == self.navigationGeneration else {
                    replyHandler(["ok":false,"code":"instagram_account_changed","status":0],nil); return
                }
                replyHandler(result,nil)
            }
        case "archive.read":
            guard let id=details["id"] as? String,let file=archiveFiles[id],file.owner==model.accountId,file.generation==navigationGeneration,
                  let offset=details["offset"] as? Int,let count=details["count"] as? Int,offset>=0,count>=0,count<=1024*1024,offset<=file.size,count<=file.size-offset else {replyHandler(nil,"Leitura de arquivo expirada ou inválida.");return}
            do {let handle=try FileHandle(forReadingFrom:file.url);defer{try? handle.close()};try handle.seek(toOffset:UInt64(offset));let data=try handle.read(upToCount:count) ?? Data();replyHandler(["base64":data.base64EncodedString()],nil)}catch{replyHandler(nil,error.localizedDescription)}
        case "evidence.professional":
            let owner=details["accountId"] as? String ?? ""
            guard owner==model.accountId,!owner.isEmpty else{replyHandler(nil,"A conta mudou.");return}
            let generation=navigationGeneration
            Task {do {
                let operation=details["operation"] as? String ?? "read"
                let result:[String:Any]
                if operation=="config" {result=try await model.tools.request("integration",["operation":"config"])}
                else if operation=="select" {let patch=details["config"] as? [String:Any] ?? [:];let selection=patch.filter{["selectedAccountId","selectedProfileId"].contains($0.key)};result=try await model.tools.request("integration",["operation":"configure","config":selection])}
                else {
                    let path=details["path"] as? String ?? ""
                    guard (path=="/v1/accounts" || path.hasPrefix("/v1/accounts/") || path.hasPrefix("/v1/inbox/") || path.hasPrefix("/v1/analytics/")) else{replyHandler(nil,"Fonte de evidência não permitida.");return}
                    result=try await model.tools.professional(path,query:details["query"] as? [String:Any] ?? [:])
                }
                guard owner==model.accountId,generation==navigationGeneration else{replyHandler(nil,"A conta mudou.");return}
                replyHandler(result,nil)
            }catch{replyHandler(nil,error.localizedDescription)}}
        case "scripts.execute":
            guard let webView, !isAuthenticationURL(webView.url), let files = details["files"] as? [String], !files.isEmpty else {
                replyHandler(["ok": false, "error": "Scripts indisponíveis durante autenticação."], nil); return
            }
            let names = files.map { URL(fileURLWithPath: $0).deletingPathExtension().lastPathComponent }
            let allow = Set(["keepalive-shim", "hardening", "followcheck", "mobile-bridge", "page-executor", "ios-theme"])
            guard names.allSatisfy({ allow.contains($0) }) else {
                replyHandler(["ok": false, "error": "Recurso não permitido."], nil); return
            }
            if names == ["page-executor"], let source = script(named: "page-executor") {
                webView.evaluateJavaScript(source, in: nil, in: .page) { result in
                    if case .success = result { replyHandler(["ok": true], nil) }
                    else { replyHandler(["ok": false, "error": "Falha no executor da página."], nil) }
                }
            } else {
                guard !names.contains("page-executor") else { replyHandler(["ok": false], nil); return }
                evaluateSequentially(files: names + (names.contains("followcheck") ? ["ios-theme"] : []), in: webView) { result in
                    if case .success = result { replyHandler(["ok": true], nil) }
                    else { replyHandler(["ok": false, "error": "Falha ao carregar a área."], nil) }
                }
            }
        case "cookies.getAll":
            replyWithCookies(details: details, replyHandler: replyHandler)
        case "cookies.remove":
            removeCookie(details: details, replyHandler: replyHandler)
        default:
            replyHandler(["ok": false], nil)
        }
    }

    private func replyWithCookies(
        details: [String: Any],
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard let webView else {
            replyHandler(["cookies": []], nil)
            return
        }
        webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
            let requestedName = details["name"] as? String
            let requestedDomain = (details["domain"] as? String)?.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
            let requestedHost = (details["url"] as? String).flatMap(URL.init(string:))?.host?.lowercased()
            let filtered = cookies.filter { cookie in
                let domain = cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
                guard domain == "instagram.com" || domain.hasSuffix(".instagram.com") else { return false }
                if let requestedName, cookie.name != requestedName { return false }
                let cookieDomain = cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
                if let requestedDomain,
                   cookieDomain != requestedDomain,
                   !cookieDomain.hasSuffix(".\(requestedDomain)"),
                   !requestedDomain.hasSuffix(".\(cookieDomain)") { return false }
                if let requestedHost,
                   requestedHost != cookieDomain,
                   !requestedHost.hasSuffix(".\(cookieDomain)") { return false }
                return true
            }
            let values: [[String: Any]] = filtered.map { cookie in
                [
                    "name": cookie.name,
                    "value": cookie.value,
                    "domain": cookie.domain,
                    "path": cookie.path,
                    "secure": cookie.isSecure,
                    "httpOnly": cookie.properties?[HTTPCookiePropertyKey("HttpOnly")] != nil,
                    "session": cookie.expiresDate == nil,
                    "expirationDate": cookie.expiresDate?.timeIntervalSince1970 ?? 0,
                    "storeId": "ios-default",
                ]
            }
            replyHandler(["cookies": values], nil)
        }
    }

    private func removeCookie(
        details: [String: Any],
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        // Only Instagram's own explicit logout may alter authentication cookies.
        replyHandler(["ok": false, "code": "session_preserved", "removed": NSNull()], nil)
    }
}

private enum FollowCheckWebError: LocalizedError {
    case missingResource(String)
    case webViewUnavailable
    case navigationChanged

    var errorDescription: String? {
        switch self {
        case .missingResource(let name):
            return "Recurso em falta: \(name).js"
        case .navigationChanged:
            return "A navegação mudou durante a abertura."
        case .webViewUnavailable:
            return "O browser interno ainda não está disponível."
        }
    }
}


/// Owns one normal profile navigation. It shares WebKit storage with the main session.
@MainActor
private final class RenderedProfileReader: NSObject, WKNavigationDelegate {
    let requestId: String
    private let dataStore: WKWebsiteDataStore
    private var view: WKWebView?
    private var completion: (([String:Any]) -> Void)?
    private var deadline: Task<Void,Never>?
    private var polling: Task<Void,Never>?
    private var status = 0
    private var retryAfter = 0
    private var username = ""
    private var listKind = ""
    private var listMode = false
    private var lastProgressKey = ""
    private var last: [String:Any] = [:]
    private var started = Date()
    #if DEBUG
    var fixture = false
    #endif
    init(requestId:String, dataStore:WKWebsiteDataStore) { self.requestId=requestId;self.dataStore=dataStore }
    func start(username:String, expectedId:String, owner:String, source:String, options:[String:Any] = [:], in container:UIView, behind host:UIView, progress:(([String:Any])->Void)? = nil, completion:@escaping ([String:Any])->Void) {
        self.completion=completion;self.username=username;started=Date();listMode=options["goal"] as? String == "list";listKind=options["listKind"] as? String ?? ""
        let config=WKWebViewConfiguration();config.websiteDataStore=dataStore
        config.defaultWebpagePreferences.allowsContentJavaScript=true
        let values:[String:Any] = options.merging(["username":username,"userId":expectedId,"viewerId":owner]) { _,new in new }
        guard let encoded=try? JSONSerialization.data(withJSONObject:values),let json=String(data:encoded,encoding:.utf8),let url=URL(string:"https://www.instagram.com/\(username)/") else {finish(code:"watch_target_invalid");return}
        var prefix="globalThis.__FC_PROFILE_CONFIG__ = "+json+";\n"
        #if DEBUG
        if fixture {
            if listMode {prefix += #"globalThis.fetch=async(url)=>new Response(JSON.stringify(String(url).includes('friendships')?{users:(String(url).includes('max_id')?[]:[1,2,3]).map(id=>({pk:String(id),username:'person_'+id})),has_more:!String(url).includes('max_id')}:{data:{user:{id:'7',username:'watched',follower_count:4,following_count:0,followed_by_viewer:true}}}),{headers:{'content-type':'application/json'}});"#}
            else {prefix += "globalThis.fetch=async()=>new Response(JSON.stringify({data:{user:{id:'7',username:'watched',follower_count:1172,following_count:343}}}),{headers:{'content-type':'application/json'}});\n"}
        }
        #endif
        config.userContentController.addUserScript(WKUserScript(source:prefix+source,injectionTime:.atDocumentStart,forMainFrameOnly:true))
        let web=WKWebView(frame:host.frame,configuration:config);web.isUserInteractionEnabled=false
        web.accessibilityElementsHidden=true;web.navigationDelegate=self
        container.insertSubview(web,belowSubview:host);view=web
        #if DEBUG
        if fixture {
            let html=listMode ? #"<!doctype html><html><body><a href='/watched/followers/' onclick="event.preventDefault();const d=document.createElement('div');d.setAttribute('role','dialog');d.innerHTML=document.getElementById('rows').innerHTML;document.body.appendChild(d);fetch('/api/v1/friendships/7/followers/?count=25');">Followers</a><template id='rows'><div style='height:80px;overflow:auto' onscroll="if(!this.dataset.done){this.dataset.done='1';fetch('/api/v1/friendships/7/followers/?count=25&amp;max_id=next')}"><div style='height:400px'>Rows</div></div></template><script>setTimeout(()=>fetch('/graphql/query'),700)</script></body></html>"# : "<!doctype html><html><body><script>setTimeout(()=>fetch('/graphql/query'),700)</script></body></html>"
            web.loadSimulatedRequest(URLRequest(url:url),responseHTML:html)
        }
        else {web.load(URLRequest(url:url,cachePolicy:.reloadIgnoringLocalCacheData))}
        #else
        web.load(URLRequest(url:url,cachePolicy:.reloadIgnoringLocalCacheData))
        #endif
        deadline=Task { [weak self] in
            try? await Task.sleep(for:.seconds(self?.listMode == true ? 1200:25));guard !Task.isCancelled else{return}
            self?.finish(code:self?.listMode == true ? "list_render_incomplete":"profile_render_counts_missing")
        }
        polling=Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for:.milliseconds(350));guard !Task.isCancelled,let self,let web=self.view else{return}
                do {
                    let value=try await web.evaluateJavaScript("globalThis.__FC_PROFILE_READER__?.snapshot() || null")
                    guard self.completion != nil,let result=value as? [String:Any] else{continue}
                    self.last=result
                    if self.listMode {
                        let key="\(result["collected"] ?? 0):\(result["pages"] ?? 0)"
                        if key != self.lastProgressKey {
                            self.lastProgressKey=key
                            progress?(["requestId":self.requestId,"collected":result["collected"] ?? 0,"expected":result["expected"] ?? 0,"pages":result["pages"] ?? 0,"rawEntries":result["rawEntries"] ?? 0,"duplicateEntries":result["duplicateEntries"] ?? 0,"invalidEntries":result["invalidEntries"] ?? 0,"terminal":result["terminal"] ?? false,"pendingRequests":result["pendingRequests"] ?? 0,"viewerIncluded":result["viewerIncluded"] ?? false])
                        }
                    }
                    if result["ok"] as? Bool == true {self.finish(code:"");return}
                    let code=result["code"] as? String ?? ""
                    if !code.isEmpty && code != "profile_loading" {self.finish(code:code);return}
                } catch { if self.completion == nil{return} }
            }
        }
    }
    func cancel() {finish(code:"ios_paused")}
    private func finish(code:String) {
        guard let callback=completion else{return};completion=nil
        deadline?.cancel();polling?.cancel();deadline=nil;polling=nil
        view?.navigationDelegate=nil;view?.stopLoading();view?.removeFromSuperview();view=nil
        let ok=code.isEmpty && last["ok"] as? Bool == true
        let effectiveStatus = code == "rate_limited" ? 429 : status
        retryAfter = max(retryAfter, (last["retryAfter"] as? NSNumber)?.intValue ?? 0)
        let result:[String:Any] = ["ok":ok,"code":code,"status":effectiveStatus,"retryAfter":retryAfter,"executor":"rendered-profile-webkit","responseKind":listMode ? "rendered-list":"rendered-profile","data":ok ? (last["data"] ?? NSNull()) : NSNull(),
            "diagnostics":["requestId":requestId,"operation":listMode ? "relations-rendered":"profile-rendered","route":listMode ? "/:profile/:relations/":"/:profile/","method":"navigation","status":effectiveStatus,"mainNavigationStatus":status,"httpStatusKnown":effectiveStatus>0,"profileSource":last["source"] ?? "", "durationMs":Int(Date().timeIntervalSince(started)*1000),"observedResponses":last["responses"] ?? 0,"documentScripts":last["scripts"] ?? 0,"documentNodes":last["nodes"] ?? 0,"matchedProfiles":last["matched"] ?? 0,"retryAfterSeconds":retryAfter,"profileObjectPresent":ok,"listKind":listKind,"collected":last["collected"] ?? 0,"expected":last["expected"] ?? 0,"pages":last["pages"] ?? 0,"rawEntries":last["rawEntries"] ?? 0,"duplicateEntries":last["duplicateEntries"] ?? 0,"invalidEntries":last["invalidEntries"] ?? 0,"terminal":last["terminal"] ?? false,"pendingRequests":last["pendingRequests"] ?? 0,"viewerIncluded":last["viewerIncluded"] ?? false,"queryParameterNames":last["queryParameterNames"] ?? []]]
        callback(result)
    }
    func webView(_ webView:WKWebView,decidePolicyFor response:WKNavigationResponse,decisionHandler:@escaping (WKNavigationResponsePolicy)->Void) {
        if response.isForMainFrame,let http=response.response as? HTTPURLResponse {
            status=http.statusCode
            if let raw=http.value(forHTTPHeaderField:"Retry-After") {
                if let seconds=Int(raw) {retryAfter=max(0,seconds)}
                else {let formatter=DateFormatter();formatter.locale=Locale(identifier:"en_US_POSIX");formatter.timeZone=TimeZone(secondsFromGMT:0);formatter.dateFormat="EEE, dd MMM yyyy HH:mm:ss z";if let date=formatter.date(from:raw){retryAfter=max(0,Int(ceil(date.timeIntervalSinceNow)))}}
            }
            if status<200 || status>=300 {decisionHandler(.cancel);finish(code:status==429 ? "rate_limited" : "profile_navigation_rejected");return}
        }
        decisionHandler(.allow)
    }
    func webView(_ webView:WKWebView,decidePolicyFor action:WKNavigationAction,decisionHandler:@escaping (WKNavigationActionPolicy)->Void) {
        guard action.targetFrame?.isMainFrame != false else {decisionHandler(.cancel);return}
        guard let url=action.request.url,url.scheme=="https",["www.instagram.com","instagram.com"].contains(url.host?.lowercased() ?? "") else{decisionHandler(.cancel);return}
        let path=url.path.lowercased()
        if path.hasPrefix("/accounts/") || path.hasPrefix("/challenge/") || path.hasPrefix("/checkpoint/") {decisionHandler(.cancel);finish(code:"login_required");return}
        guard path=="/\(username.lowercased())/" || path=="/\(username.lowercased())" || listMode && ["/\(username.lowercased())/\(listKind)/","/\(username.lowercased())/\(listKind)"].contains(path) else{decisionHandler(.cancel);finish(code:"profile_navigation_changed");return}
        decisionHandler(.allow)
    }
    func webView(_ webView:WKWebView,didFailProvisionalNavigation navigation:WKNavigation?,withError error:Error) {if completion != nil{finish(code:"profile_navigation_failed")}}
    func webView(_ webView:WKWebView,didFail navigation:WKNavigation?,withError error:Error) {if completion != nil{finish(code:"profile_navigation_failed")}}
    func webViewWebContentProcessDidTerminate(_ webView:WKWebView) {finish(code:"profile_process_terminated")}
}
