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
      runtime:{onMessage:event(),onConnect:event(),getURL:path=>`followcheck-test:///${path}`,connectNative:()=>({postMessage:v=>messages.push(v),onMessage:event(),onDisconnect:event()})},
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
  const diagnosticPublisher=ctx.postMonitorDiagnostic;
  // Test traffic is replaced at the transport boundary, never sent to Instagram.
  vm.runInContext(`
    inspectInstagramSessionForNative = async()=>{};
    requestNativeSnapshot = async()=>{};
    watchlistOwnerId = async()=> '42';
    postMonitorProgress = ()=>{}; postMonitorStopped = ()=>{}; postMonitorDiagnostic=()=>{};
    monitorSleep=async()=>{};
  `,ctx);
  return {ctx,memory,messages,timers,listeners,diagnosticPublisher,run:code=>vm.runInContext(code,ctx)};
}
function integrate(e) { vm.runInContext(source('ios-engine.js'),e.ctx); }
const microtasks = async()=>{for(let i=0;i<25;i++) await Promise.resolve();};

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

function collector() {
 const e=environment();
 e.ctx.diagnostics=[];
 e.run('postMonitorDiagnostic=(profileId,event,meta)=>diagnostics.push({event,meta});');
 return e;
}
const users=(...ids)=>ids.map(id=>({id:String(id)}));
const page=(ids,hasNext=false,cursor=null)=>({users:users(...ids),expected:0,hasNext,cursor});
const collect=(e,expected=3)=>e.run(`monitorCollectList("followers","99","watchlist:42",47,90,"42",{expected:${expected}})`);

