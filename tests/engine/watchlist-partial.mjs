// FollowCheck 2.6: per-list Watchlist validation, reproduced from the device
// diagnostics of 2026-10-17 (builds 32 and 33). No request reaches Instagram.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const base = new URL('../../FollowCheckIOS/Extension/', import.meta.url);
const source = name => fs.readFileSync(new URL(name, base), 'utf8');

function environment(fetch) {
  const memory = {'followcheck:global-safety:migration:v1':2};
  const messages = [], listeners = {};
  let timer = 0;
  const event = () => ({addListener(){},removeListener(){}});
  const ctx = vm.createContext({URL,URLSearchParams,AbortController,Response,Headers,TextEncoder,TextDecoder,
    structuredClone,Date,Promise,Map,Set,Uint8Array,ArrayBuffer,Blob,
    crypto:{randomUUID:()=>`test-${++timer}`}, performance:{now:()=>Date.now()},
    console:{log(){},info(){},debug(){},warn(){},error(){}},
    setTimeout:()=>++timer,clearTimeout:()=>{},setInterval:()=>++timer,clearInterval:()=>{},
    addEventListener:(name,fn)=>{(listeners[name] ||= []).push(fn);},
    document:{hidden:false,cookie:'ds_user_id=42',documentElement:{dataset:{}},body:{innerText:''},querySelector:()=>null,
      addEventListener:(name,fn)=>{(listeners[name] ||= []).push(fn);},dispatchEvent:e=>{for(const fn of listeners[e.type]||[]) fn(e);}},
    CustomEvent:class {constructor(type,options={}){this.type=type;this.detail=options.detail;}},
    location:new URL('https://www.instagram.com/'),
    webkit:{messageHandlers:{followcheckIOS:{postMessage:v=>messages.push(v)}}},
    fetch,
    chrome:{
      runtime:{onMessage:event(),onConnect:event(),getURL:path=>`followcheck-test:///${path}`,connectNative:()=>({postMessage:v=>messages.push(v),onMessage:event(),onDisconnect:event()})},
      notifications:{onClicked:event(),create:async()=>true},
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
  vm.runInContext(`
    inspectInstagramSessionForNative = async()=>{};requestNativeSnapshot = async()=>{};watchlistOwnerId = async()=> '42';
    postMonitorProgress = ()=>{}; postMonitorStopped = ()=>{}; monitorSleep=async()=>{};
    assertGlobalSafety=async()=>{};assertGlobalScanBudget=async()=>{};commitGlobalScanBudget=async()=>{};
    getAnyInstagramTab=async()=>({id:1});resolveMonitorInstagramSession=async()=>({sessionId:'local',userId:'42'});
    nativePort={postMessage:value=>webkit.messageHandlers.followcheckIOS.postMessage(value)};
  `,ctx);
  ctx.diagnostics=[];
  vm.runInContext('postMonitorDiagnostic=(profileId,event,meta)=>diagnostics.push({event,meta});',ctx);
  vm.runInContext(source('page-executor.js'),ctx);
  const request=async message=>{
    const id='request-'+(++timer); let response;
    ctx.document.addEventListener('followcheck:page-executor:response:v1',event=>{const value=JSON.parse(event.detail);if(value.requestId===id) response=value;});
    await listeners['followcheck:page-executor:request:v1'][0]({detail:JSON.stringify({requestId:id,...message})});
    return response;
  };
  ctx.requestInstagramMainPage=async(operation,payload)=>{
    const response=await request({operation,...payload});
    if(!response.bridgeOk)throw Object.assign(Error(response.error.message),response.error);
    return response.result;
  };
  return {ctx,memory,messages,run:code=>vm.runInContext(code,ctx)};
}

// Followers as observed on the device: 1173 rows over 47 pages, 916 distinct
// accounts, 257 repeats; following: 344 accounts for a counter of 343.
function deviceLists({followersShuffled=true,followingIds=null}={}) {
  const rows=[];
  for(let id=1;id<=916;id++){rows.push(20000+id);if(id%4===0 && rows.length<1173)rows.push(20000+id-2);}
  while(rows.length<1173)rows.push(20000+((rows.length*7)%916)+1);
  const followers=followersShuffled?rows:Array.from({length:1171},(_,n)=>20000+n+1);
  return {followers,following:followingIds||Array.from({length:344},(_,n)=>10000+n+1)};
}
function instagram(lists,counts) {
  return async url=>{
    const parsed=new URL(url,'https://www.instagram.com'),kind=parsed.pathname.includes('/following/')?'following':'followers';
    const offset=Number(parsed.searchParams.get('max_id')||0),ids=lists[kind];
    counts[kind]=(counts[kind]||0)+1;
    const last=Math.min(offset+25,ids.length),body={status:'ok',users:ids.slice(offset,last).map(id=>({pk:String(id),username:`user${id}`})),has_more:last<ids.length};
    if(body.has_more)body.next_max_id=String(last);
    return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
  };
}
const users=ids=>ids.map(id=>({id:String(id),username:`user${id}`}));
const plain=value=>JSON.parse(JSON.stringify(value));
const scan=e=>e.run('runNativeWatchlistScan({checkId:"device-check",accountId:"42",profileId:"watchlist:42",targetId:"target"})');
const key='followcheck:watchlist:v1:42:99';
const profile=e=>{e.ctx.resolveWatchlistTarget=async()=>({id:'99',username:'priscila',reportedFollowers:1171,reportedFollowing:343});};

test('Device diagnostic: following is accepted in one pass and shuffled followers stop early',async()=>{
  const counts={};const e=environment(instagram(deviceLists(),counts));profile(e);
  const result=await scan(e);
  assert.deepEqual(plain(counts),{following:14,followers:4},'no re-read of following; followers stop once they repeat');
  assert.equal(result.baseline,true);assert.equal(result.snapshot.following,344);
  const observed=result.partialLists.followers.observed;
  assert.ok(observed>50 && observed<100);assert.equal(result.partialLists.followers.reported,1171);assert.ok(result.partialLists.followers.duplicates>=8);
  assert.equal(result.partialLists.following,null);
  const snapshot=e.memory[key];
  assert.equal(snapshot.comparisonVersion,5);assert.equal(snapshot.listValidation.following.mode,'terminal-drift');
  assert.equal(snapshot.listValidation.followers.mode,'partial-observation');
  assert.deepEqual(plain(e.run(`watchlistReferenceLists(${JSON.stringify(snapshot)},"42","99")`)),{followers:false,following:true});
  assert.equal(e.ctx.diagnostics.filter(x=>x.event==='ordering_unstable' && x.meta.stoppedEarly).length,1);
  assert.equal(e.ctx.diagnostics.filter(x=>x.event==='coverage_retry').length,0);
  assert.equal(e.ctx.diagnostics.filter(x=>x.event==='count_drift_accepted').length,1);
});

test('Device diagnostic (build 33): a spam stop during followers keeps the verified following list',async()=>{
  const counts={};const lists=deviceLists({followersShuffled:false});const serve=instagram(lists,counts);
  const e=environment(async url=>{
    if(url.includes('/followers/') && (counts.followers||0)>=13){counts.followers++;return new Response('{"status":"fail","message":"Please wait a few minutes","spam":true}',{status:400,headers:{'content-type':'application/json'}});}
    return serve(url);
  });
  let profiles=0;e.ctx.resolveWatchlistTarget=async()=>{profiles++;return {id:'99',username:'priscila',reportedFollowers:1171,reportedFollowing:343};};
  const result=await scan(e);
  assert.equal(result.interrupted,'soft_throttle');assert.equal(profiles,1,'no profile request after the limit');
  assert.equal(counts.following,14);assert.equal(counts.followers,14);
  assert.deepEqual(plain(result.comparedLists),{followers:false,following:false});
  assert.equal(result.partialLists.followers.interrupted,true);assert.equal(result.partialLists.followers.observed,325);
  const snapshot=e.memory[key];
  assert.equal(snapshot.following.length,344);assert.equal(snapshot.listValidation.following.mode,'terminal-drift');
  assert.deepEqual(plain(e.run(`watchlistReferenceLists(${JSON.stringify(snapshot)},"42","99")`)),{followers:false,following:true});
  const safety=await e.run('readGlobalSafetyState()');assert.equal(safety.reason,'soft_throttle');assert.equal(safety.blocked,true);
});

test('A partial followers observation keeps the last proven followers reference and still compares following',async()=>{
  const counts={};
  const following=[...Array.from({length:343},(_,n)=>10000+n+1),10999];
  const e=environment(instagram(deviceLists({followingIds:following}),counts));profile(e);
  e.memory[key]={comparisonVersion:4,complete:true,viewerUserId:'42',target:{id:'99',username:'priscila',reportedFollowers:1171,reportedFollowing:343},
    followers:users(Array.from({length:1171},(_,n)=>20000+n+1)),following:users(Array.from({length:343},(_,n)=>10000+n+1)),
    listValidation:{followers:{mode:'count-matched',terminal:true,observed:1171,reported:1171},following:{mode:'count-matched',terminal:true,observed:343,reported:343}},
    pendingRemovedFollowers:[],pendingStoppedFollowing:[],completedAt:1};
  e.run('classifyWatchlistRemoved=async(removed,current,pending)=>({confirmed:[],unavailable:[],pending:removed})');
  const result=await scan(e);
  assert.equal(result.baseline,false);assert.equal(result.comparisonVerified,true);
  assert.deepEqual(plain(result.comparedLists),{followers:false,following:true});
  assert.deepEqual(Array.from(result.changes.startedFollowing,x=>x.id),['10999']);
  assert.equal(result.changes.newFollowers.length,0);assert.equal(result.changes.lostFollowers.length,0);
  const snapshot=e.memory[key];
  assert.equal(snapshot.followers.length,1171,'the complete followers reference is carried forward');
  assert.equal(snapshot.listValidation.followers.mode,'count-matched');assert.equal(snapshot.listValidation.followers.reported,1171);
  assert.equal(snapshot.observations.followers.mode,'partial-observation');assert.ok(snapshot.observations.followers.observed<1171);
  assert.deepEqual(plain(e.run(`watchlistReferenceLists(${JSON.stringify(snapshot)},"42","99")`)),{followers:true,following:true});
});

test('A counter drift beyond the tolerance still needs a second traversal',async()=>{
  const counts={};const e=environment(instagram({followers:Array.from({length:1171},(_,n)=>20000+n+1),following:Array.from({length:360},(_,n)=>10000+n+1)},counts));profile(e);
  await scan(e);
  assert.equal(counts.following,30,'a large surplus is only accepted after an identical second traversal');
  assert.equal(e.memory[key].listValidation.following.mode,'stable-surplus');
  assert.equal(e.ctx.diagnostics.filter(x=>x.event==='count_drift_accepted').length,0);
  assert.equal(e.ctx.diagnostics.filter(x=>x.event==='coverage_retry').length,1);
});

test('When both lists are shuffled nothing is committed and the reference is preserved',async()=>{
  const counts={};const lists=deviceLists();
  const shuffledFollowing=[];for(let id=1;id<=300;id++){shuffledFollowing.push(10000+id);if(id%5===0)shuffledFollowing.push(10000+id-1);}
  const e=environment(instagram({followers:lists.followers,following:shuffledFollowing},counts));
  e.ctx.resolveWatchlistTarget=async()=>({id:'99',username:'priscila',reportedFollowers:1171,reportedFollowing:343});
  const baseline={complete:true,marker:'preserve'};e.memory[key]=structuredClone(baseline);
  await assert.rejects(scan(e),{code:'watch_coverage_incomplete'});
  assert.deepEqual(e.memory[key],baseline);assert.equal(e.messages.filter(x=>x.event==='watchlist_result').length,0);
});

test('A short list without repeats is not accepted as partial and still blocks the check',async()=>{
  const counts={};const e=environment(instagram({followers:Array.from({length:1100},(_,n)=>20000+n+1),following:Array.from({length:343},(_,n)=>10000+n+1)},counts));profile(e);
  await assert.rejects(scan(e),{code:'watch_coverage_incomplete'});
  assert.equal(counts.followers,44,'an unchanged counter with no repeats needs no second traversal');
});

test('After a spam signal the pause follows the user preference, one hour by default',async()=>{
  const e=environment(async()=>{throw Error('no network');});
  e.ctx.failure=Object.assign(Error('spam'),{code:'soft_throttle'});
  let before=Date.now();await e.run('tripSafetyFromError(failure,"test")');
  let state=e.memory['followcheck:global-safety:v1'];
  assert.equal(state.reason,'soft_throttle');assert.ok(Math.abs(state.cooldownUntil-(before+60*60_000))<5000,'one hour without a preference');
  const chosen=environment(async()=>{throw Error('no network');});
  chosen.memory['followcheck:ios:cooldown-minutes:v1']=5;chosen.ctx.failure=e.ctx.failure;
  before=Date.now();await chosen.run('tripSafetyFromError(failure,"test")');
  state=chosen.memory['followcheck:global-safety:v1'];
  assert.ok(Math.abs(state.cooldownUntil-(before+5*60_000))<5000,'the chosen five minutes');
});

test('Ending the local wait after a spam signal is the user decision',async()=>{
  const e=environment(async()=>{throw Error('no network');});
  vm.runInContext(source('ios-engine.js'),e.ctx);
  e.ctx.failure=Object.assign(Error('spam'),{code:'soft_throttle'});
  await e.run('tripSafetyFromError(failure,"test")');
  const now=Date.now();
  await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('cooldown',{minutes:60,release:true});
  assert.ok(e.memory['followcheck:global-safety:v1'].cooldownUntil<=now+1000);
  assert.equal((await e.run('readGlobalSafetyState()')).blocked,false);
});

test('A version 5 reference never accepts a partial or altered list',()=>{
  const e=environment(async()=>{throw Error('no network');});
  const base=()=>({comparisonVersion:5,complete:true,viewerUserId:'42',target:{id:'99'},followers:users([1,2]),following:users([3,4,5]),
    listValidation:{followers:{mode:'count-matched',terminal:true,observed:2,reported:2},following:{mode:'partial-observation',terminal:true,observed:3,reported:9}}});
  const check=s=>JSON.parse(JSON.stringify(e.run(`watchlistReferenceLists(${JSON.stringify(s)},"42","99")`)));
  assert.deepEqual(check(base()),{followers:true,following:false});
  for(const mutate of [s=>s.followers.pop(),s=>s.listValidation.followers.reported=3,s=>s.followers[1].id='1',s=>s.listValidation.followers.terminal=false,s=>s.viewerUserId='7']) {
    const s=base();mutate(s);assert.equal(check(s),null);
  }
});

test('Ending the local wait never clears a security hold',async()=>{
  const e=environment(async()=>{throw Error('no network');});
  vm.runInContext(source('ios-engine.js'),e.ctx);
  await e.run('tripGlobalSafety("challenge_required","verify",{manualResetRequired:true})');
  await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('cooldown',{minutes:5,release:true});
  assert.equal((await e.run('readGlobalSafetyState()')).manualResetRequired,true);
});

test('Ending the wait keeps a server deadline, stays blocked and rejects invalid durations',async()=>{
  const e=environment(async()=>{throw Error('no network');});
  vm.runInContext(source('ios-engine.js'),e.ctx);
  const until=Date.now()+3*60*60_000;e.ctx.until=until;
  await e.run('tripGlobalSafety("rate_limited","wait",{manualResetRequired:false,serverCooldownUntil:until})');
  await e.ctx.__FOLLOWCHECK_IOS_CONTROL__('cooldown',{minutes:1,release:true});
  const state=await e.run('readGlobalSafetyState()');
  assert.equal(state.cooldownUntil,until);assert.equal(state.blocked,true);
  await assert.rejects(e.ctx.__FOLLOWCHECK_IOS_CONTROL__('cooldown',{minutes:-1}),{code:'invalid_setting'});
});
