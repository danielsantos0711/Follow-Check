import test from 'node:test';
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
    document:{hidden:false,cookie:'ds_user_id=42',addEventListener:(name,fn)=>{(listeners[name] ||= []).push(fn);},dispatchEvent:e=>{for(const fn of listeners[e.type]||[]) fn(e);}},
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
test('Pause followed by resume cannot revive an interrupted scan',async()=>{
 const e=environment();let release;e.ctx.hold=()=>new Promise(r=>release=r);
 e.run('runNativeMonitorScan=async()=>{await hold(); globalThis.__FOLLOWCHECK_IOS_ASSERT_ACTIVE__(); return 1;}');integrate(e);
 const scan=e.run('runNativeMonitorScan({accountId:"42"})');await microtasks();
 await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('lifecycle',{active:false});
 await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('lifecycle',{active:true});release();
 // Current 2.5.7 engine reports the superseded check as check_preempted.
 // Either cancellation code must reject; the interrupted operation cannot succeed.
 await assert.rejects(scan,error=>['ios_paused','check_preempted'].includes(error.code));
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
