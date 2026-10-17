(() => {
  if (globalThis.__FOLLOWCHECK_MOBILE_BRIDGE__) return;
  globalThis.__FOLLOWCHECK_MOBILE_BRIDGE__ = true;

  const PAGE_REQUEST_EVENT = "followcheck:page-executor:request:v1";
  const PAGE_RESPONSE_EVENT = "followcheck:page-executor:response:v1";
  const PAGE_CANCEL_EVENT = "followcheck:page-executor:cancel:v1";
  // A interface 10.20.8 confirma a sincronização da Watchlist antes de enviar o
  // comando ao motor 10.20.6 e continua a aceitar estados nativos antigos.
  const EXPECTED_UI_VERSION = "10.20.8";
  const COMPATIBLE_ENGINE_VERSIONS = new Set(["10.17.5", "10.18.0", "10.19.0", "10.19.1", "10.19.2", "10.20.0", "10.20.1", "10.20.5", "10.20.6", "10.20.8"]);
  const RELEASE_PACKAGE_VERSION = "2.9.8";
  const RELEASE_ENGINE_VERSION = "10.20.6";
  const TECHNICAL_LOG_KEY = "followcheck:technical-logs:v1";
  const TECHNICAL_LOG_RUN_START_KEY = "followcheck:technical-log-run-start:v1";
  const WORKSPACE_MOUNT_GRACE_MS = 12_000;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const WORKSPACE_FIX_STYLE_ID = "followcheck-workspace-fixes-2-7-8";
  const WORKSPACE_FIX_CSS = `
    .communication-hub.has-area-error .hub-body { min-height: 0 !important; border: 0 !important; background: transparent !important; }
    .communication-hub.has-area-error .hub-body > * { display: none !important; }
    .communication-hub .hub-warning:not(.danger) { align-items: center; padding: 14px; }
    .communication-hub .hub-warning:not(.danger) > div { min-width: 0; flex: 1; }
    .communication-hub .fc-inline-retry { display: inline-flex; min-height: 36px; align-items: center; justify-content: center; flex: none; padding: 0 12px; border: 1px solid rgba(255,191,92,.45); border-radius: 8px; background: rgba(255,191,92,.08); color: #f6c75c; font: inherit; font-size: 9px; font-weight: 750; cursor: pointer; }
    @media (max-width: 760px) {
      .communication-hub { gap: 12px !important; padding-bottom: 112px !important; }
      .communication-hub .studio-intro { align-items: flex-start !important; min-height: 0 !important; gap: 12px !important; padding-bottom: 0 !important; }
      .communication-hub .studio-intro > div:first-child { width: 100%; }
      .communication-hub .studio-intro h2 { font-size: 20px !important; }
      .communication-hub .hub-header-actions { display: grid !important; width: 100%; grid-template-columns: auto 1fr; gap: 8px; }
      .communication-hub .hub-header-actions > span { grid-column: 1; align-self: center; }
      .communication-hub .hub-header-actions > .button:nth-of-type(1) { display: none !important; }
      .communication-hub .hub-header-actions > .button:last-child { grid-column: 2; min-height: 40px; }
      .communication-hub .hub-tabs { margin: 0 -12px !important; padding: 0 12px; border-right: 0; border-left: 0; border-radius: 0 !important; scroll-padding-inline: 12px; }
      .communication-hub .hub-tabs button { min-width: 132px !important; min-height: 48px; padding: 0 10px; }
      .communication-hub .hub-body { min-height: 330px; border-radius: 12px; }
      .communication-hub.has-area-error .hub-warning:not(.danger) { align-items: flex-start; flex-wrap: wrap; }
      .communication-hub.has-area-error .fc-inline-retry { width: 100%; }
      .communication-hub .hub-updated { margin-top: -4px; text-align: left; }
    }
  `;
  let workspaceFixRoot = null;
  let workspaceShadowObserver = null;
  let lastWorkspaceResumeAt = 0;

  function bridgeTechnicalLog(level, source, event, message, meta = {}) {
    try {
      const current = JSON.parse(localStorage.getItem(TECHNICAL_LOG_KEY) || "[]");
      const logs = Array.isArray(current) ? current : [];
      const safeMeta = Object.fromEntries(Object.entries(meta || {}).filter(([key]) => !/cookie|token|password|authorization|headers?|body|payload/i.test(key)).slice(0, 18));
      const entry = {
        id: `bridge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        at: new Date().toISOString(), level, source, event,
        message: String(message || "Sem detalhe").slice(0, 700), meta: safeMeta, version: RELEASE_ENGINE_VERSION,
      };
      localStorage.setItem(TECHNICAL_LOG_KEY, JSON.stringify([...logs, entry].slice(-1000)));
      document.dispatchEvent(new CustomEvent("followcheck:technical-log:updated", { detail: entry.id }));
    } catch {}
  }

  async function syncBackgroundTechnicalLogs() {
    try {
      const response = await browser.runtime.sendMessage({ type: "FOLLOWCHECK_TECHNICAL_LOGS_GET" });
      if (!response?.ok || !Array.isArray(response.logs)) return false;
      const local = JSON.parse(localStorage.getItem(TECHNICAL_LOG_KEY) || "[]");
      const merged = [...(Array.isArray(local) ? local : []), ...response.logs];
      const unique = [...new Map(merged.map((entry) => [entry.id || `${entry.at}:${entry.source}:${entry.event}:${entry.message}`, entry])).values()]
        .sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0))
        .slice(-1000);
      localStorage.setItem(TECHNICAL_LOG_KEY, JSON.stringify(unique));
      document.dispatchEvent(new CustomEvent("followcheck:technical-log:updated"));
      return true;
    } catch {
      return false;
    }
  }

  function requestMainPageExecutor(operation, payload = {}, timeoutMs = 20000) {
    const requestId = `fc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        document.removeEventListener(PAGE_RESPONSE_EVENT, onResponse);
        globalThis.clearTimeout(timer);
      };
      const onResponse = (event) => {
        let message;
        try { message = JSON.parse(String(event.detail || "")); } catch { return; }
        if (message?.requestId !== requestId || settled) return;
        settled = true;
        cleanup();
        if (message.bridgeOk) resolve(message.result);
        else reject(Object.assign(new Error(message.error?.message || "O executor da página falhou."), message.error || {}));
      };
      const timer = globalThis.setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        document.dispatchEvent(new CustomEvent(PAGE_CANCEL_EVENT, { detail: requestId }));
        reject(Object.assign(new Error("O executor autenticado excedeu o tempo limite."), { code: "page_main_timeout" }));
      }, Math.max(3000, Math.min(45000, Number(timeoutMs) || 20000)));
      document.addEventListener(PAGE_RESPONSE_EVENT, onResponse);
      document.dispatchEvent(new CustomEvent(PAGE_REQUEST_EVENT, {
        detail: JSON.stringify({ requestId, operation, ...payload }),
      }));
    });
  }

  function retryAfterSeconds(value, now = Date.now()) {
    const raw = String(value ?? "").trim();
    if (!raw) return 0;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
    const date = Date.parse(raw);
    if (!Number.isFinite(date) || date <= now) return 0;
    return Math.max(1, Math.ceil((date - now) / 1000));
  }

  function cookie(name) {
    const match = document.cookie.match(
      new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`),
    );
    return match?.[1] ? decodeURIComponent(match[1]) : "";
  }

  function readNativeMonitorStatus() {
    try {
      const status = JSON.parse(
        localStorage.getItem("followcheck:native-monitor-status") || "null",
      );
      if (!status || !COMPATIBLE_ENGINE_VERSIONS.has(status.engineVersion)) return null;
      return status;
    } catch {
      return null;
    }
  }

  function storeNativeMonitorStatus(value) {
    let status = value && typeof value === "object" ? { ...value } : null;
    if (!status || !COMPATIBLE_ENGINE_VERSIONS.has(status.engineVersion)) return false;
    const nativeCoreVersion = String(status.appVersion || "unknown");
    status.nativeCoreVersion = nativeCoreVersion;
    status.appVersion = nativeCoreVersion === RELEASE_PACKAGE_VERSION
      ? RELEASE_PACKAGE_VERSION
      : `${RELEASE_PACKAGE_VERSION} (núcleo ${nativeCoreVersion})`;
    status.extensionVersion = EXPECTED_UI_VERSION;
    status.engineVersion = RELEASE_ENGINE_VERSION;
    try {
      const previous = readNativeMonitorStatus();
      const sameAccount = previous?.accountId && String(previous.accountId) === String(status.accountId || "");
      if (sameAccount && !String(status.profilePicUrl || status.profile_pic_url || "").trim() && (previous.profilePicUrl || previous.profile_pic_url)) {
        status.profilePicUrl = previous.profilePicUrl || previous.profile_pic_url;
        status.profile_pic_url = previous.profile_pic_url || previous.profilePicUrl;
      }
      localStorage.setItem("followcheck:native-monitor-status", JSON.stringify(status));
      if (status.lastErrorCode && (status.lastErrorCode !== previous?.lastErrorCode || status.lastRunAt !== previous?.lastRunAt)) {
        bridgeTechnicalLog("error", "android-monitor", "monitor-error", status.lastError || status.lastErrorCode, {
          code: status.lastErrorCode,
          running: Boolean(status.running),
          lastRunAt: status.lastRunAt || "",
          username: status.username || "",
        });
      }
      globalThis.dispatchEvent(new CustomEvent(
        "followcheck:native-monitor-status",
        { detail: status },
      ));
      return true;
    } catch {
      return false;
    }
  }

  function resolveActiveAccountId() {
    const cookieAccountId = cookie("ds_user_id");
    if (cookieAccountId) return cookieAccountId;
    if (globalThis.__FOLLOWCHECK_IOS_SHELL__) return "";
    const status = readNativeMonitorStatus();
    const accountId = String(status?.accountId || "").trim();
    return accountId && !["signed_out", "expired"].includes(status?.authState)
      ? accountId
      : "";
  }

  if (localStorage.getItem("followcheck:native-monitor-status") && !readNativeMonitorStatus()) {
    localStorage.removeItem("followcheck:native-monitor-status");
  }


  function instagramAjaxToken() {
    const candidates = [
      document.querySelector('meta[name="x-instagram-ajax"]')?.content,
      globalThis._sharedData?.rollout_hash,
      globalThis.__initialData?.data?.rollout_hash,
      globalThis.__initialData?.rollout_hash,
    ];
    return String(candidates.find((value) => /^[a-zA-Z0-9._:-]{3,160}$/.test(String(value || ""))) || "");
  }

  function monitorRequestedAccountId(url) {
    const rest = url.pathname.match(/^\/api\/v1\/friendships\/(\d{1,32})\/(?:followers|following)\/$/i);
    if (rest) return rest[1];
    if (url.pathname !== "/graphql/query/") return "";
    try {
      const variables = JSON.parse(url.searchParams.get("variables") || "{}");
      return String(variables?.id || "");
    } catch {
      return "";
    }
  }

  function readStored(scope, key, fallback) {
    try {
      const raw = localStorage.getItem(`followcheck:v3:account:${scope}:${key}`);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed?.version === 3 ? parsed.data : fallback;
    } catch {
      return fallback;
    }
  }

  function normalizeAudienceUser(user = {}) {
    const fullName = String(user.full_name || user.fullName || "");
    const profilePicUrl = String(
      user.profile_pic_url
      || user.profilePicUrl
      || user.profile_pic_url_hd
      || user.hd_profile_pic_url_info?.url
      || "",
    );
    const isPrivate = Boolean(user.is_private ?? user.isPrivate);
    const isVerified = Boolean(user.is_verified ?? user.isVerified);
    return {
      ...user,
      full_name: fullName,
      fullName,
      profile_pic_url: profilePicUrl,
      profilePicUrl,
      is_private: isPrivate,
      isPrivate,
      is_verified: isVerified,
      isVerified,
    };
  }

  const ACCOUNT_STORAGE_KEYS = [
    "account-identity", "audience", "protected", "history", "snapshots",
    "profile-meta", "content-items", "workspace", "operation-draft",
    "automation-campaigns", "safety-state", "cleanup-decisions",
    "relationship-analysis", "relationship-decisions", "relationship-preferences",
    "relationship-history", "relationship-live-facts", "relationship-conversation-facts",
    "relationship-engagement-facts", "relationship-zernio-facts",
    "relationship-protection-overrides", "inbox-cleanup-job",
  ];

  function accountStorageKey(scope, key) {
    return `followcheck:v3:account:${String(scope || "").trim()}:${key}`;
  }

  function migrateLegacyProfileScope(accountId, profileId) {
    const targetScope = String(accountId || "").trim();
    const sourceScope = String(profileId || "").trim();
    if (!targetScope || !sourceScope || sourceScope === targetScope) return;
    const identity = readStored(sourceScope, "account-identity", null);
    const explicitIdentity = String(identity?.userId || identity?.accountId || "").trim();
    if (explicitIdentity && explicitIdentity !== targetScope) return;
    const migrationMarker = `followcheck:migration:profile-scope:${sourceScope}:${targetScope}`;
    try {
      if (localStorage.getItem(migrationMarker) === "done") return;
      ACCOUNT_STORAGE_KEYS.forEach((key) => {
        const targetKey = accountStorageKey(targetScope, key);
        const sourceKey = accountStorageKey(sourceScope, key);
        if (!localStorage.getItem(targetKey) && localStorage.getItem(sourceKey)) {
          localStorage.setItem(targetKey, localStorage.getItem(sourceKey));
        }
      });
      localStorage.setItem(migrationMarker, "done");
    } catch {
      // A migração é conservadora: dados atuais nunca são substituídos.
    }
  }

  function persistAudienceResult(message, source = "monitor-replay") {
    const activeAccountId = resolveActiveAccountId();
    const accountId = String(message?.accountId || "").trim();
    const completedAt = String(message?.completedAt || "").trim();
    const completedTime = Date.parse(completedAt);
    const complete = message?.complete !== false;
    const audience = Array.isArray(message?.audience)
      ? message.audience.map(normalizeAudienceUser)
      : [];
    if (!accountId) return { ok: false, error: "account_missing" };
    if (!complete || !Number.isFinite(completedTime)) {
      return { ok: false, error: "snapshot_incomplete" };
    }
    const current = readStored(accountId, "audience", { users: [], completedAt: "" });
    const currentTime = Date.parse(current?.completedAt || "");
    if (Number.isFinite(currentTime) && currentTime > completedTime) {
      return { ok: true, stale: true, accountId, completedAt: new Date(currentTime).toISOString(), count: Array.isArray(current?.users) ? current.users.length : 0, persisted: true };
    }
    try {
      localStorage.setItem(
        accountStorageKey(accountId, "audience"),
        JSON.stringify({
          version: 3,
          data: { users: audience, completedAt: new Date(completedTime).toISOString() },
        }),
      );
      const active = activeAccountId === accountId;
      if (active) {
        globalThis.dispatchEvent(new CustomEvent("followcheck:native-audience-result", {
          detail: {
            accountId,
            audience,
            completedAt: new Date(completedTime).toISOString(),
            complete: true,
            source,
          },
        }));
      }
      return { ok: true, accountId, completedAt: new Date(completedTime).toISOString(), count: audience.length, persisted: true, dispatched: active, deferred: !active };
    } catch {
      return { ok: false, error: "storage_failed" };
    }
  }

  async function replayMonitorAudience(accountId, source = "monitor-replay") {
    const safeAccountId = String(accountId || "").trim();
    if (!safeAccountId || safeAccountId !== resolveActiveAccountId()) return null;
    const result = await browser.runtime.sendMessage({
      type: "FOLLOWCHECK_MONITOR_AUDIENCE_REPLAY",
      accountId: safeAccountId,
    }).catch(() => null);
    if (!result?.ok || !result?.snapshot) return result;
    return persistAudienceResult(result.snapshot, source);
  }

  function workspaceHealth() {
    const host = document.getElementById("followcheck-app-host");
    const root = host?.shadowRoot;
    const shell = root?.querySelector(".app-shell.v3-shell");
    const navigation = root?.querySelectorAll(".v7-sidebar .nav-list button");
    const state = String(host?.dataset.followcheckState || "absent");
    const mountedAt = Number(host?.dataset.followcheckMountedAt || 0);
    const ageMs = mountedAt > 0 ? Math.max(0, Date.now() - mountedAt) : -1;
    const currentHost = Boolean(
      host?.isConnected && host.dataset.followcheckVersion === EXPECTED_UI_VERSION
    );
    const mounting = Boolean(
      currentHost
      && ["mounting", "recovering"].includes(state)
      && ageMs >= 0
      && ageMs < WORKSPACE_MOUNT_GRACE_MS
    );
    const open = Boolean(
        host?.isConnected
        && host.dataset.followcheckVersion === EXPECTED_UI_VERSION
        && state === "ready"
        && root
        && shell
        && navigation?.length >= 5
    );
    return {
      open,
      mounting,
      recover: Boolean(host && !open && !mounting),
      state,
      ageMs,
      host,
    };
  }

  function installWorkspaceFixes() {
    const root = document.getElementById("followcheck-app-host")?.shadowRoot;
    if (!root) return false;
    if (!root.getElementById(WORKSPACE_FIX_STYLE_ID)) {
      const style = document.createElement("style");
      style.id = WORKSPACE_FIX_STYLE_ID;
      style.textContent = WORKSPACE_FIX_CSS;
      root.append(style);
    }
    const hub = root.querySelector(".communication-hub");
    const warning = hub?.querySelector(".hub-warning:not(.danger)");
    hub?.classList.toggle("has-area-error", Boolean(warning));
    if (warning && !warning.querySelector(".fc-inline-retry")) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "fc-inline-retry";
      button.textContent = "Tentar novamente";
      button.addEventListener("click", () => hub.querySelector(".hub-header-actions .button:last-child")?.click());
      warning.append(button);
    }
    if (workspaceFixRoot !== root) {
      workspaceFixRoot = root;
      workspaceShadowObserver?.disconnect();
      workspaceShadowObserver = new MutationObserver(() => installWorkspaceFixes());
      workspaceShadowObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
    }
    return true;
  }

  function reconcileWorkspaceViewport(reason = "resume") {
    const { host } = workspaceHealth();
    if (host) {
      const measuredHeight = Math.round(
        globalThis.visualViewport?.height
        || document.documentElement?.clientHeight
        || globalThis.innerHeight
        || 0,
      );
      const measuredWidth = Math.round(
        globalThis.visualViewport?.width
        || document.documentElement?.clientWidth
        || globalThis.innerWidth
        || 0,
      );
      const previousHeight = Number.parseFloat(
        host.style.getPropertyValue("--fc-app-height") || "0",
      );
      // Gecko's off-screen background surface may briefly report a 1×1
      // viewport while the Activity is stopped. Never persist that transient
      // compositor size into the visible App Shell.
      const height = measuredHeight >= 240
        ? measuredHeight
        : previousHeight >= 240
          ? previousHeight
          : 640;
      const previousWidth = Number.parseFloat(host.style.getPropertyValue("--fc-app-width") || "0");
      const width = measuredWidth >= 280 ? measuredWidth : previousWidth >= 280 ? previousWidth : 360;
      host.style.cssText = "position:fixed;inset:0;top:0;right:0;bottom:0;left:0;z-index:2147483647;width:100%;height:100%;min-width:0;max-width:none;max-height:none;overflow:auto;overscroll-behavior:contain;background:#090b0f;transform:none;zoom:1;";
      host.style.setProperty("--fc-app-height", `${height}px`);
      host.style.setProperty("--fc-app-width", `${width}px`);
      host.scrollLeft = 0;
    }
    const now = Date.now();
    if (now - lastWorkspaceResumeAt < 1200) return;
    lastWorkspaceResumeAt = now;
    globalThis.dispatchEvent(new CustomEvent("followcheck:workspace-resume", {
      detail: { reason, accountId: resolveActiveAccountId() },
    }));
  }

  function migrateStoredAudienceSchema() {
    const accountId = resolveActiveAccountId();
    if (!accountId) return;
    const key = `followcheck:v3:account:${accountId}:audience`;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.version !== 3 || !Array.isArray(parsed?.data?.users)) return;
      let changed = false;
      const users = parsed.data.users.map((user) => {
        if (user && (
          (!user.profile_pic_url && user.profilePicUrl)
          || (!user.full_name && user.fullName)
          || (user.is_private == null && user.isPrivate != null)
          || (user.is_verified == null && user.isVerified != null)
        )) changed = true;
        return normalizeAudienceUser(user);
      });
      if (!changed) return;
      localStorage.setItem(key, JSON.stringify({
        ...parsed,
        data: { ...parsed.data, users },
      }));
    } catch {
      // A app continua a funcionar mesmo se um snapshot antigo estiver corrompido.
    }
  }

  migrateStoredAudienceSchema();

  function directReadRequest(input, init = {}) {
    const method = String(init?.method || input?.method || "GET").toUpperCase();
    if (method !== "GET") return null;
    let url;
    try {
      url = new URL(typeof input === "string" ? input : input?.url || "", location.href);
    } catch {
      return null;
    }
    if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return null;
    const inboxMatch = url.pathname.match(/^\/api\/v1\/direct_v2\/(pending_)?inbox\/$/i);
    if (inboxMatch) {
      return {
        operation: "read-inbox",
        kind: inboxMatch[1] ? "pending" : "inbox",
        cursor: String(url.searchParams.get("cursor") || "").slice(0, 1024),
        limit: Math.max(1, Math.min(50, Number(url.searchParams.get("limit")) || 20)),
      };
    }
    const threadMatch = url.pathname.match(/^\/api\/v1\/direct_v2\/threads\/(\d{1,40})\/$/i);
    if (threadMatch) {
      return {
        operation: "read-thread",
        threadId: threadMatch[1],
        limit: Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 50)),
      };
    }
    return null;
  }

  async function privateDirectFetch(input, init = {}) {
    const request = directReadRequest(input, init);
    if (!request) return nativeFetch(input, init);
    try {
      const operation = request.operation === "read-inbox"
        ? "direct-read-inbox"
        : "direct-read-thread";
      const result = await requestMainPageExecutor(operation, request, 30000);
      const payload = result?.data || {
        status: "fail",
        message: result?.message || "O Instagram não confirmou a leitura da Inbox.",
        error_type: result?.code || "instagram_direct_request_unconfirmed",
      };
      const status = Number(result?.status || (result?.ok ? 200 : 502));
      bridgeTechnicalLog(result?.ok ? "info" : "warn", "inbox", "single-page-read", result?.ok
        ? "A Inbox foi recebida pela sessão da página."
        : "A sessão da página não confirmou a Inbox; não foi feito qualquer fallback.", {
        status,
        operation,
        responseKind: result?.responseKind || "unknown",
        executor: result?.executor || "page-main",
      });
      return new Response(JSON.stringify(payload), {
        status: status >= 200 && status <= 599 ? status : 502,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-followcheck-executor": result?.executor || "page-main",
        },
      });
    } catch (error) {
      bridgeTechnicalLog("error", "inbox", "single-page-read-failed", error?.message || "A leitura única da Inbox falhou.", {
        code: error?.code || "page_main_failed",
        operation: request.operation,
      });
      const failure = new TypeError(error?.message || "A sessão da página não respondeu à leitura da Inbox.");
      failure.code = error?.code || "instagram_page_request_failed";
      throw failure;
    }
  }

  globalThis.fetch = (input, init) => privateDirectFetch(input, init);

  function buildNativeSnapshot() {
    const accountId = resolveActiveAccountId() || "signed-out";
    const audienceState = readStored(accountId, "audience", {
      users: [],
      completedAt: "",
    });
    const users = Array.isArray(audienceState?.users) ? audienceState.users : [];
    const identity = readStored(accountId, "account-identity", null);
    const protectedIds = readStored(accountId, "protected", []);
    const history = readStored(accountId, "history", []);
    const following = users.filter((user) => user?.followed_by_viewer === true).length;
    const followers = users.filter((user) => user?.follows_viewer === true).length;
    const mutuals = users.filter(
      (user) => user?.followed_by_viewer === true && user?.follows_viewer === true,
    ).length;
    const nonFollowers = users.filter(
      (user) => user?.followed_by_viewer === true && user?.follows_viewer === false,
    ).length;
    const fans = users.filter(
      (user) => user?.followed_by_viewer === false && user?.follows_viewer === true,
    ).length;
    const healthScore = following
      ? Math.max(0, Math.min(100, Math.round(100 - ((nonFollowers / following) * 55))))
      : 0;
    return {
      accountId: accountId === "signed-out" ? "" : accountId,
      username: String(identity?.username || ""),
      lastScanAt: String(audienceState?.completedAt || ""),
      audience: users.length,
      followers,
      following,
      mutuals,
      nonFollowers,
      fans,
      protectedCount: Array.isArray(protectedIds) ? protectedIds.length : 0,
      historyCount: Array.isArray(history) ? history.length : 0,
      healthScore,
      updatedAt: users.length || audienceState?.completedAt ? Date.now() : 0,
    };
  }

  function navigateNativeView(view) {
    const root = document.getElementById("followcheck-app-host")?.shadowRoot;
    if (!root) return false;
    if (String(view) === "advanced-settings") {
      globalThis.dispatchEvent(new CustomEvent("followcheck:open-advanced-settings"));
      return true;
    }
    const settingsModal = root.querySelector(".v7-settings-modal");
    if (String(view) === "settings" && settingsModal) return true;
    if (settingsModal) {
      settingsModal.querySelector("[aria-label='Fechar']")?.click();
    }
    const labels = {
      overview: ["Início", "Overview"],
      home: ["Início", "Overview"],
      watchlist: ["Watchlist"],
      tools: ["Tools", "Ferramentas"],
      more: ["Tools", "Ferramentas"],
      cleanup: ["Cleanup"],
      relations: ["Cleanup"],
      crm: ["Inbox"],
      inbox: ["Inbox"],
      content: ["Conteúdo", "Content"],
      analytics: ["Analytics"],
      operations: ["Atividade", "Operações", "Operations"],
      activity: ["Atividade", "Operações", "Operations"],
      automations: ["Automações", "Automations"],
      settings: ["Definições", "Settings"],
    };
    const wanted = labels[String(view || "tools")] || labels.tools;
    const candidates = [
      ...root.querySelectorAll("button, a, [role='button']"),
    ];
    const target = candidates.find((element) => {
      const text = String(element.textContent || "").replace(/\s+/g, " ").trim();
      return wanted.some((label) => text === label || text.startsWith(`${label} `));
    });
    if (!target) return false;
    target.click();
    return true;
  }

  async function reportSession() {
    const expectedUserId = cookie("ds_user_id");
    const status = readNativeMonitorStatus() || {};
    const snapshot = buildNativeSnapshot();
    const userId = String(expectedUserId || status.accountId || snapshot.accountId || "");
    const identity = userId ? readStored(userId, "account-identity", {}) : {};
    const username = String(identity?.username || status.username || snapshot.username || "");
    const fullName = String(identity?.fullName || status.fullName || "");
    let profilePicUrl = String(identity?.profilePicUrl || status.profilePicUrl || status.profile_pic_url || "").slice(0, 2000);
    const loginRoute = /\/accounts\/(?:login|challenge|checkpoint|onetap)|\/challenge\//i.test(location.pathname);
    const authenticatedShell = Boolean(document.querySelector?.(
      'a[href^="/direct/"],a[href^="/accounts/edit"],a[href^="/explore/"],a[href^="/reels/"],nav,[role="navigation"]',
    ));
    const connected = Boolean(userId && !loginRoute && (authenticatedShell || expectedUserId));
    if (userId && username) {
      try {
        localStorage.setItem(
          `followcheck:v3:account:${userId}:account-identity`,
          JSON.stringify({
            version: 3,
            data: { userId, username, fullName, profilePicUrl, connected, verifiedAt: Date.now(), confirmation: "local-page-state" },
          }),
        );
      } catch {
        // O nome continua a ser entregue ao Android mesmo sem armazenamento local.
      }
    }

    // Keep the canonical CDN URL in the native account registry. Shipping a
    // large data URL through extension/native messages could exceed the Gecko
    // bridge payload and was the reason otherwise valid avatars disappeared.
    // The React Avatar component performs a bounded extension proxy only when
    // the normal <img> load fails, without replacing this durable URL.
    profilePicUrl = String(profilePicUrl || "").slice(0, 2000);

    browser.runtime.sendMessage({
      type: "FOLLOWCHECK_PAGE_SESSION_STATE",
      connected,
      userId,
      username,
      fullName,
      profilePicUrl,
      reason: loginRoute ? "logout_confirmed" : connected ? "local_page_state" : "session_unverified",
      logoutConfirmed: loginRoute,
    }).catch(() => {});
  }

  let reportedLoginError = false;
  let reportedSafetyWarning = false;
  let lastSafetyInspectionAt = 0;
  function inspectInstagramSafetyWarning() {
    if (reportedSafetyWarning || Date.now() - lastSafetyInspectionAt < 500) return false;
    lastSafetyInspectionAt = Date.now();
    const visibleText = String(document.body?.innerText || "").slice(0, 60000);
    if (!/(?:your\s+(?:account|email)\s+may\s+(?:not\s+be\s+secure|be\s+at\s+risk)|we\s+suspect\s+automated\s+behavio(?:u)?r|couldn['’]?t\s+create\s+multiple\s+sessions|secure\s+your\s+account|suspicious\s+(?:activity|login)|comportamento\s+automatizado|múltiplas\s+sessões|(?:conta|e-?mail).{0,45}(?:em\s+risco|comprometid))/i.test(visibleText)) return false;
    reportedSafetyWarning = true;
    bridgeTechnicalLog("error", "instagram-page", "security-warning-visible", "Aviso de segurança Instagram detetado. Todos os pedidos foram bloqueados.", {
      path: location.pathname,
      visibility: document.visibilityState,
    });
    browser.runtime.sendMessage({
      type: "FOLLOWCHECK_SECURITY_WARNING",
      reason: "instagram_security_warning",
      path: location.pathname,
    }).catch(() => {});
    return true;
  }

  function inspectLoginError() {
    if (reportedLoginError) return;
    const dialogs = [...document.querySelectorAll("[role='dialog']")];
    const errorDialog = dialogs.find((dialog) => {
      const value = String(dialog.innerText || dialog.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      return /(unable|couldn['’]?t|não foi possível).{0,30}(log in|iniciar sessão)/i.test(value)
        || /(unexpected error|erro inesperado)/i.test(value);
    });
    if (!errorDialog) return;
    reportedLoginError = true;
    const message = String(errorDialog.innerText || errorDialog.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220);
    browser.runtime.sendMessage({
      type: "FOLLOWCHECK_LOGIN_ERROR",
      message,
    }).catch(() => {});
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === "FOLLOWCHECK_SESSION_IDENTITY") {
      const identity = message.identity || {};
      const userId = String(identity.userId || "");
      if (/^\d{1,32}$/.test(userId) && identity.username) {
        try {
          localStorage.setItem(
            `followcheck:v3:account:${userId}:account-identity`,
            JSON.stringify({
              version: 3,
              data: {
                userId,
                username: String(identity.username || ""),
                fullName: String(identity.fullName || ""),
                profilePicUrl: String(identity.profilePicUrl || ""),
                connected: true,
                verifiedAt: Date.now(),
                confirmation: "page-profile-hydration",
              },
            }),
          );
        } catch {
          // O registo Android continua autoritativo se o armazenamento web falhar.
        }
        reportSession();
      }
      return { ok: true };
    }
    if (message?.type === "FOLLOWCHECK_PAGE_EXECUTOR_REQUEST") {
      return requestMainPageExecutor(message.operation, message.payload || {}, message.timeoutMs)
        .then((result) => ({ ok: true, result }))
        .catch((error) => ({ ok: false, error: { diagnostics: error?.diagnostics || {}, code: String(error?.code || "page_main_failed"), message: String(error?.message || "Falha no executor da página.").slice(0, 260) } }));
    }
    if (message?.type === "FOLLOWCHECK_MONITOR_FETCH") {
      return (async () => {
        let url;
        try { url = new URL(String(message.url || ""), location.href); } catch { return { handled: false }; }
        if (url.origin !== "https://www.instagram.com") return { handled: false };
        const restAllowed = /^\/api\/v1\/friendships\/\d{1,32}\/(followers|following)\/$/i.test(url.pathname);
        const relationshipAllowed = /^\/api\/v1\/friendships\/show\/\d{1,32}\/$/i.test(url.pathname);
        const profileAllowed = url.pathname === "/api/v1/users/web_profile_info/"
          && /^[A-Za-z0-9._]{1,80}$/.test(String(url.searchParams.get("username") || ""));
        if (!restAllowed && !relationshipAllowed && !profileAllowed) return { handled: false };

        // The account encoded in a followers/following URL is the profile being
        // inspected, not the signed-in viewer. Requiring both IDs to match made
        // every Watchlist target other than the user's own account bypass the
        // authenticated Gecko tab and eventually fail on the hidden HttpOnly
        // session cookie. Validate the viewer separately and allow read-only
        // requests for public profiles or profiles visible to that viewer.
        const requestedTargetAccountId = monitorRequestedAccountId(url);
        const expectedViewerUserId = String(message.viewerUserId || "");
        const activeViewerUserId = resolveActiveAccountId();
        if (expectedViewerUserId && activeViewerUserId && expectedViewerUserId !== activeViewerUserId) {
          return {
            handled: false,
            reason: "viewer_account_mismatch",
            requestedTargetAccountId,
          };
        }

        const csrf = cookie("csrftoken");
        const ajax = instagramAjaxToken();
        const claim = cookie("www-claim-v2");
        const controller = new AbortController();
        const timeout = globalThis.setTimeout(() => controller.abort(), 30000);
        let response;
        try {
          response = await nativeFetch(url.href, {
            method: "GET",
            credentials: "include",
            cache: "no-store",
            redirect: "follow",
            referrer: location.href,
            referrerPolicy: "strict-origin-when-cross-origin",
            signal: controller.signal,
            headers: {
              accept: "*/*",
              "x-ig-app-id": "936619743392459",
              "x-asbd-id": "129477",
              "x-requested-with": "XMLHttpRequest",
              ...(csrf ? { "x-csrftoken": csrf } : {}),
              ...(ajax ? { "x-instagram-ajax": ajax } : {}),
              ...(claim ? { "x-ig-www-claim": claim } : {}),
            },
          });
        } finally {
          globalThis.clearTimeout(timeout);
        }
        return {
          handled: true,
          ok: response.ok,
          status: response.status,
          redirected: response.redirected,
          contentType: String(response.headers.get("content-type") || "").slice(0, 160),
          retryAfter: retryAfterSeconds(response.headers.get("retry-after")),
          finalUrl: String(response.url || url.href).slice(0, 4000),
          text: (await response.text().catch(() => "")).slice(0, 4000000),
        };
      })().catch((error) => ({ handled: false, ok: false, status: 0, error: String(error?.message || "fetch_failed").slice(0, 180), text: "" }));
    }
    if (message?.type === "FOLLOWCHECK_NATIVE_SNAPSHOT_REQUEST") {
      return Promise.resolve({ ok: true, snapshot: buildNativeSnapshot() });
    }
    if (message?.type === "FOLLOWCHECK_NATIVE_OPEN") {
      return (async () => {
        if (message.monitorStatus) {
          try {
            const accountId = String(message.monitorStatus.accountId || "").trim();
            migrateLegacyProfileScope(accountId, message.monitorStatus.profileId);
            storeNativeMonitorStatus(message.monitorStatus);
            await replayMonitorAudience(accountId, "monitor-open-replay");
          } catch {}
        }
        reconcileWorkspaceViewport("native-open");
        const health = workspaceHealth();
        if (health.open && message.view) {
          globalThis.setTimeout(() => navigateNativeView(message.view), 40);
        }
        return {
          ok: true,
          open: health.open,
          mounting: health.mounting,
          recover: health.recover,
          state: health.state,
          ageMs: health.ageMs,
        };
      })();
    }
    if (message?.type === "FOLLOWCHECK_NATIVE_MONITOR_STATUS") {
      return (async () => {
        const stored = storeNativeMonitorStatus(message.monitorStatus);
        await syncBackgroundTechnicalLogs();
        const accountId = String(message.monitorStatus?.accountId || "").trim();
        if (stored && accountId) {
          migrateStoredAudienceSchema();
          await replayMonitorAudience(accountId, "monitor-status-replay");
        }
        return { ok: stored };
      })();
    }
    if (message?.type === "FOLLOWCHECK_MONITOR_PROGRESS") {
      const progress = { ...(message.progress || {}), active: message.progress?.active !== false };
      try {
        if (progress.active) {
          localStorage.setItem("followcheck:native-monitor-progress", JSON.stringify(progress));
          if (Number(progress.percentage || 0) <= 2) localStorage.setItem(TECHNICAL_LOG_RUN_START_KEY, new Date().toISOString());
        } else {
          localStorage.removeItem("followcheck:native-monitor-progress");
        }
      } catch {}
      bridgeTechnicalLog(progress.active ? "info" : progress.phase === "error" ? "error" : "info", "monitor-progress", progress.phase || (progress.active ? "running" : "stopped"), progress.title || "Progresso do monitor", {
        detail: progress.detail || "", percentage: Number(progress.percentage || 0), active: progress.active,
      });
      globalThis.dispatchEvent(new CustomEvent("followcheck:native-monitor-progress", {
        detail: progress,
      }));
      return Promise.resolve({ ok: true });
    }
    if (message?.type === "FOLLOWCHECK_NATIVE_BACK") {
      globalThis.dispatchEvent(new CustomEvent("followcheck:native-back"));
      return Promise.resolve({ ok: true });
    }
    if (message?.type === "FOLLOWCHECK_NATIVE_CLOSE") {
      try {
        if (typeof globalThis.__FOLLOWCHECK_UNMOUNT__ === "function") {
          globalThis.__FOLLOWCHECK_UNMOUNT__();
        } else {
          document.getElementById("followcheck-app-host")?.remove();
        }
      } catch {
        document.getElementById("followcheck-app-host")?.remove();
      }
      return Promise.resolve({ ok: true });
    }
    if (message?.type === "FOLLOWCHECK_NATIVE_NAVIGATE") {
      return Promise.resolve({
        ok: navigateNativeView(message.view),
      });
    }
    if (message?.type === "FOLLOWCHECK_MONITOR_AUDIENCE_RESULT") {
      return Promise.resolve(persistAudienceResult(message, "monitor-live"));
    }
    if (message?.type === "FOLLOWCHECK_NATIVE_STATUS_PROBE") {
      const state = globalThis.__FOLLOWCHECK_PROGRESS_SNAPSHOT__?.() || {
        phase: "idle",
        active: false,
        title: "FollowCheck pronto",
        detail: "Sem operações ativas",
        percentage: -1,
      };
      return Promise.resolve({ ok: true, state });
    }
    return undefined;
  });



  // 10.12.2 — Fresh-account guard. Gecko's global password provider can offer
  // credentials from another FollowCheck container. A new slot must start from an
  // empty form; only typing/pasting inside the credentials fields disables the guard.
  function installFreshAccountLoginGuard() {
    if (globalThis.__FOLLOWCHECK_IOS_SHELL__) return;
    const loginPath = /\/accounts\/(?:login|onetap)/i.test(location.pathname);
    if (!loginPath || cookie("ds_user_id")) return;

    let credentialsEdited = false;
    let guardActive = true;
    const isCredentialField = (node) => Boolean(node?.matches?.(
      'input[name="username"], input[autocomplete="username"], input[name="password"], input[autocomplete="current-password"], input[type="password"]',
    ));
    const markCredentialEdit = (event) => {
      if (event?.isTrusted && isCredentialField(event.target)) credentialsEdited = true;
    };
    ["keydown", "input", "paste", "beforeinput"].forEach((type) => {
      document.addEventListener(type, markCredentialEdit, true);
    });

    const fields = () => ({
      user: document.querySelector('input[name="username"], input[autocomplete="username"], input[type="text"]'),
      pass: document.querySelector('input[name="password"], input[autocomplete="current-password"], input[type="password"]'),
    });
    const assign = (input, value) => {
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      try { setter?.call(input, value); } catch { input.value = value; }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const clearUntouchedAutofill = () => {
      if (!guardActive || credentialsEdited || cookie("ds_user_id")) return;
      const { user, pass } = fields();
      if (user?.value) assign(user, "");
      if (pass?.value) assign(pass, "");
    };

    const stopAutomaticSubmit = (event) => {
      if (!guardActive || credentialsEdited || cookie("ds_user_id")) return;
      const { user, pass } = fields();
      if (!user?.value && !pass?.value) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      clearUntouchedAutofill();
      user?.focus?.();
    };
    document.addEventListener("submit", stopAutomaticSubmit, true);

    // One-tap pages sometimes render a saved-account CTA instead of normal inputs.
    // Route that CTA to "switch account" while this is a fresh FollowCheck slot.
    document.addEventListener("click", (event) => {
      if (!guardActive || credentialsEdited || cookie("ds_user_id")) return;
      const control = event.target?.closest?.('button, a, [role="button"]');
      if (!control) return;
      const text = String(control.textContent || "").replace(/\s+/g, " ").trim();
      if (!/(continue as|log in as|continuar como|iniciar sess[aã]o como)/i.test(text)) return;
      const switcher = [...document.querySelectorAll('button, a, [role="button"]')].find((node) => {
        const label = String(node.textContent || "").replace(/\s+/g, " ").trim();
        return /(switch accounts?|trocar de conta|mudar de conta|usar outra conta|log into another account)/i.test(label);
      });
      if (!switcher || switcher === control) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      switcher.click();
      globalThis.setTimeout(clearUntouchedAutofill, 80);
    }, true);

    let ticks = 0;
    const timer = globalThis.setInterval(() => {
      ticks += 1;
      if (credentialsEdited || cookie("ds_user_id") || ticks > 120) {
        guardActive = false;
        globalThis.clearInterval(timer);
        return;
      }
      clearUntouchedAutofill();
    }, 250);
    [40, 120, 350, 800, 1600, 3200, 6000, 10000].forEach((delay) => {
      globalThis.setTimeout(clearUntouchedAutofill, delay);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installFreshAccountLoginGuard, { once: true });
  } else {
    installFreshAccountLoginGuard();
  }

  browser.runtime.sendMessage({ type: "FOLLOWCHECK_PAGE_READY" }).catch(() => {});
  let loginErrorObserver = null;
  let loginErrorObserverTimeout = 0;
  const startLoginErrorObserver = () => {
    const loginRoute = /\/accounts\/(?:login|onetap)|\/challenge\//i.test(location.pathname);
    if (!loginRoute || !document.documentElement || loginErrorObserver) return;
    loginErrorObserver = new MutationObserver(() => {
      inspectLoginError();
      if (reportedLoginError) stopLoginErrorObserver();
    });
    loginErrorObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    loginErrorObserverTimeout = globalThis.setTimeout(stopLoginErrorObserver, 30_000);
  };
  const stopLoginErrorObserver = () => {
    loginErrorObserver?.disconnect();
    loginErrorObserver = null;
    if (loginErrorObserverTimeout) globalThis.clearTimeout(loginErrorObserverTimeout);
    loginErrorObserverTimeout = 0;
  };
  if (document.documentElement) startLoginErrorObserver();
  else document.addEventListener("DOMContentLoaded", startLoginErrorObserver, { once: true });
  globalThis.setTimeout(inspectLoginError, 500);

  reportSession();
  inspectInstagramSafetyWarning();
  installWorkspaceFixes();
  const workspaceFixObserver = new MutationObserver(() => {
    installWorkspaceFixes();
    inspectInstagramSafetyWarning();
  });
  const startWorkspaceFixObserver = () => workspaceFixObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  if (document.documentElement) startWorkspaceFixObserver();
  else document.addEventListener("DOMContentLoaded", startWorkspaceFixObserver, { once: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      reconcileWorkspaceViewport("visibility");
      reportSession();
      inspectInstagramSafetyWarning();
      replayMonitorAudience(resolveActiveAccountId(), "monitor-resume-replay").catch(() => {});
      installWorkspaceFixes();
    }
  });
  globalThis.addEventListener("pageshow", () => {
    reconcileWorkspaceViewport("pageshow");
    inspectInstagramSafetyWarning();
    replayMonitorAudience(resolveActiveAccountId(), "monitor-pageshow-replay").catch(() => {});
    installWorkspaceFixes();
  });
  globalThis.addEventListener("followcheck:workspace-ready", () => {
    // A monitor result may arrive while React is changing account scope. The
    // snapshot is already durable, so replay it only after the new workspace
    // has installed all of its listeners. This makes the first check atomic.
    replayMonitorAudience(resolveActiveAccountId(), "monitor-workspace-ready-replay").catch(() => {});
    installWorkspaceFixes();
  });
  globalThis.addEventListener("focus", () => reconcileWorkspaceViewport("focus"));
  globalThis.addEventListener("resize", () => reconcileWorkspaceViewport("resize"), { passive: true });
  globalThis.visualViewport?.addEventListener("resize", () => reconcileWorkspaceViewport("visual-viewport"), { passive: true });
})();
