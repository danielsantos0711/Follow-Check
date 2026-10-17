/* Observes a normally rendered profile in a session-owned WebKit view. No API requests. */
(() => {
  'use strict';
  const config=globalThis.__FC_PROFILE_CONFIG__ || {};
  const wanted=String(config.username||'').toLowerCase();
  const expected=String(config.userId||'');
  const viewer=String(config.viewerId||'');
  const state={user:null,identity:null,code:'',source:'',responses:0,scripts:0,nodes:0,matched:0,retryAfter:0};
  const listMode=config.goal==='list' && ['followers','following'].includes(config.listKind);
  const listKind=String(config.listKind||'');
  const expectedCount=Number(config.expectedCount);
  const members=new Map();
  const listing={pages:0,raw:0,duplicates:0,invalid:0,terminal:false,opened:false,lastScroll:0,lastPageAt:0,pauseUntil:0,pausedPage:0,inflight:0,viewerProof:null,viewerIncluded:false,queryKeys:[]};
  const seenScripts=new WeakSet();
  const exact=v => (typeof v==='number' || typeof v==='string' && /^\d+$/.test(v)) && Number.isSafeInteger(Number(v)) && Number(v)>=0 ? Number(v):null;
  const idOf=v => {const raw=v.pk ?? v.id;return (typeof raw==='string' || Number.isSafeInteger(raw)) && /^\d{1,32}$/.test(String(raw||''))?String(raw):'';};
  function requestInfo(url,body) {
    let address;try{address=new URL(String(url?.url||url||''),location.href);}catch{return {};}
    const match=address.pathname.match(/^\/api\/v1\/friendships\/(\d+)\/(followers|following)\/?$/);
    if(match){const isList=listMode && match[1]===expected && match[2]===listKind;return {isList,tracksList:isList,targetMatched:match[1]===expected,kind:match[2],keys:[...address.searchParams.keys()]};}
    if(!listMode || !address.pathname.startsWith('/graphql'))return {};
    const params=new URLSearchParams(typeof body==='string'?body:body?.toString?.()||address.search);
    let variables;try{variables=JSON.parse(params.get('variables')||address.searchParams.get('variables')||'{}');}catch{variables={};}
    const stack=[variables];let targetMatched=false,steps=0;
    while(stack.length && ++steps<1000){const item=stack.pop();if(!item || typeof item!=='object')continue;for(const [key,value] of Object.entries(item)){if(['id','user_id','userID','target_user_id'].includes(key)&&String(value)===expected)targetMatched=true;else if(value && typeof value==='object')stack.push(value);}}
    const name=params.get('fb_api_req_friendly_name')||'';
    const kind=/followers/i.test(name)?'followers':/following/i.test(name)?'following':null;
    // A GraphQL response can identify its owner in the payload instead of the
    // request. Keep it pending until parsing finishes, even without a query name.
    return {isList:targetMatched && kind===listKind,tracksList:true,targetMatched,kind,keys:[...new Set([...params.keys(),...Object.keys(variables)])].slice(0,24)};
  }
  function acceptPage(users,frame,info) {
    listing.pages++;listing.raw+=users.length;listing.lastPageAt=Date.now();listing.queryKeys=info.keys||[];
    if(listing.pages>2000){state.code='list_page_limit';return;}
    for(const raw of users){const value=raw?.node||raw;const id=idOf(value||{});if(!id){listing.invalid++;continue;}
      if(members.has(id))listing.duplicates++;
      members.set(id,{id,username:String(value.username||'').slice(0,30),full_name:String(value.full_name||'').slice(0,160),profile_pic_url:String(value.profile_pic_url_hd||value.profile_pic_url||'').slice(0,2000),is_private:value.is_private===true});
    }
    // Every accepted page needs its own end-of-list evidence. An unrecognised
    // page cannot inherit a terminal marker from an earlier response.
    const endings=[];
    if(typeof frame.has_more==='boolean')endings.push(!frame.has_more);
    if(typeof frame.page_info?.has_next_page==='boolean')endings.push(!frame.page_info.has_next_page);
    for(const key of ['next_max_id','next_cursor','next_max_id_str'])if(Object.prototype.hasOwnProperty.call(frame,key))endings.push(!frame[key]);
    listing.terminal=endings.length>0 && endings.every(Boolean);
    if(endings.some(Boolean) && endings.some(value=>!value))state.code='list_pagination_conflict';
  }
  function consumeList(root,info={}) {
    if(!listMode)return;
    const stack=[{value:root,key:'',ownerId:''}],seen=new WeakSet();let visited=0;
    while(stack.length && ++visited<40000){const {value,key,ownerId}=stack.pop();if(!value||typeof value!=='object'||seen.has(value))continue;seen.add(value);
      // A nested profile owns its own connections. Request-level evidence is
      // only usable when the payload has not identified a different owner.
      const currentOwner=idOf(value)||ownerId;
      const ownerMatches=currentOwner ? currentOwner===expected : info.targetMatched===true;
      const keyMatches=listKind==='followers'?/followers|edge_followed_by/i.test(key):/following|edge_follow$/i.test(key);
      if(Array.isArray(value.users) && info.isList && ownerMatches){acceptPage(value.users,value,info);return;}
      if(Array.isArray(value.edges) && keyMatches && ownerMatches){acceptPage(value.edges,value,info);return;}
      for(const [childKey,child] of Object.entries(value))if(child && typeof child==='object')stack.push({value:child,key:childKey,ownerId:currentOwner});
    }
  }
  function inspect(root,source) {
    const stack=[{value:root,depth:0}],seen=new WeakSet();let visited=0;
    while(stack.length) {
      const {value,depth}=stack.pop();if(!value || typeof value!=='object' || seen.has(value))continue;
      if(++visited>40000 || depth>45)return;
      seen.add(value);state.nodes++;
      const id=idOf(value);
      if(id && String(value.username||'').toLowerCase()===wanted) {
        state.matched++;
        if(expected && id!==expected){state.code='watch_target_changed';return;}
        if(state.identity && state.identity.id!==id){state.code='profile_identity_conflict';return;}
        const identity={id,username:String(value.username),full_name:String(value.full_name||'').slice(0,160),profile_pic_url:String(value.profile_pic_url_hd||value.profile_pic_url||'').slice(0,2000),is_private:value.is_private===true};
        state.identity=identity;
        const proof=listKind==='followers' ? (value.followed_by_viewer ?? value.friendship_status?.following) : (value.follows_viewer ?? value.friendship_status?.followed_by);
        if(typeof proof==='boolean'){if(listing.viewerProof!==null && listing.viewerProof!==proof)state.code='profile_relationship_changed';listing.viewerProof=proof;}
        const followers=exact(value.follower_count ?? value.edge_followed_by?.count);
        const following=exact(value.following_count ?? value.edge_follow?.count);
        if(followers!==null && following!==null) {
          if(state.user && (state.user.follower_count!==followers || state.user.following_count!==following)){state.code='profile_counts_conflict';return;}
          state.user={...identity,follower_count:followers,following_count:following};state.source=source;
        }
      }
      for(const child of Object.values(value))if(child && typeof child==='object')stack.push({value:child,depth:depth+1});
    }
  }
  function parseJSON(text,source,info={}) {if(typeof text!=='string'||text.length>2*1024*1024)return;try{const value=JSON.parse(text.replace(/^for\s*\(;;\);\s*/,''));inspect(value,source);consumeList(value,info);}catch{}}
  function apiResponse(url,status,retry='') {
    let path='';try{path=new URL(String(url||''),location.href).pathname;}catch{}
    if((path.startsWith('/api/') || path.startsWith('/graphql')) && status===429){state.code='rate_limited';const seconds=Number(retry);state.retryAfter=Number.isFinite(seconds)&&seconds>0?seconds:Math.max(0,Math.ceil((Date.parse(retry)-Date.now())/1000))||0;}
  }
  if(typeof fetch==='function') {
    const original=globalThis.fetch;
    globalThis.fetch=async function(...args) {
      const info=requestInfo(args[0],args[1]?.body);if(info.tracksList)listing.inflight++;
      try {
        const response=await original.apply(this,args);state.responses++;apiResponse(response.url || args[0]?.url || args[0],response.status,response.headers.get('retry-after')||'');
        if(response.ok && /json/i.test(response.headers.get('content-type')||'')) {
          const copy=response.clone();
          copy.text().then(text=>parseJSON(text,'rendered-network-json',info)).catch(()=>{}).finally(()=>{if(info.tracksList)listing.inflight--;});
        } else if(info.tracksList)listing.inflight--;
        return response;
      }catch(error){if(info.tracksList)listing.inflight--;throw error;}
    };
  }
  if(globalThis.XMLHttpRequest?.prototype) {
    const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send;
    const urls=new WeakMap();
    XMLHttpRequest.prototype.open=function(method,url,...args){urls.set(this,url);return open.call(this,method,url,...args);};
    XMLHttpRequest.prototype.send=function(...args) {
      const info=requestInfo(urls.get(this),args[0]);if(info.tracksList)listing.inflight++;
      this.addEventListener('load',()=>{state.responses++;apiResponse(this.responseURL,this.status,this.getResponseHeader('retry-after')||'');
        if(this.status>=200 && this.status<300)try{
          if(this.responseType==='json'){inspect(this.response,'rendered-network-json');consumeList(this.response,info);}
          else if(!this.responseType || this.responseType==='text')parseJSON(this.responseText,'rendered-network-json',info);
        }catch{}
      },{once:true});
      this.addEventListener('loadend',()=>{if(info.tracksList)listing.inflight--;},{once:true});
      try{return send.apply(this,args);}catch(error){if(info.tracksList)listing.inflight--;throw error;}
    };
  }
  function scriptData() {
    for(const script of document.querySelectorAll('script[type="application/json"]')) {
      if(seenScripts.has(script))continue;seenScripts.add(script);state.scripts++;
      parseJSON(script.textContent||'','rendered-document-json');
    }
  }
  function exactDisplayedNumber(text) {
    const match=String(text||'').trim().match(/^\d[\d\s\u00a0\u202f,.'’]*(?=\s|$)/);
    if(!match || /\d\s*(?:[kmb]|mil|mio|million|thousand)\b/i.test(String(text)))return null;
    const value=match[0].trim();
    if(/^\d+$/.test(value))return exact(value);
    // Only grouped thousands; decimal/abbreviated numbers cannot prove a total.
    if(!/^\d{1,3}(?:[\s\u00a0\u202f,.'’]\d{3})+$/.test(value))return null;
    return exact(value.replace(/\D/g,''));
  }
  function renderedTotals() {
    if(!state.identity || state.user || state.code)return;
    const read=kind=>{
      const links=[...document.querySelectorAll('a[href]')].filter(link=>{
        try{const url=new URL(link.getAttribute('href'),location.href);return url.origin===location.origin && url.pathname.toLowerCase()===`/${wanted}/${kind}/`;}catch{return false;}
      });
      const values=new Set();
      for(const link of links) {
        const titled=[...link.querySelectorAll('[title]')].map(node=>node.getAttribute('title'));
        const evidence=titled.length?titled:[link.textContent];
        for(const text of evidence){const count=exactDisplayedNumber(text);if(count!==null)values.add(count);}
      }
      return values.size===1?[...values][0]:null;
    };
    const followers=read('followers'),following=read('following');
    if(followers!==null && following!==null){state.user={...state.identity,follower_count:followers,following_count:following};state.source='rendered-exact-links';}
  }
  function listSnapshot() {
    const now=Date.now();
    if(state.user && (listKind==='followers'?state.user.follower_count:state.user.following_count)!==expectedCount)state.code='profile_counts_changed';
    if(listing.viewerProof===true && /^\d{1,32}$/.test(viewer) && /^[A-Za-z0-9._]{1,30}$/.test(String(config.viewerUsername||'')) && !members.has(viewer)) {
      members.set(viewer,{id:viewer,username:String(config.viewerUsername),full_name:'',profile_pic_url:''});listing.viewerIncluded=true;
    }
    const summary={source:'rendered-list',responses:state.responses,scripts:state.scripts,nodes:state.nodes,matched:state.matched,retryAfter:state.retryAfter,
      collected:members.size,expected:expectedCount,pages:listing.pages,rawEntries:listing.raw,duplicateEntries:listing.duplicates,invalidEntries:listing.invalid,viewerIncluded:listing.viewerIncluded,terminal:listing.terminal,pendingRequests:listing.inflight,queryParameterNames:listing.queryKeys};
    if(state.code)return {...summary,ok:false,code:state.code};
    const verifiedEmpty=expectedCount===0 && !!state.user && listing.pages===0;
    if(listing.inflight===0 && (listing.terminal || verifiedEmpty) && members.size===expectedCount && listing.invalid===0)return {...summary,ok:true,code:'',data:{users:[...members.values()]}};
    if(listing.inflight===0 && listing.terminal && (members.size!==expectedCount || listing.invalid>0))return {...summary,ok:false,code:'watch_coverage_incomplete'};
    if(!listing.opened && state.identity) {
      const link=[...document.querySelectorAll('a[href]')].find(node=>{try{return new URL(node.getAttribute('href'),location.href).pathname.toLowerCase().replace(/\/$/,'')===`/${wanted}/${listKind}`;}catch{return false;}});
      if(link){listing.opened=true;listing.lastScroll=now;link.click();}
    }
    if(location.pathname.toLowerCase().replace(/\/$/,'')===`/${wanted}/${listKind}`)listing.opened=true;
    const delay=Math.max(300,Number(config.pageDelayMinMs)||1300);
    if(listing.pages>0 && Number(config.pauseEveryPages)>0 && listing.pages % Number(config.pauseEveryPages)===0 && listing.pausedPage!==listing.pages){listing.pausedPage=listing.pages;listing.pauseUntil=now+Math.max(0,Number(config.pauseDurationMs)||0);}
    if(listing.opened && !listing.inflight && now>=listing.pauseUntil && now-listing.lastScroll>=delay && now-listing.lastPageAt>=delay) {
      const dialog=document.querySelector('[role="dialog"]');
      const root=dialog || (location.pathname.toLowerCase().includes(`/${listKind}`)?document.scrollingElement:null);
      if(root){
        const candidates=[root,...root.querySelectorAll('*')].filter(node=>node.clientHeight>20 && node.scrollHeight>node.clientHeight+30);
        candidates.sort((a,b)=>b.scrollHeight-a.scrollHeight);
        const scroller=candidates[0];if(scroller){scroller.scrollTop=scroller.scrollHeight;scroller.dispatchEvent(new Event('scroll',{bubbles:true}));listing.lastScroll=now+Math.random()*Math.max(0,(Number(config.pageDelayMaxMs)||delay)-delay);}
      }
    }
    return {...summary,ok:false,code:'',loading:true};
  }
  globalThis.__FC_PROFILE_READER__={snapshot(){
    const currentViewer=(String(document.cookie||'').match(/(?:^|;\s*)ds_user_id=([^;]+)/)||[])[1]||'';
    if(viewer && currentViewer && viewer!==currentViewer)state.code='instagram_account_changed';
    if(/^\/(accounts|challenge|checkpoint|two_factor|oauth)(\/|$)/i.test(location.pathname))state.code='login_required';
    if(location.pathname.toLowerCase()!==`/${wanted}/` && !(listMode && location.pathname.toLowerCase().replace(/\/$/,'')===`/${wanted}/${listKind}`))return {ok:false,code:state.code||'profile_loading',source:state.source,responses:state.responses,scripts:state.scripts,nodes:state.nodes,matched:state.matched,retryAfter:state.retryAfter};
    scriptData();renderedTotals();
    if(listMode)return listSnapshot();
    return {ok:!state.code && !!state.user,code:state.code,data:state.code?null:state.user?{user:state.user}:null,source:state.source,responses:state.responses,scripts:state.scripts,nodes:state.nodes,matched:state.matched,retryAfter:state.retryAfter};
  }};
})();
