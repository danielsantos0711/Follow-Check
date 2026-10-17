(() => {
  if (globalThis.__FOLLOWCHECK_PAGE_EXECUTOR_1091__) return;
  globalThis.__FOLLOWCHECK_PAGE_EXECUTOR_1091__ = true;

  const VERSION = "10.20.1";
  const REQUEST_EVENT = "followcheck:page-executor:request:v1";
  const RESPONSE_EVENT = "followcheck:page-executor:response:v1";
  const CANCEL_EVENT = "followcheck:page-executor:cancel:v1";
  const APP_ID = "936619743392459";
  const ASBD_ID = "129477";
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const activeRequests = new Map();
  document.addEventListener('followcheck:ios:cancel', () => {
    for (const controller of activeRequests.values()) controller.abort();
  });
  const relationshipVerbs = Object.freeze({
    follow: "create",
    unfollow: "destroy",
    removeFollower: "remove_follower",
    mute: "mute_posts_or_story_from_follow",
  });

  function cookie(name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
    return match?.[1] ? decodeURIComponent(match[1]) : "";
  }

  function safePath(value) {
    try {
      const url = new URL(value, location.href);
      if (url.origin !== location.origin) return "cross-origin";
      return url.pathname.replace(/\/\d{5,}(?=\/|$)/g, "/:id");
    } catch {
      return "unknown";
    }
  }

  function parseJson(text) {
    if (!text || !/^[\s\r\n]*[\[{]/.test(text)) return null;
    try { return JSON.parse(text); } catch { return null; }
  }

  function compactPayload(payload) {
    if (!payload || typeof payload !== "object") return null;
    try {
      const serialized = JSON.stringify(payload);
      if (serialized.length <= 2 * 1024 * 1024) return payload;
    } catch {
      return null;
    }
    return {
      status: payload.status,
      message: payload.message,
      error_type: payload.error_type,
      friendship_status: payload.friendship_status,
    };
  }

  async function readResponse(response, startedAt) {
    const contentType = String(response.headers.get("content-type") || "").slice(0, 120);
    const text = await response.text();
    const data = compactPayload(parseJson(text));
    const responseKind = data
      ? "json"
      : /^\s*<!doctype\s+html|^\s*<html[\s>]/i.test(text)
        ? "html-document"
        : text ? "text" : "empty";
    const rawRetry = response.headers.get('retry-after') || '';
    const seconds = Number(rawRetry);
    const retryAfter = Number.isFinite(seconds) && seconds > 0 ? seconds : Math.max(0, Math.ceil((Date.parse(rawRetry) - Date.now()) / 1000)) || 0;
    return {
      retryAfter,
      ok: response.ok,
      status: response.status,
      contentType,
      redirected: Boolean(response.redirected),
      finalPath: safePath(response.url),
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      responseKind,
      responseBytes: new TextEncoder().encode(text).length,
      responseCategory: response.status === 429 ? "rate-limit-response" : /challenge_required|checkpoint_required/i.test(text) ? "challenge-marker" : /login_required/i.test(text) ? "login-marker" : data ? "json" : "unclassified",
      schema: data && typeof data === "object" ? ["status","user","data","users","items","inbox","thread","message","error_type","next_max_id","has_more"].filter(key => Object.prototype.hasOwnProperty.call(data,key)) : [],
      data,
    };
  }

  function siteModule(name) {
    try { return typeof globalThis.require === 'function' ? globalThis.require(name) : null; }
    catch { return null; }
  }

  function instagramAjaxToken() {
    const candidates = [
      siteModule("PolarisSiteData")?.rollout_hash,
      globalThis._sharedData?.rollout_hash,
      globalThis.__initialData?.data?.rollout_hash,
      globalThis.__initialData?.rollout_hash,
    ];
    return String(candidates.find((value) => /^[a-zA-Z0-9._:-]{3,160}$/.test(String(value || ""))) || "");
  }

  function requestHeaders({ csrf = "", form = false } = {}) {
    const ajax = instagramAjaxToken();
    let claim='';
    try { const value=globalThis.sessionStorage?.getItem('www-claim-v2') || ''; if (/^[A-Za-z0-9._:=+-]{1,2048}$/.test(value)) claim=value; } catch {}
    return {
      accept: "*/*",
      "x-ig-app-id": APP_ID,
      "x-asbd-id": ASBD_ID,
      "x-requested-with": "XMLHttpRequest",
      ...(csrf ? { "x-csrftoken": csrf } : {}),
      ...(ajax ? { "x-instagram-ajax": ajax } : {}),
      ...(claim ? { "x-ig-www-claim": claim } : {}),
      ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    };
  }

  function relationshipCandidate(action, targetId) {
    if(action==='mute')return {variant:"api-v1",endpoint:"/api/v1/friendships/mute_posts_or_story_from_follow/",body:{container_module:"profile",target_posts_author_id:targetId,target_reel_author_id:targetId}};
    const verb = relationshipVerbs[action];
    return { variant: "api-v1", endpoint: `/api/v1/friendships/${verb}/${targetId}/` };
  }

  function relationshipState(payload) {
    const value = payload?.friendship_status || payload?.data?.friendship_status || payload;
    if (!value || typeof value !== "object") return null;
    return {
      mutedPosts: typeof value.muting === "boolean" ? value.muting : null,
      mutedStories: typeof value.is_muting_reel === "boolean" ? value.is_muting_reel : null,
      following: typeof value.following === "boolean" ? value.following : null,
      followedBy: typeof value.followed_by === "boolean" ? value.followed_by : null,
      outgoingRequest: typeof value.outgoing_request === "boolean" ? value.outgoing_request : null,
    };
  }

  function relationshipMatches(action, state) {
    if (!state) return false;
    if (action === "mute") return state.mutedPosts === true && state.mutedStories === true;
    if (action === "follow") return state.following === true || state.outgoingRequest === true;
    if (action === "unfollow") return state.following === false && state.outgoingRequest !== true;
    if (action === "removeFollower") return state.followedBy === false;
    return false;
  }

  function responseAttempt(result, phase, variant) {
    return {
      phase,
      variant,
      transport: result.transport || "page-fetch",
      endpoint: result.finalPath,
      status: result.status,
      responseKind: result.responseKind,
      contentType: result.contentType,
      redirected: result.redirected,
      durationMs: result.durationMs,
      responseBytes: result.responseBytes,
    };
  }

  async function request(endpoint, options, signal) {
    if (document.hidden || /^\/(accounts|challenge|checkpoint|two_factor|oauth)(\/|$)/i.test(location.pathname)) {
      throw Object.assign(new Error('A sessão aguarda a app ativa e o fim da autenticação.'), {code:'ios_paused'});
    }
    const startedAt = performance.now();
    const response = await nativeFetch(endpoint, {
      credentials: "include",
      cache: "no-store",
      redirect: "follow",
      referrer: location.href,
      referrerPolicy: "strict-origin-when-cross-origin",
      signal,
      ...options,
    });
    return readResponse(response, startedAt);
  }

  async function mutateRelationship(endpoint, csrf, signal, body={container_module:'profile'}) {
    const client=siteModule('PolarisInstapi');
    if (!client || typeof client.apiPost !== 'function') {
      const result=await request(endpoint,{method:'POST',headers:requestHeaders({csrf,form:true}),body:new URLSearchParams(body).toString()},signal);
      return {...result,transport:'page-fetch'};
    }
    if (signal.aborted || document.hidden || pageSessionState({}).securityWarning) throw Object.assign(new Error('A ação foi interrompida antes do envio.'),{code:'ios_paused'});
    const startedAt=performance.now();
    let outgoing;
    let abortListener;
    const cancelled=new Promise((_,reject)=>{
      abortListener=()=>{try{outgoing?.abort?.();}catch{} reject(Object.assign(new Error('A ação foi interrompida; o resultado pode ser desconhecido. Não foi repetida.'),{name:'AbortError'}));};
      signal.addEventListener('abort',abortListener,{once:true});
    });
    try {
      // Use the client's own headers and serialization. Select before sending;
      // never retry a rejected/ambiguous write through another transport.
      const response=await Promise.race([
        client.apiPost(endpoint,{body},{before:handle=>{outgoing=handle;if(signal.aborted)handle?.abort?.();}}),cancelled
      ]);
      if(signal.aborted)throw Object.assign(new Error('Operação interrompida.'),{name:'AbortError'});
      const data=compactPayload(response?.data ?? response);
      return {ok:false,status:0,responseKind:data?'client-json':'client-empty',data,transport:'instagram-web-client',finalPath:safePath(endpoint),redirected:false,durationMs:Math.round(performance.now()-startedAt),retryAfter:0};
    } catch(error) {
      if(signal.aborted || error?.name==='AbortError')throw error;
      const status=Number(error?.statusCode || error?.status || 0);
      return {ok:false,status:Number.isInteger(status)&&status>=100&&status<=599?status:0,responseKind:'client-error',data:compactPayload(error?.responseObject),transport:'instagram-web-client',finalPath:safePath(endpoint),redirected:false,durationMs:Math.round(performance.now()-startedAt),retryAfter:0};
    } finally {signal.removeEventListener('abort',abortListener);}
  }

  async function verifyRelationship(action, targetId, csrf, signal) {
    const endpoint = `/api/v1/friendships/show/${targetId}/`;
    const result = await request(endpoint, {
      method: "GET",
      headers: requestHeaders({ csrf }),
    }, signal);
    const state = relationshipState(result.data);
    return {
      ...result,
      endpoint: safePath(endpoint),
      state,
      confirmed: result.ok && result.responseKind === "json" && result.data?.status !== "fail" && !result.data?.error_type && relationshipMatches(action, state),
    };
  }

  function jsonConfirmsMutation(result) {
    return Boolean(
      result.ok
      && result.responseKind === "json"
      && result.data
      && result.data.status === "ok",
    );
  }

  async function executeRelationship(message, signal) {
    const action = String(message.action || "");
    const targetId = String(message.targetId || "");
    if (!relationshipVerbs[action] || !/^\d{1,30}$/.test(targetId)) {
      const error = new Error("A operação ou o identificador não são válidos.");
      error.code = "followcheck_page_request_rejected";
      throw error;
    }
    if (pageSessionState(message).securityWarning) {
      return {
        operation: "relationship",
        ok: false,
        code: "instagram_security_warning",
        message: "O Instagram apresentou um aviso de segurança. A ação foi interrompida.",
        securityWarning: true,
        status: 0,
        attempts: [],
      };
    }
    const csrf = cookie("csrftoken");
    if (!csrf) {
      const error = new Error("O token da sessão Instagram não está disponível na página.");
      error.code = "instagram_page_session_missing";
      throw error;
    }

    const candidate = relationshipCandidate(action, targetId);
    const attempts = [];
    const result = await mutateRelationship(candidate.endpoint, csrf, signal, candidate.body);
    attempts.push(responseAttempt(result, "mutation", candidate.variant));
    if (pageSessionState(message).securityWarning) {
      return {
        operation: "relationship",
        action,
        ok: false,
        code: "instagram_security_warning",
        message: "O Instagram apresentou um aviso de segurança. A ação foi interrompida sem qualquer fallback.",
        securityWarning: true,
        status: result.status,
        attempts,
      };
    }
    const mutationConfirmed = jsonConfirmsMutation(result) && ((action!=='mute' && !result.data.friendship_status) || relationshipMatches(action,relationshipState(result.data)));
    if (mutationConfirmed || [401,403,429].includes(result.status)) {
      return {
        operation: "relationship",
        action,
        endpoint: safePath(candidate.endpoint),
        variant: candidate.variant,
        confirmedBy: mutationConfirmed ? "mutation-json" : null,
        verification: mutationConfirmed ? {state:relationshipState(result.data)} : null,
        attempts,
        ...result,
        ok: mutationConfirmed,
      };
    }

    // An ambiguous response gets one read-only verification. Never repeat the
    // mutation through a legacy/mobile route: that looked like multi-client
    // automation and could also apply the same action twice.
    let verification = await verifyRelationship(action, targetId, csrf, signal);
    attempts.push(responseAttempt(verification, "verification", "relationship-show"));
    const username=String(message.username||'');
    if (action!=='mute' && !verification.confirmed && verification.responseKind !== 'json' && verification.status !== 429 && verification.status !== 401 && verification.status !== 403 && !pageSessionState(message).securityWarning && /^[A-Za-z0-9._]{1,30}$/.test(username)) {
      const profile=await request(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,{method:'GET',headers:requestHeaders({csrf})},signal);
      const user=profile.data?.data?.user || profile.data?.user;
      const state=user && String(user.id||user.pk||'')===targetId ? {following:typeof user.followed_by_viewer==='boolean'?user.followed_by_viewer:null,followedBy:typeof user.follows_viewer==='boolean'?user.follows_viewer:null,outgoingRequest:typeof user.requested_by_viewer==='boolean'?user.requested_by_viewer:null}:null;
      verification={...profile,state,confirmed:profile.ok && profile.responseKind==='json' && relationshipMatches(action,state)};
      attempts.push(responseAttempt(profile,'verification','profile-state'));
    }
    const securityWarning = pageSessionState(message).securityWarning;
    return {
      operation: "relationship",
      action,
      endpoint: safePath(candidate.endpoint),
      variant: candidate.variant,
      confirmedBy: !securityWarning && verification.confirmed ? "relationship-state" : null,
      attempts,
      ...result,
      ok: !securityWarning && verification.confirmed,
      status: verification.status === 429 ? 429 : result.status,
      retryAfter: verification.status === 429 ? verification.retryAfter : result.retryAfter,
      ...(securityWarning ? {
        code: "instagram_security_warning",
        message: "O Instagram apresentou um aviso de segurança. A verificação foi interrompida.",
        securityWarning: true,
      } : {}),
      data: verification.confirmed
        ? { status: "ok", friendship_status: verification.state }
        : result.data,
      verification: {
        payloadStatus: typeof verification.data?.status === 'string' ? verification.data.status.slice(0,30) : null,
        endpoint: verification.endpoint,
        status: verification.status,
        responseKind: verification.responseKind,
        state: verification.state,
      },
    };
  }

  function sessionUser(payload) {
    const user = payload?.user || payload?.data?.user;
    if (!user || typeof user !== "object") return null;
    const userId = String(user.pk || user.id || "");
    if (!/^\d+$/.test(userId)) return null;
    return {
      userId,
      username: String(user.username || "").slice(0, 80),
      fullName: String(user.full_name || user.fullName || "").slice(0, 120),
      profilePicUrl: String(
        user.profile_pic_url_hd
        || user.hd_profile_pic_url_info?.url
        || user.profile_pic_url
        || user.profilePicUrl
        || "",
      ).slice(0, 2000),
    };
  }

  function pageIdentityFallback(message = {}) {
    const candidates = [
      siteModule("PolarisSiteData")?.rollout_hash,
      globalThis._sharedData?.config?.viewer,
      globalThis.__initialData?.data?.user,
      globalThis.__initialData?.user,
    ].filter((value) => value && typeof value === "object");
    for (const candidate of candidates) {
      const user = sessionUser({ user: candidate });
      if (user) return user;
    }
    const userId = cookie("ds_user_id") || String(message.preferredUserId || "");
    const candidateUsername = String(message.preferredUsername || "").replace(/^@/, "").slice(0, 80);
    if (!/^\d{1,32}$/.test(userId)) return null;
    // O registo nativo pode conservar o userId autoritativo mesmo quando o
    // Gecko e o DOM atual não expõem o username. Exigir ambos transformava uma
    // sessão saudável em session_unverified. O username fica opcional e a
    // primeira página de audiência continua a ser a prova real da sessão.
    const username = /^[A-Za-z0-9._]{1,80}$/.test(candidateUsername)
      ? candidateUsername
      : "";
    return { userId, username, fullName: String(message.preferredFullName || "").slice(0, 120), profilePicUrl: String(message.preferredProfilePicUrl || "").slice(0, 2000) };
  }

  function pageSessionState(message = {}) {
    const loginRoute = /\/accounts\/(?:login|challenge|checkpoint)|\/challenge\//i.test(location.pathname);
    const authenticatedShell = Boolean(document.querySelector?.(
      'a[href^="/direct/"],a[href^="/accounts/edit"],a[href^="/explore/"],a[href^="/reels/"],nav,[role="navigation"]',
    ));
    // Never persist or return page text. This only recognises Instagram's own
    // security interstitial so FollowCheck can stop before issuing more calls.
    const visibleText = String(document.body?.innerText || "").slice(0, 60000);
    const securityWarning = /(?:your\s+(?:account|email)\s+may\s+be\s+at\s+risk|we\s+suspect\s+automated\s+behavio(?:u)?r|couldn['’]?t\s+create\s+multiple\s+sessions|secure\s+your\s+account|suspicious\s+(?:activity|login)|(?:conta|e-?mail).{0,45}(?:em\s+risco|comprometid)|comportamento\s+automatizado|múltiplas\s+sessões|actividad\s+sospechosa|(?:cuenta|correo).{0,45}en\s+riesgo|compte.{0,45}(?:risque|compromis)|adresse\s+e-?mail.{0,45}risque|konto.{0,45}(?:gefährdet|kompromittiert))/i.test(visibleText);
    return {
      loginRoute,
      authenticatedShell,
      securityWarning,
      fallbackUser: pageIdentityFallback(message),
    };
  }

  async function probeSession(message, signal) {
    const expectedUserId = cookie("ds_user_id") || String(message.preferredUserId || "");
    const pageState = pageSessionState(message);
    if (pageState.securityWarning) {
      return {
        operation: "probe-session",
        ok: false,
        code: "instagram_security_warning",
        message: "O Instagram apresentou um aviso de segurança. O FollowCheck parou sem fazer mais pedidos.",
        securityWarning: true,
        status: 0,
        attempts: [],
      };
    }
    // A página Instagram fora das rotas de login e um userId já conhecido são
    // suficientes para avançar sem um pedido de identidade adicional. A
    // primeira leitura real confirma a autorização e termina sem retry se for
    // recusada.
    if (!pageState.loginRoute && pageState.fallbackUser?.userId) {
      return {
        operation: "probe-session",
        ok: true,
        user: pageState.fallbackUser,
        expectedUserId: expectedUserId || null,
        endpoint: "page-authenticated-shell",
        status: 0,
        contentType: "text/html",
        confirmation: pageState.authenticatedShell
          ? "authenticated-shell-preflight"
          : "known-account-page-preflight",
        attempts: [],
      };
    }
    // Session inspection is local-only. A diagnostic probe must never create
    // identity traffic or retries merely to prove a page that is already open.
    return {
      operation: "probe-session",
      ok: false,
      code: pageState.loginRoute ? "logout_confirmed" : "session_unverified",
      message: pageState.loginRoute
        ? "A página Instagram está na rota de login."
        : "A página aberta não expôs prova local suficiente; nenhum pedido de identidade foi efetuado.",
      status: 0,
      contentType: "text/html",
      logoutConfirmed: pageState.loginRoute,
      attempts: [],
    };
  }

  // Read exact counts from JSON already delivered with a normal profile document.
  // Never evaluate page scripts or infer totals from rounded rendered text/OG tags.
  function profileFromDocument(text, message) {
    const wanted=String(message.username || "").replace(/^@/, "").toLowerCase();
    const expectedId=String(message.userId || "");
    const matches=[];
    let scripts=0, nodes=0, bounded=false;
    const exact=value => (typeof value === "number" || typeof value === "string" && /^\d+$/.test(value)) && Number.isSafeInteger(Number(value)) && Number(value)>=0 ? Number(value):null;
    const inspect=root => {
      const stack=[{value:root,depth:0}];
      while(stack.length) {
        const {value,depth}=stack.pop();
        if(++nodes>40000 || depth>45) {bounded=true;return;}
        if(!value || typeof value!=="object")continue;
        const id=String(value.id ?? value.pk ?? "");
        if(String(value.username || "").toLowerCase()===wanted && /^\d{1,32}$/.test(id)) {
          const followers=exact(value.follower_count ?? value.edge_followed_by?.count);
          const following=exact(value.following_count ?? value.edge_follow?.count);
          if(followers!==null && following!==null)matches.push({
            id,username:String(value.username),full_name:String(value.full_name||"").slice(0,160),
            profile_pic_url:String(value.profile_pic_url_hd||value.profile_pic_url||"").slice(0,2000),
            is_private:value.is_private===true,followed_by_viewer:value.followed_by_viewer===true,
            follower_count:followers,following_count:following
          });
        }
        for(const child of Object.values(value))if(child && typeof child==="object")stack.push({value:child,depth:depth+1});
      }
    };
    if(text.length>6*1024*1024)return {user:null,code:"profile_document_too_large",scripts,nodes};
    for(const match of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if(++scripts>200){bounded=true;break;}
      const attrs=match[1];let json=match[2].trim();
      if(/type\s*=\s*["']application\/json["']/i.test(attrs) || /id\s*=\s*["']__NEXT_DATA__["']/i.test(attrs)) {
        if(json.length>2*1024*1024){bounded=true;break;}
      } else if(/^window\._sharedData\s*=/.test(json)) {
        json=json.replace(/^window\._sharedData\s*=\s*/,"").replace(/;\s*$/,"");
      } else continue;
      const data=parseJson(json);if(data)inspect(data);
      if(bounded)break;
    }
    const unique=new Map(matches.map(user=>[`${user.id}:${user.follower_count}:${user.following_count}`,user]));
    if(bounded)return {user:null,code:"profile_document_parse_limit",scripts,nodes};
    if(unique.size!==1)return {user:null,code:unique.size>1?"profile_document_conflict":"profile_document_counts_missing",scripts,nodes};
    const user=[...unique.values()][0];
    if(expectedId && user.id!==expectedId)return {user:null,code:"watch_target_changed",scripts,nodes};
    return {user,code:"",scripts,nodes};
  }

  async function executeProfileDocument(message, signal) {
    const username=String(message.username || "").replace(/^@/,"");
    if(!/^[A-Za-z0-9._]{1,30}$/.test(username))throw Object.assign(new Error("Perfil inválido."),{code:"watch_target_invalid"});
    if((document.hidden && globalThis.__FOLLOWCHECK_BACKGROUND_READ__!==true) || pageSessionState(message).securityWarning || /^\/(accounts|challenge|checkpoint|two_factor|oauth)(\/|$)/i.test(location.pathname))throw Object.assign(new Error("Confirma a sessão com a app ativa."),{code:"ios_paused"});
    const startedAt=performance.now();
    const response=await nativeFetch(`/${encodeURIComponent(username)}/`,{
      method:"GET",credentials:"include",cache:"no-store",redirect:"follow",signal,
      headers:{accept:"text/html"}
    });
    const text=await response.text();
    if(signal.aborted)throw Object.assign(new Error("Leitura interrompida."),{name:"AbortError"});
    const finalURL=response.url ? new URL(response.url,location.href):null;
    const loginRoute=!!finalURL && /^\/(accounts|challenge|checkpoint|two_factor|oauth)(\/|$)/i.test(finalURL.pathname);
    const wrongDestination=!!finalURL && (finalURL.origin!==location.origin || finalURL.pathname.toLowerCase()!==`/${username.toLowerCase()}/`);
    const parsed=response.ok && !wrongDestination ? profileFromDocument(text,message):{user:null,code:loginRoute?"login_required":wrongDestination?"profile_document_redirect":"",scripts:0,nodes:0};
    const rawRetry=response.headers.get("retry-after") || "";
    const seconds=Number(rawRetry);
    const retryAfter=Number.isFinite(seconds)&&seconds>0?seconds:Math.max(0,Math.ceil((Date.parse(rawRetry)-Date.now())/1000))||0;
    return {operation:"profile-document",executor:"profile-document",ok:response.ok && !!parsed.user,
      status:response.status,code:parsed.code,contentType:String(response.headers.get("content-type")||"").slice(0,120),
      redirected:!!response.redirected,finalPath:loginRoute?"/accounts/:auth/":"/:profile/",
      responseKind:"html-document",responseBytes:new TextEncoder().encode(text).length,
      responseCategory:response.status===429?"rate-limit-response":parsed.user?"profile-structured-data":parsed.code||"unclassified",
      durationMs:Math.max(0,Math.round(performance.now()-startedAt)),retryAfter,
      data:parsed.user?{user:parsed.user}:null,schema:parsed.user?["user"]:[],
      documentScripts:parsed.scripts,documentNodes:parsed.nodes,profileSource:"profile-document-json"};
  }

  async function executeProfileInfo(message, signal) {
    const userId = String(message.userId || "");
    const username = String(message.username || "").replace(/^@/, "");
    if (!/^\d{1,32}$/.test(userId) && !/^[A-Za-z0-9._]{1,30}$/.test(username)) {
      const error = new Error("O perfil pedido não é válido.");
      error.code = "watch_target_invalid";
      throw error;
    }
    if (pageSessionState(message).securityWarning) {
      return {
        operation: "profile-info",
        executor: "page-main",
        ok: false,
        code: "instagram_security_warning",
        message: "O Instagram apresentou um aviso de segurança. A identificação do perfil foi interrompida.",
        securityWarning: true,
        status: 0,
      };
    }
    const endpoint = /^\d{1,32}$/.test(userId)
      ? `/api/v1/users/${userId}/info/`
      : `/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
    if (document.hidden || /^\/(accounts|challenge|checkpoint|two_factor|oauth)(\/|$)/i.test(location.pathname)) {
      throw Object.assign(new Error('A sessão aguarda a app ativa e o fim da autenticação.'), {code:'ios_paused'});
    }
    const startedAt = performance.now();
    const client = siteModule("PolarisInstapi");
    const usesClient = typeof client?.apiGet === "function";
    let result;
    if (usesClient) {
      let outgoing, abortListener;
      const cancellation = new Promise((_, reject) => {
        abortListener = () => {
          try { outgoing?.abort?.(); } catch {}
          reject(Object.assign(new Error("Leitura do perfil interrompida."), {name:"AbortError"}));
        };
        signal.addEventListener("abort", abortListener, {once:true});
      });
      try {
        if (signal.aborted) throw Object.assign(new Error("Leitura interrompida."), {name:"AbortError"});
        const reply = await Promise.race([
          client.apiGet(endpoint, {}, {before:handle => {outgoing=handle;if(signal.aborted)handle?.abort?.();}}), cancellation
        ]);
        if (signal.aborted) throw Object.assign(new Error("Leitura interrompida."), {name:"AbortError"});
        // Preserve the API envelope: both {data:{user}} and {user} are valid.
        const data = compactPayload(reply);
        const user = data?.user || data?.data?.user;
        const valid = !!user && (!data.status || data.status === "ok") && (!data.data?.status || data.data.status === "ok");
        result = {ok:valid,status:0,data:valid?data:null,responseKind:valid?"client-json":"client-shape-invalid"};
      } catch (error) {
        if (signal.aborted || error?.name === "AbortError") throw error;
        const status = Number(error?.statusCode || error?.httpStatus || error?.status || 0);
        const retry = Number(error?.retryAfterSeconds || error?.retryAfter || 0);
        result = {ok:false,status:Number.isFinite(status)?status:0,data:null,responseKind:"client-error",
          retryAfter:Number.isFinite(retry)&&retry>0?retry:0};
      } finally { signal.removeEventListener("abort", abortListener); }
      result.finalPath = safePath(endpoint);
      result.durationMs = Math.max(0,Math.round(performance.now()-startedAt));
    } else {
      const response = await nativeFetch(endpoint, {
        method: "GET", credentials: "include", cache: "no-store", redirect: "follow",
        referrer: location.href, referrerPolicy: "strict-origin-when-cross-origin", signal,
        headers: requestHeaders({ csrf: cookie("csrftoken") }),
      });
      result = await readResponse(response, startedAt);
    }
    const securityWarning = pageSessionState(message).securityWarning;
    return {
      operation: "profile-info",
      executor: usesClient ? "instagram-web-client" : "page-main",
      ...result,
      ok: !securityWarning && result.ok && Boolean(result.data?.user || result.data?.data?.user),
      ...(securityWarning ? {
        code: "instagram_security_warning",
        message: "O Instagram apresentou um aviso de segurança. A identificação do perfil foi interrompida.",
        securityWarning: true,
      } : {}),
    };
  }

  function directReadPath(message = {}) {
    if (message.operation === "direct-read-thread") {
      const threadId = String(message.threadId || "");
      if (!/^\d{1,40}$/.test(threadId)) return "";
      const limit = Math.max(1, Math.min(100, Number(message.limit) || 50));
      return `/api/v1/direct_v2/threads/${encodeURIComponent(threadId)}/?visual_message_return_type=unseen&limit=${limit}`;
    }
    if (message.operation !== "direct-read-inbox") return "";
    const pending = message.kind === "pending";
    const limit = Math.max(1, Math.min(50, Number(message.limit) || 20));
    const params = new URLSearchParams({
      visual_message_return_type: "unseen",
      persistentBadging: "true",
      is_prefetching: "false",
      limit: String(limit),
      thread_message_limit: "10",
      fetch_reason: message.cursor ? "page_scroll" : "initial_snapshot",
    });
    const cursor = String(message.cursor || "");
    if (cursor && cursor.length <= 1024) {
      params.set("cursor", cursor);
      params.set("direction", "older");
    }
    return `/api/v1/direct_v2/${pending ? "pending_inbox" : "inbox"}/?${params}`;
  }

  async function executeMediaRead(message, signal) {
    const feed=message.operation==='media-feed';
    const id=String(feed ? message.userId:message.mediaId);
    if(!/^\d{1,40}$/.test(id))throw Object.assign(new Error('Identificador inválido.'),{code:'media_request_invalid'});
    if(document.hidden || pageSessionState(message).securityWarning || /^\/(accounts|challenge|checkpoint|two_factor|oauth)(\/|$)/i.test(location.pathname))throw Object.assign(new Error('Confirma a sessão com a app ativa.'),{code:'ios_paused'});
    const endpoint=feed ? `/api/v1/feed/user/${id}/?count=12`:`/api/v1/media/${id}/likers/`;
    const client=siteModule('PolarisInstapi');
    const usesClient=!!client && typeof client.apiGet==='function';
    const startedAt=performance.now();
    let result;
    if(client && typeof client.apiGet==='function') {
      let outgoing,listener;
      const cancellation=new Promise((_,reject)=>{listener=()=>{outgoing?.abort?.();reject(Object.assign(new Error('Interrompido.'),{name:'AbortError'}))};signal.addEventListener('abort',listener,{once:true});});
      try {
        if(signal.aborted)throw Object.assign(new Error('Interrompido.'),{name:'AbortError'});
        const reply=await Promise.race([client.apiGet(endpoint,{}, {before:handle=>{outgoing=handle;if(signal.aborted)handle?.abort?.();}}),cancellation]);
        result={ok:true,status:0,responseKind:'client-json',data:reply?.data ?? reply};
      } catch(error) {
        if(signal.aborted || error?.name==='AbortError')throw error;
        result={ok:false,status:Number(error?.statusCode||error?.httpStatus||error?.status||0),responseKind:'client-error',data:null};
      } finally {signal.removeEventListener('abort',listener);}
    } else {
      const response=await nativeFetch(endpoint,{method:'GET',credentials:'include',cache:'no-store',signal,headers:requestHeaders({csrf:cookie('csrftoken')})});
      result=await readResponse(response,startedAt);
    }
    const data=result.data;
    const valid=data && (!data.status || data.status==='ok') && Array.isArray(feed ? data.items:data.users);
    return {...result,operation:message.operation,executor:usesClient?'instagram-web-client':'page-main',ok:result.ok && !!valid,finalPath:safePath(endpoint)};
  }

  async function executeDirectRead(message, signal) {
    const endpoint = directReadPath(message);
    if (!endpoint) {
      const error = new Error("A leitura da Inbox foi recusada pela ponte FollowCheck.");
      error.code = "instagram_direct_request_rejected";
      throw error;
    }
    if (pageSessionState(message).securityWarning) {
      return {
        operation: message.operation,
        executor: "page-main",
        ok: false,
        code: "instagram_security_warning",
        message: "O Instagram apresentou um aviso de segurança. A Inbox foi interrompida.",
        securityWarning: true,
        status: 0,
      };
    }
    if (document.hidden || /^\/(accounts|challenge|checkpoint|two_factor|oauth)(\/|$)/i.test(location.pathname)) {
      throw Object.assign(new Error('A sessão aguarda a app ativa e o fim da autenticação.'), {code:'ios_paused'});
    }
    const client=siteModule('PolarisInstapi');
    if (client && typeof client.apiGet === 'function') {
      let outgoing,abortListener;
      const cancelled=new Promise((_,reject)=>{
        abortListener=()=>{try{outgoing?.abort?.();}catch{}reject(Object.assign(new Error('Leitura interrompida.'),{name:'AbortError'}));};
        signal.addEventListener('abort',abortListener,{once:true});
      });
      try {
        if(signal.aborted)throw Object.assign(new Error('Leitura interrompida.'),{name:'AbortError'});
        // The session's own web client supplies its headers. No new login or device.
        const response=await Promise.race([client.apiGet(endpoint,{}, {before:handle=>{outgoing=handle;if(signal.aborted)handle?.abort?.();}}),cancelled]);
        if(signal.aborted)throw Object.assign(new Error('Leitura interrompida.'),{name:'AbortError'});
        let data=response?.data ?? response;
        // Some web-client releases return the inbox/thread object directly.
        if(message.operation==='direct-read-thread' && Array.isArray(data?.items) && !data.thread) data={status:data.status,thread:data};
        if(message.operation==='direct-read-inbox' && Array.isArray(data?.threads) && !data.inbox) data={status:data.status,inbox:data};
        if(message.operation==='direct-read-inbox' && data?.pending_inbox && !data.inbox) data={...data,inbox:data.pending_inbox};
        const list=message.operation==='direct-read-thread' ? (data?.thread?.items ?? data?.items) : (data?.inbox?.threads ?? data?.pending_inbox?.threads ?? data?.threads);
        const valid=Array.isArray(list) && (!data.status || data.status==='ok');
        return {operation:message.operation,ok:valid,status:0,responseKind:valid?'client-json':'client-shape-invalid',executor:'instagram-web-client',data:valid ? data:null,finalPath:safePath(endpoint)};
      } catch(error) {
        if(signal.aborted || error?.name==='AbortError')throw error;
        return {operation:message.operation,ok:false,status:Number(error?.statusCode||error?.status||0),responseKind:'client-error',executor:'instagram-web-client',data:null,finalPath:safePath(endpoint)};
      } finally {signal.removeEventListener('abort',abortListener);}
    }
    const startedAt = performance.now();
    const response = await nativeFetch(endpoint, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      redirect: "follow",
      referrer: location.href,
      referrerPolicy: "strict-origin-when-cross-origin",
      signal,
      headers: requestHeaders({ csrf: cookie("csrftoken") }),
    });
    const contentType = String(response.headers.get("content-type") || "").slice(0, 120);
    const text = await response.text();
    if (text.length > 4 * 1024 * 1024) {
      const error = new Error("A resposta da Inbox excedeu o limite seguro local.");
      error.code = "instagram_direct_response_too_large";
      throw error;
    }
    const data = parseJson(text);
    const responseKind = data
      ? "json"
      : /^\s*<!doctype\s+html|^\s*<html[\s>]/i.test(text)
        ? "html-document"
        : text ? "text" : "empty";
    const securityWarning = pageSessionState(message).securityWarning;
    return {
      operation: message.operation,
      ok: !securityWarning && response.ok && Boolean(data) && (!data?.status || data.status === "ok"),
      status: response.status,
      contentType,
      redirected: Boolean(response.redirected),
      finalPath: safePath(response.url),
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      responseKind,
      responseBytes: new TextEncoder().encode(text).length,
      responseCategory: response.status === 429 ? "rate-limit-response" : /challenge_required|checkpoint_required/i.test(text) ? "challenge-marker" : /login_required/i.test(text) ? "login-marker" : data ? "json" : "unclassified",
      schema: data && typeof data === "object" ? ["status","user","data","users","items","inbox","thread","message","error_type","next_max_id","has_more"].filter(key => Object.prototype.hasOwnProperty.call(data,key)) : [],
      executor: "page-main",
      data,
      ...(securityWarning ? {
        code: "instagram_security_warning",
        message: "O Instagram apresentou um aviso de segurança. A Inbox foi interrompida.",
        securityWarning: true,
      } : {}),
    };
  }

  async function executeMonitorList(message, signal) {
    const kind = String(message.kind || "");
    const userId = String(message.userId || "");
    if (!["followers", "following"].includes(kind) || !/^\d{1,32}$/.test(userId)) {
      const error = new Error("A lista de relações pedida não é válida.");
      error.code = "monitor_list_request_rejected";
      throw error;
    }
    if (pageSessionState().securityWarning) {
      return {
        operation: "monitor-list",
        kind,
        executor: "page-main",
        ok: false,
        code: "instagram_security_warning",
        message: "O Instagram apresentou um aviso de segurança. A leitura foi interrompida.",
        securityWarning: true,
        status: 0,
        attempts: [],
      };
    }
    const params = new URLSearchParams({ count: String(Math.max(12, Math.min(100, Number(message.count) || 100))), search_surface: "follow_list_page" });
    const cursor = String(message.cursor || "");
    if (cursor && cursor.length <= 2048) params.set("max_id", cursor);
    const endpoint = `/api/v1/friendships/${userId}/${kind}/?${params}`;
    if ((document.hidden && globalThis.__FOLLOWCHECK_BACKGROUND_READ__ !== true) || /^\/(accounts|challenge|checkpoint|two_factor|oauth)(\/|$)/i.test(location.pathname)) {
      throw Object.assign(new Error('A sessão aguarda a app ativa e o fim da autenticação.'), {code:'ios_paused'});
    }
    const startedAt = performance.now();
    const response = await nativeFetch(endpoint, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      redirect: "follow",
      referrer: location.href,
      referrerPolicy: "strict-origin-when-cross-origin",
      signal,
      headers: requestHeaders({ csrf: cookie("csrftoken") }),
    });
    const result = await readResponse(response, startedAt);
    const securityWarning = pageSessionState().securityWarning;
    return {
      operation: "monitor-list",
      kind,
      executor: "page-main",
      ...result,
      ok: !securityWarning && result.ok && Array.isArray(result.data?.users),
      ...(securityWarning ? {
        code: "instagram_security_warning",
        message: "O Instagram apresentou um aviso de segurança. A leitura foi interrompida.",
        securityWarning: true,
      } : {}),
    };
  }

  function dispatchResponse(payload) {
    document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail: JSON.stringify(payload) }));
  }

  document.addEventListener(CANCEL_EVENT, (event) => {
    const requestId = typeof event.detail === "string" ? event.detail : "";
    activeRequests.get(requestId)?.abort();
  });

  function requestDiagnostics(message, result, startedAt) {
    const operation=String(message.operation || "");
    const route=operation === "profile-document" ? "/:profile/" : operation === "profile-info" ? (message.userId ? "/api/v1/users/:id/info/" : "/api/v1/users/web_profile_info/") :
      operation === "media-feed" ? "/api/v1/feed/user/:id/" : operation === "media-likers" ? "/api/v1/media/:id/likers/" :
      operation === "monitor-list" ? "/api/v1/friendships/:id/:kind/" : operation.startsWith("direct-read") ? "/api/v1/direct_v2/:resource/" : "operation-specific";
    const data=result?.data;
    return {
      schemaVersion:2, requestId:message.requestId, operation, route,
      method:operation === "relationship" ? "mutation-and-verification" : ["ping","probe-session"].includes(operation) ? "local" : "GET",
      parameterNames:["userId","username","mediaId","kind","cursor","count"].filter(key => message[key] != null && message[key] !== ""),
      cursorPresent:!!message.cursor, requestedCount:Number(message.count)||null,
      listKind:["followers","following"].includes(message.kind) ? message.kind : null,
      visible:!document.hidden, identityPresent:!!cookie("ds_user_id"),
      credentialPresent:!!cookie("csrftoken"), webClientAvailable:typeof siteModule("PolarisInstapi")?.apiGet === "function",
      executor:result?.executor || "local-or-unavailable", status:result?.status ?? null,
      httpStatusKnown:Number(result?.status)>0, responseKind:result?.responseKind || "unavailable",
      responseCategory:result?.responseCategory || "unclassified", contentType:result?.contentType || null,
      redirected:result?.redirected ?? null, finalPath:result?.finalPath || null,
      durationMs:Math.max(0,Math.round(performance.now()-startedAt)), responseBytes:result?.responseBytes ?? null,
      retryAfterSeconds:result?.retryAfter ?? null, schema:result?.schema || [],
      returnedUsers:Array.isArray(data?.users) ? data.users.length : null,
      returnedItems:Array.isArray(data?.items) ? data.items.length : null,
      nextCursorPresent:!!data?.next_max_id, hasMore:typeof data?.has_more === "boolean" ? data.has_more : null,
      profileSource:result?.profileSource || null, documentScripts:result?.documentScripts ?? null, documentNodes:result?.documentNodes ?? null,
      profileObjectPresent:!!(data?.user || data?.data?.user)
    };
  }

  document.addEventListener(REQUEST_EVENT, async (event) => {
    if (typeof event.detail !== "string" || event.detail.length > 4096) return;
    let message;
    try { message = JSON.parse(event.detail); } catch { return; }
    const requestId = String(message?.requestId || "");
    if (!/^[a-zA-Z0-9_-]{8,120}$/.test(requestId) || activeRequests.has(requestId)) return;
    const diagnosticStartedAt=performance.now();
    const controller = new AbortController();
    if (activeRequests.size >= 16) {
      dispatchResponse({requestId,bridgeOk:false,error:{code:'executor_busy',message:'O executor aguarda operações em curso.'}});
      return;
    }
    activeRequests.set(requestId, controller);
    const deadline = globalThis.setTimeout(() => controller.abort(), 30_000);
    try {
      let result;
      if (message.operation === "ping") result = { operation: "ping", ok: true, version: VERSION };
      else if (message.operation === "probe-session") result = await probeSession(message, controller.signal);
      else if (message.operation === "monitor-list") result = await executeMonitorList(message, controller.signal);
      else if (message.operation === "media-feed" || message.operation === "media-likers") result = await executeMediaRead(message, controller.signal);
      else if (message.operation === "profile-document") result = await executeProfileDocument(message, controller.signal);
      else if (message.operation === "profile-info") result = await executeProfileInfo(message, controller.signal);
      else if (message.operation === "relationship") result = await executeRelationship(message, controller.signal);
      else if (message.operation === "direct-read-inbox" || message.operation === "direct-read-thread") {
        result = await executeDirectRead(message, controller.signal);
      }
      else {
        const error = new Error("Operação não autorizada pela ponte FollowCheck.");
        error.code = "followcheck_page_request_rejected";
        throw error;
      }
      result.diagnostics=requestDiagnostics(message,result,diagnosticStartedAt);
      dispatchResponse({ requestId, bridgeOk: true, result });
    } catch (error) {
      dispatchResponse({
        requestId,
        bridgeOk: false,
        error: {
          diagnostics: requestDiagnostics(message,null,diagnosticStartedAt),
          name: String(error?.name || "Error").slice(0, 60),
          code: String(error?.code || (error?.name === "AbortError" ? "aborted" : "followcheck_page_executor_failed")).slice(0, 100),
          message: String(error?.message || "O executor da página falhou.").slice(0, 300),
        },
      });
    } finally {
      globalThis.clearTimeout(deadline);
      activeRequests.delete(requestId);
    }
  });

  if (document.documentElement) document.documentElement.dataset.followcheckPageExecutor = VERSION;
  else document.addEventListener('DOMContentLoaded', () => { document.documentElement.dataset.followcheckPageExecutor = VERSION; }, {once:true});
})();
