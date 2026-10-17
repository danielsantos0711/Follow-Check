import test from 'node:test';

test('Action batch reserves the gaps between writes and releases the lane at its end',async()=>{
 const e=backupEnvironment();
 await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('relationshipBatch',{operation:'begin',batchId:'queue',accountId:'42'});
 await assert.rejects(e.ctx.__FOLLOWCHECK_IOS_CONTROL__('scan'),{code:'monitor_busy'});
 await assert.rejects(e.ctx.__FOLLOWCHECK_IOS_CONTROL__('relationshipBatch',{operation:'begin',batchId:'other',accountId:'42'}),{code:'monitor_busy'});
 await assert.rejects(e.ctx.__FOLLOWCHECK_IOS_CONTROL__('relationship',{action:'unfollow',targetId:'7'}),{code:'monitor_busy'});
 await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('relationshipBatch',{operation:'end',batchId:'other',accountId:'42'});
 await assert.rejects(e.ctx.__FOLLOWCHECK_IOS_CONTROL__('scan'),{code:'monitor_busy'});
 await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('relationshipBatch',{operation:'end',batchId:'queue',accountId:'42'});
 assert.equal(e.messages.findLast(m=>m.kind==='iosState').busy,false);
});
test('Background invalidates a batch token so foreground cannot continue old actions',async()=>{
 const e=backupEnvironment();
 await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('relationshipBatch',{operation:'begin',batchId:'queue',accountId:'42'});
 await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('lifecycle',{active:false});
 await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('lifecycle',{active:true});
 await assert.rejects(e.ctx.__FOLLOWCHECK_IOS_CONTROL__('relationship',{batchId:'queue',action:'unfollow',targetId:'7'}),{code:'ios_paused'});
 await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('relationshipBatch',{operation:'begin',batchId:'new',accountId:'42'});
});
test('Action batch suspends Watchlist once and only resumes after the whole queue',async()=>{
 const e=environment();const local=new Map();e.ctx.localStorage={getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v)};
 e.memory['followcheck:watchlist:registry:v2:42']={targets:[{id:'t',username:'tester',running:false,enabled:true,intervalMinutes:60}],events:[]};
 e.run(`globalThis.watchRuns=0;
 runNativeWatchlistScan=async()=>{watchRuns++;if(watchRuns===1){await new Promise(resolve=>document.addEventListener('followcheck:ios:cancel',resolve));__FOLLOWCHECK_IOS_ASSERT_ACTIVE__();}return {snapshot:{followers:1,following:1},changes:{}}};
 performInstagramRelationshipAction=async()=>({ok:true,verification:{state:{following:false}}});`);
 integrate(e);const watch=e.run('executeWatchlistTarget("42","t")');await microtasks();
 await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('relationshipBatch',{operation:'begin',batchId:'queue',accountId:'42'});await watch;
 for(const targetId of ['7','8']) {
   await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('relationship',{batchId:'queue',action:'unfollow',targetId});await microtasks();
   assert.equal(e.ctx.watchRuns,1);
 }
 await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('relationshipBatch',{operation:'end',batchId:'queue',accountId:'42'});await microtasks();
 for(let i=0;i<10 && e.ctx.watchRuns<2;i++) await microtasks();
 assert.equal(e.ctx.watchRuns,2);
 assert.equal(e.messages.filter(m=>m.kind==='accountDataChanged'&&m.accountId==='42').length,2);
});

test('Classic cleanup decisions retain both lists and stay account scoped',async()=>{
 const e=backupEnvironment();
 const value={following:{'7':'keep'},followers:{'9':'keep'}};
 await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('workspace',{accountId:'42',operation:'set',name:'cleanup-decisions',value});
 const saved=await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('workspace',{accountId:'42'});
 assert.deepEqual(JSON.parse(JSON.stringify(saved.workspace['cleanup-decisions'])),value);
 e.ctx.document.cookie='ds_user_id=43';
 await assert.rejects(e.ctx.__FOLLOWCHECK_IOS_CONTROL__('workspace',{accountId:'42',operation:'set',name:'cleanup-decisions',value:{}}),{code:'instagram_account_changed'});
 assert.deepEqual(JSON.parse(e.local.get('followcheck:v3:account:42:cleanup-decisions')).data,value);
});
test('Native activity publishes only saved complete snapshot changes with person identity',async()=>{
 const e=backupEnvironment();
 e.memory['followcheck:monitor:v1:42']={complete:true,completedAt:123456,followers:[],following:[],pendingChanges:{schemaVersion:2,newFollowers:[{id:'8',username:'new_person',full_name:'New Person',profile_pic_url:'https://example.com/a.jpg'}],lostFollowers:[],unavailableAccounts:[],reactivatedAccounts:[]}};
 await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('state',{});
 const event=e.messages.findLast(m=>m.kind==='accountActivity');
 assert.equal(event.accountId,'42');assert.equal(event.events.length,1);assert.equal(event.events[0].username,'new_person');assert.equal(event.events[0].type,'new_follower');
 e.messages.length=0;e.memory['followcheck:monitor:v1:42'].complete=false;
 await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('state',{});
 assert.equal(e.messages.some(m=>m.kind==='accountActivity'),false);
});

import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const base = new URL('../../FollowCheckIOS/Extension/', import.meta.url);
const source = name => fs.readFileSync(new URL(name, base), 'utf8');
function environment() {
  const memory = {'followcheck:global-safety:migration:v1':2};
  const messages = [], listeners = {}, timers = new Map();
  let timer = 0;
  const event = () => ({addListener(){},removeListener(){}});
  const ctx = vm.createContext({URL,URLSearchParams,AbortController,Response,Headers,TextEncoder,TextDecoder,
    structuredClone,Date,Promise,Map,Set,Uint8Array,ArrayBuffer,Blob,
    crypto:{randomUUID:()=>`test-${++timer}`}, performance:{now:()=>Date.now()},
    console:{log(){},info(){},debug(){},warn(){},error(){}},
    setTimeout:(fn,ms)=>{timers.set(++timer,{fn,ms}); return timer;},clearTimeout:id=>timers.delete(id),
    setInterval:(fn,ms)=>{timers.set(++timer,{fn,ms,repeat:true}); return timer;},clearInterval:id=>timers.delete(id),
    addEventListener:(name,fn)=>{(listeners[name] ||= []).push(fn);},
    document:{hidden:false,cookie:'ds_user_id=42',removeEventListener:(name,fn)=>{listeners[name]=(listeners[name]||[]).filter(item=>item!==fn);},addEventListener:(name,fn)=>{(listeners[name] ||= []).push(fn);},dispatchEvent:e=>{for(const fn of listeners[e.type]||[]) fn(e);}},
    CustomEvent:class {constructor(type,options={}){this.type=type;this.detail=options.detail;}},
    location:new URL('https://www.instagram.com/'),
    webkit:{messageHandlers:{followcheckIOS:{postMessage:v=>messages.push(v)}}},
    fetch:async()=>{throw new Error('Unexpected network access');},
    chrome:{
      runtime:{onMessage:event(),onConnect:event(),connectNative:()=>({postMessage:v=>messages.push(v),onMessage:event(),onDisconnect:event()})},
      notifications:{onClicked:event()},
      tabs:{query:async()=>[{id:1,url:'https://www.instagram.com/'}],sendMessage:async()=>null},
      cookies:{getAll:async()=>[],get:async()=>null},
      alarms:{clear:async()=>true,onAlarm:event()},
      action:{onClicked:event()},
      storage:{local:{get:async keys=>{
        if(keys==null) return structuredClone(memory);
        const list=typeof keys==='string'?[keys]:Array.isArray(keys)?keys:Object.keys(keys);
        return Object.fromEntries(list.filter(k=>k in memory).map(k=>[k,structuredClone(memory[k])]));
      },set:async v=>Object.assign(memory,structuredClone(v)),remove:async keys=>{for(const k of Array.isArray(keys)?keys:[keys]) delete memory[k];}},onChanged:event()},
    },__FOLLOWCHECK_IOS_SHELL__:true,
  });
  ctx.browser=ctx.chrome;
  vm.runInContext(source('ios-policy.js'),ctx);
  vm.runInContext(source('background.js'),ctx);
  // Test traffic is replaced at the transport boundary, never sent to Instagram.
  vm.runInContext(`
    inspectInstagramSessionForNative = async()=>{};
    requestNativeSnapshot = async()=>{};
    watchlistOwnerId = async()=> '42';
    postMonitorProgress = ()=>{}; postMonitorStopped = ()=>{}; postMonitorDiagnostic=()=>{};
    monitorSleep=async()=>{};
  `,ctx);
  return {ctx,memory,messages,timers,listeners,run:code=>vm.runInContext(code,ctx)};
}
function integrate(e) { vm.runInContext(source('ios-engine.js'),e.ctx); }
const microtasks = async()=>{for(let i=0;i<25;i++) await Promise.resolve();};

