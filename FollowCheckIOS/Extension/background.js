const INSTAGRAM_HOST = /(^|\.)instagram\.com$/i;
const AVATAR_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;
const AVATAR_MESSAGE = "FOLLOWCHECK_FETCH_AVATAR";
const ZERNIO_API_MESSAGE = "FOLLOWCHECK_ZERNIO_API";
const ZERNIO_CONFIG_MESSAGE = "FOLLOWCHECK_ZERNIO_CONFIG";
const ZERNIO_UPLOAD_PORT = "FOLLOWCHECK_ZERNIO_UPLOAD";
const PRIVATE_MEMORY_MESSAGE = "FOLLOWCHECK_PRIVATE_MEMORY";
const INSTAGRAM_PRIVATE_API_MESSAGE = "FOLLOWCHECK_INSTAGRAM_PRIVATE_API";
const INSTAGRAM_RELATIONSHIP_ACTION_MESSAGE = "FOLLOWCHECK_INSTAGRAM_RELATIONSHIP_ACTION";
const MOBILE_TOGGLE_MESSAGE = "FOLLOWCHECK_MOBILE_TOGGLE";
const BACKGROUND_TIMER_MESSAGE = "FOLLOWCHECK_BACKGROUND_TIMER";
const BACKGROUND_TIMER_CANCEL_MESSAGE = "FOLLOWCHECK_BACKGROUND_TIMER_CANCEL";
const NATIVE_APP = "followcheck_bridge";
const MOBILE_SCRIPT_FILES = ["keepalive-shim.js", "hardening.js", "followcheck.js"];
const PAGE_EXECUTOR_FILE = "page-executor.js";
const PRIVATE_MEMORY_PREFIX = "followcheck:relationship:memory:v2";
const ZERNIO_CONFIG_KEY = "followcheck:zernio:credentials";
const ZERNIO_API_BASE = "https://zernio.com/api";
const ZERNIO_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const ZERNIO_UPLOAD_MAX_BYTES = 350 * 1024 * 1024;
const MAX_AVATAR_BYTES = 512 * 1024;
const MAX_AVATAR_CACHE_ENTRIES = 120;
const INSTAGRAM_PRIVATE_API_BASE = "https://i.instagram.com";
const INSTAGRAM_WEB_API_BASE = "https://www.instagram.com";
const INSTAGRAM_MOBILE_APP_ID = "567067343352427";
const INSTAGRAM_WEB_APP_ID = "936619743392459";
const INSTAGRAM_ASBD_ID = "129477";
const INSTAGRAM_MOBILE_USER_AGENT = "Instagram 428.0.0.47.67 Android (34/14; 480dpi; 1344x2992; Google/google; Pixel 8 Pro; husky; husky; en_US; 961145276)";
const INSTAGRAM_BLOKS_VERSION = "7189b949425f9bf80ea8bd880cf5a3080b292d9b1c4b38a18d112f7c4b71e7a8";
const INSTAGRAM_COOKIE_URLS = [
  "https://www.instagram.com/",
  "https://i.instagram.com/",
];
const MONITOR_STORAGE_PREFIX = "followcheck:monitor:v1";
const MONITOR_FOLLOWING_QUERY_HASH = "3dec7e2c57367ef3da3d987d89f9dbc8";
const MONITOR_FOLLOWERS_QUERY_HASH = "c76146de99bb02f6415203be841dd25a";
const MONITOR_PAGE_SIZE = 100;
const DEFAULT_MONITOR_PACING = Object.freeze({
  globalGapMinutes: 60,
  manualRespectsGap: false,
  paceAfterFailure: false,
  pageDelayMinMs: 1300,
  pageDelayMaxMs: 2300,
  pauseEveryPages: 15,
  pauseDurationMs: 10000,
});
const LAST_INSTAGRAM_SESSION_STATE_KEY = "followcheck:last-instagram-session:v1";
const INSTAGRAM_IDENTITY_REFRESH_KEY = "followcheck:instagram-identity-refresh:v1";
const INSTAGRAM_IDENTITY_RETRY_MS = 15 * 60_000;
const WATCHLIST_REGISTRY_PREFIX = "followcheck:watchlist:registry:v2";
const WATCHLIST_ALARM = "followcheck-watchlist-due";
const WATCHLIST_NATIVE_MIGRATION_KEY = "followcheck:watchlist:native-migration:v1";
const BACKGROUND_TECHNICAL_LOG_KEY = "followcheck:technical-logs:background:v1";
const GLOBAL_SAFETY_KEY = "followcheck:global-safety:v1";
const GLOBAL_SAFETY_MIGRATION_KEY = "followcheck:global-safety:migration:v1";
const GLOBAL_SAFETY_VERSION = 2;
const GLOBAL_THROTTLE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
// After an Instagram limit without an explicit deadline (spam flag,
// feedback_required) no local preference may resume requests sooner than this.
// An explicit Retry-After from the server is authoritative instead.
const THROTTLE_DEFAULT_COOLDOWN_MS = 60 * 60 * 1000;
const THROTTLE_REASONS = ["rate_limited", "soft_throttle", "http_429"];
const GLOBAL_SCAN_BUDGET_KEY = "followcheck:global-scan-budget:v1";
const MONITOR_PACING_SETTINGS_KEY = "followcheck:monitor-pacing:v1";
const avatarCache = new Map();
const instagramDirectExecutorCache = new Map();
const backgroundTimers = new Map();
let nativePort = null;
let nativeReconnectTimer = null;
let nativeWatchlistStatusRevision = 0;
const nativeWatchlistStatusWaiters = new Set();
let sessionInspectionRunning = false;
let lastSessionInspectionAt = 0;
let instagramIdentityRefreshPromise = null;
let lastNativeSnapshotAt = 0;
let lastNativeStatusProbeAt = 0;
let lastNativeProgressSignature = "";
let monitorJobRunning = false;
let monitorJobStartedAt = 0;
let monitorJobToken = 0;
let monitorTransportTabId = null;
let monitorTransportCookieStoreId = "";
let monitorTransportViewerUserId = "";
let monitorPrivateSession = null;
let nativeOperationActive = false;
let watchlistActiveOwnerId = "";
let watchlistActiveTargetId = "";
let diagnosticCheckId = "";
let watchlistProgressWriteAt = 0;
let activeMonitorPacing = { ...DEFAULT_MONITOR_PACING };
let monitorSuccessfulPageCount = 0;

function safeBackgroundMeta(meta = {}, depth = 0) {
  if (depth > 5) return "[profundidade limitada]";
  if (meta == null || typeof meta === "boolean") return meta;
  if (typeof meta === "number") return Number.isFinite(meta) ? meta : null;
  if (typeof meta === "string") return backgroundRedact(meta, 500);
  if (Array.isArray(meta)) return meta.slice(0, 24).map(value => safeBackgroundMeta(value, depth + 1));
  if (typeof meta !== "object") return null;
  const forbidden = /cookie|token|password|passwd|authorization|headers?|body|payload|responseText|username|full_name|photo|pic_url|sessionid|secret/i;
  return Object.fromEntries(Object.entries(meta).filter(([key]) => !forbidden.test(key)).slice(0, 40)
    .map(([key, value]) => [key.slice(0, 80), safeBackgroundMeta(value, depth + 1)]));
}

function backgroundRedact(value, limit = 1200) {
  return String(value ?? "")
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+\/=:-]+/gi, "$1 [REMOVIDO]")
    .replace(/\b(sessionid|csrftoken|authorization|password|passwd|cookie|token)\b\s*[:=]\s*[^\s,;}&]+/gi, "$1=[REMOVIDO]")
    .replace(/([?&](?:sessionid|csrftoken|token|access_token|password)=)[^&\s]+/gi, "$1[REMOVIDO]")
    .slice(0, limit);
}

let backgroundLogWrites = Promise.resolve();
function backgroundLog(...args) {
  const pending = backgroundLogWrites.then(() => writeBackgroundLog(...args));
  backgroundLogWrites = pending.catch(() => null);
  return pending;
}
async function writeBackgroundLog(level, source, event, message, meta = {}) {
  try {
    const stored = await chrome.storage.local.get(BACKGROUND_TECHNICAL_LOG_KEY);
    const previous = Array.isArray(stored?.[BACKGROUND_TECHNICAL_LOG_KEY]) ? stored[BACKGROUND_TECHNICAL_LOG_KEY] : [];
    const entry = {
      id: `bg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      level: ["debug", "info", "warn", "error"].includes(level) ? level : "info",
      source: String(source || "background").slice(0, 60),
      event: String(event || "event").slice(0, 90),
      message: backgroundRedact(message || "Sem detalhe", 1200),
      meta: safeBackgroundMeta(meta),
      version: "10.20.8",
    };
    await chrome.storage.local.set({ [BACKGROUND_TECHNICAL_LOG_KEY]: [...previous, entry].slice(-1000) });
    return entry;
  } catch {
    return null;
  }
}

function normalizedSafetyState(value = {}) {
  const cooldownUntil = Math.max(0, Number(value.cooldownUntil || 0));
  const manualResetRequired = Boolean(value.manualResetRequired);
  const blocked = manualResetRequired || cooldownUntil > Date.now();
  return {
    version: GLOBAL_SAFETY_VERSION,
    blocked,
    manualResetRequired,
    reason: String(value.reason || "").slice(0, 100),
    message: String(value.message || "").slice(0, 300),
    triggeredAt: Math.max(0, Number(value.triggeredAt || 0)),
    cooldownUntil,
    serverCooldownUntil: Math.max(0, Number(value.serverCooldownUntil || 0)),
    resetAt: Math.max(0, Number(value.resetAt || 0)),
    source: String(value.source || "background").slice(0, 80),
  };
}

async function readGlobalSafetyState() {
  const stored = await chrome.storage.local.get(GLOBAL_SAFETY_KEY).catch(() => ({}));
  return normalizedSafetyState(stored?.[GLOBAL_SAFETY_KEY] || {});
}

async function publishGlobalSafetyState(state) {
  const normalized = normalizedSafetyState(state);
  nativePort?.postMessage({ event: "safety_state", safety: normalized });
  const tab = await getAnyInstagramTab().catch(() => null);
  if (tab?.id) {
    await chrome.tabs.sendMessage(tab.id, {
      type: "FOLLOWCHECK_SAFETY_STATE",
      safety: normalized,
    }).catch(() => null);
  }
  return normalized;
}

async function writeGlobalSafetyState(value, event = "safety-state-updated") {
  const state = normalizedSafetyState(value);
  await chrome.storage.local.set({ [GLOBAL_SAFETY_KEY]: state });
  if (state.blocked) await chrome.alarms?.clear?.(WATCHLIST_ALARM).catch(() => false);
  await backgroundLog(state.blocked ? "warn" : "info", "safety", event,
    state.blocked ? state.message || "Proteção global ativa." : "Proteção global desbloqueada.", {
      reason: state.reason,
      manualResetRequired: state.manualResetRequired,
      cooldownUntil: state.cooldownUntil,
      triggeredAt: state.triggeredAt,
      source: state.source,
    });
  return publishGlobalSafetyState(state);
}

async function ensureGlobalSafetyMigration() {
  const stored = await chrome.storage.local.get([GLOBAL_SAFETY_MIGRATION_KEY, GLOBAL_SAFETY_KEY]).catch(() => ({}));
  if (Number(stored?.[GLOBAL_SAFETY_MIGRATION_KEY] || 0) >= GLOBAL_SAFETY_VERSION) {
    return normalizedSafetyState(stored?.[GLOBAL_SAFETY_KEY] || {});
  }
  await chrome.storage.local.set({ [GLOBAL_SAFETY_MIGRATION_KEY]: GLOBAL_SAFETY_VERSION });
  if (globalThis.__FOLLOWCHECK_IOS_SHELL__) return publishGlobalSafetyState(normalizedSafetyState(stored?.[GLOBAL_SAFETY_KEY] || {}));
  return writeGlobalSafetyState({
    manualResetRequired: true,
    reason: "upgrade_safety_hold",
    message: "A atualização de segurança pausou todos os pedidos Instagram. Confirma primeiro a conta na app oficial e desbloqueia manualmente no Diagnóstico.",
    triggeredAt: Date.now(),
    cooldownUntil: 0,
    source: "upgrade-migration",
  }, "upgrade-safety-hold");
}

async function tripGlobalSafety(reason, message, options = {}) {
  const previous = await readGlobalSafetyState();
  const manualResetRequired = options.manualResetRequired !== false;
  let localDuration = GLOBAL_THROTTLE_COOLDOWN_MS;
  if (globalThis.__FOLLOWCHECK_IOS_SHELL__) {
    const stored = await chrome.storage.local.get('followcheck:ios:cooldown-minutes:v1');
    // The user's own choice decides the local pause; without one it is one hour.
    const minutes = Number(stored['followcheck:ios:cooldown-minutes:v1'] ?? THROTTLE_DEFAULT_COOLDOWN_MS / 60000);
    localDuration = (Number.isFinite(minutes) ? Math.max(1, Math.min(1440, minutes)) : 60) * 60000;
  }
  const serverCooldownUntil = Math.max(previous.serverCooldownUntil, Number(options.serverCooldownUntil || 0));
  const requestedUntil = globalThis.__FOLLOWCHECK_IOS_SHELL__ ? Date.now() + localDuration : Number(options.cooldownUntil || Date.now() + localDuration);
  const cooldownUntil = manualResetRequired
    ? Math.max(previous.cooldownUntil, Number(options.cooldownUntil || 0))
    : Math.max(previous.cooldownUntil, serverCooldownUntil, requestedUntil);
  return writeGlobalSafetyState({
    manualResetRequired: previous.manualResetRequired || manualResetRequired,
    reason: previous.manualResetRequired ? previous.reason : String(reason || "instagram_safety_stop"),
    message: previous.manualResetRequired ? previous.message : String(message || "O Instagram pediu uma pausa global."),
    triggeredAt: manualResetRequired ? previous.triggeredAt || Date.now() : Date.now(),
    cooldownUntil,
    serverCooldownUntil,
    source: String(options.source || "instagram-response"),
  }, "global-circuit-tripped");
}

async function resetGlobalSafetyState() {
  const state = await writeGlobalSafetyState({
    manualResetRequired: false,
    reason: "",
    message: "",
    triggeredAt: 0,
    cooldownUntil: 0,
    resetAt: Date.now(),
    source: "manual-reset",
  }, "global-circuit-reset");
  await scheduleWatchlistAlarm().catch(() => {});
  return state;
}

function isIOSLocalUpgradeHold(state) {
  return globalThis.__FOLLOWCHECK_IOS_SHELL__ && state.reason === "upgrade_safety_hold"
    && state.source === "upgrade-migration" && !(state.cooldownUntil > Date.now());
}
async function assertGlobalSafety(operation = "instagram-operation") {
  const state = await readGlobalSafetyState();
  // A migration-created pause is local to the own-account monitor, never an Instagram incident.
  if (operation !== "own-account-scan" && isIOSLocalUpgradeHold(state)) return {...state,blocked:false};
  if (!state.blocked) return state;
  const detail = state.manualResetRequired
    ? "A proteção global está ativa. Confirma a conta no Instagram e desbloqueia manualmente no Diagnóstico."
    : `A proteção global mantém todos os pedidos em pausa até ${new Date(state.cooldownUntil).toLocaleString("pt-PT")}.`;
  const error = monitorFailure(detail, "global_safety_lock", 0);
  error.safety = state;
  error.retryAfterSeconds = state.cooldownUntil > Date.now()
    ? Math.ceil((state.cooldownUntil - Date.now()) / 1000)
    : 0;
  await backgroundLog("warn", "safety", "operation-blocked", detail, {
    operation,
    reason: state.reason,
    manualResetRequired: state.manualResetRequired,
    cooldownUntil: state.cooldownUntil,
  });
  throw error;
}

function normalizeMonitorPacing(value = {}) {
  const clamp = (candidate, fallback, minimum, maximum) => Math.max(
    minimum,
    Math.min(maximum, Number.isFinite(Number(candidate)) ? Number(candidate) : fallback),
  );
  const minimum = clamp(value.pageDelayMinMs, DEFAULT_MONITOR_PACING.pageDelayMinMs, 0, 60_000);
  return {
    globalGapMinutes: clamp(value.globalGapMinutes, DEFAULT_MONITOR_PACING.globalGapMinutes, 0, 43_200),
    manualRespectsGap: value.manualRespectsGap === true,
    paceAfterFailure: value.paceAfterFailure === true,
    pageDelayMinMs: minimum,
    pageDelayMaxMs: Math.max(minimum, clamp(value.pageDelayMaxMs, DEFAULT_MONITOR_PACING.pageDelayMaxMs, 0, 60_000)),
    pauseEveryPages: Math.round(clamp(value.pauseEveryPages, DEFAULT_MONITOR_PACING.pauseEveryPages, 0, 50)),
    pauseDurationMs: clamp(value.pauseDurationMs, DEFAULT_MONITOR_PACING.pauseDurationMs, 0, 600_000),
  };
}

async function resolveMonitorPacing(message = {}, scope = "own") {
  if(globalThis.__FOLLOWCHECK_IOS_SHELL__) {
    const key=`followcheck:ios:pacing:${scope === 'watchlist' ? 'watchlist':'own'}:v1`;
    const local=await chrome.storage.local.get(key);
    if(local[key])return normalizeMonitorPacing(local[key]);
  }
  if (message?.pacing && typeof message.pacing === "object"
      && Object.prototype.hasOwnProperty.call(message.pacing, "globalGapMinutes")) {
    return normalizeMonitorPacing(message.pacing);
  }
  const stored = await chrome.storage.local.get(MONITOR_PACING_SETTINGS_KEY).catch(() => ({}));
  return normalizeMonitorPacing(stored?.[MONITOR_PACING_SETTINGS_KEY] || {});
}

async function readGlobalScanBudget(pacing = DEFAULT_MONITOR_PACING) {
  const stored = await chrome.storage.local.get(GLOBAL_SCAN_BUDGET_KEY).catch(() => ({}));
  const value = stored?.[GLOBAL_SCAN_BUDGET_KEY] || {};
  const lastCompletedAt = Math.max(0, Number(value.lastCompletedAt || 0));
  const gapMs = Math.max(0, Number(pacing.globalGapMinutes || 0)) * 60_000;
  return {
    lastCompletedAt,
    nextAllowedAt: gapMs > 0 && lastCompletedAt > 0 ? lastCompletedAt + gapMs : 0,
    lastTask: String(value.lastTask || "").slice(0, 40),
  };
}

async function assertGlobalScanBudget(task, pacing, manual = false) {
  if(globalThis.__FOLLOWCHECK_IOS_SHELL__ && task === 'watchlist') return {lastCompletedAt:0,nextAllowedAt:0,lastTask:'watchlist-independent'};
  const budget = await readGlobalScanBudget(pacing);
  if (manual && pacing.manualRespectsGap !== true) return budget;
  if (budget.nextAllowedAt > Date.now()) {
    const retryAfterSeconds = Math.max(1, Math.ceil((budget.nextAllowedAt - Date.now()) / 1000));
    const failure = monitorFailure(
      globalThis.__FOLLOWCHECK_IOS_SHELL__ ? "O intervalo local da análise da tua conta ainda está ativo. A Watchlist tem agenda independente." : "O intervalo global escolhido ainda está ativo para a conta própria e a Watchlist.",
      "configured_pacing_active",
    );
    failure.retryAfterSeconds = retryAfterSeconds;
    failure.nextAllowedAt = budget.nextAllowedAt;
    await backgroundLog("info", "safety", "scan-budget-blocked", failure.message, {
      task,
      lastTask: budget.lastTask,
      lastCompletedAt: budget.lastCompletedAt,
      nextAllowedAt: budget.nextAllowedAt,
    });
    throw failure;
  }
  return budget;
}

async function commitGlobalScanBudget(task, completedAt = Date.now(), pacing = DEFAULT_MONITOR_PACING) {
  if(globalThis.__FOLLOWCHECK_IOS_SHELL__ && task === 'watchlist') return {lastCompletedAt:completedAt,nextAllowedAt:0,lastTask:'watchlist-independent'};
  const gapMs = Math.max(0, Number(pacing.globalGapMinutes || 0)) * 60_000;
  const value = {
    version: 2,
    lastTask: String(task || "scan").slice(0, 40),
    lastCompletedAt: Math.max(0, Number(completedAt || Date.now())),
    nextAllowedAt: gapMs > 0 ? Math.max(0, Number(completedAt || Date.now())) + gapMs : 0,
    configuredGapMinutes: Math.max(0, Number(pacing.globalGapMinutes || 0)),
  };
  await chrome.storage.local.set({ [GLOBAL_SCAN_BUDGET_KEY]: value });
  await backgroundLog("info", "safety", "scan-budget-committed",
    "Intervalo global escolhido atualizado depois de um snapshot completo.", value);
  return value;
}

const safetyTransitionsByError = new WeakMap();
async function tripSafetyFromError(error, source) {
  if (!error || (typeof error !== "object" && typeof error !== "function")) return null;
  const existing = safetyTransitionsByError.get(error);
  if (existing) return existing;
  const transition = applySafetyFromError(error, source);
  safetyTransitionsByError.set(error, transition);
  try { return await transition; }
  catch (failure) { safetyTransitionsByError.delete(error); throw failure; }
}

async function applySafetyFromError(error, source) {
  const code = String(error?.code || "");
  if (["instagram_security_warning", "automated_behavior_detected", "multiple_sessions_blocked", "challenge_required"].includes(code)) {
    return tripGlobalSafety(code, String(error?.message || "O Instagram apresentou um aviso de segurança."), {
      manualResetRequired: true,
      source,
    });
  }
  if (["rate_limited", "soft_throttle", "http_429"].includes(code)) {
    const seconds = Math.max(0, Number(error?.retryAfterSeconds || error?.retryAfter || 0));
    const until = Date.now() + Math.max(GLOBAL_THROTTLE_COOLDOWN_MS, seconds * 1000);
    return tripGlobalSafety(code, String(error?.message || "O Instagram limitou temporariamente os pedidos."), {
      manualResetRequired: false,
      cooldownUntil: until,
      serverCooldownUntil: seconds > 0 ? Date.now() + seconds * 1000 : 0,
      source,
    });
  }
  return null;
}

function installBackgroundConsoleCapture() {
  if (globalThis.__FOLLOWCHECK_BACKGROUND_CONSOLE_CAPTURE__) return;
  globalThis.__FOLLOWCHECK_BACKGROUND_CONSOLE_CAPTURE__ = true;
  let writing = false;
  const textFor = (values) => backgroundRedact(values.map((value) => {
    if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`;
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  }).join(" "), 1800);
  for (const method of ["debug", "log", "info", "warn", "error"]) {
    const original = console[method]?.bind(console);
    if (!original) continue;
    console[method] = (...values) => {
      original(...values);
      if (writing) return;
      const text = textFor(values);
      if (!["warn", "error"].includes(method) && !/followcheck|\[fc[:\]]/i.test(text)) return;
      writing = true;
      backgroundLog(method === "error" ? "error" : method === "warn" ? "warn" : "debug", "background-console", method, text || `console.${method}`, {
        stack: values.find((value) => value instanceof Error)?.stack || "",
      }).finally(() => { writing = false; });
    };
  }
  globalThis.addEventListener?.("error", (event) => backgroundLog("error", "background-runtime", "worker-error", event.message || "Erro global no motor.", {
    file: event.filename || "", line: event.lineno || 0, column: event.colno || 0, stack: event.error?.stack || "",
  }));
  globalThis.addEventListener?.("unhandledrejection", (event) => backgroundLog("error", "background-runtime", "unhandled-rejection", event.reason?.message || textFor([event.reason]) || "Promise rejeitada sem tratamento.", {
    code: event.reason?.code || "", stack: event.reason?.stack || "",
  }));
}

function postNativeProgress(state = {}) {
  const payload = {
    event: "progress",
    scope: String(state.scope || ""),
    targetId: String(state.targetId || ""),
    phase: String(state.phase || (state.active ? "running" : "idle")),
    active: Boolean(state.active),
    title: String(state.title || "FollowCheck em execução").slice(0, 120),
    detail: String(state.detail || "Operação ativa").slice(0, 180),
    percentage: Number.isFinite(Number(state.percentage))
      ? Math.max(-1, Math.min(100, Math.round(Number(state.percentage))))
      : -1,
    updatedAt: Date.now(),
  };
  const signature = JSON.stringify({
    phase: payload.phase,
    active: payload.active,
    title: payload.title,
    detail: payload.detail,
    percentage: payload.percentage,
  });
  nativeOperationActive = payload.active;
  if (signature === lastNativeProgressSignature) return;
  lastNativeProgressSignature = signature;
  nativePort?.postMessage(payload);
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

function backgroundTimerKey(sender, requestId) {
  return `${sender.tab?.id ?? "tab"}:${sender.frameId ?? 0}:${String(requestId || "")}`;
}

function finishBackgroundTimer(key, payload) {
  const timer = backgroundTimers.get(key);
  if (!timer) return;
  backgroundTimers.delete(key);
  try {
    timer.sendResponse(payload);
  } catch {
    // O separador pode ter sido fechado enquanto a app estava em background.
  }
}

function flushBackgroundTimers(now = Date.now()) {
  for (const [key, timer] of backgroundTimers) {
    if (timer.dueAt <= now) {
      finishBackgroundTimer(key, {
        ok: true,
        requestId: timer.requestId,
        firedAt: now,
      });
    }
  }
}

function scheduleBackgroundTimer(message, sender, sendResponse) {
  const requestId = String(message.requestId || "").slice(0, 120);
  const delayMs = Math.min(
    6 * 60 * 60 * 1000,
    Math.max(0, Number(message.delayMs) || 0),
  );
  if (!requestId || backgroundTimers.size >= 512) {
    sendResponse({ ok: false, error: "Não foi possível reservar o relógio de background." });
    return false;
  }

  const key = backgroundTimerKey(sender, requestId);
  finishBackgroundTimer(key, { ok: false, cancelled: true, requestId });
  backgroundTimers.set(key, {
    requestId,
    dueAt: Date.now() + delayMs,
    sendResponse,
  });
  flushBackgroundTimers();
  return true;
}

function cancelBackgroundTimer(message, sender, sendResponse) {
  const requestId = String(message.requestId || "").slice(0, 120);
  const key = backgroundTimerKey(sender, requestId);
  const existed = backgroundTimers.has(key);
  finishBackgroundTimer(key, { ok: false, cancelled: true, requestId });
  sendResponse({ ok: true, cancelled: existed, requestId });
  return false;
}

async function readLastInstagramSessionState() {
  const stored = await chrome.storage.local.get(LAST_INSTAGRAM_SESSION_STATE_KEY).catch(() => ({}));
  const value = stored?.[LAST_INSTAGRAM_SESSION_STATE_KEY] || {};
  return {
    connected: Boolean(value.connected),
    userId: String(value.userId || ""),
    username: String(value.username || ""),
    fullName: String(value.fullName || ""),
    profilePicUrl: String(value.profilePicUrl || "").slice(0, 750000),
    cookieStoreId: safeCookieStoreId(value.cookieStoreId),
    updatedAt: Number(value.updatedAt) || 0,
  };
}

async function rememberLastInstagramSessionState(value = {}) {
  const previous = await readLastInstagramSessionState();
  const userId = String(value.userId || previous.userId || "");
  if (!userId) return previous;
  const sameAccount = userId === previous.userId;
  const next = {
    connected: value.connected !== false,
    userId,
    username: String(value.username || (sameAccount ? previous.username : "") || "").slice(0, 80),
    fullName: String(value.fullName || (sameAccount ? previous.fullName : "") || "").slice(0, 160),
    profilePicUrl: String(value.profilePicUrl || (sameAccount ? previous.profilePicUrl : "") || "").slice(0, 750000),
    cookieStoreId: safeCookieStoreId(value.cookieStoreId || previous.cookieStoreId),
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ [LAST_INSTAGRAM_SESSION_STATE_KEY]: next }).catch(() => {});
  return next;
}

function normalizedSessionIdentity(value = {}) {
  const user = value?.data?.user || value?.data?.data?.user || value?.user || {};
  const userId = String(user.pk || user.pk_id || user.id || value.userId || "");
  if (!/^\d{1,32}$/.test(userId)) return null;
  return {
    connected: true,
    userId,
    username: validInstagramUsername(user.username || value.username || ""),
    fullName: String(user.full_name || user.fullName || value.fullName || "").slice(0, 160),
    profilePicUrl: String(
      user.profile_pic_url_hd
      || user.hd_profile_pic_url_info?.url
      || user.profile_pic_url
      || user.profilePicUrl
      || value.profilePicUrl
      || "",
    ).slice(0, 4000),
  };
}

