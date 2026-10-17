import SwiftUI

enum CheckExecutionPolicy {
    static func keepsScreenOn(enabled: Bool, active: Bool, scope: String) -> Bool {
        enabled && active && (scope == "account" || scope == "watchlist")
    }
}

@main
struct FollowCheckApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var model = AppModel()
    @AppStorage("followcheck.keepAwake") private var keepAwake = true
    @AppStorage("followcheck.appearance") private var appearance = "system"

    var body: some Scene {
        WindowGroup {
            RootView(model: model)
                .preferredColorScheme(appearance == "dark" ? .dark : appearance == "light" ? .light : nil)
                .onAppear { updateIdleTimer() }
                .onChange(of:keepAwake) { _,_ in updateIdleTimer() }
                .onChange(of:model.checkIsRunning) { _,_ in updateIdleTimer() }
                .onChange(of: scenePhase) { _, newPhase in
                    model.scenePhaseChanged(newPhase)
                    updateIdleTimer()
                }
        }
    }
    private func updateIdleTimer() {
        UIApplication.shared.isIdleTimerDisabled = CheckExecutionPolicy.keepsScreenOn(enabled:keepAwake,active:scenePhase == .active,scope:model.activeCheckScope)
    }
}
