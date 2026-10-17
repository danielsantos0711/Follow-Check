(() => {
  if (globalThis.__FOLLOWCHECK_HARDENING_1081__) return;
  globalThis.__FOLLOWCHECK_HARDENING_1081__ = true;

  const VERSION = "10.20.1";
  const SETTINGS_KEY = "followcheck:hardening:v1";
  const TECHNICAL_LOG_KEY = "followcheck:technical-logs:v1";
  const TECHNICAL_LOG_RUN_START_KEY = "followcheck:technical-log-run-start:v1";
  const PAGE_REQUEST_EVENT = "followcheck:page-executor:request:v1";
  const PAGE_RESPONSE_EVENT = "followcheck:page-executor:response:v1";
  const PAGE_CANCEL_EVENT = "followcheck:page-executor:cancel:v1";
  const originalFetch = globalThis.fetch.bind(globalThis);
  let relationshipCircuitOpen = false;
  const directReadInflight = new Map();
  const directReadFailureCache = new Map();
  const excludedOverflow = ".nav-list,.v7-category-pills,.v8-bulk-actions.is-selection,.calendar-timeline,.crm-table,.competitor-table,.operation-user-list,.queue-items,.message-stream,.inbox-thread-list";
  const HARDENING_CSS = String.raw`
    *,*::before,*::after{box-sizing:border-box}
    #root,.app-shell,.main-content,.v3-main,.v7-tools-page,.studio-view,.operations-view,.reports-view,.content-view{min-width:0;max-width:100%}
    .fc-system-toast{position:fixed;right:16px;bottom:94px;left:16px;z-index:300;max-width:560px;margin:auto;padding:12px 15px;border:1px solid #454957;border-radius:10px;background:rgba(17,19,27,.98);box-shadow:0 18px 55px rgba(0,0,0,.55);color:#e8e9ef;font:700 11px/1.45 Inter,system-ui,sans-serif;opacity:0;pointer-events:none;transform:translateY(12px);transition:.2s ease}
    .fc-system-toast.is-visible{opacity:1;transform:none}.fc-system-toast.is-success{border-color:rgba(84,214,154,.55);color:#80e2b4}.fc-system-toast.is-warning{border-color:rgba(255,181,73,.55);color:#ffd08a}
    .fc-system-tool-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}
    .fc-system-tool-grid>button{display:flex;min-width:0;min-height:92px;align-items:center;gap:12px;padding:14px;border:1px solid #292c36;border-radius:11px;background:linear-gradient(145deg,#12141b,#0d0f15);color:#e9eaf0;text-align:left;cursor:pointer;transition:.18s ease}
    .fc-system-tool-grid>button:hover{border-color:#705ac1;transform:translateY(-1px)}.fc-system-tool-grid b{display:grid;width:37px;height:37px;flex:0 0 37px;place-items:center;border-radius:10px;background:rgba(145,108,255,.13);color:#a988ff;font-size:18px}.fc-system-tool-grid span{display:flex;min-width:0;flex-direction:column;gap:3px}.fc-system-tool-grid small{color:#8b71de;font-size:7px;letter-spacing:.12em}.fc-system-tool-grid strong{font-size:11px}.fc-system-tool-grid em{overflow:hidden;color:#777b87;font-size:8px;font-style:normal;text-overflow:ellipsis;white-space:nowrap}
    .v7-settings-layout>main.is-fc-diagnostics>:not(.fc-diagnostics-panel){display:none!important}.fc-diagnostics-panel{display:grid;gap:14px}.fc-diagnostics-heading small{color:#9e78ef;font-size:8px;letter-spacing:.15em}.fc-diagnostics-heading h3{margin:7px 0 4px;font-size:18px}.fc-diagnostics-heading p{margin:0;color:#7b7f8b;font-size:10px;line-height:1.5}
    .fc-diagnostic-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.fc-diagnostic-grid article{display:flex;min-width:0;min-height:88px;flex-direction:column;justify-content:center;padding:13px;border:1px solid #282b35;border-radius:9px;background:#11131a}.fc-diagnostic-grid small{color:#777b88;font-size:8px}.fc-diagnostic-grid strong{margin:5px 0 3px;font-size:16px}.fc-diagnostic-grid span{overflow:hidden;color:#8d909a;font-size:8px;text-overflow:ellipsis;white-space:nowrap}
    .fc-settings-list{display:grid;gap:7px}.fc-settings-list label{display:flex;min-height:58px;align-items:center;justify-content:space-between;gap:14px;padding:10px 13px;border:1px solid #282b35;border-radius:9px;background:#11131a}.fc-settings-list label span{display:flex;min-width:0;flex-direction:column;gap:3px}.fc-settings-list strong{font-size:10px}.fc-settings-list small{color:#777b88;font-size:8px;line-height:1.4}.fc-settings-list input{width:18px;height:18px;accent-color:#9874ff}
    .fc-diagnostic-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.fc-diagnostic-actions button{min-width:0;min-height:39px;padding:7px;border:1px solid #504482;border-radius:8px;background:rgba(141,104,255,.08);color:#c9baff;font:700 9px/1.3 Inter,system-ui;cursor:pointer}.fc-diagnostic-note{margin:0;padding:10px;border:1px solid #292c35;border-radius:8px;color:#777b87;font-size:8px;line-height:1.5}
    .fc-logs-overlay{position:fixed;inset:0;z-index:450;display:grid;place-items:center;padding:18px;background:rgba(3,4,8,.84);backdrop-filter:blur(14px)}.fc-logs-modal{display:grid;grid-template-rows:auto auto minmax(0,1fr) auto;width:min(940px,100%);height:min(780px,calc(100dvh - 36px));overflow:hidden;border:1px solid #39354a;border-radius:17px;background:linear-gradient(145deg,#141620,#0b0d13);box-shadow:0 34px 110px rgba(0,0,0,.72);color:#eff0f5;font:500 10px/1.45 Inter,system-ui,sans-serif}.fc-logs-modal>header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:17px 18px;border-bottom:1px solid #292c36;background:linear-gradient(105deg,rgba(145,108,255,.13),transparent 44%)}.fc-logs-title{display:flex;min-width:0;align-items:center;gap:12px}.fc-logs-title>b{display:grid;width:42px;height:42px;flex:0 0 42px;place-items:center;border-radius:12px;background:rgba(145,108,255,.17);color:#b99bff;font-size:20px}.fc-logs-title span{display:grid;gap:3px}.fc-logs-title h2{margin:0;font-size:19px;letter-spacing:-.025em}.fc-logs-title p{margin:0;color:#858997;font-size:9px}.fc-logs-close{display:grid;width:36px;height:36px;place-items:center;border:1px solid #343844;border-radius:9px;background:#11141c;color:#a9adba;font-size:19px;cursor:pointer}.fc-logs-toolbar{display:grid;grid-template-columns:minmax(180px,1fr) 150px auto;gap:8px;padding:11px 14px;border-bottom:1px solid #282b35;background:#0e1118}.fc-logs-toolbar input,.fc-logs-toolbar select,.fc-logs-toolbar button{min-width:0;height:38px;border:1px solid #303440;border-radius:8px;background:#0b0e14;color:#d7d9e2;font:600 9px Inter,system-ui}.fc-logs-toolbar input{padding:0 11px;outline:0}.fc-logs-toolbar select{padding:0 10px;color-scheme:dark}.fc-logs-toolbar button{padding:0 13px;color:#c6b6ff;cursor:pointer}.fc-logs-list{min-height:0;overflow:auto;overscroll-behavior:contain;padding:10px 12px;scrollbar-color:#544477 #0b0d13}.fc-log-empty{display:grid;min-height:240px;place-items:center;color:#747886;text-align:center}.fc-log-row{display:grid;grid-template-columns:72px 58px minmax(0,1fr) auto;gap:9px;margin-bottom:7px;padding:10px 11px;border:1px solid #272b35;border-radius:9px;background:#10131a}.fc-log-row[data-level="error"]{border-color:rgba(244,92,111,.35);background:rgba(77,20,31,.13)}.fc-log-row[data-level="warn"]{border-color:rgba(239,179,86,.3);background:rgba(77,54,18,.11)}.fc-log-row time{color:#777c8b;font-variant-numeric:tabular-nums}.fc-log-level{color:#a98aff;font-size:8px;font-weight:800;letter-spacing:.08em}.fc-log-row[data-level="error"] .fc-log-level{color:#ff7789}.fc-log-row[data-level="warn"] .fc-log-level{color:#f4bf6c}.fc-log-copy{min-width:0}.fc-log-copy strong{display:block;overflow-wrap:anywhere;color:#e4e6ed;font-size:9px}.fc-log-copy p{margin:3px 0 0;overflow-wrap:anywhere;color:#9296a4;font-size:8px}.fc-log-meta{grid-column:3/-1;display:flex;min-width:0;flex-wrap:wrap;gap:5px}.fc-log-meta code{min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-word;padding:3px 6px;border:1px solid #292d38;border-radius:5px;background:#0a0d12;color:#8c91a0;font:500 7px/1.3 ui-monospace,SFMono-Regular,monospace;white-space:normal}.fc-logs-modal>footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-top:1px solid #292c36;background:#0e1118}.fc-logs-privacy{display:flex;min-width:0;align-items:center;gap:7px;color:#76dcb1;font-size:8px}.fc-logs-actions{display:flex;gap:7px}.fc-logs-actions button{min-height:37px;padding:0 12px;border:1px solid #3b3f4b;border-radius:8px;background:#131720;color:#c6cad5;font:700 8px Inter,system-ui;cursor:pointer}.fc-logs-actions button.is-primary{border-color:#7357c5;background:linear-gradient(105deg,#4d368a,#7654ba);color:white}.fc-logs-actions button.is-danger{color:#ee8290}
    .fc-support-overlay,.fc-native-scan-overlay{position:fixed;inset:0;z-index:470;overflow:auto;background:#080910;color:#f5f3fb;font:500 12px/1.5 Inter,system-ui,sans-serif}.fc-support-shell{width:min(820px,100%);min-height:100%;margin:auto;padding:22px 18px 110px}.fc-support-shell>header{display:flex;align-items:flex-start;gap:13px}.fc-support-shell>header button,.fc-support-close{display:grid;width:43px;height:43px;flex:0 0 43px;place-items:center;border:1px solid #2b303c;border-radius:13px;background:#11141d;color:#f5f3fb;font-size:20px}.fc-support-shell>header small{color:#9b6cff;font-size:9px;font-weight:800;letter-spacing:.16em}.fc-support-shell h2{margin:2px 0 3px;font-size:28px;letter-spacing:-.04em}.fc-support-shell header p{margin:0;color:#959baa;font-size:11px}.fc-support-report{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;margin-top:18px;padding:17px;border:1px solid rgba(155,108,255,.38);border-radius:17px;background:linear-gradient(135deg,rgba(155,108,255,.12),transparent 48%),#11141d}.fc-support-report strong{display:block;font-size:15px}.fc-support-report small{display:block;margin-top:3px;color:#959baa;font-size:9px}.fc-support-actions{display:flex;gap:7px}.fc-support-actions button{min-height:42px;padding:0 13px;border:1px solid #4c3d7b;border-radius:10px;background:#171329;color:#d8c7ff;font-weight:750}.fc-support-actions button.is-primary{background:linear-gradient(110deg,#8056df,#a56fee);color:white}.fc-support-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:10px}.fc-support-cards article{min-height:96px;padding:14px;border:1px solid #292e39;border-radius:13px;background:#11141d}.fc-support-cards small{color:#959baa;font-size:9px}.fc-support-cards strong{display:block;margin-top:4px;font-size:15px}.fc-support-cards p{margin:4px 0 0;color:#959baa;font-size:9px;overflow-wrap:anywhere}.fc-support-cards article.is-warning{border-color:rgba(240,186,99,.36)}.fc-support-logbox{margin-top:20px}.fc-support-logbox>header{display:flex;align-items:end;justify-content:space-between;margin-bottom:8px}.fc-support-logbox h3{margin:2px 0 0;font-size:17px}.fc-support-logbox header small{color:#959baa;font-size:9px}.fc-support-logbox>div{overflow:hidden;border:1px solid #292e39;border-radius:13px;background:#11141d}.fc-support-logbox article{display:grid;grid-template-columns:8px minmax(0,1fr) auto;align-items:center;gap:10px;min-height:60px;padding:9px 12px;border-bottom:1px solid #292e39}.fc-support-logbox article:last-child{border:0}.fc-support-logbox i{width:8px;height:8px;border-radius:50%;background:#9b6cff}.fc-support-logbox article.is-error i{background:#f16f84}.fc-support-logbox article.is-warn i{background:#f0ba63}.fc-support-logbox b{display:block;overflow:hidden;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.fc-support-logbox span{display:block;margin-top:2px;color:#959baa;font-size:8px}.fc-support-logbox time{color:#676e7f;font-size:8px;white-space:nowrap}.fc-native-scan-overlay{display:grid;place-items:center;padding:16px;background:rgba(4,5,9,.9);backdrop-filter:blur(14px)}.fc-native-scan-card{width:min(610px,100%);padding:20px;border:1px solid #353b49;border-radius:20px;background:#12151e;box-shadow:0 28px 90px rgba(0,0,0,.65)}.fc-native-scan-card header{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.fc-native-scan-card h2{margin:0;font-size:24px}.fc-native-scan-card header p{margin:4px 0 0;color:#959baa;font-size:11px}.fc-native-scan-card header button{display:grid;width:38px;height:38px;place-items:center;border:1px solid #343946;border-radius:11px;background:#0e1118;color:#bbbcca;font-size:18px}.fc-native-scan-state{display:flex;align-items:center;justify-content:space-between;margin-top:24px}.fc-native-scan-state strong{color:#b88fff;font-size:13px}.fc-native-scan-state b{font-size:30px}.fc-native-progress{height:8px;margin-top:10px;overflow:hidden;border-radius:99px;background:#252a36}.fc-native-progress i{display:block;width:1%;height:100%;border-radius:inherit;background:linear-gradient(90deg,#ef7086,#996bff);transition:width .25s}.fc-native-detail{min-height:64px;margin:14px 0 0;padding:13px;border:1px solid #292e39;border-radius:12px;background:#0d1017;color:#b6b8c4;font-size:11px}.fc-native-scan-footer{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.fc-native-scan-footer button{min-height:42px;padding:0 14px;border:1px solid #383d49;border-radius:10px;background:#0f1219;color:#d7d7df;font-weight:750}.fc-native-scan-footer button.is-primary{border-color:#7955cb;background:linear-gradient(110deg,#744bd0,#9d68e9);color:white}
    .fc-support-actions select{min-height:42px;padding:0 13px;border:1px solid #4c3d7b;border-radius:10px;background:#171329;color:#d8c7ff;font-weight:750;color-scheme:dark}
    .fc-support-logbox article div small{display:block;margin-top:5px;overflow-wrap:anywhere;color:#777f91;font:500 7px/1.45 ui-monospace,SFMono-Regular,monospace;white-space:normal}
    .fc-support-overlay{z-index:510}
    .fc-safety-lock{position:fixed;inset:0;z-index:490;display:grid;place-items:center;padding:18px;background:rgba(4,5,10,.91);backdrop-filter:blur(18px);color:#f7f4fc;font:500 12px/1.5 Inter,system-ui,sans-serif}.fc-safety-card{width:min(610px,100%);padding:22px;border:1px solid rgba(240,186,99,.48);border-radius:20px;background:linear-gradient(140deg,rgba(240,186,99,.10),transparent 44%),#11141d;box-shadow:0 30px 100px rgba(0,0,0,.72)}.fc-safety-card>small{color:#f0ba63;font-size:9px;font-weight:800;letter-spacing:.15em}.fc-safety-card h2{margin:7px 0 8px;font-size:24px;letter-spacing:-.035em}.fc-safety-card p{margin:0;color:#b9b7c2;font-size:11px;line-height:1.6}.fc-safety-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:17px}.fc-safety-facts article{padding:12px;border:1px solid #303440;border-radius:11px;background:#0d1017}.fc-safety-facts small{display:block;color:#777e90;font-size:8px}.fc-safety-facts strong{display:block;margin-top:4px;overflow-wrap:anywhere;font-size:10px}.fc-safety-actions{display:grid;grid-template-columns:1fr 1.25fr;gap:8px;margin-top:17px}.fc-safety-actions button{min-height:45px;padding:8px 11px;border:1px solid #414653;border-radius:11px;background:#141821;color:#d8d7df;font:750 10px/1.3 Inter,system-ui;cursor:pointer}.fc-safety-actions button.is-primary{border-color:#7d5bd2;background:linear-gradient(110deg,#6844b8,#9365dc);color:#fff}.fc-safety-note{display:block;margin-top:12px;color:#777e90;font-size:8px;line-height:1.5}
    :host(.fc-reduce-motion) *,:host(.fc-reduce-motion) *::before,:host(.fc-reduce-motion) *::after{scroll-behavior:auto!important;animation:none!important;transition:none!important}
    :host(.fc-compact) .v3-main{padding-top:0!important}:host(.fc-compact) .v7-tool-section{margin-top:19px}:host(.fc-compact) .panel{border-radius:8px}:host(.fc-show-outlines) .fc-overflow-detected{outline:2px solid #ff566d!important;outline-offset:-2px!important}
    @media(max-width:920px){
      :host{width:100vw!important;max-width:100vw!important;overflow-x:hidden!important}#root,.app-shell,.v3-shell,.main-content,.v3-main{width:100%;max-width:100%;overflow-x:clip}
      img,video,canvas,svg{max-width:100%}.studio-intro{min-width:0;flex-wrap:wrap}.studio-intro>div{min-width:0}.studio-intro h1,.studio-intro h2,.studio-intro p,.report-baseline,.operation-context,.session-health p{overflow-wrap:anywhere}
      .operations-commandbar{display:grid!important;grid-template-columns:1fr!important;overflow:visible!important}.operation-actions{display:grid!important;width:100%!important;grid-template-columns:repeat(2,minmax(0,1fr));overflow:visible!important}.operation-actions>button{min-width:0!important;min-height:45px!important;padding:7px 8px!important;border-bottom:1px solid var(--border)!important;white-space:normal!important;line-height:1.25!important}.operation-actions>button:nth-child(even){border-right:0!important}.operation-actions>button:last-child:nth-child(odd){grid-column:1/-1;border-bottom:0!important}.operations-session-actions{display:grid!important;width:100%;grid-template-columns:repeat(2,minmax(0,1fr));border-top:0!important}.operations-session-actions>*{min-width:0!important}.operations-session-actions .execute-button{grid-column:1/-1;width:100%}
      .operations-grid{display:flex!important;width:100%;flex-direction:column}.operation-audience,.operation-queue,.session-health,.operation-log{width:100%;min-width:0;max-width:100%}.operation-user-list article{max-width:100%}.log-row{min-width:0!important}.log-row code{min-width:0;overflow-wrap:anywhere;white-space:normal}.log-row small{display:block!important;grid-column:2/-1!important;padding:2px 0 5px;color:#b6bac5!important;overflow-wrap:anywhere;white-space:normal}
      .content-live-actions{display:grid!important;width:100%;grid-template-columns:repeat(2,minmax(0,1fr))}.content-live-actions>button{min-width:0;width:100%;white-space:normal}.content-live-actions>button:last-child:nth-child(odd){grid-column:1/-1}.content-board{display:grid!important;width:100%;grid-template-columns:1fr!important;overflow:visible!important}.content-board>*{width:100%;min-width:0;max-width:100%}
      .report-actions{display:grid!important;width:100%;grid-template-columns:repeat(2,minmax(0,1fr))}.report-actions>*{min-width:0!important;width:100%;white-space:normal}.report-kpis{width:100%;grid-template-columns:repeat(2,minmax(0,1fr))!important}.report-kpis article{min-width:0}.reports-layout{width:100%;grid-template-columns:1fr!important}.report-section{min-width:0;overflow:hidden}.snapshot-list>div{min-width:0;grid-template-columns:minmax(0,1fr) auto!important}.report-baseline{align-items:flex-start;white-space:normal}
      .v7-featured-grid,.v7-tools-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}.v7-tool-card{min-width:0}.v7-tool-card p{overflow-wrap:anywhere}.fc-system-tool-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.fc-logs-overlay{padding:0}.fc-logs-modal{width:100%;height:100dvh;border:0;border-radius:0}.fc-logs-toolbar{grid-template-columns:1fr 118px}.fc-logs-toolbar button{grid-column:1/-1}.fc-log-row{grid-template-columns:58px 48px minmax(0,1fr)}.fc-log-row>span:last-child{display:none}.fc-logs-modal>footer{align-items:stretch;flex-direction:column}.fc-logs-actions{display:grid;grid-template-columns:repeat(3,1fr)}.fc-logs-actions button{padding:0 7px}
      .v7-settings-modal{width:100vw!important;max-width:100vw!important;height:100dvh!important;max-height:100dvh!important;border:0!important;border-radius:0!important}.v7-settings-layout{display:flex!important;min-width:0;flex-direction:column}.v7-settings-layout>nav{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important}.v7-settings-layout>nav button{min-width:0;justify-content:center}.v7-settings-layout>main{min-width:0;padding:16px 14px 24px!important}.v7-settings-modal>header,.v7-settings-modal>footer{min-width:0}.fc-diagnostic-actions{grid-template-columns:1fr}.fc-support-shell{padding:16px 14px 104px}.fc-support-report{grid-template-columns:1fr}.fc-support-actions{display:grid;grid-template-columns:1fr 1fr}.fc-support-actions button:first-child{grid-column:1/-1}.fc-support-cards{grid-template-columns:1fr}.fc-support-logbox article{grid-template-columns:8px minmax(0,1fr)}.fc-support-logbox time{grid-column:2}.fc-native-scan-overlay{padding:0}.fc-native-scan-card{min-height:100%;border:0;border-radius:0;padding:22px 16px 110px}
      .v8-relationship-import{width:100%;grid-template-columns:1fr!important;min-height:0!important}.v8-relationship-import-copy,.v8-import-drop{width:100%;min-width:0;padding:22px 17px!important}.v8-import-drop{min-height:330px!important}.v8-import-drop::before{inset:12px!important}.v8-relationship-toolbar{width:100%;grid-template-columns:1fr!important}.v8-relationship-toolbar>*{grid-column:1!important;min-width:0;width:100%}
      .global-activity-dock{right:max(8px,env(safe-area-inset-right))!important;bottom:calc(78px + env(safe-area-inset-bottom))!important;left:max(8px,env(safe-area-inset-left))!important;width:auto!important;max-width:none!important;grid-template-columns:34px minmax(0,1fr) auto!important}.global-activity-facts,.global-activity-avatar{display:none!important}.global-activity-copy{min-width:0}.global-activity-copy strong,.global-activity-copy span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    }
    @media(max-width:520px){.v7-featured-grid,.v7-tools-grid,.fc-system-tool-grid{grid-template-columns:1fr!important}.report-kpis{grid-template-columns:1fr 1fr!important}.report-kpis article{padding:11px!important}.fc-diagnostic-grid{grid-template-columns:1fr 1fr}.fc-settings-list label{align-items:flex-start}.content-live-actions,.report-actions{grid-template-columns:1fr!important}.content-live-actions>button,.report-actions>*{grid-column:1!important}.operation-actions>button{font-size:9px!important}.fc-logs-title p{display:none}.fc-logs-toolbar{grid-template-columns:1fr}.fc-logs-toolbar select,.fc-logs-toolbar button{grid-column:1}.fc-log-row{grid-template-columns:52px 42px minmax(0,1fr);padding:9px 8px}.fc-logs-actions{grid-template-columns:1fr}.fc-logs-privacy{line-height:1.4}}
  `;

  function cookie(name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
    return match?.[1] ? decodeURIComponent(match[1]) : "";
  }

  function redactText(value, limit = 500) {
    return String(value ?? "")
      .replace(/\b(Bearer)\s+[A-Za-z0-9._~+\/-]+/gi, "$1 [REMOVIDO]")
      .replace(/\b(sessionid|csrftoken|authorization|password|passwd|cookie)\b\s*[:=]\s*[^\s,;}&]+/gi, "$1=[REMOVIDO]")
      .replace(/([?&](?:sessionid|csrftoken|token|access_token|password)=)[^&\s]+/gi, "$1[REMOVIDO]")
      .slice(0, limit);
  }

  function sanitizeEndpoint(value) {
    try {
      const url = new URL(String(value || ""), location.href);
      return url.pathname.replace(/\/\d{5,}(?=\/|$)/g, "/:id");
    } catch {
      return redactText(value, 180).replace(/\/\d{5,}(?=\/|$)/g, "/:id");
    }
  }

  function safeLogMeta(meta = {}) {
    const sensitive = /^(?:sessionid|csrftoken|authorization|password|passwd|cookie|headers|body|token)$/i;
    const clean = {};
    for (const [key, raw] of Object.entries(meta || {}).slice(0, 18)) {
      if (sensitive.test(key) || raw == null) continue;
      if (/endpoint|url|path/i.test(key)) clean[key] = sanitizeEndpoint(raw);
      else if (typeof raw === "string") clean[key] = redactText(raw, 240);
      else if (typeof raw === "number" || typeof raw === "boolean") clean[key] = raw;
      else if (Array.isArray(raw)) clean[key] = raw.slice(0, 8).map((item) => typeof item === "object" ? safeLogMeta(item) : redactText(item, 120));
      else if (typeof raw === "object") clean[key] = safeLogMeta(raw);
    }
    return clean;
  }

  function readTechnicalLogs() {
    try {
      const logs = JSON.parse(localStorage.getItem(TECHNICAL_LOG_KEY) || "[]");
      return Array.isArray(logs) ? logs.slice(-1000) : [];
    } catch {
      return [];
    }
  }

  function technicalLog(level, source, event, message, meta = {}) {
    const entry = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      level: ["debug", "info", "warn", "error"].includes(level) ? level : "info",
      source: redactText(source || "app", 60),
      event: redactText(event || "event", 90),
      message: redactText(message || "", 500),
      meta: safeLogMeta(meta),
      version: VERSION,
    };
    try {
      const logs = [...readTechnicalLogs(), entry].slice(-1000);
      localStorage.setItem(TECHNICAL_LOG_KEY, JSON.stringify(logs));
      document.dispatchEvent(new CustomEvent("followcheck:technical-log:updated", { detail: entry.id }));
    } catch {
      // Os logs nunca podem interromper uma operação real.
    }
    return entry;
  }

  function consoleText(values = []) {
    return values.map((value) => {
      if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`;
      if (typeof value === "string") return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    }).join(" ").slice(0, 1800);
  }

  function installConsoleCapture() {
    if (globalThis.__FOLLOWCHECK_CONSOLE_CAPTURE__) return;
    globalThis.__FOLLOWCHECK_CONSOLE_CAPTURE__ = true;
    let writing = false;
    for (const method of ["debug", "log", "info", "warn", "error"]) {
      const original = console[method]?.bind(console);
      if (!original) continue;
      console[method] = (...values) => {
        original(...values);
        if (writing) return;
        const text = consoleText(values);
        const appMessage = /followcheck|\[fc[:\]]/i.test(text);
        if (!appMessage && !["warn", "error"].includes(method)) return;
        writing = true;
        try {
          technicalLog(method === "error" ? "error" : method === "warn" ? "warn" : "debug", "console", method, text || `console.${method}`, {
            stack: values.find((value) => value instanceof Error)?.stack || "",
          });
        } finally { writing = false; }
      };
    }
    globalThis.addEventListener?.("error", (event) => technicalLog("error", "runtime", "window-error", event.message || "Erro JavaScript global.", {
      file: sanitizeEndpoint(event.filename || ""), line: event.lineno || 0, column: event.colno || 0, stack: event.error?.stack || "",
    }));
    globalThis.addEventListener?.("unhandledrejection", (event) => {
      const reason = event.reason;
      technicalLog("error", "runtime", "unhandled-rejection", reason?.message || consoleText([reason]) || "Promise rejeitada sem tratamento.", {
        code: reason?.code || "", stack: reason?.stack || "",
      });
    });
  }

  function requestId() {
    const random = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `fc-${String(random).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 90)}`;
  }

  function pageExecutorRequest(operation, payload = {}, { signal, timeoutMs = 20000 } = {}) {
    const id = requestId();
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        document.removeEventListener(PAGE_RESPONSE_EVENT, onResponse);
        signal?.removeEventListener?.("abort", onAbort);
        clearTimeout(timer);
      };
      const finish = (handler, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        handler(value);
      };
      const onAbort = () => {
        document.dispatchEvent(new CustomEvent(PAGE_CANCEL_EVENT, { detail: id }));
        finish(reject, signal?.reason || new DOMException("A operação foi cancelada.", "AbortError"));
      };
      const onResponse = (event) => {
        if (typeof event.detail !== "string") return;
        let response;
        try { response = JSON.parse(event.detail); } catch { return; }
        if (response?.requestId !== id) return;
        if (!response.bridgeOk) {
          const error = executorError(
            response?.error?.message || "O executor da página não respondeu.",
            response?.error?.code || "followcheck_page_executor_failed",
          );
          error.name = response?.error?.name || error.name;
          error.diagnostics = response?.error?.diagnostics || {};
          finish(reject, error);
          return;
        }
        finish(resolve, response.result);
      };
      const timer = setTimeout(() => {
        document.dispatchEvent(new CustomEvent(PAGE_CANCEL_EVENT, { detail: id }));
        finish(reject, executorError("O executor da página excedeu o tempo limite.", "followcheck_page_executor_timeout"));
      }, timeoutMs);
      document.addEventListener(PAGE_RESPONSE_EVENT, onResponse);
      signal?.addEventListener?.("abort", onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      document.dispatchEvent(new CustomEvent(PAGE_REQUEST_EVENT, {
        detail: JSON.stringify({ requestId: id, operation, ...payload }),
      }));
    });
  }

  function readSettings() {
    try {
      return {
        compact: false,
        reduceMotion: false,
        showOutlines: false,
        ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"),
      };
    } catch {
      return { compact: false, reduceMotion: false, showOutlines: false };
    }
  }

  function saveSettings(next) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    applySettings(next);
  }

  function applySettings(settings = readSettings()) {
    document.documentElement.classList.toggle("fc-compact", Boolean(settings.compact));
    document.documentElement.classList.toggle("fc-reduce-motion", Boolean(settings.reduceMotion));
    document.documentElement.classList.toggle("fc-show-outlines", Boolean(settings.showOutlines));
    const host = document.getElementById("followcheck-app-host");
    host?.classList.toggle("fc-compact", Boolean(settings.compact));
    host?.classList.toggle("fc-reduce-motion", Boolean(settings.reduceMotion));
    host?.classList.toggle("fc-show-outlines", Boolean(settings.showOutlines));
  }

  function sendRuntime(message) {
    if (globalThis.chrome?.runtime?.sendMessage) {
      return new Promise((resolve, reject) => {
        globalThis.chrome.runtime.sendMessage(message, (response) => {
          const error = globalThis.chrome.runtime.lastError;
          if (error) reject(new Error(error.message || String(error)));
          else resolve(response);
        });
      });
    }
    if (!globalThis.browser?.runtime?.sendMessage) {
      return Promise.reject(new Error("O executor protegido não está disponível."));
    }
    return globalThis.browser.runtime.sendMessage(message);
  }

  function stopActiveQueue(reason) {
    const detail = String(reason || "Falha do executor").slice(0, 300);
    technicalLog("error", "queue", "queue-stopped", detail, { circuitOpen: true });
    try {
      localStorage.setItem("followcheck:hardening:last-executor-error", JSON.stringify({
        at: new Date().toISOString(),
        reason: detail,
      }));
    } catch {
      // O estado React continua a terminar a fila mesmo se o armazenamento estiver cheio.
    }
    toast("A fila foi interrompida. Nenhuma conta seguinte será processada.", "warning");
  }

  function executorError(message, code = "followcheck_executor_unavailable", endpoint = "") {
    const error = new Error(String(message || "O executor protegido não respondeu."));
    error.name = "FollowCheckExecutorError";
    error.code = String(code || "followcheck_executor_unavailable");
    error.endpoint = String(endpoint || "");
    error.httpStatus = 0;
    return error;
  }

  function relationshipRequest(input, init = {}) {
    const raw = typeof input === "string" ? input : input?.url;
    if (!raw || String(init.method || input?.method || "GET").toUpperCase() !== "POST") return null;
    let url;
    try { url = new URL(raw, location.href); } catch { return null; }
    if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return null;
    const legacy = url.pathname.match(/^\/api\/v1\/friendships\/(follow|unfollow|removeFollower)\/(\d+)\/$/i);
    if (legacy) {
      return {
        action: legacy[1].toLowerCase() === "follow" ? "follow" : legacy[1].toLowerCase() === "unfollow" ? "unfollow" : "removeFollower",
        targetId: legacy[2],
      };
    }
    const match = url.pathname.match(/^\/(?:api\/v1|web)\/friendships\/(create|destroy|remove_follower)\/(\d+)\/(?:follow\/|unfollow\/|remove_follower\/)?$/i)
      || url.pathname.match(/^\/web\/friendships\/(\d+)\/(follow|unfollow|remove_follower)\/$/i);
    if (!match) return null;
    if (/^\/web\//i.test(url.pathname)) {
      return {
        action: match[2] === "follow" ? "follow" : match[2] === "unfollow" ? "unfollow" : "removeFollower",
        targetId: match[1],
      };
    }
    return {
      action: match[1] === "create" ? "follow" : match[1] === "destroy" ? "unfollow" : "removeFollower",
      targetId: match[2],
    };
  }

  function canonicalRelationshipUrl({ action, targetId }) {
    const verb = action === "follow" ? "create" : action === "unfollow" ? "destroy" : "remove_follower";
    return `https://www.instagram.com/api/v1/friendships/${verb}/${targetId}/`;
  }

  async function relationshipFailure(response) {
    let payload = null;
    let text = "";
    try {
      text = await response.clone().text();
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    const confirmed = response.ok && (!payload?.status || payload.status === "ok");
    if (confirmed) return "";
    if (payload?.message) return String(payload.message);
    if (payload?.error_type) return String(payload.error_type);
    if (text && !payload) return "O Instagram devolveu uma resposta HTML e não confirmou a ação.";
    return `O Instagram não confirmou a ação (HTTP ${response.status || "desconhecido"}).`;
  }

  async function probePageSession() {
    const expectedUserId = cookie("ds_user_id");
    technicalLog("info", "session", "probe-started", "A validar a sessão no contexto principal da página.");
    const result = await pageExecutorRequest("probe-session", {}, { timeoutMs: 22000 });
    const userId = String(result?.user?.userId || "");
    if (!result?.ok || !userId) {
      technicalLog("warn", "session", "probe-failed", result?.message || "A sessão não foi confirmada.", {
        code: result?.code,
        status: result?.status,
        contentType: result?.contentType,
        attempts: result?.attempts,
      });
      const error = executorError(
        result?.message || `O Instagram não confirmou a sessão da página (HTTP ${result?.status || "desconhecido"}).`,
        result?.code || "instagram_page_session_probe_failed",
        result?.endpoint || "",
      );
      error.httpStatus = Number(result?.status || 0);
      throw error;
    }
    if (expectedUserId && userId !== String(expectedUserId)) {
      throw executorError("A conta devolvida pelo Instagram não corresponde à conta aberta.", "instagram_account_changed");
    }
    technicalLog("info", "session", "probe-succeeded", "Sessão autenticada confirmada no contexto principal.", {
      endpoint: result.endpoint,
      status: result.status,
      attempts: result.attempts,
    });
    clearKnownPageContextCooldown();
    return { userId, username: String(result.user?.username || "") };
  }

  function directReadRequest(input, init = {}) {
    const method = String(init?.method || input?.method || "GET").toUpperCase();
    if (method !== "GET") return null;
    let url;
    try {
      url = new URL(typeof input === "string" ? input : input?.url || "", location.href);
    } catch {
      return null;
    }
    if (url.origin !== location.origin) return null;
    const inbox = url.pathname.match(/^\/api\/v1\/direct_v2\/(pending_)?inbox\/$/i);
    if (inbox) {
      return {
        operation: "direct-read-inbox",
        kind: inbox[1] ? "pending" : "inbox",
        cursor: String(url.searchParams.get("cursor") || "").slice(0, 1024),
        limit: Math.max(1, Math.min(50, Number(url.searchParams.get("limit")) || 20)),
        endpoint: url.pathname,
      };
    }
    const thread = url.pathname.match(/^\/api\/v1\/direct_v2\/threads\/(\d{1,40})\/$/i);
    if (!thread) return null;
    return {
      operation: "direct-read-thread",
      threadId: thread[1],
      limit: Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 50)),
      endpoint: url.pathname,
    };
  }

  function directReadKey(direct = {}) {
    return [
      direct.operation || "direct",
      direct.kind || "",
      direct.threadId || "",
      direct.cursor || "first-page",
    ].join(":");
  }

  async function directReadResponseOnce(input, init, direct) {
    try {
      technicalLog("info", "instagram", "direct-request", "A consultar a Inbox no contexto principal autenticado.", {
        endpoint: direct.endpoint,
        operation: direct.operation,
      });
      const result = await pageExecutorRequest(direct.operation, direct, {
        signal: init.signal,
        timeoutMs: 30000,
      });
      if (!result?.ok || !result?.data) {
        technicalLog("warn", "instagram", "direct-page-rejected", "A rota principal não devolveu JSON. A leitura terminou sem fallback.", {
          endpoint: result?.finalPath || direct.endpoint,
          status: result?.status,
          contentType: result?.contentType,
          responseKind: result?.responseKind,
        });
        const payload = result?.data || {
          status: "fail",
          message: result?.message || "O Instagram não confirmou a leitura da Inbox.",
          error_type: result?.code || "instagram_direct_request_unconfirmed",
        };
        const status = Number(result?.status || 502);
        if ([404, 405].includes(status) || ["html-document", "text"].includes(result?.responseKind)) {
          directReadFailureCache.set(directReadKey(direct), {
            until: Date.now() + 30 * 60_000,
            status,
            payload,
          });
        }
        return new Response(JSON.stringify(payload), {
          status: status >= 200 && status <= 599 ? status : 502,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "x-followcheck-page-executor": VERSION,
            "x-followcheck-direct-executor": result?.executor || "page-main",
          },
        });
      }
      technicalLog("info", "instagram", "direct-confirmed", "A Inbox foi recebida no contexto principal autenticado.", {
        endpoint: result.finalPath || direct.endpoint,
        status: result.status,
        responseKind: result.responseKind,
        durationMs: result.durationMs,
        responseBytes: result.responseBytes,
        executor: result.executor,
      });
      return new Response(JSON.stringify(result.data), {
        status: Number(result.status) || 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-followcheck-page-executor": VERSION,
          "x-followcheck-direct-executor": result.executor || "page-main",
        },
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      technicalLog("error", "instagram", "direct-page-error", error?.message || "A leitura única da Inbox falhou; não foi feito qualquer fallback.", {
        code: error?.code,
        endpoint: direct.endpoint,
      });
      throw executorError(
        error?.message || "A sessão da página não respondeu à leitura da Inbox.",
        error?.code || "instagram_page_request_failed",
        direct.endpoint,
      );
    }
  }

  async function directReadResponse(input, init, direct) {
    const key = directReadKey(direct);
    const cached = directReadFailureCache.get(key);
    if (cached?.until > Date.now()) {
      technicalLog("info", "inbox", "known-unavailable-route-skipped",
        "A rota da Inbox já tinha sido recusada; o pedido repetido foi evitado.", {
          operation: direct.operation,
          kind: direct.kind || "",
          status: cached.status,
          retryInSeconds: Math.ceil((cached.until - Date.now()) / 1000),
        });
      return new Response(JSON.stringify(cached.payload), {
        status: cached.status >= 200 && cached.status <= 599 ? cached.status : 502,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    if (cached) directReadFailureCache.delete(key);
    const active = directReadInflight.get(key);
    if (active) {
      technicalLog("debug", "inbox", "duplicate-read-coalesced",
        "Uma leitura idêntica da Inbox foi agregada ao pedido já em curso.", {
          operation: direct.operation,
          kind: direct.kind || "",
        });
      return (await active).clone();
    }
    const request = directReadResponseOnce(input, init, direct);
    directReadInflight.set(key, request);
    try {
      return (await request).clone();
    } finally {
      if (directReadInflight.get(key) === request) directReadInflight.delete(key);
    }
  }

  function cachedSessionIdentityResponse(input, init = {}) {
    const method = String(init?.method || input?.method || "GET").toUpperCase();
    if (method !== "GET") return null;
    let url;
    try {
      url = new URL(typeof input === "string" ? input : input?.url || "", location.href);
    } catch {
      return null;
    }
    const identityRoute = /^\/api\/v1\/accounts\/current_user\/$/i.test(url.pathname)
      || /^\/api\/v1\/users\/\d{1,32}\/info\/$/i.test(url.pathname);
    if (!identityRoute) return null;
    let status = null;
    try {
      status = JSON.parse(localStorage.getItem("followcheck:native-monitor-status") || "null");
    } catch {
      status = null;
    }
    const userId = String(status?.accountId || "");
    const username = String(status?.username || "").replace(/^@/, "");
    if (!/^\d{1,32}$/.test(userId) || !/^[A-Za-z0-9._]{1,30}$/.test(username)) return null;
    const requestedId = url.pathname.match(/^\/api\/v1\/users\/(\d{1,32})\/info\/$/i)?.[1] || "";
    if (requestedId && requestedId !== userId) return null;
    technicalLog("debug", "session", "identity-cache-hit",
      "A identidade já confirmada foi reutilizada sem novo pedido Instagram.", {
        accountId: userId,
        username,
        endpoint: url.pathname,
      });
    return new Response(JSON.stringify({
      status: "ok",
      user: {
        pk: userId,
        id: userId,
        username,
        full_name: String(status?.fullName || ""),
        profile_pic_url: String(status?.profilePicUrl || status?.profile_pic_url || ""),
      },
    }), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-followcheck-identity-cache": VERSION,
      },
    });
  }

  globalThis.fetch = async function followCheckFetch(input, init = {}) {
    const cachedIdentity = cachedSessionIdentityResponse(input, init);
    if (cachedIdentity) return cachedIdentity;
    const relationship = relationshipRequest(input, init);
    if (!relationship) {
      const direct = directReadRequest(input, init);
      return direct ? directReadResponse(input, init, direct) : originalFetch(input, init);
    }
    if (init.signal?.aborted) throw init.signal.reason || new DOMException("A operação foi cancelada.", "AbortError");
    if (relationshipCircuitOpen) {
      throw executorError(
        "A fila já foi interrompida após a primeira falha; este pedido não foi enviado.",
        "followcheck_executor_transport_failed",
        canonicalRelationshipUrl(relationship),
      );
    }
    try {
      technicalLog("info", "instagram", "relationship-request", `A executar ${relationship.action} no contexto principal.`, {
        action: relationship.action,
        endpoint: canonicalRelationshipUrl(relationship),
      });
      const result = await pageExecutorRequest("relationship", relationship, { signal: init.signal, timeoutMs: 30000 });
      const confirmed = Boolean(result?.ok && result?.data && (!result.data.status || result.data.status === "ok"));
      const payload = result?.data || {
        status: "fail",
        message: ["html-document", "text"].includes(result?.responseKind)
          ? "O Instagram não confirmou a ação nem no endpoint principal nem no fallback verificado."
          : `O Instagram não confirmou a ação (HTTP ${result?.status || "desconhecido"}).`,
        error_type: "instagram_action_unconfirmed",
      };
      const status = Number(result?.status);
      const response = new Response(JSON.stringify(payload), {
        status: status >= 200 && status <= 599 ? status : 502,
        headers: {
          "content-type": "application/json",
          "x-followcheck-page-executor": VERSION,
        },
      });
      technicalLog(confirmed ? "info" : "error", "instagram", confirmed ? "relationship-confirmed" : "relationship-rejected", confirmed ? "A ação foi confirmada pelo Instagram." : payload.message, {
        action: relationship.action,
        endpoint: result?.endpoint || canonicalRelationshipUrl(relationship),
        status: result?.status,
        contentType: result?.contentType,
        responseKind: result?.responseKind,
        redirected: result?.redirected,
        finalPath: result?.finalPath,
        durationMs: result?.durationMs,
        variant: result?.variant,
        confirmedBy: result?.confirmedBy,
        routePolicy: result?.routePolicy,
        verification: result?.verification,
        attempts: result?.attempts,
      });
      if (confirmed && result?.routePolicy?.learned) {
        technicalLog("info", "instagram", result.routePolicy.recovered ? "relationship-route-recovered" : "relationship-route-learned", result.routePolicy.recovered
          ? "A rota deixou de responder como esperado; o FollowCheck recuperou e aprendeu a alternativa confirmada."
          : "A rota confirmada foi guardada para as próximas ações desta conta.", {
          action: relationship.action,
          preferredBefore: result.routePolicy.preferredBefore,
          selected: result.routePolicy.selected,
          ttlHours: result.routePolicy.ttlHours,
        });
      }
      const failure = await relationshipFailure(response);
      if (failure) {
        relationshipCircuitOpen = true;
        stopActiveQueue(failure);
      }
      return response;
    } catch (error) {
      if (error?.name !== "AbortError") {
        technicalLog("error", "instagram", "relationship-executor-error", error?.message || "A ligação ao Instagram falhou.", {
          code: error?.code,
          endpoint: error?.endpoint || canonicalRelationshipUrl(relationship),
          httpStatus: error?.httpStatus,
        });
        relationshipCircuitOpen = true;
        stopActiveQueue(error?.message || "A ligação ao Instagram falhou.");
        const transportError = executorError(
          error?.message || "A ligação ao Instagram falhou.",
          "followcheck_executor_transport_failed",
          error?.endpoint || canonicalRelationshipUrl(relationship),
        );
        transportError.causeCode = String(error?.code || "followcheck_page_executor_failed");
        throw transportError;
      }
      throw error;
    }
  };

  function root() {
    return document.getElementById("followcheck-app-host")?.shadowRoot || null;
  }

  function toast(message, tone = "info") {
    const shadow = root();
    if (!shadow) return;
    let node = shadow.querySelector(".fc-system-toast");
    if (!node) {
      node = document.createElement("div");
      node.className = "fc-system-toast";
      node.setAttribute("role", "status");
      shadow.append(node);
    }
    node.className = `fc-system-toast is-${tone} is-visible`;
    node.textContent = message;
    clearTimeout(node.__fcTimer);
    node.__fcTimer = setTimeout(() => node.classList.remove("is-visible"), 3800);
  }

  let globalSafetyState = null;

  function safetyReasonLabel(reason) {
    const labels = {
      upgrade_safety_hold: "Atualização de proteção",
      instagram_security_warning: "Aviso de segurança Instagram",
      automated_behavior_detected: "Comportamento automatizado detetado",
      multiple_sessions_blocked: "Múltiplas sessões recusadas",
      rate_limited: "Limite temporário do Instagram",
      soft_throttle: "Pausa pedida pelo Instagram",
      challenge_required: "Confirmação necessária no Instagram",
    };
    return labels[String(reason || "")] || String(reason || "Proteção preventiva").replaceAll("_", " ");
  }

  function renderGlobalSafety(shadow = root()) {
    if (!shadow) return;
    const existing = shadow.querySelector(".fc-safety-lock");
    const safety = globalSafetyState;
    if (!safety?.blocked) {
      existing?.remove();
      return;
    }
    const signature = JSON.stringify([
      safety.reason || "",
      safety.message || "",
      Number(safety.cooldownUntil || 0),
      Boolean(safety.manualResetRequired),
    ]);
    if (existing?.dataset.safetySignature === signature) return;
    existing?.remove();
    const lock = document.createElement("section");
    lock.className = "fc-safety-lock";
    lock.dataset.safetySignature = signature;
    lock.setAttribute("role", "dialog");
    lock.setAttribute("aria-modal", "true");
    lock.setAttribute("aria-label", "Proteção global FollowCheck");
    const cooldown = Number(safety.cooldownUntil || 0) > Date.now()
      ? new Date(Number(safety.cooldownUntil)).toLocaleString("pt-PT")
      : "Desbloqueio manual";
    lock.innerHTML = `<div class="fc-safety-card"><small>PROTEÇÃO GLOBAL ATIVA</small><h2>Nenhum pedido será enviado ao Instagram</h2><p>${escapeHtml(safety.message || "O FollowCheck colocou conta própria, Watchlist, Inbox e ações em pausa para proteger a conta.")}</p><div class="fc-safety-facts"><article><small>MOTIVO</small><strong>${escapeHtml(safetyReasonLabel(safety.reason))}</strong></article><article><small>ATÉ</small><strong>${escapeHtml(cooldown)}</strong></article></div><div class="fc-safety-actions"><button type="button" data-fc-safety-diagnostic>Ver diagnóstico</button><button class="is-primary" type="button" data-fc-safety-reset>Já confirmei no Instagram · desbloquear</button></div><small class="fc-safety-note">Desbloqueia apenas depois de abrires a app oficial do Instagram, fechares o aviso e confirmares que a conta está normal. A app não tenta contornar a proteção do Instagram.</small></div>`;
    shadow.append(lock);
    lock.querySelector("[data-fc-safety-diagnostic]")?.addEventListener("click", () => openSupportCenter(shadow));
    lock.querySelector("[data-fc-safety-reset]")?.addEventListener("click", async () => {
      const confirmed = globalThis.confirm("Confirmas que abriste a app oficial do Instagram, fechaste o aviso de segurança e queres voltar a permitir pedidos FollowCheck?");
      if (!confirmed) return;
      const result = await sendRuntime({ type: "FOLLOWCHECK_SAFETY_STATE_RESET" }).catch((error) => ({ ok: false, error: error?.message }));
      if (!result?.ok) {
        toast(result?.error || "Não foi possível desbloquear a proteção.", "warning");
        return;
      }
      globalSafetyState = result.safety || { blocked: false };
      technicalLog("info", "safety", "manual-unlock", "A proteção global foi desbloqueada pelo utilizador após confirmação no Instagram.");
      renderGlobalSafety(shadow);
      toast("Proteção desbloqueada. Mantém um ritmo moderado.", "success");
    });
  }

  async function refreshGlobalSafety() {
    const response = await sendRuntime({ type: "FOLLOWCHECK_SAFETY_STATE_GET" }).catch(() => null);
    if (response?.ok) globalSafetyState = response.safety || { blocked: false };
    renderGlobalSafety(root());
  }

  function followCheckStorage() {
    const data = {};
    let bytes = 0;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith("followcheck:")) continue;
      const value = localStorage.getItem(key) || "";
      data[key] = value;
      bytes += key.length + value.length;
    }
    return { data, keys: Object.keys(data).length, bytes: bytes * 2 };
  }

  function overflowReport(shadow = root()) {
    if (!shadow) return { count: 0, items: [] };
    shadow.querySelectorAll(".fc-overflow-detected").forEach((node) => node.classList.remove("fc-overflow-detected"));
    const items = [...shadow.querySelectorAll("*")].filter((node) => {
      if (!(node instanceof HTMLElement) || node.matches(excludedOverflow) || node.closest(excludedOverflow)) return false;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.position === "fixed") return false;
      return node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 3;
    }).slice(0, 30);
    items.forEach((node) => node.classList.add("fc-overflow-detected"));
    return {
      count: items.length,
      items: items.map((node) => `${node.tagName.toLowerCase()}.${[...node.classList].filter((item) => !item.startsWith("fc-")).slice(0, 2).join(".")}`),
    };
  }

  function diagnosticSnapshot() {
    const storage = followCheckStorage();
    const overflow = overflowReport();
    return {
      generatedAt: new Date().toISOString(),
      version: VERSION,
      accountPresent: Boolean(cookie("ds_user_id")),
      csrfPresent: Boolean(cookie("csrftoken")),
      pageExecutor: document.documentElement.dataset.followcheckPageExecutor || "não detetado",
      technicalLogCount: readTechnicalLogs().length,
      viewport: `${innerWidth}×${innerHeight} @${devicePixelRatio || 1}x`,
      storageKeys: storage.keys,
      storageKiB: Math.round(storage.bytes / 1024),
      overflowCount: overflow.count,
      overflowElements: overflow.items,
      online: navigator.onLine,
      userAgent: navigator.userAgent,
    };
  }

  function download(name, data, type = "application/json") {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.documentElement.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function exportBackup() {
    const storage = followCheckStorage();
    download(`followcheck-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({
      format: "followcheck-local-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      data: storage.data,
    }, null, 2));
    toast(`${storage.keys} registos FollowCheck exportados.`, "success");
  }

  async function copyDiagnostic() {
    const text = JSON.stringify({ diagnostic: diagnosticSnapshot(), recentLogs: readTechnicalLogs().slice(-50) }, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      toast("Diagnóstico copiado.", "success");
    } catch {
      download("followcheck-diagnostico.json", text);
      toast("Diagnóstico guardado em ficheiro.", "success");
    }
  }

  async function copyText(text) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard indisponível");
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const field = document.createElement("textarea");
        field.value = text;
        field.setAttribute("readonly", "");
        field.style.cssText = "position:fixed;opacity:0;pointer-events:none";
        document.documentElement.append(field);
        field.select();
        const copied = document.execCommand?.("copy") === true;
        field.remove();
        return copied;
      } catch {
        return false;
      }
    }
  }

  function technicalReport(logs = readTechnicalLogs()) {
    return JSON.stringify({
      format: "followcheck-technical-report",
      formatVersion: 1,
      generatedAt: new Date().toISOString(),
      privacy: "Sem passwords, cookies, tokens, cabeçalhos ou corpos de pedidos.",
      diagnostic: diagnosticSnapshot(),
      logs,
    }, null, 2);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  async function importBackgroundTechnicalLogs() {
    const response = await sendRuntime({ type: "FOLLOWCHECK_TECHNICAL_LOGS_GET" }).catch(() => null);
    if (!response?.ok || !Array.isArray(response.logs)) return;
    try {
      const merged = [...readTechnicalLogs(), ...response.logs];
      const unique = [...new Map(merged.map((entry) => [entry.id || `${entry.at}:${entry.source}:${entry.event}:${entry.message}`, entry])).values()]
        .sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0))
        .slice(-1000);
      localStorage.setItem(TECHNICAL_LOG_KEY, JSON.stringify(unique));
    } catch {}
  }

  function technicalLogsForScope(scope = "current") {
    const logs = readTechnicalLogs();
    if (scope === "all") return logs;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const runStart = Date.parse(localStorage.getItem(TECHNICAL_LOG_RUN_START_KEY) || "");
    const cutoff = scope === "current" && Number.isFinite(runStart) ? runStart : today.getTime();
    return logs.filter((entry) => Date.parse(entry.at || 0) >= cutoff);
  }

  function supportReportText(scope = "current") {
    const diagnostic = diagnosticSnapshot();
    const logs = technicalLogsForScope(scope).slice(-500);
    const reportId = `FC-${new Date().toISOString().replace(/\D/g, "").slice(2, 14)}`;
    const lines = [
      "FOLLOWCHECK SUPPORT REPORT",
      `Report ID: ${reportId}`,
      `Gerado: ${new Date().toISOString()}`,
      "Privacidade: sem passwords, cookies, tokens, headers ou conteúdo de mensagens.",
      "",
      "[APP, SESSÃO E LAYOUT]",
      `Motor: ${VERSION}`,
      `Sessão local: ${diagnostic.accountPresent ? "identidade presente" : "por confirmar"}`,
      `Viewport: ${diagnostic.viewport}`,
      `Cortes horizontais: ${diagnostic.overflowCount}`,
      `Elementos cortados: ${diagnostic.overflowElements.join(", ") || "—"}`,
      `Online: ${diagnostic.online}`,
      "",
      `[EVENTOS TÉCNICOS — ${logs.length}]`,
      ...logs.slice().reverse().map((entry) => `${entry.at || "—"} | ${String(entry.level || "info").toUpperCase()} | ${entry.source}.${entry.event} | ${entry.message}${Object.keys(entry.meta || {}).length ? ` | ${JSON.stringify(entry.meta)}` : ""}`),
    ];
    return { reportId, text: lines.join("\n"), diagnostic, logs };
  }

  async function openSupportCenter(shadow = root(), scope = "current") {
    if (!shadow) return;
    await importBackgroundTechnicalLogs();
    shadow.querySelector(".fc-support-overlay")?.remove();
    const report = supportReportText(scope);
    const status = (() => {
      try { return JSON.parse(localStorage.getItem("followcheck:native-monitor-status") || "null") || {}; } catch { return {}; }
    })();
    const lastError = status.lastError || status.lastErrorCode || "Sem erro registado";
    const overlay = document.createElement("section");
    overlay.className = "fc-support-overlay";
    overlay.setAttribute("aria-label", "Diagnóstico e suporte FollowCheck");
    const logRows = report.logs.slice(-80).reverse().map((entry) => {
      const meta = Object.keys(entry.meta || {}).length ? JSON.stringify(entry.meta) : "";
      return `<article class="is-${escapeHtml(entry.level || "info")}"><i></i><div><b>${escapeHtml(entry.message || entry.event)}</b><span>${escapeHtml(entry.source)} · ${escapeHtml(entry.event)}</span>${meta ? `<small>${escapeHtml(meta)}</small>` : ""}</div><time>${escapeHtml(new Date(entry.at || Date.now()).toLocaleString("pt-PT"))}</time></article>`;
    }).join("");
    overlay.innerHTML = `<div class="fc-support-shell">
      <header><button type="button" data-fc-support-close aria-label="Fechar">←</button><div><small>SUPORTE</small><h2>Diagnóstico da app</h2><p>Estado simples, erros úteis e um relatório pronto para enviar.</p></div></header>
      <section class="fc-support-report"><div><strong>${escapeHtml(report.reportId)}</strong><small>Sem passwords, cookies, tokens nem conteúdo das mensagens.</small></div><div class="fc-support-actions"><select data-fc-support-scope aria-label="Período dos logs"><option value="current" ${scope === "current" ? "selected" : ""}>Este check</option><option value="today" ${scope === "today" ? "selected" : ""}>Hoje</option><option value="all" ${scope === "all" ? "selected" : ""}>Tudo</option></select><button class="is-primary" type="button" data-fc-support-copy>Copiar para o ChatGPT</button><button type="button" data-fc-support-save>Guardar .txt</button><button type="button" data-fc-support-clear>Apagar logs</button></div></section>
      <div class="fc-support-cards">
        <article class="${report.diagnostic.accountPresent ? "" : "is-warning"}"><small>SESSÃO INSTAGRAM</small><strong>${report.diagnostic.accountPresent ? "Identidade presente" : "Precisa de confirmação"}</strong><p>${escapeHtml(status.username ? `@${status.username}` : "Sem conta identificada no contexto atual")}</p></article>
        <article class="${status.lastErrorCode ? "is-warning" : ""}"><small>CHECKS AUTOMÁTICOS</small><strong>${status.running ? "Em execução" : status.enabled ? "Ativos" : "Em pausa"}</strong><p>${escapeHtml(lastError)}</p></article>
        <article class="${report.diagnostic.overflowCount ? "is-warning" : ""}"><small>LAYOUT E RETOMA</small><strong>${report.diagnostic.overflowCount ? `${report.diagnostic.overflowCount} possível(eis) corte(s)` : "Sem cortes detetados"}</strong><p>${escapeHtml(report.diagnostic.viewport)}</p></article>
        <article><small>REGISTOS LOCAIS</small><strong>${report.logs.length} eventos recentes</strong><p>${report.diagnostic.storageKeys} áreas FollowCheck · ${report.diagnostic.storageKiB} KiB</p></article>
      </div>
      <section class="fc-support-logbox"><header><div><small>EVENTOS RECENTES</small><h3>Histórico legível</h3></div><small>${report.logs.length} eventos</small></header><div>${logRows || "<p class=\"fc-log-empty\">Ainda não existem eventos técnicos.</p>"}</div></section>
    </div>`;
    shadow.append(overlay);
    const close = () => overlay.remove();
    overlay.querySelector("[data-fc-support-close]")?.addEventListener("click", close);
    overlay.querySelector("[data-fc-support-copy]")?.addEventListener("click", async () => {
      if (await copyText(report.text)) toast("Relatório copiado. Já podes colá-lo aqui.", "success");
      else download(`followcheck-support-${report.reportId}.txt`, report.text, "text/plain;charset=utf-8");
    });
    overlay.querySelector("[data-fc-support-save]")?.addEventListener("click", () => download(`followcheck-support-${report.reportId}.txt`, report.text, "text/plain;charset=utf-8"));
    overlay.querySelector("[data-fc-support-scope]")?.addEventListener("change", (event) => openSupportCenter(shadow, event.target.value));
    overlay.querySelector("[data-fc-support-clear]")?.addEventListener("click", async () => {
      localStorage.removeItem(TECHNICAL_LOG_KEY);
      localStorage.setItem(TECHNICAL_LOG_RUN_START_KEY, new Date().toISOString());
      await sendRuntime({ type: "FOLLOWCHECK_TECHNICAL_LOGS_CLEAR" }).catch(() => null);
      toast("Logs apagados. O próximo relatório começa agora.", "success");
      openSupportCenter(shadow, "current");
    });
  }

  let nativeManualScanRunning = false;
  async function runNativeManualScan(shadow = root()) {
    if (!shadow) return;
    if (nativeManualScanRunning) {
      toast("Já existe uma análise em curso.", "warning");
      return;
    }
    nativeManualScanRunning = true;
    shadow.querySelector(".fc-native-scan-overlay")?.remove();
    const overlay = document.createElement("div");
    overlay.className = "fc-native-scan-overlay";
    overlay.innerHTML = `<section class="fc-native-scan-card" role="dialog" aria-modal="true" aria-labelledby="fc-native-scan-title"><header><div><h2 id="fc-native-scan-title">Análise em curso</h2><p>O mesmo motor autenticado dos checks automáticos.</p></div><button type="button" data-fc-native-close aria-label="Continuar em segundo plano">×</button></header><div class="fc-native-scan-state"><strong data-fc-native-title>A validar a sessão</strong><b data-fc-native-percent>1%</b></div><div class="fc-native-progress"><i></i></div><p class="fc-native-detail" data-fc-native-detail>A preparar a ligação segura à conta atual.</p><footer class="fc-native-scan-footer"><button type="button" data-fc-native-background>Continuar em segundo plano</button></footer></section>`;
    shadow.append(overlay);
    const title = overlay.querySelector("[data-fc-native-title]");
    const percent = overlay.querySelector("[data-fc-native-percent]");
    const bar = overlay.querySelector(".fc-native-progress i");
    const detail = overlay.querySelector("[data-fc-native-detail]");
    const footer = overlay.querySelector(".fc-native-scan-footer");
    const close = () => overlay.remove();
    overlay.querySelector("[data-fc-native-close]")?.addEventListener("click", close);
    overlay.querySelector("[data-fc-native-background]")?.addEventListener("click", close);
    const onProgress = (event) => {
      const value = event.detail || {};
      const percentage = Math.max(1, Math.min(99, Number(value.percentage || 1)));
      if (title) title.textContent = value.title || "Análise em curso";
      if (detail) detail.textContent = value.detail || "A sincronizar relações.";
      if (percent) percent.textContent = `${percentage}%`;
      if (bar) bar.style.width = `${percentage}%`;
    };
    globalThis.addEventListener("followcheck:native-monitor-progress", onProgress);
    technicalLog("info", "scan", "native-manual-started", "Análise manual iniciada pelo motor dos checks.");
    try {
      const nativeStatus = (() => {
        try { return JSON.parse(localStorage.getItem("followcheck:native-monitor-status") || "null") || {}; } catch { return {}; }
      })();
      const response = await sendRuntime({ type: "FOLLOWCHECK_RUN_MONITOR_NOW" });
      if (!response?.ok) {
        const error = new Error(response?.error || "O motor do check não conseguiu concluir a análise.");
        error.code = response?.code || "monitor_failed";
        throw error;
      }
      if (response.ok) {
        if (title) title.textContent = "Check entregue à fila única";
        if (detail) detail.textContent = "O motor Android controla agora o intervalo, a sessão e todo o progresso. Não foi aberto um segundo executor.";
        if (percent) percent.textContent = "FILA";
        if (bar) bar.style.width = "4%";
        if (footer) footer.innerHTML = '<button type="button" class="is-primary" data-fc-native-done>Continuar na app</button>';
        footer?.querySelector("[data-fc-native-done]")?.addEventListener("click", close);
        technicalLog("info", "scan", "native-manual-queued", "Check entregue à fila global Android sem executar diretamente na WebExtension.");
        toast("Check entregue à fila única de segurança.", "success");
        return;
      }
      if (title) title.textContent = "Análise concluída";
      if (detail) detail.textContent = "Relações e histórico foram atualizados e guardados na app.";
      if (percent) percent.textContent = "100%";
      if (bar) bar.style.width = "100%";
      if (footer) footer.innerHTML = '<button type="button" class="is-primary" data-fc-native-done>Ver resultados</button>';
      footer?.querySelector("[data-fc-native-done]")?.addEventListener("click", close);
      technicalLog("info", "scan", "native-manual-completed", "Análise manual concluída.", { accountId: response.result?.accountId, completedAt: response.result?.completedAt });
      toast("Análise concluída e guardada na app.", "success");
    } catch (error) {
      if (title) title.textContent = "A análise foi interrompida";
      if (detail) detail.textContent = error?.message || "Não foi possível concluir a análise.";
      if (footer) footer.innerHTML = '<button type="button" data-fc-native-diagnostic>Ver diagnóstico</button><button type="button" class="is-primary" data-fc-native-retry>Tentar novamente</button>';
      footer?.querySelector("[data-fc-native-diagnostic]")?.addEventListener("click", () => { close(); openSupportCenter(shadow); });
      footer?.querySelector("[data-fc-native-retry]")?.addEventListener("click", () => { close(); runNativeManualScan(shadow); });
      technicalLog("error", "scan", "native-manual-failed", error?.message || "Análise manual falhou.", { code: error?.code || "unknown_error" });
    } finally {
      nativeManualScanRunning = false;
      globalThis.removeEventListener("followcheck:native-monitor-progress", onProgress);
    }
  }

  function installInAppSupportAndScan(shadow) {
    if (shadow.__followcheckInAppSupportInstalled) return;
    shadow.__followcheckInAppSupportInstalled = true;
    shadow.addEventListener("click", (event) => {
      const button = event.target?.closest?.("button");
      if (!button) return;
      const label = String(button.textContent || "").replace(/\s+/g, " ").trim();
      if (/Diagnóstico, logs e Android|Diagnóstico e relatório de suporte/i.test(label)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openSupportCenter(shadow);
        return;
      }
      const manualScan = button.matches?.(".scan-button")
        || /^(?:Nova|Iniciar|Começar|Fazer|Repetir)(?: nova)? análise$/i.test(label)
        || /^Tentar novamente$/i.test(label);
      if (!manualScan || button.closest(".fc-native-scan-overlay")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      runNativeManualScan(shadow);
    }, true);
  }

  function renderTechnicalLogRows(modal) {
    const list = modal.querySelector(".fc-logs-list");
    const search = String(modal.querySelector('[data-fc-log-search]')?.value || "").trim().toLocaleLowerCase("pt-PT");
    const level = modal.querySelector('[data-fc-log-level]')?.value || "all";
    const logs = readTechnicalLogs().filter((entry) => {
      if (level !== "all" && entry.level !== level) return false;
      if (!search) return true;
      return `${entry.source} ${entry.event} ${entry.message} ${JSON.stringify(entry.meta || {})}`.toLocaleLowerCase("pt-PT").includes(search);
    }).reverse();
    list.replaceChildren();
    if (!logs.length) {
      const empty = document.createElement("div");
      empty.className = "fc-log-empty";
      empty.textContent = search || level !== "all" ? "Nenhum log corresponde ao filtro." : "Ainda não existem eventos técnicos. Verifica a sessão ou inicia uma operação.";
      list.append(empty);
    } else {
      logs.forEach((entry) => {
        const row = document.createElement("article");
        row.className = "fc-log-row";
        row.dataset.level = entry.level;
        const time = document.createElement("time");
        time.dateTime = entry.at;
        time.textContent = new Date(entry.at).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const badge = document.createElement("span");
        badge.className = "fc-log-level";
        badge.textContent = entry.level.toUpperCase();
        const copy = document.createElement("div");
        copy.className = "fc-log-copy";
        const title = document.createElement("strong");
        title.textContent = `${entry.source} · ${entry.event}`;
        const message = document.createElement("p");
        message.textContent = entry.message || "Sem mensagem";
        copy.append(title, message);
        const version = document.createElement("span");
        version.textContent = `v${entry.version || VERSION}`;
        row.append(time, badge, copy, version);
        const metaEntries = Object.entries(entry.meta || {});
        if (metaEntries.length) {
          const meta = document.createElement("div");
          meta.className = "fc-log-meta";
          metaEntries.slice(0, 10).forEach(([key, value]) => {
            const code = document.createElement("code");
            code.textContent = `${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`;
            meta.append(code);
          });
          row.append(meta);
        }
        list.append(row);
      });
    }
    const count = modal.querySelector("[data-fc-log-count]");
    if (count) count.textContent = `${logs.length} evento${logs.length === 1 ? "" : "s"}`;
  }

  function openTechnicalLogs(shadow = root()) {
    if (!shadow) return;
    shadow.querySelector(".fc-logs-overlay")?.remove();
    const overlay = document.createElement("section");
    overlay.className = "fc-logs-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Logs técnicos FollowCheck");
    overlay.innerHTML = `
      <div class="fc-logs-modal">
        <header><div class="fc-logs-title"><b aria-hidden="true">⌁</b><span><h2>Logs técnicos</h2><p>Pedidos, sessão, fila e erros reais da aplicação.</p></span></div><button class="fc-logs-close" type="button" aria-label="Fechar">×</button></header>
        <div class="fc-logs-toolbar"><input data-fc-log-search type="search" placeholder="Pesquisar evento, erro ou estado…" aria-label="Pesquisar logs"><select data-fc-log-level aria-label="Filtrar por nível"><option value="all">Todos os níveis</option><option value="error">Erros</option><option value="warn">Avisos</option><option value="info">Informação</option><option value="debug">Debug</option></select><button data-fc-log-refresh type="button">Atualizar · <span data-fc-log-count>0 eventos</span></button></div>
        <div class="fc-logs-list"></div>
        <footer><div class="fc-logs-privacy"><span aria-hidden="true">✓</span><span>Nunca guarda passwords, cookies, tokens, cabeçalhos ou corpos de pedidos.</span></div><div class="fc-logs-actions"><button data-fc-log-clear class="is-danger" type="button">Limpar</button><button data-fc-log-export type="button">Exportar JSON</button><button data-fc-log-copy class="is-primary" type="button">Copiar logs</button></div></footer>
      </div>`;
    shadow.append(overlay);
    const close = () => {
      document.removeEventListener("followcheck:technical-log:updated", refresh);
      overlay.remove();
    };
    const refresh = () => renderTechnicalLogRows(overlay);
    overlay.querySelector(".fc-logs-close")?.addEventListener("click", close);
    overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
    overlay.querySelector('[data-fc-log-search]')?.addEventListener("input", refresh);
    overlay.querySelector('[data-fc-log-level]')?.addEventListener("change", refresh);
    overlay.querySelector('[data-fc-log-refresh]')?.addEventListener("click", refresh);
    overlay.querySelector('[data-fc-log-clear]')?.addEventListener("click", () => {
      localStorage.removeItem(TECHNICAL_LOG_KEY);
      localStorage.setItem(TECHNICAL_LOG_RUN_START_KEY, new Date().toISOString());
      sendRuntime({ type: "FOLLOWCHECK_TECHNICAL_LOGS_CLEAR" }).catch(() => null);
      refresh();
      toast("Logs técnicos apagados. O próximo relatório começa agora.", "success");
    });
    overlay.querySelector('[data-fc-log-export]')?.addEventListener("click", () => {
      download(`followcheck-logs-${new Date().toISOString().slice(0, 10)}.json`, technicalReport());
      toast("Relatório técnico exportado.", "success");
    });
    overlay.querySelector('[data-fc-log-copy]')?.addEventListener("click", async () => {
      const copied = await copyText(technicalReport());
      if (copied) toast("Logs copiados. Já podes colá-los na conversa.", "success");
      else {
        download(`followcheck-logs-${new Date().toISOString().slice(0, 10)}.json`, technicalReport());
        toast("Clipboard indisponível; os logs foram exportados.", "warning");
      }
    });
    document.addEventListener("followcheck:technical-log:updated", refresh);
    refresh();
  }

  function renderDiagnostics(panel) {
    const state = diagnosticSnapshot();
    const settings = readSettings();
    panel.innerHTML = `
      <section class="fc-diagnostics-heading"><small>FOLLOWCHECK SYSTEM</small><h3>Diagnóstico & dispositivo</h3><p>Estado técnico local, ferramentas de backup e ajustes de acessibilidade.</p></section>
      <div class="fc-diagnostic-grid">
        <article><small>Motor</small><strong>v${state.version}</strong><span>executor protegido ativo</span></article>
        <article><small>Sessão</small><strong>${state.accountPresent ? "Ligada" : "Por validar"}</strong><span>${state.accountPresent ? "identidade local presente" : "sem identidade local"}</span></article>
        <article><small>Viewport</small><strong>${state.viewport.split(" @")[0]}</strong><span>${state.viewport.split(" @")[1] || "1x"}</span></article>
        <article><small>Layout</small><strong>${state.overflowCount ? `${state.overflowCount} alertas` : "Sem cortes"}</strong><span>${state.storageKeys} registos · ${state.storageKiB} KiB</span></article>
      </div>
      <div class="fc-settings-list">
        <label><span><strong>Modo compacto</strong><small>Reduz espaços sem diminuir a legibilidade.</small></span><input type="checkbox" data-fc-setting="compact" ${settings.compact ? "checked" : ""}></label>
        <label><span><strong>Reduzir movimento</strong><small>Desativa animações e transições decorativas.</small></span><input type="checkbox" data-fc-setting="reduceMotion" ${settings.reduceMotion ? "checked" : ""}></label>
        <label><span><strong>Marcar cortes de layout</strong><small>Contorna a vermelho qualquer elemento que ultrapasse o ecrã.</small></span><input type="checkbox" data-fc-setting="showOutlines" ${settings.showOutlines ? "checked" : ""}></label>
      </div>
      <div class="fc-diagnostic-actions">
        <button type="button" data-fc-action="scan-layout">Verificar layout</button>
        <button type="button" data-fc-action="copy-diagnostic">Copiar diagnóstico</button>
        <button type="button" data-fc-action="backup">Exportar backup local</button>
        <button type="button" data-fc-action="logs">Abrir logs técnicos</button>
      </div>
      <p class="fc-diagnostic-note">O backup contém apenas dados FollowCheck guardados neste dispositivo. Passwords e cookies do Instagram não são incluídos.</p>`;
    panel.querySelectorAll("[data-fc-setting]").forEach((input) => input.addEventListener("change", () => {
      const next = readSettings();
      next[input.dataset.fcSetting] = input.checked;
      saveSettings(next);
      renderDiagnostics(panel);
    }));
    panel.querySelector('[data-fc-action="scan-layout"]')?.addEventListener("click", () => {
      const report = overflowReport();
      toast(report.count ? `${report.count} possíveis cortes marcados.` : "Layout verificado: sem cortes horizontais.", report.count ? "warning" : "success");
      renderDiagnostics(panel);
    });
    panel.querySelector('[data-fc-action="copy-diagnostic"]')?.addEventListener("click", copyDiagnostic);
    panel.querySelector('[data-fc-action="backup"]')?.addEventListener("click", exportBackup);
    panel.querySelector('[data-fc-action="logs"]')?.addEventListener("click", () => openTechnicalLogs(root()));
  }

  function showDiagnostics(modal) {
    const main = modal.querySelector(".v7-settings-layout > main");
    if (!main) return;
    modal.querySelectorAll(".v7-settings-layout > nav > button").forEach((button) => button.classList.remove("is-active"));
    modal.querySelector("[data-fc-diagnostics-tab]")?.classList.add("is-active");
    main.classList.add("is-fc-diagnostics");
    let panel = main.querySelector(".fc-diagnostics-panel");
    if (!panel) {
      panel = document.createElement("section");
      panel.className = "fc-diagnostics-panel";
      main.append(panel);
    }
    renderDiagnostics(panel);
  }

  function installDiagnostics(shadow) {
    const modal = shadow.querySelector(".v7-settings-modal");
    const nav = modal?.querySelector(".v7-settings-layout > nav");
    if (!modal || !nav || nav.querySelector("[data-fc-diagnostics-tab]")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.fcDiagnosticsTab = "true";
    button.innerHTML = '<span aria-hidden="true">◉</span> Diagnóstico';
    button.addEventListener("click", () => showDiagnostics(modal));
    nav.append(button);
    [...nav.children].filter((item) => item !== button).forEach((nativeButton) => nativeButton.addEventListener("click", () => {
      modal.querySelector(".v7-settings-layout > main")?.classList.remove("is-fc-diagnostics");
      button.classList.remove("is-active");
    }));
  }

  function findButtonByText(shadow, text) {
    return [...shadow.querySelectorAll("button")].find((button) => String(button.textContent || "").replace(/\s+/g, " ").trim().includes(text));
  }

  function openDiagnostics(shadow) {
    globalThis.dispatchEvent(new CustomEvent("followcheck:open-support-center"));
  }

  function installSystemTools(shadow) {
    const page = shadow.querySelector(".v7-settings-modal .v7-settings-layout > main");
    if (!page || page.querySelector("[data-fc-system-tools]")) return;
    const section = document.createElement("section");
    section.className = "v7-tool-section fc-system-tools";
    section.dataset.fcSystemTools = "true";
    section.innerHTML = `
      <header><div><h2>Sistema & manutenção</h2><p>Diagnóstico, sessão, layout, backup e suporte reunidos nas Definições.</p></div><span>Motor v${VERSION}</span></header>
      <div class="fc-system-tool-grid">
        <button type="button" data-fc-tool="diagnostic"><b>◉</b><span><small>SISTEMA</small><strong>Diagnóstico</strong><em>Sessão, armazenamento e viewport</em></span></button>
        <button type="button" data-fc-tool="session"><b>✓</b><span><small>CONTA</small><strong>Verificar sessão</strong><em>Confirma identidade e token local</em></span></button>
        <button type="button" data-fc-tool="layout"><b>↔</b><span><small>INTERFACE</small><strong>Validar layout</strong><em>Deteta cortes horizontais</em></span></button>
        <button type="button" data-fc-tool="backup"><b>⇩</b><span><small>DADOS</small><strong>Backup local</strong><em>Exporta o estado FollowCheck</em></span></button>
        <button type="button" data-fc-tool="logs"><b>⌁</b><span><small>SUPORTE</small><strong>Logs técnicos</strong><em>Erros reais prontos a copiar</em></span></button>
      </div>`;
    page.append(section);
    section.querySelector('[data-fc-tool="diagnostic"]')?.addEventListener("click", () => openDiagnostics(shadow));
    section.querySelector('[data-fc-tool="session"]')?.addEventListener("click", async () => {
      try {
        const session = await probePageSession();
        toast(`Sessão pronta · @${session.username || session.userId} · contexto Instagram autenticado`, "success");
      } catch (error) {
        toast(error?.message || "Não foi possível validar a sessão protegida.", "warning");
      }
    });
    section.querySelector('[data-fc-tool="layout"]')?.addEventListener("click", () => {
      const report = overflowReport(shadow);
      toast(report.count ? `${report.count} possíveis cortes encontrados. Ativa a marcação no Diagnóstico.` : "Layout validado sem cortes horizontais.", report.count ? "warning" : "success");
    });
    section.querySelector('[data-fc-tool="backup"]')?.addEventListener("click", exportBackup);
    section.querySelector('[data-fc-tool="logs"]')?.addEventListener("click", () => globalThis.dispatchEvent(new CustomEvent("followcheck:open-support-center")));
  }

  function installQueueCircuitReset(shadow) {
    const button = shadow.querySelector(".operations-view .execute-button");
    if (!button || button.dataset.fcCircuitReset) return;
    button.dataset.fcCircuitReset = "true";
    button.addEventListener("click", () => {
      relationshipCircuitOpen = false;
    }, { capture: true });
  }

  function installFileGuard(shadow) {
    shadow.querySelectorAll('input[type="file"]').forEach((input) => {
      if (input.dataset.fcGuarded) return;
      input.dataset.fcGuarded = "true";
      input.addEventListener("change", () => {
        const count = input.files?.length || 0;
        if (count) toast(`${count} ficheiro${count === 1 ? "" : "s"} recebido${count === 1 ? "" : "s"}. A validar localmente…`);
      });
    });
    shadow.querySelectorAll("button").forEach((button) => {
      if (button.dataset.fcFileButton || !String(button.textContent || "").includes("Escolher ficheiro")) return;
      button.dataset.fcFileButton = "true";
      button.addEventListener("click", () => {
        const input = button.closest(".v8-import-drop")?.querySelector('input[type="file"]');
        if (input) input.value = "";
      }, { capture: true });
    });
  }

  function consoleSummary(args) {
    return args.slice(0, 5).map((value) => {
      if (value instanceof Error) return `${value.name}: ${value.message}`;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
      if (Array.isArray(value)) return `[array:${value.length}]`;
      if (value && typeof value === "object") {
        const allowed = ["name", "message", "code", "status", "httpStatus", "endpoint", "phase", "stage"];
        const summary = {};
        allowed.forEach((key) => { if (value[key] != null) summary[key] = value[key]; });
        return Object.keys(summary).length ? JSON.stringify(summary) : `[object:${Object.keys(value).slice(0, 6).join(",")}]`;
      }
      return String(value);
    }).join(" ");
  }

  function installRuntimeCapture() {
    if (globalThis.__FOLLOWCHECK_TECHNICAL_LOG_CAPTURE__) return;
    globalThis.__FOLLOWCHECK_TECHNICAL_LOG_CAPTURE__ = true;
    for (const level of ["warn", "error"]) {
      const original = console[level]?.bind(console);
      if (!original) continue;
      console[level] = (...args) => {
        original(...args);
        technicalLog(level, "console", `console-${level}`, consoleSummary(args));
      };
    }
    globalThis.addEventListener?.("error", (event) => {
      technicalLog("error", "runtime", "uncaught-error", event?.message || "Erro JavaScript não tratado.", {
        source: event?.filename ? sanitizeEndpoint(event.filename) : "",
        line: event?.lineno,
        column: event?.colno,
      });
    });
    globalThis.addEventListener?.("unhandledrejection", (event) => {
      const reason = event?.reason;
      const message = reason?.message || consoleSummary([reason]) || "Promise rejeitada sem tratamento.";
      const geckoTransient = /^(?:ESTABLISHMENT_TIMEOUT|KEEPALIVE_TIMEOUT)$/i.test(String(message).trim());
      technicalLog(geckoTransient ? "warn" : "error", "runtime", geckoTransient ? "gecko-transport-timeout" : "unhandled-rejection", message, {
        name: reason?.name,
        code: reason?.code,
        endpoint: reason?.endpoint,
        httpStatus: reason?.httpStatus,
        recoverable: geckoTransient || undefined,
      });
      // Estes dois timeouts são emitidos pelo transporte Gecko quando uma ligação antiga
      // é descartada; o monitor tem retry próprio. Evitamos que apareçam como crash global.
      if (geckoTransient) event.preventDefault?.();
    });
  }

  let pageContextCooldownChecked = false;
  function clearKnownPageContextCooldown({ migration = false } = {}) {
    const migrationKey = "followcheck:hardening:migration:10.6.5-verified-fallback";
    if (migration && localStorage.getItem(migrationKey) === "done") return;
    if (migration && pageContextCooldownChecked) return;
    const accountId = cookie("ds_user_id");
    if (!accountId) return;
    if (migration) pageContextCooldownChecked = true;
    try {
      const safetyKey = `followcheck:v3:account:${accountId}:safety-state`;
      const saved = JSON.parse(localStorage.getItem(safetyKey) || "null");
      const obsolete = new Set([
        "followcheck_executor_unavailable",
        "followcheck_executor_transport_failed",
        "instagram_session_cookie_missing",
      ]);
      const latest = saved?.data?.incidents?.[0];
      const knownPageContextFailure = latest?.code === "html_response"
        && /friendships\/(?:create|destroy|remove_follower|follow|unfollow|removeFollower)/i.test(String(latest?.endpoint || ""));
      if (saved?.version === 3 && (obsolete.has(latest?.code) || knownPageContextFailure)) {
        saved.data.cooldownUntil = null;
        saved.data.requiresReview = false;
        saved.data.incidents = (saved.data.incidents || []).filter((incident) => {
          if (obsolete.has(incident?.code)) return false;
          return !(incident?.code === "html_response" && /friendships\//i.test(String(incident?.endpoint || "")));
        });
        localStorage.setItem(safetyKey, JSON.stringify(saved));
        technicalLog("info", "migration", "stale-cooldown-cleared", "Foi removida a proteção criada pela falha antiga do contexto isolado.");
      }
      const draftKey = `followcheck:v3:account:${accountId}:operation-draft`;
      const draft = JSON.parse(localStorage.getItem(draftKey) || "null");
      if (draft?.version === 3
          && Array.isArray(draft.data?.queue)
          && draft.data.queue.some((item) => item?.status === "error")) {
        draft.data.queue = draft.data.queue.map((item) => ["success", "error", "cancelled"].includes(item?.status)
          ? item
          : { ...item, status: "cancelled", activeStep: null });
        draft.data.updatedAt = new Date().toISOString();
        localStorage.setItem(draftKey, JSON.stringify(draft));
      }
      if (migration) localStorage.setItem(migrationKey, "done");
    } catch {
      // Uma migração de segurança não deve bloquear a abertura da interface.
    }
  }


  const FOLD_OVERFLOW_CSS = `
    .v7-featured-grid,.v7-tools-grid,.fc-system-tool-grid{width:100%;max-width:100%;min-width:0!important}
    .v7-tool-card{box-sizing:border-box!important;width:100%!important;max-width:100%!important;min-width:0!important;overflow:hidden!important}
    .v7-tool-card>*{min-width:0!important;max-width:100%}
    .v7-tool-card p,.v7-tool-card strong,.v7-tool-card small{overflow-wrap:anywhere;word-break:break-word}
    @media (max-width:820px){.v7-featured-grid,.v7-tools-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px!important}}
    @media (max-width:520px){.v7-featured-grid,.v7-tools-grid{grid-template-columns:1fr!important}}
  `;

  function install(shadow) {
    if (!shadow) return;
    if (!shadow.querySelector("style[data-fc-hardening]")) {
      const style = document.createElement("style");
      style.dataset.fcHardening = VERSION;
      style.textContent = `${HARDENING_CSS}
${FOLD_OVERFLOW_CSS}`;
      shadow.prepend(style);
    }
    clearKnownPageContextCooldown({ migration: true });
    applySettings();
    installDiagnostics(shadow);
    installSystemTools(shadow);
    installInAppSupportAndScan(shadow);
    installQueueCircuitReset(shadow);
    installFileGuard(shadow);
    renderGlobalSafety(shadow);
  }

  installConsoleCapture();
  installRuntimeCapture();
  technicalLog("info", "app", "hardening-started", "Camada de estabilidade e diagnóstico iniciada.", {
    pageExecutor: document.documentElement.dataset.followcheckPageExecutor || "pending",
  });
  pageExecutorRequest("ping", {}, { timeoutMs: 5000 })
    .then((result) => technicalLog("info", "bridge", "page-executor-ready", "Executor do contexto principal disponível.", { executorVersion: result?.version }))
    .catch((error) => technicalLog("error", "bridge", "page-executor-unavailable", error?.message || "Executor principal indisponível.", { code: error?.code }));
  refreshGlobalSafety();
  globalThis.browser?.runtime?.onMessage?.addListener?.((message) => {
    if (message?.type !== "FOLLOWCHECK_SAFETY_STATE") return undefined;
    globalSafetyState = message.safety || { blocked: false };
    technicalLog(globalSafetyState.blocked ? "warn" : "info", "safety", globalSafetyState.blocked ? "global-lock-visible" : "global-lock-cleared", globalSafetyState.blocked
      ? globalSafetyState.message || "A proteção global ficou ativa."
      : "A proteção global deixou de estar ativa.", {
      reason: globalSafetyState.reason || "",
      manualResetRequired: Boolean(globalSafetyState.manualResetRequired),
      cooldownUntil: Number(globalSafetyState.cooldownUntil || 0),
    });
    renderGlobalSafety(root());
    return Promise.resolve({ ok: true });
  });
  applySettings();
  let installObserver = null;
  let observedShadow = null;
  let installThrottle = 0;
  const scheduleInstall = () => {
    if (installThrottle) return;
    installThrottle = setTimeout(() => {
      installThrottle = 0;
      install(root());
    }, 80);
  };
  const disconnectInstallObserver = () => {
    installObserver?.disconnect();
    installObserver = null;
    observedShadow = null;
  };
  const connectInstallObserver = () => {
    if (document.hidden) {
      disconnectInstallObserver();
      return;
    }
    const shadow = root();
    if (!shadow) {
      disconnectInstallObserver();
      scheduleInstall();
      return;
    }
    if (shadow !== observedShadow) {
      disconnectInstallObserver();
      observedShadow = shadow;
      installObserver = new MutationObserver(scheduleInstall);
      // Observe only the FollowCheck Shadow DOM. Watching the whole Instagram
      // document caused needless wakeups whenever its hidden feed changed.
      installObserver.observe(shadow, { childList: true, subtree: true });
    }
    scheduleInstall();
  };
  connectInstallObserver();
  setTimeout(connectInstallObserver, 400);
  setTimeout(connectInstallObserver, 1200);
  globalThis.addEventListener?.("followcheck:workspace-ready", connectInstallObserver);
  globalThis.addEventListener?.("followcheck:workspace-reconciling", disconnectInstallObserver);
  globalThis.addEventListener?.("pageshow", connectInstallObserver);
  document.addEventListener("visibilitychange", connectInstallObserver);
  globalThis.addEventListener?.("followcheck:open-support-center", () => openSupportCenter(root()));
})();

// Asset-level settings surface. It intentionally lives in its own subtree so
// React can keep owning the App Shell while updates based on the 2.8.9 native
// core can still expose every scan pacing value without a second scheduler.
(() => {
  if (globalThis.__FOLLOWCHECK_MONITOR_SETTINGS_10200__) return;
  globalThis.__FOLLOWCHECK_MONITOR_SETTINGS_10200__ = true;
  const STORAGE_KEY = "followcheck:monitor-pacing:v1";
  const DEFAULTS = Object.freeze({
    globalGapMinutes: 60,
    manualRespectsGap: false,
    paceAfterFailure: false,
    pageDelayMinMs: 5000,
    pageDelayMaxMs: 5000,
    pauseEveryPages: 5,
    pauseDurationMs: 30000,
  });
  const runtime = globalThis.browser?.runtime || globalThis.chrome?.runtime;
  const storage = globalThis.browser?.storage?.local || globalThis.chrome?.storage?.local;
  const number = (value, fallback, min, max) => Math.max(min,
    Math.min(max, Number.isFinite(Number(value)) ? Number(value) : fallback));
  const normalized = (value = {}) => {
    const minimum = number(value.pageDelayMinMs, DEFAULTS.pageDelayMinMs, 0, 60_000);
    return {
      globalGapMinutes: number(value.globalGapMinutes, DEFAULTS.globalGapMinutes, 0, 43_200),
      manualRespectsGap: value.manualRespectsGap === true,
      paceAfterFailure: value.paceAfterFailure === true,
      pageDelayMinMs: minimum,
      pageDelayMaxMs: Math.max(minimum, number(value.pageDelayMaxMs, DEFAULTS.pageDelayMaxMs, 0, 60_000)),
      pauseEveryPages: Math.round(number(value.pauseEveryPages, DEFAULTS.pauseEveryPages, 0, 50)),
      pauseDurationMs: number(value.pauseDurationMs, DEFAULTS.pauseDurationMs, 0, 600_000),
    };
  };
  const getSettings = async () => {
    const stored = await storage?.get?.(STORAGE_KEY).catch?.(() => ({})) || {};
    return normalized(stored?.[STORAGE_KEY] || {});
  };
  const saveSettings = async (value) => storage?.set?.({ [STORAGE_KEY]: normalized(value) });
  const field = (label, control) => {
    const wrapper = document.createElement("label");
    wrapper.className = "fc-total-setting-field";
    const name = document.createElement("span");
    name.textContent = label;
    wrapper.append(name, control);
    return wrapper;
  };
  const option = (value, label) => {
    const item = document.createElement("option");
    item.value = String(value);
    item.textContent = label;
    return item;
  };
  const inject = async () => {
    const root = document.getElementById("followcheck-app-host")?.shadowRoot;
    const page = root?.querySelector(".fc-settings-page");
    if (!page || page.querySelector("#fc-total-monitor-settings")) return;
    const value = await getSettings();
    if (!page.isConnected || page.querySelector("#fc-total-monitor-settings")) return;
    const card = document.createElement("section");
    card.id = "fc-total-monitor-settings";
    card.innerHTML = `
      <style>
        #fc-total-monitor-settings{margin-top:16px;padding:18px;border:1px solid rgba(171,123,255,.32);border-radius:20px;background:linear-gradient(145deg,rgba(120,70,210,.10),rgba(11,14,23,.96));color:#f6f2ff}
        #fc-total-monitor-settings header small{display:block;color:#b68cff;font-size:9px;font-weight:800;letter-spacing:.12em}
        #fc-total-monitor-settings header h2{margin:5px 0 0;font-size:18px}
        #fc-total-monitor-settings header p{margin:7px 0 0;color:#9fa5b5;font-size:10px;line-height:1.5}
        .fc-total-setting-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}
        .fc-total-setting-field{display:flex;min-width:0;flex-direction:column;gap:6px;color:#c7c2d0;font-size:9px}
        .fc-total-setting-field select,.fc-total-setting-field input[type=number]{width:100%;min-height:44px;padding:0 11px;border:1px solid #343a49;border-radius:12px;background:#0c1019;color:#fff;font:inherit;font-size:11px}
        .fc-total-setting-toggle{display:flex;min-height:52px;padding:0 12px;align-items:center;justify-content:space-between;gap:12px;border:1px solid #303645;border-radius:13px;background:#0c1018;color:#dcd7e5;font-size:10px}
        .fc-total-setting-toggle input{width:20px;height:20px;accent-color:#a970ff}
        .fc-total-setting-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:14px}
        .fc-total-setting-actions button{min-height:44px;border:1px solid #4d3b73;border-radius:13px;background:#171326;color:#d6c2ff;font-size:10px;font-weight:760}
        .fc-total-setting-actions button[data-primary]{border-color:#d99aff;background:linear-gradient(100deg,#ed5d7f,#8d5cff);color:#fff}
        .fc-total-setting-note{display:block;margin-top:12px;color:#888fa0;font-size:8.5px;line-height:1.45}
        @media(max-width:520px){.fc-total-setting-grid{grid-template-columns:1fr}}
      </style>
      <header><small>CONTROLO TOTAL DO MOTOR</small><h2>Ritmo, limites e comportamento</h2><p>Estes valores são usados pela conta principal e pela Watchlist na única fila da sessão atual.</p></header>
      <div class="fc-total-setting-grid" data-fields></div>
      <div class="fc-total-setting-actions"><button type="button" data-native>Conta e notificações</button><button type="button" data-primary data-save>Guardar definições</button><button type="button" data-reset>Repor equilibrado</button><button type="button" data-logs>Atualizar estado</button></div>
      <small class="fc-total-setting-note">A fila única e snapshots completos são garantias de integridade. HTTP 429, challenge e avisos reais do Instagram param sempre os pedidos e respeitam o cooldown indicado pela plataforma.</small>`;
    const grid = card.querySelector("[data-fields]");
    const gap = document.createElement("select");
    [[0,"Sem limite global"],[60,"1 hora"],[180,"3 horas"],[360,"6 horas"],[720,"12 horas"],[1440,"24 horas"],[4320,"3 dias"],[10080,"7 dias"]]
      .forEach(([minutes, label]) => gap.append(option(minutes, label)));
    gap.value = String(value.globalGapMinutes);
    const manual = document.createElement("input"); manual.type = "checkbox"; manual.checked = value.manualRespectsGap;
    const failures = document.createElement("input"); failures.type = "checkbox"; failures.checked = value.paceAfterFailure;
    const toggle = (label, input) => {
      const wrapper = document.createElement("label"); wrapper.className = "fc-total-setting-toggle";
      const span = document.createElement("span"); span.textContent = label; wrapper.append(span, input); return wrapper;
    };
    const numeric = (current, min, max) => {
      const input = document.createElement("input"); input.type = "number"; input.min = String(min); input.max = String(max); input.value = String(current); return input;
    };
    const delayMin = numeric(value.pageDelayMinMs / 1000, 0, 60);
    const delayMax = numeric(value.pageDelayMaxMs / 1000, 0, 60);
    const pauseEvery = numeric(value.pauseEveryPages, 0, 50);
    const pauseSeconds = numeric(value.pauseDurationMs / 1000, 0, 600);
    grid.append(field("Intervalo mínimo partilhado", gap),
      toggle("Check manual respeita o intervalo", manual),
      toggle("Falha inconclusiva consome intervalo", failures),
      field("Espera mínima por página (s)", delayMin),
      field("Espera máxima por página (s)", delayMax),
      field("Pausa a cada N páginas (0 desativa)", pauseEvery),
      field("Duração da pausa (s)", pauseSeconds));
    card.querySelector("[data-save]").addEventListener("click", async () => {
      const next = normalized({
        globalGapMinutes: gap.value,
        manualRespectsGap: manual.checked,
        paceAfterFailure: failures.checked,
        pageDelayMinMs: Number(delayMin.value) * 1000,
        pageDelayMaxMs: Number(delayMax.value) * 1000,
        pauseEveryPages: pauseEvery.value,
        pauseDurationMs: Number(pauseSeconds.value) * 1000,
      });
      if (next.pageDelayMaxMs < next.pageDelayMinMs) return;
      await saveSettings(next);
      console.info("[FollowCheck][Settings] monitor pacing saved", next);
      card.querySelector("[data-save]").textContent = "Guardado";
      setTimeout(() => { const button = card.querySelector("[data-save]"); if (button) button.textContent = "Guardar definições"; }, 1400);
    });
    card.querySelector("[data-reset]").addEventListener("click", async () => {
      await saveSettings(DEFAULTS); card.remove(); inject();
    });
    card.querySelector("[data-native]").addEventListener("click", () => runtime?.sendMessage?.({ type: "FOLLOWCHECK_OPEN_NATIVE_SETTINGS" }));
    card.querySelector("[data-logs]").addEventListener("click", () => runtime?.sendMessage?.({ type: "FOLLOWCHECK_NATIVE_STATUS_REQUEST" }));
    page.append(card);
  };
  const observer = new MutationObserver(() => inject().catch(() => {}));
  const observeWorkspace = () => {
    if (typeof document === "undefined") return;
    const root = document.getElementById("followcheck-app-host")?.shadowRoot;
    if (root) observer.observe(root, { childList: true, subtree: true });
    inject().catch(() => {});
  };
  globalThis.addEventListener?.("followcheck:workspace-mounted", observeWorkspace);
  globalThis.addEventListener?.("followcheck:workspace-ready", observeWorkspace);
  observeWorkspace();
})();