async function hydrateInstagramSessionIdentity(value = {}, tabId = null, options = {}) {
  const base = normalizedSessionIdentity(value) || {
    connected: value.connected !== false,
    userId: String(value.userId || ""),
    username: validInstagramUsername(value.username || ""),
    fullName: String(value.fullName || "").slice(0, 160),
    profilePicUrl: String(value.profilePicUrl || "").slice(0, 4000),
  };
  if (!/^\d{1,32}$/.test(base.userId)) return base;
  if (globalThis.__FOLLOWCHECK_IOS_SHELL__) {
    // Session inspection must not generate profile requests, even with force.
    const cached = await readLastInstagramSessionState();
    if (cached.userId !== base.userId) return base;
    return {...base, username:base.username || cached.username,
      fullName:base.fullName || cached.fullName, profilePicUrl:base.profilePicUrl || cached.profilePicUrl};
  }
  if (base.username && base.profilePicUrl && !options.force) return base;
  if (instagramIdentityRefreshPromise) return instagramIdentityRefreshPromise;

  instagramIdentityRefreshPromise = (async () => {
    const stored = await chrome.storage.local.get(INSTAGRAM_IDENTITY_REFRESH_KEY).catch(() => ({}));
    const previous = stored?.[INSTAGRAM_IDENTITY_REFRESH_KEY] || {};
    const sameAccount = String(previous.userId || "") === base.userId;
    if (!options.force && sameAccount
        && Date.now() - Number(previous.attemptedAt || 0) < INSTAGRAM_IDENTITY_RETRY_MS) {
      return base;
    }
    await chrome.storage.local.set({
      [INSTAGRAM_IDENTITY_REFRESH_KEY]: {
        userId: base.userId,
        attemptedAt: Date.now(),
        ok: false,
      },
    }).catch(() => {});
    const result = await requestInstagramMainPage("profile-info", {
      userId: base.userId,
      username: base.username,
    }, Number(tabId) || null).catch(() => null);
    const hydrated = result?.ok
      ? normalizedSessionIdentity({ ...base, data: result.data })
      : null;
    if (!hydrated?.username) {
      await backgroundLog("warn", "session", "identity-hydration-deferred",
        "A sessão está autenticada, mas o Instagram ainda não devolveu o nome e avatar da conta.", {
          accountId: base.userId,
          status: Number(result?.status || 0),
          responseKind: String(result?.responseKind || "unknown"),
          retryAfterMinutes: Math.round(INSTAGRAM_IDENTITY_RETRY_MS / 60_000),
        });
      return base;
    }
    const remembered = await rememberLastInstagramSessionState(hydrated);
    await chrome.storage.local.set({
      [INSTAGRAM_IDENTITY_REFRESH_KEY]: {
        userId: base.userId,
        attemptedAt: Date.now(),
        ok: true,
      },
    }).catch(() => {});
    await backgroundLog("info", "session", "identity-hydrated",
      "Nome, identidade e avatar da conta foram atualizados.", {
        accountId: base.userId,
        username: remembered.username,
        avatarPresent: Boolean(remembered.profilePicUrl),
      });
    if (tabId) {
      chrome.tabs.sendMessage(Number(tabId), {
        type: "FOLLOWCHECK_SESSION_IDENTITY",
        identity: remembered,
      }).catch(() => null);
    }
    return remembered;
  })().finally(() => {
    instagramIdentityRefreshPromise = null;
  });
  return instagramIdentityRefreshPromise;
}

async function getAnyInstagramTab() {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  const matches = tabs.filter((candidate) => candidate?.id && (
    isInstagramUrl(candidate.url) || isInstagramUrl(candidate.pendingUrl)
  ));
  return matches.find((candidate) => candidate.active) || matches[0] || null;
}

async function resolveMonitorInstagramSession(tab = null, preferredUsername = "", preferredUserId = "") {
  const wantedUsername = validInstagramUsername(preferredUsername).toLowerCase();
  const last = await readLastInstagramSessionState();
  const explicitUserId = /^\d{1,32}$/.test(String(preferredUserId || ""))
    ? String(preferredUserId)
    : "";
  const wantedUserId = explicitUserId || (/^\d{1,32}$/.test(last.userId) ? last.userId : "");

  // 10.12.2: a sessão da página é a fonte mais fiável no GeckoView. Em alguns
  // contextos Android o Instagram está autenticado e consegue fazer pedidos no
  // próprio separador, mas chrome.cookies não expõe o sessionid HttpOnly da store
  // correta. Isso produzia o falso "sessão Instagram inválida" mesmo com a conta
  // aberta. Se existe uma página autenticada, usa-a antes de declarar logout.
  const pageSession = await probeInstagramPageSession(wantedUsername, wantedUserId).catch(() => null);
  if (pageSession?.blocked) return pageSession;
  if (pageSession?.userId) return pageSession;

  const candidates = [];
  const tabStoreId = await resolveInstagramCookieStore({
    tabId: tab?.id,
    cookieStoreId: tab?.cookieStoreId,
  });
  if (tabStoreId) candidates.push(tabStoreId);
  if (last.cookieStoreId && !candidates.includes(last.cookieStoreId)) candidates.push(last.cookieStoreId);
  if (chrome.cookies?.getAllCookieStores) {
    const stores = await chrome.cookies.getAllCookieStores().catch(() => []);
    const ids = stores.map((store) => safeCookieStoreId(store?.id)).filter(Boolean);
    if (last.userId) {
      for (const storeId of ids) {
        if (candidates.includes(storeId)) continue;
        const userId = await getInstagramCookie("ds_user_id", storeId);
        if (String(userId || "") === last.userId) candidates.push(storeId);
      }
    }
    for (const storeId of ids) if (!candidates.includes(storeId)) candidates.push(storeId);
  }
  for (const cookieStoreId of candidates) {
    const [sessionId, userId] = await Promise.all([
      getInstagramCookie("sessionid", cookieStoreId),
      getInstagramCookie("ds_user_id", cookieStoreId),
    ]);
    if (sessionId && userId) return { sessionId, userId, cookieStoreId, pageSession: false, tabId: tab?.id || null };
  }
  const [sessionId, userId] = await Promise.all([
    getInstagramCookie("sessionid", ""),
    getInstagramCookie("ds_user_id", ""),
  ]);
  const pageUrl = String(tab?.url || tab?.pendingUrl || "");
  const loginPage = /\/accounts\/(?:login|challenge|checkpoint)|\/challenge\//i.test(pageUrl);
  return {
    sessionId,
    userId,
    cookieStoreId: "",
    pageSession: false,
    tabId: tab?.id || null,
    // Absence of an exposed HttpOnly cookie or a failed private endpoint is
    // inconclusive in GeckoView. Only the top-level Instagram tab being on a
    // login/challenge route corroborates a real session termination.
    failureCode: loginPage ? "login_required" : "session_unverified",
    logoutConfirmed: loginPage,
  };
}

async function inspectInstagramSessionForNative(hints = {}) {
  if (sessionInspectionRunning) return;
  sessionInspectionRunning = true;
  try {
    const instagramTab = await getAnyInstagramTab();
    const {
      sessionId,
      userId,
      cookieStoreId,
      failureCode,
      logoutConfirmed,
    } = await resolveMonitorInstagramSession(
      instagramTab,
      hints.username || "",
      hints.accountId || "",
    );
    if (!sessionId || !userId) {
      nativePort?.postMessage({
        event: "session_state",
        connected: false,
        userId: "",
        username: "",
        fullName: "",
        profilePicUrl: "",
        reason: failureCode || "session_unverified",
        logoutConfirmed: Boolean(logoutConfirmed),
      });
      return;
    }
    const previous = await readLastInstagramSessionState();
    const username = previous.userId === String(userId) ? previous.username : "";
    const fullName = previous.userId === String(userId) ? previous.fullName : "";
    const profilePicUrl = previous.userId === String(userId) ? previous.profilePicUrl : "";
    // Session status is observational only. Identity refreshes are performed
    // by normal Instagram navigation, never by a recurring background probe.
    const remembered = await rememberLastInstagramSessionState({ connected: true, userId: String(userId), username, fullName, profilePicUrl, cookieStoreId });
    nativePort?.postMessage({ event: "session_state", connected: true, userId: remembered.userId, username: remembered.username, fullName: remembered.fullName, profilePicUrl: remembered.profilePicUrl });
  } finally {
    lastSessionInspectionAt = Date.now();
    sessionInspectionRunning = false;
  }
}

async function injectFollowCheckIntoTab(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: [PAGE_EXECUTOR_FILE],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: MOBILE_SCRIPT_FILES,
  });
}

async function injectFollowCheckIntoActiveTab() {
  const tab = await getActiveInstagramTab();
  if (!tab?.id) {
    throw new Error("Abre primeiro a sessão Instagram dentro da app.");
  }
  await injectFollowCheckIntoTab(tab.id);
}

async function getActiveInstagramTab() {
  const tabs = await chrome.tabs.query({ active: true });
  return tabs.find((candidate) => candidate.id && isInstagramUrl(candidate.url))
    || tabs.find((candidate) => candidate.id && isInstagramUrl(candidate.pendingUrl))
    || null;
}

async function requestNativeSnapshot() {
  const tab = await getAnyInstagramTab();
  if (!tab?.id) return;
  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "FOLLOWCHECK_NATIVE_SNAPSHOT_REQUEST",
  }).catch(() => null);
  if (response?.snapshot) {
    nativePort?.postMessage({
      event: "native_snapshot",
      snapshot: response.snapshot,
    });
  }
  lastNativeSnapshotAt = Date.now();
}

async function probeNativeStatus() {
  const tab = await getAnyInstagramTab();
  if (!tab?.id) return;
  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "FOLLOWCHECK_NATIVE_STATUS_PROBE",
  }).catch(() => null);
  if (response?.state?.active || ["completed", "failed"].includes(response?.state?.phase)) {
    postNativeProgress(response.state);
  }
  lastNativeStatusProbeAt = Date.now();
}

async function openFollowCheckNative(view = "tools", monitorStatus = null) {
  const requestedView = String(view || "").trim();
  const tab = await getActiveInstagramTab();
  if (!tab?.id) {
    throw new Error("A sessão Instagram ainda não está disponível.");
  }
  const state = await chrome.tabs.sendMessage(tab.id, {
    type: "FOLLOWCHECK_NATIVE_OPEN",
    view: requestedView,
    monitorStatus,
  }).catch(() => null);
  let injected = false;
  if (!state?.open && !state?.mounting) {
    await injectFollowCheckIntoTab(tab.id);
    injected = true;
  }
  await new Promise((resolve) => setTimeout(resolve, state?.open ? 60 : state?.mounting ? 140 : 260));
  // Cold Gecko/React mounts on a Fold can legitimately take several seconds.
  // Stay inside the same logical open instead of reporting failure and letting
  // Android start a second competing recovery cycle.
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const openState = await chrome.tabs.sendMessage(tab.id, {
      type: "FOLLOWCHECK_NATIVE_OPEN",
      view: requestedView,
      monitorStatus,
    }).catch(() => null);
    if (!openState?.open) {
      if (!openState?.mounting && !injected) {
        await injectFollowCheckIntoTab(tab.id);
        injected = true;
      }
      await new Promise((resolve) => setTimeout(resolve, openState?.mounting ? 180 : 260));
      continue;
    }
    if (!requestedView) return { open: true, view: "" };
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "FOLLOWCHECK_NATIVE_NAVIGATE",
      view: requestedView,
    }).catch(() => null);
    if (result?.ok) return { open: true, view: requestedView };
    await new Promise((resolve) => setTimeout(resolve, 220));
  }
  throw new Error("A interface não confirmou o arranque dentro do tempo limite.");
}

async function closeFollowCheckNative() {
  const tab = await getActiveInstagramTab();
  if (!tab?.id) return false;
  await chrome.tabs.sendMessage(tab.id, {
    type: "FOLLOWCHECK_NATIVE_CLOSE",
  }).catch(() => null);
  postNativeProgress({
    phase: "idle",
    active: false,
    title: "FollowCheck pronto",
    detail: "Sem operações ativas",
    percentage: -1,
  });
  return true;
}

function connectNativeBridge() {
  if (nativePort) return;
  clearTimeout(nativeReconnectTimer);
  try {
    const port = chrome.runtime.connectNative(NATIVE_APP);
    nativePort = port;
    lastNativeProgressSignature = "";
    port.onMessage.addListener((message) => {
      if (message?.command === "keep_alive_tick") {
        const now = Number(message.timestamp) || Date.now();
        flushBackgroundTimers(now);
        // The Watchlist owns one alarm. Running it on every native heartbeat
        // created a second scheduler and could duplicate Instagram reads.
        if (now - lastSessionInspectionAt >= 30 * 60_000) {
          inspectInstagramSessionForNative().catch(error => backgroundLog("warn", "session", "inspection-failed", error.message));
        }
        if (now - lastNativeStatusProbeAt >= 1500) {
          probeNativeStatus().catch(() => {});
        }
        if (now - lastNativeSnapshotAt >= 12000) {
          requestNativeSnapshot().catch(() => {});
        }
        return;
      }
      if (message?.command === "toggle_followcheck") {
        injectFollowCheckIntoActiveTab()
          .then(() => port.postMessage({ event: "toggle_result", ok: true }))
          .catch((error) => port.postMessage({
            event: "toggle_result",
            ok: false,
            error: error?.message || "Não foi possível abrir o FollowCheck.",
          }));
        return;
      }
      if (message?.command === "inspect_session") {
        inspectInstagramSessionForNative({
          accountId: String(message.accountId || ""),
          username: String(message.username || ""),
        });
        return;
      }
      if (message?.command === "native_snapshot") {
        requestNativeSnapshot().catch(() => {});
        return;
      }
      if (message?.command === "open_followcheck") {
        openFollowCheckNative(message.view, message.monitorStatus)
          .then((state) => port.postMessage({
            event: "workspace_state",
            open: true,
            view: state?.view || message.view || "overview",
          }))
          .catch((error) => port.postMessage({
            event: "workspace_state",
            open: false,
            view: message.view || "overview",
            error: error?.message || "Não foi possível abrir o FollowCheck.",
          }));
        return;
      }
      if (message?.command === "close_followcheck") {
        closeFollowCheckNative().catch(() => {});
        return;
      }
      if (message?.command === "monitor_status") {
        mirrorNativeWatchlistStatus(message.monitorStatus || null)
          .catch(() => {})
          .finally(() => acknowledgeNativeWatchlistStatus(message.monitorStatus || null));
        getAnyInstagramTab().then((tab) => tab?.id
          ? chrome.tabs.sendMessage(tab.id, {
              type: "FOLLOWCHECK_NATIVE_MONITOR_STATUS",
              monitorStatus: message.monitorStatus || null,
            }).catch(() => null)
          : null);
        return;
      }
      if (message?.command === "workspace_back") {
        getAnyInstagramTab().then((tab) => tab?.id
          ? chrome.tabs.sendMessage(tab.id, {
              type: "FOLLOWCHECK_NATIVE_BACK",
            }).catch(() => null)
          : null);
        return;
      }
      if (message?.command === "remove_account_data") {
        const accountId = String(message.accountId || "").trim();
        if (!accountId) {
          port.postMessage({ event: "remove_account_data_result", ok: true });
          return;
        }
        chrome.storage.local.remove([
          `${MONITOR_STORAGE_PREFIX}:${accountId}`,
          monitorAvailabilityKey(accountId),
          monitorArrivalKey(accountId),
          privateMemoryKey(accountId),
        ]).then(() => port.postMessage({
          event: "remove_account_data_result",
          ok: true,
          profileId: String(message.profileId || ""),
        })).catch((error) => port.postMessage({
          event: "remove_account_data_result",
          ok: false,
          profileId: String(message.profileId || ""),
          error: String(error?.message || "Falha ao limpar dados da conta.").slice(0, 180),
        }));
        return;
      }
      if (message?.command === "monitor_scan") {
        // Coalesce pedidos duplicados do scheduler nativo. Um segundo trigger durante
        // um scan em curso é benigno e não deve gerar alerta, cooldown nem reescrever
        // a próxima execução.
        if (monitorJobRunning && Date.now() - monitorJobStartedAt < 45 * 60 * 1000) {
          return;
        }
        if (monitorJobRunning) {
          monitorJobToken += 1;
          monitorJobRunning = false;
          monitorJobStartedAt = 0;
          monitorPrivateSession = null;
          postMonitorDiagnostic(String(message.profileId || ""), "stale_job_recovered", {
            checkId: String(message.checkId || ""),
            reason: "extension_job_timeout",
          });
        }
        runNativeMonitorScan(message).catch((error) => {
          tripSafetyFromError(error, "native-own-check").catch(() => {});
          const reportedCode = error?.code === "global_safety_lock"
            ? "instagram_security_warning"
            : String(error?.code || "monitor_failed");
          backgroundLog("error", "monitor", "own-check-failed", String(error?.message || "A sincronização falhou."), {
            code: reportedCode, originalCode: error?.code || "monitor_failed", status: Number(error?.status || 0), transport: error?.transport || "", checkId: message.checkId || "",
            attempts: Array.isArray(error?.attempts) ? error.attempts : [], stack: error?.stack || "",
          });
          postMonitorStopped(
            String(message.profileId || ""),
            "Check não concluído",
            String(error?.message || "A sincronização falhou."),
            "error",
          );
          port.postMessage({
            event: "monitor_error",
            profileId: String(message.profileId || ""),
            checkId: String(message.checkId || ""),
            code: reportedCode,
            message: String(error?.message || "A sincronização falhou.").slice(0, 220),
            status: Number(error?.status || 0),
            retryAfterSeconds: Number(error?.retryAfterSeconds || error?.retryAfterSec || 0),
            transport: String(error?.transport || ""),
          });
        });
        return;
      }
      if (message?.command === "watchlist_scan") {
        if (monitorJobRunning && Date.now() - monitorJobStartedAt < 45 * 60 * 1000) return;
        if (monitorJobRunning) {
          monitorJobToken += 1;
          monitorJobRunning = false;
          monitorJobStartedAt = 0;
          monitorPrivateSession = null;
        }
        runNativeWatchlistScan(message).catch((error) => {
          tripSafetyFromError(error, "native-watchlist-check").catch(() => {});
          const reportedCode = error?.code === "global_safety_lock"
            ? "instagram_security_warning"
            : String(error?.code || "watchlist_failed");
          backgroundLog("error", "watchlist", "watchlist-check-failed", String(error?.message || "O check da Watchlist falhou."), {
            code: reportedCode, originalCode: error?.code || "watchlist_failed", status: Number(error?.status || 0), transport: error?.transport || "", targetId: message.targetId || "", checkId: message.checkId || "",
            attempts: Array.isArray(error?.attempts) ? error.attempts : [], stack: error?.stack || "",
          });
          postMonitorStopped(
            String(message.profileId || ""),
            "Watchlist não concluída",
            String(error?.message || "O check da Watchlist falhou."),
            "error",
          );
          port.postMessage({
            event: "monitor_error",
            profileId: String(message.profileId || ""),
            targetId: String(message.targetId || ""),
            checkId: String(message.checkId || ""),
            code: reportedCode,
            message: String(error?.message || "O check da Watchlist falhou.").slice(0, 220),
            status: Number(error?.status || 0),
            retryAfterSeconds: Number(error?.retryAfterSeconds || error?.retryAfter || 0),
            transport: String(error?.transport || ""),
          });
        });
        return;
      }
      if (message?.command === "monitor_requests") {
        runNativeRequestsRefresh(message).catch((error) => {
          port.postMessage({
            event: "monitor_error",
            profileId: String(message.profileId || ""),
            code: String(error?.code || "requests_failed"),
            message: String(error?.message || "Não foi possível obter os pedidos.").slice(0, 220),
            status: Number(error?.status || 0),
            retryAfterSeconds: Number(error?.retryAfterSeconds || error?.retryAfterSec || 0),
            transport: String(error?.transport || ""),
          });
        });
        return;
      }
      if (message?.command === "monitor_cancel_requests") {
        runNativeCancelRequests(message).catch((error) => {
          port.postMessage({
            event: "monitor_error",
            profileId: String(message.profileId || ""),
            code: String(error?.code || "request_cancel_failed"),
            message: String(error?.message || "Não foi possível cancelar os pedidos.").slice(0, 220),
            status: Number(error?.status || 0),
            retryAfterSeconds: Number(error?.retryAfterSeconds || error?.retryAfterSec || 0),
            transport: String(error?.transport || ""),
          });
        });
      }
    });
    port.onDisconnect.addListener(() => {
      if (nativePort === port) nativePort = null;
      nativeReconnectTimer = setTimeout(connectNativeBridge, 1000);
    });
    port.postMessage({ event: "bridge_ready", engine: "background" });
    ensureGlobalSafetyMigration()
      .then((state) => publishGlobalSafetyState(state))
      .catch(() => {});
    setTimeout(() => migrateExtensionWatchlistToNative().catch(() => {}), 350);
    // Scheduler JS legado desativado em 2.6.5; o Android gere a cadência.
    inspectInstagramSessionForNative().catch(error => backgroundLog("warn", "session", "inspection-failed", error.message));
  } catch {
    nativePort = null;
    nativeReconnectTimer = setTimeout(connectNativeBridge, 1000);
  }
}

function sanitizePrivateMemories(memories = {}) {
  return Object.fromEntries(Object.entries(memories).slice(0, 1000).map(([id, items]) => [
    String(id),
    (Array.isArray(items) ? items : []).slice(0, 6).map((item) => ({
      type: String(item?.type || "memory").slice(0, 32),
      direction: item?.direction === "incoming" ? "incoming" : "outgoing",
      timestamp: item?.timestamp ? String(item.timestamp).slice(0, 40) : null,
      text: String(item?.text || "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180),
    })).filter((item) => item.text),
  ]).filter(([, items]) => items.length));
}

function privateMemoryKey(accountId) {
  const safeId = String(accountId || "").trim();
  if (!/^\d{5,32}$/.test(safeId)) throw new Error("Não foi possível identificar a conta ativa para abrir o cofre privado.");
  return `${PRIVATE_MEMORY_PREFIX}:${safeId}`;
}

async function privateMemoryOperation(operation, memories, accountId) {
  const key = privateMemoryKey(accountId);
  if (operation === "clear") {
    await chrome.storage.local.remove(key);
    return {};
  }
  if (operation === "set") {
    const safe = sanitizePrivateMemories(memories);
    await chrome.storage.local.set({ [key]: safe });
    return safe;
  }
  if (operation === "get") {
    const stored = await chrome.storage.local.get(key);
    return sanitizePrivateMemories(stored[key] || {});
  }
  throw new Error("Operação de memória desconhecida.");
}

function isInstagramUrl(value = "") {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && INSTAGRAM_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

function isAllowedAvatarUrl(value = "") {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && AVATAR_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

function isInstagramSender(sender) {
  return [sender.tab?.url, sender.url, sender.origin].some((value) => isInstagramUrl(value));
}

function validInstagramThreadId(value) {
  return /^\d{5,80}$/.test(String(value || ""));
}

function validInstagramIdentity(request = {}) {
  return /^\d{1,32}$/.test(String(request.userId || ""));
}

function safeCookieStoreId(value) {
  return typeof value === "string" && /^[a-z0-9._-]{1,160}$/i.test(value)
    ? value
    : "";
}

async function resolveInstagramCookieStore(request = {}) {
  const explicit = safeCookieStoreId(request.cookieStoreId);
  if (explicit) return explicit;
  const tabId = Number(request.tabId);
  if (!Number.isInteger(tabId) || !chrome.cookies?.getAllCookieStores) return "";
  const stores = await chrome.cookies.getAllCookieStores().catch(() => []);
  return safeCookieStoreId(
    stores.find((store) => Array.isArray(store.tabIds) && store.tabIds.includes(tabId))?.id,
  );
}

async function getInstagramCookie(name, cookieStoreId = "") {
  if (!chrome.cookies?.get) {
    throw Object.assign(new Error("A extensão precisa de ser recarregada para poder validar a sessão protegida do Instagram."), {
      code: "instagram_cookie_permission_missing",
    });
  }
  const storeId = safeCookieStoreId(cookieStoreId);
  for (const url of INSTAGRAM_COOKIE_URLS) {
    const cookie = await chrome.cookies.get({
      url,
      name,
      ...(storeId ? { storeId } : {}),
    }).catch(() => null);
    if (cookie?.value) return cookie.value;
  }
  return "";
}

async function findInstagramAccountCookieStore(requestedUserId, excludedStoreId = "") {
  const expected = String(requestedUserId || "");
  if (!/^\d{1,32}$/.test(expected) || !chrome.cookies?.getAllCookieStores) return "";
  const stores = await chrome.cookies.getAllCookieStores().catch(() => []);
  for (const store of stores) {
    const storeId = safeCookieStoreId(store?.id);
    if (!storeId || storeId === excludedStoreId) continue;
    const userId = await getInstagramCookie("ds_user_id", storeId);
    if (String(userId || "") !== expected) continue;
    const sessionId = await getInstagramCookie("sessionid", storeId);
    if (sessionId) return storeId;
  }
  return "";
}

async function requestInstagramMainPage(operation, payload = {}, preferredTabId = null) {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  const candidates = tabs.filter((tab) => tab?.id && (isInstagramUrl(tab.url) || isInstagramUrl(tab.pendingUrl)));
  candidates.sort((a, b) => {
    const score = (tab) => (tab.id === preferredTabId || tab.id === monitorTransportTabId ? 4 : 0) + (tab.active ? 2 : 0);
    return score(b) - score(a);
  });
  let lastError = null;
  for (const tab of candidates) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [PAGE_EXECUTOR_FILE],
      world: "MAIN",
    }).catch(() => null);
    let response = await chrome.tabs.sendMessage(tab.id, {
      type: "FOLLOWCHECK_PAGE_EXECUTOR_REQUEST",
      operation,
      payload,
      timeoutMs: 22000,
    }).catch(() => null);
    // Only local inspection may retry the bridge. A relationship/profile/Inbox
    // request can have reached Instagram even when its reply was lost; sending
    // it again would duplicate account activity.
    if (!response && ["ping", "probe-session"].includes(operation)) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["mobile-bridge.js"] }).catch(() => null);
      await monitorSleep(80);
      response = await chrome.tabs.sendMessage(tab.id, {
        type: "FOLLOWCHECK_PAGE_EXECUTOR_REQUEST",
        operation,
        payload,
        timeoutMs: 22000,
      }).catch(() => null);
    }
    if (response?.ok && response.result) {
      monitorTransportTabId = tab.id;
      const operationOk = Boolean(response.result.ok);
      backgroundLog(operationOk ? "info" : "warn", "page-main", operation,
        operationOk ? "O executor autenticado confirmou a operação." : "A ponte respondeu, mas a operação não foi confirmada.", {
        ok: operationOk,
        code: response.result.code || "",
        status: Number(response.result.status || 0),
        responseKind: response.result.responseKind || "json",
        durationMs: Number(response.result.durationMs || 0),
        confirmation: response.result.confirmation || "",
        checkId: diagnosticCheckId,
        scope: watchlistActiveTargetId ? "watchlist" : monitorJobRunning ? "account" : "interactive",
        diagnostics: response.result.diagnostics || {},
        attempts: Array.isArray(response.result.attempts) ? response.result.attempts : [],
      });
      return { ...response.result, tabId: tab.id };
    }
    lastError = response?.error || lastError;
  }
  backgroundLog("warn", "page-main", operation, "O executor autenticado não ficou disponível.", {
    code: lastError?.code || "page_main_unavailable",
    message: lastError?.message || "Sem resposta da página Instagram.",
    diagnostics: lastError?.diagnostics || {},
  });
  return null;
}

async function executeInstagramPageRequest(path) {
  let url;
  try { url = new URL(String(path || ""), "https://www.instagram.com"); } catch { return null; }
  const match = url.pathname.match(/^\/api\/v1\/friendships\/(\d{1,32})\/(followers|following)\/$/i);
  if (!match) return null;
  const result = await requestInstagramMainPage("monitor-list", {
    userId: match[1],
    kind: match[2].toLowerCase(),
    cursor: url.searchParams.get("max_id") || "",
    count: Number(url.searchParams.get("count") || MONITOR_PAGE_SIZE),
  }, monitorTransportTabId);
  if (!result) return null;
  return {
    ok: Boolean(result.ok),
    status: Number(result.status || 0),
    data: result.data || null,
    executor: result.executor || "page-main",
    code: result.code || "",
    message: result.message || "",
    securityWarning: Boolean(result.securityWarning),
    responseKind: result.responseKind || "unknown",
    durationMs: Number(result.durationMs || 0),
    retryAfter: Number(result.retryAfter || 0),
    apiMessage: result.apiMessage || "",
    apiErrorType: result.apiErrorType || "",
    restrictionSignal: result.restrictionSignal || null,
  };
}

async function probeInstagramPageSession(preferredUsername = "", preferredUserId = "") {
  const wanted = validInstagramUsername(preferredUsername).toLowerCase();
  const wantedUserId = /^\d{1,32}$/.test(String(preferredUserId || ""))
    ? String(preferredUserId)
    : "";
  const tabs = await chrome.tabs.query({}).catch(() => []);
  const instagramTabs = tabs.filter((candidate) => candidate?.id && (
    isInstagramUrl(candidate.url) || isInstagramUrl(candidate.pendingUrl)
  ));
  if (!instagramTabs.length) return null;

  const rememberedBeforeProbe = await readLastInstagramSessionState().catch(() => ({}));
  const mainProbe = await requestInstagramMainPage("probe-session", {
    preferredUserId: wantedUserId || rememberedBeforeProbe.userId || "",
    preferredUsername: wanted || rememberedBeforeProbe.username || "",
    preferredFullName: rememberedBeforeProbe.fullName || "",
    preferredProfilePicUrl: rememberedBeforeProbe.profilePicUrl || "",
  }, monitorTransportTabId).catch(() => null);
  if (mainProbe?.securityWarning || mainProbe?.code === "instagram_security_warning") {
    backgroundLog("error", "session", "instagram-security-warning", "O Instagram apresentou um aviso de segurança. O scan foi bloqueado antes de novos pedidos.", {
      code: "instagram_security_warning",
      status: Number(mainProbe?.status || 0),
      attempts: Array.isArray(mainProbe?.attempts) ? mainProbe.attempts : [],
    });
    await tripGlobalSafety("instagram_security_warning", "O Instagram apresentou um aviso de segurança. Todos os pedidos FollowCheck foram bloqueados.", {
      manualResetRequired: true,
      source: "session-preflight",
    });
    return {
      blocked: true,
      securityWarning: true,
      sessionId: "",
      userId: "",
      failureCode: "instagram_security_warning",
      logoutConfirmed: false,
      tabId: mainProbe?.tabId || null,
    };
  }
  if (mainProbe?.ok && mainProbe.user?.userId) {
    const user = await hydrateInstagramSessionIdentity(
      mainProbe.user,
      mainProbe.tabId,
    ).catch(() => mainProbe.user);
    if ((!wantedUserId || user.userId === wantedUserId) && (!wanted || String(user.username || "").toLowerCase() === wanted || user.userId === wantedUserId)) {
      const remembered = await rememberLastInstagramSessionState({
        connected: true,
        userId: user.userId,
        username: user.username,
        fullName: user.fullName,
        profilePicUrl: user.profilePicUrl,
      }).catch(() => user);
      nativePort?.postMessage({ event: "session_state", connected: true, ...remembered });
      return {
        sessionId: "page-main-session",
        userId: user.userId,
        username: user.username,
        fullName: user.fullName,
        profilePicUrl: remembered?.profilePicUrl || user.profilePicUrl,
        pageSession: true,
        tabId: mainProbe.tabId,
      };
    }
  }
  backgroundLog("warn", "session", "page-session-unconfirmed", "A página respondeu, mas ainda não confirmou a identidade da sessão.", {
    ok: Boolean(mainProbe?.ok),
    code: mainProbe?.code || "no_main_probe",
    status: Number(mainProbe?.status || 0),
    attempts: Array.isArray(mainProbe?.attempts) ? mainProbe.attempts : [],
    hasKnownUserId: Boolean(wantedUserId || rememberedBeforeProbe.userId),
    hasKnownUsername: Boolean(wanted || rememberedBeforeProbe.username),
  });

  // Never escalate an inconclusive DOM/cookie check into identity API calls.
  // The known session remains preserved and a real login route is the only
  // authoritative logout signal.
  return null;
}

function monitorSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function postMonitorProgress(profileId, title, detail, percentage) {
  const progress = {
    scope: watchlistActiveTargetId ? "watchlist" : "account",
    targetId: watchlistActiveTargetId || "",
    profileId: String(profileId || ""),
    title: String(title || "Monitor FollowCheck").slice(0, 120),
    detail: String(detail || "A sincronizar").slice(0, 180),
    percentage: Math.max(-1, Math.min(100, Math.round(Number(percentage) || 0))),
    updatedAt: Date.now(),
  };
  postNativeProgress({
    scope: progress.scope,
    targetId: progress.targetId,
    phase: "running",
    active: true,
    title,
    detail,
    percentage,
  });
  nativePort?.postMessage({
    event: "monitor_progress",
    ...progress,
  });
  if (monitorTransportTabId) {
    chrome.tabs.sendMessage(monitorTransportTabId, {
      type: "FOLLOWCHECK_MONITOR_PROGRESS",
      progress,
    }).catch(() => {});
  }
  if (watchlistActiveOwnerId && watchlistActiveTargetId) {
    updateWatchlistProgress(title, detail, percentage).catch(() => {});
  }
  backgroundLog("info", watchlistActiveTargetId ? "watchlist" : "monitor", "progress", progress.title, {
    detail: progress.detail,
    percentage: progress.percentage,
    profileId: progress.profileId,
  });
}

function postMonitorStopped(profileId, title, detail, phase = "completed") {
  const progress = {
    scope: watchlistActiveTargetId ? "watchlist" : "account",
    targetId: watchlistActiveTargetId || "",
    profileId: String(profileId || ""),
    active: false,
    title: String(title || "FollowCheck pronto").slice(0, 120),
    detail: String(detail || "Sem operações ativas").slice(0, 180),
    percentage: phase === "completed" ? 100 : 0,
    phase: String(phase || "completed"),
    updatedAt: Date.now(),
  };
  postNativeProgress(progress);
  nativePort?.postMessage({ event: "monitor_progress", ...progress });
  if (monitorTransportTabId) {
    chrome.tabs.sendMessage(monitorTransportTabId, {
      type: "FOLLOWCHECK_MONITOR_PROGRESS",
      progress,
    }).catch(() => {});
  }
  backgroundLog(phase === "error" ? "warn" : "info", "progress", "monitor-stopped", progress.title, {
    profileId: progress.profileId,
    phase: progress.phase,
    detail: progress.detail,
  });
}

function postMonitorDiagnostic(profileId, event, metadata = {}) {
  backgroundLog(
    /failed|rejected|stopped|timeout|warning|error/i.test(String(event || "")) ? "warn" : "debug",
    watchlistActiveTargetId ? "watchlist-diagnostic" : "monitor-diagnostic",
    String(event || "monitor_event"),
    `Diagnóstico do motor: ${String(event || "monitor_event")}`,
    { profileId: String(profileId || ""), ...metadata },
  );
  nativePort?.postMessage({
    event: "monitor_diagnostic",
    profileId: String(profileId || ""),
    diagnosticEvent: String(event || "monitor_event").slice(0, 80),
    metadata,
  });
}

function monitorFailure(message, code = "monitor_failed", status = 0) {
  return Object.assign(new Error(message), { code, status });
}

async function monitorFetchFromInstagramTab(url) {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  const instagramTabs = tabs.filter((candidate) => candidate?.id && (
    isInstagramUrl(candidate.url) || isInstagramUrl(candidate.pendingUrl)
  ));
  const ordered = [];
  if (monitorTransportTabId) {
    const preferred = instagramTabs.find((candidate) => candidate.id === monitorTransportTabId);
    if (preferred) ordered.push(preferred);
  }
  for (const tab of instagramTabs) if (!ordered.some((candidate) => candidate.id === tab.id)) ordered.push(tab);

  for (const tab of ordered) {
    let transport = await chrome.tabs.sendMessage(tab.id, {
      type: "FOLLOWCHECK_MONITOR_FETCH",
      url,
      viewerUserId: monitorTransportViewerUserId,
    }).catch(() => null);
    if (!transport) {
      // O Android/Gecko pode ter descartado o content script depois de muitas horas em
      // background. Reinstalamos só o bridge leve, sem abrir a interface FollowCheck.
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["mobile-bridge.js"],
      }).catch(() => null);
      await monitorSleep(120);
      transport = await chrome.tabs.sendMessage(tab.id, {
        type: "FOLLOWCHECK_MONITOR_FETCH",
        url,
        viewerUserId: monitorTransportViewerUserId,
      }).catch(() => null);
    }
    if (transport?.handled) {
      monitorTransportTabId = tab.id;
      return transport;
    }
  }
  return null;
}

async function monitorFetchJsonOnce(url, label) {
  const transport = await monitorFetchFromInstagramTab(url);

  let ok;
  let status;
  let redirected;
  let finalUrl;
  let text;
  let contentType = "";
  let retryAfter = 0;
  if (transport?.handled) {
    ok = Boolean(transport.ok);
    status = Number(transport.status || 0);
    redirected = Boolean(transport.redirected);
    finalUrl = String(transport.finalUrl || "");
    text = String(transport.text || "");
    contentType = String(transport.contentType || "");
    retryAfter = retryAfterSeconds(transport.retryAfter);
  } else {
    let response;
    try {
      const csrf = await getInstagramCookie("csrftoken", monitorTransportCookieStoreId);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        response = await fetch(url, {
          credentials: "include",
          cache: "no-store",
          redirect: "follow",
          signal: controller.signal,
          headers: {
            accept: "*/*",
            "x-ig-app-id": INSTAGRAM_WEB_APP_ID,
            "x-asbd-id": INSTAGRAM_ASBD_ID,
            "x-requested-with": "XMLHttpRequest",
            ...(csrf ? { "x-csrftoken": csrf } : {}),
          },
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      const failure = monitorFailure(`A ligação ao Instagram falhou durante ${label}.`, "network_error", 0);
      failure.cause = error;
      throw failure;
    }
    ok = response.ok;
    status = response.status;
    redirected = response.redirected;
    finalUrl = String(response.url || "");
    contentType = String(response.headers.get("content-type") || "");
    retryAfter = retryAfterSeconds(response.headers.get("retry-after"));
    text = await response.text().catch(() => "");
  }

  const sample = String(text || "").slice(0, 50000);
  let payload = null;
  try { payload = sample || text ? JSON.parse(text) : null; } catch { payload = null; }

  const loginLike = /\/accounts\/(login|challenge|checkpoint)/i.test(finalUrl)
    || /accounts\/(login|challenge|checkpoint)|login_required|checkpoint_required|challenge_required/i.test(sample);
  if (redirected && loginLike || (!payload && loginLike)) {
    throw monitorFailure(
      "Este canal do Instagram não confirmou a sessão. O contexto autenticado foi preservado e será verificado pela página aberta.",
      "session_unverified",
      status,
    );
  }

  const message = String(payload?.message || "");
  const errorType = String(payload?.error_type || "");
  const hardRateLimit = status === 429 || /rate.?limit/i.test(errorType);
  const softThrottle = /feedback_required/i.test(errorType) || /please wait a few minutes|try again later/i.test(message);
  if (hardRateLimit) {
    const failure = monitorFailure("O Instagram pediu uma pausa temporária nas leituras. O Monitor vai aguardar antes de voltar a tentar.", "rate_limited", status);
    failure.retryAfter = Math.max(retryAfter, Number(payload?.retry_after || 0));
    throw failure;
  }
  if (softThrottle) {
    const failure = monitorFailure("Este canal do Instagram pediu uma pausa; o Monitor vai tentar o canal alternativo sem guardar dados parciais.", "soft_throttle", status);
    failure.retryAfter = Math.max(retryAfter, Number(payload?.retry_after || 0));
    throw failure;
  }

  if (!ok) {
    const code = status >= 500 ? "server_error" : "http_error";
    const failure = monitorFailure(`O Instagram respondeu com o estado ${status || "desconhecido"} durante ${label}.`, code, status);
    failure.contentType = contentType;
    throw failure;
  }
  if (!payload) {
    const failure = monitorFailure(`O Instagram não devolveu dados válidos durante ${label}.`, sample ? "html_response" : "empty_response", status);
    failure.contentType = contentType;
    throw failure;
  }
  return payload;
}

async function monitorFetchJson(url, label) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await monitorFetchJsonOnce(url, label);
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || 0);
      // HTML/empty 200 means the route is unsuitable for this session. Repeating
      // it only bombards the same endpoint; the outer collector changes transport.
      const retryable = ["network_error", "server_error"].includes(error?.code)
        || status >= 500;
      if (!retryable || attempt >= 1) break;
      const backoff = (900 * (2 ** attempt)) + Math.round(Math.random() * 450);
      await monitorSleep(backoff);
    }
  }
  throw lastError || monitorFailure(`Não foi possível concluir ${label}.`, "monitor_failed");
}

function monitorRestUrl(kind, userId, cursor) {
  const params = new URLSearchParams({ count: String(MONITOR_PAGE_SIZE) });
  if (cursor) params.set("max_id", cursor);
  return `https://www.instagram.com/api/v1/friendships/${encodeURIComponent(userId)}/${kind}/?${params}`;
}

function monitorGraphqlUrl(kind, userId, cursor) {
  const params = new URLSearchParams({
    query_hash: kind === "followers"
      ? MONITOR_FOLLOWERS_QUERY_HASH
      : MONITOR_FOLLOWING_QUERY_HASH,
    variables: JSON.stringify({
      id: userId,
      include_reel: true,
      fetch_mutual: false,
      first: MONITOR_PAGE_SIZE,
      ...(cursor ? { after: cursor } : {}),
    }),
  });
  return `https://www.instagram.com/graphql/query/?${params}`;
}

