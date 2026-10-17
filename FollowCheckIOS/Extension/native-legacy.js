/* Appended inside the preserved React bundle's lexical scope, before mounting.
   SwiftUI owns every screen. These are the ORIGINAL data algorithms, not JSX. */
CS();
globalThis.FollowCheckOriginal = {
  version: '10.20.8',
  nativeArchive(descriptor) {
    const {nativeId:id,name,size}=descriptor;
    if(!id || !Number.isSafeInteger(size) || size<=0 || size>1024**3) throw new Error('Arquivo inválido.');
    const read=async(offset,count)=>{
      const result=await webkit.messageHandlers.followcheckRPC.postMessage({kind:'archive.read',details:{id,offset,count}});
      const bytes=Uint8Array.from(atob(result.base64),c=>c.charCodeAt(0));
      if(bytes.length!==count)throw new Error('O ficheiro mudou durante a leitura.');
      return bytes;
    };
    const part=(start,end)=>({size:end-start,async arrayBuffer(){
      if(end-start>64*1024**2)throw new Error('Um ficheiro JSON excede 64 MB. Divide a exportação por datas.');
      const output=new Uint8Array(end-start);
      for(let offset=start;offset<end;offset+=1024**2)output.set(await read(offset,Math.min(1024**2,end-offset)),offset-start);
      return output.buffer;
    },async text(){return new TextDecoder().decode(await this.arrayBuffer());}});
    return {...part(0,size),name,slice(start=0,end=size){return part(Math.max(0,start),Math.min(size,end));},validate:()=>read(0,0)};
  },
  async professionalFacts(users,identity,priorityUserIds,signal,onProgress) {
    const previous=vt,getConfig=Ae.getConfig,setConfig=Ae.setConfig;
    const rpc=details=>webkit.messageHandlers.followcheckRPC.postMessage({kind:'evidence.professional',details:{...details,accountId:String(identity.userId)}});
    vt=(path,options={})=>{
      if(options.method && options.method!=='GET')throw new Error('A evidência só permite leitura.');
      Rl(signal);const query=Object.fromEntries(Object.entries(options.query||{}).filter(([,v])=>v!==undefined && v!==null).map(([k,v])=>[k,Array.isArray(v)?v.map(String):String(v)]));
      return rpc({operation:'read',path,query});
    };
    Ae.getConfig=async()=>(await rpc({operation:'config'})).config;
    Ae.setConfig=async config=>(await rpc({operation:'select',config})).config;
    try{return await mS({users,accountIdentity:identity,priorityUserIds,signal,onProgress});}
    finally{vt=previous;Ae.getConfig=getConfig;Ae.setConfig=setConfig;}
  },
  scope(owner) { we.setAccountScope(owner); },
  templates() { return a8.map(({icon,...template})=>template); },
  recipes(users,owner) {
    we.setAccountScope(owner);
    const snapshots=we.getSnapshots();
    const changes=H5(users,snapshots.length>1?snapshots[snapshots.length-2]:null);
    return U5({users,protectedIds:new Set(we.getProtected()),profileMeta:we.getProfileMeta(),changes,snapshots})
      .map(({id,action,name,description,rules,tone,candidates})=>({id,action,name,description,rules,tone,candidates}));
  },
  capture(users,owner,completedAt) {
    we.setAccountScope(owner);
    const date=new Date(completedAt).toISOString();
    we.setAudience(users,date);
    const snapshots=we.getSnapshots();
    if(snapshots.some(s=>s.timestamp===date)) return;
    const snapshot=Eh(users,date);
    we.setSnapshots([...snapshots,snapshot].slice(-20));
    we.setProfileMeta(VS(users,we.getProfileMeta(),[snapshot]));
  },
  derive(users, owner, target = 300) {
    we.setAccountScope(owner);
    const analysis=we.getRelationshipAnalysis();
    const profiles=analysis?.profiles || [];
    const byId=new Map(profiles.map(p=>[String(p.userId),p]));
    const byName=new Map(profiles.map(p=>[String(p.username||'').toLowerCase(),p]));
    const protectedIds=new Set(we.getProtected());
    const metadata=we.getProfileMeta(), snapshots=we.getSnapshots();
    const live=we.getRelationshipLiveFacts();
    const conversations=we.getRelationshipConversationFacts();
    const engagement=we.getRelationshipEngagementFacts();
    const professional=we.getRelationshipZernioFacts();
    const overrides=we.getRelationshipProtectionOverrides();
    const decisions=we.getRelationshipDecisions();
    const previous=[...we.getRelationshipHistory()].reverse().find(p=>p.importedAt!==analysis?.importedAt);
    const old=new Map((previous?.profiles||[]).map(p=>[String(p.userId),p]));
    const rows=users.map(user=>{
      const profile=byId.get(String(user.id))||byName.get(String(user.username||'').toLowerCase())||jz(user);
      const features=aS({profile,user,profileMeta:metadata,protectedIds,snapshots,
        protectionOverride:overrides[user.id],liveFact:live[user.id],
        conversationFact:conversations?.facts?.[user.id],conversationSource:conversations?.source,
        engagementFact:engagement?.facts?.[user.id],engagementSource:engagement?.source,
        zernioFact:professional?.facts?.[user.id],zernioSource:professional?.source,zernioAvailable:professional?.source?.accountMatched===true,
        previousProfile:old.get(String(user.id))});
      return {user,profile,features,relation:xt(user),isProtected:features.smartProtected,
        decision:decisions[user.id]||xD(profile,features.smartProtected,features)};
    });
    const plan=nS(rows,target);
    return {rows,plan:{...plan,candidates:plan.candidates.map(r=>r.user.id)},acquisition:eS(rows),source:analysis?.source||null};
  },
  async importFiles(files,users,identity,onProgress) {
    const owner=String(identity.userId);
    const analysis=await Xz(files,users,onProgress,{ownerAliases:[identity.username,identity.fullName].filter(Boolean),ownerAccountId:owner});
    Gz(analysis,identity);
    for(const file of files)await file.validate?.();
    if(String(document.cookie||'').match(/(?:^|;\s*)ds_user_id=([^;]+)/)?.[1]!==owner) throw new Error('A conta mudou durante a importação.');
    we.setAccountScope(owner);
    const compact=Cb(analysis);
    we.setRelationshipAnalysis(compact);
    const entry=rS(compact);
    we.setRelationshipHistory([...we.getRelationshipHistory().filter(p=>p.importedAt!==entry.importedAt),entry].slice(-12));
    we.setRelationshipDecisions({});
    // Private message excerpts are deliberately excluded from persisted analysis.
    return {source:compact.source,profiles:compact.profiles.length,memories:Mb(analysis)};
  },
  async mediaLikes(userId,amount,signal,transport) {
    if(!/^\d{1,32}$/.test(String(userId))) throw new Error('Perfil ainda sem identidade confirmada.');
    const read=async(path,stage,mediaId="")=>{
      try { return transport ? await transport({operation:stage==='feed'?'media-feed':'media-likers',userId:String(userId),mediaId}) : await Ho(`${ul}${path}`,{headers:Ms(),diagnosticLabel:`media-likes-${stage}`},signal); }
      catch(error) {
        if(Number(error?.httpStatus||error?.status)===400) {
          const failure=new Error(stage==='feed' ? 'O Instagram recusou a lista de publicações deste perfil (HTTP 400). Os gostos não chegaram a ser consultados; os dados anteriores foram mantidos.' : 'O Instagram recusou a lista de gostos desta publicação (HTTP 400). Os dados anteriores foram mantidos.');
          failure.code='media_likes_request_rejected';failure.httpStatus=400;failure.stage=stage;throw failure;
        }
        throw error;
      }
    };
    const feed=await read(`/api/v1/feed/user/${encodeURIComponent(userId)}/?count=12`,'feed');
    const posts=[];
    for(const media of wN(feed).slice(0,Math.max(1,Math.min(8,amount||3)))) {
      const id=String(media.id||media.pk||'');
      if(!/^\d{1,40}(?:_\d{1,32})?$/.test(id)) continue;
      const mediaPK=String(media.pk||id.split('_')[0]);
      if(!/^\d{1,40}$/.test(mediaPK)) continue;
      const result=await read(`/api/v1/media/${encodeURIComponent(mediaPK)}/likers/`,'likers',mediaPK);
      if(!Array.isArray(result.users)) throw new Error('A lista de gostos não foi disponibilizada. O histórico anterior foi preservado.');
      const users=[...new Map(result.users.map(user=>({id:String(user.pk||user.pk_id||user.id||''),username:user.username||'',fullName:user.full_name||'',photoURL:user.profile_pic_url||''})).filter(user=>/^\d{1,32}$/.test(user.id)).map(user=>[user.id,user])).values()];
      const expected=Number(result.user_count ?? result.like_count ?? media.like_count);
      // Missing pagination/count evidence is partial, never evidence of removed likes.
      const complete=Number.isInteger(expected) && expected>=0 && expected===users.length &&
        !result.next_max_id && !result.next_cursor && !result.has_more && !result.more_available && result.is_limited!==true;
      posts.push({id,code:String(media.code||''),photoURL:media.image_versions2?.candidates?.[0]?.url||media.carousel_media?.[0]?.image_versions2?.candidates?.[0]?.url||'',caption:String(media.caption?.text||'').slice(0,300),users,complete,expected:Number.isFinite(expected)?expected:null,observedAt:Date.now()});
      if(posts.length<Math.min(amount||3,8))await Lb(1200,signal);
    }
    return posts;
  },
  async inbox(kind,cursor,signal) { return hN(kind,cursor,signal,20); },
  async verify(users,signal) {return _b(we.getRelationshipLiveFacts(),await pS(users,{signal,deep:true}));},
  async conversationFacts(users,signal,readInbox) {
    // The caller already owns the single transport lane. Inject its read-only
    // transport rather than re-entering that lane through the extension bridge.
    const previous=h5;
    if(readInbox) h5=(operation,args)=>{
      if(operation!=='read-inbox') throw new Error('Operação não suportada pela leitura de evidência.');
      return readInbox({...args,operation});
    };
    try {const result=await C5({signal,amount:50});return oS(result.threads,users);}
    finally {h5=previous;}
  },
  async engagementFacts(users,signal) {const result=await N5({signal,amount:8});return iS(result.interactions,users,result.source);},
};
return;
})();