test('Known profile total drives progress without adding synthetic page parameters',async()=>{
 const e=collector(),requests=[];
 e.ctx.monitorFetchPage=async(...args)=>{requests.push(args);return requests.length===1?page([1,2],true,'cursor-2'):page([3]);};
 const result=await collect(e);
 assert.equal(result.coverageComplete,true);assert.equal(result.expected,3);assert.equal(result.pass,1);
 assert.equal(requests.length,2);assert.equal(requests[0].length,5);assert.equal(requests[1].length,5);
 assert.deepEqual(e.ctx.diagnostics.filter(x=>x.event==='page_loaded').map(x=>x.meta.expected),[3,3]);
});
test('Page-request boundary forwards only the established web parameters',async()=>{
 const e=collector();let message;
 e.ctx.requestInstagramMainPage=async(operation,payload)=>{message={operation,payload};return {ok:true,status:200,data:{users:[{pk:'1'}],has_more:false}};};
 const result=await e.run('monitorFetchPage("followers","main","99",null,"42")');
 assert.equal(message.operation,'monitor-list');assert.deepEqual(Object.keys(message.payload).sort(),['count','cursor','kind','userId']);assert.equal(result.users[0].id,'1');
});
test('Page executor sends the working 2.5.7 query and exposes its actual parameter names',async()=>{
 let endpoint;const e=pageEnvironment(async url=>{endpoint=new URL(url,'https://www.instagram.com');return new Response('{"users":[],"has_more":false}',{headers:{'content-type':'application/json'}});});
 const response=await e.request({operation:'monitor-list',kind:'followers',userId:'99',rankToken:'42_stable-pagination-1',cursor:'opaque-cursor',count:100});
 assert.equal(response.bridgeOk,true);assert.equal(endpoint.searchParams.has('rank_token'),false);assert.equal(endpoint.searchParams.get('max_id'),'opaque-cursor');
 assert.equal(endpoint.searchParams.get('count'),'100');assert.equal(endpoint.searchParams.get('search_surface'),'follow_list_page');
 assert.deepEqual(Array.from(endpoint.searchParams.keys()).sort(),['count','max_id','search_surface']);
 assert.equal(response.result.diagnostics.rankingPolicy,'web-default');assert.ok(!JSON.stringify(response.result.diagnostics).includes('42_stable-pagination-1'));
 assert.deepEqual(Array.from(response.result.diagnostics.queryParameterNames).sort(),['count','max_id','search_surface']);
});
test('A legacy synthetic rank field cannot change the actual web query',async()=>{
 let endpoint;const e=pageEnvironment(async url=>{endpoint=new URL(url,'https://www.instagram.com');return new Response('{"users":[],"has_more":false}',{headers:{'content-type':'application/json'}});});
 const response=await e.request({operation:'monitor-list',kind:'followers',userId:'99',rankToken:'bad&cursor=other'});
 assert.equal(response.bridgeOk,true);assert.equal(response.result.ok,true);assert.equal(endpoint.searchParams.has('rank_token'),false);
 assert.equal(endpoint.searchParams.has('cursor'),false);assert.equal(endpoint.searchParams.has('max_id'),false);
});
test('One recovery replaces the first observation rather than merging identities',async()=>{
 const e=collector(),requests=[];
 e.ctx.monitorFetchPage=async(...args)=>{requests.push(args);return requests.length===1?page([1,2]):page([2,3,4]);};
 const result=await collect(e);
 assert.deepEqual(Array.from(result.users,u=>u.id),['2','3','4']);assert.equal(result.coverageComplete,true);assert.equal(result.pass,2);
 assert.equal(requests.length,2);assert.equal(requests[1][3],null);
 assert.equal(e.ctx.diagnostics.filter(x=>x.event==='coverage_retry').length,1);
});
test('Union of two partial observations cannot fabricate exact coverage',async()=>{
 const e=collector();let requests=0;
 e.ctx.monitorFetchPage=async()=>++requests===1?page([1,2]):page([2,3]);
 const result=await collect(e);
 assert.equal(requests,2);assert.equal(result.coverageComplete,false);assert.equal(result.users.length,2);
 assert.equal(e.ctx.diagnostics.filter(x=>x.event==='transport_success').length,0);
});
test('Reported 1172 / raw 1171 / unique 924 reproduces the diagnostic with no false success',async()=>{
 const e=collector();
 const totals=[25,48,67,90,103,127,143,166,190,212,219,240,254,278,289,313,326,343,367,385,409,419,443,463,487,498,522,544,565,583,590,615,636,659,677,702,723,745,763,787,791,816,835,860,881,905,924];
 let calls=0;
 e.ctx.monitorFetchPage=async()=>{
   const i=calls++%47, prior=i?totals[i-1]:0,added=totals[i]-prior,raw=i===46?21:25;
   const ids=Array.from({length:added},(_,n)=>prior+n+1);
   ids.push(...Array.from({length:raw-added},(_,n)=>n+1));
   return page(ids,i<46,i<46?`cursor-${i+1}`:null);
 };
 const result=await collect(e,1172);
 // 2.6: a list that repeats a large share of accounts is shuffled by Instagram;
 // a second traversal cannot converge, so it is reported once as partial.
 assert.equal(calls,47);assert.equal(result.users.length,924);assert.equal(result.receivedUsers,1171);assert.equal(result.duplicates,247);
 assert.equal(result.coverageComplete,false);assert.equal(result.pass,1);assert.equal(result.orderingUnstable,true);assert.equal(result.validationMode,'partial-observation');
 assert.equal(e.ctx.diagnostics.filter(x=>x.event==='transport_success').length,0);assert.equal(e.ctx.diagnostics.filter(x=>x.event==='coverage_retry').length,0);
 const last=e.ctx.diagnostics.filter(x=>x.event==='list_coverage_incomplete').at(-1).meta;
 assert.equal(last.expected,1172);assert.equal(last.duplicates,247);
 assert.equal(e.ctx.diagnostics.filter(x=>x.event==='ordering_unstable').length,1);
});
test('A one-account shortfall is still incomplete after the single recovery',async()=>{
 const e=collector();let calls=0;e.ctx.monitorFetchPage=async()=>{calls++;return page(Array.from({length:342},(_,n)=>n+1));};
 const result=await collect(e,343);assert.equal(calls,2);assert.equal(result.coverageComplete,false);
 e.ctx.before={reportedFollowers:1172,reportedFollowing:343};e.ctx.after=e.ctx.before;
 assert.throws(()=>e.run('assertWatchlistCoverage(before,after,1172,342)'),{code:'watch_coverage_incomplete'});
});
test('Excess identities also fail exact coverage rather than accepting an enlarged list',async()=>{
 const e=collector();let calls=0;e.ctx.monitorFetchPage=async()=>{calls++;return page([1,2,3,4]);};
 const result=await collect(e);assert.equal(calls,2);assert.equal(result.coverageComplete,false);
});
test('A verified zero total with an empty terminal page is complete',async()=>{
 const e=collector();let calls=0;e.ctx.monitorFetchPage=async()=>{calls++;return page([]);};
 const result=await collect(e,0);assert.equal(calls,1);assert.equal(result.coverageComplete,true);assert.equal(result.expected,0);
});
test('429, login, challenge and pause errors cannot trigger a recovery request',async()=>{
 for(const code of ['rate_limited','logout_confirmed','challenge_required','instagram_security_warning','ios_paused','page_main_rejected','list_request_rejected','soft_throttle']) {
  const e=collector();let calls=0;e.ctx.monitorFetchPage=async()=>{calls++;throw Object.assign(Error(code),{code,status:code==='rate_limited'?429:0});};
  await assert.rejects(collect(e),{code});assert.equal(calls,1);
 }
});
test('Repeated pagination cursor stops without another traversal',async()=>{
 const e=collector();let calls=0;e.ctx.monitorFetchPage=async()=>{calls++;return page([1],true,'same');};
 await assert.rejects(collect(e),{code:'pagination_incomplete'});assert.equal(calls,2);
});
test('A pause resumes the same web cursor without extra request parameters',async()=>{
 const e=collector(),requests=[];let paused=true;
 e.ctx.monitorFetchPage=async(...args)=>{requests.push(args);if(requests.length===1)return page([1,2],true,'cursor-2');if(paused)throw Object.assign(Error('paused'),{code:'ios_paused'});return page([3]);};
 await assert.rejects(collect(e),{code:'ios_paused'});paused=false;
 const result=await collect(e);assert.equal(result.coverageComplete,true);assert.equal(result.receivedUsers,3);
 assert.equal(requests.length,3);assert.equal(requests[2][3],'cursor-2');assert.equal(requests[2].length,5);
});
test('Resuming an interrupted recovery never creates a third traversal',async()=>{
 const e=collector();let calls=0,paused=true;
 e.ctx.monitorFetchPage=async()=>{calls++;if(calls===1)return page([1]);if(calls===2)return page([2],true,'second-page');if(paused)throw Object.assign(Error('paused'),{code:'ios_paused'});return page([3]);};
 await assert.rejects(collect(e),{code:'ios_paused'});paused=false;
 const result=await collect(e);assert.equal(calls,4);assert.equal(result.pass,2);assert.equal(result.coverageComplete,false);assert.equal(result.users.length,2);
});
test('A persisted web checkpoint resumes across engine reconstruction',async()=>{
 const e=collector();let calls=0;
 e.ctx.monitorFetchPage=async()=>{if(++calls===1)return page([1],true,'resume-here');throw Object.assign(Error('paused'),{code:'ios_paused'});};
 await assert.rejects(collect(e),{code:'ios_paused'});
 const resumed=collector();Object.assign(resumed.memory,structuredClone(e.memory));
 resumed.ctx.monitorFetchPage=async(...args)=>{assert.equal(args[3],'resume-here');assert.equal(args.length,5);return page([2,3]);};
 const result=await collect(resumed);assert.equal(result.coverageComplete,true);assert.equal(result.receivedUsers,3);
});
test('A 2.5.8 checkpoint from the rejected query format is discarded',async()=>{
 const e=collector();e.memory['followcheck:ios:list-checkpoints:v1']={'42:watchlist:42:99:followers':{paginationVersion:2,rankToken:'42_legacy-rank',knownTotal:3,at:Date.now(),users:users(999),cursors:['old'],cursor:'old',hasNext:true,expected:3,pageNumber:1}};
 e.ctx.monitorFetchPage=async(...args)=>{assert.equal(args[3],null);return page([1,2,3]);};
 const result=await collect(e);assert.deepEqual(Array.from(result.users,u=>u.id),['1','2','3']);
});
test('Missing or contradictory pagination cursor and invalid identities fail closed',()=>{
 const e=collector();
 for(const payload of [{users:[],has_more:true},{users:[],has_more:false,next_max_id:'next'}]) {
  e.ctx.payload=payload;assert.throws(()=>e.run('monitorMainListPage(payload,"page-main")'),{code:'pagination_incomplete'});
 }
 e.ctx.payload={users:[{pk:'invalid'}],has_more:false};
 assert.throws(()=>e.run('monitorMainListPage(payload,"page-main")'),{code:'shape_changed'});
});
test('Profile totals changing during collection still reject a complete-sized list',()=>{
 const e=collector();e.ctx.before={reportedFollowers:3,reportedFollowing:2};e.ctx.after={reportedFollowers:4,reportedFollowing:2};
 assert.throws(()=>e.run('assertWatchlistCoverage(before,after,4,2)'),{code:'watch_coverage_incomplete'});
});
test('Without a profile total, an exhausted list is never labelled coverage success',async()=>{
 const e=collector();e.ctx.monitorFetchPage=async()=>page([1]);
 const result=await e.run('monitorCollectList("followers","99","p",0,100,"42")');
 assert.equal(result.coverageComplete,null);assert.equal(e.ctx.diagnostics.filter(x=>x.event==='transport_success').length,0);
});
test('Watchlist integration preserves the complete snapshot when recovery still lacks coverage',async()=>{
 const e=collector();const key='followcheck:watchlist:v1:42:99';
 const baseline={comparisonVersion:3,complete:true,viewerUserId:'42',target:{id:'99',reportedFollowers:3,reportedFollowing:2},followers:users(1,2,3),following:users(4,5),completedAt:1};
 e.memory[key]=structuredClone(baseline);
 const totals=[];e.ctx.totals=totals;
 e.run(`assertGlobalSafety=async()=>{};assertGlobalScanBudget=async()=>{};
   resolveMonitorInstagramSession=async()=>({sessionId:'local',userId:'42'});
   getAnyInstagramTab=async()=>({id:1});
   resolveWatchlistTarget=async()=>({id:'99',username:'target',reportedFollowers:3,reportedFollowing:2});
   monitorCollectList=async(kind,id,profile,start,end,viewer,options)=>{totals.push(options.expected);return {users:kind==='followers'?[{id:'1'},{id:'2'}]:[{id:'4'},{id:'5'}],transport:'main',pages:1,expected:options.expected};};`);
 await assert.rejects(e.run('runNativeWatchlistScan({checkId:"test-check",accountId:"42",profileId:"watchlist:42",targetId:"target"})'),{code:'watch_coverage_incomplete'});
 assert.deepEqual(totals,[2,3]);assert.deepEqual(e.memory[key],baseline);
 assert.equal(e.messages.filter(x=>x.event==='watchlist_result').length,0);
});

