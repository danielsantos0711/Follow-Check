(() => {
  if (globalThis.__FOLLOWCHECK_IOS_POLYFILL__) return;
  globalThis.__FOLLOWCHECK_IOS_POLYFILL__ = true;
  globalThis.__FOLLOWCHECK_IOS_SHELL__ = true;

  const backgroundMessageListeners = [];
  const contentMessageListeners = [];
  const connectListeners = [];
  const alarmListeners = [];
  const notificationClickListeners = [];
  const storageChangeListeners = [];
  const alarms = new Map();
  const tabId = 1;
  const noResponse = Symbol("no-response");

  function addUnique(list, listener) {
    if (typeof listener === "function" && !list.includes(listener)) list.push(listener);
  }

  function eventFor(list) {
    return {
      addListener(listener) { addUnique(list, listener); },
      removeListener(listener) {
        const index = list.indexOf(listener);
        if (index >= 0) list.splice(index, 1);
      },
      hasListener(listener) { return list.includes(listener); },
      hasListeners() { return list.length > 0; },
    };
  }

  function postNative(payload) {
    try {
      globalThis.webkit?.messageHandlers?.followcheckIOS?.postMessage(payload);
    } catch {
      // The web application must keep running if the containing app is detached.
    }
  }

  function nativeRPC(payload) {
    try {
      const handler = globalThis.webkit?.messageHandlers?.followcheckRPC;
      if (!handler?.postMessage) return Promise.resolve(null);
      return Promise.resolve(handler.postMessage(payload));
    } catch {
      return Promise.resolve(null);
    }
  }

  function currentTab() {
    return {
      id: tabId,
      active: true,
      highlighted: true,
      incognito: false,
      index: 0,
      pinned: false,
      status: document.readyState === "complete" ? "complete" : "loading",
      title: document.title || "Instagram",
      url: location.href,
      pendingUrl: location.href,
      cookieStoreId: "ios-default",
      windowId: 1,
    };
  }

  function sender() {
    return {
      id: "followcheck-ios@dannysantos.ch",
      frameId: 0,
      url: location.href,
      tab: currentTab(),
    };
  }

  async function invokeListener(listener, message, source) {
    let response = noResponse;
    let resolveResponse;
    const responsePromise = new Promise((resolve) => { resolveResponse = resolve; });
    const sendResponse = (value) => {
      if (response !== noResponse) return;
      response = value;
      resolveResponse(value);
    };

    let returned;
    try {
      returned = listener(message, source, sendResponse);
    } catch (error) {
      postNative({ kind: "javascriptError", message: String(error?.message || error) });
      throw error;
    }

    if (returned && typeof returned.then === "function") {
      try {
        const value = await returned;
        return value === undefined ? response : value;
      } catch (error) {
        throw error;
      }
    }
    if (response !== noResponse) return response;
    if (returned === true) {
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = globalThis.setTimeout(() => reject(new Error("O motor excedeu o tempo limite de resposta.")), 130000);
      });
      try { return await Promise.race([responsePromise, timeout]); }
      finally { globalThis.clearTimeout(timer); }
    }
    return returned === false || returned === undefined ? noResponse : returned;
  }

  async function dispatchMessage(listeners, message) {
    for (const listener of [...listeners]) {
      const value = await invokeListener(listener, message, sender());
      if (value !== noResponse) return value;
    }
    return null;
  }

  const database = new Promise((resolve, reject) => {
    const request = indexedDB.open("followcheck-ios-extension", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("local")) {
        request.result.createObjectStore("local");
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onblocked = () => reject(new Error("O armazenamento aguarda o fecho de outra instância."));
    request.onerror = () => reject(request.error || new Error("IndexedDB unavailable"));
  });

  async function storageTransaction(mode, action) {
    const db = await database;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("local", mode);
      const store = transaction.objectStore("local");
      let result;
      try { result = action(store); } catch (error) { reject(error); return; }
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error("Storage transaction failed"));
      transaction.onabort = () => reject(transaction.error || new Error("Storage transaction aborted"));
    });
  }

  function requestValue(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Storage request failed"));
    });
  }

  async function storageGet(query = null) {
    const db = await database;
    const transaction = db.transaction("local", "readonly");
    const store = transaction.objectStore("local");
    if (query == null) {
      const [keys, values] = await Promise.all([
        requestValue(store.getAllKeys()),
        requestValue(store.getAll()),
      ]);
      return Object.fromEntries(keys.map((key, index) => [String(key), values[index]]));
    }
    const defaults = query && !Array.isArray(query) && typeof query === "object" ? query : {};
    const keys = typeof query === "string"
      ? [query]
      : Array.isArray(query)
        ? query
        : Object.keys(defaults);
    const entries = await Promise.all(keys.map(async (key) => {
      const value = await requestValue(store.get(String(key)));
      return [String(key), value === undefined ? defaults[key] : value];
    }));
    return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
  }

  async function storageSetNow(items = {}) {
    const previous = await storageGet(Object.keys(items));
    await storageTransaction("readwrite", (store) => {
      for (const [key, value] of Object.entries(items)) store.put(value, key);
    });
    const changes = Object.fromEntries(Object.entries(items).map(([key, value]) => [key, {
      oldValue: previous[key],
      newValue: value,
    }]));
    for (const listener of [...storageChangeListeners]) {
      try { listener(changes, "local"); } catch { }
    }
  }

  async function storageRemoveNow(keys) {
    const list = Array.isArray(keys) ? keys.map(String) : [String(keys)];
    const previous = await storageGet(list);
    await storageTransaction("readwrite", (store) => {
      for (const key of list) store.delete(key);
    });
    const changes = Object.fromEntries(list
      .filter((key) => previous[key] !== undefined)
      .map((key) => [key, { oldValue: previous[key] }]));
    for (const listener of [...storageChangeListeners]) {
      try { listener(changes, "local"); } catch { }
    }
  }

  async function storageClearNow() {
    const previous = await storageGet(null);
    await storageTransaction("readwrite", (store) => store.clear());
    const changes = Object.fromEntries(Object.entries(previous).map(([key, value]) => [key, { oldValue: value }]));
    for (const listener of [...storageChangeListeners]) {
      try { listener(changes, "local"); } catch { }
    }
  }

  let storageWrites = Promise.resolve();
  function enqueueStorage(work) {
    const next = storageWrites.then(work);
    storageWrites = next.catch(() => {});
    return next;
  }
  const storageSet = items => enqueueStorage(() => storageSetNow(items));
  const storageRemove = keys => enqueueStorage(() => storageRemoveNow(keys));
  const storageClear = () => enqueueStorage(storageClearNow);

  function parseVisibleCookies(urlValue = location.href) {
    let host = location.hostname;
    try { host = new URL(urlValue || location.href).hostname; } catch { }
    return String(document.cookie || "").split(/;\s*/).filter(Boolean).map((part) => {
      const separator = part.indexOf("=");
      const name = separator >= 0 ? part.slice(0, separator) : part;
      const value = separator >= 0 ? part.slice(separator + 1) : "";
      return { name, value, domain: host, path: "/", secure: location.protocol === "https:", httpOnly: false, storeId: "ios-default" };
    });
  }

  async function allCookies(details = {}) {
    const native = await nativeRPC({ kind: "cookies.getAll", details });
    const cookies = Array.isArray(native?.cookies) ? native.cookies : parseVisibleCookies(details.url);
    const requestedHost = details.url ? new URL(details.url).hostname.toLowerCase() : null;
    return cookies.filter((cookie) => {
      if (requestedHost) {
        const domain = String(cookie.domain || '').replace(/^\./,'').toLowerCase();
        if (requestedHost !== domain && !requestedHost.endsWith('.' + domain)) return false;
      }
      if (details.name && cookie.name !== details.name) return false;
      if (details.domain) {
        const expected = String(details.domain).replace(/^\./, "").toLowerCase();
        const actual = String(cookie.domain || "").replace(/^\./, "").toLowerCase();
        if (actual !== expected && !actual.endsWith(`.${expected}`) && !expected.endsWith(`.${actual}`)) return false;
      }
      return true;
    });
  }

  function pairedPort(name) {
    const clientMessage = [];
    const serverMessage = [];
    const clientDisconnect = [];
    const serverDisconnect = [];
    let disconnected = false;
    const makePort = (incoming, outgoing, disconnectIncoming, disconnectOutgoing, includeSender) => ({
      name,
      sender: includeSender ? sender() : undefined,
      onMessage: eventFor(incoming),
      onDisconnect: eventFor(disconnectIncoming),
      postMessage(message) {
        if (disconnected) return;
        queueMicrotask(() => {
          for (const listener of [...outgoing]) {
            try { listener(message); } catch { }
          }
        });
      },
      disconnect() {
        if (disconnected) return;
        disconnected = true;
        for (const listener of [...disconnectIncoming, ...disconnectOutgoing]) {
          try { listener(); } catch { }
        }
      },
    });
    const client = makePort(clientMessage, serverMessage, clientDisconnect, serverDisconnect, false);
    const server = makePort(serverMessage, clientMessage, serverDisconnect, clientDisconnect, true);
    queueMicrotask(() => {
      for (const listener of [...connectListeners]) {
        try { listener(server); } catch { }
      }
    });
    return client;
  }

  function nativePort(name) {
    const messageListeners = [];
    const disconnectListeners = [];
    const port = {
      name,
      onMessage: eventFor(messageListeners),
      onDisconnect: eventFor(disconnectListeners),
      postMessage(message) { postNative({ kind: "nativePort", name, message }); },
      disconnect() {
        for (const listener of [...disconnectListeners]) {
          try { listener(); } catch { }
        }
      },
    };
    globalThis.__FOLLOWCHECK_IOS_NATIVE_RECEIVE__ = (message) => {
      for (const listener of [...messageListeners]) {
        try { listener(message); } catch { }
      }
    };
    return port;
  }

  const runtimeOnMessage = {
    addListener(listener) {
      const list = globalThis.__fcBridgeContext === "background"
        ? backgroundMessageListeners
        : contentMessageListeners;
      addUnique(list, listener);
    },
    removeListener(listener) {
      for (const list of [backgroundMessageListeners, contentMessageListeners]) {
        const index = list.indexOf(listener);
        if (index >= 0) list.splice(index, 1);
      }
    },
    hasListener(listener) {
      return backgroundMessageListeners.includes(listener) || contentMessageListeners.includes(listener);
    },
  };

  const chrome = {
    action: {
      onClicked: eventFor([]),
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {},
      setIcon: async () => {},
      enable: async () => {},
      disable: async () => {},
    },
    notifications: {
      onClicked: eventFor(notificationClickListeners),
      async create(idOrOptions, maybeOptions) {
        const id = typeof idOrOptions === "string"
          ? idOrOptions
          : `followcheck-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const options = typeof idOrOptions === "string" ? (maybeOptions || {}) : (idOrOptions || {});
        postNative({
          kind: "notification",
          id,
          title: String(options.title || "FollowCheck"),
          message: String(options.message || "A Watchlist foi atualizada."),
        });
        return id;
      },
      async clear() { return true; },
      async getAll() { return {}; },
    },
    runtime: {
      id: "followcheck-ios@dannysantos.ch",
      lastError: null,
      onMessage: runtimeOnMessage,
      onConnect: eventFor(connectListeners),
      sendMessage(...args) {
        const callback = typeof args[args.length - 1] === "function" ? args.pop() : null;
        const message = args.length > 1 && typeof args[0] === "string" ? args[1] : args[0];
        const promise = dispatchMessage(backgroundMessageListeners, message);
        if (callback) {
          promise.then((response) => callback(response)).catch((error) => {
            chrome.runtime.lastError = { message: String(error?.message || error) };
            try { callback(undefined); } finally { chrome.runtime.lastError = null; }
          });
        }
        return promise;
      },
      connect(connectInfo = {}) {
        const name = typeof connectInfo === "string" ? connectInfo : String(connectInfo?.name || "");
        return pairedPort(name);
      },
      connectNative(name) { return nativePort(String(name || "followcheck_bridge")); },
      getManifest() { return { name: "FollowCheck", version: "10.20.8", manifest_version: 3 }; },
      getURL(path = "") { return `https://www.instagram.com/${String(path).replace(/^\/+/, "")}`; },
    },
    storage: {
      local: {
        get: storageGet,
        set: storageSet,
        remove: storageRemove,
        clear: storageClear,
        getBytesInUse: async () => -1,
      },
      onChanged: eventFor(storageChangeListeners),
    },
    tabs: {
      query: async () => [currentTab()],
      get: async () => currentTab(),
      sendMessage: async (_tab, message) => dispatchMessage(contentMessageListeners, message),
      create: async ({ url }) => {
        postNative({ kind: "openExternal", url: String(url || "") });
        return currentTab();
      },
      update: async (_tab, update = {}) => {
        if (update.url) location.href = update.url;
        return currentTab();
      },
    },
    scripting: {
      executeScript: async (request = {}) => {
        const reply = await nativeRPC({kind:"scripts.execute",details:{files:request.files || [],world:request.world || "ISOLATED"}});
        if (!reply?.ok) throw new Error(reply?.error || "A app não confirmou a execução dos scripts.");
        return [];
      },
    },
    cookies: {
      async get(details = {}) {
        const cookies = await allCookies(details);
        return cookies.find((cookie) => cookie.name === details.name) || null;
      },
      getAll: allCookies,
      async getAllCookieStores() { return [{ id: "ios-default", tabIds: [tabId] }]; },
      async remove(details = {}) {
        throw Object.assign(new Error("A app preserva os cookies. Usa Sair no próprio Instagram."), {code:"session_preserved"});
      },
    },
    alarms: {
      onAlarm: eventFor(alarmListeners),
      async create(nameOrInfo, maybeInfo) {
        const name = typeof nameOrInfo === "string" ? nameOrInfo : "";
        const info = typeof nameOrInfo === "string" ? (maybeInfo || {}) : (nameOrInfo || {});
        const when = Number(info.when || (Date.now() + Math.max(0, Number(info.delayInMinutes || 0)) * 60000));
        if (alarms.has(name)) globalThis.clearTimeout(alarms.get(name).timer);
        const timer = globalThis.setTimeout(() => {
          const alarm = alarms.get(name);
          if (!alarm) return;
          for (const listener of [...alarmListeners]) {
            try { listener({ name, scheduledTime: alarm.when, periodInMinutes: alarm.periodInMinutes }); } catch { }
          }
          if (alarm.periodInMinutes > 0) chrome.alarms.create(name, { delayInMinutes: alarm.periodInMinutes, periodInMinutes: alarm.periodInMinutes });
          else alarms.delete(name);
        }, Math.max(0, Math.min(2147483647, when - Date.now())));
        alarms.set(name, { name, when, periodInMinutes: Number(info.periodInMinutes || 0), timer });
      },
      async clear(name) {
        const alarm = alarms.get(name);
        if (!alarm) return false;
        globalThis.clearTimeout(alarm.timer);
        alarms.delete(name);
        return true;
      },
      async clearAll() {
        for (const alarm of alarms.values()) globalThis.clearTimeout(alarm.timer);
        const hadAny = alarms.size > 0;
        alarms.clear();
        return hadAny;
      },
      async get(name) {
        const alarm = alarms.get(name);
        return alarm ? { name, scheduledTime: alarm.when, periodInMinutes: alarm.periodInMinutes } : undefined;
      },
      async getAll() {
        return [...alarms.values()].map((alarm) => ({ name: alarm.name, scheduledTime: alarm.when, periodInMinutes: alarm.periodInMinutes }));
      },
    },
  };

  globalThis.chrome = chrome;
  globalThis.browser = chrome;
  postNative({ kind: "bridgeReady", version: "10.20.8" });
})();