test('Single-flight reserves before preflight; duplicate request shares one execution',async()=>{
 const e=environment(); let calls=0,release;
 e.ctx.work=()=>{calls++;return new Promise(r=>release=r);};
 e.run('const queue = new FollowCheckPolicy.SingleFlight(); globalThis.first=queue.run("a",work); globalThis.second=queue.run("a",work)');
 await microtasks(); assert.equal(calls,1); assert.equal(e.ctx.first,e.ctx.second);
 await assert.rejects(e.run('queue.run("b",work)'),{code:'monitor_busy'});
 release(7); assert.equal(await e.ctx.first,7);
 assert.equal(await e.run('queue.run("b",()=>8)'),8);
});
test('Failure releases single-flight reservation',async()=>{
 const e=environment();e.run('globalThis.q=new FollowCheckPolicy.SingleFlight()');
 await assert.rejects(e.run('q.run("a",()=>{throw Error("failure")})'));
 assert.equal(await e.run('q.run("b",()=>9)'),9);
});
test('Account scan and Watchlist share a global lane before async checks',async()=>{
 const e=environment(); let release;
 e.ctx.hold=()=>new Promise(r=>release=r);
 e.run('runNativeMonitorScan=async()=>hold(); runNativeWatchlistScan=async()=>99'); integrate(e);
 const scan=e.run('runNativeMonitorScan({accountId:"42"})');await microtasks();
 await assert.rejects(e.run('runNativeWatchlistScan({accountId:"42",targetId:"99"})'),{code:'monitor_busy'});
 release(1);await scan;
 assert.equal(await e.run('runNativeWatchlistScan({accountId:"42",targetId:"99"})'),99);
});
test('Background resume cannot commit the old scan generation',async()=>{
 const e=environment();let release;e.ctx.hold=()=>new Promise(r=>release=r);
 e.run('runNativeMonitorScan=async()=>{await hold(); globalThis.__FOLLOWCHECK_IOS_ASSERT_ACTIVE__(); return 1;}');integrate(e);
 const scan=e.run('runNativeMonitorScan({accountId:"42"})');await microtasks();
 await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('lifecycle',{active:false});
 await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('lifecycle',{active:true});release();
 await assert.rejects(scan,{code:'check_preempted'});
});
test('Switching account stops the existing scan before commit',async()=>{
 const e=environment();let release;e.ctx.hold=()=>new Promise(r=>release=r);
 e.run('runNativeMonitorScan=async()=>{await hold(); globalThis.__FOLLOWCHECK_IOS_ASSERT_ACTIVE__();}');integrate(e);
 const scan=e.run('runNativeMonitorScan({accountId:"42"})');await microtasks();e.ctx.document.cookie='ds_user_id=43';release();
 await assert.rejects(scan,{code:'ios_paused'});
});
test('Background fetch stops and aborts in-flight Instagram request',async()=>{
 const e=environment();let aborted=false;
 e.ctx.fetch=async(_,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(Object.assign(Error('aborted'),{name:'AbortError'}));}));
 integrate(e);const request=e.ctx.fetch('https://www.instagram.com/api/v1/test');
 await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('lifecycle',{active:false});
 await assert.rejects(request,{name:'AbortError'});assert.equal(aborted,true);
 await assert.rejects(e.ctx.fetch('https://www.instagram.com/api/v1/test'),{code:'ios_paused'});
});
test('Persisted interrupted Watchlist recovers without discarding baseline',async()=>{
 const e=environment();e.memory['followcheck:watchlist:registry:v2:42']={version:2,targets:[{id:'t',username:'test',running:true,enabled:true,intervalMinutes:60,baselineReady:true,followers:10}],events:[]};
 integrate(e);await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('state');
 const t=e.memory['followcheck:watchlist:registry:v2:42'].targets[0];
 assert.equal(t.running,false);assert.equal(t.baselineReady,true);assert.equal(t.followers,10);assert.equal(t.lastErrorCode,'interrupted');
});
test('Retry-After accepts seconds and HTTP dates',()=>{
 const e=environment();assert.equal(e.run('retryAfterSeconds("120")'),120);
 e.ctx.future=new Date(Date.now()+60_000).toUTCString();
 assert.ok(e.run('retryAfterSeconds(future)')>=59);assert.equal(e.run('retryAfterSeconds("invalid")'),0);
});
test('429 trips a durable cooldown; a security challenge requires manual confirmation',async()=>{
 const e=environment();await e.run('tripSafetyFromError({code:"rate_limited",retryAfterSeconds:100000},"test")');
 let s=e.memory['followcheck:global-safety:v1'];assert.equal(s.blocked,true);assert.equal(s.manualResetRequired,false);assert.ok(s.cooldownUntil>Date.now()+99_000_000);
 await e.run('tripSafetyFromError({code:"challenge_required"},"test")');s=e.memory['followcheck:global-safety:v1'];assert.equal(s.manualResetRequired,true);
});
test('Logs retain simultaneous events and redact secrets',async()=>{
 const e=environment();await e.run('Promise.all(Array.from({length:25},(_,i)=>backgroundLog("info","test","entry",`event-${i} sessionid=secret-token`)))');
 const logs=e.memory['followcheck:technical-logs:background:v1'];assert.equal(logs.length,25);assert.ok(logs.every(x=>!x.message.includes('secret-token')));
});
test('Policy redacts URLs, tokens and password values',()=>{
 const e=environment();const v=e.ctx.FollowCheckPolicy.sanitizeText('https://example.com/?token=abc Bearer secret123 password=private');
 assert.ok(!v.includes('example.com'));assert.ok(!v.includes('secret123'));assert.ok(!v.includes('private'));
});
test('Scheduler selects only the oldest enabled, idle, due target',()=>{
 const e=environment();const chosen=e.ctx.FollowCheckPolicy.dueTarget([{id:'off',enabled:false,nextRunAt:1},{id:'busy',enabled:true,running:true,nextRunAt:2},{id:'future',enabled:true,nextRunAt:200},{id:'oldest',enabled:true,nextRunAt:3},{id:'later',enabled:true,nextRunAt:4}],100);
 assert.equal(chosen.id,'oldest');
});
test('Android impersonation transport is rejected before network access on iOS',async()=>{
 const e=environment();await assert.rejects(e.run('executeInstagramRequest("mobile-session","/api/v1/test",{})'),{code:'unsupported_transport'});
 await assert.rejects(e.run('executeInstagramRelationshipRequest("mobile-session","unfollow","99",{})'),{code:'unsupported_transport'});
});
function scanEnvironment() {
 const e=environment();e.run(`
   recoverCommittedOwnMonitorResult=async()=>null;
   resolveMonitorPacing=async()=>({...DEFAULT_MONITOR_PACING});
   assertGlobalSafety=async()=>{}; assertGlobalScanBudget=async()=>{};
   resolveMonitorInstagramSession=async()=>({sessionId:'fixture-only',userId:'42',username:'tester',tabId:1});
   rememberLastInstagramSessionState=async(value)=>value;
   monitorClassifyFollowerDelta=async()=>({newFollowers:[],lostFollowers:[],reactivated:[],unavailable:[]});
   sendAudienceToPage=async()=>({ok:true,dispatched:true});
 `);return e;
}
test('Failed second list cannot replace the last complete snapshot',async()=>{
 const e=scanEnvironment();e.memory['followcheck:monitor:v1:42']={complete:true,followers:[{id:'old'}],following:[],completedAt:1};
 e.run('monitorCollectList=async(kind)=>{if(kind==="followers") throw monitorFailure("partial","pagination_incomplete");return {users:[{id:"new"}]};}');
 await assert.rejects(e.run('runNativeMonitorScan({accountId:"42",checkId:"check-1"})'),{code:'pagination_incomplete'});
 assert.equal(e.memory['followcheck:monitor:v1:42'].followers[0].id,'old');assert.equal(e.memory['followcheck:monitor:v1:42'].completedAt,1);
});
test('Full scan commits durable audience and confirms one successful result',async()=>{
 const e=scanEnvironment();e.run('monitorCollectList=async(kind)=>({users:kind==="followers"?[{id:"1"},{id:"2"}]:[{id:"1"},{id:"3"}],transport:"main",pages:1,expected:2});');
 const result=await e.run('runNativeMonitorScan({accountId:"42",checkId:"check-2"})');
 assert.equal(result.snapshot.followers,2);assert.equal(result.snapshot.following,2);assert.equal(result.snapshot.mutuals,1);assert.equal(result.snapshot.nonFollowers,1);
 const stored=e.memory['followcheck:monitor:v1:42'];assert.equal(stored.complete,true);assert.equal(stored.pendingDelivery,false);assert.equal(stored.audience.length,3);
 assert.equal(e.messages.filter(x=>x.event==='monitor_result').length,1);
});
test('Unacknowledged audience remains recoverable and never emits success',async()=>{
 const e=scanEnvironment();e.run('monitorCollectList=async()=>({users:[{id:"1"}],pages:1});sendAudienceToPage=async()=>({ok:false});');
 await assert.rejects(e.run('runNativeMonitorScan({accountId:"42",checkId:"check-3"})'),{code:'audience_reconciliation_failed'});
 assert.equal(e.memory['followcheck:monitor:v1:42'].pendingDelivery,true);assert.equal(e.messages.filter(x=>x.event==='monitor_result').length,0);
});
test('Repeated pagination cursor stops collection instead of looping',async()=>{
 const e=environment();e.run('monitorFetchPage=async()=>({users:[{id:"1"}],expected:10,hasNext:true,cursor:"same"});');
 await assert.rejects(e.run('monitorCollectList("followers","42","p",0,100)'),{code:'pagination_incomplete'});
});
test('Truncated result is rejected even if the server ends pagination',async()=>{
 const e=environment();e.run('monitorFetchPage=async()=>({users:[{id:"1"}],expected:100,hasNext:false,cursor:null});');
 await assert.rejects(e.run('monitorCollectList("followers","42","p",0,100)'),{code:'pagination_incomplete'});
});
test('Absent account during authentication cannot trigger native control scan',async()=>{
 const e=environment();integrate(e);e.ctx.location=new URL('https://www.instagram.com/accounts/login/');
 await assert.rejects(e.ctx.__FOLLOWCHECK_IOS_CONTROL__('scan'),{code:'ios_paused'});
});

test('Manual confirmation cannot erase an active cooldown',async()=>{
 const e=environment();integrate(e);e.memory['followcheck:global-safety:v1']={cooldownUntil:Date.now()+60_000,manualResetRequired:false};
 await assert.rejects(e.ctx.__FOLLOWCHECK_IOS_CONTROL__('confirmSession'),{code:'cooldown_active'});
 assert.ok(e.memory['followcheck:global-safety:v1'].cooldownUntil>Date.now());
});
test('Manual confirmation fails when session evidence is missing',async()=>{
 const e=environment();integrate(e);e.run('resolveMonitorInstagramSession=async()=>({userId:"",sessionId:""})');
 await assert.rejects(e.ctx.__FOLLOWCHECK_IOS_CONTROL__('confirmSession'),{code:'session_unverified'});
});
test('Pause setting survives a fresh engine instance',async()=>{
 const e=environment();integrate(e);await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('pause',{paused:true});
 const second=environment();second.memory['followcheck:ios:scheduler:v1']=e.memory['followcheck:ios:scheduler:v1'];integrate(second);await microtasks();
 await assert.rejects(second.ctx.__FOLLOWCHECK_IOS_CONTROL__('scan'),{code:'ios_paused'});
});
function pageEnvironment(fetch) {
 const e=environment();e.ctx.fetch=fetch;
 e.ctx.document.documentElement={dataset:{}};e.ctx.document.body={innerText:''};e.ctx.document.querySelector=()=>null;
 vm.runInContext(source('page-executor.js'),e.ctx);
 return {...e,request:async message=>{
   const id='request-123456'; let response;
   e.ctx.document.addEventListener('followcheck:page-executor:response:v1',event=>{const value=JSON.parse(event.detail);if(value.requestId===id) response=value;});
   await e.listeners['followcheck:page-executor:request:v1'][0]({detail:JSON.stringify({requestId:id,...message})});
   return response;
 }};
}
test('Session probe is local-only: no identity network request',async()=>{
 let requests=0;const e=pageEnvironment(async()=>{requests++;});
 const response=await e.request({operation:'probe-session'});
 assert.equal(response.bridgeOk,true);assert.equal(response.result.user.userId,'42');assert.equal(requests,0);
});
test('A visible security warning stops profile lookup before a request',async()=>{
 let requests=0;const e=pageEnvironment(async()=>{requests++;});e.ctx.document.body.innerText='We suspect automated behavior';
 const response=await e.request({operation:'profile-info',username:'tester'});
 assert.equal(response.result.ok,false);assert.equal(response.result.securityWarning,true);assert.equal(requests,0);
});
test('HTML with HTTP 200 is not accepted as a followers list',async()=>{
 const e=pageEnvironment(async()=>new Response('<html>login</html>',{status:200,headers:{'content-type':'text/html'}}));
 const response=await e.request({operation:'monitor-list',kind:'followers',userId:'42'});
 assert.equal(response.result.responseKind,'html-document');assert.equal(response.result.ok,false);
});
test('Page executor preserves Retry-After for rate-limited responses',async()=>{
 const e=pageEnvironment(async()=>new Response('{"status":"fail"}',{status:429,headers:{'content-type':'application/json','retry-after':'200000'}}));
 const response=await e.request({operation:'monitor-list',kind:'followers',userId:'42'});
 assert.equal(response.result.retryAfter,200000);assert.equal(response.result.ok,false);
});
test('Hidden document cannot issue a page-executor list request',async()=>{
 let requests=0;const e=pageEnvironment(async()=>{requests++;});e.ctx.document.hidden=true;
 const response=await e.request({operation:'monitor-list',kind:'followers',userId:'42'});
 assert.equal(response.bridgeOk,false);assert.equal(response.error.code,'ios_paused');assert.equal(requests,0);
});
test('Unknown page operations are rejected',async()=>{
 const e=pageEnvironment(async()=>{throw Error('network forbidden');});
 const response=await e.request({operation:'unrestricted-fetch',url:'https://example.com'});
 assert.equal(response.bridgeOk,false);assert.equal(response.error.code,'followcheck_page_request_rejected');
});
function polyfill() {
 const e=environment();e.ctx.indexedDB={open:()=>({})};
 e.ctx.queueMicrotask=queueMicrotask;
 e.ctx.webkit.messageHandlers.followcheckRPC={postMessage:async()=>({ok:true})};
 vm.runInContext(source('ios-polyfill.js'),e.ctx);return e;
}
test('Polyfill dispatch reaches background listeners and awaits their result',async()=>{
 const e=polyfill();e.run('__fcBridgeContext="background";browser.runtime.onMessage.addListener(async m=>({value:m.value+1}));');
 const response=await e.ctx.browser.runtime.sendMessage({value:4});assert.equal(response.value,5);
});
test('Polyfill failed script execution does not report success',async()=>{
 const e=polyfill();e.ctx.webkit.messageHandlers.followcheckRPC.postMessage=async()=>({ok:false,error:'not mounted'});
 await assert.rejects(e.ctx.chrome.scripting.executeScript({files:['followcheck.js']}),/not mounted/);
});
test('Polyfill rejects listener exceptions instead of silently continuing',async()=>{
 const e=polyfill();e.run('__fcBridgeContext="background";browser.runtime.onMessage.addListener(()=>{throw Error("listener failed")});');
 await assert.rejects(e.ctx.browser.runtime.sendMessage({}),/listener failed/);
});
test('Polyfill clears callback deadline after asynchronous response',async()=>{
 const e=polyfill();e.run('__fcBridgeContext="background";browser.runtime.onMessage.addListener((m,s,reply)=>{queueMicrotask(()=>reply({ok:true}));return true;});');
 const result=await e.ctx.browser.runtime.sendMessage({});assert.equal(result.ok,true);
 assert.ok(![...e.timers.values()].some(t=>t.ms===130000));
});

test('A small incomplete list cannot be promoted to a complete snapshot',async()=>{
 const e=environment();e.run('monitorFetchPage=async()=>({users:[],expected:3,hasNext:false,cursor:null});');
 await assert.rejects(e.run('monitorCollectList("followers","42","p",0,100)'),{code:'pagination_incomplete'});
});
test('Persisted pause applies to the very first command without a warm-up',async()=>{
 const e=environment();e.memory['followcheck:ios:scheduler:v1']={paused:true,enabled:false};integrate(e);
 await assert.rejects(e.ctx.__FOLLOWCHECK_IOS_CONTROL__('scan'),{code:'ios_paused'});
});
test('Clearing logs waits for queued writes so removed events do not reappear',async()=>{
 const e=environment();integrate(e);
 const writes=e.run('Promise.all(Array.from({length:10},(_,i)=>backgroundLog("info","test","event",String(i))))');
 await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('clearLogs');await writes;
 const result=await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('logs');assert.equal(result.logs.filter(entry=>entry.source==='test').length,0);
});

