from pathlib import Path
import subprocess,tempfile
source=Path('FollowCheckIOS/AppModel.swift').read_text()
a=source.index('    struct Relation: Identifiable {');b=source.index('    struct Conversation:',a)
model='import Foundation\nenum AppModel {\n'+source[a:b]+'\n}\n'
event_start=source.index('    struct WatchEvent: Identifiable {')
event_end=source.index('    var watchEvents:',event_start)
model=model.replace('\n}\n','\n'+source[event_start:event_end]+'\n}\n',1)
app=Path('FollowCheckIOS/FollowCheckApp.swift').read_text()
model+=app[app.index('enum CheckExecutionPolicy {'):app.index('@main')]
test='''
let outgoing=AppModel.Relation(["id":"1","following":true,"follows":false])
let incoming=AppModel.Relation(["id":"2","following":false,"follows":true])
let mutual=AppModel.Relation(["id":"3","following":true,"follows":true])
let neither=AppModel.Relation(["id":"4","following":false,"follows":false])
let people=[outgoing,incoming,mutual,neither]
assert(people.filter{$0.matches("Não me seguem")}.map(\\.id)==["1"])
assert(people.filter{$0.matches("Eu não sigo")}.map(\\.id)==["2"])
assert(people.filter{$0.matches("Mútuos")}.map(\\.id)==["3"])
assert(people.filter{$0.matches("Seguidores")}.map(\\.id)==["2","3"])
assert(people.filter{$0.matches("A seguir")}.map(\\.id)==["1","3"])
assert(people.filter{$0.canPerform("mute")}.map(\\.id)==["1","3"])
assert(people.filter{$0.canPerform("unfollow")}.map(\\.id)==["1","3"])
assert(people.filter{$0.canPerform("follow")}.map(\\.id)==["2","4"])
assert(people.filter{$0.canPerform("removeFollower")}.map(\\.id)==["2","3"])
assert(people.filter{$0.canPerform("disconnect")}.map(\\.id)==["3"])
assert(!outgoing.canPerform("unknown"))
print("PASS: 10 native relation filter/action assertions")
let event=AppModel.WatchEvent(["id":"change","targetId":"target","username":"changed","fullName":"Changed Person","profilePicUrl":"https://example.com/avatar.jpg"])
assert(event.username=="changed" && event.photoURL=="https://example.com/avatar.jpg")
for scope in ["account","watchlist"] {
 assert(CheckExecutionPolicy.keepsScreenOn(enabled:true,active:true,scope:scope))
 assert(!CheckExecutionPolicy.keepsScreenOn(enabled:false,active:true,scope:scope))
 assert(!CheckExecutionPolicy.keepsScreenOn(enabled:true,active:false,scope:scope))
}
for scope in ["","relationship","private-request","requests"] {
 assert(!CheckExecutionPolicy.keepsScreenOn(enabled:true,active:true,scope:scope))
}
for kind in ["watch_baseline","watch_check_queued","watch_check_failed",""] {
 assert(!AppModel.WatchEvent(["type":kind,"coverageVerified":true]).isWatchChange)
}
for kind in ["watch_new_follower","watch_lost_follower","watch_started_following","watch_stopped_following","watch_account_unavailable","watch_profile_change"] {
 assert(AppModel.WatchEvent(["type":kind,"coverageVerified":true]).isWatchChange)
}
print("PASS: watch event profile, change classification and check-only idle timer assertions")
'''
with tempfile.TemporaryDirectory() as d:
 p=Path(d)/'RelationsCheck.swift';p.write_text(model+test)
 subprocess.run(['swift',str(p)],check=True)

# Exercise the actual Swift save implementation with asynchronous bridge replies.
tools=Path('FollowCheckIOS/NativeTools.swift').read_text()
methods=tools[tools.index('    func save(_ name:'):tools.index('    func execute(')]
queue=tools[tools.index('        func persistQueue() async {'):tools.index('        var sent=0')]
store='''import Foundation
@MainActor final class Model { var accountId="42" }
@MainActor final class Store {
 let model=Model()
 var workspace:[String:Any]=[:]
 var durable:[String:Any]=[:]
 var busy=false
 var error:String?
 var writes:[String]=[]
 let batchID="test-queue",account="42",action="unfollow"
 var queueRows:[[String:Any]]=[]
 private var workspaceWrite:Task<Void,Never>?
 private var workspaceRevision=0
 var protectedIDs:Set<String> {Set(workspace["protected"] as? [String] ?? [])}
 var favorites:Set<String> {Set((workspace["tool-preferences"] as? [String:Any])?["favorites"] as? [String] ?? [])}
 func request(_ command:String,_ args:[String:Any]) async throws -> [String:Any] {
   let account=model.accountId
   for _ in 0..<10 { await Task.yield() }
   let name=args["name"] as! String
   durable[name]=args["value"];writes.append(name)
   return ["accountId":account,"workspace":durable]
 }
'''+methods+queue+'''
}
let store=await Store()
let first=Task { @MainActor in await store.protect("7") }
let second=Task { @MainActor in await store.protect("8") }
await first.value;await second.value
await MainActor.run {
 assert(store.protectedIDs==Set(["7","8"]))
 assert(Set(store.durable["protected"] as! [String])==Set(["7","8"]))
 assert(store.writes.count==2 && !store.busy)
}
let third=Task { @MainActor in await store.save("profile-meta",["7":"note"]) }
let fourth=Task { @MainActor in await store.favorite("history") }
await third.value;await fourth.value
await MainActor.run {
 assert(store.favorites.contains("history"))
 assert((store.workspace["profile-meta"] as? [String:String])?["7"]=="note")
 assert(store.writes.count==4)
}
await MainActor.run {store.error="Action not confirmed"}
await store.persistQueue()
await MainActor.run {
 assert(store.error=="Action not confirmed")
 assert(store.durable["operation-draft"] != nil)
}
print("PASS: queue persistence preserves operation failures")
print("PASS: overlapping native writes preserve both protections, metadata and favorites")
'''
with tempfile.TemporaryDirectory() as d:
 p=Path(d)/'WorkspaceCheck.swift';p.write_text(store)
 subprocess.run(['swift',str(p)],check=True)

