/* Observes a normally rendered profile in a session-owned WebKit view. No API requests. */
(() => {
  'use strict';
  const config=globalThis.__FC_PROFILE_CONFIG__ || {};
  const wanted=String(config.username||'').toLowerCase();
  const expected=String(config.userId||'');
  const viewer=String(config.viewerId||'');
  const state={user:null,identity:null,code:'',source:'',responses:0,scripts:0,nodes:0,matched:0,retryAfter:0};
  const seenScripts=new WeakSet();
  const exact=v => (typeof v==='number' || typeof v==='string' && /^\d+$/.test(v)) && Number.isSafeInteger(Number(v)) && Number(v)>=0 ? Number(v):null;
  const idOf=v => {const raw=v.pk ?? v.id;return (typeof raw==='string' || Number.isSafeInteger(raw)) && /^\d{1,32}$/.test(String(raw||''))?String(raw):'';};
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
  function parseJSON(text,source) {if(typeof text!=='string'||text.length>2*1024*1024)return;try{inspect(JSON.parse(text.replace(/^for\s*\(;;\);\s*/,'')),source);}catch{}}
  function apiResponse(url,status,retry='') {
    let path='';try{path=new URL(String(url||''),location.href).pathname;}catch{}
    if((path.startsWith('/api/') || path.startsWith('/graphql')) && status===429){state.code='rate_limited';const seconds=Number(retry);state.retryAfter=Number.isFinite(seconds)&&seconds>0?seconds:Math.max(0,Math.ceil((Date.parse(retry)-Date.now())/1000))||0;}
  }
  if(typeof fetch==='function') {
    const original=globalThis.fetch;
    globalThis.fetch=async function(...args) {
      const response=await original.apply(this,args);state.responses++;apiResponse(response.url || args[0]?.url || args[0],response.status,response.headers.get('retry-after')||'');
      if(response.ok && /json/i.test(response.headers.get('content-type')||''))response.clone().text().then(text=>parseJSON(text,'rendered-network-json')).catch(()=>{});
      return response;
    };
  }
  if(globalThis.XMLHttpRequest?.prototype) {
    const original=XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send=function(...args) {
      this.addEventListener('load',()=>{state.responses++;apiResponse(this.responseURL,this.status,this.getResponseHeader('retry-after')||'');
        if(this.status>=200 && this.status<300)try{
          if(this.responseType==='json')inspect(this.response,'rendered-network-json');
          else if(!this.responseType || this.responseType==='text')parseJSON(this.responseText,'rendered-network-json');
        }catch{}
      },{once:true});return original.apply(this,args);
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
  globalThis.__FC_PROFILE_READER__={snapshot(){
    const currentViewer=(String(document.cookie||'').match(/(?:^|;\s*)ds_user_id=([^;]+)/)||[])[1]||'';
    if(viewer && currentViewer && viewer!==currentViewer)state.code='instagram_account_changed';
    if(/^\/(accounts|challenge|checkpoint|two_factor|oauth)(\/|$)/i.test(location.pathname))state.code='login_required';
    if(location.pathname.toLowerCase()!==`/${wanted}/`)return {ok:false,code:state.code||'profile_loading',source:state.source,responses:state.responses,scripts:state.scripts,nodes:state.nodes,matched:state.matched,retryAfter:state.retryAfter};
    scriptData();renderedTotals();
    return {ok:!state.code && !!state.user,code:state.code,data:state.code?null:state.user?{user:state.user}:null,source:state.source,responses:state.responses,scripts:state.scripts,nodes:state.nodes,matched:state.matched,retryAfter:state.retryAfter};
  }};
})();