function connectedPage(fetch) {
 const e=pageEnvironment(fetch);
 e.ctx.requestInstagramMainPage=async(operation,payload)=>{
   const response=await e.request({operation,...payload});
   if(!response.bridgeOk)throw Object.assign(Error(response.error.message),response.error);
   return response.result;
 };
 return e;
}

test('Collector to page executor to HTTP uses only the 2.5.7 parameters on every page',async()=>{
 const requested=[];
 const e=connectedPage(async url=>{
   const parsed=new URL(url,'https://www.instagram.com');requested.push(parsed);
   // Reproduce the observed 400 regression if a synthetic rank parameter leaks.
   if(parsed.searchParams.has('rank_token'))return new Response('{"status":"fail","message":"Invalid request"}',{status:400,headers:{'content-type':'application/json'}});
   return new Response(JSON.stringify(parsed.searchParams.has('max_id')?{users:[{pk:'3'}],has_more:false}:{users:[{pk:'1'},{pk:'2'}],has_more:true,next_max_id:'next-cursor'}),{headers:{'content-type':'application/json'}});
 });
 const result=await collect(e);
 assert.equal(result.coverageComplete,true);assert.equal(result.pass,1);assert.equal(requested.length,2);
 assert.equal(requested[0].search,'?count=100&search_surface=follow_list_page');
 assert.equal(requested[1].search,'?count=100&search_surface=follow_list_page&max_id=next-cursor');
});
test('HTTP 400 is a classified server rejection with its message and no automatic retry',async()=>{
 let calls=0;
 const e=connectedPage(async()=>{calls++;return new Response('{"status":"fail","message":"Invalid request parameters"}',{status:400,headers:{'content-type':'application/json'}});});
 await assert.rejects(collect(e),error=>error.code==='list_request_rejected' && error.status===400 && error.message.includes('HTTP 400') && error.apiMessage==='Invalid request parameters');
 assert.equal(calls,1);
});
test('Failure status in a JSON body cannot masquerade as an empty successful list',async()=>{
 const e=pageEnvironment(async()=>new Response('{"status":"fail","message":"Invalid parameters","users":[]}',{headers:{'content-type':'application/json'}}));
 const result=(await e.request({operation:'monitor-list',kind:'followers',userId:'99'})).result;
 assert.equal(result.ok,false);assert.equal(result.code,'list_response_invalid');
});
test('Structured error types classify limits and challenges even with HTTP 400 or 200',async()=>{
 for(const [status,error_type,expected] of [[400,'feedback_required','soft_throttle'],[400,'rate_limit_error','rate_limited'],[200,'challenge_required','challenge_required'],[400,'login_required','page_main_rejected']]) {
   let calls=0;const e=connectedPage(async()=>{calls++;return new Response(JSON.stringify({status:'fail',error_type,message:error_type}),{status,headers:{'content-type':'application/json'}});});
   await assert.rejects(collect(e),{code:expected});assert.equal(calls,1);
 }
});
test('Server error diagnostics retain a bounded reason while removing credentials and URLs',async()=>{
 const message='Bad request sessionid=SECRET_A csrftoken=SECRET_B Authorization: Bearer SECRET_C password="SECRET_D" https://example.test/?secret=SECRET_E';
 const e=pageEnvironment(async()=>new Response(JSON.stringify({status:'fail',message}),{status:400,headers:{'content-type':'application/json'}}));
 const result=(await e.request({operation:'monitor-list',kind:'followers',userId:'99'})).result;
 const details=JSON.stringify(result.diagnostics);
 for(const secret of ['SECRET_A','SECRET_B','SECRET_C','SECRET_D','SECRET_E','https://example.test'])assert.ok(!details.includes(secret),secret);
 assert.ok(result.diagnostics.apiMessage.startsWith('Bad request'));assert.ok(result.diagnostics.apiMessage.length<=200);
});
test('Non-string error messages are not serialized into diagnostics',async()=>{
 const e=pageEnvironment(async()=>new Response(JSON.stringify({status:'fail',message:{secret:'PRIVATE_BODY'}}),{status:400,headers:{'content-type':'application/json'}}));
 const result=(await e.request({operation:'monitor-list',kind:'followers',userId:'99'})).result;
 assert.equal(result.ok,false);assert.equal(result.diagnostics.apiMessage,null);assert.ok(!JSON.stringify(result.diagnostics).includes('PRIVATE_BODY'));
});
test('A server 400 preserves an existing Watchlist reference and emits no result',async()=>{
 let calls=0;const e=connectedPage(async()=>{calls++;return new Response('{"status":"fail","message":"Bad request"}',{status:400,headers:{'content-type':'application/json'}});});
 const key='followcheck:watchlist:v1:42:99';
 const baseline={comparisonVersion:3,complete:true,viewerUserId:'42',target:{id:'99',reportedFollowers:3,reportedFollowing:2},followers:users(1,2,3),following:users(4,5),completedAt:1};
 e.memory[key]=structuredClone(baseline);
 e.run(`assertGlobalSafety=async()=>{};assertGlobalScanBudget=async()=>{};
   resolveMonitorInstagramSession=async()=>({sessionId:'local',userId:'42'});
   getAnyInstagramTab=async()=>({id:1});
   resolveWatchlistTarget=async()=>({id:'99',username:'target',reportedFollowers:3,reportedFollowing:2});`);
 await assert.rejects(e.run('runNativeWatchlistScan({checkId:"test-check",accountId:"42",profileId:"watchlist:42",targetId:"target"})'),{code:'list_request_rejected'});
 assert.equal(calls,1);assert.deepEqual(e.memory[key],baseline);assert.equal(e.messages.filter(x=>x.event==='watchlist_result').length,0);
});

