/* Concatenated with background.js in the same content world and lexical scope. */
if (globalThis.__FOLLOWCHECK_IOS_SHELL__ && !globalThis.__FOLLOWCHECK_IOS_ENGINE__) {
  globalThis.__FOLLOWCHECK_IOS_ENGINE__ = true;
  const policy = globalThis.FollowCheckPolicy;
  const lane = new policy.SingleFlight();
  let paused = false;
  let active = true;
  let backgroundReads = false;
  let backgroundSuspension = null;
  let generation = 0;
  let jobGeneration = 0;
  let jobAccount = '';
  let jobScope = 'account';
  let currentJob = null;
  let suspendedCheck = null;
  let switchingCheck = false;
  let watchJob = null;
  let watchRequest = null;
  let relationshipBatch = null;
  const accountCookie = () => String(document.cookie || '').match(/(?:^|;\s*)ds_user_id=([^;]+)/)?.[1] || '';
  const recoveredAccounts = new Set();
  const requests = new Set();
  function interrupt() {
    generation += 1;
    for (const controller of requests) controller.abort();
    document.dispatchEvent(new CustomEvent('followcheck:ios:cancel'));
  }
  let scheduled = false;
  let consecutiveFailures = 0;
  let retryAt = 0;
  let settings = {enabled: false};
  const SETTINGS_KEY = 'followcheck:ios:scheduler:v1';
  const post = payload => globalThis.webkit?.messageHandlers?.followcheckIOS?.postMessage(payload);
  const eligible = () => ((active && !document.hidden) || (backgroundReads && lane.active && ['account','watchlist'].includes(jobScope))) && policy.allowedURL(location.href);
  const assertEligible = () => {
    if (relationshipBatch && relationshipBatch.owner !== accountCookie()) {relationshipBatch=null;suspendedCheck=null;throw policy.failure('instagram_account_changed','A conta mudou. A fila foi interrompida.');}
    if (switchingCheck && jobGeneration !== generation) throw policy.failure('check_preempted','Check em espera: outro check tem prioridade.');
    if (!eligible() || (lane.active && jobScope === 'account' && paused) || (lane.active && (jobGeneration !== generation || (jobAccount && accountCookie() !== jobAccount)))) throw policy.failure('ios_paused', 'A operação aguarda a app ativa e a sessão disponível.');
  };
  globalThis.__FOLLOWCHECK_IOS_ASSERT_ACTIVE__ = assertEligible;
  if (globalThis.webkit?.messageHandlers?.followcheckRPC?.postMessage) {
    const renderedProgress=new Map();
    globalThis.__FOLLOWCHECK_IOS_RENDERED_PROGRESS__=value=>renderedProgress.get(value?.requestId)?.(value);
    const readRendered = async (kind,details,progress=null) => {
      assertEligible();
      const requestId=crypto.randomUUID(),owner=accountCookie(),startGeneration=generation;
      const handler=globalThis.webkit.messageHandlers.followcheckRPC;
      if(progress)renderedProgress.set(requestId,progress);
      let cancel;
      const cancelled=new Promise((_,reject)=>{
        cancel=()=>{
          Promise.resolve(handler.postMessage({kind,details:{operation:'cancel',requestId,accountId:owner}})).catch(()=>{});
          reject(policy.failure('ios_paused','A leitura foi interrompida.'));
        };
        document.addEventListener('followcheck:ios:cancel',cancel,{once:true});
      });
      try {
        const result=await Promise.race([handler.postMessage({kind,details:{requestId,accountId:owner,...details}}),cancelled]);
        assertEligible();
        if(generation!==startGeneration || owner!==accountCookie())throw policy.failure('instagram_account_changed','A conta mudou durante a leitura.');
        const list=kind==='session.relations';
        await backgroundLog(result?.ok?'info':'warn',list?'relations-rendered':'profile-rendered',list?'relations-read':'profile-read',result?.ok?(list?'Lista carregada e cobertura confirmada.':'Perfil carregado e totais exatos confirmados.'):(list?'A lista carregada não confirmou a cobertura completa.':'A página carregada ainda não confirmou os totais do perfil.'),{checkId:diagnosticCheckId,code:result?.code||'',status:result?.status||0,diagnostics:result?.diagnostics||{}});
        return result;
      } finally {renderedProgress.delete(requestId);document.removeEventListener('followcheck:ios:cancel',cancel);}
    };
    globalThis.__FOLLOWCHECK_IOS_PROFILE_READ__ = details => readRendered('session.profile',details);
    globalThis.__FOLLOWCHECK_IOS_LIST_READ__ = details => readRendered('session.relations',details,value=>{
      const fraction=details.expectedCount>0?Math.min(0.98,Number(value.collected||0)/details.expectedCount):0;
      postMonitorProgress(details.profileId,details.listKind==='followers'?'A confirmar seguidores':'A recolher contas seguidas',`${value.collected||0} de ${details.expectedCount} perfis · lista Instagram`,Math.round(details.rangeStart+fraction*(details.rangeEnd-details.rangeStart)));
      backgroundLog('debug','watchlist-diagnostic','rendered-list-progress','Progresso da lista carregada.',{checkId:diagnosticCheckId,list:details.listKind,...value});
    });
  }
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!(url.hostname === 'instagram.com' || url.hostname.endsWith('.instagram.com'))) return originalFetch(input, options);
    assertEligible();
    const controller = new AbortController();
    const caller = options.signal || input?.signal;
    const abort = () => controller.abort();
    if (caller?.aborted) controller.abort();
    else caller?.addEventListener('abort', abort, {once:true});
    requests.add(controller);
    const timeout = setTimeout(abort, 30_000);
    try { return await originalFetch(input, {...options,signal:controller.signal}); }
    finally { clearTimeout(timeout); requests.delete(controller); caller?.removeEventListener('abort', abort); }
  };
  function wrap(original, label) {
    return function(message = {}) {
      if (label === 'watchlist' && watchRequest && watchRequest.generation !== generation) return Promise.reject(policy.failure('check_preempted','Check em espera: outro check tem prioridade.'));
      if (relationshipBatch && label !== 'relationship') return Promise.reject(policy.failure('monitor_busy','A fila de ações está em curso. Podes consultar os dados guardados.'));
      const key = `${label}:${message.accountId || ''}:${message.targetId || ''}:${message.action || message.operation || ''}:${message.threadId || ''}`;
      return lane.run(key, async () => {
        jobScope = label;
        jobGeneration = generation;
        jobAccount = accountCookie();
        currentJob = {scope:label,owner:jobAccount,message:{...message}};
        assertEligible();
        if (!/^\d{1,32}$/.test(jobAccount)) throw policy.failure('session_unverified','A sessão local não está disponível. Confirma a conta no Instagram.');
        if (message.accountId && String(message.accountId) !== jobAccount) throw policy.failure('instagram_account_changed','A conta mudou. Atualiza o estado antes de continuar.');
        void publish().catch(()=>{});
        try {
          const result = await original(message);
          if (['account','watchlist'].includes(label)) clearIOSListCheckpoints(message.profileId);
          return result;
        } catch (error) {
          if(backgroundReads && error?.code==='ios_paused' && ['account','watchlist'].includes(label)) {
            backgroundReads=false;suspendedCheck=currentJob;
            throw policy.failure('check_preempted','Check em espera: o WebKit foi suspenso. Retoma ao regressar.');
          }
          if (switchingCheck && jobGeneration !== generation) throw policy.failure('check_preempted','Check em espera: outro check tem prioridade.');
          if (['account','watchlist'].includes(label)) clearIOSListCheckpoints(message.profileId);
          throw error;
        }
      }).finally(() => { void publish().catch(() => {}); });
    };
  }
  runNativeMonitorScan = wrap(runNativeMonitorScan, 'account');
  runNativeWatchlistScan = wrap(runNativeWatchlistScan, 'watchlist');
  const originalExecuteWatchlist = executeWatchlistTarget;
  executeWatchlistTarget = (owner,target) => {
    if (watchJob) return watchJob;
    watchRequest={scope:'watchlist',owner,message:{targetId:target},generation};
    const promise = originalExecuteWatchlist(owner,target).finally(()=>{
      if (watchJob === promise) {watchJob=null;watchRequest=null;}
      void publish().catch(()=>{});
      void resumeSuspendedCheck().catch(()=>{});
    });
    watchJob=promise;
    return promise;
  };
  async function prepareCheck(scope) {
    if (relationshipBatch && scope !== 'relationship') throw policy.failure('monitor_busy','A fila de ações está em curso. Podes consultar os dados guardados.');
    if (switchingCheck) throw policy.failure('monitor_busy','A prioridade está a mudar. Aguarda um momento.');
    if (!lane.active && !watchJob) return;
    const previousScope=lane.active ? jobScope : 'watchlist';
    if (!['account','watchlist'].includes(previousScope) || previousScope === scope) throw policy.failure('monitor_busy','Já existe um check deste tipo em execução.');
    const oldJob=lane.active ? currentJob : watchRequest;
    const wasActive=Boolean(lane.active);
    const pending=lane.active?.promise || Promise.resolve();
    const outer=watchJob;
    switchingCheck=true;
    suspendedCheck=oldJob;
    interrupt();
    const switchGeneration=generation;
    const switchOwner=accountCookie();
    try {
      const completed=await pending.then(()=>true,()=>false);
      if (wasActive && completed && suspendedCheck === oldJob) suspendedCheck=null;
      if (outer) await outer.catch(()=>{});
      if (generation !== switchGeneration || !eligible() || accountCookie() !== switchOwner) throw policy.failure('ios_paused','A mudança de prioridade foi cancelada.');
    }
    finally { switchingCheck=false; }
  }
  async function resumeSuspendedCheck() {
    if (relationshipBatch || switchingCheck || lane.active || watchJob || !suspendedCheck || !eligible()) return;
    const saved=suspendedCheck;suspendedCheck=null;
    if (saved.owner !== accountCookie()) {clearIOSListCheckpoints();return;}
    const safety=await readGlobalSafetyState();
    if (safety.blocked || saved.owner !== accountCookie() || !eligible()) return;
    if (saved.scope === 'watchlist') await executeWatchlistTarget(saved.owner,saved.message.targetId);
    else if (!paused) await globalThis.__FOLLOWCHECK_IOS_CONTROL__('scan');
  }
  runNativeRequestsRefresh = wrap(runNativeRequestsRefresh, 'requests');
  runNativeCancelRequests = wrap(runNativeCancelRequests, 'cancel-requests');
  performInstagramRelationshipAction = wrap(performInstagramRelationshipAction, 'relationship');
  const privateRequest = performInstagramPrivateRequest;
  const guardedPrivate = wrap(privateRequest, 'private-request');
  performInstagramPrivateRequest = request => request?.operation === 'relationship-action'
    ? privateRequest(request) : guardedPrivate(request);
  const originalSleep = monitorSleep;
  monitorSleep = async ms => {
    // Check lifecycle between short waits; don't continue an old scan on resume.
    let remaining = Math.max(0, Number(ms) || 0);
    while (remaining > 0) {
      assertEligible();
      const slice = Math.min(1000, remaining);
      await originalSleep(slice);
      remaining -= slice;
    }
    assertEligible();
  };
  const originalRequest = requestInstagramMainPage;
  requestInstagramMainPage = async (...args) => {
    assertEligible();
    return originalRequest(...args);
  };
  async function publish() {
    const owner = await watchlistOwnerId();
    if (owner && !recoveredAccounts.has(owner) && !lane.active && !watchJob && !switchingCheck) {
      recoveredAccounts.add(owner);
      const state = await readWatchlistState(owner);
      if (state.targets.some(t => t.running)) {
        state.targets = state.targets.map(t => t.running ? {...t,running:false,progress:null,
          lastErrorCode:'interrupted',lastError:'O check anterior foi interrompido. O último resultado completo mantém-se.',
          nextRunAt:Date.now() + Math.max(60, Number(t.intervalMinutes) || 1440) * 60_000} : t);
        await writeWatchlistState(owner,state);
      }
    }
    const [watchlist, safety] = await Promise.all([
      handleWatchlistCommand({action:'get'}).catch(() => ({ok:false})),
      readGlobalSafetyState(),
    ]);
    post({kind:'iosState', accountId:owner, paused, active, busy: Boolean(lane.active || relationshipBatch), scope:lane.active ? jobScope : relationshipBatch ? 'relationship' : '', schedulerEnabled:settings.enabled,
      retryAt, safety, watchlistSafety:{...safety,blocked:safety.blocked && !isIOSLocalUpgradeHold(safety)}, watchlist:watchlist.watchlist || {targets:[],events:[]}});
    await requestNativeSnapshot();
    if (/^\d{1,32}$/.test(owner || '') && owner === accountCookie()) {
      const key = `${MONITOR_STORAGE_PREFIX}:${owner}`;
      const stored = await chrome.storage.local.get(key);
      const snapshot = stored[key];
      if (snapshot?.completedAt > 0 && snapshot.complete !== false && owner === accountCookie()) {
        globalThis.FollowCheckOriginal?.capture(monitorAudienceFromStoredSnapshot(snapshot),owner,snapshot.completedAt);
        const result = recoveredOwnMonitorResult({}, snapshot, owner, snapshot.completedAt);
        const changes = snapshot.pendingChanges;
        const newChanges = changes?.schemaVersion === 2 ? ['newFollowers','lostFollowers','unavailableAccounts','reactivatedAccounts'].reduce((n,k)=>n+(Array.isArray(changes[k])?changes[k].length:0),0) : null;
        post({kind:'nativePort',message:{event:'native_snapshot',snapshot:{...result.snapshot,newChanges}}});
        const labels = {newFollowers:['new_follower','Novo seguidor'],lostFollowers:['unfollow_confirmed','Deixou de te seguir'],unavailableAccounts:['account_unavailable','Conta indisponível'],reactivatedAccounts:['account_reactivated','Conta voltou a estar disponível']};
        const events = changes?.schemaVersion === 2 ? Object.entries(labels).flatMap(([key,[type,title]]) => (Array.isArray(changes[key]) ? changes[key] : []).map(person => ({
          id:`${snapshot.completedAt}:${type}:${person.id || person.pk || person.username}`,type,title,
          username:person.username || '',fullName:person.full_name || person.fullName || '',profilePicUrl:person.profile_pic_url || person.profilePicUrl || '',
          detail:'Observado no último check completo.',timestamp:snapshot.completedAt
        }))) : [];
        post({kind:'accountActivity',accountId:owner,events});
      }
    }
  }
  async function tick() {
    if (relationshipBatch || scheduled || lane.active || watchJob || switchingCheck || suspendedCheck || !settings.enabled || !eligible() || Date.now() < retryAt) return;
    scheduled = true;
    try {
      const safety = await readGlobalSafetyState();
      if (safety.blocked && !isIOSLocalUpgradeHold(safety)) return;
      const owner = await watchlistOwnerId();
      if (!owner || !eligible()) return;
      const state = await readWatchlistState(owner);
      const target = policy.dueTarget(state.targets, Date.now());
      if (!target) return;
      const pacing = await resolveMonitorPacing({},"watchlist");
      await assertGlobalScanBudget('watchlist', pacing, false);
      await executeWatchlistTarget(owner, target.id);
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures = Math.min(consecutiveFailures + 1, 6);
      retryAt = Date.now() + Math.min(60, 2 ** consecutiveFailures) * 60_000;
      await backgroundLog('warn','ios-scheduler','deferred',policy.sanitizeText(error?.message),{retryAt});
    } finally {
      scheduled = false;
      void publish().catch(() => {});
    }
  }
  const settingsReady = chrome.storage.local.get(SETTINGS_KEY).then(s => {settings = {enabled:s[SETTINGS_KEY]?.enabled === true}; paused = s[SETTINGS_KEY]?.paused === true;});
  globalThis.__FOLLOWCHECK_IOS_CONTROL__ = async (command, args = {}) => {
    if (command !== 'lifecycle') await settingsReady;
    if (['likes','memories','legacy','workspace','relationship','relationshipBatch','requests','discover','lookup'].includes(command) && args.accountId !== undefined && String(args.accountId) !== accountCookie()) throw policy.failure('instagram_account_changed','A conta mudou. Atualiza os dados antes de continuar.');
    if(command==='likes') {
      const owner=accountCookie();
      if(!/^\d{1,32}$/.test(owner))throw policy.failure('login_required','Confirma a conta.');
      const targetId=String(args.targetId||'');
      const registry=targetId ? await readWatchlistState(owner) : null;
      const target=registry?.targets.find(item=>item.id===targetId);
      if(targetId && !target)throw policy.failure('target_missing','O perfil já não está na Watchlist.');
      const userId=targetId ? String(target.userId||'') : owner;
      const key=`followcheck:media-likes:v1:${owner}:${targetId||'own'}`;
      const saved=await chrome.storage.local.get(key);
      if(args.operation!=='refresh')return {ok:true,accountId:owner,posts:saved[key]||[]};
      if(!/^\d{1,32}$/.test(userId))throw policy.failure('identity_required','Conclui primeiro um check deste perfil.');
      const core=globalThis.FollowCheckOriginal;
      if(!core?.mediaLikes)throw policy.failure('engine_unavailable','O leitor ainda está a iniciar.');
      assertEligible();await assertGlobalSafety('media-likes');
      const controller=new AbortController();const cancel=()=>controller.abort();
      document.addEventListener('followcheck:ios:cancel',cancel,{once:true});
      try {
        const incoming=await wrap(()=>core.mediaLikes(userId,Math.max(1,Math.min(8,Number(args.amount)||3)),controller.signal,async request=>{
          const result=await requestInstagramMainPage(request.operation,request);
          assertEligible();
          if(owner!==accountCookie())throw policy.failure('instagram_account_changed','A conta mudou.');
          if(!result?.ok){
            const error=policy.failure(result?.status===429?'rate_limited':'media_read_failed',`Gostos: ${request.operation==='media-feed'?'publicações':'lista de gostos'} · HTTP ${Number(result?.status)||0} · ${String(result?.responseKind||'sem resposta')}. Dados anteriores preservados.`);
            error.httpStatus=Number(result?.status)||0;throw error;
          }
          return result.data;
        }),'media-likes')();
        assertEligible();
        if(owner!==accountCookie())throw policy.failure('instagram_account_changed','A conta mudou.');
        if(targetId && !(await readWatchlistState(owner)).targets.some(item=>item.id===targetId))throw policy.failure('target_missing','O perfil foi removido.');
        const posts=mergeMediaLikeObservations(saved[key]||[],incoming);
        await chrome.storage.local.set({[key]:posts});
        return {ok:true,accountId:owner,posts};
      } catch(error) {
        await tripSafetyFromError(error,'media-likes').catch(()=>{});
        throw error;
      } finally {document.removeEventListener('followcheck:ios:cancel',cancel);}
    }
    if(command==='memories') {
      const owner=accountCookie();
      if(!['get','clear'].includes(args.operation||'get'))throw policy.failure('invalid_command','Operação desconhecida.');
      const memories=await privateMemoryOperation(args.operation||'get',null,owner);
      if(owner!==accountCookie())throw policy.failure('instagram_account_changed','A conta mudou.');
      return {ok:true,accountId:owner,memories};
    }
    if (command === 'legacy') {
      const core=globalThis.FollowCheckOriginal;
      if(!core) throw policy.failure('engine_unavailable','A lógica original ainda está a carregar.');
      const owner=accountCookie();
      if(!/^\d{1,32}$/.test(owner)) throw policy.failure('login_required','Confirma a sessão.');
      const replay=await monitorAudienceReplay(owner);
      if(owner!==accountCookie()) throw policy.failure('instagram_account_changed','A conta mudou.');
      if(!replay?.complete && args.operation==='recipes') return {ok:true,accountId:owner,recipes:[],templates:core.templates(),needsSnapshot:true};
      if(!replay?.complete) throw policy.failure('snapshot_required','Faz primeiro um check completo da audiência.');
      const users=replay.audience;
      const checkOwner=()=>{if(owner!==accountCookie())throw policy.failure('instagram_account_changed','A conta mudou.');};
      core.scope(owner);
      if(args.operation==='recipes') return {ok:true,accountId:owner,recipes:core.recipes(users,owner),templates:core.templates()};
      if(args.operation==='import') {
        const files=args.nativeFiles?.length ? args.nativeFiles.map(f=>core.nativeArchive(f)) : (args.files||[]).map(f=>new File([Uint8Array.from(atob(f.base64),c=>c.charCodeAt(0))],String(f.name)));
        const imported=await core.importFiles(files,users,{userId:owner,username:String(args.username||'')},progress=>post({kind:'legacyProgress',accountId:owner,progress}));
        checkOwner();
        await privateMemoryOperation('set',imported.memories,owner);
        checkOwner();
      } else if(['conversations','engagement','verify','professional'].includes(args.operation)) {
        assertEligible();if(args.operation!=='professional')await assertGlobalSafety('relationship-evidence');
        const controller=new AbortController();
        const cancel=()=>controller.abort();document.addEventListener('followcheck:ios:cancel',cancel,{once:true});
        try {
          const selected=users.filter(user=>(args.ids||[]).map(String).includes(String(user.id)));
          if(args.operation==='verify' && !selected.length) throw policy.failure('selection_required','Seleciona os perfis a verificar.');
          const facts=await wrap(()=>args.operation==='professional'?core.professionalFacts(users,{userId:owner,username:String(args.username||'')},args.ids||[],controller.signal,progress=>post({kind:'legacyProgress',accountId:owner,progress})):args.operation==='verify'?core.verify(selected,controller.signal):args.operation==='conversations'?core.conversationFacts(users,controller.signal,request=>privateRequest(request)):core.engagementFacts(users,controller.signal),'legacy-source')();
          checkOwner();
          const name=args.operation==='professional'?'relationship-zernio-facts':args.operation==='verify'?'relationship-live-facts':args.operation==='conversations'?'relationship-conversation-facts':'relationship-engagement-facts';
          localStorage.setItem(`followcheck:v3:account:${owner}:${name}`,JSON.stringify({version:3,data:facts}));
        } finally {document.removeEventListener('followcheck:ios:cancel',cancel);}
      } else if(args.operation!=='derive') throw policy.failure('invalid_command','Operação desconhecida.');
      checkOwner();
      return {ok:true,accountId:owner,...core.derive(users,owner,args.target)};
    }
    if (command === 'state') { await inspectInstagramSessionForNative(); await publish(); return {ok:true}; }
    if (command === 'lifecycle') {
      active = args.active === true;
      backgroundReads = !active && args.continueChecks === true && Boolean(lane.active) && ['account','watchlist'].includes(jobScope);
      if (!active && !backgroundReads) {
        relationshipBatch=null;
        if (!backgroundSuspension) {
          const pending=lane.active?.promise;
          const outer=watchJob;
          if (lane.active && ['account','watchlist'].includes(jobScope)) suspendedCheck=currentJob;
          switchingCheck=Boolean(suspendedCheck);
          interrupt();
          backgroundSuspension=(async()=>{
            try {await pending?.catch(()=>{});await outer?.catch(()=>{});}
            finally {switchingCheck=false;backgroundSuspension=null;void publish().catch(()=>{});}
          })();
        }
      } else if (active) {
        if (backgroundSuspension) void backgroundSuspension.then(()=>resumeSuspendedCheck()).catch(()=>{});
        else void resumeSuspendedCheck().catch(()=>{});
      }
      return {ok:true};
    }
    if (command === 'cancelCurrent') { relationshipBatch=null;suspendedCheck=null;interrupt();clearIOSListCheckpoints();await publish();return {ok:true}; }
    if (command === 'pause') { paused = args.paused === true; if (paused && (!lane.active || jobScope === 'account')) interrupt(); await chrome.storage.local.set({[SETTINGS_KEY]:{...settings,paused}}); await publish(); return {ok:true}; }
    if (command === 'schedule') {
      settings = {enabled:args.enabled === true,paused};
      await chrome.storage.local.set({[SETTINGS_KEY]:settings});
      await publish(); return {ok:true};
    }
    if (command === 'confirmSession') {
      if (lane.active || !active || document.hidden || !policy.allowedURL(location.href)) throw policy.failure('session_unverified','Conclui primeiro a verificação no Instagram.');
      const safety = await readGlobalSafetyState();
      if (safety.cooldownUntil > Date.now()) throw policy.failure('cooldown_active','O intervalo de espera ainda não terminou.');
      const session = await resolveMonitorInstagramSession(await getAnyInstagramTab());
      if (!session?.userId || !session.sessionId || session.securityWarning || session.blocked) throw policy.failure('session_unverified','A sessão ainda não foi confirmada.');
      await resetGlobalSafetyState();
      await inspectInstagramSessionForNative();
      await publish(); return {ok:true};
    }
    if (command === 'inbox') {
      assertEligible();
      const safety = await readGlobalSafetyState();
      if (safety.blocked) throw policy.failure('safety_blocked','Reavalia a sessão antes de atualizar a Inbox.');
      const owner = accountCookie();
      // Use the session reader once. Replaying the legacy reader first hits the
      // same unavailable routes repeatedly and cannot repair an HTTP 404.
      const result = await performInstagramPrivateRequest({operation:args.threadId ? 'read-thread' : 'read-inbox',
        threadId:String(args.threadId || ''),kind:args.kind==='pending'?'pending':'inbox',cursor:String(args.cursor || ''),limit:30});
      assertEligible();
      if (owner !== accountCookie()) throw policy.failure('instagram_account_changed','A conta mudou.');
      if (!result?.ok && Number(result?.status) === 404) throw policy.failure('inbox_route_unavailable','A rota de leitura da Inbox respondeu 404. Isto não confirma um bloqueio da conta. Abre as mensagens na sessão Instagram; as conversas guardadas foram preservadas.');
      if (!result?.ok) throw policy.failure('inbox_unavailable',`Inbox indisponível: HTTP ${Number(result?.status)||0}, ${String(result?.responseKind||'resposta ausente')}. As conversas anteriores foram preservadas.`);
      const data = result.data?.data || result.data;
      if(!args.threadId && data?.pending_inbox && !data.inbox) data.inbox=data.pending_inbox;
      const entries = args.threadId ? data?.thread?.items : data?.inbox?.threads;
      if (!Array.isArray(entries)) throw policy.failure('inbox_response_invalid','A resposta não contém uma lista de mensagens válida. Não foi tratada como uma Inbox vazia.');
      return {ok:true,accountId:owner,data,kind:args.kind||'inbox',append:!!args.cursor,threadId:String(args.threadId || '')};
    }
    if (command === 'relations') {
      const owner = accountCookie();
      if (!/^\d{1,32}$/.test(owner)) throw policy.failure('login_required','Confirma a sessão para abrir as relações.');
      const replay = await monitorAudienceReplay(owner);
      if (owner !== accountCookie()) throw policy.failure('instagram_account_changed','A conta mudou.');
      if (!replay?.complete) return {ok:true, accountId:owner, ready:false, accounts:[]};
      return {ok:true, accountId:owner, ready:true, accounts:replay.audience.map(u=>({
        id:String(u.id || u.pk || ''),username:String(u.username || ''),name:String(u.full_name || u.fullName || ''),
        photoURL:String(u.profile_pic_url || u.profilePicUrl || ''),
        follows:u.follows_viewer === true,following:u.followed_by_viewer === true
      })).filter(u=>u.id), completedAt:replay.completedAt};
    }
    if (command === 'cooldown') {
      if (lane.active) throw policy.failure('busy','Espera que a operação atual termine.');
      const minutes=Number(args.minutes);
      if (!Number.isFinite(minutes) || minutes<1 || minutes>1440) throw policy.failure('invalid_setting','Escolhe entre 1 e 1440 minutos.');
      await chrome.storage.local.set({'followcheck:ios:cooldown-minutes:v1':Math.round(minutes)});
      const safety=await readGlobalSafetyState();
      if (safety.cooldownUntil>0) {
        const until=args.release===true ? Date.now() : (safety.triggeredAt || Date.now())+Math.round(minutes)*60000;
        await writeGlobalSafetyState({...safety,cooldownUntil:Math.max(safety.serverCooldownUntil,until)},'local-cooldown-adjusted');
      }
      await publish();return {ok:true};
    }
    if (command === 'pacing') {
      const own=normalizeMonitorPacing(args.own || {});
      const watchlist=normalizeMonitorPacing({...args.watchlist,globalGapMinutes:0,manualRespectsGap:false});
      await chrome.storage.local.set({'followcheck:ios:pacing:own:v1':own,'followcheck:ios:pacing:watchlist:v1':watchlist});
      return {ok:true,own,watchlist};
    }
    if (command === 'backup') {
      const owner=accountCookie();
      if (!/^\d{1,32}$/.test(owner) || String(args.accountId || '')!==owner) throw policy.failure('backup_account','Confirma a mesma conta para recuperar os dados.');
      if(lane.active && args.operation==='restore') throw policy.failure('monitor_busy','Aguarda a conclusão da operação antes de recuperar os dados.');
      const ownKey=`${MONITOR_STORAGE_PREFIX}:${owner}`;
      const allowedKey=k=>[ownKey,`${MONITOR_STORAGE_PREFIX}:availability:${owner}`,`${MONITOR_STORAGE_PREFIX}:arrivals:${owner}`,watchlistRegistryKey(owner)].includes(k) || new RegExp(`^followcheck:watchlist:v1:${owner}:\\d{1,32}$`).test(k);
      const names=['protected','profile-meta','history','snapshots','content-items','audience','automation-campaigns','collections','cleanup-decisions','relationship-analysis','relationship-decisions','relationship-preferences','relationship-history','relationship-live-facts','relationship-conversation-facts','relationship-engagement-facts','relationship-zernio-facts','relationship-protection-overrides','operation-draft'];
      const localKeys=names.map(n=>`followcheck:v3:account:${owner}:${n}`);
      if(args.operation==='restore') {
        const backup=args.backup;
        if(!backup || backup.format!=='followcheck-backup' || backup.version!==1 || backup.accountId!==owner || JSON.stringify(backup).length>40*1024*1024) throw policy.failure('backup_invalid','Cópia inválida ou pertencente a outra conta.');
        const storage=backup.storage,local=backup.local;
        if(!storage || !local || typeof storage!=='object' || typeof local!=='object' || Object.keys(storage).some(k=>!allowedKey(k)) || Object.keys(local).some(k=>!localKeys.includes(k))) throw policy.failure('backup_invalid','A cópia contém campos não permitidos.');
        if(storage[ownKey] && (!Array.isArray(storage[ownKey].followers)||!Array.isArray(storage[ownKey].following)||!Number.isFinite(storage[ownKey].completedAt)||storage[ownKey].completedAt<=0||storage[ownKey].complete===false)) throw policy.failure('backup_invalid','O check da cópia está incompleto.');
        for(const value of Object.values(local)) {if(typeof value!=='string')throw policy.failure('backup_invalid','Dados locais inválidos.'); const parsed=JSON.parse(value);if(parsed.version!==3)throw policy.failure('backup_invalid','Formato local desconhecido.');}
        const existing=await chrome.storage.local.get(Object.keys(storage));
        if(owner!==accountCookie())throw policy.failure('backup_account','A conta mudou.');
        const missing=Object.fromEntries(Object.entries(storage).filter(([k])=>existing[k]==null));
        await chrome.storage.local.set(missing);
        if(owner!==accountCookie())throw policy.failure('backup_account','A conta mudou.');
        for(const [key,value] of Object.entries(local))if(localStorage.getItem(key)==null)localStorage.setItem(key,value);
        await publish();return {ok:true,accountId:owner,restored:Object.keys(missing).length};
      }
      const all=await chrome.storage.local.get(null);
      if(owner!==accountCookie())throw policy.failure('backup_account','A conta mudou.');
      const storage=Object.fromEntries(Object.entries(all).filter(([k])=>allowedKey(k)));
      const local=Object.fromEntries(localKeys.map(k=>[k,localStorage.getItem(k)]).filter(([,v])=>v!==null));
      return {ok:true,backup:{format:'followcheck-backup',version:1,accountId:owner,createdAt:new Date().toISOString(),storage,local}};
    }
    if (command === 'lookup') {
      return wrap(async () => {
        await assertGlobalSafety('profile-lookup');
        const username=validInstagramUsername(args.username || '');
        if(!username)throw policy.failure('invalid_username','Username inválido.');
        const result=await requestInstagramMainPage('profile-info',{username},null);
        if(result?.securityWarning){await tripGlobalSafety('instagram_security_warning','O Instagram apresentou um aviso de segurança.',{source:'profile-lookup'});throw policy.failure('instagram_security_warning','Confirma a conta no Instagram.');}
        const user=result?.data?.data?.user||result?.data?.user;
        if(!result?.ok || !user)throw policy.failure('profile_unavailable','O Instagram não disponibilizou este perfil.');
        const id=String(user.pk||user.id||'');if(!/^\d{1,32}$/.test(id))throw policy.failure('profile_unavailable','A identidade não foi confirmada.');
        return {ok:true,accountId:accountCookie(),person:{id,username:String(user.username||username),name:String(user.full_name||''),follows:user.follows_viewer===true,following:user.followed_by_viewer===true}};
      },'lookup')();
    }
    if (command === 'requests') {
      return wrap(async () => {
        await assertGlobalSafety('follow-requests');
        const kind = args.kind === 'incoming' ? 'pending' : 'outgoing';
        const users=new Map(), cursors=new Set();let cursor='';
        for(let page=0;page<40;page++) {
          assertEligible();
          const query=new URLSearchParams({count:'50'});if(cursor)query.set('max_id',cursor);
          const response=await fetch(`/api/v1/friendships/${kind}/?${query}`,{credentials:'include',headers:{Accept:'application/json','X-IG-App-ID':INSTAGRAM_WEB_APP_ID}});
          if(response.status===429){await tripGlobalSafety('rate_limited','O Instagram pediu uma pausa.',{manualResetRequired:false,source:'follow-requests'});throw policy.failure('rate_limited','O Instagram pediu uma pausa.');}
          if(!response.ok || !String(response.headers.get('content-type')).includes('json'))throw policy.failure('requests_unavailable','O Instagram não disponibilizou esta lista. Não foi assumido que está vazia.');
          const data=await response.json();if(!Array.isArray(data.users))throw policy.failure('shape_changed','A resposta não contém uma lista válida de pedidos.');
          for(const u of data.users){const id=String(u.pk||u.id||'');if(id)users.set(id,{id,username:String(u.username||''),name:String(u.full_name||'')});}
          const next=String(data.next_max_id||data.next_cursor||'');
          if(!next)return {ok:true,accountId:accountCookie(),accounts:[...users.values()]};
          if(cursors.has(next))throw policy.failure('pagination_incomplete','A lista ficou incompleta. O resultado anterior foi preservado.');
          cursors.add(next);cursor=next;await monitorSleep(5000);
        }
        throw policy.failure('pagination_incomplete','A lista não terminou. O resultado anterior foi preservado.');
      },'requests')();
    }
    if (command === 'discover') {
      return wrap(async () => {
        await assertGlobalSafety('discovery');
        const tag = String(args.tag || '').replace(/^#+/,'').trim();
        if (!/^[\p{L}\p{N}_.]{1,80}$/u.test(tag)) throw policy.failure('invalid_tag','Escreve uma hashtag válida.');
        const response = await fetch(`/api/v1/tags/web_info/?tag_name=${encodeURIComponent(tag)}`,{credentials:'include',headers:{Accept:'application/json','X-IG-App-ID':INSTAGRAM_WEB_APP_ID}});
        if (response.status === 429) {await tripGlobalSafety('rate_limited','O Instagram pediu uma pausa.',{manualResetRequired:false,source:'discovery'});throw policy.failure('rate_limited','O Instagram pediu uma pausa.');}
        if (!response.ok || !String(response.headers.get('content-type')).includes('json')) throw policy.failure('discovery_unavailable','O Instagram não disponibilizou esta pesquisa.');
        const data=await response.json(); const pending=[data], seen=new Set(), users=new Map();
        while(pending.length) {
          const item=pending.pop();if(!item || typeof item!=='object'||seen.has(item))continue;seen.add(item);
          const user=item.user;
          if(user?.username){const id=String(user.pk||user.pk_id||user.id||'');if(/^\d{1,32}$/.test(id))users.set(id,{id,username:String(user.username),name:String(user.full_name||'')});}
          for(const value of Object.values(item))if(value&&typeof value==='object')pending.push(value);
        }
        assertEligible();return {ok:true,accountId:accountCookie(),accounts:[...users.values()]};
      },'discovery')();
    }
    if (command === 'workspace') {
      const owner = accountCookie();
      if (!/^\d{1,32}$/.test(owner)) throw policy.failure('login_required','Confirma a conta para abrir os teus dados.');
      const allowed = new Set(['protected','profile-meta','history','content-items','automation-campaigns','collections','tool-preferences','snapshots','cleanup-decisions','relationship-decisions','relationship-preferences','relationship-analysis','relationship-history','relationship-live-facts','relationship-conversation-facts','relationship-engagement-facts','relationship-zernio-facts','relationship-protection-overrides','operation-draft']);
      const key = name => name === 'tool-preferences' ? `followcheck:v3:global:${name}` : `followcheck:v3:account:${owner}:${name}`;
      const read = (name, fallback) => { try {const v=JSON.parse(localStorage.getItem(key(name)) || 'null'); return v?.version === 3 ? v.data : fallback;} catch {return fallback;} };
      if (args.operation === 'set') {
        if (!allowed.has(args.name) || args.name === 'snapshots') throw policy.failure('invalid_command','Dados não editáveis.');
        if (JSON.stringify(args.value).length > 2_000_000) throw policy.failure('too_large','Este registo é demasiado grande.');
        localStorage.setItem(key(args.name),JSON.stringify({version:3,data:args.value}));
      }
      return {ok:true,accountId:owner,workspace:Object.fromEntries([...allowed].map(name=>[name,read(name,['profile-meta','cleanup-decisions','relationship-decisions','relationship-preferences','relationship-live-facts','relationship-conversation-facts','relationship-engagement-facts','relationship-zernio-facts','relationship-protection-overrides'].includes(name)?{}:name==='tool-preferences'?{favorites:[],recent:[]}:[])]))};
    }
    if (command === 'relationshipBatch') {
      if (!args.batchId || !/^\d{1,32}$/.test(accountCookie())) throw policy.failure('invalid_command','Fila inválida.');
      if (args.operation === 'end') {
        if (relationshipBatch?.id === args.batchId && relationshipBatch.owner === accountCookie()) {
          relationshipBatch=null;
          await publish();
          void resumeSuspendedCheck().catch(()=>{});
        }
        return {ok:true};
      }
      if (args.operation !== 'begin') throw policy.failure('invalid_command','Operação de fila inválida.');
      assertEligible();
      if (relationshipBatch) throw policy.failure('monitor_busy','Já existe uma fila em curso.');
      const owner=accountCookie();
      // Reserve before awaiting preemption so another queue cannot claim the gap.
      relationshipBatch={id:args.batchId,owner};
      try { await prepareCheck('relationship'); assertEligible(); }
      catch(error) {relationshipBatch=null;void resumeSuspendedCheck().catch(()=>{});throw error;}
      if (owner !== accountCookie() || !relationshipBatch) {relationshipBatch=null;throw policy.failure('instagram_account_changed','A fila foi interrompida.');}
      await publish();return {ok:true};
    }
    if (command === 'relationship') {
      if (args.batchId && (relationshipBatch?.id !== args.batchId || relationshipBatch.owner !== accountCookie())) throw policy.failure('ios_paused','A fila foi interrompida. Revê as ações restantes.');
      if (relationshipBatch && args.batchId !== relationshipBatch.id) throw policy.failure('monitor_busy','Já existe uma fila em curso.');
      assertEligible();
      await prepareCheck('relationship');
      let attemptedWrite=false;
      try {
      const owner = accountCookie();
      const protectedKey = `followcheck:v3:account:${owner}:protected`;
      const protectedIds = JSON.parse(localStorage.getItem(protectedKey) || '{"data":[]}').data || [];
      if (protectedIds.includes(String(args.targetId))) throw policy.failure('protected_profile','Este perfil está protegido. Remove a proteção antes de preparar uma ação.');
      attemptedWrite=true;
      const result = await performInstagramRelationshipAction({action:args.action,targetId:String(args.targetId),username:String(args.username||''),accountId:owner});
      if (owner !== accountCookie()) throw policy.failure('instagram_account_changed','A conta mudou.');
      const success = result?.ok === true;
      const historyKey = `followcheck:v3:account:${owner}:history`;
      const previous = JSON.parse(localStorage.getItem(historyKey) || '{"data":[]}').data || [];
      const item = {id:crypto.randomUUID(),action:String(args.action),username:String(args.username||''),targetId:String(args.targetId),
        timestamp:new Date().toISOString(),success,simulated:false,message:success?'Ação confirmada pelo Instagram':'Ação não confirmada'};
      localStorage.setItem(historyKey,JSON.stringify({version:3,data:[item,...previous].slice(0,250)}));
      if (!success) {
        const attempts=(result?.attempts||[]).map(a=>`${a.phase} [${a.transport||"page-fetch"}]: ${Number(a.status)>0 ? "HTTP "+Number(a.status):"HTTP não exposto"}, ${String(a.responseKind||'desconhecido')}, destino=${String(a.endpoint||'desconhecido').slice(0,180)}, redirecionado=${a.redirected===true}`).join(' · ');
        const state=result?.verification?.state;
        const stateDetail=state ? `Estado verificado: following=${state.following}, outgoingRequest=${state.outgoingRequest}, followedBy=${state.followedBy}.` : 'Estado da relação ausente na resposta.';
        const detail=stateDetail+' '+policy.sanitizeText(result?.message || result?.data?.message || result?.data?.error_type || 'Sem confirmação do estado final.');
        await backgroundLog('warn','relationship','unconfirmed',`${String(args.action)}: ${attempts}. ${detail}`,{});
        throw policy.failure('relationship_unconfirmed',`Ação não confirmada. ${attempts || `HTTP ${Number(result?.status)||0}`}. ${detail} A fila parou; a ação não foi repetida.`);
      }
      // Reconcile only server-confirmed actions, without pretending a full scan ran.
      const key = `${MONITOR_STORAGE_PREFIX}:${owner}`;
      const stored = (await chrome.storage.local.get(key))[key];
      if (stored?.complete !== false && stored?.completedAt > 0) {
        const id = String(args.targetId);
        const audience = monitorAudienceFromStoredSnapshot(stored);
        const existing = audience.find(u=>String(u.id || u.pk) === id);
        const user = {...existing,id,username:String(args.username || existing?.username || ''),
          full_name:String(args.name || existing?.full_name || ''),profile_pic_url:String(args.photoURL || existing?.profile_pic_url || '')};
        const state = result?.verification?.state;
        const followers = audience.filter(u=>u.follows_viewer === true);
        const following = audience.filter(u=>u.followed_by_viewer === true);
        const update = (list, value) => typeof value !== 'boolean' ? list : value
          ? [...list.filter(u=>String(u.id || u.pk)!==id),user]
          : list.filter(u=>String(u.id || u.pk)!==id);
        const next = {...stored, followers:update(followers, state?.followedBy ?? (args.action === 'removeFollower' ? false : undefined)),
          following:update(following,state?.following ?? (args.action === 'unfollow' ? false : undefined)),lastActionAt:Date.now()};
        delete next.audience;
        delete next.pendingNativeResult;
        if (owner !== accountCookie()) throw policy.failure('instagram_account_changed','A conta mudou.');
        await chrome.storage.local.set({[key]:next});
        await publish();
      }
      if(args.action==='mute') {
        const metaKey=`followcheck:v3:account:${owner}:profile-meta`;
        let metadata={};try{metadata=JSON.parse(localStorage.getItem(metaKey)||'{}').data||{};}catch{}
        metadata[args.targetId]={...metadata[args.targetId],mutedPosts:true,mutedStories:true,mutedAt:new Date().toISOString()};
        localStorage.setItem(metaKey,JSON.stringify({version:3,data:metadata}));
      }
      return {ok:true,accountId:owner,item};
      } finally {
        // A write may invalidate pages read before it, even if its outcome is unknown.
        if (attemptedWrite) clearIOSListCheckpoints();
        post({kind:'accountDataChanged',accountId:accountCookie()});
        void resumeSuspendedCheck().catch(()=>{});
      }
    }
    if (command === 'integration') {
      if (args.operation === 'nativeCredentials') return {ok:true,config:await getZernioConfig({includeSecret:true})};
      if (args.operation === 'config') return {ok:true,config:await getZernioConfig()};
      if (args.operation === 'configure') return {ok:true,config:await setZernioConfig(args.config || {})};
      if (args.operation === 'disconnect') {await chrome.storage.local.remove(ZERNIO_CONFIG_KEY); return {ok:true,config:await getZernioConfig()};}
      const result = await performZernioRequest(args.request || {});
      return {ok:true,result};
    }
    if (command === 'logs') {
      await backgroundLogWrites;
      const stored = await chrome.storage.local.get(BACKGROUND_TECHNICAL_LOG_KEY);
      return {ok:true, logs:(stored[BACKGROUND_TECHNICAL_LOG_KEY] || []).slice(-1000).map(e => ({
        id:e.id, at:e.at, level:e.level, source:e.source, event:e.event, message:policy.sanitizeText(e.message), meta:safeBackgroundMeta(e.meta || {})
      }))};
    }
    if (command === 'clearLogs') {
      backgroundLogWrites = backgroundLogWrites.catch(() => {}).then(() => chrome.storage.local.remove(BACKGROUND_TECHNICAL_LOG_KEY));
      await backgroundLogWrites;
      return {ok:true};
    }
    if (command === 'watchlist') {
      if (['add','run'].includes(args.action)) assertEligible();
      if (['add','run'].includes(args.action)) await prepareCheck('watchlist');
      if (lane.active && ['add','run','remove','update'].includes(args.action)) throw policy.failure('monitor_busy','Aguarda o fim da operação atual.');
      const owner = accountCookie();
      const result = await handleWatchlistCommand(args);
      if (owner !== accountCookie()) throw policy.failure('instagram_account_changed','A conta mudou.');
      if(args.action==='remove' && result?.ok!==false)await chrome.storage.local.remove(`followcheck:media-likes:v1:${owner}:${String(args.targetId||'')}`);
      await publish(); return result;
    }
    if (command === 'scan') {
      if (paused) throw policy.failure('ios_paused','A análise da tua conta está pausada.');
      await prepareCheck('account');
      assertEligible();
      const session = await resolveMonitorInstagramSession(await getAnyInstagramTab());
      if (!session?.userId || !session.sessionId) throw policy.failure('login_required','Confirma a sessão no Instagram.');
      try {
        const result = await runNativeMonitorScan({accountId:session.userId,username:session.username || '',
          profileId:`ios:${session.userId}`,checkId:crypto.randomUUID(),manual:true,trigger:'ios-foreground'});
        return {ok:true, checkId:result.checkId};
      } catch(error) {
        if (error?.code === 'check_preempted') return {ok:true,suspended:true};
        throw error;
      } finally { void resumeSuspendedCheck().catch(()=>{}); }
    }
    throw policy.failure('invalid_command','Comando desconhecido.');
  };
  void settingsReady.catch(() => { paused = true; });
  globalThis.setInterval(() => { void tick(); }, 30_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) {void publish().catch(() => {});void resumeSuspendedCheck().catch(()=>{});} });
}