test('iOS identity hydration stays local even when forced',async()=>{
 const e=environment();let network=0;e.ctx.network=()=>{network++;throw Error('Unexpected profile request');};
 e.run('requestInstagramMainPage=network');
 await e.run('rememberLastInstagramSessionState({userId:"42",username:"cached",profilePicUrl:"avatar"})');
 const value=await e.run('hydrateInstagramSessionIdentity({userId:"42"},1,{force:true})');
 assert.equal(value.username,'cached');assert.equal(network,0);
});
test('Switching accounts cannot inherit the prior account name or avatar',async()=>{
 const e=environment();await e.run('rememberLastInstagramSessionState({userId:"42",username:"old",fullName:"Old",profilePicUrl:"old-avatar"})');
 const value=await e.run('rememberLastInstagramSessionState({userId:"43"})');
 assert.equal(value.userId,'43');assert.equal(value.username,'');assert.equal(value.fullName,'');assert.equal(value.profilePicUrl,'');
});
test('Forget-account on iOS preserves cookies and stored snapshots',async()=>{
 const e=environment();let removed=0;e.ctx.chrome.cookies.remove=async()=>{removed++;};e.memory.savedSnapshot={complete:true};
 const result=await e.run('forgetCurrentInstagramAccount({tab:{id:1}})');
 assert.equal(result.ok,false);assert.equal(result.code,'session_preserved');assert.equal(removed,0);assert.equal(e.memory.savedSnapshot.complete,true);
});
test('An absent session refuses work before invoking the operation',async()=>{
 const e=environment();let work=0;e.ctx.work=()=>{work++;};e.run('runNativeMonitorScan=work');integrate(e);e.ctx.document.cookie='';
 await assert.rejects(e.run('runNativeMonitorScan({accountId:"42"})'),{code:'session_unverified'});assert.equal(work,0);
});
test('A stale account request cannot run inside another account session',async()=>{
 const e=environment();let work=0;e.ctx.work=()=>{work++;};e.run('runNativeMonitorScan=work');integrate(e);
 await assert.rejects(e.run('runNativeMonitorScan({accountId:"43"})'),{code:'instagram_account_changed'});assert.equal(work,0);
});
test('Polyfill refuses cookie deletion without contacting the native store',async()=>{
 const e=polyfill();let calls=0;e.ctx.webkit.messageHandlers.followcheckRPC.postMessage=async()=>{calls++;};
 await assert.rejects(e.ctx.chrome.cookies.remove({name:'sessionid'}),{code:'session_preserved'});assert.equal(calls,0);
});

test('iOS migration preserves a clean installation without inventing a security incident',async()=>{
 const e=environment(); await microtasks();
 delete e.memory['followcheck:global-safety:migration:v1'];
 const state=await e.run('ensureGlobalSafetyMigration()');
 assert.equal(state.blocked,false);
});
test('iOS migration preserves an actual existing safety stop',async()=>{
 const e=environment(); await microtasks();
 await e.run('tripGlobalSafety("challenge_required","Confirmar conta")');
 delete e.memory['followcheck:global-safety:migration:v1'];
 const state=await e.run('ensureGlobalSafetyMigration()');
 assert.equal(state.blocked,true);assert.equal(state.reason,'challenge_required');
});
test('Native relations distinguishes no saved snapshot from an empty complete list',async()=>{
 const e=environment();integrate(e);
 let result=await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('relations');
 assert.equal(result.ready,false);
 e.memory['followcheck:monitor:v1:42']={complete:true,completedAt:Date.now(),followers:[],following:[]};
 result=await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('relations');
 assert.equal(result.ready,true);assert.equal(result.accounts.length,0);
});
test('Native relations derives mutuals and cannot expose another account snapshot',async()=>{
 const e=environment();integrate(e);
 e.memory['followcheck:monitor:v1:42']={complete:true,completedAt:Date.now(),followers:[{id:'7',username:'alpha'}],following:[{id:'7',username:'alpha'},{id:'8',username:'beta'}]};
 const result=await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('relations');
 assert.equal(result.accounts.length,2);assert.equal(result.accounts[0].follows,true);assert.equal(result.accounts[1].follows,false);
 e.ctx.document.cookie='ds_user_id=43';
 assert.equal((await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('relations')).ready,false);
});
test('Successful confirmation clears the local upgrade pause and publishes unblocked state',async()=>{
 const e=environment();integrate(e);
 await e.run('tripGlobalSafety("upgrade_safety_hold","Pausa local")');
 e.run('resolveMonitorInstagramSession=async()=>({userId:"42",sessionId:"test-local"})');
 assert.equal((await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('confirmSession')).ok,true);
 assert.equal((await e.run('readGlobalSafetyState()')).blocked,false);
 assert.equal(e.messages.filter(m=>m.kind==='iosState').at(-1).safety.blocked,false);
});
test('Native Inbox is blocked before any read during a security pause',async()=>{
 const e=environment();integrate(e);
 await e.run('tripGlobalSafety("challenge_required","Confirmar")');
 await assert.rejects(e.ctx.__FOLLOWCHECK_IOS_CONTROL__('inbox'),{code:'safety_blocked'});
});
test('Native Inbox returns account scoped data and rejects account changes during read',async()=>{
 const e=environment();let release;
 e.ctx.hold=()=>new Promise(r=>release=r);
 e.run('performInstagramPrivateRequest=async()=>{await hold(); return {ok:true,data:{inbox:{threads:[]}}};}');integrate(e);
 const reading=e.ctx.__FOLLOWCHECK_IOS_CONTROL__('inbox');await microtasks();
 e.ctx.document.cookie='ds_user_id=43';release();
 await assert.rejects(reading,{code:'instagram_account_changed'});
});
test('Pausing own analysis does not pause a Watchlist scan',async()=>{
 const e=environment();e.run('runNativeWatchlistScan=async()=>({complete:true})');integrate(e);
 await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('pause',{paused:true});
 assert.equal((await e.run('runNativeWatchlistScan({accountId:"42"})')).complete,true);
 await assert.rejects(e.ctx.__FOLLOWCHECK_IOS_CONTROL__('scan'),{code:'ios_paused'});
});
test('Watchlist ignores only a verified app migration hold, never an Instagram incident',async()=>{
 const e=environment();
 e.memory['followcheck:global-safety:v1']={manualResetRequired:true,reason:'upgrade_safety_hold',source:'upgrade-migration',cooldownUntil:0};
 assert.equal((await e.run('assertGlobalSafety("watchlist-check")')).blocked,false);
 await assert.rejects(e.run('assertGlobalSafety("own-account-scan")'));
 e.memory['followcheck:global-safety:v1'].source='instagram-response';
 await assert.rejects(e.run('assertGlobalSafety("watchlist-check")'));
});
test('Stored Watchlist reads remain available with own analysis paused',async()=>{
 const e=environment();e.run('handleWatchlistCommand=async()=>({ok:true,list:{accounts:[]}})');integrate(e);
 await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('pause',{paused:true});
 assert.equal((await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('watchlist',{action:'list'})).ok,true);
});
test('Native workspace preserves existing v3 data and unrelated records',async()=>{
 const e=environment(),data=new Map();e.ctx.localStorage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
 data.set('followcheck:v3:account:42:profile-meta',JSON.stringify({version:3,data:{'7':{notes:'Original',tags:['VIP']}}}));
 integrate(e);let result=await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('workspace',{accountId:'42'});
 assert.equal(result.workspace['profile-meta']['7'].notes,'Original');
 await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('workspace',{accountId:'42',operation:'set',name:'protected',value:['7']});
 result=await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('workspace',{accountId:'42'});
 assert.equal(result.workspace['profile-meta']['7'].tags[0],'VIP');assert.equal(result.workspace.protected[0],'7');
});
test('Stale native workspace writes cannot copy data into a different account',async()=>{
 const e=environment();e.ctx.localStorage={getItem:()=>null,setItem:()=>{throw Error('Must not write');}};integrate(e);
 await assert.rejects(e.ctx.__FOLLOWCHECK_IOS_CONTROL__('workspace',{accountId:'99',operation:'set',name:'protected',value:['7']}),{code:'instagram_account_changed'});
});
test('Protected profile refuses a native relationship mutation before transport',async()=>{
 const e=environment();e.ctx.localStorage={getItem:()=>JSON.stringify({version:3,data:['7']})};integrate(e);
 await assert.rejects(e.ctx.__FOLLOWCHECK_IOS_CONTROL__('relationship',{accountId:'42',action:'unfollow',targetId:'7'}),{code:'protected_profile'});
});
test('Follow requests rejects HTML without turning it into an empty list',async()=>{
 const e=environment();e.ctx.fetch=async()=>new Response('<html>login</html>',{status:200,headers:{'content-type':'text/html'}});integrate(e);
 await assert.rejects(e.ctx.__FOLLOWCHECK_IOS_CONTROL__('requests',{accountId:'42',kind:'outgoing'}),{code:'requests_unavailable'});
});

function backupEnvironment() {
 const e=environment();const local=new Map();
 e.ctx.localStorage={getItem:k=>local.get(k)??null,setItem:(k,v)=>local.set(k,v)};
 e.memory['followcheck:monitor:v1:42']={complete:true,completedAt:123,followers:[{id:'7'}],following:[]};
 e.memory['zernio:config']={apiKey:'never-export'};
 e.memory['followcheck:monitor:v1:99']={complete:true,completedAt:124,followers:[],following:[]};
 local.set('followcheck:v3:account:42:protected',JSON.stringify({version:3,data:['7']}));
 integrate(e);return {...e,local};
}
test('Backup exports own scans and metadata without integration secrets or other accounts',async()=>{
 const e=backupEnvironment();const out=await e.run('__FOLLOWCHECK_IOS_CONTROL__("backup",{accountId:"42"})');
 assert.equal(out.backup.storage['followcheck:monitor:v1:42'].completedAt,123);
 assert.equal(out.backup.storage['zernio:config'],undefined);
 assert.equal(out.backup.storage['followcheck:monitor:v1:99'],undefined);
 assert.ok(out.backup.local['followcheck:v3:account:42:protected']);
});
test('Backup restores missing scan and refuses to overwrite a newer existing scan',async()=>{
 const e=backupEnvironment();const out=await e.run('__FOLLOWCHECK_IOS_CONTROL__("backup",{accountId:"42"})');e.ctx.saved=out.backup;
 delete e.memory['followcheck:monitor:v1:42'];
 await e.run('__FOLLOWCHECK_IOS_CONTROL__("backup",{operation:"restore",accountId:"42",backup:saved})');
 assert.equal(e.memory['followcheck:monitor:v1:42'].completedAt,123);
 e.memory['followcheck:monitor:v1:42'].completedAt=999;
 await e.run('__FOLLOWCHECK_IOS_CONTROL__("backup",{operation:"restore",accountId:"42",backup:saved})');
 assert.equal(e.memory['followcheck:monitor:v1:42'].completedAt,999);
});
test('Backup rejects other accounts and unapproved storage keys before writing',async()=>{
 const e=backupEnvironment();const out=await e.run('__FOLLOWCHECK_IOS_CONTROL__("backup",{accountId:"42"})');e.ctx.saved=out.backup;e.ctx.saved.accountId='99';
 await assert.rejects(e.run('__FOLLOWCHECK_IOS_CONTROL__("backup",{operation:"restore",accountId:"42",backup:saved})'),{code:'backup_invalid'});
 e.ctx.saved.accountId='42';e.ctx.saved.storage['zernio:config']={apiKey:'invalid'};
 await assert.rejects(e.run('__FOLLOWCHECK_IOS_CONTROL__("backup",{operation:"restore",accountId:"42",backup:saved})'),{code:'backup_invalid'});
 assert.equal(e.memory['zernio:config'].apiKey,'never-export');
});
test('Ambiguous relationship mutation can be confirmed by matching profile without repeating POST',async()=>{
 const calls=[];const e=pageEnvironment(async(url,options)=>{calls.push([url,options.method]);return String(url).includes('web_profile_info')?new Response(JSON.stringify({data:{user:{id:'7',followed_by_viewer:false,follows_viewer:false}}}),{headers:{'content-type':'application/json'}}):new Response('<html>unexpected</html>',{headers:{'content-type':'text/html'}});});
 e.ctx.document.cookie='ds_user_id=42; csrftoken=test';
 const out=await e.request({operation:'relationship',action:'unfollow',targetId:'7',username:'tester'});
 assert.equal(out.result.ok,true);assert.equal(calls.filter(([,m])=>m==='POST').length,1);
});
test('Profile verification cannot confirm a different target or an explicit opposite state',async()=>{
 const e=pageEnvironment(async url=>String(url).includes('web_profile_info')?new Response(JSON.stringify({data:{user:{id:'8',followed_by_viewer:false}}}),{headers:{'content-type':'application/json'}}):new Response(JSON.stringify({status:'ok',friendship_status:{following:true}}),{headers:{'content-type':'application/json'}}));
 e.ctx.document.cookie='ds_user_id=42; csrftoken=test';
 const out=await e.request({operation:'relationship',action:'unfollow',targetId:'7',username:'tester'});
 assert.equal(out.result.ok,false);
});