test('The exact 42-byte empty-message spam response is recognized rather than reported as a cursor error',async()=>{
 const body='{"message":"","spam":true,"status":"fail"}';assert.equal(new TextEncoder().encode(body).length,42);
 const e=pageEnvironment(async()=>new Response(body,{status:400,headers:{'content-type':'application/json'}}));
 const result=(await e.request({operation:'monitor-list',kind:'followers',userId:'99'})).result;
 assert.equal(result.code,'soft_throttle');assert.equal(result.restrictionSignal,'spam');
 assert.equal(result.diagnostics.spamSignal,true);assert.ok(result.diagnostics.schema.includes('spam'));
});
test('A restriction after the first successful page stops the check and opens the existing pause circuit',async()=>{
 let calls=0;const e=connectedPage(async()=>++calls===1?
   new Response('{"users":[{"pk":"1"}],"has_more":true,"next_max_id":"cursor-2"}',{headers:{'content-type':'application/json'}}):
   new Response('{"message":"","spam":true,"status":"fail"}',{status:400,headers:{'content-type':'application/json'}}));
 let failure;try{await collect(e);}catch(error){failure=error;}
 assert.equal(failure.code,'soft_throttle');assert.equal(failure.restrictionSignal,'spam');assert.equal(calls,2);
 e.ctx.failure=failure;await e.run('tripSafetyFromError(failure,"test")');
 assert.equal(e.memory['followcheck:global-safety:v1'].reason,'soft_throttle');assert.ok(e.memory['followcheck:global-safety:v1'].cooldownUntil>Date.now());
});
test('Explicit feedback flag is sufficient even with an empty message and HTTP 200',async()=>{
 const e=pageEnvironment(async()=>new Response('{"message":"","feedback_required":true,"status":"fail"}',{headers:{'content-type':'application/json'}}));
 const result=(await e.request({operation:'monitor-list',kind:'followers',userId:'99'})).result;
 assert.equal(result.code,'soft_throttle');assert.equal(result.diagnostics.feedbackRequiredSignal,true);
});
test('An unquoted 64-bit cursor crosses the complete JSON and bridge path byte-for-byte',async()=>{
 const wanted='18446744073709551615',requests=[];
 const e=connectedPage(async url=>{
  const query=new URL(url,'https://www.instagram.com').searchParams;requests.push(query);
  return new Response(requests.length===1?'{"users":[{"pk":9007199254740993}],"has_more":true,"next_max_id":18446744073709551615}':'{"users":[{"pk":"2"}],"has_more":false}',{headers:{'content-type':'application/json'}});
 });
 const result=await collect(e,2);
 assert.equal(result.coverageComplete,true);assert.equal(result.users[0].id,'9007199254740993');assert.equal(requests[1].get('max_id'),wanted);
});
test('An opaque cursor with percent escapes, plus and padding is encoded exactly once',async()=>{
 const cursor='QV%2Btoken+/=&unicode-ç',requests=[];
 const e=connectedPage(async url=>{
  const query=new URL(url,'https://www.instagram.com').searchParams;requests.push(query);
  return new Response(JSON.stringify(requests.length===1?{users:[{pk:'1'}],has_more:true,next_max_id:cursor}:{users:[{pk:'2'}],has_more:false}),{headers:{'content-type':'application/json'}});
 });
 const result=await collect(e,2);assert.equal(result.coverageComplete,true);assert.equal(requests[1].get('max_id'),cursor);
});
test('An invalid or oversized cursor fails before a second HTTP request',async()=>{
 for(const cursor of [{nested:'value'},'x'.repeat(2049)]) {
  let calls=0;const e=connectedPage(async()=>{calls++;return new Response(JSON.stringify({users:[{pk:'1'}],has_more:true,next_max_id:cursor}),{headers:{'content-type':'application/json'}});});
  await assert.rejects(collect(e,2),{code:'pagination_cursor_invalid'});assert.equal(calls,1);
 }
});
test('An exhausted duplicate-free list rechecks the profile instead of replaying identical conflicting totals',async()=>{
 const e=collector();let calls=0,rechecks=0;
 e.ctx.monitorFetchPage=async()=>{calls++;return page([1,2,3,4]);};
 e.ctx.recheck=async()=>{rechecks++;return 3;};
 const result=await e.run('monitorCollectList("following","99","p",0,100,"42",{expected:3,recheckExpected:recheck})');
 assert.equal(calls,1);assert.equal(rechecks,1);assert.equal(result.coverageComplete,false);
});
test('A refreshed total is verified by an independent new traversal rather than forced to the collected size',async()=>{
 const e=collector();let calls=0;e.ctx.monitorFetchPage=async()=>{calls++;return page([1,2,3,4]);};
 e.ctx.recheck=async()=>4;
 const result=await e.run('monitorCollectList("following","99","p",0,100,"42",{expected:3,recheckExpected:recheck})');
 assert.equal(calls,2);assert.equal(result.pass,2);assert.equal(result.expected,4);assert.equal(result.coverageComplete,true);
});
test('Counter refresh does not accept a different-size second traversal',async()=>{
 const e=collector();let calls=0;e.ctx.monitorFetchPage=async()=>++calls===1?page([1,2,3,4]):page([1,2,3]);e.ctx.recheck=async()=>4;
 const result=await e.run('monitorCollectList("following","99","p",0,100,"42",{expected:3,recheckExpected:recheck})');
 assert.equal(calls,2);assert.equal(result.expected,4);assert.equal(result.coverageComplete,false);
});
test('A one-account surplus on a clean terminal list is accepted in a single traversal (build 33)',async()=>{
 const e=collector(),kinds=[];let profiles=0;
 e.run('assertGlobalSafety=async()=>{};assertGlobalScanBudget=async()=>{};commitGlobalScanBudget=async()=>{};getAnyInstagramTab=async()=>({id:1});resolveMonitorInstagramSession=async()=>({sessionId:"local",userId:"42"});nativePort={postMessage:value=>webkit.messageHandlers.followcheckIOS.postMessage(value)}');
 e.ctx.resolveWatchlistTarget=async()=>{profiles++;return {id:'99',username:'target',reportedFollowers:344,reportedFollowing:343};};
 e.ctx.monitorFetchPage=async kind=>{kinds.push(kind);return page(Array.from({length:344},(_,n)=>n+1));};
 const result=await e.run('runNativeWatchlistScan({checkId:"test-check",accountId:"42",profileId:"watchlist:42",targetId:"target"})');
 assert.deepEqual(kinds,['following','followers']);assert.equal(profiles,2);assert.equal(result.snapshot.following,344);
 assert.equal(e.memory['followcheck:watchlist:v1:42:99'].listValidation.following.mode,'terminal-drift');
});

