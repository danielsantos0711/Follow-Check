(() => {
  if (globalThis.__FOLLOWCHECK_HEARTBEAT_TIMER_SHIM__) return;
  globalThis.__FOLLOWCHECK_HEARTBEAT_TIMER_SHIM__ = true;

  const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
  const nativeClearTimeout = globalThis.clearTimeout.bind(globalThis);
  const pending = new Map();
  let nextTimerId = -1;

  function cancelRemote(timer) {
    browser.runtime.sendMessage({
      type: "FOLLOWCHECK_BACKGROUND_TIMER_CANCEL",
      requestId: timer.requestId,
    }).catch(() => {});
  }

  function complete(timerId, cancelBackground = true) {
    const timer = pending.get(timerId);
    if (!timer) return;
    pending.delete(timerId);
    nativeClearTimeout(timer.fallbackId);
    if (cancelBackground) cancelRemote(timer);
    try {
      timer.callback(...timer.args);
    } catch (error) {
      nativeSetTimeout(() => {
        throw error;
      }, 0);
    }
  }

  globalThis.setTimeout = (callback, delay = 0, ...args) => {
    const waitMs = Math.max(0, Number(delay) || 0);
    if (typeof callback !== "function" || waitMs < 200) {
      return nativeSetTimeout(callback, waitMs, ...args);
    }

    const timerId = nextTimerId--;
    const timer = {
      callback,
      args,
      dueAt: Date.now() + waitMs,
      fallbackId: 0,
      requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.abs(timerId)}`,
    };
    timer.fallbackId = nativeSetTimeout(() => complete(timerId), waitMs);
    pending.set(timerId, timer);
    browser.runtime.sendMessage({
      type: "FOLLOWCHECK_BACKGROUND_TIMER",
      requestId: timer.requestId,
      delayMs: waitMs,
    }).then((response) => {
      if (response?.ok) complete(timerId, false);
    }).catch(() => {});
    return timerId;
  };

  globalThis.clearTimeout = (timerId) => {
    const timer = pending.get(timerId);
    if (!timer) {
      nativeClearTimeout(timerId);
      return;
    }
    pending.delete(timerId);
    nativeClearTimeout(timer.fallbackId);
    cancelRemote(timer);
  };

  let progressObserver = null;
  let observedRoot = null;
  let lastProgressSignature = "";
  let lastDetectedPayload = null;
  let progressThrottle = 0;

  function cleanText(value = "") {
    return String(value)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
  }

  function visible(element) {
    if (!element) return false;
    const style = globalThis.getComputedStyle(element);
    return style.display !== "none"
      && style.visibility !== "hidden"
      && Number(style.opacity || 1) > 0;
  }

  function percentageFrom(element, text) {
    const valued = element?.querySelector?.("[aria-valuenow]")?.getAttribute("aria-valuenow")
      || element?.getAttribute?.("aria-valuenow");
    if (valued !== null && valued !== undefined && valued !== "") {
      const parsed = Number(valued);
      if (Number.isFinite(parsed)) return Math.max(0, Math.min(100, Math.round(parsed)));
    }
    const textMatch = String(text).match(/(?:^|\s)(100|\d{1,2})(?:[.,]\d+)?\s*%/);
    if (textMatch) return Number(textMatch[1]);
    for (const bar of element?.querySelectorAll?.(
      ".progress-track > *, .operation-progress > *, .zernio-progress > *, [class*='progress'] > *",
    ) || []) {
      const width = bar.style?.width || "";
      const widthMatch = width.match(/(100|\d{1,2})(?:\.\d+)?%/);
      if (widthMatch) return Number(widthMatch[1]);
    }
    return -1;
  }

  function reportProgressNow() {
    progressThrottle = 0;
    const host = document.getElementById("followcheck-app-host");
    const root = host?.shadowRoot;
    if (!root) {
      const idlePayload = {
        type: "FOLLOWCHECK_PROGRESS_UPDATE",
        phase: "idle",
        active: false,
        title: "FollowCheck pronto",
        detail: "Sem operações ativas",
        percentage: -1,
      };
      lastDetectedPayload = idlePayload;
      const idleSignature = JSON.stringify(idlePayload);
      if (idleSignature !== lastProgressSignature) {
        lastProgressSignature = idleSignature;
        browser.runtime.sendMessage(idlePayload).catch(() => {});
      }
      return;
    }

    const terminal = root.querySelector(
      ".global-activity-dock.status-complete, "
      + ".global-activity-dock.status-error, "
      + ".inbox-cleanup-progress.status-complete, "
      + ".inbox-cleanup-progress.status-error, "
      + "[class*='progress'].status-complete, "
      + "[class*='progress'].status-error",
    );
    if (visible(terminal)) {
      const failed = /\bstatus-error\b/i.test(String(terminal.className || ""));
      const terminalPayload = {
        type: "FOLLOWCHECK_PROGRESS_UPDATE",
        phase: failed ? "failed" : "completed",
        active: false,
        title: failed ? "Operação interrompida" : "Operação concluída",
        detail: cleanText(terminal.innerText || terminal.textContent)
          || (failed ? "A operação terminou com erro." : "A operação terminou com sucesso."),
        percentage: failed ? percentageFrom(terminal, terminal.textContent) : 100,
      };
      lastDetectedPayload = terminalPayload;
      const terminalSignature = JSON.stringify(terminalPayload);
      if (terminalSignature !== lastProgressSignature) {
        lastProgressSignature = terminalSignature;
        browser.runtime.sendMessage(terminalPayload).catch(() => {});
      }
      return terminalPayload;
    }

    const candidates = [
      [".global-activity-dock", "FollowCheck em execução"],
      [".v7-activity-strip:not(.is-idle)", "FollowCheck em execução"],
      [".scan-live-header", "Análise Instagram"],
      [".operation-progress", "Operação em curso"],
      [".zernio-progress", "Sincronização Zernio"],
      [".inbox-cleanup-progress", "Limpeza da caixa de entrada"],
      [".publish-progress", "Publicação em curso"],
      [".v8-import-progress", "Importação em curso"],
      [".v9-live-progress", "Análise em curso"],
    ];
    let target = null;
    let title = "FollowCheck em execução";
    for (const [selector, candidateTitle] of candidates) {
      const element = root.querySelector(selector);
      if (!visible(element)) continue;
      const className = String(element.className || "");
      if (/\b(is-idle|status-idle|status-complete|status-completed)\b/i.test(className)) {
        continue;
      }
      if (selector === ".operation-progress"
          && !element.closest(".operations-view")?.querySelector(".queue-controls")) {
        continue;
      }
      target = element;
      title = candidateTitle;
      break;
    }

    let detail = target ? cleanText(target.innerText || target.textContent) : "";
    if (target?.matches?.(".operation-progress")) {
      const count = cleanText(target.firstElementChild?.querySelector("strong")?.textContent);
      const profile = cleanText(target.querySelector(".operation-live-profile strong")?.textContent);
      const remaining = cleanText(
        target.querySelector(".operation-time-grid span:nth-child(2) strong")?.textContent,
      );
      detail = [
        count ? `Progresso ${count}` : "",
        profile ? `A processar ${profile}` : "",
        remaining && remaining !== "—" ? `Restante ${remaining}` : "",
      ].filter(Boolean).join(" • ") || "Fila operacional ativa";
    }
    const percentage = target ? percentageFrom(target, detail) : -1;
    const targetText = String(target?.innerText || target?.textContent || "");
    const paused = /\b(pausa|pausado|paused|rate limit|limite temporário)\b/i.test(
      `${String(target?.className || "")} ${targetText}`,
    );
    const payload = target
      ? {
          type: "FOLLOWCHECK_PROGRESS_UPDATE",
          phase: paused ? "paused" : "running",
          active: true,
          title,
          detail: detail || "Operação ativa",
          percentage,
        }
      : {
          type: "FOLLOWCHECK_PROGRESS_UPDATE",
          phase: "idle",
          active: false,
          title: "FollowCheck pronto",
          detail: "Sem operações ativas",
          percentage: -1,
        };
    lastDetectedPayload = payload;
    const signature = JSON.stringify(payload);
    if (signature === lastProgressSignature) return;
    lastProgressSignature = signature;
    browser.runtime.sendMessage(payload).catch(() => {});
    return payload;
  }

  function scheduleProgressReport() {
    if (progressThrottle) return;
    progressThrottle = nativeSetTimeout(reportProgressNow, 400);
  }

  function connectProgressObserver() {
    if (document.hidden) {
      progressObserver?.disconnect();
      progressObserver = null;
      observedRoot = null;
      return;
    }
    const root = document.getElementById("followcheck-app-host")?.shadowRoot;
    if (!root) {
      progressObserver?.disconnect();
      progressObserver = null;
      observedRoot = null;
      scheduleProgressReport();
      return;
    }
    if (root === observedRoot) {
      scheduleProgressReport();
      return;
    }
    progressObserver?.disconnect();
    observedRoot = root;
    progressObserver = new MutationObserver(scheduleProgressReport);
    progressObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
      attributeFilter: ["class", "style", "aria-valuenow"],
    });
    scheduleProgressReport();
  }

  connectProgressObserver();
  nativeSetTimeout(connectProgressObserver, 600);
  nativeSetTimeout(connectProgressObserver, 1800);
  // React announces remounts explicitly. A permanent 3-second DOM poll kept
  // waking Gecko and was especially costly after task switching on Fold.
  globalThis.addEventListener("followcheck:workspace-ready", connectProgressObserver);
  globalThis.addEventListener("followcheck:workspace-reconciling", () => {
    progressObserver?.disconnect();
    progressObserver = null;
    observedRoot = null;
  });
  globalThis.addEventListener("pageshow", connectProgressObserver);
  document.addEventListener("visibilitychange", connectProgressObserver);
  globalThis.__FOLLOWCHECK_PROGRESS_SNAPSHOT__ = () => {
    reportProgressNow();
    return lastDetectedPayload || {
      phase: "idle",
      active: false,
      title: "FollowCheck pronto",
      detail: "Sem operações ativas",
      percentage: -1,
    };
  };
})();