function monitorUser(node = {}) {
  const fullName = String(node.full_name || node.fullName || "").slice(0, 140);
  const profilePicUrl = String(
    node.profile_pic_url
    || node.profile_pic_url_hd
    || node.hd_profile_pic_url_info?.url
    || node.profile_pic_url_info?.url
    || node.profilePicUrl
    || "",
  ).slice(0, 1600);
  const isPrivate = Boolean(node.is_private ?? node.isPrivate);
  const isVerified = Boolean(node.is_verified ?? node.isVerified);
  return {
    id: String(node.id || node.pk || node.pk_id || ""),
    username: String(node.username || "").slice(0, 80),
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

async function monitorFetchPrivatePage(kind, userId, cursor, viewerUserId = userId) {
  const session = monitorPrivateSession || await instagramPrivateSession({
    userId: viewerUserId,
    cookieStoreId: monitorTransportCookieStoreId,
  });
  monitorPrivateSession = session;

  const params = new URLSearchParams({
    count: String(MONITOR_PAGE_SIZE),
    search_surface: "follow_list_page",
  });
  if (cursor) params.set("max_id", String(cursor));
  const path = `/api/v1/friendships/${encodeURIComponent(userId)}/${kind}/?${params}`;
  const attempts = [];
  let lastResult = null;

  // O executor mobile usa o sessionid autenticado num header Authorization e não depende
  // do ciclo de vida do separador Gecko. O web-session fica como fallback.
  for (const executor of (globalThis.__FOLLOWCHECK_IOS_SHELL__ ? ["web-session"] : ["mobile-session", "web-session"])) {
    let result;
    try {
      result = await executeInstagramRequest(executor, path, session);
    } catch (error) {
      attempts.push({ executor, status: 0, error: String(error?.message || "transport_failed").slice(0, 120) });
      continue;
    }
    lastResult = result;
    attempts.push({
      executor,
      status: Number(result.status || 0),
      contentType: String(result.contentType || "").slice(0, 100),
      ok: Boolean(result.ok),
    });
    if (result.ok && Array.isArray(result.data?.users)) {
      return {
        users: result.data.users.map(monitorUser).filter((user) => user.id),
        expected: Number(result.data.count || result.data.total_count || 0),
        hasNext: Boolean(result.data.next_max_id ?? result.data.next_cursor ?? result.data.next_max_id_str),
        cursor: result.data.next_max_id ?? result.data.next_cursor ?? result.data.next_max_id_str ?? null,
        executor,
      };
    }
    const status = Number(result.status || 0);
    const message = String(result.data?.message || result.data?.error_type || "");
    if (status === 401 || status === 403 || /login_required|checkpoint_required|challenge_required/i.test(message)) {
      // A mobile-session sintética pode ser recusada mesmo com a web-session
      // Gecko totalmente autenticada. Testa o segundo executor antes de tirar
      // qualquer conclusão sobre a conta inteira.
      attempts[attempts.length - 1].error = "auth_rejected";
      continue;
    }
    if (status === 429 || /rate.?limit/i.test(String(result.data?.error_type || ""))) {
      const failure = monitorFailure("O Instagram limitou temporariamente a leitura. O Monitor vai respeitar um cooldown antes de voltar a tentar.", "rate_limited", status);
      failure.retryAfter = Math.max(0, Number(result.retryAfter || result.data?.retry_after || 0));
      throw failure;
    }
    if (/feedback_required|please wait a few minutes|try again later/i.test(message)) {
      attempts[attempts.length - 1].error = "soft_throttle";
      continue;
    }
  }

  const status = Number(lastResult?.status || 0);
  const softThrottle = attempts.some((attempt) => attempt.error === "soft_throttle");
  const authRejected = attempts.some((attempt) => attempt.error === "auth_rejected");
  if (authRejected) {
    const currentSession = await resolveMonitorInstagramSession(
      await getAnyInstagramTab(),
      "",
      userId,
    ).catch(() => null);
    if (currentSession?.sessionId && currentSession?.userId) {
      const failure = monitorFailure(
        "Os canais privados recusaram este pedido, mas a sessão da página continua autenticada. O snapshot válido foi preservado.",
        "private_auth_rejected",
        status,
      );
      failure.attempts = attempts;
      throw failure;
    }
    const failure = monitorFailure(
      currentSession?.logoutConfirmed
        ? "O Instagram abriu a página de login para esta conta. Inicia sessão para retomar o Monitor."
        : "Não foi possível confirmar a sessão neste check. O login e o snapshot existentes foram preservados.",
      currentSession?.logoutConfirmed ? "logout_confirmed" : "session_unverified",
      status,
    );
    failure.attempts = attempts;
    throw failure;
  }
  const failure = monitorFailure(
    `O canal autenticado não devolveu uma página JSON válida durante ${kind === "followers" ? "a leitura dos seguidores" : "a leitura das contas seguidas"}.`,
    softThrottle
      ? "soft_throttle"
      : status >= 500 || status === 0 ? "private_transport_error" : "private_invalid_response",
    status,
  );
  failure.attempts = attempts;
  throw failure;
}

function monitorMainListPage(payload, executor) {
  const users = payload.users.map(monitorUser);
  if (users.some(user => !/^\d{1,32}$/.test(user.id))) {
    throw monitorFailure("A lista contém identidades inválidas. A referência anterior foi preservada.", "shape_changed");
  }
  const cursor = [payload.next_max_id, payload.next_cursor, payload.next_max_id_str]
    .find(value => value != null && String(value) !== "") ?? null;
  if (cursor !== null && ((typeof cursor !== "string" && (typeof cursor !== "number" || !Number.isSafeInteger(cursor))) || String(cursor).length > 2048)) {
    throw monitorFailure("O cursor da lista não tem um formato que possa ser transmitido sem perda.","pagination_cursor_invalid");
  }
  if ((payload.has_more === true && cursor === null) || (payload.has_more === false && cursor !== null)) {
    throw monitorFailure("O Instagram devolveu sinais de paginação contraditórios. A lista não foi tratada como completa.", "pagination_incomplete");
  }
  return {
    users,
    expected: Number(payload.total_count || payload.count || 0),
    hasNext: cursor !== null,
    cursor,
    executor,
  };
}

async function monitorFetchPage(kind, transport, userId, cursor, viewerUserId = userId) {
  if (transport === "main") {
    const url = new URL(monitorRestUrl(kind, userId, cursor));
    const path = url.pathname + url.search;
    const response = await executeInstagramPageRequest(path);
    if (!response?.ok || !Array.isArray(response?.data?.users)) {
      const status = Number(response?.status || 0);
      if (status === 429 || response?.code === "rate_limited") {
        const failure=monitorFailure("A leitura da lista recebeu HTTP 429. A recolha parou sem mudar de canal.","rate_limited",429);
        failure.retryAfter=Number(response?.retryAfter)||0;
        throw failure;
      }
      if (response?.securityWarning || ["instagram_security_warning", "challenge_required"].includes(response?.code)) {
        const failure = monitorFailure(
          "O Instagram apresentou um aviso de segurança. O FollowCheck parou e não fará mais pedidos até confirmares o aviso no Instagram.",
          response?.code === "challenge_required" ? "challenge_required" : "instagram_security_warning",
          status,
        );
        failure.transport = "page-main";
        throw failure;
      }
      if (response?.code === "soft_throttle") {
        const failure=monitorFailure("O Instagram sinalizou uma restrição temporária de atividade. O check parou e a referência anterior foi preservada.","soft_throttle",status);
        failure.retryAfter=Number(response?.retryAfter)||0;
        failure.restrictionSignal=response?.restrictionSignal || null;
        failure.transport="page-main";
        throw failure;
      }
      const failureCode = response?.code || (status === 400 ? "list_request_rejected" :
        status === 401 || status === 403 ? "page_main_rejected" : status > 0 ? "list_response_invalid" : "page_main_unavailable");
      const detail = backgroundRedact(String(response?.apiMessage || "").replace(/https?:\/\/[^\s<>]+/gi,"[URL removido]"), 200);
      const failure = monitorFailure(
        `O Instagram ${status > 0 ? `recusou a leitura da lista (HTTP ${status})` : "não respondeu à leitura da lista"}${detail ? `: ${detail}` : "."}`,
        failureCode, status,
      );
      failure.transport = "page-main";
      failure.apiMessage = detail;
      failure.apiErrorType = response?.apiErrorType || "";
      failure.retryAfter = Number(response?.retryAfter) || 0;
      throw failure;
    }
    return monitorMainListPage(response.data, response.executor || "page-main");
  }
  if (transport === "private") {
    return monitorFetchPrivatePage(kind, userId, cursor, viewerUserId);
  }
  if (transport === "rest") {
    const payload = await monitorFetchJson(
      monitorRestUrl(kind, userId, cursor),
      kind === "followers" ? "a leitura dos seguidores" : "a leitura das contas seguidas",
    );
    if (!Array.isArray(payload?.users)) {
      throw monitorFailure("A estrutura da lista de relações mudou.", "shape_changed");
    }
    return {
      users: payload.users.map(monitorUser).filter((user) => user.id),
      expected: Number(payload.count || payload.total_count || 0),
      hasNext: Boolean(payload.next_max_id ?? payload.next_cursor ?? payload.next_max_id_str),
      cursor: payload.next_max_id ?? payload.next_cursor ?? payload.next_max_id_str ?? null,
    };
  }
  const payload = await monitorFetchJson(
    monitorGraphqlUrl(kind, userId, cursor),
    kind === "followers" ? "a leitura alternativa dos seguidores" : "a leitura alternativa das contas seguidas",
  );
  const connection = kind === "followers"
    ? payload?.data?.user?.edge_followed_by
    : payload?.data?.user?.edge_follow;
  if (!connection || !Array.isArray(connection.edges)) {
    throw monitorFailure("A estrutura alternativa da lista de relações mudou.", "shape_changed");
  }
  return {
    users: connection.edges.map((edge) => monitorUser(edge?.node)).filter((user) => user.id),
    expected: Number(connection.count || 0),
    hasNext: Boolean(connection.page_info?.has_next_page),
    cursor: connection.page_info?.end_cursor || null,
  };
}

// Short-lived, account-scoped checkpoints are never exposed as complete snapshots.
const iosListCheckpoints = new Map();
const IOS_CHECKPOINT_KEY='followcheck:ios:list-checkpoints:v1';
let iosCheckpointsLoaded=false;
let iosCheckpointWrites=Promise.resolve();
async function restoreIOSListCheckpoints() {
  if(!globalThis.__FOLLOWCHECK_IOS_SHELL__ || iosCheckpointsLoaded)return;
  iosCheckpointsLoaded=true;
  const stored=await chrome.storage.local.get(IOS_CHECKPOINT_KEY);
  for(const [key,value] of Object.entries(stored[IOS_CHECKPOINT_KEY]||{})) {
    if(value?.paginationVersion === 4 &&
       Date.now()-Number(value.at)<15*60_000 && Number(value.at)<=Date.now() &&
       Array.isArray(value.users) && Array.isArray(value.cursors))iosListCheckpoints.set(key,value);
  }
}
function persistIOSListCheckpoints() {
  if(!globalThis.__FOLLOWCHECK_IOS_SHELL__)return Promise.resolve();
  const value=Object.fromEntries([...iosListCheckpoints].filter(([,v])=>Date.now()-v.at<15*60_000));
  // Bounded local checkpoint, never promoted to an audience snapshot or exported.
  if(JSON.stringify(value).length>8_000_000)return Promise.resolve();
  iosCheckpointWrites=iosCheckpointWrites.catch(()=>{}).then(()=>chrome.storage.local.set({[IOS_CHECKPOINT_KEY]:value}));
  return iosCheckpointWrites;
}
function clearIOSListCheckpoints(profileId = null) {
  for (const [key,value] of iosListCheckpoints) if (!profileId || value.profileId === profileId) iosListCheckpoints.delete(key);
  void persistIOSListCheckpoints().catch(()=>{});
}
async function monitorCollectList(kind, userId, profileId, rangeStart, rangeEnd, viewerUserId = userId, options = {}) {
  let knownTotal = Number.isSafeInteger(options.expected) && options.expected >= 0 ? options.expected : null;
  const checkpointKey = `${viewerUserId}:${profileId}:${userId}:${kind}`;
  await restoreIOSListCheckpoints();
  const saved = globalThis.__FOLLOWCHECK_IOS_SHELL__ ? iosListCheckpoints.get(checkpointKey) : null;
  let surplusCandidate = null;
  if (options.allowStableSurplus === true && saved?.paginationVersion === 4 && saved.pass === 2 &&
      Date.now()-Number(saved.at) < 15*60_000 && Number(saved.at) <= Date.now() &&
      saved.knownTotal === knownTotal && saved.surplusCandidate?.expected === knownTotal &&
      saved.surplusCandidate.ids?.length > knownTotal &&
      sameMonitorIdentitySet(saved.surplusCandidate.ids,saved.surplusCandidate.ids)) {
    surplusCandidate = saved.surplusCandidate;
  }
  // A recovery is a fresh traversal, never a union of different observations.
  // Otherwise membership churn with an unchanged count could fabricate completeness.
  for (let pass = 1; pass <= 2; pass += 1) {
    const result = await monitorCollectListPass(kind, userId, profileId, rangeStart, rangeEnd, viewerUserId, {knownTotal, pass, surplusCandidate, stopWhenShuffled: options.stopWhenShuffled === true});
    const surplusEligible = options.allowStableSurplus === true && knownTotal !== null &&
      result.terminal === true && result.users.length > knownTotal && result.duplicates === 0;
    if (surplusEligible && surplusCandidate && surplusCandidate.expected === knownTotal &&
        sameMonitorIdentitySet(surplusCandidate.ids,result.users.map(user=>String(user.id)))) {
      const verified={...result,enumerationVerified:true,countVerified:false,validationMode:"stable-surplus",independentPasses:2,stableIdentityIds:surplusCandidate.ids};
      postMonitorDiagnostic(profileId,"enumeration_stable",{list:kind,observed:result.users.length,reported:knownTotal,independentPasses:2,countVerified:false});
      return verified;
    }
    // A shuffled list was already stopped early; another pass cannot converge.
    if (result.orderingUnstable === true) {
      iosListCheckpoints.delete(checkpointKey);
      await persistIOSListCheckpoints();
      return result;
    }
    // Device diagnostic 2026-10-17 (build 33): a terminal list with no repeated
    // account read 344 against a counter of 343, and the full re-read that followed
    // spent 14 requests shortly before Instagram's spam limit. Instagram counters
    // lag and include hidden accounts, so a small drift on a clean terminal list is
    // accepted in one pass. Removals still need two consecutive observations.
    const drift = knownTotal === null ? 0 : result.users.length - knownTotal;
    if (options.acceptCountDrift === true && result.terminal === true && result.duplicates === 0 &&
        drift !== 0 && Math.abs(drift) <= watchlistDriftTolerance(knownTotal)) {
      postMonitorDiagnostic(profileId, "count_drift_accepted", {list: kind, observed: result.users.length, reported: knownTotal, drift});
      iosListCheckpoints.delete(checkpointKey);
      await persistIOSListCheckpoints();
      return {...result, enumerationVerified: true, countVerified: false, validationMode: "terminal-drift", countDrift: drift};
    }
    if (knownTotal === null || result.coverageComplete || result.pass >= 2) return result;
    // Instagram served the full row count but repeated a significant share of
    // the accounts: its own ordering shuffles this list, so another traversal
    // cannot converge and would only double the requests. Report the visible
    // observation honestly instead of retrying.
    if (watchlistOrderingUnstable(result, knownTotal)) {
      postMonitorDiagnostic(profileId, "ordering_unstable", {
        list: kind, observed: result.users.length, expected: knownTotal,
        receivedUsers: result.receivedUsers, duplicates: result.duplicates,
      });
      iosListCheckpoints.delete(checkpointKey);
      await persistIOSListCheckpoints();
      return {...result, orderingUnstable: true, validationMode: "partial-observation"};
    }
    if (typeof options.recheckExpected === "function") {
      const fresh = await options.recheckExpected();
      if (!Number.isSafeInteger(fresh) || fresh < 0) throw monitorFailure("O perfil não confirmou um total exato após a leitura.","watch_counts_unavailable");
      postMonitorDiagnostic(profileId,"count_rechecked",{list:kind,before:knownTotal,after:fresh,collected:result.users.length,duplicates:result.duplicates});
      // A shortage still blocks comparison. A surplus can only be accepted after
      // one independent traversal returns the very same identities.
      if (fresh === knownTotal && result.duplicates === 0 && !surplusEligible) return result;
      if (surplusEligible && fresh === knownTotal) surplusCandidate={expected:knownTotal,ids:result.users.map(user=>String(user.id))};
      knownTotal = fresh;
    } else if (surplusEligible) {
      surplusCandidate={expected:knownTotal,ids:result.users.map(user=>String(user.id))};
    }
    iosListCheckpoints.delete(checkpointKey);
    await persistIOSListCheckpoints();
    postMonitorDiagnostic(profileId, "coverage_retry", {
      list: kind, pass, users: result.users.length, expected: knownTotal,
      duplicates: result.duplicates, receivedUsers: result.receivedUsers,
    });
    postMonitorProgress(profileId, "A confirmar a cobertura",
      `${result.users.length} de ${knownTotal} perfis • uma releitura de ${kind === "followers" ? "seguidores" : "contas seguidas"}`,
      Math.max(rangeStart, rangeEnd - 1));
    await monitorSleep(Math.max(10000, activeMonitorPacing.pageDelayMaxMs));
    globalThis.__FOLLOWCHECK_IOS_ASSERT_ACTIVE__?.();
  }
}

// When Instagram refuses another account's followers list, the next checks read only
// the accounts it follows and try the followers again after 24 h, 48 h, then up to 7 days.
// A successful followers read clears the backoff.
const WATCHLIST_FOLLOWERS_BACKOFF_HOURS = [24, 48, 96, 168];
function watchlistFollowersBackoff(previous, result, at) {
  const followers = result?.partialLists?.followers;
  if (followers?.interrupted === true) {
    const level = Math.min(WATCHLIST_FOLLOWERS_BACKOFF_HOURS.length - 1, Number(previous?.followersBackoffLevel ?? -1) + 1);
    return { followersBackoffLevel: level, followersBackoffUntil: at + WATCHLIST_FOLLOWERS_BACKOFF_HOURS[level] * 3_600_000 };
  }
  if (followers?.skipped === true) return {};
  return { followersBackoffLevel: -1, followersBackoffUntil: 0 };
}

function watchlistDriftTolerance(reported) {
  return Math.max(2, Math.ceil(Number(reported || 0) * 0.01));
}

function watchlistOrderingUnstable(result, knownTotal) {
  if (result?.terminal !== true || !Number.isSafeInteger(knownTotal) || knownTotal <= 0) return false;
  const observed = Number(result.users?.length || 0), duplicates = Number(result.duplicates || 0);
  return observed < knownTotal && duplicates >= Math.max(3, Math.ceil(Number(result.receivedUsers || 0) * 0.02));
}

async function monitorCollectListPass(kind, userId, profileId, rangeStart, rangeEnd, viewerUserId = userId, options = {}) {
  // A primeira tentativa corre no mundo MAIN da página autenticada. Evita depender
  // de cookies HttpOnly invisíveis ao content-script e elimina o ciclo REST →
  // GraphQL que deixava a interface parada nos 21–23%.
  // Account-safety policy: relationship scans use one web-page channel only.
  // A rejected request stops the check and preserves the last valid snapshot;
  // it never escalates to GraphQL or a mobile/private client impersonation.
  const transportOrder = ["main"];
  let transportIndex = 0;
  let transport = transportOrder[transportIndex];
  const attempted = new Set();
  const cursors = new Set();
  const users = new Map();
  let cursor = null;
  let hasNext = true;
  const knownTotal = options.knownTotal ?? null;
  let expected = knownTotal ?? 0;
  let pageNumber = 0;
  let receivedUsers = 0;
  let pass = options.pass || 1;
  await restoreIOSListCheckpoints();
  const checkpointKey = `${viewerUserId}:${profileId}:${userId}:${kind}`;
  const checkpoint = globalThis.__FOLLOWCHECK_IOS_SHELL__ ? iosListCheckpoints.get(checkpointKey) : null;
  if (checkpoint && checkpoint.paginationVersion === 4 && checkpoint.knownTotal === knownTotal && Date.now()-checkpoint.at < 15*60_000) {
    checkpoint.users.forEach(user=>users.set(user.id,user));
    checkpoint.cursors.forEach(value=>cursors.add(value));
    cursor=checkpoint.cursor;hasNext=checkpoint.hasNext;expected=checkpoint.expected;pageNumber=checkpoint.pageNumber;
    receivedUsers=checkpoint.receivedUsers;pass=checkpoint.pass || pass;
    monitorSuccessfulPageCount=Math.max(monitorSuccessfulPageCount,Number(checkpoint.scanPageCount)||0);
    postMonitorDiagnostic(profileId,'checkpoint_resumed',{list:kind,users:users.size,page:pageNumber});
  } else { iosListCheckpoints.delete(checkpointKey); }
  const transportAttempts = [];
  postMonitorDiagnostic(profileId, "transport_chosen", {
    list: kind,
    transport,
    attempt: 1,
  });

  while (hasNext) {
    attempted.add(transport);
    let page;
    try {
      page = await monitorFetchPage(kind, transport, userId, cursor, viewerUserId);
    } catch (error) {
      transportAttempts.push({
        transport,
        outcome: "stopped",
        code: String(error?.code || "transport_failed"),
        status: Number(error?.status || 0),
        pages: pageNumber,
        apiMessage: error?.apiMessage || "",
        apiErrorType: error?.apiErrorType || "",
        restrictionSignal: error?.restrictionSignal || null,
      });
      postMonitorDiagnostic(profileId, "transport_stopped", {
        list: kind,
        transport,
        code: String(error?.code || "transport_failed"),
        status: Number(error?.status || 0),
        pages: pageNumber,
        apiMessage: error?.apiMessage || "",
        apiErrorType: error?.apiErrorType || "",
        restrictionSignal: error?.restrictionSignal || null,
      });
      if (error && typeof error === "object") error.partialObservation = {list: kind, observed: users.size, receivedUsers, duplicates: receivedUsers - users.size, pages: pageNumber};
      if (["logout_confirmed", "challenge_required", "rate_limited"].includes(error?.code)) throw error;
      let nextTransport = null;
      while (++transportIndex < transportOrder.length) {
        if (!attempted.has(transportOrder[transportIndex])) {
          nextTransport = transportOrder[transportIndex];
          break;
        }
      }
      if (!nextTransport) throw error;

      // Cada transporte tem o seu próprio cursor. Reiniciamos a lista por completo para
      // nunca comparar ou persistir uma audiência parcial.
      transport = nextTransport;
      cursor = null;
      hasNext = true;
      expected = 0;
      pageNumber = 0;
      users.clear();
      cursors.clear();
      postMonitorDiagnostic(profileId, "transport_chosen", {
        list: kind,
        transport,
        attempt: transportIndex + 1,
      });
      postMonitorProgress(
        profileId,
        "A recuperar leitura",
        `A mudar para o canal ${transport === "rest" ? "Web" : "GraphQL"} e a reiniciar ${kind === "followers" ? "seguidores" : "contas seguidas"}`,
        Math.max(rangeStart, Math.round((rangeStart + rangeEnd) / 2) - 2),
      );
      await monitorSleep(1000 + Math.round(Math.random() * 700));
      continue;
    }

    if (knownTotal === null) expected ||= page.expected;
    const previousSize = users.size;
    page.users.forEach((user) => users.set(user.id, user));
    receivedUsers += page.users.length;
    monitorSuccessfulPageCount += 1;
    hasNext = page.hasNext;
    cursor = page.cursor;
    pageNumber += 1;
    postMonitorDiagnostic(profileId, "page_loaded", {
      list: kind,
      transport,
      page: pageNumber,
      users: users.size,
      expected,
      hasNext,
      pass,
      received: page.users.length,
      added: users.size - previousSize,
      duplicates: page.users.length - (users.size - previousSize),
      receivedUsers,
    });
    // Instagram shuffles some lists of other accounts: pages start repeating people.
    // More pages only add fewer new people and push towards the spam limit, so the
    // observation stops here and is reported as partial (never compared).
    const repeated = receivedUsers - users.size;
    if (options.stopWhenShuffled === true && hasNext && knownTotal !== null && pageNumber >= 4 &&
        repeated >= Math.max(8, Math.ceil(receivedUsers * 0.05))) {
      postMonitorDiagnostic(profileId, "ordering_unstable", {list: kind, pages: pageNumber, observed: users.size, expected: knownTotal, receivedUsers, duplicates: repeated, stoppedEarly: true});
      iosListCheckpoints.delete(checkpointKey);
      await persistIOSListCheckpoints().catch(() => {});
      return {users: [...users.values()], transport, pages: pageNumber, expected, coverageComplete: false, terminal: true,
        stoppedEarly: true, orderingUnstable: true, enumerationVerified: false, countVerified: false,
        validationMode: "partial-observation", pass, receivedUsers, duplicates: repeated, attempts: transportAttempts};
    }
    if (hasNext) {
      const cursorKey = String(cursor || "");
      if (!cursorKey || cursors.has(cursorKey)) {
        iosListCheckpoints.delete(checkpointKey);
        throw monitorFailure(
          "O Instagram repetiu a mesma página. O Monitor parou para não guardar uma lista incompleta.",
          "pagination_incomplete",
        );
      }
      cursors.add(cursorKey);
    }
    if (globalThis.__FOLLOWCHECK_IOS_SHELL__) {
      iosListCheckpoints.set(checkpointKey,{paginationVersion:4,profileId,at:Date.now(),users:[...users.values()],cursors:[...cursors],cursor,hasNext,expected,knownTotal,pageNumber,receivedUsers,pass,scanPageCount:monitorSuccessfulPageCount,surplusCandidate:options.surplusCandidate || null});
      await persistIOSListCheckpoints().catch(()=>{});
    }
    const fraction = hasNext
      ? expected > 0
        ? Math.min(0.98, users.size / expected)
        : Math.min(0.95, pageNumber / (pageNumber + 3))
      : knownTotal === null || users.size === knownTotal ? 1 : Math.min(0.98, users.size / Math.max(1, knownTotal));
    const percentage = Math.round(rangeStart + fraction * (rangeEnd - rangeStart));
    const channel = transport === "main" ? "Página Instagram" : transport === "private" ? "Pulse" : transport === "rest" ? "Web" : "GraphQL";
    postMonitorProgress(
      profileId,
      kind === "followers" ? "A confirmar seguidores" : "A recolher contas seguidas",
      `${users.size}${expected ? ` de ${expected}` : ""} perfis • canal ${channel}`,
      percentage,
    );

    if (hasNext) {
      await monitorSleep(
        activeMonitorPacing.pageDelayMinMs
        + Math.random() * (activeMonitorPacing.pageDelayMaxMs - activeMonitorPacing.pageDelayMinMs),
      );
      if (activeMonitorPacing.pauseEveryPages > 0
          && activeMonitorPacing.pauseDurationMs > 0
          && monitorSuccessfulPageCount % activeMonitorPacing.pauseEveryPages === 0) {
        const pause = activeMonitorPacing.pauseDurationMs;
        postMonitorProgress(
          profileId,
          "Pausa protetora",
          `O scan retoma automaticamente em ${Math.max(1, Math.round(pause / 1000))} s`,
          percentage,
        );
        await monitorSleep(pause);
      }
    }
  }
  // Nunca promover uma leitura materialmente truncada a snapshot válido.
  // Isto protege contra falsos follows/unfollows quando a paginação do Instagram
  // termina cedo ou devolve páginas inconsistentes.
  if (knownTotal === null && expected > 0) {
    const tolerance = Math.min(Math.max(0, expected - 1), Math.floor(expected * 0.005));
    if (Math.abs(users.size - expected) > tolerance) {
      iosListCheckpoints.delete(checkpointKey);
      throw monitorFailure(
        `A leitura terminou com ${users.size} de ${expected} perfis. O snapshot foi descartado para proteger o histórico.`,
        "pagination_incomplete",
      );
    }
  }
  const coverageComplete = knownTotal === null ? (expected > 0 ? users.size === expected : null) : users.size === knownTotal;
  const outcome = coverageComplete === false ? "incomplete" : knownTotal === null && expected === 0 ? "exhausted" : "success";
  transportAttempts.push({
    transport,
    outcome,
    status: 200,
    pages: pageNumber,
    users: users.size,
  });
  postMonitorDiagnostic(profileId, outcome === "success" ? "transport_success" : "list_coverage_" + outcome, {
    list: kind,
    transport,
    pages: pageNumber,
    users: users.size,
    expected,
    pass,
    receivedUsers,
    duplicates: receivedUsers - users.size,
    coverageComplete,
  });
  return {
    users: [...users.values()],
    transport,
    pages: pageNumber,
    expected,
    coverageComplete,
    terminal:true,
    enumerationVerified:coverageComplete === true,
    countVerified:coverageComplete === true,
    validationMode:coverageComplete === true ? "count-matched" : "unverified",
    pass,
    receivedUsers,
    duplicates: receivedUsers - users.size,
    attempts: transportAttempts,
  };
}

function monitorChanges(previous = [], current = []) {
  const previousMap = new Map(previous.map((user) => [String(user.id), user]));
  const currentMap = new Map(current.map((user) => [String(user.id), user]));
  return {
    added: current.filter((user) => !previousMap.has(String(user.id))),
    removed: previous.filter((user) => !currentMap.has(String(user.id))),
  };
}


function monitorAvailabilityKey(accountId) {
  return `${MONITOR_STORAGE_PREFIX}:availability:${String(accountId || "")}`;
}

function monitorArrivalKey(accountId) {
  return `${MONITOR_STORAGE_PREFIX}:arrivals:${String(accountId || "")}`;
}

async function monitorClassifyFollowerDelta(accountId, previousFollowers, currentFollowers, profileId) {
  const delta = monitorChanges(previousFollowers, currentFollowers);
  // The two complete lists were count-validated before this function runs.
  // Their delta is authoritative enough for the UI and history. The previous
  // build multiplied each change into relationship and profile-info requests,
  // which could turn one scan into dozens of recognisably automated calls.
  postMonitorDiagnostic(profileId, "delta_confirmed_by_complete_snapshot", {
    newFollowers: delta.added.length,
    lostFollowers: delta.removed.length,
    extraProfileRequests: 0,
  });
  await chrome.storage.local.set({
    [monitorAvailabilityKey(accountId)]: { version: 3, updatedAt: Date.now(), users: {} },
    [monitorArrivalKey(accountId)]: { version: 2, updatedAt: Date.now(), users: {} },
  });
  return {
    newFollowers: delta.added,
    lostFollowers: delta.removed,
    reactivated: [],
    unavailable: [],
  };
}

function monitorAudienceFromStoredSnapshot(snapshot = {}) {
  if (Array.isArray(snapshot.audience)) return snapshot.audience;
  const followers = Array.isArray(snapshot.followers) ? snapshot.followers : [];
  const following = Array.isArray(snapshot.following) ? snapshot.following : [];
  const followerIds = new Set(followers.map((user) => String(user?.id || user?.pk || "")));
  const followerProfiles = new Map(followers.map(user=>[String(user?.id || user?.pk || ''),user]));
  const audience = new Map();
  following.forEach((user) => {
    const id = String(user?.id || user?.pk || "");
    if (!id) return;
    audience.set(id, {
      ...user,
      id,
      profile_pic_url: user.profile_pic_url || user.profilePicUrl || followerProfiles.get(id)?.profile_pic_url || followerProfiles.get(id)?.profilePicUrl || '',
      followed_by_viewer: true,
      follows_viewer: followerIds.has(id),
      relationship_verified: true,
      relationship_source: "followers-list",
    });
  });
  followers.forEach((user) => {
    const id = String(user?.id || user?.pk || "");
    if (!id || audience.has(id)) return;
    audience.set(id, {
      ...user,
      id,
      followed_by_viewer: false,
      follows_viewer: true,
      relationship_verified: true,
      relationship_source: "followers-list",
    });
  });
  return [...audience.values()];
}

async function monitorAudienceReplay(accountId) {
  const safeAccountId = String(accountId || "").trim();
  if (!/^\d{1,32}$/.test(safeAccountId)) return null;
  const storageKey = `${MONITOR_STORAGE_PREFIX}:${safeAccountId}`;
  const stored = await chrome.storage.local.get(storageKey).catch(() => ({}));
  const snapshot = stored?.[storageKey];
  const completedAt = Number(snapshot?.completedAt || 0);
  if (!snapshot || !Number.isFinite(completedAt) || completedAt <= 0) return null;
  return {
    accountId: safeAccountId,
    audience: monitorAudienceFromStoredSnapshot(snapshot),
    completedAt: new Date(completedAt).toISOString(),
    complete: snapshot.complete !== false,
  };
}

function recoveredOwnMonitorResult(message, snapshot, accountId, completedAt) {
  const pending = snapshot?.pendingNativeResult;
  if (pending?.event === "monitor_result"
      && String(pending.accountId || "") === String(accountId)
      && Number(pending.completedAt || 0) === Number(completedAt)) {
    return {
      ...pending,
      profileId: String(message.profileId || ""),
      checkId: String(message.checkId || ""),
      diagnostics: {
        ...(pending.diagnostics || {}),
        recoveredAfterFinalizationFailure: true,
      },
    };
  }
  const followers = Array.isArray(snapshot?.followers) ? snapshot.followers : [];
  const following = Array.isArray(snapshot?.following) ? snapshot.following : [];
  const audience = monitorAudienceFromStoredSnapshot(snapshot);
  const followerIds = new Set(followers.map((user) => String(user?.id || user?.pk || "")));
  const followingIds = new Set(following.map((user) => String(user?.id || user?.pk || "")));
  const mutuals = following.filter((user) => followerIds.has(String(user?.id || user?.pk || ""))).length;
  const nonFollowers = Math.max(0, following.length - mutuals);
  const fans = followers.filter((user) => !followingIds.has(String(user?.id || user?.pk || ""))).length;
  const healthScore = following.length
    ? Math.max(0, Math.min(100, Math.round(100 - ((nonFollowers / following.length) * 55))))
    : 0;
  const recoveredChanges = snapshot?.pendingChanges?.schemaVersion === 2
    ? snapshot.pendingChanges
    : {
        schemaVersion: 2,
        newFollowers: [],
        lostFollowers: [],
        unavailableAccounts: [],
        reactivatedAccounts: [],
      };
  return {
    event: "monitor_result",
    profileId: String(message.profileId || ""),
    checkId: String(message.checkId || ""),
    accountId: String(accountId),
    baseline: false,
    completedAt,
    snapshot: {
      accountId: String(accountId),
      username: validInstagramUsername(message.username),
      lastScanAt: new Date(completedAt).toISOString(),
      audience: audience.length,
      followers: followers.length,
      following: following.length,
      mutuals,
      nonFollowers,
      fans,
      protectedCount: 0,
      historyCount: 0,
      healthScore,
      updatedAt: completedAt,
    },
    // Builds anteriores guardavam as listas completas, mas não o delta terminal.
    // Nunca inventar eventos ao recuperar esse snapshot legado.
    changes: recoveredChanges,
    diagnostics: {
      transport: { following: "durable-replay", followers: "durable-replay" },
      pages: { following: 0, followers: 0 },
      expected: { following: following.length, followers: followers.length },
      attempts: { following: [], followers: [] },
      snapshotValidation: "complete",
      audienceDelivery: "durable-replay",
      audienceAcknowledged: true,
      audienceCount: audience.length,
      audienceCompletedAt: new Date(completedAt).toISOString(),
      recoveredAfterFinalizationFailure: true,
      recoveredLegacyDelta: snapshot?.pendingChanges?.schemaVersion !== 2,
    },
  };
}

async function recoverCommittedOwnMonitorResult(message = {}) {
  const pacing = await resolveMonitorPacing(message);
  const budget = await readGlobalScanBudget(pacing);
  const requestedAccountId = String(message.accountId || "").trim();
  if (!/^\d{1,32}$/.test(requestedAccountId)) return null;
  const storageKey = `${MONITOR_STORAGE_PREFIX}:${requestedAccountId}`;
  const stored = await chrome.storage.local.get(storageKey).catch(() => ({}));
  const snapshot = stored?.[storageKey];
  const completedAt = Number(snapshot?.completedAt || 0);
  const requestedCheckId = String(message.checkId || "").trim();
  const snapshotCheckId = String(
    snapshot?.checkId || snapshot?.pendingNativeResult?.checkId || "",
  ).trim();
  const sameCheck = Boolean(
    requestedCheckId && snapshotCheckId && requestedCheckId === snapshotCheckId,
  );
  // A recuperação termina apenas o mesmo check que ficou por finalizar. Uma
  // nova execução manual/automática tem outro checkId e deve consultar de novo
  // o Instagram, em vez de reproduzir indefinidamente o snapshot anterior.
  if (!sameCheck) {
    if (snapshot?.complete === true && requestedCheckId) {
      await backgroundLog("debug", "monitor", "recovery-skipped-new-check",
        "O resultado guardado pertence a outro check; esta execução vai obter dados novos.", {
          profileId: String(message.profileId || ""),
          requestedCheckId,
          snapshotCheckId,
          snapshotCompletedAt: completedAt || null,
        });
    }
    return null;
  }
  const committedSnapshot = snapshot?.complete === true
    && completedAt > 0
    && completedAt === Number(budget.lastCompletedAt || 0);
  const reconciliationPending = snapshot?.complete === true
    && snapshot?.pendingDelivery === true;
  if (budget.lastTask !== "own-account" && !reconciliationPending) return null;
  if (!committedSnapshot && !reconciliationPending) {
    if (budget.nextAllowedAt > Date.now() && !snapshot) {
      await chrome.storage.local.remove(GLOBAL_SCAN_BUDGET_KEY).catch(() => {});
      await backgroundLog("warn", "safety", "orphan-budget-released",
        "O orçamento apontava para um snapshot inexistente e foi libertado para uma nova tentativa.", {
          task: budget.lastTask,
          lastCompletedAt: budget.lastCompletedAt,
        });
    }
    return null;
  }
  const audience = monitorAudienceFromStoredSnapshot(snapshot);
  postMonitorProgress(String(message.profileId || ""), "A recuperar resultado guardado", "Sem voltar a consultar o Instagram", 95);
  const acknowledgment = await sendAudienceToPage(
    requestedAccountId,
    audience,
    new Date(completedAt).toISOString(),
  );
  if (!acknowledgment?.ok) {
    throw monitorFailure(
      "O snapshot completo está seguro, mas a interface ainda não confirmou a reconciliação. Tenta abrir novamente a app.",
      "audience_reconciliation_failed",
    );
  }
  const result = recoveredOwnMonitorResult(message, snapshot, requestedAccountId, completedAt);
  result.diagnostics.audienceDelivery = acknowledgment?.dispatched ? "live-replay" : "durable-replay";
  result.diagnostics.audienceAcknowledged = true;
  await chrome.storage.local.set({
    [storageKey]: {
      ...snapshot,
      pendingNativeResult: result,
      pendingDelivery: false,
    },
  });
  if (!committedSnapshot) await commitGlobalScanBudget("own-account", completedAt, pacing);
  await backgroundLog("info", "monitor", "own-check-recovered",
    "O snapshot completo foi reconciliado sem repetir pedidos Instagram.", {
      followers: Number(result.snapshot?.followers || 0),
      following: Number(result.snapshot?.following || 0),
      checkId: String(message.checkId || ""),
      completedAt,
    });
  if (!nativePort) {
    throw monitorFailure("O resultado ficou guardado, mas a ponte Android desligou antes da confirmação.", "native_bridge_unavailable");
  }
  nativePort.postMessage(result);
  postMonitorStopped(String(message.profileId || ""), "Check recuperado", "Relações e histórico reconciliados sem novo scan.", "completed");
  return result;
}

async function sendAudienceToPage(accountId, audience, completedAt) {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  const instagramTabs = tabs.filter((candidate) => candidate?.id && (isInstagramUrl(candidate.url) || isInstagramUrl(candidate.pendingUrl)));
  instagramTabs.sort((a, b) => {
    const ap = a.id === monitorTransportTabId ? 3 : a.active ? 2 : 1;
    const bp = b.id === monitorTransportTabId ? 3 : b.active ? 2 : 1;
    return bp - ap;
  });
  if (!instagramTabs.length) return { ok: false, error: "instagram_tab_missing" };
  const payload = {
    type: "FOLLOWCHECK_MONITOR_AUDIENCE_RESULT",
    accountId,
    audience,
    completedAt,
    complete: true,
  };
  const expectedTime = Date.parse(completedAt);
  for (const tab of instagramTabs) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const acknowledgment = await chrome.tabs.sendMessage(tab.id, payload).catch(() => null);
      if (!acknowledgment && attempt === 0) {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["mobile-bridge.js"] }).catch(() => null);
        await monitorSleep(120);
        continue;
      }
      const acknowledgedTime = Date.parse(String(acknowledgment?.completedAt || ""));
      const exact = acknowledgment?.ok === true
        && acknowledgment?.persisted === true
        && String(acknowledgment?.accountId || "") === String(accountId)
        && Number(acknowledgment?.count) === audience.length
        && Number.isFinite(acknowledgedTime)
        && acknowledgedTime === expectedTime;
      if (exact) return { ...acknowledgment, tabId: tab.id };
      break;
    }
  }
  return { ok: false, error: "audience_persistence_unconfirmed" };
}

function watchlistRegistryKey(ownerId) {
  return `${WATCHLIST_REGISTRY_PREFIX}:${String(ownerId || "")}`;
}

function watchlistEmptyState(ownerId = "") {
  return { schemaVersion: 2, ownerId: String(ownerId || ""), targets: [], events: [], unreadCount: 0, generatedAt: Date.now() };
}

async function watchlistOwnerId() {
  if (globalThis.__FOLLOWCHECK_IOS_SHELL__) return String(await getInstagramCookie("ds_user_id", "") || "");
  const remembered = await readLastInstagramSessionState().catch(() => ({}));
  if (String(remembered?.userId || "")) return String(remembered.userId);
  const tab = await getAnyInstagramTab().catch(() => null);
  const resolved = await resolveMonitorInstagramSession(tab).catch(() => null);
  return String(resolved?.userId || "");
}

async function readWatchlistState(ownerId) {
  if (!ownerId) return watchlistEmptyState();
  const key = watchlistRegistryKey(ownerId);
  const stored = await chrome.storage.local.get(key).catch(() => ({}));
  const value = stored?.[key] || {};
  const events = Array.isArray(value.events) ? value.events.slice(0, 1000) : [];
  return {
    schemaVersion: 2,
    ownerId,
    targets: Array.isArray(value.targets) ? value.targets.slice(0, 50) : [],
    events,
    unreadCount: events.filter((event) => !event?.read).length,
    generatedAt: Date.now(),
  };
}

async function writeWatchlistState(ownerId, state, broadcast = true) {
  const normalized = {
    schemaVersion: 2,
    ownerId,
    targets: (Array.isArray(state?.targets) ? state.targets : []).slice(0, 50),
    events: (Array.isArray(state?.events) ? state.events : []).slice(0, 1000),
    generatedAt: Date.now(),
  };
  await chrome.storage.local.set({ [watchlistRegistryKey(ownerId)]: normalized });
  const payload = { ...normalized, unreadCount: normalized.events.filter((event) => !event?.read).length };
  if (broadcast) await broadcastWatchlistState(payload);
  await scheduleWatchlistAlarm(payload.targets);
  return payload;
}

async function mirrorNativeWatchlistStatus(monitorStatus) {
  const ownerId = String(monitorStatus?.accountId || "");
  const watchlist = monitorStatus?.watchlist;
  if (!ownerId || !watchlist || !Array.isArray(watchlist.targets)) return;
  const local = await readWatchlistState(ownerId);
  const localById = new Map(local.targets.map((target) => [String(target.id || ""), target]));
  const localByUsername = new Map(local.targets.map((target) => [String(target.username || "").toLowerCase(), target]));
  const now = Date.now();
  const nativeIds = new Set();
  const nativeUsernames = new Set();
  const transitionEvents = [];
  const targets = watchlist.targets.slice(0, 50).map((target) => {
    const id = String(target?.id || "");
    const username = String(target?.username || "").toLowerCase();
    nativeIds.add(id);
    nativeUsernames.add(username);
    const previous = localById.get(id) || localByUsername.get(username) || {};
    const pendingAge = now - Number(previous?.queuedAt || 0);
    const keepPending = previous?.pendingNative === true
      && pendingAge >= 0
      && pendingAge < 20_000
      && target?.running !== true
      && !target?.lastError
      && Number(target?.lastSuccessAt || 0) <= Number(previous?.lastSuccessAt || 0);
    if (Number(target?.lastSuccessAt || 0) > Number(previous?.lastSuccessAt || 0)) {
      transitionEvents.push(watchlistEvent(
        target,
        "watch_check_completed",
        "Check concluído",
        "Listas completas guardadas e comparadas na Watchlist.",
        null,
        Number(target.lastSuccessAt || now),
      ));
    } else if (target?.lastError && String(target.lastError) !== String(previous?.lastError || "")) {
      transitionEvents.push(watchlistEvent(
        target,
        "watch_check_failed",
        "Check não concluído",
        String(target.lastError),
        null,
        Number(target.lastRunAt || now),
      ));
    }
    return {
      ...previous,
      ...target,
      fullName: String(target?.fullName || previous?.fullName || ""),
      profilePicUrl: String(target?.profilePicUrl || previous?.profilePicUrl || ""),
      running: target?.running === true || keepPending,
      pendingNative: keepPending,
      queuedAt: keepPending ? Number(previous?.queuedAt || now) : 0,
      progress: target?.running === true
        ? previous?.progress || { title: "Check em execução", detail: "A iniciar dentro da app", percentage: 1, stage: "starting", updatedAt: now }
        : keepPending ? previous?.progress : null,
    };
  });
  for (const previous of local.targets) {
    const id = String(previous?.id || "");
    const username = String(previous?.username || "").toLowerCase();
    if (nativeIds.has(id) || nativeUsernames.has(username)) continue;
    if (previous?.pendingNative === true && now - Number(previous?.queuedAt || 0) < 20_000) targets.push(previous);
  }
  const mergedEvents = [...transitionEvents, ...(Array.isArray(watchlist.events) ? watchlist.events : []), ...local.events]
    .filter((event, index, all) => event?.id && all.findIndex((candidate) => candidate?.id === event.id) === index)
    .sort((a, b) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0))
    .slice(0, 1000);
  const payload = {
    schemaVersion: 2,
    ownerId,
    targets: targets.slice(0, 50),
    events: mergedEvents,
    generatedAt: Number(watchlist.generatedAt || Date.now()),
  };
  await chrome.storage.local.set({ [watchlistRegistryKey(ownerId)]: payload });
  await broadcastWatchlistState({
    ...payload,
    unreadCount: payload.events.filter((event) => !event?.read).length,
  });
}

function acknowledgeNativeWatchlistStatus(monitorStatus) {
  const ownerId = String(monitorStatus?.accountId || "");
  nativeWatchlistStatusRevision += 1;
  for (const waiter of Array.from(nativeWatchlistStatusWaiters)) {
    if (waiter.ownerId && waiter.ownerId !== ownerId) continue;
    nativeWatchlistStatusWaiters.delete(waiter);
    clearTimeout(waiter.timer);
    waiter.resolve({
      confirmed: true,
      revision: nativeWatchlistStatusRevision,
      monitorStatus,
    });
  }
}

function waitForNativeWatchlistStatus(ownerId, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const waiter = {
      ownerId: String(ownerId || ""),
      resolve,
      timer: null,
    };
    waiter.timer = setTimeout(() => {
      nativeWatchlistStatusWaiters.delete(waiter);
      resolve({ confirmed: false, revision: nativeWatchlistStatusRevision });
    }, Math.max(1000, Number(timeoutMs || 5000)));
    nativeWatchlistStatusWaiters.add(waiter);
  });
}

async function discardPendingNativeWatchlistAdd(ownerId, username) {
  const normalizedUsername = validInstagramUsername(username || "").toLowerCase();
  const state = await readWatchlistState(ownerId);
  state.targets = state.targets.filter((target) => !(
    target?.pendingNative === true
    && String(target?.id || "") === `native-pending-${normalizedUsername}`
  ));
  return writeWatchlistState(ownerId, state);
}