function prepareWatchlist(e,profile) {
 e.run(`assertGlobalSafety=async()=>{};assertGlobalScanBudget=async()=>{};commitGlobalScanBudget=async()=>{};
   getAnyInstagramTab=async()=>({id:1});resolveMonitorInstagramSession=async()=>({sessionId:'local',userId:'42'});
   nativePort={postMessage:value=>webkit.messageHandlers.followcheckIOS.postMessage(value)};`);
 e.ctx.resolveWatchlistTarget=typeof profile==='function'?profile:async()=>({...profile});
}
const scan=e=>e.run('runNativeWatchlistScan({checkId:"test-check",accountId:"42",profileId:"watchlist:42",targetId:"target"})');
const surplusCollect=e=>e.run('monitorCollectList("following","99","watchlist:42",3,46,"42",{expected:3,recheckExpected:async()=>3,allowStableSurplus:true})');

test('The build 30 fixture completes through HTTP, native bridge and registry with the 343 counter preserved',async()=>{
 const requests=[],pauses=[],notifications=[],progress=[],counts={following:0,followers:0};let profiles=0;
 const e=connectedPage(async url=>{
   const parsed=new URL(url,'https://www.instagram.com'),kind=parsed.pathname.includes('/following/')?'following':'followers';
   const offset=Number(parsed.searchParams.get('max_id')||0),total=kind==='following'?344:1171;
   const pass=kind==='following'?Math.floor(counts.following/14):0;
   const ids=Array.from({length:total},(_,n)=>(kind==='following'?10000:20000)+n+1);
   if(pass===1)ids.reverse(); // Same membership in a different ranking order.
   const last=Math.min(offset+25,total),body={status:'ok',users:ids.slice(offset,last).map(id=>({pk:String(id),username:`user${id}`})),has_more:last<total};
   if(body.has_more)body.next_max_id=String(last);
   counts[kind]++;requests.push({kind,offset,query:Array.from(parsed.searchParams.keys())});
   return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
 });
 prepareWatchlist(e,async()=>{profiles++;return {id:'99',username:'target',reportedFollowers:1171,reportedFollowing:343};});
 e.ctx.postMonitorProgress=(_id,title,detail,percentage)=>{progress.push({title,detail,percentage});if(title==='Pausa protetora')pauses.push(requests.length);};
 e.ctx.chrome.notifications.create=async(_id,value)=>notifications.push(value);
 e.ctx.postMonitorDiagnostic=e.diagnosticPublisher;
 e.memory['followcheck:watchlist:registry:v2:42']={targets:[{id:'target',userId:'99',username:'target',enabled:true,notificationsEnabled:true,intervalMinutes:1440}],events:[]};
 integrate(e);
 const state=await e.run('executeWatchlistTarget("42","target")');
 const result=e.messages.find(value=>value.event==='watchlist_result');
 assert.ok(result);assert.equal(result.baseline,true);assert.equal(result.coverageVerified,false);assert.equal(result.enumerationVerified,true);
 assert.equal(result.snapshot.following,344);assert.equal(result.snapshot.followers,1171);assert.equal(result.reportedCounts.following,343);
 assert.deepEqual(counts,{following:14,followers:47});assert.equal(profiles,2);assert.equal(requests.length,61);
 assert.deepEqual(requests.filter(r=>r.kind==='following'&&r.offset===0).map(r=>r.offset),[0]);
 assert.ok(requests.every(r=>r.query.every(k=>['count','search_surface','max_id'].includes(k))));
 assert.deepEqual(pauses,[15,30,45,60]);assert.ok(progress.some(p=>p.title==='Pausa entre listas'));
 const snapshot=e.memory['followcheck:watchlist:v1:42:99'];
 assert.equal(snapshot.comparisonVersion,5);assert.equal(snapshot.complete,true);assert.equal(snapshot.target.reportedFollowing,343);assert.equal(snapshot.listValidation.following.reported,343);
 assert.equal(snapshot.listValidation.following.mode,'terminal-drift');
 assert.equal(snapshot.listValidation.followers.mode,'count-matched');
 const target=state.targets[0];assert.equal(target.baselineReady,true);assert.equal(target.lastErrorCode,'',target.lastError);assert.equal(target.lastChangeCount,0);
 assert.equal(target.following,344);assert.equal(target.reportedFollowing,343);assert.equal(target.coverageVerified,false);
 assert.equal(state.events.filter(x=>x.type==='watch_count_warning').length,0);assert.equal(notifications.length,1);assert.match(notifications[0].message,/Referência/);
 await microtasks();
 assert.ok(e.messages.some(x=>x.kind==='iosState'&&x.watchlist.targets[0]?.coverageVerified===false));
 await e.run('backgroundLogWrites');
 const logs=e.memory['followcheck:technical-logs:background:v1'];
 assert.ok(logs.some(x=>x.event==='count_drift_accepted'));assert.ok(!logs.some(x=>x.event==='coverage_retry'));
 const diagnostics=JSON.stringify(logs);
 assert.ok(!diagnostics.includes('"10001"'));assert.ok(!diagnostics.includes('stableIdentityIds'));
 assert.deepEqual(e.memory['followcheck:ios:list-checkpoints:v1'],{});
});

