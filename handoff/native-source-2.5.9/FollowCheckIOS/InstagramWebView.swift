import SwiftUI
import WebKit

struct InstagramWebView: UIViewRepresentable {
    let model: AppModel

    func makeCoordinator() -> FollowCheckWebCoordinator {
        FollowCheckWebCoordinator(model: model)
    }

    func makeUIView(context: Context) -> WKWebView {
        let webView = context.coordinator.makeWebView()
        model.attach(context.coordinator)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // Navigation and script lifecycle are owned by the coordinator.
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: FollowCheckWebCoordinator) {
        coordinator.tearDown()
    }
}