test('iOS Watchlist ignores own configured gap and never extends it',async()=>{
 const e=environment();const now=Date.now();e.memory['followcheck:global-scan-budget:v1']={lastCompletedAt:now,lastTask:'own-account'};
 await e.run('assertGlobalScanBudget("watchlist",{globalGapMinutes:60,manualRespectsGap:true},true)');
 await e.run('commitGlobalScanBudget("watchlist",Date.now()+5000,{globalGapMinutes:60})');
 assert.equal(e.memory['followcheck:global-scan-budget:v1'].lastCompletedAt,now);
 await assert.rejects(e.run('assertGlobalScanBudget("own-account",{globalGapMinutes:60,manualRespectsGap:true},true)'),{code:'configured_pacing_active'});
});
test('Own and Watchlist pacing use independent persisted settings',async()=>{
 const e=environment();integrate(e);
 await e.run('__FOLLOWCHECK_IOS_CONTROL__("pacing",{own:{pageDelayMinMs:7000,pageDelayMaxMs:7000,globalGapMinutes:120},watchlist:{pageDelayMinMs:3000,pageDelayMaxMs:3000,globalGapMinutes:999}})');
 const own=await e.run('resolveMonitorPacing()');const watch=await e.run('resolveMonitorPacing({},"watchlist")');
 assert.equal(own.pageDelayMinMs,7000);assert.equal(own.globalGapMinutes,120);assert.equal(watch.pageDelayMinMs,3000);assert.equal(watch.globalGapMinutes,0);
});
test('Valid JSON relationship verification ends reconciliation without an extra profile request',async()=>{
 let calls=0;const e=pageEnvironment(async()=>{calls++;return calls===1?new Response('<html>unexpected</html>',{headers:{'content-type':'text/html'}}):new Response('{"status":"ok","friendship_status":{"following":true}}',{headers:{'content-type':'application/json'}});});
 e.ctx.document.cookie='ds_user_id=42; csrftoken=test';
 const out=await e.request({operation:'relationship',action:'unfollow',targetId:'7',username:'tester'});
 assert.equal(out.result.ok,false);assert.equal(calls,2);
});

test('Local cooldown duration is configurable and can be ended without clearing a security hold',async()=>{
 const e=environment();integrate(e);
 await e.run('__FOLLOWCHECK_IOS_CONTROL__("cooldown",{minutes:5})');
 const before=Date.now();await e.run('tripGlobalSafety("rate_limited","wait",{manualResetRequired:false})');
 assert.ok(e.memory['followcheck:global-safety:v1'].cooldownUntil<=before+301000);
 await e.run('__FOLLOWCHECK_IOS_CONTROL__("cooldown",{minutes:5,release:true})');
 assert.equal((await e.run('readGlobalSafetyState()')).blocked,false);
 await e.run('tripGlobalSafety("challenge_required","verify",{manualResetRequired:true})');
 await e.run('__FOLLOWCHECK_IOS_CONTROL__("cooldown",{minutes:5,release:true})');
 assert.equal((await e.run('readGlobalSafetyState()')).manualResetRequired,true);
});
test('Local cooldown controls preserve a server deadline and reject invalid durations',async()=>{
 const e=environment();integrate(e);const until=Date.now()+3600000;e.ctx.until=until;
 await e.run('tripGlobalSafety("rate_limited","wait",{manualResetRequired:false,serverCooldownUntil:until})');
 await e.run('__FOLLOWCHECK_IOS_CONTROL__("cooldown",{minutes:1,release:true})');
 const state=await e.run('readGlobalSafetyState()');assert.equal(state.cooldownUntil,until);assert.equal(state.blocked,true);
 await assert.rejects(e.run('__FOLLOWCHECK_IOS_CONTROL__("cooldown",{minutes:-1})'),{code:'invalid_setting'});
});

test('Empty JSON cannot falsely confirm a relationship mutation',async()=>{
 const e=pageEnvironment(async()=>new Response('{}',{headers:{'content-type':'application/json'}}));
 e.ctx.document.cookie='ds_user_id=42; csrftoken=test';
 const out=await e.request({operation:'relationship',action:'unfollow',targetId:'7'});
 assert.equal(out.result.ok,false);
});
test('Explicit access rejection stops relationship transport without a verification request',async()=>{
 let calls=0;const e=pageEnvironment(async()=>{calls++;return new Response('{}',{status:403,headers:{'content-type':'application/json'}});});
 e.ctx.document.cookie='ds_user_id=42; csrftoken=test';
 const out=await e.request({operation:'relationship',action:'unfollow',targetId:'7'});
 assert.equal(out.result.ok,false);assert.equal(calls,1);
});

test('Loaded Instagram client performs one mutation and final state confirms the result',async()=>{
 const calls=[];let writes=0;
 const e=pageEnvironment(async(url,options)=>{calls.push(options.method);return new Response('{"status":"ok","following":false,"outgoing_request":false}',{headers:{'content-type':'application/json'}});});
 e.ctx.document.cookie='ds_user_id=42; csrftoken=test';
 e.ctx.require=name=>name==='PolarisInstapi'?{apiPost:async(endpoint,options)=>{writes++;assert.equal(endpoint,'/api/v1/friendships/destroy/7/');assert.equal(options.body.container_module,'profile');return {data:{status:'ok'}};}}:null;
 const out=await e.request({operation:'relationship',action:'unfollow',targetId:'7'});
 assert.equal(writes,1);assert.deepEqual(calls,['GET']);assert.equal(out.result.ok,true);assert.equal(out.result.confirmedBy,'relationship-state');assert.equal(out.result.attempts[0].transport,'instagram-web-client');assert.equal(out.result.attempts[0].status,0);
});
test('Client acknowledgment cannot confirm unchanged state or trigger a second write',async()=>{
 let writes=0;const calls=[];
 const e=pageEnvironment(async(url,options)=>{calls.push(options.method);return new Response('{"status":"ok","following":true}',{headers:{'content-type':'application/json'}});});
 e.ctx.document.cookie='ds_user_id=42; csrftoken=test';e.ctx.require=name=>name==='PolarisInstapi'?{apiPost:async()=>{writes++;return {data:{status:'ok'}};}}:null;
 const out=await e.request({operation:'relationship',action:'unfollow',targetId:'7'});
 assert.equal(out.result.ok,false);assert.equal(writes,1);assert.deepEqual(calls,['GET']);
});
test('Rejected client write never retries through raw fetch',async()=>{
 let writes=0,reads=0;const e=pageEnvironment(async()=>{reads++;throw Error('Unexpected fallback');});
 e.ctx.document.cookie='ds_user_id=42; csrftoken=test';e.ctx.require=name=>name==='PolarisInstapi'?{apiPost:async()=>{writes++;throw {statusCode:403,responseObject:{status:'fail'}};}}:null;
 const out=await e.request({operation:'relationship',action:'unfollow',targetId:'7'});
 assert.equal(out.result.ok,false);assert.equal(out.result.status,403);assert.equal(writes,1);assert.equal(reads,0);
});
test('Cancelling client mutation aborts its handle and performs no verification',async()=>{
 let aborted=0,reads=0;const e=pageEnvironment(async()=>{reads++;throw Error('Unexpected read');});
 e.ctx.document.cookie='ds_user_id=42; csrftoken=test';e.ctx.require=name=>name==='PolarisInstapi'?{apiPost:(_,__,hooks)=>{hooks.before({abort:()=>aborted++});return new Promise(()=>{});}}:null;
 const pending=e.request({operation:'relationship',action:'unfollow',targetId:'7'});await microtasks();
 for(const fn of e.listeners['followcheck:ios:cancel']||[])fn();
 const out=await pending;assert.equal(out.bridgeOk,false);assert.equal(out.error.code,'aborted');assert.equal(aborted,1);assert.equal(reads,0);
});

test('Watchlist validation preserves HTTP failure and cooldown metadata',async()=>{
 const e=environment();e.run('requestInstagramMainPage=async()=>({ok:false,status:429,responseKind:"html-document",retryAfter:120})');
 await assert.rejects(e.run('resolveWatchlistTarget({targetUsername:"tester"})'),error=>error.code==='rate_limited'&&error.retryAfterSeconds===120&&error.message.includes('429'));
});
test('Watchlist failure emits terminal progress and preserves its completed baseline',async()=>{
 const e=environment();e.memory['followcheck:watchlist:registry:v2:42']={version:2,targets:[{id:'t',username:'tester',running:false,enabled:true,intervalMinutes:60,baselineReady:true,followers:10}],events:[]};
 e.run('runNativeWatchlistScan=async()=>{throw monitorFailure("Perfil indisponível","watch_target_unavailable")};postMonitorStopped=(...args)=>{globalThis.stopped=args}');
 await e.run('executeWatchlistTarget("42","t")');
 const t=e.memory['followcheck:watchlist:registry:v2:42'].targets[0];assert.equal(t.running,false);assert.equal(t.baselineReady,true);assert.equal(t.followers,10);assert.equal(e.ctx.stopped[3],'error');
});
test('Released watchlist lane publishes idle state after a failed scan',async()=>{
 const e=environment();e.run('runNativeWatchlistScan=async()=>{throw Error("failed")}');integrate(e);
 await assert.rejects(e.run('runNativeWatchlistScan({accountId:"42",targetId:"t"})'));await microtasks();
 assert.ok(e.messages.some(m=>m.kind==='iosState'&&m.busy===false));
});

test('Confirmed unfollow reconciles local audience, photos and counts without changing full scan time',async()=>{
 const e=backupEnvironment();e.local.set('followcheck:v3:account:42:protected','{"data":[]}');
 e.memory['followcheck:monitor:v1:42']={complete:true,completedAt:123,followers:[{id:'7',username:'tester',profile_pic_url:'https://example.com/photo.jpg'}],following:[{id:'7',username:'tester'}],pendingNativeResult:{event:'monitor_result',snapshot:{following:99}}};
 e.run('performInstagramRelationshipAction=async()=>({ok:true,verification:{state:{following:false,followedBy:true}}})');
 await e.run('__FOLLOWCHECK_IOS_CONTROL__("relationship",{action:"unfollow",targetId:"7",username:"tester"})');
 const stored=e.memory['followcheck:monitor:v1:42'];assert.equal(stored.following.length,0);assert.equal(stored.followers.length,1);assert.equal(stored.completedAt,123);assert.equal(stored.pendingNativeResult,undefined);
 const relations=await e.run('__FOLLOWCHECK_IOS_CONTROL__("relations",{})');assert.equal(relations.accounts[0].following,false);assert.equal(relations.accounts[0].follows,true);
});
test('Failed action preserves the complete baseline',async()=>{
 const e=backupEnvironment();e.local.set('followcheck:v3:account:42:protected','{"data":[]}');
 const before=JSON.stringify(e.memory['followcheck:monitor:v1:42']);e.run('performInstagramRelationshipAction=async()=>({ok:false,status:429})');
 await assert.rejects(e.run('__FOLLOWCHECK_IOS_CONTROL__("relationship",{action:"unfollow",targetId:"7"})'));
 assert.equal(JSON.stringify(e.memory['followcheck:monitor:v1:42']),before);
});
test('Pending follow is not added to following and relations preserve photos',async()=>{
 const e=backupEnvironment();e.local.set('followcheck:v3:account:42:protected','{"data":[]}');
 e.memory['followcheck:monitor:v1:42'].followers[0].profile_pic_url='https://example.com/avatar.jpg';
 e.run('performInstagramRelationshipAction=async()=>({ok:true,verification:{state:{following:false,outgoingRequest:true}}})');
 await e.run('__FOLLOWCHECK_IOS_CONTROL__("relationship",{action:"follow",targetId:"7"})');
 const result=await e.run('__FOLLOWCHECK_IOS_CONTROL__("relations",{})');assert.equal(result.accounts[0].photoURL,'https://example.com/avatar.jpg');assert.equal(result.accounts[0].following,false);
});
test('Inbox accepts an empty nested list but rejects an unknown successful response',async()=>{
 const e=backupEnvironment();e.run('performInstagramPrivateRequest=async()=>({ok:true,data:{data:{inbox:{threads:[]}}}})');
 const result=await e.run('__FOLLOWCHECK_IOS_CONTROL__("inbox",{})');assert.equal(result.data.inbox.threads.length,0);
 e.run('performInstagramPrivateRequest=async()=>({ok:true,data:{status:"ok"}})');
 await assert.rejects(e.run('__FOLLOWCHECK_IOS_CONTROL__("inbox",{})'),err=>err.code==='inbox_response_invalid');
});
test('Watchlist reuses identity from own complete audience without profile lookup',async()=>{
 const e=environment();e.memory['followcheck:monitor:v1:42']={complete:true,completedAt:123,followers:[{id:'7',username:'tester'}],following:[]};
 e.run('monitorTransportViewerUserId="42";requestInstagramMainPage=async()=>{throw Error("Redundant profile request")}');
 const result=await e.run('resolveWatchlistTarget({targetUsername:"tester"})');assert.equal(result.id,'7');assert.equal(result.identitySource,'cached-own-audience');
});