test('A duplicate in either traversal prevents stable surplus validation',async()=>{
 for(const duplicatePass of [1,2]) {
  const e=collector();let calls=0;e.ctx.monitorFetchPage=async()=>{calls++;return page(calls===duplicatePass?[1,2,3,4,1]:[1,2,3,4]);};
  const result=await surplusCollect(e);
  assert.equal(calls,2);assert.equal(result.coverageComplete,false);assert.notEqual(result.enumerationVerified,true);
 }
});
test('A duplicate-free shortfall still blocks even when stable-surplus support is enabled',async()=>{
 const e=collector();let calls=0;e.ctx.monitorFetchPage=async()=>{calls++;return page([1,2]);};
 const result=await surplusCollect(e);assert.equal(calls,1);assert.equal(result.coverageComplete,false);assert.equal(result.enumerationVerified,false);
});
test('A second surplus with a different size never combines the two observations',async()=>{
 const e=collector();let calls=0;e.ctx.monitorFetchPage=async()=>++calls===1?page([1,2,3,4]):page([2,3,4,5,6]);
 const result=await surplusCollect(e);assert.equal(calls,2);assert.equal(result.users.length,5);assert.equal(result.enumerationVerified,false);
});
test('A second traversal matching the unchanged counter remains a normal count-matched result',async()=>{
 const e=collector();let calls=0;e.ctx.monitorFetchPage=async()=>++calls===1?page([1,2,3,4]):page([2,3,4]);
 const result=await surplusCollect(e);assert.equal(calls,2);assert.equal(result.countVerified,true);assert.equal(result.validationMode,'count-matched');
 assert.deepEqual(Array.from(result.users,x=>x.id),['2','3','4']);
});
test('A surplus verification paused during pass two resumes its persisted first-pass identities',async()=>{
 const e=collector();let calls=0;
 e.ctx.monitorFetchPage=async()=>{calls++;if(calls===1)return page([1,2,3,4]);if(calls===2)return page([4,3],true,'resume-pass-two');throw Object.assign(Error('paused'),{code:'ios_paused'});};
 await assert.rejects(surplusCollect(e),{code:'ios_paused'});
 const resumed=collector();Object.assign(resumed.memory,structuredClone(e.memory));let resumedCalls=0;
 resumed.ctx.monitorFetchPage=async(_kind,_transport,_id,cursor)=>{resumedCalls++;assert.equal(cursor,'resume-pass-two');return page([2,1]);};
 const result=await surplusCollect(resumed);assert.equal(resumedCalls,1);assert.equal(result.pass,2);assert.equal(result.validationMode,'stable-surplus');
 assert.equal(result.countVerified,false);assert.equal(result.independentPasses,2);
});
test('Resuming a surplus verification cannot accept different second-pass identities',async()=>{
 const e=collector();let calls=0;e.ctx.monitorFetchPage=async()=>{if(++calls===1)return page([1,2,3,4]);if(calls===2)return page([4,3],true,'resume');throw Object.assign(Error('paused'),{code:'ios_paused'});};
 await assert.rejects(surplusCollect(e),{code:'ios_paused'});
 const resumed=collector();Object.assign(resumed.memory,structuredClone(e.memory));resumed.ctx.monitorFetchPage=async()=>page([2,5]);
 const result=await surplusCollect(resumed);assert.equal(result.pass,2);assert.equal(result.enumerationVerified,false);
});
test('An older count-only checkpoint is not reused as stable enumeration evidence',async()=>{
 const e=collector();e.memory['followcheck:ios:list-checkpoints:v1']={'42:watchlist:42:99:following':{paginationVersion:3,pass:2,knownTotal:3,at:Date.now(),users:users(1,2,3,4),cursors:[],cursor:null,hasNext:false,expected:3,pageNumber:1,receivedUsers:4}};
 let calls=0;e.ctx.monitorFetchPage=async()=>{calls++;return page([1,2,3,4]);};
 const result=await surplusCollect(e);assert.equal(calls,2);assert.equal(result.validationMode,'stable-surplus');
});
test('A rejection during the second surplus traversal preserves both snapshot and existing result',async()=>{
 let calls=0;const e=connectedPage(async()=>++calls===1?
  new Response('{"users":[{"pk":"1"},{"pk":"2"},{"pk":"3"},{"pk":"4"}],"has_more":false}',{headers:{'content-type':'application/json'}}):
  new Response('{"status":"fail","message":"Invalid request"}',{status:400,headers:{'content-type':'application/json'}}));
 prepareWatchlist(e,{id:'99',username:'target',reportedFollowers:2,reportedFollowing:3});
 const baseline={complete:true,marker:'existing reference'},key='followcheck:watchlist:v1:42:99';e.memory[key]=structuredClone(baseline);
 await assert.rejects(scan(e),{code:'list_request_rejected'});assert.equal(calls,2);assert.deepEqual(e.memory[key],baseline);
 assert.equal(e.messages.filter(x=>x.event==='watchlist_result').length,0);
});
test('A final profile count change rejects an otherwise stable surplus and preserves the baseline',async()=>{
 const e=collector();let profiles=0;
 prepareWatchlist(e,async()=>({id:'99',username:'target',reportedFollowers:2,reportedFollowing:++profiles<2?3:10}));
 e.ctx.monitorFetchPage=async kind=>page(kind==='following'?[1,2,3,4]:[5,6]);
 const baseline={complete:true,marker:'preserve'},key='followcheck:watchlist:v1:42:99';e.memory[key]=structuredClone(baseline);
 await assert.rejects(scan(e),{code:'watch_coverage_incomplete'});assert.deepEqual(e.memory[key],baseline);
 assert.equal(e.messages.filter(x=>x.event==='watchlist_result').length,0);
});
test('Stable surplus can independently validate both relations without rewriting either counter',async()=>{
 const e=collector();prepareWatchlist(e,{id:'99',username:'target',reportedFollowers:3,reportedFollowing:2});
 const kinds=[];e.ctx.monitorFetchPage=async kind=>{kinds.push(kind);return page(kind==='following'?[1,2,3]:[4,5,6,7]);};
 const result=await scan(e);assert.deepEqual(kinds,['following','followers']);
 assert.equal(result.coverageWarnings.length,0);assert.equal(result.snapshot.followers,4);assert.equal(result.reportedCounts.followers,3);
 assert.equal(result.coverageVerified,false);assert.equal(result.relationCoverage.following,false);assert.equal(result.relationCoverage.followers,false);
});