async function synchronizeWatchlistTargetWithNative(ownerId, state, targetId) {
  const requestedTargetId = String(targetId || "");
  const sourceTarget = state.targets.find((target) => String(target?.id || "") === requestedTargetId) || null;
  const username = validInstagramUsername(sourceTarget?.username || "");
  if (!sourceTarget || !username) {
    await backgroundLog("warn", "watchlist", "native-sync-target-missing", "O perfil da Watchlist já não existe no estado local.", {
      ownerId,
      targetId: requestedTargetId,
    });
    return { ok: false, error: "O perfil já não existe na Watchlist. Atualiza a página e tenta novamente." };
  }
  if (!nativePort) {
    return { ok: false, error: "A fila única Android ainda não está ligada. Reabre a app e tenta novamente." };
  }

  const confirmation = waitForNativeWatchlistStatus(ownerId, 5000);
  nativePort.postMessage({
    event: "watchlist_import",
    ownerUserId: ownerId,
    watchlist: state,
  });
  await backgroundLog("info", "watchlist", "native-sync-requested", "Perfil enviado ao armazenamento Android antes do comando.", {
    ownerId,
    targetId: requestedTargetId,
    username,
    targets: state.targets.length,
  });

  const acknowledgement = await confirmation;
  if (!acknowledgement.confirmed) {
    await backgroundLog("warn", "watchlist", "native-sync-unconfirmed", "O Android não confirmou a sincronização da Watchlist a tempo.", {
      ownerId,
      targetId: requestedTargetId,
      username,
    });
    return { ok: false, error: "O motor Android não confirmou a sincronização. Reabre a app e tenta novamente." };
  }

  const refreshed = await readWatchlistState(ownerId);
  const authoritativeTarget = refreshed.targets.find((target) => String(target?.id || "") === requestedTargetId)
    || refreshed.targets.find((target) => String(target?.username || "").toLowerCase() === username.toLowerCase())
    || null;
  if (!authoritativeTarget) {
    await backgroundLog("warn", "watchlist", "native-sync-target-rejected", "O Android confirmou o estado, mas não devolveu o perfil pedido.", {
      ownerId,
      targetId: requestedTargetId,
      username,
    });
    return { ok: false, error: "O motor Android não guardou este perfil. Remove-o e adiciona-o novamente." };
  }

  await backgroundLog("info", "watchlist", "native-sync-confirmed", "Perfil confirmado no armazenamento Android.", {
    ownerId,
    requestedTargetId,
    targetId: String(authoritativeTarget.id || ""),
    username,
    revision: acknowledgement.revision,
  });
  return { ok: true, state: refreshed, target: authoritativeTarget };
}

async function migrateExtensionWatchlistToNative() {
  if (globalThis.__FOLLOWCHECK_IOS_SHELL__) return false;
  if (!nativePort) return false;
  await chrome.alarms?.clear?.(WATCHLIST_ALARM).catch(() => false);
  const migration = await chrome.storage.local.get(WATCHLIST_NATIVE_MIGRATION_KEY).catch(() => ({}));
  if (migration?.[WATCHLIST_NATIVE_MIGRATION_KEY] === true) return false;
  const ownerId = await watchlistOwnerId();
  if (!ownerId) return false;
  const watchlist = await readWatchlistState(ownerId);
  if (!watchlist.targets.length && !watchlist.events.length) {
    await chrome.storage.local.set({ [WATCHLIST_NATIVE_MIGRATION_KEY]: true });
    return false;
  }
  nativePort.postMessage({
    event: "watchlist_import",
    ownerUserId: ownerId,
    watchlist,
  });
  await chrome.storage.local.set({ [WATCHLIST_NATIVE_MIGRATION_KEY]: true });
  await backgroundLog("info", "watchlist", "native-queue-migration", "Watchlist enviada para a fila única Android sem apagar snapshots.", {
    ownerId,
    targets: watchlist.targets.length,
    events: watchlist.events.length,
  });
  return true;
}

async function broadcastWatchlistState(watchlist) {
  const tab = await getAnyInstagramTab().catch(() => null);
  if (tab?.id) {
    await chrome.tabs.sendMessage(tab.id, {
      type: "FOLLOWCHECK_WATCHLIST_STATE",
      watchlist,
    }).catch(() => null);
  }
}

async function scheduleWatchlistAlarm(targets = null) {
  // Android owns the only scheduler for account and Watchlist checks.
  // Keeping a second WebExtension alarm caused overlapping jobs.
  await chrome.alarms?.clear?.(WATCHLIST_ALARM).catch(() => false);
}

function watchlistId() {
  return globalThis.crypto?.randomUUID?.() || `watch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function watchlistEvent(target, type, title, detail, person = null, timestamp = Date.now()) {
  return {
    id: `${type}-${target.id}-${String(person?.id || person?.username || "profile")}-${timestamp}`,
    targetId: target.id,
    targetUsername: target.username,
    type,
    title,
    detail,
    userId: String(person?.id || ""),
    username: validInstagramUsername(person?.username || ""),
    fullName: String(person?.full_name || person?.fullName || "").slice(0, 160),
    profilePicUrl: String(person?.profile_pic_url || person?.profilePicUrl || "").slice(0, 4000),
    timestamp,
    read: false,
  };
}

async function expireQueuedNativeWatchlistRun(ownerId, targetId, queuedAt) {
  const state = await readWatchlistState(ownerId);
  const index = state.targets.findIndex((target) => target.id === targetId);
  if (index < 0) return;
  const target = state.targets[index];
  if (target?.pendingNative !== true || Number(target?.queuedAt || 0) !== Number(queuedAt || 0)) return;
  const now = Date.now();
  const detail = "O pedido foi recebido, mas a execução não chegou a iniciar. Confirma o intervalo global ou tenta novamente.";
  state.targets[index] = {
    ...target,
    running: false,
    pendingNative: false,
    queuedAt: 0,
    progress: null,
    lastErrorCode: "watchlist_start_unconfirmed",
    lastError: detail,
  };
  state.events = [
    watchlistEvent(target, "watch_check_failed", "Check não iniciado", detail, null, now),
    ...state.events,
  ].slice(0, 1000);
  await writeWatchlistState(ownerId, state);
  await backgroundLog("warn", "watchlist", "manual-start-unconfirmed", detail, { ownerId, targetId });
}

async function applyQueuedNativeWatchlistMutation(ownerId, state, action, message = {}) {
  const next = { ...state, targets: [...state.targets], events: [...state.events] };
  const now = Date.now();
  const targetId = String(message.targetId || "");
  if (action === "mark_read") {
    next.events = next.events.map((event) => ({ ...event, read: true }));
  } else if (action === "add") {
    const username = validInstagramUsername(message.username || "");
    const existing = next.targets.find((target) => String(target.username || "").toLowerCase() === username.toLowerCase());
    if (!existing) {
      next.targets.push({
        id: `native-pending-${username.toLowerCase()}`,
        userId: "",
        username,
        fullName: "",
        profilePicUrl: "",
        privateProfile: false,
        enabled: true,
        notificationsEnabled: message.notificationsEnabled !== false,
        intervalMinutes: Math.max(60, Math.min(43200, Number(message.intervalMinutes || 1440))),
        nextRunAt: now + 1000,
        lastRunAt: 0,
        lastSuccessAt: 0,
        baselineReady: false,
        followers: 0,
        following: 0,
        lastChangeCount: 0,
        running: false,
        pendingNative: true,
        queuedAt: now,
        lastError: "",
        lastErrorCode: "",
      });
    }
  } else if (action === "remove") {
    next.targets = next.targets.filter((target) => target.id !== targetId);
    next.events = next.events.filter((event) => event.targetId !== targetId);
  } else if (action === "update") {
    next.targets = next.targets.map((target) => target.id !== targetId ? target : {
      ...target,
      ...(typeof message.enabled === "boolean" ? { enabled: message.enabled } : {}),
      ...(typeof message.notificationsEnabled === "boolean" ? { notificationsEnabled: message.notificationsEnabled } : {}),
      ...(["following", "both"].includes(message.lists) ? { lists: message.lists } : {}),
      ...(message.intervalMinutes == null ? {} : {
        intervalMinutes: Math.max(60, Math.min(43200, Number(message.intervalMinutes || 1440))),
      }),
    });
  } else if (action === "run") {
    const index = next.targets.findIndex((target) => target.id === targetId);
    if (index >= 0) {
      const target = next.targets[index];
      next.targets[index] = {
        ...target,
        running: true,
        pendingNative: true,
        queuedAt: now,
        startedAt: now,
        lastError: "",
        lastErrorCode: "",
        progress: {
          title: "Check em fila",
          detail: "Pedido recebido; a execução vai começar dentro da app.",
          percentage: 1,
          stage: "queued",
          updatedAt: now,
        },
      };
      next.events = [
        watchlistEvent(target, "watch_check_queued", "Check em fila", "Pedido manual recebido e a aguardar início.", null, now),
        ...next.events,
      ].slice(0, 1000);
    }
  }
  return writeWatchlistState(ownerId, next);
}

function sameMonitorIdentitySet(left,right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  if (![left,right].every(values=>values.every(id=>/^\d{1,32}$/.test(String(id))))) return false;
  const ids=new Set(left.map(String));
  return ids.size===left.length && new Set(right.map(String)).size===right.length && right.every(id=>ids.has(String(id)));
}

function watchlistListProof(result,reported) {
  const observed=result?.users?.length;
  if (result?.terminal !== true || !Number.isSafeInteger(reported) || reported < 0) return null;
  if (result.interrupted === true) {
    return {mode:"partial-observation",terminal:true,observed:Number(result.observed||0),reported,duplicates:Number(result.duplicates||0),receivedUsers:Number(result.receivedUsers||0),interrupted:true};
  }
  if (result.skipped === true) return {mode:"partial-observation",terminal:true,observed:0,reported,duplicates:0,receivedUsers:0,skipped:true,backoffUntil:Number(result.backoffUntil||0)};
  if (result.validationMode === "terminal-drift" && result.enumerationVerified === true && result.duplicates === 0 &&
      observed !== reported && Math.abs(observed - reported) <= watchlistDriftTolerance(reported)) {
    return {mode:"terminal-drift",terminal:true,observed,reported};
  }
  if (result.orderingUnstable === true && watchlistOrderingUnstable(result, reported)) {
    return {mode:"partial-observation",terminal:true,observed,reported,duplicates:Number(result.duplicates||0),receivedUsers:Number(result.receivedUsers||0)};
  }
  if (observed === reported) return {mode:"count-matched",terminal:true,observed,reported};
  if (observed > reported && result.enumerationVerified === true && result.validationMode === "stable-surplus" && result.independentPasses === 2 &&
      result.duplicates === 0 && sameMonitorIdentitySet(result.stableIdentityIds,result.users.map(user=>String(user.id)))) {
    return {mode:"stable-surplus",terminal:true,observed,reported,independentPasses:2,stableIdentityIds:result.stableIdentityIds.map(String)};
  }
  return null;
}

function assertWatchlistCoverage(before,after,followers,following,lists=null) {
  const coverage={followers,following,reportedFollowers:after.reportedFollowers,reportedFollowing:after.reportedFollowing};
  // A counter may move by a few accounts while the lists are read; each list is
  // then proven against the final counter. A larger move still rejects the check.
  const moved=(a,b)=>!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || Math.abs(a-b)>(lists ? watchlistDriftTolerance(b) : 0);
  if (moved(before.reportedFollowers,after.reportedFollowers) || moved(before.reportedFollowing,after.reportedFollowing) ||
      !Number.isSafeInteger(after.reportedFollowers) || after.reportedFollowers < 0 || !Number.isSafeInteger(after.reportedFollowing) || after.reportedFollowing < 0 ||
      (lists ? lists.followers?.users?.length !== followers || lists.following?.users?.length !== following ||
        !watchlistListProof(lists.followers,after.reportedFollowers) || !watchlistListProof(lists.following,after.reportedFollowing) ||
        [watchlistListProof(lists.followers,after.reportedFollowers),watchlistListProof(lists.following,after.reportedFollowing)].every(proof=>proof.mode==="partial-observation") :
        followers!==after.reportedFollowers || following!==after.reportedFollowing)) {
    const error=monitorFailure(`Leitura parcial: ${followers}/${after.reportedFollowers ?? '?'} seguidores e ${following}/${after.reportedFollowing ?? '?'} a seguir. Não foram calculadas mudanças.`,"watch_coverage_incomplete");
    error.coverage=coverage;throw error;
  }
}

// Comparison version 5 validates each list on its own: a list carries its own
// proof and reported total, and a partial observation is never a reference.
function watchlistReferenceLists(snapshot, viewer, target) {
  if (!snapshot || snapshot.complete !== true || String(snapshot.viewerUserId) !== String(viewer) || String(snapshot.target?.id) !== String(target)) return null;
  if ([3,4].includes(snapshot.comparisonVersion)) {
    const valid=validWatchlistComparisonSnapshot(snapshot,viewer,target);
    return valid ? {followers:true,following:true} : null;
  }
  if (snapshot.comparisonVersion !== 5) return null;
  const usable={};
  for (const kind of ['followers','following']) {
    const proof=snapshot.listValidation?.[kind],users=snapshot[kind];
    usable[kind]=false;
    if (!proof || proof.terminal!==true || !Array.isArray(users) || proof.observed!==users.length || !Number.isSafeInteger(proof.reported) || proof.reported<0) continue;
    if (!users.every(user => /^\d{1,32}$/.test(String(user?.id || ''))) || new Set(users.map(user=>String(user.id))).size!==users.length) continue;
    if (proof.mode==='count-matched') usable[kind]=users.length===proof.reported;
    else if (proof.mode==='stable-surplus') usable[kind]=users.length>proof.reported && proof.independentPasses===2 && sameMonitorIdentitySet(proof.stableIdentityIds,users.map(user=>String(user.id)));
    else if (proof.mode==='terminal-drift') usable[kind]=users.length!==proof.reported && Math.abs(users.length-proof.reported)<=watchlistDriftTolerance(proof.reported);
  }
  return usable.followers || usable.following ? usable : null;
}

function validWatchlistComparisonSnapshot(snapshot, viewer, target) {
  if (!snapshot || ![3,4].includes(snapshot.comparisonVersion) || snapshot.complete !== true ||
      String(snapshot.viewerUserId) !== String(viewer) || String(snapshot.target?.id) !== String(target)) return false;
  if(snapshot.comparisonVersion===3 && (snapshot.followers?.length!==snapshot.target?.reportedFollowers || snapshot.following?.length!==snapshot.target?.reportedFollowing)) return false;
  if(snapshot.comparisonVersion===4 && !['followers','following'].every(kind=>{
    const proof=snapshot.listValidation?.[kind],users=snapshot[kind];
    const reported=snapshot.target?.[kind==='followers'?'reportedFollowers':'reportedFollowing'];
    if(!proof || proof.terminal!==true || !Array.isArray(users) || proof.observed!==users.length || proof.reported!==reported || !Number.isSafeInteger(reported) || reported<0)return false;
    if(proof.mode==='count-matched')return users.length===reported;
    return proof.mode==='stable-surplus' && users.length>reported && proof.independentPasses===2 && sameMonitorIdentitySet(proof.stableIdentityIds,users.map(user=>String(user.id)));
  }))return false;
  return ['followers','following'].every(key => Array.isArray(snapshot[key]) &&
    snapshot[key].every(user => /^\d{1,32}$/.test(String(user?.id || ''))) &&
    new Set(snapshot[key].map(user => String(user.id))).size === snapshot[key].length);
}

function watchlistEventsFromResult(target, result) {
  const at = Number(result?.completedAt || Date.now());
  const countVerified=result?.coverageVerified !== false;
  const warningEvents=(result?.coverageWarnings||[]).map(detail=>({...watchlistEvent(target,"watch_count_warning","Contador do perfil divergente",detail,null,at),comparisonVerified:false,coverageVerified:false}));
  if (result?.baseline) {
    return [{...watchlistEvent(target, "watch_baseline", "Referência criada", countVerified?"Primeiro snapshot completo guardado.":"Referência das listas visíveis criada; existe divergência no contador do perfil.", null, at),coverageVerified:countVerified,enumerationVerified:true},...warningEvents];
  }
  if (result?.comparisonVerified !== true) return [];
  const changes = result?.changes || {};
  const events = [];
  const followersVerified=result?.relationCoverage?.followers !== false;
  const followingVerified=result?.relationCoverage?.following !== false;
  const addPeople = (key, type, title, detail, verified = countVerified) => {
    for (const person of Array.isArray(changes[key]) ? changes[key] : []) {
      events.push({...watchlistEvent(target, type, title, detail, person, at),coverageVerified:verified});
    }
  };
  addPeople("newFollowers", "watch_new_follower", followersVerified?"Novo seguidor":"Novo perfil na lista de seguidores", followersVerified?"Começou a seguir esta conta.":"Passou a aparecer na lista observada; existe divergência de contagem numa das referências.",followersVerified);
  addPeople("lostFollowers", "watch_lost_follower", followersVerified?"Deixou de seguir esta conta":"Perfil deixou de aparecer nos seguidores", followersVerified?"Saiu da lista completa de seguidores.":"Ausência repetida na lista observada; não confirma a ação de unfollow.",followersVerified);
  addPeople("startedFollowing", "watch_started_following", followingVerified?"Começou a seguir":"Novo perfil nas contas seguidas", followingVerified?"Esta conta começou a seguir este perfil.":"Passou a aparecer na lista observada; existe divergência de contagem numa das referências.",followingVerified);
  addPeople("stoppedFollowing", "watch_stopped_following", followingVerified?"Esta conta deixou de seguir":"Perfil deixou de aparecer nas contas seguidas", followingVerified?"Esta conta deixou de seguir este perfil.":"Ausência repetida na lista observada; não confirma a ação de unfollow.",followingVerified);
  addPeople("unavailableAccounts", "watch_account_unavailable", "Conta indisponível", "A relação mudou enquanto o perfil ficou indisponível.");
  for (const change of Array.isArray(changes.profileChanges) ? changes.profileChanges : []) {
    events.push(watchlistEvent(target, "watch_profile_change", String(change?.title || "Perfil alterado"), String(change?.detail || "Os dados do perfil mudaram."), null, at));
  }
  return [...events.map(event => ({...event,comparisonVerified:true,coverageVerified:event.coverageVerified ?? countVerified,checkId:String(result.checkId||'')})),...warningEvents];
}

async function notifyWatchlistChanges(target, events, baseline) {
  if (!target.notificationsEnabled || !chrome.notifications?.create) return;
  const meaningful = events.filter((event) => !["watch_baseline","watch_count_warning"].includes(event.type));
  if (!meaningful.length && !baseline) return;
  const title = baseline ? `@${target.username} está na Watchlist` : `@${target.username} mudou`;
  const message = baseline
    ? target.coverageVerified === false ? "Referência das listas visíveis criada; o contador do perfil diverge." : "Referência completa criada. Os próximos checks vão mostrar apenas diferenças confirmadas."
    : meaningful.length === 1
      ? `${meaningful[0].title}${meaningful[0].username ? ` · @${meaningful[0].username}` : ""}`
      : `${meaningful.length} alterações observadas em seguidores, seguidos ou perfil.`;
  await chrome.notifications.create(`followcheck-watch-${target.id}-${Date.now()}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("images/icon-128.png"),
    title,
    message,
  }).catch(() => null);
}

async function updateWatchlistProgress(title, detail, percentage) {
  if (!watchlistActiveOwnerId || !watchlistActiveTargetId) return;
  const now = Date.now();
  if (now - watchlistProgressWriteAt < 450 && Number(percentage) < 99) return;
  watchlistProgressWriteAt = now;
  const state = await readWatchlistState(watchlistActiveOwnerId);
  const index = state.targets.findIndex((target) => target.id === watchlistActiveTargetId);
  if (index < 0) return;
  state.targets[index] = {
    ...state.targets[index],
    running: true,
    pendingNative: false,
    progress: { title: String(title || "Check em execução"), detail: String(detail || "A sincronizar"), percentage: Number(percentage || 0), updatedAt: now },
  };
  await writeWatchlistState(watchlistActiveOwnerId, state);
}

async function completeWatchlistTarget(ownerId, targetId, result) {
  const state = await readWatchlistState(ownerId);
  const index = state.targets.findIndex((target) => target.id === targetId);
  if (index < 0) return state;
  const previous = state.targets[index];
  const events = watchlistEventsFromResult(previous, result);
  const completedAt = Number(result.completedAt || Date.now());
  const target = {
    ...previous,
    userId: String(result?.target?.id || previous.userId || ""),
    username: validInstagramUsername(result?.target?.username || previous.username),
    fullName: String(result?.target?.fullName || "").slice(0, 160),
    profilePicUrl: String(result?.target?.profilePicUrl || "").slice(0, 4000),
    privateProfile: Boolean(result?.target?.privateProfile),
    running: false,
    pendingNative: false,
    queuedAt: 0,
    progress: null,
    baselineReady: true,
    comparisonReady: true,
    coverageVerified: result.coverageVerified !== false,
    enumerationVerified: true,
    coverageWarnings: result.coverageWarnings || [],
    partialLists: result.partialLists || {followers:null,following:null},
    comparedLists: result.comparedLists || null,
    reportedFollowers: result.reportedCounts?.followers ?? null,
    reportedFollowing: result.reportedCounts?.following ?? null,
    lastAttemptCoverage: null,
    followers: Number(result?.snapshot?.followers || 0),
    following: Number(result?.snapshot?.following || 0),
    lastRunAt: completedAt,
    lastSuccessAt: completedAt,
    lastChangeCount: events.filter((event) => !["watch_baseline","watch_count_warning"].includes(event.type)).length,
    lastError: "",
    lastErrorCode: "",
    nextRunAt: previous.enabled ? completedAt + Math.max(60, Math.min(43200, Number(previous.intervalMinutes || 1440))) * 60_000 : 0,
    ...watchlistFollowersBackoff(previous, result, completedAt),
  };
  state.targets[index] = target;
  state.events = [...events.reverse(), ...state.events].slice(0, 1000);
  const saved = await writeWatchlistState(ownerId, state);
  await notifyWatchlistChanges(target, events, Boolean(result.baseline));
  return saved;
}

async function failWatchlistTarget(ownerId, targetId, error) {
  await backgroundLog("warn", "watchlist", "failed", "Watchlist interrompida; referência anterior preservada.", {code:error?.code || "watchlist_failed", coverage:error?.coverage || null, resultPreserved:true});
  const state = await readWatchlistState(ownerId);
  const index = state.targets.findIndex((target) => target.id === targetId);
  if (index < 0) return state;
  const target = state.targets[index];
  const now = Date.now();
  const retryDelay = ["rate_limited", "soft_throttle"].includes(String(error?.code || "")) ? 24 * 60 * 60_000 : Math.max(60, Number(target.intervalMinutes || 1440)) * 60_000;
  state.targets[index] = {
    ...target,
    running: false,
    pendingNative: false,
    queuedAt: 0,
    progress: null,
    lastRunAt: now,
    lastAttemptCoverage: error?.coverage || null,
    lastErrorCode: String(error?.code || "watchlist_failed").slice(0, 80),
    lastError: String(error?.message || "O check não ficou completo; a referência anterior foi preservada.").slice(0, 260),
    nextRunAt: target.enabled ? now + retryDelay : 0,
  };
  return writeWatchlistState(ownerId, state);
}

async function executeWatchlistTarget(ownerId, targetId) {
  await assertGlobalSafety("watchlist-check");
  const state = await readWatchlistState(ownerId);
  const index = state.targets.findIndex((target) => target.id === targetId);
  if (index < 0 || state.targets[index].running) return state;
  const target = state.targets[index];
  state.targets[index] = { ...target, running: true, startedAt: Date.now(), lastError: "", lastErrorCode: "", progress: { title: `Watchlist · @${target.username}`, detail: "A validar a sessão", percentage: 1 } };
  await writeWatchlistState(ownerId, state);
  watchlistActiveOwnerId = ownerId;
  watchlistActiveTargetId = targetId;
  try {
    const result = await runNativeWatchlistScan({
      profileId: `watchlist:${ownerId}`,
      accountId: ownerId,
      targetId,
      targetUserId: target.userId || "",
      targetUsername: target.username,
      targetFullName: target.fullName || "",
      targetProfilePicUrl: target.profilePicUrl || "",
      targetPrivateProfile: Boolean(target.privateProfile),
      lists: target.lists === "following" ? "following" : "both",
      followersBackoffUntil: Number(target.followersBackoffUntil || 0),
      checkId: watchlistId(),
    });
    return await completeWatchlistTarget(ownerId, targetId, result);
  } catch (error) {
    if (error?.code === 'check_preempted') {
      const current = await readWatchlistState(ownerId);
      current.targets = current.targets.map(t=>t.id === targetId ? {...t,running:false,progress:null,lastError:'Em espera: outro check tem prioridade.',lastErrorCode:'check_preempted'} : t);
      await writeWatchlistState(ownerId,current);
      return current;
    }
    await tripSafetyFromError(error, "watchlist-check").catch(() => null);
    await failWatchlistTarget(ownerId, targetId, error);
    postMonitorStopped(`watchlist:${ownerId}`, 'Watchlist não concluída', String(error?.message || 'Não foi possível validar o perfil.'), 'error');
    await backgroundLog('warn','watchlist','watchlist-check-failed',String(error?.message || 'A Watchlist falhou.'),{code:String(error?.code || 'watchlist_failed')});
    return readWatchlistState(ownerId);
  } finally {
    watchlistActiveOwnerId = "";
    watchlistActiveTargetId = "";
  }
}

async function runDueWatchlistChecks() {
  await chrome.alarms?.clear?.(WATCHLIST_ALARM).catch(() => false);
  return false;
}

async function handleWatchlistCommand(message = {}) {
  const ownerId = await watchlistOwnerId();
  if (!ownerId) return { ok: false, error: "Abre uma conta Instagram autenticada antes de usar a Watchlist." };
  const action = String(message.action || "get");
  let state = await readWatchlistState(ownerId);
  const safety = await readGlobalSafetyState();
  if (action === "get") {
    if (safety.blocked && !isIOSLocalUpgradeHold(safety) && state.targets.some((target) => target.running)) {
      state.targets = state.targets.map((target) => target.running ? {
        ...target,
        running: false,
        progress: null,
        lastErrorCode: "global_safety_lock",
        lastError: safety.message || "A proteção global interrompeu este check sem alterar o último snapshot completo.",
      } : target);
      return { ok: true, watchlist: await writeWatchlistState(ownerId, state), safety };
    }
    return { ok: true, watchlist: state, safety };
  }
  if (!globalThis.__FOLLOWCHECK_IOS_SHELL__
      && ["add", "update", "remove", "run", "mark_read"].includes(action)) {
    if ((action === "add" || action === "run")) {
      await assertGlobalSafety(action === "add" ? "watchlist-add-and-baseline" : "watchlist-manual-check");
    }
    if (action === "run") {
      const pacing = await resolveMonitorPacing();
      await assertGlobalScanBudget("watchlist", pacing, true);
    }
    if (action === "add" && !validInstagramUsername(message.username || "")) {
      return { ok: false, error: "Username Instagram inválido." };
    }
    if (!nativePort) {
      return { ok: false, error: "A fila única Android ainda não está ligada. Reabre a app e tenta novamente." };
    }
    let effectiveMessage = { ...message };
    if (action === "run" || action === "update") {
      const synchronized = await synchronizeWatchlistTargetWithNative(ownerId, state, message.targetId);
      if (!synchronized.ok) return synchronized;
      state = synchronized.state;
      effectiveMessage = {
        ...message,
        targetId: String(synchronized.target.id || message.targetId || ""),
        username: validInstagramUsername(message.username || synchronized.target.username || ""),
      };
    }
    const optimistic = await applyQueuedNativeWatchlistMutation(ownerId, state, action, effectiveMessage);
    const requestedTargetId = String(effectiveMessage.targetId || "");
    const commandTarget = optimistic.targets.find((target) => String(target?.id || "") === requestedTargetId)
      || state.targets.find((target) => String(target?.id || "") === requestedTargetId)
      || null;
    const addConfirmation = action === "add"
      ? waitForNativeWatchlistStatus(ownerId, 5000)
      : null;
    nativePort.postMessage({
      event: "watchlist_command",
      action,
      username: validInstagramUsername(effectiveMessage.username || commandTarget?.username || ""),
      targetId: requestedTargetId,
      targetUserId: String(commandTarget?.userId || ""),
      targetFullName: String(commandTarget?.fullName || "").slice(0, 160),
      targetProfilePicUrl: String(commandTarget?.profilePicUrl || "").slice(0, 4000),
      targetPrivateProfile: Boolean(commandTarget?.privateProfile),
      intervalMinutes: Number(effectiveMessage.intervalMinutes || commandTarget?.intervalMinutes || 1440),
      ...(typeof effectiveMessage.enabled === "boolean" ? { enabled: effectiveMessage.enabled } : {}),
      ...(typeof effectiveMessage.notificationsEnabled === "boolean" ? { notificationsEnabled: effectiveMessage.notificationsEnabled } : {}),
    });
    await backgroundLog("info", "watchlist", "native-command", `Comando Watchlist recebido: ${action}.`, {
      action,
      targetId: requestedTargetId,
      username: validInstagramUsername(effectiveMessage.username || commandTarget?.username || ""),
    });
    if (action === "add") {
      const username = validInstagramUsername(effectiveMessage.username || "");
      const acknowledgement = await addConfirmation;
      if (!acknowledgement?.confirmed) {
        const reverted = await discardPendingNativeWatchlistAdd(ownerId, username);
        await backgroundLog("warn", "watchlist", "native-add-unconfirmed", "O Android não confirmou a adição do perfil a tempo.", {
          ownerId,
          username,
        });
        return {
          ok: false,
          error: "O motor Android não confirmou a adição. Reabre a app e tenta novamente.",
          watchlist: reverted,
          safety,
        };
      }
      const nativeTargets = Array.isArray(acknowledgement.monitorStatus?.watchlist?.targets)
        ? acknowledgement.monitorStatus.watchlist.targets
        : [];
      const nativeTarget = nativeTargets.find((target) => (
        String(target?.username || "").toLowerCase() === username.toLowerCase()
      )) || null;
      if (!nativeTarget) {
        const reverted = await discardPendingNativeWatchlistAdd(ownerId, username);
        await backgroundLog("warn", "watchlist", "native-add-rejected", "O Android respondeu, mas não guardou o perfil pedido.", {
          ownerId,
          username,
        });
        return {
          ok: false,
          error: "O motor Android não guardou este perfil. Confirma o username e tenta novamente.",
          watchlist: reverted,
          safety,
        };
      }
      const confirmed = await readWatchlistState(ownerId);
      await backgroundLog("info", "watchlist", "native-add-confirmed", "Perfil confirmado e guardado na Watchlist Android.", {
        ownerId,
        username,
        targetId: String(nativeTarget.id || ""),
        revision: acknowledgement.revision,
      });
      return { ok: true, watchlist: confirmed, safety, queuedNative: false };
    }
    if (action === "run") {
      const queuedTarget = optimistic.targets.find((target) => target.id === requestedTargetId);
      const queuedAt = Number(queuedTarget?.queuedAt || 0);
      setTimeout(() => expireQueuedNativeWatchlistRun(ownerId, requestedTargetId, queuedAt), 20_000);
    }
    return { ok: true, watchlist: optimistic, safety, queuedNative: true };
  }
  if (action === "mark_read") {
    state.events = state.events.map((event) => ({ ...event, read: true }));
    return { ok: true, watchlist: await writeWatchlistState(ownerId, state) };
  }
  if (action === "add") {
    await assertGlobalSafety("watchlist-add-and-baseline");
    const username = validInstagramUsername(message.username || "");
    if (!username) return { ok: false, error: "Username Instagram inválido." };
    const existing = state.targets.find((target) => String(target.username).toLowerCase() === username.toLowerCase());
    if (existing) return { ok: false, error: `@${username} já está na Watchlist.` };
    if (state.targets.length >= 50) return { ok: false, error: "A Watchlist permite até 50 perfis por conta." };
    const target = {
      id: watchlistId(), userId: "", username, fullName: "", profilePicUrl: "", privateProfile: false,
      enabled: true, notificationsEnabled: message.notificationsEnabled !== false,
      lists: message.lists === "following" ? "following" : "both",
      intervalMinutes: Math.max(60, Math.min(43200, Number(message.intervalMinutes || 1440))),
      nextRunAt: Date.now() + 1000, lastRunAt: 0, lastSuccessAt: 0, running: false,
      baselineReady: false, followers: 0, following: 0, lastChangeCount: 0, lastError: "", lastErrorCode: "",
    };
    state.targets.push(target);
    const saved = await writeWatchlistState(ownerId, state);
    setTimeout(() => executeWatchlistTarget(ownerId, target.id).catch(error => backgroundLog("error", "watchlist", "execution-failed", error.message)), 50);
    return { ok: true, watchlist: saved, targetId: target.id };
  }
  const targetId = String(message.targetId || "");
  const index = state.targets.findIndex((target) => target.id === targetId);
  if (index < 0) return { ok: false, error: "O perfil já não existe na Watchlist." };
  if (action === "list") {
    const target = state.targets[index];
    const relation = message.relation === "following" ? "following" : "followers";
    if (!target.userId || !target.baselineReady) {
      return { ok: false, error: "O primeiro check completo ainda não criou esta lista." };
    }
    const storageKey = watchlistStorageKey(ownerId, target.userId);
    const stored = await chrome.storage.local.get(storageKey).catch(() => ({}));
    const snapshot = stored?.[storageKey];
    if (!snapshot?.complete || !Array.isArray(snapshot?.[relation])) {
      return { ok: false, error: "A última lista completa não está disponível. Executa um novo check." };
    }
    const query = String(message.query || "").trim().toLocaleLowerCase("pt-PT").slice(0, 80);
    const source = query
      ? snapshot[relation].filter((person) => `${person?.username || ""} ${person?.full_name || person?.fullName || ""}`.toLocaleLowerCase("pt-PT").includes(query))
      : snapshot[relation];
    const offset = Math.max(0, Number(message.offset || 0));
    const limit = Math.max(25, Math.min(100, Number(message.limit || 75)));
    return {
      ok: true,
      list: {
        targetId,
        targetUsername: target.username,
        relation,
        accounts: source.slice(offset, offset + limit),
        offset,
        limit,
        total: source.length,
        hasMore: offset + limit < source.length,
        query,
        updatedAt: Number(snapshot.completedAt || target.lastSuccessAt || 0),
      },
    };
  }
  if (action === "remove") {
    const [removed] = state.targets.splice(index, 1);
    state.events = state.events.filter((event) => event.targetId !== targetId);
    if (removed?.userId) await chrome.storage.local.remove(watchlistStorageKey(ownerId, removed.userId)).catch(() => null);
    return { ok: true, watchlist: await writeWatchlistState(ownerId, state) };
  }
  if (action === "update") {
    const current = state.targets[index];
    const enabled = typeof message.enabled === "boolean" ? message.enabled : current.enabled;
    const intervalMinutes = message.intervalMinutes == null ? current.intervalMinutes : Math.max(60, Math.min(43200, Number(message.intervalMinutes || 1440)));
    state.targets[index] = {
      ...current,
      enabled,
      intervalMinutes,
      ...(typeof message.notificationsEnabled === "boolean" ? { notificationsEnabled: message.notificationsEnabled } : {}),
      ...(["following", "both"].includes(message.lists) ? { lists: message.lists } : {}),
      ...(message.retryFollowers === true ? { followersBackoffUntil: 0 } : {}),
      nextRunAt: enabled ? Date.now() + intervalMinutes * 60_000 : 0,
    };
    return { ok: true, watchlist: await writeWatchlistState(ownerId, state) };
  }
  if (action === "run") {
    await assertGlobalSafety("watchlist-manual-check");
    const current = state.targets[index];
    state.targets[index] = { ...current, nextRunAt: Date.now() };
    const saved = await writeWatchlistState(ownerId, state);
    setTimeout(() => executeWatchlistTarget(ownerId, targetId).catch(error => backgroundLog("error", "watchlist", "execution-failed", error.message)), 50);
    return { ok: true, watchlist: { ...saved, targets: saved.targets.map((target) => target.id === targetId ? { ...target, running: true } : target) } };
  }
  return { ok: false, error: "Ação de Watchlist inválida." };
}