test('Interrupted list resumes at next cursor without publishing partial data',async()=>{
 const e=environment();e.run(`globalThis.pages=[];monitorFetchPage=async(kind,transport,id,cursor)=>{pages.push(cursor);return cursor ? {users:[{id:'2'}],expected:2,hasNext:false,cursor:null} : {users:[{id:'1'}],expected:2,hasNext:true,cursor:'next'}};monitorSleep=async()=>{throw monitorFailure('Switch','check_preempted')}`);
 await assert.rejects(e.run('monitorCollectList("followers","7","watchlist:42",0,100,"42")'));
 assert.equal(e.memory['followcheck:monitor:v1:42'],undefined);
 e.run('monitorSleep=async()=>{}');
 const result=await e.run('monitorCollectList("followers","7","watchlist:42",0,100,"42")');
 assert.equal(result.users.length,2);assert.deepEqual(Array.from(e.ctx.pages),[null,'next']);
});
test('Checkpoint identity is isolated by viewer and target',async()=>{
 const e=environment();e.run(`monitorFetchPage=async()=>({users:[{id:'1'}],expected:2,hasNext:true,cursor:'next'});monitorSleep=async()=>{throw monitorFailure('Switch','check_preempted')}`);
 await assert.rejects(e.run('monitorCollectList("followers","7","watchlist:42",0,100,"42")'));
 e.run(`monitorFetchPage=async(kind,transport,id,cursor)=>{if(cursor!==null)throw Error('Cross-account cursor');return {users:[{id:'9'}],expected:1,hasNext:false,cursor:null}};monitorSleep=async()=>{}`);
 const result=await e.run('monitorCollectList("followers","7","watchlist:99",0,100,"99")');assert.equal(result.users[0].id,'9');
});
test('Own check preempts Watchlist and resumes it after completion',async()=>{
 const e=environment();e.memory['followcheck:watchlist:registry:v2:42']={targets:[{id:'t',username:'tester',running:false,enabled:true,intervalMinutes:60}],events:[]};
 e.run(`globalThis.watchRuns=0;globalThis.ownRuns=0;resolveMonitorInstagramSession=async()=>({userId:'42',sessionId:'local',username:'owner'});
 runNativeWatchlistScan=async()=>{watchRuns++;if(watchRuns===1){await new Promise(resolve=>document.addEventListener('followcheck:ios:cancel',resolve));__FOLLOWCHECK_IOS_ASSERT_ACTIVE__();}return {snapshot:{followers:1,following:1},changes:{}}};
 runNativeMonitorScan=async()=>{ownRuns++;return {checkId:'own'}}`);
 integrate(e);const watch=e.run('executeWatchlistTarget("42","t")');await microtasks();
 const own=await e.run('__FOLLOWCHECK_IOS_CONTROL__("scan",{})');await watch;await microtasks();
 assert.equal(own.ok,true);assert.equal(e.ctx.ownRuns,1);assert.equal(e.ctx.watchRuns,2);
});
test('Inbox 404 is route unavailability, not an account safety hold',async()=>{
 const e=backupEnvironment();e.run('performInstagramPrivateRequest=async()=>({ok:false,status:404,responseKind:"html-document"})');
 await assert.rejects(e.run('__FOLLOWCHECK_IOS_CONTROL__("inbox",{})'),err=>err.code==='inbox_route_unavailable');
 const safety=await e.run('readGlobalSafetyState()');assert.equal(safety.blocked,false);
});
test('Watchlist events preserve the identity and photo of the changed profile',()=>{
 const e=environment();const item=e.run('watchlistEvent({id:"target",username:"watched"},"new_follower","Novo seguidor","Mudança",{id:"7",username:"changed",full_name:"Changed Person",profile_pic_url:"https://example.com/photo.jpg"},123)');
 assert.equal(item.username,'changed');assert.equal(item.targetUsername,'watched');assert.equal(item.profilePicUrl,'https://example.com/photo.jpg');
});

test('Cancel clears the suspended check instead of restarting it',async()=>{
 const e=environment();e.memory['followcheck:watchlist:registry:v2:42']={targets:[{id:'t',username:'tester',running:false,enabled:true,intervalMinutes:60}],events:[]};
 e.run(`globalThis.watchRuns=0;globalThis.ownStarted=false;resolveMonitorInstagramSession=async()=>({userId:'42',sessionId:'local'});
 runNativeWatchlistScan=async()=>{watchRuns++;await new Promise(resolve=>document.addEventListener('followcheck:ios:cancel',resolve));__FOLLOWCHECK_IOS_ASSERT_ACTIVE__();};
 runNativeMonitorScan=async()=>{ownStarted=true;await new Promise(resolve=>document.addEventListener('followcheck:ios:cancel',resolve));__FOLLOWCHECK_IOS_ASSERT_ACTIVE__();return {checkId:'own'}}`);
 integrate(e);const watch=e.run('executeWatchlistTarget("42","t")');await microtasks();
 const own=e.run('__FOLLOWCHECK_IOS_CONTROL__("scan",{})');const rejected=assert.rejects(own);await watch;await microtasks();assert.equal(e.ctx.ownStarted,true);
 await e.run('__FOLLOWCHECK_IOS_CONTROL__("cancelCurrent",{})');await rejected;await microtasks();assert.equal(e.ctx.watchRuns,1);
});
test('Watchlist can take priority from own scan and own scan resumes once',async()=>{
 const e=environment();e.memory['followcheck:watchlist:registry:v2:42']={targets:[{id:'t',username:'tester',running:false,enabled:true,intervalMinutes:60}],events:[]};
 e.run(`globalThis.ownRuns=0;globalThis.watchRuns=0;resolveMonitorInstagramSession=async()=>({userId:'42',sessionId:'local'});
 runNativeMonitorScan=async()=>{ownRuns++;if(ownRuns===1){await new Promise(resolve=>document.addEventListener('followcheck:ios:cancel',resolve));__FOLLOWCHECK_IOS_ASSERT_ACTIVE__();}return {checkId:'own'}};
 runNativeWatchlistScan=async()=>{watchRuns++;return {snapshot:{followers:1,following:1},changes:{}}}`);
 integrate(e);const own=e.run('__FOLLOWCHECK_IOS_CONTROL__("scan",{})');await microtasks();
 const request=await e.run('__FOLLOWCHECK_IOS_CONTROL__("watchlist",{action:"run",targetId:"t"})');assert.equal(request.ok,true);assert.equal((await own).suspended,true);
 for(const [key,timer] of e.timers) if(timer.ms===50){e.timers.delete(key);timer.fn();}
 for(let i=0;i<5;i++)await microtasks();
 assert.equal(e.ctx.watchRuns,1);assert.equal(e.ctx.ownRuns,2);
});

test('Cancel during a priority handoff prevents the new check from starting',async()=>{
 const e=environment();e.memory['followcheck:watchlist:registry:v2:42']={targets:[{id:'t',username:'tester',running:false,enabled:true,intervalMinutes:60}],events:[]};
 e.run(`globalThis.ownRuns=0;resolveMonitorInstagramSession=async()=>({userId:'42',sessionId:'local'});
 runNativeWatchlistScan=async()=>{await new Promise(resolve=>globalThis.releaseOldCheck=resolve);__FOLLOWCHECK_IOS_ASSERT_ACTIVE__();};
 runNativeMonitorScan=async()=>{ownRuns++;return {checkId:'own'}}`);
 integrate(e);const watch=e.run('executeWatchlistTarget("42","t")');await microtasks();
 const own=e.run('__FOLLOWCHECK_IOS_CONTROL__("scan",{})');const rejected=assert.rejects(own,err=>err.code==='ios_paused');await microtasks();
 await e.run('__FOLLOWCHECK_IOS_CONTROL__("cancelCurrent",{})');e.ctx.releaseOldCheck();await watch;await rejected;await microtasks();assert.equal(e.ctx.ownRuns,0);
});

test('A check that completes during handoff is not scanned a second time',async()=>{
 const e=environment();e.memory['followcheck:watchlist:registry:v2:42']={targets:[{id:'t',username:'tester',running:false,enabled:true,intervalMinutes:60}],events:[]};
 e.run(`globalThis.watchRuns=0;resolveMonitorInstagramSession=async()=>({userId:'42',sessionId:'local'});
 runNativeWatchlistScan=async()=>{watchRuns++;if(watchRuns===1)await new Promise(resolve=>document.addEventListener('followcheck:ios:cancel',resolve));return {snapshot:{followers:1,following:1},changes:{}}};
 runNativeMonitorScan=async()=>({checkId:'own'})`);
 integrate(e);const watch=e.run('executeWatchlistTarget("42","t")');await microtasks();
 await e.run('__FOLLOWCHECK_IOS_CONTROL__("scan",{})');await watch;await microtasks();assert.equal(e.ctx.watchRuns,1);
});

test('Native Inbox uses one session reader and carries pagination and pending kind',async()=>{
 const e=backupEnvironment();e.ctx.calls=0;
 e.ctx.FollowCheckOriginal={inbox:()=>{throw Error('Legacy route must not run')}};
 e.run(`readInstagramDirectFromPage=async request=>{calls++;if(request.kind!=='pending'||request.cursor!=='next')throw Error('Lost pagination');return {ok:true,data:{pending_inbox:{threads:[{thread_id:'t'}],oldest_cursor:'older',has_older:true}}};}`);
 const result=await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('inbox',{kind:'pending',cursor:'next'});
 assert.equal(e.ctx.calls,1);assert.equal(result.append,true);assert.equal(result.kind,'pending');assert.equal(result.data.inbox.threads[0].thread_id,'t');assert.equal(result.data.inbox.oldest_cursor,'older');
});
test('Inbox rate limit stops after one session read and retains the cooldown',async()=>{
 const e=backupEnvironment();e.ctx.calls=0;
 e.run(`readInstagramDirectFromPage=async()=>{calls++;return {ok:false,status:429,responseKind:'html-document'}}`);
 await assert.rejects(e.ctx.__FOLLOWCHECK_IOS_CONTROL__('inbox'),{code:'inbox_unavailable'});
 assert.equal(e.ctx.calls,1);assert.equal((await e.run('readGlobalSafetyState()')).blocked,true);
});
test('Inbox account change cannot publish another account conversations',async()=>{
 const e=backupEnvironment();
 e.run(`readInstagramDirectFromPage=async()=>{document.cookie='ds_user_id=43';return {ok:true,data:{inbox:{threads:[{thread_id:'wrong'}]}}}}`);
 await assert.rejects(e.ctx.__FOLLOWCHECK_IOS_CONTROL__('inbox'),error=>['ios_paused','instagram_account_changed'].includes(error.code));
});
test('Native evidence, preferences and operation draft persist independently per account',async()=>{
 const e=backupEnvironment();
 for(const name of ['relationship-conversation-facts','relationship-engagement-facts','relationship-protection-overrides','relationship-preferences','operation-draft']) {
  const value={marker:name};await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('workspace',{accountId:'42',operation:'set',name,value});
  assert.equal(JSON.parse(e.local.get('followcheck:v3:account:42:'+name)).data.marker,name);
 }
 e.ctx.document.cookie='ds_user_id=43';
 const other=await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('workspace',{accountId:'43'});
 assert.equal(other.workspace['operation-draft']?.marker,undefined);
});