function comparisonFixture() {
 return {comparisonVersion:4,complete:true,viewerUserId:'42',target:{id:'99',reportedFollowers:2,reportedFollowing:3},
  followers:users(10,11),following:users(1,2,3,4),listValidation:{
   followers:{mode:'count-matched',terminal:true,observed:2,reported:2},
   following:{mode:'stable-surplus',terminal:true,observed:4,reported:3,independentPasses:2,stableIdentityIds:['4','3','2','1']}}};
}
test('A saved stable-surplus reference requires matching identities, totals and two terminal traversals',()=>{
 const e=collector();e.ctx.snapshot=comparisonFixture();assert.equal(e.run('validWatchlistComparisonSnapshot(snapshot,"42","99")'),true);
 const mutations=[s=>s.listValidation.following.stableIdentityIds.pop(),s=>s.listValidation.following.stableIdentityIds[0]='900',s=>s.listValidation.following.independentPasses=1,
  s=>s.listValidation.following.terminal=false,s=>s.listValidation.following.observed=3,s=>s.listValidation.following.reported=4,s=>s.target.reportedFollowing=4,
  s=>s.following[0].id='2',s=>s.following[0].id='invalid',s=>s.viewerUserId='7',s=>s.target.id='8',s=>s.complete=false];
 for(const mutate of mutations){e.ctx.snapshot=comparisonFixture();mutate(e.ctx.snapshot);assert.equal(e.run('validWatchlistComparisonSnapshot(snapshot,"42","99")'),false);}
});
test('Existing count-matched version 3 references remain usable and partial old references do not',()=>{
 const e=collector();e.ctx.snapshot={comparisonVersion:3,complete:true,viewerUserId:'42',target:{id:'99',reportedFollowers:2,reportedFollowing:2},followers:users(1,2),following:users(3,4)};
 assert.equal(e.run('validWatchlistComparisonSnapshot(snapshot,"42","99")'),true);
 e.ctx.snapshot.target.reportedFollowing=3;assert.equal(e.run('validWatchlistComparisonSnapshot(snapshot,"42","99")'),false);
});
test('Stable membership proof cannot substitute different aggregate counts at the final gate',()=>{
 const e=collector();e.ctx.before={reportedFollowers:2,reportedFollowing:3};e.ctx.after=e.ctx.before;
 e.ctx.lists={followers:{terminal:true,users:users(8,9)},following:{terminal:true,users:users(1,2,3,4),enumerationVerified:true,validationMode:'stable-surplus',independentPasses:2,duplicates:0,stableIdentityIds:['1','2','3','4']}};
 assert.doesNotThrow(()=>e.run('assertWatchlistCoverage(before,after,2,4,lists)'));
 assert.throws(()=>e.run('assertWatchlistCoverage(before,after,2,999,lists)'),{code:'watch_coverage_incomplete'});
});
test('Comparing a prior surplus reference to exact counts keeps affected changes observational',async()=>{
 const e=collector(),key='followcheck:watchlist:v1:42:99';e.memory[key]=comparisonFixture();
 e.memory[key].pendingStoppedFollowing=users(1);e.memory[key].target.username='target';
 prepareWatchlist(e,{id:'99',username:'target',reportedFollowers:2,reportedFollowing:3});
 e.ctx.monitorFetchPage=async kind=>page(kind==='following'?[2,3,5]:[10,12]);
 const result=await scan(e);assert.equal(result.baseline,false);assert.equal(result.comparisonVerified,true);assert.equal(result.coverageVerified,true);
 assert.equal(result.relationCoverage.following,false);assert.equal(result.relationCoverage.followers,true);
 e.ctx.result=result;e.ctx.target={id:'target',username:'target'};
 const events=e.run('watchlistEventsFromResult(target,result)');
 const entry=events.find(x=>x.type==='watch_started_following'),exit=events.find(x=>x.type==='watch_stopped_following');
 assert.match(entry.title,/Novo perfil/);assert.match(exit.title,/deixou de aparecer/);assert.equal(entry.coverageVerified,false);assert.equal(exit.coverageVerified,false);
 assert.equal(events.find(x=>x.type==='watch_new_follower').coverageVerified,true);assert.ok(events.every(x=>x.comparisonVerified));
});
test('An unchanged stable-surplus result adds a count warning without a change alert',async()=>{
 const e=collector(),notifications=[];e.ctx.chrome.notifications.create=async(_id,value)=>notifications.push(value);
 e.memory['followcheck:watchlist:registry:v2:42']={targets:[{id:'target',username:'target',enabled:true,notificationsEnabled:true}],events:[]};
 e.ctx.result={completedAt:1234,baseline:false,comparisonVerified:true,coverageVerified:false,enumerationVerified:true,coverageWarnings:['4 observados; contador 3.'],reportedCounts:{followers:2,following:3},target:{id:'99',username:'target'},snapshot:{followers:2,following:4},changes:{}};
 const state=await e.run('completeWatchlistTarget("42","target",result)');
 assert.equal(state.targets[0].lastChangeCount,0);assert.equal(state.events.length,1);assert.equal(state.events[0].type,'watch_count_warning');assert.equal(notifications.length,0);
});
test('A real profile total change from 343 to 344 can complete only after a new traversal and a matching final profile',async()=>{
 const e=collector(),kinds=[];let profiles=0;
 e.run('assertGlobalSafety=async()=>{};assertGlobalScanBudget=async()=>{};commitGlobalScanBudget=async()=>{};getAnyInstagramTab=async()=>({id:1});resolveMonitorInstagramSession=async()=>({sessionId:"local",userId:"42"});nativePort={postMessage:value=>webkit.messageHandlers.followcheckIOS.postMessage(value)}');
 e.ctx.resolveWatchlistTarget=async()=>({id:'99',username:'target',reportedFollowers:2,reportedFollowing:++profiles===1?343:344});
 e.ctx.monitorFetchPage=async kind=>{kinds.push(kind);return page(kind==='following'?Array.from({length:344},(_,n)=>n+1):[1,2]);};
 const result=await e.run('runNativeWatchlistScan({checkId:"test-check",accountId:"42",profileId:"watchlist:42",targetId:"target"})');
 assert.deepEqual(kinds,['following','followers']);assert.equal(profiles,2);assert.equal(result.snapshot.following,344);
 assert.equal(e.memory['followcheck:watchlist:v1:42:99'].complete,true);assert.equal(e.memory['followcheck:watchlist:v1:42:99'].target.reportedFollowing,344);
});