# Exercise the actual continuation coordinator against an exact-ID scheduler.
continuation=Path('FollowCheckIOS/AppDelegate.swift').read_text().split('@MainActor final class CheckContinuation')[1]
fixture='''import Foundation
import Dispatch
class BGTask {
 let identifier:String
 var expirationHandler:(()->Void)?
 var completions:[Bool]=[]
 init(_ id:String){identifier=id}
 func setTaskCompleted(success:Bool){completions.append(success)}
}
class BGContinuedProcessingTask:BGTask {let progress=Progress(totalUnitCount:100)}
class BGContinuedProcessingTaskRequest {
 enum Strategy {case fail}
 let identifier:String
 var strategy=Strategy.fail
 init(identifier:String,title:String,subtitle:String){self.identifier=identifier}
}
@MainActor class BGTaskScheduler {
 static let shared=BGTaskScheduler()
 var handlers:[String:(BGTask)->Void]=[:]
 var submitted:[String]=[]
 var permits=true, fails=false
 func register(forTaskWithIdentifier id:String,using queue:DispatchQueue?,launchHandler:@escaping(BGTask)->Void)->Bool {
  assert(!id.contains("*"));assert(handlers[id]==nil)
  guard permits else{return false};handlers[id]=launchHandler;return true
 }
 func submit(_ request:BGContinuedProcessingTaskRequest)throws {
  assert(handlers[request.identifier] != nil)
  if fails {throw NSError(domain:"unavailable",code:1)}
  submitted.append(request.identifier)
 }
 func cancel(taskRequestWithIdentifier id:String){}
}
@MainActor final class CheckContinuation'''+continuation+'''
let runner=Task { @MainActor in
 let scheduler=BGTaskScheduler.shared,manager=CheckContinuation.shared
 scheduler.permits=false;manager.begin(title:"check",expired:{})
 assert(scheduler.submitted.isEmpty && !manager.canContinue)
 scheduler.permits=true;scheduler.fails=true;manager.begin(title:"check",expired:{})
 assert(scheduler.submitted.isEmpty && !manager.canContinue)
 scheduler.fails=false;manager.begin(title:"check",expired:{})
 manager.begin(title:"duplicate",expired:{})
 assert(scheduler.submitted.count==1)
 let id=scheduler.submitted[0],task=BGContinuedProcessingTask(scheduler.submitted[0])
 scheduler.handlers[id]!(task)
 for _ in 0..<10 {await Task.yield()}
 assert(manager.canContinue)
 manager.progress(.nan);manager.progress(.infinity);manager.progress(Double.greatestFiniteMagnitude)
 assert(task.progress.completedUnitCount==99)
 manager.finish(success:true);manager.finish(success:true)
 assert(task.completions==[true] && !manager.canContinue)
 manager.begin(title:"next",expired:{})
 assert(scheduler.submitted.count==2 && scheduler.submitted[1] != id)
 let stale=BGContinuedProcessingTask(id);scheduler.handlers[id]!(stale)
 for _ in 0..<10 {await Task.yield()}
 assert(stale.completions==[false] && !manager.canContinue)
 manager.finish(success:false)
 print("PASS: exact task registration, rejection, repeated taps, stale delivery and finite progress")
}
await runner.value
'''
with tempfile.TemporaryDirectory() as d:
 p=Path(d)/'ContinuationCheck.swift';p.write_text(fixture)
 subprocess.run(['swift',str(p)],check=True)

# Exercise the production export sanitizer and backward decoding of stored events.
def extract(start,end):
    return source[source.index(start):source.index(end,source.index(start))]
diagnostic = 'import Foundation\nenum AppModel {\n' + extract('    struct DiagnosticEvent:', '    struct Snapshot:') + extract('    nonisolated static func redact(', '    func record(') + extract('    static func diagnosticMetadata(', '    var diagnosticReport:') + '\n}\n'
diagnostic += r'''
let old = #"{"id":"old","date":0,"level":"info","message":"saved"}"#.data(using:.utf8)!
let event = try JSONDecoder().decode(AppModel.DiagnosticEvent.self,from:old)
assert(event.details == nil && event.message == "saved")
let raw:[String:Any] = ["meta":["coverage":["received":946,"expected":1172],"nested":["authorization":"private-secret","status":429]]]
let safe = AppModel.diagnosticMetadata(raw)
let data = try JSONSerialization.data(withJSONObject:safe,options:[.sortedKeys])
let text = String(data:data,encoding:.utf8)!
assert(!text.contains("private-secret") && text.contains("1172") && text.contains("429"))
print("PASS: native diagnostic metadata privacy and prior-log compatibility")
'''
with tempfile.TemporaryDirectory() as temp:
    path=Path(temp)/'diagnostics.swift';path.write_text(diagnostic)
    subprocess.run(['swift',str(path)],check=True)