test('Mute sends both targets once and requires both final mute states',async()=>{
 const calls=[];const e=pageEnvironment(async(url,options)=>{
  calls.push({url,method:options.method,body:options.body});
  return new Response(JSON.stringify(options.method==='POST'?{status:'ok'}:{status:'ok',following:true,muting:true,is_muting_reel:true}),{headers:{'content-type':'application/json'}});
 });
 e.ctx.document.cookie='ds_user_id=42; csrftoken=test';
 const out=await e.request({operation:'relationship',action:'mute',targetId:'7'});
 assert.equal(out.result.ok,true);assert.equal(calls.length,2);
 assert.equal(calls[0].url,'/api/v1/friendships/mute_posts_or_story_from_follow/');
 assert.equal(new URLSearchParams(calls[0].body).get('target_posts_author_id'),'7');
 assert.equal(new URLSearchParams(calls[0].body).get('target_reel_author_id'),'7');
 assert.equal(out.result.verification.state.following,true);
});
test('Mute acknowledgment or partial mute state is never treated as full success',async()=>{
 for(const state of [{status:'ok'},{status:'ok',muting:true,is_muting_reel:false}]) {
  let writes=0,reads=0;const e=pageEnvironment(async(url,options)=>{
   options.method==='POST'?writes++:reads++;
   return new Response(JSON.stringify(options.method==='POST'?{status:'ok'}:state),{headers:{'content-type':'application/json'}});
  });e.ctx.document.cookie='ds_user_id=42; csrftoken=test';
  const out=await e.request({operation:'relationship',action:'mute',targetId:'7',username:'tester'});
  assert.equal(out.result.ok,false);assert.equal(writes,1);assert.equal(reads,1);
 }
});
test('Confirmed mute preserves audience membership and records local state',async()=>{
 const e=backupEnvironment();e.local.delete('followcheck:v3:account:42:protected');
 e.memory['followcheck:monitor:v1:42'].following=[{id:'7'}];
 e.ctx.performInstagramRelationshipAction=async()=>({ok:true,verification:{state:{following:true,followedBy:true,mutedPosts:true,mutedStories:true}}});
 await e.run('__FOLLOWCHECK_IOS_CONTROL__("relationship",{action:"mute",targetId:"7",username:"tester"})');
 const metadata=JSON.parse(e.local.get('followcheck:v3:account:42:profile-meta'));
 assert.equal(metadata.data['7'].mutedPosts,true);
 assert.equal(e.memory['followcheck:monitor:v1:42'].followers.length,1);
 assert.equal(e.memory['followcheck:monitor:v1:42'].following.length,1);
});

test('Private excerpts are sanitized, account scoped, excluded from backup and explicitly cleared',async()=>{
 const e=backupEnvironment();e.ctx.document.cookie='ds_user_id=12345';
 await e.run('privateMemoryOperation("set",{"7":[{text:"Private\\nexcerpt",direction:"incoming"}]},"12345")');
 const result=await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('memories',{accountId:'12345'});
 assert.equal(result.memories['7'][0].text,'Private excerpt');
 const backup=await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('backup',{accountId:'12345'});
 assert.equal(JSON.stringify(backup).includes('Private excerpt'),false);
 e.ctx.document.cookie='ds_user_id=67890';
 await assert.rejects(e.ctx.__FOLLOWCHECK_IOS_CONTROL__('memories',{accountId:'12345'}),{code:'instagram_account_changed'});
 const other=await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('memories',{accountId:'67890'});assert.equal(Object.keys(other.memories).length,0);
 e.ctx.document.cookie='ds_user_id=12345';
 await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('memories',{accountId:'12345',operation:'clear'});
 assert.equal(Object.keys((await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('memories',{accountId:'12345'})).memories).length,0);
});

test('Watchlist progress carries its scope through both native channels',()=>{
 const e=environment();const raw=source('background.js');e.run(raw.slice(raw.indexOf('function postMonitorProgress('),raw.indexOf('function postMonitorStopped(')));e.ctx.capture=v=>e.messages.push(v);e.run('nativePort={postMessage:capture};watchlistActiveOwnerId="42";watchlistActiveTargetId="t";postMonitorProgress("watchlist:42","Watchlist","10 perfis",25)');
 const progress=e.messages.filter(m=>m.event==='progress'||m.event==='monitor_progress');
 assert.equal(progress.length,2);assert.ok(progress.every(m=>m.scope==='watchlist'&&m.targetId==='t'));
});
test('Granted background reads can finish a check but cannot authorize a mutation',async()=>{
 const e=environment();let release;e.ctx.hold=()=>new Promise(resolve=>release=resolve);
 e.run('runNativeMonitorScan=async()=>{await hold();__FOLLOWCHECK_IOS_ASSERT_ACTIVE__();return 1}');integrate(e);
 const scan=e.run('runNativeMonitorScan({accountId:"42"})');await microtasks();
 await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('lifecycle',{active:false,continueChecks:true});e.ctx.document.hidden=true;
 release();assert.equal(await scan,1);
 await assert.rejects(e.ctx.__FOLLOWCHECK_IOS_CONTROL__('relationship',{action:'unfollow',targetId:'7'}));
});
test('Media likes only infer changes between complete lists and keep partial baselines',()=>{
 const e=environment();e.ctx.previous=[{id:'p',complete:true,users:[{id:'1'},{id:'2'}],observedAt:1}];
 e.ctx.incoming=[{id:'p',complete:false,users:[{id:'1'}],observedAt:2}];
 let result=e.run('mergeMediaLikeObservations(previous,incoming)');assert.equal(result[0].events.length,0);assert.equal(result[0].baseline.users.length,2);
 e.ctx.previous=result;e.ctx.incoming=[{id:'p',complete:true,users:[{id:'1'},{id:'3'}],observedAt:3}];
 result=e.run('mergeMediaLikeObservations(previous,incoming)');assert.deepEqual(Array.from(result[0].events,e=>[e.type,e.user.id]),[['added','3'],['removed','2']]);
 e.ctx.previous=[];result=e.run('mergeMediaLikeObservations(previous,incoming)');assert.equal(result[0].events.length,0);
});
test('Inbox uses the authenticated site reader when available and validates its shape',async()=>{
 const e=pageEnvironment(async()=>{throw Error('Raw fetch must not run')});
 e.ctx.require=name=>name==='PolarisInstapi'?{apiGet:async()=>({data:{inbox:{threads:[{thread_id:'7'}]}}})}:null;
 let out=await e.request({operation:'direct-read-inbox'});assert.equal(out.result.ok,true);assert.equal(out.result.executor,'instagram-web-client');
 e.ctx.require=()=>({apiGet:async()=>({data:{unexpected:[]}})});
 out=await e.request({operation:'direct-read-inbox'});assert.equal(out.result.ok,false);
});
test('Inbox site client 404 is preserved and does not trigger repeated transport guesses',async()=>{
 let calls=0;const e=pageEnvironment(async()=>{throw Error('No fallback after rejection')});
 e.ctx.require=()=>({apiGet:async()=>{calls++;throw {statusCode:404}}});
 const out=await e.request({operation:'direct-read-inbox'});assert.equal(out.result.status,404);assert.equal(out.result.ok,false);assert.equal(calls,1);
});
test('Media likes are scoped to the owner and failures preserve the previous observations',async()=>{
 const e=backupEnvironment();e.memory['followcheck:media-likes:v1:42:own']=[{id:'p',users:[{id:'7'}],complete:true}];
 const result=await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('likes',{accountId:'42'});assert.equal(result.posts[0].id,'p');
 await assert.rejects(e.ctx.__FOLLOWCHECK_IOS_CONTROL__('likes',{accountId:'43'}),{code:'instagram_account_changed'});
 e.ctx.FollowCheckOriginal={mediaLikes:async()=>{throw Error('Unavailable')}};
 await assert.rejects(e.ctx.__FOLLOWCHECK_IOS_CONTROL__('likes',{accountId:'42',operation:'refresh'}));
 assert.equal(e.memory['followcheck:media-likes:v1:42:own'][0].users.length,1);
});

test('List checkpoints persist across engine recreation and expire without becoming snapshots',async()=>{
 const e=environment();e.ctx.saved={profileId:'ios:42',at:Date.now(),users:[{id:'7'}],cursors:['next'],cursor:'next',hasNext:true,expected:2,pageNumber:1};
 e.run('iosListCheckpoints.set("42:ios:42:42:followers",saved)');await e.run('persistIOSListCheckpoints()');
 const restored=environment();Object.assign(restored.memory,structuredClone(e.memory));await restored.run('restoreIOSListCheckpoints()');
 assert.equal(restored.run('iosListCheckpoints.get("42:ios:42:42:followers").users.length'),1);
 assert.equal(restored.memory['followcheck:monitor:v1:42'],undefined);
 const stale=environment();Object.assign(stale.memory,structuredClone(e.memory));stale.memory['followcheck:ios:list-checkpoints:v1']['42:ios:42:42:followers'].at=Date.now()-16*60_000;
 await stale.run('restoreIOSListCheckpoints()');assert.equal(stale.run('iosListCheckpoints.size'),0);
});

test('A likes rate limit preserves observations and participates in the session cooldown',async()=>{
 const e=backupEnvironment();e.memory['followcheck:media-likes:v1:42:own']=[{id:'p',complete:true,users:[{id:'7'}]}];
 e.ctx.FollowCheckOriginal={mediaLikes:async()=>{throw Object.assign(Error('Slow down'),{code:'rate_limited',httpStatus:429})}};
 await assert.rejects(e.ctx.__FOLLOWCHECK_IOS_CONTROL__('likes',{accountId:'42',operation:'refresh'}),{code:'rate_limited'});
 assert.equal((await e.run('readGlobalSafetyState()')).blocked,true);
 assert.equal(e.memory['followcheck:media-likes:v1:42:own'][0].users.length,1);
});


test('Inbox normalizes direct web-client thread lists and pending lists',async()=>{
 const e=pageEnvironment(async()=>{throw Error('No raw fetch expected')});
 for(const data of [{threads:[{thread_id:'7'}],oldest_cursor:'next',has_older:true},{pending_inbox:{threads:[{thread_id:'7'}],oldest_cursor:'next',has_older:true}}]) {
  e.ctx.require=()=>({apiGet:async()=>({data})});
  const out=await e.request({operation:'direct-read-inbox'});
  assert.equal(out.result.ok,true);assert.equal(out.result.data.inbox.threads[0].thread_id,'7');
  assert.equal(out.result.data.inbox.oldest_cursor,'next');
 }
 e.ctx.require=()=>({apiGet:async()=>({data:{items:[{item_id:'m'}],thread_id:'7'}})});
 const out=await e.request({operation:'direct-read-thread',threadId:'7'});
 assert.equal(out.result.ok,true);assert.equal(out.result.data.thread.items[0].item_id,'m');
});
test('Watchlist first complete check records only a baseline even with supplied differences',()=>{
 const e=environment();
 const events=e.run('watchlistEventsFromResult({id:"t",username:"tester"},{baseline:true,completedAt:123,changes:{newFollowers:[{id:"7",username:"person"}]}})');
 assert.equal(events.length,1);assert.equal(events[0].type,'watch_baseline');
});

test('Inbox rejects a failed web-client response even when it contains a thread list',async()=>{
 const e=pageEnvironment(async()=>{throw Error('No raw fetch')});
 e.ctx.require=()=>({apiGet:async()=>({data:{status:'fail',threads:[]}})});
 const out=await e.request({operation:'direct-read-inbox'});assert.equal(out.result.ok,false);
});

test('Watchlist comparison rejects old incomplete foreign and malformed baselines',()=>{
 const e=environment();e.ctx.snapshot={comparisonVersion:3,complete:true,viewerUserId:'42',target:{id:'7',reportedFollowers:1,reportedFollowing:0},followers:[{id:'1'}],following:[]};
 assert.equal(e.run('validWatchlistComparisonSnapshot(snapshot,"42","7")'),true);
 for(const patch of [{comparisonVersion:1},{complete:false},{viewerUserId:'8'},{target:{id:'9'}},{followers:null},{followers:[{id:'1'},{id:'1'}]}]) {
  e.ctx.candidate={...e.ctx.snapshot,...patch};assert.equal(e.run('validWatchlistComparisonSnapshot(candidate,"42","7")'),false);
 }
});
test('Watchlist changes require verified comparison and carry that provenance',()=>{
 const e=environment();e.ctx.result={completedAt:123,checkId:'check',changes:{newFollowers:[{id:'1',username:'person'}]}};
 assert.equal(e.run('watchlistEventsFromResult({id:"t"},result)').length,0);
 e.ctx.result.comparisonVerified=true;
 const events=e.run('watchlistEventsFromResult({id:"t"},result)');assert.equal(events.length,1);assert.equal(events[0].comparisonVerified,true);assert.equal(events[0].checkId,'check');
});

test('Watchlist rejects screenshot mismatch instead of reporting no changes',()=>{
 const e=environment();
 assert.throws(()=>e.run('assertWatchlistCoverage({reportedFollowers:1172,reportedFollowing:343},{reportedFollowers:1172,reportedFollowing:343},946,342)'),error=>error.code==='watch_coverage_incomplete'&&error.coverage.followers===946);
 e.run('assertWatchlistCoverage({reportedFollowers:1172,reportedFollowing:343},{reportedFollowers:1172,reportedFollowing:343},1172,343)');
 assert.throws(()=>e.run('assertWatchlistCoverage({reportedFollowers:1171,reportedFollowing:343},{reportedFollowers:1172,reportedFollowing:343},1172,343)'),{code:'watch_coverage_incomplete'});
});
test('Media reads use the page client once and preserve HTTP 400 without retry',async()=>{
 let calls=0;const e=pageEnvironment(async()=>{throw Error('No raw fetch')});
 e.ctx.require=()=>({apiGet:async path=>{calls++;assert.equal(path,'/api/v1/feed/user/42/?count=12');return {data:{items:[]}};}});
 let out=await e.request({operation:'media-feed',userId:'42'});assert.equal(out.result.ok,true);assert.equal(calls,1);
 e.ctx.require=()=>({apiGet:async()=>{calls++;throw {statusCode:400}}});
 out=await e.request({operation:'media-likers',mediaId:'123'});assert.equal(out.result.ok,false);assert.equal(out.result.status,400);assert.equal(calls,2);
});

