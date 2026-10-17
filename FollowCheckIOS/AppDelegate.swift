import BackgroundTasks
import UIKit
import UserNotifications

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    static let refreshIdentifier = "ch.dannysantos.followcheck.ios.refresh"

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.refreshIdentifier, using: nil) { task in
            self.handleRefresh(task)
        }
        return true
    }

    static func cancelRefresh() {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: refreshIdentifier)
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["followcheck-refresh"])
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["followcheck-refresh"])
    }

    static func scheduleRefresh() {
        guard UserDefaults.standard.bool(forKey: "followcheck.reminders.enabled") else { return }
        let content = UNMutableNotificationContent()
        content.title = "O teu círculo está à tua espera"
        content.body = "Abre o FollowCheck para verificar alterações na tua conta."
        content.sound = .default
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 3600, repeats: false)
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "followcheck-refresh", content: content, trigger: trigger))
    }

    private func handleRefresh(_ task: BGTask) {
        guard let refreshTask = task as? BGAppRefreshTask else {
            task.setTaskCompleted(success: false)
            return
        }
        guard UserDefaults.standard.bool(forKey: "followcheck.reminders.enabled") else {
            refreshTask.setTaskCompleted(success: true)
            return
        }
        let completionLock = NSLock()
        var completed = false
        let complete: (Bool) -> Void = { success in
            completionLock.lock()
            defer { completionLock.unlock() }
            guard !completed else { return }
            completed = true
            refreshTask.setTaskCompleted(success: success)
        }
        Self.scheduleRefresh()
        refreshTask.expirationHandler = {
            complete(false)
        }

        let content = UNMutableNotificationContent()
        content.title = "FollowCheck pronto para atualizar"
        content.body = "Abre a app para executar o check com a sessão Instagram ativa."
        content.sound = .default
        let request = UNNotificationRequest(
            identifier: "followcheck-refresh",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request) { error in
            complete(error == nil)
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }
}

// A finite, user-initiated task. No audio/location keepalive or synthetic activity.
@MainActor final class CheckContinuation {
    static let shared = CheckContinuation()
    static let identifier = "ch.dannysantos.followcheck.ios.continue-check.*"
    private var submittedIdentifier: String?
    private var task: BGTask?
    private var requested = false
    private var expiration: (() -> Void)?
    var canContinue: Bool { task != nil }
    private func register(_ identifier: String) -> Bool {
        if #available(iOS 26.0, *) {
            return BGTaskScheduler.shared.register(forTaskWithIdentifier:identifier,using:.main) { task in
                Task { @MainActor in
                    guard self.requested, task.identifier == self.submittedIdentifier, let continued=task as? BGContinuedProcessingTask else {task.setTaskCompleted(success:false);return}
                    self.task=continued
                    continued.progress.totalUnitCount=100
                    continued.expirationHandler={ Task { @MainActor in
                        guard self.task === continued else{return}
                        self.expiration?()
                        self.finish(success:false)
                    }}
                }
            }
        }
        return false
    }
    func begin(title:String,expired:@escaping()->Void) {
        guard !requested else{return}
        expiration=expired
        if #available(iOS 26.0, *) {
            let identifier="ch.dannysantos.followcheck.ios.continue-check."+UUID().uuidString
            // Register the concrete job ID, not the Info.plist wildcard.
            // Never submit an identifier without a matching launch handler.
            guard register(identifier) else { expiration=nil;return }
            submittedIdentifier=identifier
            let request=BGContinuedProcessingTaskRequest(identifier:identifier,title:title,subtitle:"A verificar alterações")
            request.strategy = .fail
            requested=true
            do {try BGTaskScheduler.shared.submit(request)} catch {requested=false;submittedIdentifier=nil;expiration=nil}
        }
    }
    func progress(_ percentage:Double) {
        guard percentage.isFinite else {return}
        if #available(iOS 26.0, *),let task=task as? BGContinuedProcessingTask {
            task.progress.completedUnitCount=max(task.progress.completedUnitCount,Int64(min(99,max(0,percentage))))
        }
    }
    func finish(success:Bool) {
        task?.expirationHandler=nil
        task?.setTaskCompleted(success:success)
        task=nil
        if let identifier=submittedIdentifier {BGTaskScheduler.shared.cancel(taskRequestWithIdentifier:identifier)}
        submittedIdentifier=nil
        requested=false
        expiration=nil
    }
}