function watchlistStorageKey(viewerUserId, targetUserId) {
  return `followcheck:watchlist:v1:${String(viewerUserId || "")}:${String(targetUserId || "")}`;
}

async function resolveWatchlistTarget(message = {}) {
  await assertGlobalSafety("watchlist-profile-info");
  const targetUserId = String(message.targetUserId || "").trim();
  const targetUsername = validInstagramUsername(message.targetUsername || "");
  if (!message.requireCounts && !targetUserId && targetUsername && /^\d{1,32}$/.test(monitorTransportViewerUserId)) {
    const replay = await monitorAudienceReplay(monitorTransportViewerUserId);
    const matches = replay?.complete ? replay.audience.filter(u => String(u.username || '').toLowerCase() === targetUsername.toLowerCase()) : [];
    if (matches.length === 1 && /^\d{1,32}$/.test(String(matches[0].id || matches[0].pk || ''))) {
      const user = matches[0];
      return {...user,id:String(user.id || user.pk),username:targetUsername,fullName:user.full_name || '',
        profilePicUrl:user.profile_pic_url || '',privateProfile:Boolean(user.is_private),
        followedByViewer:user.followed_by_viewer === true,identitySource:'cached-own-audience'};
    }
  }
  // A target already resolved by a complete baseline is durable. Reusing it
  // avoids one profile-info request on every scheduled check.
  if (!message.requireCounts && /^\d{1,32}$/.test(targetUserId) && targetUsername) {
    return {
      id: targetUserId,
      username: targetUsername,
      full_name: String(message.targetFullName || "").slice(0, 160),
      fullName: String(message.targetFullName || "").slice(0, 160),
      profile_pic_url: String(message.targetProfilePicUrl || "").slice(0, 2000),
      profilePicUrl: String(message.targetProfilePicUrl || "").slice(0, 2000),
      is_private: Boolean(message.targetPrivateProfile),
      isPrivate: Boolean(message.targetPrivateProfile),
      privateProfile: Boolean(message.targetPrivateProfile),
      followedByViewer: true,
      identitySource: "cached-complete-baseline",
    };
  }
  await assertGlobalSafety("watchlist-profile-info");
  const profileRequest = {userId:/^\d{1,32}$/.test(targetUserId)?targetUserId:"",username:targetUsername};
  const result = message.requireCounts && typeof globalThis.__FOLLOWCHECK_IOS_PROFILE_READ__ === "function"
    ? await globalThis.__FOLLOWCHECK_IOS_PROFILE_READ__(profileRequest)
    : await requestInstagramMainPage(message.requireCounts ? "profile-document" : "profile-info", profileRequest, monitorTransportTabId);
  if (result?.securityWarning || result?.code === "instagram_security_warning") {
    await tripGlobalSafety("instagram_security_warning", "O Instagram apresentou um aviso de segurança durante a Watchlist.", {
      manualResetRequired: true,
      source: "watchlist-profile-info",
    });
    throw monitorFailure("O Instagram apresentou um aviso de segurança. A Watchlist foi bloqueada globalmente.", "instagram_security_warning", Number(result?.status || 0));
  }
  if (!result?.ok) {
    const status=Number(result?.status)||0;
    const code=status===429?'rate_limited':status===401?'login_required':result?.code || 'watch_target_unavailable';
    const error=monitorFailure(`A validação do perfil falhou: ${status ? 'HTTP '+status : 'sem resposta HTTP'}, ${String(result?.responseKind || 'resposta indisponível')}. O scan não começou; o resultado anterior foi preservado.`,code,status);
    error.retryAfterSeconds=Number(result?.retryAfter)||0;
    throw error;
  }
  const payload = result?.data || null;
  const user = payload?.data?.user || payload?.user || null;
  const normalized = monitorUser(user || {});
  if (!normalized.id || !normalized.username) {
    throw monitorFailure(
      targetUsername
        ? `Não foi possível abrir @${targetUsername} através desta sessão.`
        : "Não foi possível identificar o perfil da Watchlist.",
      "watch_target_unavailable",
    );
  }
  if (targetUserId && normalized.id !== targetUserId) throw monitorFailure("A identidade do perfil mudou. A comparação foi interrompida.","watch_target_changed");
  const count=value=>value!==null && value!==undefined && Number.isSafeInteger(Number(value)) && Number(value)>=0 ? Number(value):null;
  const friendship = user?.friendship_status || {};
  return {
    ...normalized,
    reportedFollowers:count(user?.edge_followed_by?.count ?? user?.follower_count),
    reportedFollowing:count(user?.edge_follow?.count ?? user?.following_count),
    privateProfile: normalized.is_private,
    followedByViewer: Boolean(
      user?.followed_by_viewer
      ?? friendship?.following
      ?? friendship?.followed_by_viewer,
    ),
  };
}

async function classifyWatchlistRemoved(candidates, currentIds, priorPending = [], relation = "") {
  const newlyMissing = new Map();
  const previouslyMissing = new Map();
  for (const user of candidates || []) {
    const normalized = monitorUser(user || {});
    if (normalized.id && !currentIds.has(normalized.id)) newlyMissing.set(normalized.id, normalized);
  }
  for (const user of priorPending || []) {
    const normalized = monitorUser(user || {});
    if (normalized.id && !currentIds.has(normalized.id)) previouslyMissing.set(normalized.id, normalized);
  }
  const confirmed = [];
  const unavailable = [];
  const pending = [];
  // Confirm by two consecutive complete snapshots. The previous build queried
  // up to 60 profile-info endpoints per relation here, multiplying traffic
  // precisely when many changes occurred.
  for (const [id, user] of previouslyMissing) {
    if (newlyMissing.has(id) || !currentIds.has(id)) confirmed.push(user);
  }
  for (const [id, user] of newlyMissing) {
    if (!previouslyMissing.has(id)) pending.push({ ...user, relation });
  }
  return { confirmed, unavailable, pending };
}

function watchlistProfileChanges(previousTarget, target) {
  if (!previousTarget) return [];
  const changes = [];
  if (String(previousTarget.username || "").toLowerCase() !== String(target.username || "").toLowerCase()) {
    changes.push({
      type: "username",
      title: "Username alterado",
      detail: `@${previousTarget.username || "anterior"} passou a @${target.username}.`,
    });
  }
  if (Boolean(previousTarget.privateProfile) !== Boolean(target.privateProfile)) {
    changes.push({
      type: "privacy",
      title: target.privateProfile ? "Perfil ficou privado" : "Perfil ficou público",
      detail: target.privateProfile
        ? "Os próximos checks dependem de esta sessão continuar autorizada."
        : "As listas do perfil voltaram a estar publicamente visíveis.",
    });
  }
  return changes;
}

async function runNativeWatchlistScan(message = {}) {
  const checkId = String(message.checkId || "").trim();
  if (!checkId) {
    throw monitorFailure("A Watchlist só pode arrancar através da fila única Android.", "native_coordination_required");
  }
  if (monitorJobRunning && Date.now() - monitorJobStartedAt < 45 * 60 * 1000) {
    throw monitorFailure("Já existe uma tarefa FollowCheck em curso.", "monitor_busy");
  }
  const pacing = await resolveMonitorPacing(message,"watchlist");
  await assertGlobalSafety("watchlist-scan");
  await assertGlobalScanBudget("watchlist", pacing, message.manual === true);
  activeMonitorPacing = pacing;
  monitorSuccessfulPageCount = 0;
  monitorJobRunning = true;
  monitorJobStartedAt = Date.now();
  const jobToken = ++monitorJobToken;
  const profileId = String(message.profileId || "");
  const targetId = String(message.targetId || "");
  watchlistActiveOwnerId = String(message.accountId || "");
  watchlistActiveTargetId = targetId;
  diagnosticCheckId = checkId;
  try {
    const instagramTab = await getAnyInstagramTab();
    // message.username/accountId identify the watched target, not the signed-in
    // viewer. Passing them here made a valid @viewer session look mismatched.
    const resolvedSession = await resolveMonitorInstagramSession(instagramTab);
    const { sessionId, userId: viewerUserId, cookieStoreId } = resolvedSession;
    monitorTransportTabId = resolvedSession?.tabId || instagramTab?.id || null;
    monitorTransportCookieStoreId = cookieStoreId || "";
    monitorTransportViewerUserId = String(viewerUserId || "");
    monitorPrivateSession = null;
    if (!sessionId || !viewerUserId) {
      throw monitorFailure(
        resolvedSession?.logoutConfirmed
          ? "A sessão Instagram terminou. Inicia sessão antes de executar a Watchlist."
          : "Não foi possível confirmar a sessão neste check. O último snapshot da Watchlist foi preservado.",
        resolvedSession?.logoutConfirmed
          ? "logout_confirmed"
          : resolvedSession?.failureCode || "session_unverified",
      );
    }

    postMonitorProgress(profileId, "Watchlist a iniciar", "A carregar o perfil na sessão e confirmar os totais", 1);
    await backgroundLog("info", "watchlist", "preflight", "A validar os totais antes da recolha.", {checkId, stage:"profile-before", pacing, viewerConfirmed:!!viewerUserId});
    let target = await resolveWatchlistTarget({...message,requireCounts:true});
    await backgroundLog("info", "watchlist", "profile-counts", "Totais iniciais recebidos.", {checkId, followers:target.reportedFollowers, following:target.reportedFollowing});
    if (target.reportedFollowers === null || target.reportedFollowing === null) throw monitorFailure("O perfil não disponibilizou totais verificáveis. Não foi criada uma comparação.","watch_counts_unavailable");
    const recheckTargetCount = kind => async () => {
      const fresh=await resolveWatchlistTarget({...message,targetUserId:target.id,targetUsername:target.username,requireCounts:true});
      if (fresh.id !== target.id) throw monitorFailure("A identidade mudou durante a confirmação do total.","watch_target_changed");
      const previous=target;
      // A counter change requires a fresh independent traversal. Preserve the
      // uncollected list's original anchor; do not silently rebase a collected list.
      target={...target,[kind === "following" ? "reportedFollowing" : "reportedFollowers"]:
        fresh[kind === "following" ? "reportedFollowing" : "reportedFollowers"]};
      await backgroundLog("info","watchlist","profile-count-recheck","Totais do perfil novamente confirmados antes de decidir uma releitura.",
        {checkId,list:kind,before:previous[kind === "following" ? "reportedFollowing" : "reportedFollowers"],after:target[kind === "following" ? "reportedFollowing" : "reportedFollowers"]});
      return target[kind === "following" ? "reportedFollowing" : "reportedFollowers"];
    };
    const assertCollectedCoverage = (kind,result) => {
      if(result.coverageComplete !== false || result.enumerationVerified === true || result.orderingUnstable === true)return;
      const expected=kind === "following" ? target.reportedFollowing : target.reportedFollowers;
      const error=monitorFailure(`A lista de ${kind === "following" ? "contas seguidas" : "seguidores"} terminou com ${result.users.length} identidades únicas; o perfil anuncia ${expected}. A comparação foi interrompida sem voltar a repetir a lista.`,"watch_coverage_incomplete");
      error.coverage={list:kind,collected:result.users.length,reported:expected,duplicates:result.duplicates||0};
      throw error;
    };
    postMonitorProgress(profileId, `Watchlist · @${target.username}`, "A recolher as contas que segue", 3);
    const followingResult = await monitorCollectList(
      "following", target.id, profileId, 3, 46, String(viewerUserId),
      {expected:target.reportedFollowing,recheckExpected:recheckTargetCount("following"),allowStableSurplus:true,acceptCountDrift:true,stopWhenShuffled:true},
    );
    assertCollectedCoverage("following",followingResult);
    // Instagram restricts reading other accounts' followers far more than their
    // following list (device diagnostics, builds 33-34). A target can follow only
    // the accounts it follows; its followers keep their last reference untouched.
    const followersBackoff = Number(message.followersBackoffUntil || 0) > Date.now();
    const followersWanted = message.lists !== "following" && !followersBackoff;
    if (followersBackoff) await backgroundLog("info", "watchlist", "followers-backoff", "Seguidores em espera depois de uma recusa do Instagram; esta verificação lê só as contas seguidas.", {checkId, until: Number(message.followersBackoffUntil)});
    if(followersWanted && activeMonitorPacing.pauseDurationMs>0) {
      postMonitorProgress(profileId,"Pausa entre listas","A aguardar antes de começar a lista de seguidores",46);
      await monitorSleep(activeMonitorPacing.pauseDurationMs);
    }
    postMonitorProgress(profileId, `Watchlist · @${target.username}`, "A recolher os seguidores", 47);
    // When Instagram stops the second list, the first one is already proven:
    // keep it instead of discarding the whole check (device diagnostic, build 33).
    let followerResult, interruption = null;
    if (!followersWanted) {
      followerResult = {users: [], terminal: true, skipped: true, backoffUntil: followersBackoff ? Number(message.followersBackoffUntil) : 0, validationMode: "skipped", observed: 0, duplicates: 0, receivedUsers: 0, pages: 0, transport: "none", expected: target.reportedFollowers};
    } else try {
      followerResult = await monitorCollectList(
        "followers", target.id, profileId, 47, 90, String(viewerUserId),
        {expected:target.reportedFollowers,recheckExpected:recheckTargetCount("followers"),allowStableSurplus:true,acceptCountDrift:true,stopWhenShuffled:true},
      );
    } catch (error) {
      const followingProof = watchlistListProof(followingResult, target.reportedFollowing);
      if (!THROTTLE_REASONS.includes(String(error?.code || "")) || !followingProof || followingProof.mode === "partial-observation") throw error;
      interruption = error;
      const seen = error.partialObservation || {};
      followerResult = {users: [], terminal: true, interrupted: true, validationMode: "interrupted", observed: Number(seen.observed || 0),
        duplicates: Number(seen.duplicates || 0), receivedUsers: Number(seen.receivedUsers || 0), pages: Number(seen.pages || 0),
        transport: "main", expected: target.reportedFollowers};
      await backgroundLog("warn", "watchlist", "list-interrupted", `O Instagram pediu uma pausa durante os seguidores (página ${Number(seen.pages || 0) + 1}). As contas seguidas já estavam verificadas e foram guardadas.`, {checkId, code: String(error.code || "")});
    }
    assertCollectedCoverage("followers",followerResult);
    const following = followingResult.users;
    const followers = followerResult.users;
    // After a limit, no further request is sent: the counters read at the start stand.
    const finalTarget=interruption ? target : await resolveWatchlistTarget({...message,targetUserId:target.id,targetUsername:target.username,requireCounts:true});
    await backgroundLog("info", "watchlist", "coverage", "Comparação entre identidades recolhidas e totais do perfil.", {checkId, collectedFollowers:followers.length,collectedFollowing:following.length,beforeFollowers:target.reportedFollowers,beforeFollowing:target.reportedFollowing,afterFollowers:finalTarget.reportedFollowers,afterFollowing:finalTarget.reportedFollowing});
    assertWatchlistCoverage(target,finalTarget,followers.length,following.length,{followers:followerResult,following:followingResult});
    const listValidation={followers:watchlistListProof(followerResult,finalTarget.reportedFollowers),following:watchlistListProof(followingResult,finalTarget.reportedFollowing)};
    const partial={followers:listValidation.followers.mode==='partial-observation',following:listValidation.following.mode==='partial-observation'};
    const countVerified=Object.values(listValidation).every(proof=>proof.mode==='count-matched');
    const coverageWarnings=['followers','following'].filter(kind=>listValidation[kind].mode==='stable-surplus').map(kind=>
      `${kind==='following'?'Contas seguidas':'Seguidores'}: ${listValidation[kind].observed} identidades observadas em duas recolhas iguais; contador do perfil: ${listValidation[kind].reported}.`);
    const storageKey = watchlistStorageKey(viewerUserId, target.id);
    const stored = await chrome.storage.local.get(storageKey).catch(() => ({}));
    const candidate = stored?.[storageKey] || null;
    const usable = watchlistReferenceLists(candidate,viewerUserId,target.id);
    const previous = usable ? candidate : null;
    await backgroundLog("info", "watchlist", "comparison-reference", "Referência de comparação avaliada.", {checkId, savedReferencePresent:!!candidate, referenceAccepted:!!previous, followersReference:!!usable?.followers, followingReference:!!usable?.following, partialFollowers:partial.followers, partialFollowing:partial.following, baselineOnly:!previous});
    for (const kind of ['followers','following'].filter(kind=>partial[kind] && !listValidation[kind].skipped)) {
      await backgroundLog("warn","watchlist","list-partial",`${kind==='following'?'Contas seguidas':'Seguidores'}: ${listValidation[kind].observed} de ${listValidation[kind].reported} visíveis. O Instagram repetiu ${listValidation[kind].duplicates} perfis nesta lista; as saídas não foram calculadas.`,
        {checkId,list:kind,observed:listValidation[kind].observed,reported:listValidation[kind].reported,duplicates:listValidation[kind].duplicates,referenceKept:!!usable?.[kind]});
    }
    // A list is compared only when both the reference and this observation are proven.
    const compare={followers:!!usable?.followers && !partial.followers,following:!!usable?.following && !partial.following};
    const followerDelta = compare.followers ? monitorChanges(previous.followers || [], followers) : { added: [], removed: [] };
    const followingDelta = compare.following ? monitorChanges(previous.following || [], following) : { added: [], removed: [] };
    const followerIds = new Set(followers.map((user) => String(user.id)));
    const followingIds = new Set(following.map((user) => String(user.id)));

    postMonitorProgress(profileId, `Watchlist · @${target.username}`, "A confirmar as alterações antes de alertar", 92);
    const lostFollowers = compare.followers
      ? await classifyWatchlistRemoved(
          followerDelta.removed,
          followerIds,
          previous.pendingRemovedFollowers || [],
          "followers",
        )
      : { confirmed: [], unavailable: [], pending: [] };
    const stoppedFollowing = compare.following
      ? await classifyWatchlistRemoved(
          followingDelta.removed,
          followingIds,
          previous.pendingStoppedFollowing || [],
          "following",
        )
      : { confirmed: [], unavailable: [], pending: [] };
    const profileChanges = watchlistProfileChanges(previous?.target || null, target);
    const completedAt = Date.now();
    // A partial list keeps the last proven reference for that list, so the next
    // complete observation still compares against something real.
    const carriedProof = kind => {
      if (previous.comparisonVersion === 5) return previous.listValidation[kind];
      return previous.comparisonVersion === 4 ? {...previous.listValidation[kind], reported: previous.target[kind === 'followers' ? 'reportedFollowers' : 'reportedFollowing']}
        : {mode:'count-matched',terminal:true,observed:previous[kind].length,reported:previous[kind].length};
    };
    const reference = {};
    for (const kind of ['followers','following']) {
      const current = kind === 'followers' ? followers : following;
      reference[kind] = partial[kind] && usable?.[kind]
        ? {users: previous[kind], proof: carriedProof(kind), pending: kind === 'followers' ? previous.pendingRemovedFollowers || [] : previous.pendingStoppedFollowing || []}
        : {users: current, proof: listValidation[kind], pending: kind === 'followers' ? lostFollowers.pending : stoppedFollowing.pending};
    }
    globalThis.__FOLLOWCHECK_IOS_ASSERT_ACTIVE__?.();
    await chrome.storage.local.set({
      [storageKey]: {
        version: 2,
        comparisonVersion: 5,
        listValidation: {followers: reference.followers.proof, following: reference.following.proof},
        observations: {followers: listValidation.followers, following: listValidation.following, at: completedAt},
        viewerUserId: String(viewerUserId),
        target: {...target, reportedFollowers: finalTarget.reportedFollowers, reportedFollowing: finalTarget.reportedFollowing},
        followers: reference.followers.users,
        following: reference.following.users,
        pendingRemovedFollowers: reference.followers.pending,
        pendingStoppedFollowing: reference.following.pending,
        completedAt,
        complete: true,
      },
    });
    await commitGlobalScanBudget("watchlist", completedAt, pacing);

    const result = {
      event: "watchlist_result",
      comparisonVerified: compare.followers || compare.following,
      coverageVerified: countVerified,
      partialLists: Object.fromEntries(['followers','following'].map(kind=>[kind,partial[kind] ? {observed:listValidation[kind].observed,reported:listValidation[kind].reported,duplicates:listValidation[kind].duplicates,interrupted:listValidation[kind].interrupted===true,skipped:listValidation[kind].skipped===true,backoffUntil:Number(listValidation[kind].backoffUntil||0)} : null])),
      interrupted: interruption ? String(interruption.code || "") : null,
      comparedLists: compare,
      enumerationVerified: true,
      coverageWarnings,
      reportedCounts:{followers:finalTarget.reportedFollowers,following:finalTarget.reportedFollowing},
      relationCoverage:{followers:listValidation.followers.mode==='count-matched' && (!previous || previous.comparisonVersion===3 || previous.listValidation?.followers?.mode==='count-matched'),
        following:listValidation.following.mode==='count-matched' && (!previous || previous.comparisonVersion===3 || previous.listValidation?.following?.mode==='count-matched')},
      profileId,
      targetId,
      checkId,
      baseline: !previous,
      completedAt,
      target: {
        id: target.id,
        username: target.username,
        fullName: target.full_name || target.fullName || "",
        profilePicUrl: target.profile_pic_url || target.profilePicUrl || "",
        privateProfile: target.privateProfile,
      },
      snapshot: {
        followers: followers.length,
        following: following.length,
        updatedAt: completedAt,
      },
      changes: {
        newFollowers: followerDelta.added.slice(0, 500),
        lostFollowers: lostFollowers.confirmed.slice(0, 500),
        startedFollowing: followingDelta.added.slice(0, 500),
        stoppedFollowing: stoppedFollowing.confirmed.slice(0, 500),
        unavailableAccounts: [
          ...lostFollowers.unavailable,
          ...stoppedFollowing.unavailable,
        ].slice(0, 500),
        profileChanges,
      },
      diagnostics: {
        snapshotValidation: countVerified ? "count-matched" : "stable-visible-lists",
        listValidation: Object.fromEntries(Object.entries(listValidation).map(([kind,proof])=>[kind,{mode:proof.mode,observed:proof.observed,reported:proof.reported}])),
        transport: {
          following: followingResult.transport,
          followers: followerResult.transport,
        },
        pages: {
          following: followingResult.pages,
          followers: followerResult.pages,
        },
        expected: {
          following: followingResult.expected,
          followers: followerResult.expected,
        },
        pendingConfirmation: lostFollowers.pending.length + stoppedFollowing.pending.length,
      },
    };
    globalThis.__FOLLOWCHECK_IOS_ASSERT_ACTIVE__?.();
    await chrome.storage.local.set({
      [storageKey]: {
        ...(await chrome.storage.local.get(storageKey))[storageKey],
        pendingNativeResult: result,
      },
    });
    const completionDetail=interruption ? "O Instagram pediu uma pausa. A lista de contas seguidas foi verificada e guardada." : countVerified ? "Snapshot completo guardado e comparado." : "Listas verificadas e guardadas.";
    if (interruption) await tripSafetyFromError(interruption, "watchlist-scan").catch(() => null);
    postMonitorProgress(profileId, `Watchlist · @${target.username}`, completionDetail, 99);
    if(coverageWarnings.length)await backgroundLog("warn","watchlist","profile-counter-divergence",coverageWarnings.join(" "),{checkId,countVerified:false,enumerationVerified:true});
    await backgroundLog("info", "watchlist", "watchlist-check-completed", `Watchlist @${target.username} atualizada.`, {
      followers: Number(result.snapshot?.followers || 0),
      following: Number(result.snapshot?.following || 0),
      checkId,
    });
    if (!nativePort) {
      throw monitorFailure("O resultado da Watchlist ficou guardado, mas a ponte Android desligou antes da confirmação.", "native_bridge_unavailable");
    }
    nativePort.postMessage(result);
    postMonitorStopped(profileId, `Watchlist · @${target.username}`, completionDetail, "completed");
    return result;
  } catch (error) {
    await tripSafetyFromError(error, "watchlist-scan").catch(() => null);
    throw error;
  } finally {
    if (monitorJobToken === jobToken) {
      monitorPrivateSession = null;
      monitorJobRunning = false;
      monitorJobStartedAt = 0;
      monitorTransportTabId = null;
      monitorTransportCookieStoreId = "";
      monitorTransportViewerUserId = "";
      activeMonitorPacing = { ...DEFAULT_MONITOR_PACING };
      watchlistActiveOwnerId = "";
      watchlistActiveTargetId = "";
      diagnosticCheckId = "";
    }
  }
}

