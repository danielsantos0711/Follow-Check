/* Presentation only, scoped to the existing workspace's ShadowRoot. */
(() => {
  if (globalThis.__FC_IOS_THEME__) { globalThis.__FC_IOS_THEME__(); return; }
  const css = `
    :host { --bg:#090c10; --sidebar:#0d1117; --surface:#13171d; --surface-raised:#1a2028;
      --surface-hover:#202832; --border:#29313b; --border-strong:#3d4855;
      --accent:#8fefc2; --accent-strong:#a6f6d1; --accent-soft:rgba(143,239,194,.10);
      --text:#f2f5f7; --muted:#a5afb9; --subtle:#8995a2;
      --radius-sm:10px; --radius-md:16px; --radius-lg:22px;
      font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif!important; }
    .app-shell.v3-shell { background:var(--bg)!important; }
    .panel,.relationship-panel,.hub-body { border-radius:18px!important; background:var(--surface)!important; box-shadow:none!important; }
    .v7-sidebar { background:var(--sidebar)!important; }
    .v3-topbar { min-height:76px!important; }
    .v3-main { padding-bottom:28px!important; }
    button,input,select { min-height:44px; }
    input,select,textarea { font-size:16px!important; border-radius:12px!important; }
    button:focus-visible,a:focus-visible,input:focus-visible { outline:2px solid var(--accent)!important; outline-offset:3px; }
    .button.primary { background:var(--accent)!important; color:#091710!important; border-color:var(--accent)!important; }
    .nav-item.active { color:var(--accent)!important; background:var(--accent-soft)!important; }
    @media(max-width:760px) {
      .v3-main { padding-left:16px!important; padding-right:16px!important; }
      .title-block h1 { font-size:26px!important; }
      .topbar { gap:12px!important; }
      .topbar-actions { flex-wrap:wrap; }
    }
    @media(prefers-reduced-motion:reduce) {
      *,*::before,*::after { animation-duration:.01ms!important; animation-iteration-count:1!important; transition-duration:.01ms!important; scroll-behavior:auto!important; }
    }
  `;
  let observed = null;
  function apply() {
    const root = document.getElementById('followcheck-app-host')?.shadowRoot;
    if (!root || root.querySelector('#fc-ios-theme')) return;
    const style = document.createElement('style'); style.id='fc-ios-theme'; style.textContent=css;
    root.appendChild(style); observed=root;
  }
  globalThis.__FC_IOS_THEME__ = apply;
  apply();
  globalThis.addEventListener('followcheck:workspace-ready', apply);
  // Bounded mounting retry; no perpetual DOM-wide MutationObserver.
  let attempts=0;
  const timer=setInterval(() => {apply(); if(observed || ++attempts>=40) clearInterval(timer);},100);
})();