test('Partial Watchlist scan cannot overwrite the prior snapshot or emit changes',async()=>{
 const e=environment();const key='followcheck:watchlist:v1:42:7';e.memory[key]={marker:'preserve'};
 e.run(`resolveMonitorInstagramSession=async()=>({userId:'42',sessionId:'local'});
 resolveWatchlistTarget=async()=>({id:'7',username:'watched',reportedFollowers:1172,reportedFollowing:343});
 monitorCollectList=async kind=>({users:Array.from({length:kind==='followers'?946:342},(_,i)=>({id:String(i+1)})),pages:1,expected:0});`);
 await assert.rejects(e.run('runNativeWatchlistScan({checkId:"c",accountId:"42",targetId:"t",profileId:"p"})'),{code:'watch_coverage_incomplete'});
 assert.equal(e.memory[key].marker,'preserve');
});

test('Diagnostic export flushes pending writes and preserves nested safe metadata',async()=>{
 const e=environment();integrate(e);
 e.run(`backgroundLog('warn','watchlist','coverage','Incomplete',{checkId:'check-1',coverage:{received:946,expected:1172},nested:{authorization:'secret-auth',sessionid:'secret-session',ok:true},attempts:[{token:'secret-token',status:429}]})`);
 const result=await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('logs');
 const entry=result.logs.find(x=>x.event==='coverage');
 assert.equal(entry.meta.coverage.received,946);assert.equal(entry.meta.coverage.expected,1172);
 assert.equal(entry.meta.nested.ok,true);assert.equal(entry.meta.attempts[0].status,429);
 assert.doesNotMatch(JSON.stringify(entry),/secret-auth|secret-session|secret-token/);
});
test('Profile 429 diagnostic reports route, rejection and timing without response HTML',async()=>{
 const e=pageEnvironment(async()=>new Response('<html>private-response-content</html>',{status:429,headers:{'content-type':'text/html','retry-after':'60'}}));
 const response=await e.request({operation:'profile-info',username:'private_name'});
 const d=response.result.diagnostics;
 assert.equal(response.result.ok,false);assert.equal(d.route,'/api/v1/users/web_profile_info/');
 assert.equal(d.status,429);assert.equal(d.retryAfterSeconds,60);assert.equal(d.responseKind,'html-document');
 assert.equal(d.profileObjectPresent,false);assert.equal(d.httpStatusKnown,true);
 assert.ok(d.durationMs>=0);assert.doesNotMatch(JSON.stringify(d),/private-response-content|private_name/);
});
test('Media client 400 keeps unknown response details unknown and never retries',async()=>{
 let calls=0;const e=pageEnvironment(async()=>{throw Error('No fallback')});
 e.ctx.require=name=>name==='PolarisInstapi'?{apiGet:async()=>{calls++;throw {statusCode:400,message:'private-error-content'};}}:null;
 const response=await e.request({operation:'media-likers',mediaId:'123456789'});
 const d=response.result.diagnostics;
 assert.equal(calls,1);assert.equal(d.status,400);assert.equal(d.executor,'instagram-web-client');
 assert.equal(d.responseBytes,null);assert.equal(d.contentType,null);
 assert.doesNotMatch(JSON.stringify(d),/123456789|private-error-content/);
});
test('Bridge failures include request correlation and do not invent an HTTP status',async()=>{
 const e=pageEnvironment(async()=>{throw new TypeError('Network unavailable')});
 const result=await e.request({operation:'profile-info',userId:'123456789'});
 assert.equal(result.bridgeOk,false);assert.equal(result.error.diagnostics.requestId,'request-123456');
 assert.equal(result.error.diagnostics.status,null);assert.equal(result.error.diagnostics.httpStatusKnown,false);
});

test('Profile validation uses the available session client with either supported envelope',async()=>{
 for(const wrap of [user=>({user}),user=>({data:{user}})]) {
  let raw=0,calls=0;const e=pageEnvironment(async()=>{raw++;throw Error('Unexpected fetch')});
  e.ctx.require=name=>name==='PolarisInstapi'?{apiGet:async(path)=>{calls++;assert.equal(path,'/api/v1/users/web_profile_info/?username=watched');return wrap({id:'7',username:'watched',edge_followed_by:{count:1172},edge_follow:{count:343}});}}:null;
  const out=await e.request({operation:'profile-info',username:'watched'});
  assert.equal(out.result.ok,true);assert.equal(out.result.executor,'instagram-web-client');assert.equal(calls,1);assert.equal(raw,0);
  const user=out.result.data.user||out.result.data.data.user;assert.equal(user.edge_followed_by.count,1172);
  assert.equal(out.result.diagnostics.httpStatusKnown,false);
 }
});
test('A profile client 429 retains the refusal without switching routes or transports',async()=>{
 let calls=0,raw=0;const e=pageEnvironment(async()=>{raw++;throw Error('Unexpected fetch')});
 e.ctx.require=name=>name==='PolarisInstapi'?{apiGet:async()=>{calls++;throw {statusCode:429,retryAfterSeconds:90};}}:null;
 const out=await e.request({operation:'profile-info',username:'watched'});
 assert.equal(out.result.ok,false);assert.equal(out.result.status,429);assert.equal(out.result.retryAfter,90);
 assert.equal(out.result.executor,'instagram-web-client');assert.equal(calls,1);assert.equal(raw,0);
});
test('Profile client rejects a failed or malformed envelope despite a successful promise',async()=>{
 for(const reply of [{status:'fail',user:{id:'7'}},{data:{status:'fail',user:{id:'7'}}},{data:{}},'<html>error</html>']) {
  const e=pageEnvironment(async()=>{throw Error('No retry')});e.ctx.require=()=>({apiGet:async()=>reply});
  const out=await e.request({operation:'profile-info',username:'watched'});
  assert.equal(out.result.ok,false);assert.equal(out.result.responseKind,'client-shape-invalid');
 }
});
test('Cancelling profile validation aborts the site client and rejects late success',async()=>{
 const e=pageEnvironment(async()=>{throw Error('No raw fetch')});let aborted=0,complete;
 e.ctx.require=()=>({apiGet:(_path,_params,options)=>{options.before({abort:()=>{aborted++;}});return new Promise(resolve=>{complete=resolve;});}});
 const pending=e.request({operation:'profile-info',username:'watched'});await microtasks();
 e.ctx.document.dispatchEvent(new e.ctx.CustomEvent('followcheck:page-executor:cancel:v1',{detail:'request-123456'}));
 complete({user:{id:'7'}});const out=await pending;
 assert.equal(aborted,1);assert.equal(out.bridgeOk,false);assert.equal(out.error.name,'AbortError');
});
test('Propagating the same failure records one safety transition; separate failures remain independent',async()=>{
 const e=environment();
 e.run(`globalThis.trips=0;tripGlobalSafety=async()=>{trips++;return {saved:true}};globalThis.sharedFailure={code:'rate_limited'};`);
 await e.run(`Promise.all([tripSafetyFromError(sharedFailure,'scan'),tripSafetyFromError(sharedFailure,'check')])`);
 await e.run(`tripSafetyFromError(sharedFailure,'outer')`);assert.equal(e.ctx.trips,1);
 await e.run(`tripSafetyFromError({code:'rate_limited'},'new-check')`);assert.equal(e.ctx.trips,2);
});
test('Failed safety persistence remains retryable for the same exception',async()=>{
 const e=environment();e.run(`globalThis.trips=0;tripGlobalSafety=async()=>{if(++trips===1)throw Error('storage');return {saved:true}};globalThis.sharedFailure={code:'rate_limited'};`);
 await assert.rejects(e.run(`tripSafetyFromError(sharedFailure,'scan')`));
 await e.run(`tripSafetyFromError(sharedFailure,'check')`);assert.equal(e.ctx.trips,2);
});

function profileHTML(user) {return '<!doctype html><html><script type="application/json" data-sjs>'+JSON.stringify({require:[['RelayPrefetchedStreamCache','next',[],[{__bbox:{result:{data:{user}}}}]]]})+'</script></html>';}
function countedUser(patch={}) {return {id:'7',username:'watched',follower_count:1172,following_count:343,...patch};}
test('Watchlist count validation selects normal profile documents and retains known identity',async()=>{
 const e=environment();e.run(`globalThis.profileCalls=[];requestInstagramMainPage=async(operation,args)=>{profileCalls.push({operation,args});return {ok:true,data:{user:{id:'7',username:'watched',follower_count:1172,following_count:343}}}};`);
 const result=await e.run(`resolveWatchlistTarget({requireCounts:true,targetUserId:'7',targetUsername:'watched'})`);
 assert.equal(e.ctx.profileCalls[0].operation,'profile-document');assert.equal(e.ctx.profileCalls[0].args.userId,'7');
 assert.equal(result.reportedFollowers,1172);assert.equal(result.reportedFollowing,343);
});
test('Profile document extracts exact nested counts in one same-session document request',async()=>{
 let calls=0;const e=pageEnvironment(async(path,options)=>{
  calls++;assert.equal(path,'/watched/');assert.equal(options.credentials,'include');assert.equal(options.cache,'no-store');
  assert.deepEqual(Object.keys(options.headers),['accept']);return new Response(profileHTML(countedUser()),{headers:{'content-type':'text/html'}});
 });
 const out=await e.request({operation:'profile-document',username:'watched',userId:'7'});
 assert.equal(calls,1);assert.equal(out.result.ok,true);assert.equal(out.result.data.user.follower_count,1172);
 assert.equal(out.result.diagnostics.route,'/:profile/');assert.equal(out.result.diagnostics.finalPath,'/:profile/');
 assert.doesNotMatch(JSON.stringify(out.result.diagnostics),/watched/);
});
test('Profile document refuses other identities, missing, rounded and conflicting counts',async()=>{
 const cases=[
  profileHTML(countedUser({id:'8'})),profileHTML(countedUser({username:'other'})),
  profileHTML(countedUser({follower_count:'1.2K'})),profileHTML(countedUser({follower_count:null})),
  profileHTML(countedUser())+profileHTML(countedUser({follower_count:946})),
  '<html><meta name="description" content="1.2K followers, 343 following"></html>'
 ];
 for(const html of cases){const e=pageEnvironment(async()=>new Response(html));const out=await e.request({operation:'profile-document',username:'watched',userId:'7'});assert.equal(out.result.ok,false);assert.equal(out.result.data,null);}
});
test('Profile documents accept exact edge counts and ignore counts belonging to other people',async()=>{
 const user={id:'7',username:'watched',edge_followed_by:{count:1172},edge_follow:{count:343}};
 const html=profileHTML(user)+profileHTML(countedUser({id:'8',username:'other',follower_count:999}));
 const e=pageEnvironment(async()=>new Response(html));const out=await e.request({operation:'profile-document',username:'watched'});
 assert.equal(out.result.ok,true);assert.equal(out.result.data.user.follower_count,1172);
});
test('Profile document 429 is preserved after one request without an API fallback',async()=>{
 let calls=0;const e=pageEnvironment(async()=>{calls++;return new Response('<html>private</html>',{status:429,headers:{'retry-after':'90'}});});
 const out=await e.request({operation:'profile-document',username:'watched'});
 assert.equal(out.result.ok,false);assert.equal(out.result.status,429);assert.equal(out.result.retryAfter,90);assert.equal(calls,1);
});
test('Redirect to login cannot validate even a document containing the target profile',async()=>{
 const e=pageEnvironment(async()=>{const response=new Response(profileHTML(countedUser()));Object.defineProperty(response,'url',{value:'https://www.instagram.com/accounts/login/'});return response;});
 const out=await e.request({operation:'profile-document',username:'watched'});
 assert.equal(out.result.ok,false);assert.equal(out.result.code,'login_required');
});
test('A main-page list 429 stops all collection transports and retains Retry-After',async()=>{
 const e=environment();e.run(`globalThis.listCalls=0;executeInstagramPageRequest=async()=>{listCalls++;return {ok:false,status:429,retryAfter:90}};`);
 await assert.rejects(e.run(`monitorCollectList('followers','7','p',1,90,'42')`),error=>error.code==='rate_limited'&&error.retryAfter===90);
 assert.equal(e.ctx.listCalls,1);
});