async function runNativeMonitorScan(message = {}) {
  const checkId = String(message.checkId || "").trim();
  if (!checkId) {
    throw monitorFailure("O check só pode arrancar através da fila única Android.", "native_coordination_required");
  }
  if (monitorJobRunning && Date.now() - monitorJobStartedAt < 45 * 60 * 1000) {
    throw monitorFailure("Já existe uma tarefa FollowCheck em curso.", "monitor_busy");
  }
  const pacing = await resolveMonitorPacing(message);
  const recovered = await recoverCommittedOwnMonitorResult(message);
  if (recovered) return recovered;
  await assertGlobalSafety("own-account-scan");
  await assertGlobalScanBudget("own-account", pacing, message.manual === true);
  activeMonitorPacing = pacing;
  monitorSuccessfulPageCount = 0;
  monitorJobRunning = true;
  monitorJobStartedAt = Date.now();
  const jobToken = ++monitorJobToken;
  const profileId = String(message.profileId || "");
  const accountUsername = validInstagramUsername(message.username);
  try {
    postMonitorDiagnostic(profileId, "check_transport_started", {
      schedulerOwner: "android-native",
      manual: message.manual === true,
    });
    const instagramTab = await getAnyInstagramTab();
    const resolvedSession = await resolveMonitorInstagramSession(
      instagramTab,
      accountUsername,
      String(message.accountId || ""),
    );
    const { sessionId, userId, cookieStoreId } = resolvedSession;
    const resolvedAccountUsername = validInstagramUsername(
      resolvedSession?.username || accountUsername,
    );
    monitorTransportTabId = resolvedSession?.tabId || instagramTab?.id || null;
    monitorTransportCookieStoreId = cookieStoreId || "";
    monitorTransportViewerUserId = String(userId || "");
    monitorPrivateSession = null;
    if (!sessionId || !userId) {
      throw monitorFailure(
        resolvedSession?.failureCode === "login_required"
          ? "Esta conta já não tem uma sessão Instagram válida. Abre a conta e inicia sessão."
          : "Não foi possível confirmar a sessão Instagram neste check. O Monitor volta a tentar na próxima execução sem alterar o snapshot.",
        resolvedSession?.logoutConfirmed
          ? "logout_confirmed"
          : resolvedSession?.failureCode || "session_unverified",
      );
    }

    await rememberLastInstagramSessionState({ connected: true, userId: String(userId), cookieStoreId }).catch(() => {});
    monitorPrivateSession = null;
    postMonitorProgress(profileId, "Monitor a iniciar", "A validar a sessão web autenticada", 1);
    const followingResult = await monitorCollectList("following", userId, profileId, 2, 43);
    const followerResult = await monitorCollectList("followers", userId, profileId, 44, 92);
    const following = followingResult.users;
    const followers = followerResult.users;
    const followingIds = new Set(following.map((user) => user.id));
    const followerIds = new Set(followers.map((user) => user.id));
    const audienceMap = new Map();
    following.forEach((user) => audienceMap.set(user.id, {
      ...user,
      followed_by_viewer: true,
      follows_viewer: followerIds.has(user.id),
      relationship_verified: true,
      relationship_source: "followers-list",
    }));
    followers.forEach((user) => {
      if (!audienceMap.has(user.id)) {
        audienceMap.set(user.id, {
          ...user,
          followed_by_viewer: false,
          follows_viewer: true,
          relationship_verified: true,
          relationship_source: "followers-list",
        });
      }
    });
    const audience = [...audienceMap.values()];
    const storageKey = `${MONITOR_STORAGE_PREFIX}:${userId}`;
    const stored = await chrome.storage.local.get(storageKey);
    const previous = stored[storageKey] || null;
    const followerEvents = previous
      ? await monitorClassifyFollowerDelta(userId, previous.followers || [], followers, profileId)
      : { newFollowers: [], lostFollowers: [], reactivated: [], unavailable: [] };
    const completedAt = Date.now();
    const pendingChanges = {
      schemaVersion: 2,
      newFollowers: followerEvents.newFollowers.slice(0, 500),
      lostFollowers: followerEvents.lostFollowers.slice(0, 500),
      unavailableAccounts: followerEvents.unavailable.slice(0, 500),
      reactivatedAccounts: followerEvents.reactivated.slice(0, 500),
    };
    globalThis.__FOLLOWCHECK_IOS_ASSERT_ACTIVE__?.();
    const durableSnapshot = {
      version: 4,
      checkId,
      followers,
      following,
      audience,
      completedAt,
      complete: true,
      pendingDelivery: true,
      pendingChanges,
    };
    globalThis.__FOLLOWCHECK_IOS_ASSERT_ACTIVE__?.();
    await chrome.storage.local.set({
      [storageKey]: {
        ...durableSnapshot,
      },
    });

    // Pedidos enviados são uma operação explícita e não são anexados ao scan de
    // relações. Assim um check manual não abre silenciosamente endpoints extra.
    const sentRequests = null;
    postMonitorProgress(profileId, "A guardar alterações", "A atualizar o histórico da conta", 97);
    const audienceDelivery = await sendAudienceToPage(
      userId,
      audience,
      new Date(completedAt).toISOString(),
    );
    if (!audienceDelivery?.ok) {
      postMonitorDiagnostic(profileId, "audience_delivery_deferred", {
        accountId: userId,
        reason: String(audienceDelivery?.error || "page_unavailable"),
        replayAvailable: true,
      });
      throw monitorFailure(
        "O check recolheu os dados, mas a app não confirmou que as Relações foram guardadas. O resultado ficou preservado para nova reconciliação e não será anunciado como concluído.",
        "audience_reconciliation_failed",
      );
    }
    const mutuals = following.filter((user) => followerIds.has(user.id)).length;
    const nonFollowers = following.length - mutuals;
    const fans = followers.filter((user) => !followingIds.has(user.id)).length;
    const healthScore = following.length
      ? Math.max(0, Math.min(100, Math.round(100 - ((nonFollowers / following.length) * 55))))
      : 0;
    const result = {
      event: "monitor_result",
      profileId,
      checkId,
      accountId: userId,
      baseline: !previous,
      completedAt,
      snapshot: {
        accountId: userId,
        username: resolvedAccountUsername,
        lastScanAt: new Date(completedAt).toISOString(),
        audience: audience.length,
        followers: followers.length,
        following: following.length,
        mutuals,
        nonFollowers,
        fans,
        protectedCount: 0,
        historyCount: 0,
        healthScore,
        updatedAt: completedAt,
      },
      changes: pendingChanges,
      diagnostics: {
        transport: {
          following: followingResult.transport,
          followers: followerResult.transport,
        },
        pages: {
          following: followingResult.pages,
          followers: followerResult.pages,
        },
        expected: {
          following: followingResult.expected,
          followers: followerResult.expected,
        },
        attempts: {
          following: followingResult.attempts,
          followers: followerResult.attempts,
        },
        snapshotValidation: "complete",
        audienceDelivery: audienceDelivery?.dispatched ? "live" : "durable-replay",
        audienceAcknowledged: true,
        audienceCount: audience.length,
        audienceCompletedAt: new Date(completedAt).toISOString(),
      },
      ...(sentRequests ? {
        requests: sentRequests,
        source: "instagram_access_tool",
      } : {}),
    };
    globalThis.__FOLLOWCHECK_IOS_ASSERT_ACTIVE__?.();
    await chrome.storage.local.set({
      [storageKey]: {
        ...durableSnapshot,
        pendingNativeResult: result,
        pendingDelivery: false,
      },
    });
    await commitGlobalScanBudget("own-account", completedAt, pacing);
    await backgroundLog("info", "monitor", "own-check-completed", "O check da conta foi concluído e guardado.", {
      followers: Number(result.snapshot?.followers || 0),
      following: Number(result.snapshot?.following || 0),
      checkId,
    });
    if (!nativePort) {
      throw monitorFailure("O resultado ficou guardado, mas a ponte Android desligou antes da confirmação.", "native_bridge_unavailable");
    }
    nativePort.postMessage(result);
    postMonitorStopped(profileId, "Check concluído", "Relações e histórico atualizados dentro da app.", "completed");
    return result;
  } catch (error) {
    await tripSafetyFromError(error, "own-account-scan").catch(() => null);
    throw error;
  } finally {
    if (monitorJobToken === jobToken) {
      monitorPrivateSession = null;
      monitorJobRunning = false;
      monitorJobStartedAt = 0;
      monitorTransportTabId = null;
      monitorTransportCookieStoreId = "";
      monitorTransportViewerUserId = "";
      activeMonitorPacing = { ...DEFAULT_MONITOR_PACING };
    }
  }
}

function validInstagramUsername(value) {
  const username = String(value || "")
    .replace(/^@/, "")
    .trim();
  return /^[a-zA-Z0-9._]{1,30}$/.test(username) ? username : "";
}

function ignoredInstagramPath(value) {
  return new Set([
    "accounts", "about", "api", "challenge", "developer", "direct", "explore",
    "legal", "p", "privacy", "reels", "static", "stories", "terms", "tv", "web",
  ]).has(String(value || "").toLowerCase());
}

function collectRequestCandidates(value, output, timestamp = 0) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectRequestCandidates(item, output, timestamp));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  const ownTimestamp = Number(value.timestamp || value.requested_at || timestamp || 0);
  let username = validInstagramUsername(value.username || "");
  const href = String(value.href || value.url || "");
  const hrefMatch = href.match(/instagram\.com\/(?:_u\/)?([a-zA-Z0-9._]{1,30})(?:\/|$)/i);
  if (!username && hrefMatch) username = validInstagramUsername(hrefMatch[1]);
  if (!username && ownTimestamp) username = validInstagramUsername(value.value || "");
  if (username && !ignoredInstagramPath(username)) {
    output.set(username.toLowerCase(), {
      id: String(value.id || value.pk || value.user_id || ""),
      username,
      fullName: String(value.full_name || value.fullName || ""),
      profilePicUrl: String(value.profile_pic_url || value.profilePicUrl || ""),
      requestedAt: ownTimestamp > 0 && ownTimestamp < 10_000_000_000
        ? ownTimestamp * 1000
        : ownTimestamp,
    });
  }
  Object.values(value).forEach((child) => {
    if (child !== value.username && child !== value.value && child !== value.href) {
      collectRequestCandidates(child, output, ownTimestamp);
    }
  });
}

function collectRequestCandidatesFromText(text, output) {
  const patterns = [
    /https?:\/\/(?:www\.)?instagram\.com\/(?:_u\/)?([a-zA-Z0-9._]{1,30})\/?/gi,
    /href=["']\/(?:_u\/)?([a-zA-Z0-9._]{1,30})\/?["']/gi,
  ];
  patterns.forEach((pattern) => {
    for (const match of String(text || "").matchAll(pattern)) {
      const username = validInstagramUsername(match[1]);
      if (username && !ignoredInstagramPath(username)) {
        output.set(username.toLowerCase(), {
          id: "",
          username,
          fullName: "",
          profilePicUrl: "",
          requestedAt: 0,
        });
      }
    }
  });
}

async function fetchSentFollowRequests() {
  const endpoints = [
    "https://www.instagram.com/accounts/access_tool/current_follow_requests/?__a=1&__d=dis",
    "https://www.instagram.com/accounts/access_tool/current_follow_requests/",
  ];
  const output = new Map();
  let recognizedEmpty = false;
  let lastStatus = 0;
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      credentials: "include",
      cache: "no-store",
      redirect: "follow",
      headers: {
        accept: "*/*",
        "x-ig-app-id": INSTAGRAM_WEB_APP_ID,
        "x-requested-with": "XMLHttpRequest",
      },
    });
    lastStatus = response.status;
    if (/\/accounts\/login/i.test(String(response.url || ""))) {
      throw monitorFailure(
        "O canal de pedidos não confirmou a sessão. O login foi preservado para validação na página aberta.",
        "session_unverified",
        response.status,
      );
    }
    const text = await response.text().catch(() => "");
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
    if (payload) collectRequestCandidates(payload, output);
    collectRequestCandidatesFromText(text, output);
    recognizedEmpty ||= /no current follow requests|nothing to show|nenhum pedido|sem pedidos/i.test(text);
    if (output.size || recognizedEmpty) break;
  }
  if (!output.size && !recognizedEmpty) {
    throw monitorFailure(
      "O Instagram não disponibilizou a lista de pedidos enviados nesta sessão. Podes importar o ZIP ou JSON oficial sem perder a lista anterior.",
      "requests_unavailable",
      lastStatus,
    );
  }
  return [...output.values()];
}

async function runNativeRequestsRefresh(message = {}) {
  if (monitorJobRunning) {
    throw monitorFailure("Já existe uma tarefa FollowCheck em curso.", "monitor_busy");
  }
  monitorJobRunning = true;
  monitorJobStartedAt = Date.now();
  const jobToken = ++monitorJobToken;
  const profileId = String(message.profileId || "");
  try {
    const instagramTab = await getAnyInstagramTab();
    const resolvedSession = await resolveMonitorInstagramSession(instagramTab);
    const { sessionId, userId, cookieStoreId } = resolvedSession;
    if (!sessionId || !userId) {
      throw monitorFailure(
        resolvedSession?.logoutConfirmed
          ? "O Instagram abriu a página de login para esta conta. Inicia sessão para retomar os pedidos."
          : "Não foi possível confirmar a sessão neste momento. O login existente não foi alterado.",
        resolvedSession?.logoutConfirmed ? "logout_confirmed" : "session_unverified",
      );
    }
    postMonitorProgress(profileId, "A consultar pedidos", "A abrir a área privada da conta", 15);
    const requests = await fetchSentFollowRequests();
    const completedAt = Date.now();
    nativePort?.postMessage({
      event: "monitor_requests_result",
      profileId,
      accountId: userId,
      source: "instagram_access_tool",
      completedAt,
      requests,
    });
  } finally {
    if (monitorJobToken === jobToken) {
      monitorPrivateSession = null;
      monitorJobRunning = false;
      monitorJobStartedAt = 0;
    }
  }
}

async function resolveRequestUser(request) {
  const knownId = String(request?.id || "");
  const username = validInstagramUsername(request?.username);
  if (knownId) return { id: knownId, username };
  if (!username) {
    throw monitorFailure("O pedido não contém um username válido.", "request_identity_missing");
  }
  const payload = await monitorFetchJson(
    `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
    `a identificação de @${username}`,
  );
  const user = payload?.data?.user || payload?.user;
  const id = String(user?.id || user?.pk || "");
  if (!id) {
    throw monitorFailure(`Não foi possível identificar @${username}.`, "request_identity_missing");
  }
  return { id, username: String(user?.username || username) };
}

async function cancelSentRequest(request, csrf) {
  const user = await resolveRequestUser(request);
  const response = await fetch(
    `https://www.instagram.com/api/v1/friendships/destroy/${encodeURIComponent(user.id)}/`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "*/*",
        "content-type": "application/x-www-form-urlencoded",
        "x-csrftoken": csrf,
        "x-ig-app-id": INSTAGRAM_WEB_APP_ID,
        "x-requested-with": "XMLHttpRequest",
      },
      body: "container_module=profile",
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.status && payload.status !== "ok") {
    throw monitorFailure(
      payload?.message || `O Instagram recusou o cancelamento de @${user.username}.`,
      response.status === 429 ? "rate_limited" : "request_cancel_failed",
      response.status,
    );
  }
  return user;
}

async function runNativeCancelRequests(message = {}) {
  if (monitorJobRunning) {
    throw monitorFailure("Já existe uma tarefa FollowCheck em curso.", "monitor_busy");
  }
  monitorJobRunning = true;
  monitorJobStartedAt = Date.now();
  const jobToken = ++monitorJobToken;
  const profileId = String(message.profileId || "");
  try {
    const instagramTab = await getAnyInstagramTab();
    const { cookieStoreId } = await resolveMonitorInstagramSession(instagramTab);
    const requests = Array.isArray(message.requests) ? message.requests.slice(0, 500) : [];
    const csrf = await getInstagramCookie("csrftoken", cookieStoreId);
    if (!csrf) {
      throw monitorFailure(
        "A sessão não contém o token necessário para cancelar pedidos.",
        "csrf_missing",
      );
    }
    const results = [];
    for (let index = 0; index < requests.length; index += 1) {
      const request = requests[index];
      postMonitorProgress(
        profileId,
        "A cancelar pedidos",
        `${index + 1} de ${requests.length} • @${validInstagramUsername(request?.username) || "conta"}`,
        requests.length ? Math.round((index / requests.length) * 100) : 0,
      );
      try {
        const user = await cancelSentRequest(request, csrf);
        results.push({ ok: true, id: user.id, username: user.username });
      } catch (error) {
        results.push({
          ok: false,
          id: String(request?.id || ""),
          username: validInstagramUsername(request?.username),
          error: String(error?.message || "Falha no cancelamento").slice(0, 180),
        });
        if (["rate_limited", "login_required", "challenge_required"].includes(error?.code)) {
          break;
        }
      }
      if (index < requests.length - 1) {
        const pause = (index + 1) % 5 === 0
          ? 120_000
          : 5000 + Math.random() * 3000;
        await monitorSleep(pause);
      }
    }
    nativePort?.postMessage({
      event: "monitor_cancel_result",
      profileId,
      completedAt: Date.now(),
      results,
    });
  } finally {
    if (monitorJobToken === jobToken) {
      monitorJobRunning = false;
      monitorJobStartedAt = 0;
    }
  }
}

function instagramAuthorization(userId, sessionId) {
  return `Bearer IGT:2:${btoa(JSON.stringify({
    ds_user_id: String(userId),
    sessionid: String(sessionId),
    should_use_header_over_cookies: true,
  }))}`;
}

function instagramAndroidId(deviceId, userId) {
  const seed = `${deviceId || ""}${userId || ""}`.toLowerCase().replace(/[^a-f0-9]/g, "");
  return `android-${seed.padEnd(16, "0").slice(0, 16)}`;
}

async function instagramPrivateSession(request = {}) {
  const requestedUserId = String(request.userId || "");
  let cookieStoreId = await resolveInstagramCookieStore(request);
  let sessionId = await getInstagramCookie("sessionid", cookieStoreId);
  let cookieUserId = await getInstagramCookie("ds_user_id", cookieStoreId);
  if (!sessionId || requestedUserId && String(cookieUserId || "") !== requestedUserId) {
    const matchedStoreId = await findInstagramAccountCookieStore(requestedUserId, cookieStoreId);
    if (matchedStoreId) {
      cookieStoreId = matchedStoreId;
      sessionId = await getInstagramCookie("sessionid", cookieStoreId);
      cookieUserId = await getInstagramCookie("ds_user_id", cookieStoreId);
    }
  }
  const [csrf, mid, rur, directRegionHint, cookieDeviceId] = await Promise.all([
    getInstagramCookie("csrftoken", cookieStoreId),
    getInstagramCookie("mid", cookieStoreId),
    getInstagramCookie("rur", cookieStoreId),
    getInstagramCookie("ig_direct_region_hint", cookieStoreId),
    getInstagramCookie("ig_did", cookieStoreId),
  ]);
  const sessionUserId = String(cookieUserId || sessionId.match(/^\d+/)?.[0] || "");
  if (!sessionId || !sessionUserId) {
    throw Object.assign(new Error("A conta está aberta, mas o cookie HttpOnly da sessão não foi encontrado no navegador ativo. Atualiza a sessão uma vez e volta a tentar."), {
      code: "instagram_session_cookie_missing",
      cookieStoreId: cookieStoreId || "default",
    });
  }
  if (requestedUserId && requestedUserId !== sessionUserId) {
    instagramDirectExecutorCache.clear();
    throw Object.assign(new Error("A conta aberta no Instagram mudou desde a pesquisa. Volta ao início e pesquisa a Inbox desta conta antes de apagar."), {
      code: "instagram_account_changed",
    });
  }
  const deviceId = String(cookieDeviceId || (globalThis.__FOLLOWCHECK_IOS_SHELL__ ? "" : request.deviceId || crypto.randomUUID()));
  return {
    userId: sessionUserId,
    sessionId,
    csrf: String(csrf || request.csrf || ""),
    deviceId,
    androidId: globalThis.__FOLLOWCHECK_IOS_SHELL__ ? "" : instagramAndroidId(deviceId, sessionUserId),
    claim: String(request.claim || "0").slice(0, 512),
    ajaxVersion: String(request.ajaxVersion || "").slice(0, 128),
    mid: String(mid || "").slice(0, 256),
    rur: String(rur || "").slice(0, 1024),
    directRegionHint: String(directRegionHint || "").slice(0, 1024),
    cookieStoreId: cookieStoreId || "default",
  };
}

function instagramMobileHeaders(session, includeCsrf = false) {
  return {
    accept: "*/*",
    authorization: instagramAuthorization(session.userId, session.sessionId),
    "ig-intended-user-id": session.userId,
    "ig-u-ds-user-id": session.userId,
    "user-agent": INSTAGRAM_MOBILE_USER_AGENT,
    "x-bloks-version-id": INSTAGRAM_BLOKS_VERSION,
    "x-fb-client-ip": "True",
    "x-fb-http-engine": "Tigon/MNS/TCP",
    "x-fb-server-cluster": "True",
    "x-ig-android-id": session.androidId,
    "x-ig-app-id": INSTAGRAM_MOBILE_APP_ID,
    "x-ig-capabilities": "3brTv10=",
    "x-ig-connection-type": "WIFI",
    "x-ig-device-id": session.deviceId,
    "x-ig-www-claim": session.claim || "0",
    ...(session.mid ? { "x-mid": session.mid } : {}),
    ...(session.rur ? { "ig-u-rur": session.rur } : {}),
    ...(session.directRegionHint ? { "ig-u-ig-direct-region-hint": session.directRegionHint } : {}),
    ...(includeCsrf ? {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      ...(session.csrf ? { "x-csrftoken": session.csrf } : {}),
    } : {}),
  };
}

function instagramWebHeaders(session, includeCsrf = false) {
  return {
    accept: "application/json",
    "x-ig-app-id": INSTAGRAM_WEB_APP_ID,
    "x-asbd-id": INSTAGRAM_ASBD_ID,
    "x-requested-with": "XMLHttpRequest",
    "x-ig-www-claim": session.claim || "0",
    ...(session.ajaxVersion ? { "x-instagram-ajax": session.ajaxVersion } : {}),
    ...(session.deviceId ? { "x-ig-device-id": session.deviceId } : {}),
    ...(includeCsrf ? {
      "content-type": "application/x-www-form-urlencoded",
      ...(session.csrf ? { "x-csrftoken": session.csrf } : {}),
    } : {}),
  };
}

function safeResponseUrl(value = "") {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

async function parseInstagramPrivateResponse(response, executor, requestUrl) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text().catch(() => "");
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  return {
    ok: response.ok && Boolean(data) && (!data?.status || data.status === "ok"),
    status: response.status,
    contentType,
    redirected: response.redirected,
    finalUrl: safeResponseUrl(response.url || ""),
    requestUrl: safeResponseUrl(requestUrl),
    executor,
    retryAfter: Math.max(
      retryAfterSeconds(response.headers.get("retry-after")),
      retryAfterSeconds(data?.retry_after),
    ),
    data,
  };
}

function executorAttempt(result) {
  return {
    executor: result.executor,
    ok: result.ok,
    status: result.status,
    contentType: result.contentType,
    redirected: result.redirected,
    finalUrl: result.finalUrl,
  };
}

async function executeInstagramRequest(executor, path, session, { method = "GET", mutation = false } = {}) {
  const mobile = executor === "mobile-session";
  if (globalThis.__FOLLOWCHECK_IOS_SHELL__ && mobile) {
    throw monitorFailure("O transporte Android não está disponível nesta sessão iOS.", "unsupported_transport");
  }
  const base = mobile ? INSTAGRAM_PRIVATE_API_BASE : INSTAGRAM_WEB_API_BASE;
  const url = `${base}${path}`;
  const body = mutation
    ? new URLSearchParams(mobile
      ? {
        should_move_future_requests_to_spam: "false",
        _uuid: session.deviceId,
      }
      : {
        _csrftoken: session.csrf,
        _uid: session.userId,
        _uuid: session.deviceId,
        should_move_future_requests_to_spam: "false",
      })
    : undefined;
  const response = await fetch(url, {
    method,
    credentials: "include",
    redirect: "follow",
    headers: mobile
      ? instagramMobileHeaders(session, mutation)
      : instagramWebHeaders(session, mutation),
    ...(body ? { body } : {}),
  });
  return parseInstagramPrivateResponse(response, executor, url);
}

async function probeInstagramDirectExecutor(request, session) {
  const threadPath = validInstagramThreadId(request.threadId)
    ? `/api/v1/direct_v2/threads/${encodeURIComponent(String(request.threadId))}/?limit=1`
    : "/api/v1/direct_v2/inbox/?limit=1&thread_message_limit=1&persistentBadging=true";
  const attempts = [];
  for (const executor of (globalThis.__FOLLOWCHECK_IOS_SHELL__ ? ["web-session"] : ["mobile-session", "web-session"])) {
    const result = await executeInstagramRequest(executor, threadPath, session);
    attempts.push(executorAttempt(result));
    if (result.ok && result.data) {
      instagramDirectExecutorCache.set(session.userId, executor);
      return { ...result, attempts };
    }
    if ([401, 403, 429].includes(result.status)) return { ...result, attempts };
  }
  return {
    ...attempts[attempts.length - 1],
    ok: false,
    data: null,
    attempts,
  };
}

function directReadPath(request = {}) {
  if (request.operation === "read-thread" && validInstagramThreadId(request.threadId)) {
    const limit = Math.max(1, Math.min(100, Number(request.limit) || 50));
    return `/api/v1/direct_v2/threads/${encodeURIComponent(String(request.threadId))}/?visual_message_return_type=unseen&limit=${limit}`;
  }
  if (request.operation !== "read-inbox") return "";
  const pending = request.kind === "pending";
  const limit = Math.max(1, Math.min(50, Number(request.limit) || 20));
  const params = new URLSearchParams({
    visual_message_return_type: "unseen",
    persistentBadging: "true",
    is_prefetching: "false",
    limit: String(limit),
    thread_message_limit: "10",
    fetch_reason: request.cursor ? "page_scroll" : "initial_snapshot",
  });
  const cursor = String(request.cursor || "");
  if (cursor && cursor.length <= 1024) {
    params.set("cursor", cursor);
    params.set("direction", "older");
  }
  return `/api/v1/direct_v2/${pending ? "pending_inbox" : "inbox"}/?${params}`;
}

async function readInstagramDirect(request, session) {
  const path = directReadPath(request);
  if (!path) {
    throw Object.assign(new Error("A leitura Direct v2 foi recusada pela extensão."), {
      code: "instagram_private_request_rejected",
    });
  }
  const preferred = instagramDirectExecutorCache.get(session.userId);
  const executors = preferred
    ? [preferred, preferred === "web-session" ? "mobile-session" : "web-session"]
    : ["web-session", "mobile-session"];
  const attempts = [];
  let lastResult = null;
  for (const executor of executors) {
    let result;
    try {
      result = await executeInstagramRequest(executor, path, session);
    } catch (error) {
      attempts.push({
        executor,
        ok: false,
        status: 0,
        contentType: "",
        redirected: false,
        finalUrl: "",
        error: String(error?.message || "Falha de transporte").slice(0, 180),
      });
      continue;
    }
    attempts.push(executorAttempt(result));
    lastResult = result;
    if (result.ok && result.data) {
      instagramDirectExecutorCache.set(session.userId, executor);
      return { ...result, attempts, adaptive: true };
    }
    if ([401, 403, 429].includes(result.status)) break;
  }
  return {
    ...(lastResult || { ok: false, status: 502, data: null, executor: "private-adaptive" }),
    attempts,
    adaptive: true,
  };
}

async function readInstagramDirectFromPage(request = {}) {
  const operation = request.operation === "read-thread"
    ? "direct-read-thread" : request.operation === "read-inbox"
      ? "direct-read-inbox" : "";
  if (!operation) return null;
  const result = await requestInstagramMainPage(operation, {
    kind: request.kind === "pending" ? "pending" : "inbox",
    cursor: String(request.cursor || "").slice(0, 1024),
    threadId: String(request.threadId || "").slice(0, 40),
    limit: Number(request.limit || 20),
  }, Number(request.tabId) || null).catch(() => null);
  if (!result) return null;
  if (result.securityWarning || result.code === "instagram_security_warning") {
    await tripGlobalSafety("instagram_security_warning", "O Instagram apresentou um aviso de segurança durante a Inbox.", {
      manualResetRequired: true,
      source: "inbox-page-main",
    });
  }
  return {
    ...result,
    requestUrl: "instagram://direct-read",
    executor: result.executor || "page-main",
    retryAfter: retryAfterSeconds(result.retryAfter),
    attempts: [{
      executor: result.executor || "page-main",
      ok: Boolean(result.ok),
      status: Number(result.status || 0),
      contentType: String(result.contentType || ""),
      redirected: Boolean(result.redirected),
      finalUrl: String(result.finalPath || ""),
    }],
    adaptive: false,
  };
}

async function performInstagramPrivateRequest(request = {}) {
  let pageResult = null;
  if (request.operation === "read-inbox" || request.operation === "read-thread") {
    pageResult = await readInstagramDirectFromPage(request).catch(() => null);
    if (pageResult?.ok) return pageResult;
    if (Number(pageResult?.status || 0) === 429
        || /rate.?limit|feedback_required|please wait|try again later/i.test(String(pageResult?.data?.error_type || pageResult?.data?.message || ""))) {
      await tripGlobalSafety("rate_limited", "O Instagram limitou temporariamente a Inbox. Todos os pedidos ficaram em cooldown global.", {
        manualResetRequired: false,
        cooldownUntil: Date.now() + GLOBAL_THROTTLE_COOLDOWN_MS,
        source: "inbox-page-main",
      });
    }
    if (pageResult) return pageResult;
    throw Object.assign(new Error("A página autenticada não disponibilizou a Inbox. Não foram tentados clientes privados alternativos."), {
      code: "page_main_unavailable",
    });
  }
  if (!validInstagramIdentity(request)) {
    throw Object.assign(new Error("A sessão Instagram não forneceu a identidade necessária ao executor."), {
      code: "instagram_private_identity_missing",
    });
  }

  if (request.operation === "relationship-action") {
    return performInstagramRelationshipAction(request);
  }

  let session;
  try {
    session = await instagramPrivateSession(request);
  } catch (error) {
    if (pageResult) return pageResult;
    throw error;
  }

  if (request.operation === "probe-session") {
    return {
      ok: true,
      status: 200,
      executor: "cookie-store",
      data: {
        status: "ok",
        userId: session.userId,
        cookieStoreId: session.cookieStoreId,
        csrfPresent: Boolean(session.csrf),
      },
    };
  }

  if (request.operation === "probe-direct") {
    return probeInstagramDirectExecutor(request, session);
  }

  if (request.operation === "read-inbox" || request.operation === "read-thread") {
    return readInstagramDirect(request, session);
  }

  if (request.operation !== "delete-thread" || !validInstagramThreadId(request.threadId)) {
    throw Object.assign(new Error("A operação Direct v2 foi recusada pela extensão."), {
      code: "instagram_private_request_rejected",
    });
  }

  const threadId = String(request.threadId);
  let executor = instagramDirectExecutorCache.get(session.userId);
  let probe = null;
  if (!executor) {
    probe = await probeInstagramDirectExecutor({ ...request, threadId }, session);
    if (!probe.ok) return probe;
    executor = probe.executor;
  }
  const result = await executeInstagramRequest(
    executor,
    `/api/v1/direct_v2/threads/${encodeURIComponent(threadId)}/hide/`,
    session,
    { method: "POST", mutation: true },
  );
  return {
    ...result,
    attempts: [
      ...(probe?.attempts || []),
      executorAttempt(result),
    ],
  };
}