function renderedEnvironment(reply) {
 const e=environment();e.ctx.location=new URL('https://www.instagram.com/watched/');
 e.ctx.__FC_PROFILE_CONFIG__={username:'watched',userId:'7',viewerId:'42'};
 const scripts=[];e.ctx.document.querySelectorAll=selector=>selector.includes('script')?scripts:[];
 e.ctx.fetch=async()=>new Response(JSON.stringify(reply),{headers:{'content-type':'application/json'}});
 e.run(source('profile-reader.js'));
 return {...e,scripts,snapshot:()=>e.ctx.__FC_PROFILE_READER__.snapshot(),network:async()=>{await e.ctx.fetch('/graphql/query');await new Promise(resolve=>setImmediate(resolve));}};
}
test('Rendered profile waits for hydration and accepts the page own later JSON response',async()=>{
 const e=renderedEnvironment({data:{user:countedUser()}});
 assert.equal(e.snapshot().ok,false);assert.equal(e.snapshot().matched,0);
 await e.network();const result=e.snapshot();
 assert.equal(result.ok,true);assert.equal(result.data.user.follower_count,1172);assert.equal(result.source,'rendered-network-json');
});
test('Rendered profile rejects another viewer and another target despite exact counts',async()=>{
 for(const change of ['viewer','target']) {
  const e=renderedEnvironment({data:{user:countedUser(change==='target'?{id:'8'}:{})}});
  if(change==='viewer')e.ctx.document.cookie='ds_user_id=99';
  await e.network();const result=e.snapshot();assert.equal(result.ok,false);
  assert.equal(result.code,change==='viewer'?'instagram_account_changed':'watch_target_changed');
 }
});
test('Rendered profile cannot infer counts from unrelated people or partial profile data',async()=>{
 for(const user of [countedUser({username:'other'}),{id:'7',username:'watched'}]) {
  const e=renderedEnvironment({data:{user}});await e.network();assert.equal(e.snapshot().ok,false);
 }
});
test('Rendered profile refuses contradictory counts within one response',async()=>{
 const e=renderedEnvironment({a:countedUser(),b:countedUser({follower_count:946})});
 await e.network();assert.equal(e.snapshot().ok,false);assert.equal(e.snapshot().code,'profile_counts_conflict');
});
test('Rendered exact links require a separately observed identity and reject rounded totals',async()=>{
 const e=renderedEnvironment({user:{id:'7',username:'watched'}});await e.network();
 const link=(kind,text)=>({getAttribute:()=>`/watched/${kind}/`,textContent:text,querySelectorAll:()=>[]});
 let links=[link('followers','1.2K followers'),link('following','343 following')];
 e.ctx.document.querySelectorAll=selector=>selector==='a[href]'?links:[];
 assert.equal(e.snapshot().ok,false);
 links=[link('followers','1,172 followers'),link('following','343 following')];
 assert.equal(e.snapshot().ok,true);assert.equal(e.snapshot().data.user.follower_count,1172);
 const other=renderedEnvironment({});other.ctx.document.querySelectorAll=selector=>selector==='a[href]'?links:[];
 assert.equal(other.snapshot().ok,false);
});
test('Observed site 429 remains a refusal and observing does not create extra requests',async()=>{
 const e=environment();e.ctx.location=new URL('https://www.instagram.com/watched/');e.ctx.__FC_PROFILE_CONFIG__={username:'watched'};
 e.ctx.document.querySelectorAll=()=>[];let calls=0;
 e.ctx.fetch=async()=>{calls++;return new Response('{}',{status:429})};e.run(source('profile-reader.js'));
 await e.ctx.fetch('/graphql/query');assert.equal(calls,1);assert.equal(e.ctx.__FC_PROFILE_READER__.snapshot().code,'rate_limited');
});
test('Native profile RPC is selected before any page executor request',async()=>{
 const e=environment();e.run(`globalThis.__FOLLOWCHECK_IOS_PROFILE_READ__=async()=>({ok:true,data:{user:{id:'7',username:'watched',follower_count:1172,following_count:343}}});requestInstagramMainPage=async()=>{throw Error('No second read')};`);
 const result=await e.run(`resolveWatchlistTarget({requireCounts:true,targetUserId:'7',targetUsername:'watched'})`);
 assert.equal(result.reportedFollowers,1172);
});
test('Interrupting native profile RPC sends cancellation and rejects a late result',async()=>{
 const e=environment();let complete;const calls=[];
 e.ctx.webkit.messageHandlers.followcheckRPC={postMessage:request=>{calls.push(request);if(request.details.operation==='cancel')return Promise.resolve({ok:true});return new Promise(resolve=>{complete=resolve;});}};
 integrate(e);
 const pending=e.ctx.__FOLLOWCHECK_IOS_PROFILE_READ__({username:'watched',userId:'7'});await microtasks();
 e.ctx.document.dispatchEvent(new e.ctx.CustomEvent('followcheck:ios:cancel'));
 complete({ok:true,data:{user:countedUser()}});
 await assert.rejects(pending,{code:'ios_paused'});
 assert.equal(calls.length,2);assert.equal(calls[1].details.operation,'cancel');
 assert.equal(calls[0].details.requestId,calls[1].details.requestId);
});

function renderedListEnvironment({expected=4,proof=false,pages,kind='followers',beforeResponse=null}={}) {
 const e=environment();let clock=10000,index=0;const calls=[];
 e.ctx.Date=class extends Date {static now(){return clock;}};
 e.ctx.Event=class {constructor(type){this.type=type;}};
 e.ctx.location=new URL('https://www.instagram.com/watched/');
 e.ctx.__FC_PROFILE_CONFIG__={username:'watched',userId:'7',viewerId:'42',viewerUsername:'viewer',goal:'list',listKind:kind,expectedCount:expected,pageDelayMinMs:300};
 const script={textContent:JSON.stringify({user:countedUser({follower_count:expected,following_count:expected,followed_by_viewer:proof,follows_viewer:proof})})};
 const path=`/api/v1/friendships/7/${kind}/?count=25`;
 const next=()=>e.ctx.fetch(path+'&max_id='+index);
 const scroller={clientHeight:100,scrollHeight:500,scrollTop:0,dispatchEvent:()=>{void next();}};
 const dialog={clientHeight:500,scrollHeight:500,querySelectorAll:()=>[scroller]};
 const link={getAttribute:()=>`/watched/${kind}/`,click:()=>{void next();}};
 e.ctx.document.querySelectorAll=selector=>selector.includes('script')?[script]:selector==='a[href]'?[link]:[];
 e.ctx.document.querySelector=selector=>selector==='[role="dialog"]'?dialog:null;
 e.ctx.fetch=async url=>{calls.push(url);const page=index++;if(beforeResponse)await beforeResponse(page);const value=pages[Math.min(page,pages.length-1)];return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});};
 e.run(source('profile-reader.js'));
 return {...e,calls,snapshot:()=>e.ctx.__FC_PROFILE_READER__.snapshot(),settle:()=>new Promise(resolve=>setImmediate(resolve)),advance:()=>{clock+=1000;}};
}
const people=ids=>ids.map(id=>({pk:String(id),username:'person_'+id}));
test('Rendered list counts unique people across overlapping pages and scrolls the actual dialog',async()=>{
 const e=renderedListEnvironment({pages:[{users:people([1,2]),has_more:true},{users:people([2,3,4]),has_more:false}]});
 assert.equal(e.snapshot().ok,false);await e.settle();e.advance();e.snapshot();await e.settle();
 const out=e.snapshot();assert.equal(out.ok,true);assert.equal(out.data.users.length,4);assert.equal(out.rawEntries,5);assert.equal(out.duplicateEntries,1);assert.equal(e.calls.length,2);
});
test('Terminal duplicates and a one-person gap never become fabricated complete lists',async()=>{
 for(const ids of [[1,2],[1,2,3]]) {
  const e=renderedListEnvironment({pages:[{users:people(ids),has_more:false}]});e.snapshot();await e.settle();
  const out=e.snapshot();assert.equal(out.ok,false);assert.equal(out.code,'watch_coverage_incomplete');assert.equal(out.viewerIncluded,false);
 }
});
test('The current viewer is added only with an explicit fresh membership proof',async()=>{
 const e=renderedListEnvironment({proof:true,pages:[{users:people([1,2,3]),has_more:false}]});
 e.snapshot();await e.settle();const out=e.snapshot();assert.equal(out.ok,true);assert.equal(out.viewerIncluded,true);
 assert.equal(out.data.users.find(u=>u.id==='42').username,'viewer');
});
test('Wrong target and wrong direction responses cannot contaminate a rendered list',async()=>{
 const e=renderedListEnvironment({pages:[{users:people([1,2]),has_more:true}]});
 await e.ctx.fetch('/api/v1/friendships/99/followers/');await e.ctx.fetch('/api/v1/friendships/7/following/');await e.settle();
 assert.equal(e.snapshot().collected,0);
});
test('GraphQL dialog connections need a matching target and list direction',async()=>{
 const e=renderedListEnvironment({pages:[{data:{xdt_api__v1__friendships__user_id__followers__connection:{edges:people([1,2,3,4]).map(node=>({node})),page_info:{has_next_page:false}}}}]});
 const body=new URLSearchParams({variables:JSON.stringify({user_id:'7'}),fb_api_req_friendly_name:'PolarisFollowersDialogQuery'}).toString();
 await e.ctx.fetch('/graphql/query',{method:'POST',body});await e.settle();const out=e.snapshot();assert.equal(out.ok,true);assert.equal(out.collected,4);
});
test('Rendered lists cannot finish at the expected count while the source still has more pages',async()=>{
 const e=renderedListEnvironment({pages:[{users:people([1,2,3,4]),has_more:true}]});
 e.snapshot();await e.settle();const out=e.snapshot();
 assert.equal(out.collected,4);assert.equal(out.terminal,false);assert.equal(out.ok,false);assert.equal(out.loading,true);
});
test('Rendered lists wait for an outstanding list response even after an apparent terminal page',async()=>{
 let releaseResponse;const pendingResponse=new Promise(resolve=>{releaseResponse=resolve;});
 const e=renderedListEnvironment({
  pages:[{users:people([1,2,3,4]),has_more:false},{users:people([4]),has_more:false}],
  beforeResponse:page=>page===1?pendingResponse:undefined,
 });
 e.snapshot();await e.settle();
 const request=e.ctx.fetch('/api/v1/friendships/7/followers/?count=25&max_id=late');
 const waiting=e.snapshot();
 releaseResponse();await request;await e.settle();
 assert.equal(waiting.collected,4);assert.equal(waiting.terminal,true);assert.equal(waiting.ok,false);
 const complete=e.snapshot();assert.equal(complete.ok,true);assert.equal(complete.data.users.length,4);assert.equal(e.calls.length,2);
});
test('A nested foreign profile connection cannot supply the watched profile followers',async()=>{
 const e=renderedListEnvironment({pages:[{data:{user:{id:'7',username:'watched',related_profile:{
  id:'99',username:'other',edge_followed_by:{edges:people([91,92,93,94]).map(node=>({node})),page_info:{has_next_page:false}},
 }}}}]});
 await e.ctx.fetch('/graphql/query');await e.settle();const out=e.snapshot();
 assert.equal(out.collected,0);assert.equal(out.ok,false);
});
test('A direct follower connection owned by the watched profile remains valid',async()=>{
 const e=renderedListEnvironment({pages:[{data:{user:{id:'7',username:'watched',
  edge_followed_by:{edges:people([1,2,3,4]).map(node=>({node})),page_info:{has_next_page:false}},
 }}}]});
 await e.ctx.fetch('/graphql/query');await e.settle();const out=e.snapshot();
 assert.equal(out.ok,true);assert.equal(out.terminal,true);assert.deepEqual(Array.from(out.data.users,user=>user.id),['1','2','3','4']);
});
test('Watchlist collection prefers the rendered list and rejects an incomplete native reply',async()=>{
 const e=environment();e.run(`globalThis.__FOLLOWCHECK_IOS_LIST_READ__=async()=>({ok:true,data:{users:[{id:'1',username:'one'}]},diagnostics:{collected:1}});executeInstagramPageRequest=async()=>{throw Error('No independent list request')};`);
 await assert.rejects(e.run(`monitorCollectList('followers','7','p',1,90,'42',{username:'watched',expected:2})`),{code:'watch_coverage_incomplete'});
});

test('Rendered list completion requires unambiguous pagination evidence from the latest page',async()=>{
 for(const frame of [{},{has_more:false,next_max_id:'still-more'}]) {
  const e=renderedListEnvironment({expected:2,pages:[{users:people([1,2]),...frame}]});
  e.snapshot();await e.settle();const out=e.snapshot();
  assert.equal(out.ok,false);
  assert.equal(out.terminal,false);
  assert.equal(out.code,frame.has_more===false?'list_pagination_conflict':'');
 }
});