const INSTAGRAM_RELATIONSHIP_ACTIONS = Object.freeze({
  follow: "create",
  unfollow: "destroy",
  removeFollower: "remove_follower",
  mute: "mute_posts_or_story_from_follow",
});

function validInstagramRelationshipTarget(value) {
  return /^\d{1,32}$/.test(String(value || ""));
}

async function executeInstagramRelationshipRequest(executor, action, targetId, session) {
  const mobile = executor === "mobile-session";
  if (globalThis.__FOLLOWCHECK_IOS_SHELL__ && mobile) {
    throw monitorFailure("O transporte Android não está disponível nesta sessão iOS.", "unsupported_transport");
  }
  const base = mobile ? INSTAGRAM_PRIVATE_API_BASE : INSTAGRAM_WEB_API_BASE;
  const verb = INSTAGRAM_RELATIONSHIP_ACTIONS[action];
  const path = `/api/v1/friendships/${verb}/${encodeURIComponent(targetId)}/`;
  const url = `${base}${path}`;
  const body = new URLSearchParams(mobile
    ? {
      _uuid: session.deviceId,
      _uid: session.userId,
      user_id: targetId,
      radio_type: "wifi-none",
      container_module: "profile",
    }
    : {
      _csrftoken: session.csrf,
      _uid: session.userId,
      _uuid: session.deviceId,
      user_id: targetId,
      container_module: "profile",
    });
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    redirect: "follow",
    headers: mobile
      ? instagramMobileHeaders(session, true)
      : instagramWebHeaders(session, true),
    body,
  });
  return parseInstagramPrivateResponse(response, executor, url);
}

async function performInstagramRelationshipAction(request = {}) {
  const action = String(request.action || "");
  const targetId = String(request.targetId || "");
  if (!validInstagramRelationshipTarget(targetId)
      || !INSTAGRAM_RELATIONSHIP_ACTIONS[action]) {
    throw Object.assign(new Error("A ação de relação foi recusada pela extensão."), {
      code: "instagram_relationship_request_rejected",
    });
  }

  await assertGlobalSafety("relationship-action-page-main");
  const result = await requestInstagramMainPage("relationship", {
    action,
    targetId,
    username: validInstagramUsername(request.username || ""),
  }, Number(request.tabId) || null).catch(() => null);
  if (!result) {
    throw Object.assign(new Error("A página autenticada não disponibilizou a ação. Não foram criadas sessões privadas alternativas."), {
      code: "page_main_unavailable",
    });
  }
  if (result.securityWarning || result.code === "instagram_security_warning") {
    await tripGlobalSafety("instagram_security_warning", "O Instagram apresentou um aviso de segurança durante uma ação de relação.", {
      manualResetRequired: true,
      source: "relationship-page-main",
    });
  } else if (Number(result.status || 0) === 429) {
    await tripGlobalSafety("rate_limited", "O Instagram limitou temporariamente as ações. Todos os pedidos foram colocados em cooldown.", {
      manualResetRequired: false,
      cooldownUntil: Date.now() + GLOBAL_THROTTLE_COOLDOWN_MS,
      serverCooldownUntil: Number(result.retryAfter)>0 ? Date.now()+Number(result.retryAfter)*1000 : 0,
      source: "relationship-page-main",
    });
  }
  return {
    ...result,
    action,
    targetId,
    executor: "page-main",
    adaptive: false,
  };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function rememberAvatar(url, dataUrl) {
  avatarCache.set(url, dataUrl);

  if (avatarCache.size > MAX_AVATAR_CACHE_ENTRIES) {
    avatarCache.delete(avatarCache.keys().next().value);
  }
}

async function fetchAvatar(url) {
  if (!isAllowedAvatarUrl(url)) {
    throw new Error("Avatar host is not allowed");
  }

  const cached = avatarCache.get(url);
  if (cached) return cached;

  const response = await fetch(url, {
    cache: "force-cache",
    credentials: "omit",
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Avatar request failed (${response.status})`);
  }

  if (!isAllowedAvatarUrl(response.url || url)) {
    throw new Error("Avatar redirected to an unapproved host");
  }

  const contentType = response.headers.get("content-type")?.split(";", 1)[0] || "";
  if (!contentType.startsWith("image/")) {
    throw new Error("Avatar response is not an image");
  }

  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_AVATAR_BYTES) {
    throw new Error("Avatar is too large");
  }

  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength || buffer.byteLength > MAX_AVATAR_BYTES) {
    throw new Error("Avatar has an invalid size");
  }

  const dataUrl = `data:${contentType};base64,${arrayBufferToBase64(buffer)}`;
  rememberAvatar(url, dataUrl);
  return dataUrl;
}

async function setActionState(tabId, { badge = "", color = "#8c7cff", title }) {
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text: badge }),
    chrome.action.setBadgeBackgroundColor({ tabId, color }),
    chrome.action.setTitle({ tabId, title }),
  ]);
}

function isAllowedZernioPath(path = "") {
  return /^\/v1(?:\/|$)/.test(path) && !path.includes("//") && !path.includes("\\");
}

function appendQuery(url, query = {}) {
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, String(item)));
    else url.searchParams.set(key, String(value));
  }
}

function maskKey(apiKey = "") {
  const trimmed = String(apiKey).trim();
  if (!trimmed) return "";
  if (trimmed.length < 9) return "••••••••";
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

async function getZernioConfig({ includeSecret = false } = {}) {
  const stored = await chrome.storage.local.get(ZERNIO_CONFIG_KEY);
  const config = stored[ZERNIO_CONFIG_KEY] || {};
  return includeSecret
    ? config
    : {
        configured: Boolean(config.apiKey),
        keyPreview: maskKey(config.apiKey),
        selectedAccountId: config.selectedAccountId || "",
        selectedProfileId: config.selectedProfileId || "",
        lastVerifiedAt: config.lastVerifiedAt || "",
      };
}

async function setZernioConfig(patch = {}) {
  const current = await getZernioConfig({ includeSecret: true });
  const apiKey = typeof patch.apiKey === "string" && patch.apiKey.trim()
    ? patch.apiKey.trim()
    : current.apiKey || "";
  if (patch.apiKey === null) throw new Error("A chave da API não pode ser nula.");
  const next = {
    apiKey,
    selectedAccountId: patch.selectedAccountId ?? current.selectedAccountId ?? "",
    selectedProfileId: patch.selectedProfileId ?? current.selectedProfileId ?? "",
    lastVerifiedAt: patch.lastVerifiedAt ?? current.lastVerifiedAt ?? "",
  };
  await chrome.storage.local.set({ [ZERNIO_CONFIG_KEY]: next });
  return getZernioConfig();
}

async function parseZernioResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json().catch(() => ({}));
  const text = await response.text().catch(() => "");
  return text ? { message: text } : {};
}

async function performZernioRequest(request = {}) {
  const config = await getZernioConfig({ includeSecret: true });
  if (!config.apiKey) throw Object.assign(new Error("Liga primeiro a tua chave API do Zernio."), { code: "ZERNIO_NOT_CONFIGURED" });

  const method = String(request.method || "GET").toUpperCase();
  if (!ZERNIO_METHODS.has(method) || !isAllowedZernioPath(request.path)) {
    throw Object.assign(new Error("Pedido Zernio recusado pela extensão."), { code: "ZERNIO_REQUEST_REJECTED" });
  }

  const url = new URL(`${ZERNIO_API_BASE}${request.path}`);
  appendQuery(url, request.query);
  const headers = { Accept: "application/json", Authorization: `Bearer ${config.apiKey}` };
  if (request.body !== undefined) headers["Content-Type"] = "application/json";
  if (request.requestId) headers["x-request-id"] = String(request.requestId);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: controller.signal,
      redirect: "follow",
      credentials: "omit",
    });
  } finally {
    clearTimeout(timeout);
  }
  const data = await parseZernioResponse(response);
  return {
    ok: response.ok,
    status: response.status,
    retryAfter: retryAfterSeconds(response.headers.get("retry-after")),
    requestId: response.headers.get("x-request-id") || request.requestId || "",
    data,
  };
}

function isAllowedUploadUrl(value = "") {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (
      url.hostname === "media.zernio.com" ||
      url.hostname === "r2.cloudflarestorage.com" ||
      url.hostname.endsWith(".r2.cloudflarestorage.com")
    );
  } catch {
    return false;
  }
}

function base64ToBytes(value = "") {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== ZERNIO_UPLOAD_PORT || !isInstagramSender(port.sender)) return;
  let upload = null;

  port.onMessage.addListener(async (message) => {
    try {
      if (message?.type === "start") {
        const size = Number(message.size || 0);
        if (!message.name || !size || size > ZERNIO_UPLOAD_MAX_BYTES) {
          throw new Error("O ficheiro não é válido ou ultrapassa 350 MB.");
        }
        upload = { name: String(message.name), contentType: String(message.contentType || "application/octet-stream"), size, received: 0, chunks: [] };
        port.postMessage({ type: "ready" });
        return;
      }
      if (message?.type === "chunk") {
        if (!upload) throw new Error("Upload não iniciado.");
        const bytes = base64ToBytes(message.data);
        upload.received += bytes.byteLength;
        if (upload.received > upload.size || upload.received > ZERNIO_UPLOAD_MAX_BYTES) throw new Error("O upload excedeu o tamanho anunciado.");
        upload.chunks.push(bytes);
        port.postMessage({ type: "progress", phase: "buffering", loaded: upload.received, total: upload.size });
        return;
      }
      if (message?.type !== "finish" || !upload) return;
      if (upload.received !== upload.size) throw new Error("O ficheiro não chegou completo à extensão.");

      port.postMessage({ type: "progress", phase: "presigning", loaded: upload.received, total: upload.size });
      const presign = await performZernioRequest({
        method: "POST",
        path: "/v1/media/presign",
        body: { filename: upload.name, contentType: upload.contentType },
      });
      if (!presign.ok) throw new Error(presign.data?.error || presign.data?.message || `O Zernio recusou o upload (${presign.status}).`);
      const uploadUrl = presign.data?.uploadUrl;
      if (!isAllowedUploadUrl(uploadUrl)) throw new Error("O Zernio devolveu um destino de upload inesperado.");

      const blob = new Blob(upload.chunks, { type: upload.contentType });
      port.postMessage({ type: "progress", phase: "uploading", loaded: upload.received, total: upload.size });
      const response = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": upload.contentType }, body: blob, credentials: "omit" });
      if (!response.ok) throw new Error(`O armazenamento recusou o ficheiro (${response.status}).`);
      port.postMessage({ type: "complete", publicUrl: presign.data.publicUrl, key: presign.data.key, expiresIn: presign.data.expiresIn });
      upload = null;
    } catch (error) {
      port.postMessage({ type: "error", error: error?.message || "O upload falhou." });
      upload = null;
    }
  });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  if (!isInstagramUrl(tab.url)) {
    await setActionState(tab.id, {
      badge: "IG",
      title: "Abre instagram.com para usar o FollowCheck",
    });
    return;
  }

  try {
    await setActionState(tab.id, { title: "FollowCheck 10.20.8 aberto" });
    await injectFollowCheckIntoTab(tab.id);
  } catch (error) {
    console.error("FollowCheck injection failed", error);
    await setActionState(tab.id, {
      badge: "!",
      color: "#f04444",
      title: "Não foi possível abrir o FollowCheck. Atualiza a página e tenta novamente.",
    });
  }
});



async function forgetCurrentInstagramAccount(sender) {
  if (globalThis.__FOLLOWCHECK_IOS_SHELL__) {
    return {ok:false, code:"session_preserved", error:"Para terminar a sessão, usa Sair no próprio Instagram. A app preservou os cookies e o histórico."};
  }
  const tabId = Number(sender?.tab?.id || 0);
  const cookieStoreId = await resolveInstagramCookieStore({
    tabId,
    cookieStoreId: sender?.tab?.cookieStoreId,
  }).catch(() => String(sender?.tab?.cookieStoreId || ""));

  let accountId = "";
  try {
    const cookie = await chrome.cookies.get({
      url: "https://www.instagram.com/",
      name: "ds_user_id",
      ...(cookieStoreId ? { storeId: cookieStoreId } : {}),
    });
    accountId = String(cookie?.value || "");
  } catch {}

  const cookies = await chrome.cookies.getAll({
    ...(cookieStoreId ? { storeId: cookieStoreId } : {}),
  }).catch(() => []);
  const targets = cookies.filter((cookie) => /(^|\.)instagram\.com$/i.test(String(cookie?.domain || "")));
  let removed = 0;
  for (const cookie of targets) {
    const host = String(cookie.domain || "").replace(/^\./, "") || "www.instagram.com";
    const url = `${cookie.secure === false ? "http" : "https"}://${host}${cookie.path || "/"}`;
    try {
      const result = await chrome.cookies.remove({
        url,
        name: cookie.name,
        ...(cookieStoreId ? { storeId: cookieStoreId } : {}),
      });
      if (result) removed += 1;
    } catch {}
  }

  if (accountId) {
    const keys = [
      `${MONITOR_STORAGE_PREFIX}:${accountId}`,
      monitorAvailabilityKey(accountId),
      privateMemoryKey(accountId),
    ];
    await chrome.storage.local.remove(keys).catch(() => {});
  }
  await chrome.storage.local.remove(LAST_INSTAGRAM_SESSION_STATE_KEY).catch(() => {});
  nativePort?.postMessage({
    event: "session_state",
    connected: false,
    userId: "",
    username: "",
    fullName: "",
    profilePicUrl: "",
  });
  return { ok: true, accountId, removed, cookieStoreId };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isInstagramSender(sender)) {
    sendResponse({ ok: false, error: "Pedido recusado." });
    return false;
  }

  if (message?.type === "FOLLOWCHECK_FORGET_CURRENT_ACCOUNT") {
    forgetCurrentInstagramAccount(sender)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({
        ok: false,
        error: String(error?.message || "Não foi possível limpar esta sessão.").slice(0, 220),
      }));
    return true;
  }

  if (message?.type === BACKGROUND_TIMER_MESSAGE) {
    return scheduleBackgroundTimer(message, sender, sendResponse);
  }

  if (message?.type === BACKGROUND_TIMER_CANCEL_MESSAGE) {
    return cancelBackgroundTimer(message, sender, sendResponse);
  }

  if (message?.type === "FOLLOWCHECK_PAGE_READY") {
    inspectInstagramSessionForNative().catch(error => backgroundLog("warn", "session", "inspection-failed", error.message));
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "FOLLOWCHECK_SECURITY_WARNING") {
    tripGlobalSafety("instagram_security_warning", "O Instagram apresentou um aviso de segurança. Conta própria, Watchlist e Inbox foram bloqueados.", {
      manualResetRequired: true,
      source: "instagram-page-observer",
    }).then((safety) => sendResponse({ ok: true, safety }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || "Falha ao ativar a proteção.").slice(0, 180) }));
    return true;
  }

  if (message?.type === "FOLLOWCHECK_TECHNICAL_LOGS_GET") {
    chrome.storage.local.get(BACKGROUND_TECHNICAL_LOG_KEY)
      .then((stored) => sendResponse({
        ok: true,
        logs: Array.isArray(stored?.[BACKGROUND_TECHNICAL_LOG_KEY])
          ? stored[BACKGROUND_TECHNICAL_LOG_KEY].slice(-1000)
          : [],
      }))
      .catch(() => sendResponse({ ok: false, logs: [] }));
    return true;
  }

  if (message?.type === "FOLLOWCHECK_TECHNICAL_LOGS_CLEAR") {
    chrome.storage.local.remove(BACKGROUND_TECHNICAL_LOG_KEY)
      .then(() => {
        nativePort?.postMessage({ event: "diagnostics_clear" });
        sendResponse({ ok: true });
      })
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "FOLLOWCHECK_SAFETY_STATE_GET") {
    readGlobalSafetyState()
      .then((safety) => sendResponse({ ok: true, safety }))
      .catch(() => sendResponse({ ok: false, safety: normalizedSafetyState({}) }));
    return true;
  }

  if (message?.type === "FOLLOWCHECK_SAFETY_STATE_RESET") {
    (globalThis.__FOLLOWCHECK_IOS_SHELL__
      ? globalThis.__FOLLOWCHECK_IOS_CONTROL__("confirmSession").then(() => readGlobalSafetyState())
      : resetGlobalSafetyState())
      .then((safety) => sendResponse({ ok: true, safety }))
      .catch((error) => sendResponse({
        ok: false,
        error: String(error?.message || "Não foi possível desbloquear os pedidos Instagram.").slice(0, 220),
      }));
    return true;
  }

  if (message?.type === "FOLLOWCHECK_WATCHLIST_COMMAND") {
    const action = String(message.action || "");
    if (!new Set(["get", "add", "update", "remove", "run", "list", "mark_read"]).has(action)) {
      sendResponse({ ok: false, error: "Ação de Watchlist inválida." });
      return false;
    }
    handleWatchlistCommand(message)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || "Não foi possível atualizar a Watchlist.").slice(0, 220) }));
    return true;
  }

  if (message?.type === "FOLLOWCHECK_MONITOR_AUDIENCE_REPLAY") {
    monitorAudienceReplay(message.accountId)
      .then((snapshot) => sendResponse(snapshot
        ? { ok: true, snapshot }
        : { ok: false, error: "snapshot_missing" }))
      .catch(() => sendResponse({ ok: false, error: "snapshot_replay_failed" }));
    return true;
  }

  if (message?.type === "FOLLOWCHECK_PAGE_SESSION_STATE") {
    (async () => {
      const avatarValue = String(message.profilePicUrl || "");
      const cookieStoreId = await resolveInstagramCookieStore({ tabId: sender.tab?.id, cookieStoreId: sender.tab?.cookieStoreId });
      let state = {
        connected: Boolean(message.connected), userId: String(message.userId || ""), username: String(message.username || ""), fullName: String(message.fullName || ""),
        profilePicUrl: /^data:image\//i.test(avatarValue) ? avatarValue.slice(0, 750000) : avatarValue.slice(0, 4000), cookieStoreId,
      };
      if (state.connected && state.userId) {
        state = await rememberLastInstagramSessionState(state);
        state = await hydrateInstagramSessionIdentity(
          state,
          sender.tab?.id,
        ).catch(() => state);
        nativePort?.postMessage({ event: "session_state", ...state });
      } else {
        const previous = await readLastInstagramSessionState().catch(() => ({}));
        const current = await resolveMonitorInstagramSession(
          sender.tab,
          previous?.username || "",
          previous?.userId || "",
        ).catch(() => ({
          sessionId: "",
          userId: "",
          failureCode: "session_unverified",
          logoutConfirmed: false,
        }));
        if (current.sessionId && current.userId) {
          const sameAccount = !previous?.userId
            || String(previous.userId) === String(current.userId);
          const recovered = await rememberLastInstagramSessionState({
            connected: true,
            userId: String(current.userId),
            username: String(current.username || (sameAccount ? previous?.username : "") || ""),
            fullName: String(current.fullName || (sameAccount ? previous?.fullName : "") || ""),
            profilePicUrl: String(current.profilePicUrl || (sameAccount ? previous?.profilePicUrl : "") || ""),
            cookieStoreId: current.cookieStoreId || cookieStoreId,
          });
          nativePort?.postMessage({ event: "session_state", ...recovered });
        } else {
          nativePort?.postMessage({
            event: "session_state",
            connected: false,
            userId: "",
            username: "",
            fullName: "",
            profilePicUrl: "",
            reason: current.failureCode || "session_unverified",
            logoutConfirmed: Boolean(current.logoutConfirmed),
          });
        }
      }
      sendResponse({ ok: true });
    })().catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "FOLLOWCHECK_PROGRESS_UPDATE") {
    postNativeProgress(message);
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "FOLLOWCHECK_LOGIN_ERROR") {
    nativePort?.postMessage({
      event: "login_error",
      message: String(message.message || "O Instagram recusou a tentativa de login.")
        .slice(0, 220),
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "FOLLOWCHECK_NATIVE_NAVIGATE_HOME") {
    nativePort?.postMessage({
      event: "native_navigation",
      destination: "home",
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "FOLLOWCHECK_OPEN_NATIVE_SETTINGS") {
    if (!isInstagramSender(sender)) {
      sendResponse({ ok: false, error: "Origem inválida." });
      return false;
    }
    nativePort?.postMessage({
      event: "native_navigation",
      destination: "settings",
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "FOLLOWCHECK_OPEN_ACCOUNT_MANAGER"
      || message?.type === "FOLLOWCHECK_RUN_MONITOR_NOW"
      || message?.type === "FOLLOWCHECK_CHECK_SESSION") {
    if (!isInstagramSender(sender)) {
      sendResponse({ ok: false, error: "Origem inválida." });
      return false;
    }
    const destination = message.type === "FOLLOWCHECK_OPEN_ACCOUNT_MANAGER"
      ? "account-manager"
      : message.type === "FOLLOWCHECK_RUN_MONITOR_NOW"
        ? "monitor-run"
        : "session-check";
    nativePort?.postMessage({ event: "native_navigation", destination });
    sendResponse({ ok: Boolean(nativePort) });
    return false;
  }

  if (message?.type === "FOLLOWCHECK_MARK_EVENTS_READ") {
    if (!isInstagramSender(sender)) {
      sendResponse({ ok: false, error: "Origem inválida." });
      return false;
    }
    nativePort?.postMessage({ event: "mark_events_read" });
    sendResponse({ ok: Boolean(nativePort) });
    return false;
  }

  if (message?.type === "FOLLOWCHECK_SESSION_INFO") {
    (async () => {
      const resolved = await resolveMonitorInstagramSession(
        sender.tab || null,
        message.username || "",
        message.accountId || "",
      );
      const last = await readLastInstagramSessionState().catch(() => ({}));
      sendResponse({
        ok: Boolean(resolved?.userId),
        connected: Boolean(resolved?.userId && resolved?.sessionId),
        accountId: String(resolved?.userId || last?.userId || ""),
        username: String(resolved?.username || last?.username || ""),
        fullName: String(resolved?.fullName || last?.fullName || ""),
        profilePicUrl: String(resolved?.profilePicUrl || last?.profilePicUrl || ""),
        pageSession: Boolean(resolved?.pageSession),
      });
    })().catch((error) => sendResponse({ ok: false, error: String(error?.message || "Falha ao validar sessão.").slice(0, 180) }));
    return true;
  }

  if (message?.type === "FOLLOWCHECK_MANUAL_SCAN_WEB") {
    if (!isInstagramSender(sender)) {
      sendResponse({ ok: false, error: "Origem inválida." });
      return false;
    }
    if (globalThis.__FOLLOWCHECK_IOS_SHELL__) {
      const checkId = globalThis.crypto?.randomUUID?.()
        || `ios-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const task = {
        profileId: String(message.profileId || "ios-manual"),
        username: String(message.username || ""),
        accountId: String(message.accountId || ""),
        checkId,
        manual: true,
        trigger: "ios-foreground",
      };
      sendResponse({ ok: true, queued: true, checkId, engine: "ios-foreground" });
      globalThis.setTimeout(() => {
        runNativeMonitorScan(task).catch((error) => {
          tripSafetyFromError(error, "ios-own-check").catch(() =>{});
          const reportedCode = error?.code === "global_safety_lock"
            ? "instagram_security_warning"
            : String(error?.code || "monitor_failed");
          backgroundLog("error", "monitor", "ios-own-check-failed", String(error?.message || "A sincronização falhou."), {
            code: reportedCode,
            status: Number(error?.status || 0),
            checkId,
          });
          postMonitorStopped(
            String(task.profileId || ""),
            "Check não concluído",
            String(error?.message || "A sincronização falhou."),
            "error",
          );
          nativePort?.postMessage({
            event: "monitor_error",
            profileId: String(task.profileId || ""),
            checkId,
            code: reportedCode,
            message: String(error?.message || "A sincronização falhou.").slice(0, 220),
            status: Number(error?.status || 0),
          });
        });
      }, 0);
      return false;
    }
    if (!nativePort) {
      sendResponse({ ok: false, code: "native_queue_unavailable", error: "A fila única Android ainda não está ligada." });
      return false;
    }
    nativePort.postMessage({ event: "native_navigation", destination: "monitor-run" });
    backgroundLog("info", "scan", "manual-routed-to-native-queue",
      "O pedido manual foi entregue à mesma fila global dos checks automáticos.", {
        profileId: String(message.profileId || ""),
      });
    sendResponse({ ok: true, queued: true, engine: "android-native-single-queue" });
    return false;
  }

  if (message?.type === MOBILE_TOGGLE_MESSAGE) {
    if (!sender.tab?.id) {
      sendResponse({ ok: false, error: "Não foi possível identificar o separador Instagram." });
      return false;
    }
    injectFollowCheckIntoTab(sender.tab.id)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({
        ok: false,
        error: error?.message || "Não foi possível abrir o FollowCheck.",
      }));
    return true;
  }

  if (message?.type === AVATAR_MESSAGE) {
    if (!isAllowedAvatarUrl(message.url)) {
      sendResponse({ ok: false, error: "Pedido de imagem recusado." });
      return false;
    }
    fetchAvatar(message.url)
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch(() => sendResponse({ ok: false, error: "Não foi possível carregar a fotografia." }));
    return true;
  }

  if (message?.type === PRIVATE_MEMORY_MESSAGE) {
    privateMemoryOperation(message.operation, message.memories, message.accountId)
      .then((memories) => sendResponse({ ok: true, memories }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Não foi possível guardar a memória privada." }));
    return true;
  }

  if (message?.type === INSTAGRAM_PRIVATE_API_MESSAGE) {
    assertGlobalSafety("instagram-private-api")
      .then(() => performInstagramPrivateRequest({
        ...message,
        tabId: sender.tab?.id,
        cookieStoreId: sender.tab?.cookieStoreId,
      }))
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({
        ok: false,
        error: error?.message || "O executor Direct v2 falhou.",
        code: error?.code || "instagram_private_request_failed",
      }));
    return true;
  }

  if (message?.type === INSTAGRAM_RELATIONSHIP_ACTION_MESSAGE) {
    if (!isInstagramSender(sender)) {
      sendResponse({ ok: false, error: "A ação só pode ser executada dentro do Instagram.", code: "instagram_sender_rejected" });
      return false;
    }
    assertGlobalSafety("instagram-relationship-action")
      .then(() => performInstagramRelationshipAction({
        ...message,
        tabId: sender.tab?.id,
        cookieStoreId: sender.tab?.cookieStoreId,
      }))
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({
        ok: false,
        error: error?.message || "O executor de relações falhou.",
        code: error?.code || "instagram_relationship_request_failed",
      }));
    return true;
  }

  if (message?.type === ZERNIO_CONFIG_MESSAGE) {
    const operation = message.operation;
    const task = operation === "get"
      ? getZernioConfig()
      : operation === "set"
        ? setZernioConfig(message.config)
        : operation === "clear"
          ? chrome.storage.local.remove(ZERNIO_CONFIG_KEY).then(() => ({ configured: false, keyPreview: "", selectedAccountId: "", selectedProfileId: "", lastVerifiedAt: "" }))
          : Promise.reject(new Error("Operação de configuração desconhecida."));
    task.then((config) => sendResponse({ ok: true, config })).catch((error) => sendResponse({ ok: false, error: error?.message || "Não foi possível guardar a ligação." }));
    return true;
  }

  if (message?.type === ZERNIO_API_MESSAGE) {
    performZernioRequest(message.request)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "O pedido ao Zernio falhou.", code: error?.code || "ZERNIO_REQUEST_FAILED" }));
    return true;
  }

  return false;
});

chrome.notifications?.onClicked?.addListener((notificationId) => {
  if (!String(notificationId || "").startsWith("followcheck-watch-")) return;
  openFollowCheckNative("watchlist").catch(() => {});
});

installBackgroundConsoleCapture();
connectNativeBridge();
ensureGlobalSafetyMigration().catch(() => {});

// Compare only fully enumerated observations of the same post. Preserve the last
// complete baseline when a later read is partial or unavailable.
function mergeMediaLikeObservations(previous = [], incoming = []) {
  const old=new Map(previous.map(post=>[post.id,post]));
  for(const post of incoming) {
    const prior=old.get(post.id);
    const baseline=prior?.complete ? prior : prior?.baseline;
    const before=new Map((baseline?.users||[]).map(user=>[user.id,user]));
    const now=new Map((post.users||[]).map(user=>[user.id,user]));
    const comparable=post.complete===true && baseline?.complete===true;
    const added=comparable ? [...now.values()].filter(user=>!before.has(user.id)) : [];
    const removed=comparable ? [...before.values()].filter(user=>!now.has(user.id)) : [];
    const events=comparable ? [...added.map(user=>({id:`${post.observedAt}:added:${user.id}`,type:'added',user,observedAt:post.observedAt})),...removed.map(user=>({id:`${post.observedAt}:removed:${user.id}`,type:'removed',user,observedAt:post.observedAt}))] : [];
    old.set(post.id,{...post,baseline:post.complete ? null : baseline||null,compared:comparable,events:[...events,...(prior?.events||[])].slice(0,300)});
  }
  return [...old.values()].sort((a,b)=>b.observedAt-a.observedAt).slice(0,24);
}
