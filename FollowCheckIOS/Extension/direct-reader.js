// FollowCheck direct reader. Runs inside a hidden page of the user's own Instagram
// session (/direct/...). It never calls an Instagram API: it only reads what the
// page itself renders and, when asked, types into the page's own composer.
// The native app polls snapshot() and renders conversations with its own UI.
(function () {
  "use strict";
  if (globalThis.__FC_DIRECT__) return;

  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const lines = (element) => String(element?.innerText || "").split("\n").map(clean).filter(Boolean);
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const threadIdFrom = (href) => {
    const match = String(href || "").match(/\/direct\/t\/([A-Za-z0-9_-]{1,64})/);
    return match ? match[1] : "";
  };
  const httpsImage = (element) => {
    const image = element?.querySelector?.("img");
    const source = image?.currentSrc || image?.src || "";
    return source.startsWith("https://") ? source : "";
  };
  const timeLike = /^(?:·\s*)?(?:\d{1,3}\s?(?:s|min|m|h|d|sem|w|a|y)|agora|now|ontem|yesterday|\d{1,2}:\d{2})$/i;
  const unreadLabel = /unread|não lid|nao lid|nueva|non lu/i;

  // Instagram sometimes covers the page with a notifications prompt.
  function dismissPrompts() {
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      const button = [...dialog.querySelectorAll('button, [role="button"]')]
        .find((candidate) => /^(agora não|not now|ahora no|pas maintenant)$/i.test(clean(candidate.innerText)));
      if (button) button.click();
    }
  }

  function rowFrom(element, id, index) {
    const text = lines(element);
    if (!text.length) return null;
    let name = text[0];
    let snippet = "";
    let time = "";
    for (const line of text.slice(1)) {
      const parts = line.split("·").map(clean).filter(Boolean);
      if (parts.length > 1 && timeLike.test(parts[parts.length - 1])) {
        time = parts.pop();
        snippet ||= parts.join(" · ");
      } else if (timeLike.test(line)) {
        time ||= line.replace(/^·\s*/, "");
      } else if (!snippet && line !== name) {
        snippet = line;
      }
    }
    const unread = !!element.querySelector('[aria-label]') &&
      [...element.querySelectorAll("[aria-label]")].some((node) => unreadLabel.test(node.getAttribute("aria-label") || ""));
    const weight = Number(getComputedStyle(element.querySelector("span, div") || element).fontWeight) || 400;
    return { id, index, name, snippet, time, unread: unread || weight >= 600, photoURL: httpsImage(element) };
  }

  // Conversation list: links to /direct/t/<id>/ when the page renders them,
  // otherwise the clickable rows of the list, addressed by their position.
  function threads() {
    const out = [];
    const seen = new Set();
    for (const link of document.querySelectorAll('a[href*="/direct/t/"]')) {
      const id = threadIdFrom(link.getAttribute("href"));
      if (!id || seen.has(id) || !visible(link)) continue;
      seen.add(id);
      const row = rowFrom(link, id, out.length);
      if (row) out.push({ ...row, strategy: "link" });
    }
    if (out.length) return out;
    const candidates = [...document.querySelectorAll('[role="listitem"], [role="button"], [role="link"]')]
      .filter((element) => visible(element) && element.querySelector("img") && lines(element).length >= 2 && lines(element).length <= 6)
      .filter((element) => !element.closest("nav") && !element.closest('[role="dialog"]'));
    // Keep the outermost row only.
    const rows = candidates.filter((element) => !candidates.some((other) => other !== element && other.contains(element)));
    rows.forEach((element, index) => {
      const row = rowFrom(element, "row:" + index, index);
      if (row) out.push({ ...row, strategy: "row" });
    });
    return out;
  }

  function composer() {
    return document.querySelector('div[contenteditable="true"][role="textbox"]') ||
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector("textarea");
  }

  function conversationRoot() {
    const box = composer();
    const main = document.querySelector("main") || document.body;
    if (!box) return main;
    // The scrollable area above the composer holds the messages.
    let node = box.parentElement;
    while (node && node !== document.body) {
      const scrollers = [...node.querySelectorAll("div")].filter((div) => div.scrollHeight > div.clientHeight + 40 && visible(div) && !div.contains(box));
      if (scrollers.length) return scrollers.sort((a, b) => b.clientHeight - a.clientHeight)[0];
      node = node.parentElement;
    }
    return main;
  }

  function title() {
    const header = document.querySelector('main header, [role="main"] header, header');
    if (!header) return "";
    const leaves = [...header.querySelectorAll("h1, h2, span, a, div")]
      .filter((element) => !element.children.length && clean(element.textContent))
      .map((element) => clean(element.textContent));
    return leaves.find((line) => line.length > 1 && !/^(voltar|back|informações|info|chamada|call|chamada de vídeo|video call|ativo.*|active.*)$/i.test(line)) || "";
  }

  // Messages: the text blocks of the conversation area. The side of each bubble
  // (right = sent by you) comes from where the page draws it.
  function messages() {
    const root = conversationRoot();
    const rootRect = root.getBoundingClientRect();
    const middle = rootRect.left + rootRect.width / 2;
    const out = [];
    const blocks = [...root.querySelectorAll('div[dir="auto"], span[dir="auto"]')]
      .filter((element) => visible(element) && clean(element.innerText) && !element.closest("header") &&
        !element.closest('[contenteditable="true"]') && !element.closest('[role="button"][aria-haspopup]'))
      .filter((element, _, all) => !all.some((other) => other !== element && other.contains(element)));
    for (const element of blocks) {
      const text = clean(element.innerText);
      if (timeLike.test(text) || text.length > 4000) continue;
      const rect = element.getBoundingClientRect();
      const outgoing = rect.left + rect.width / 2 > middle && rect.left > rootRect.left + rootRect.width * 0.2;
      const previous = out[out.length - 1];
      if (previous && previous.text === text && previous.outgoing === outgoing) continue;
      out.push({ id: "m" + out.length + ":" + text.length, text, outgoing, top: Math.round(rect.top) });
    }
    for (const image of root.querySelectorAll("img")) {
      const rect = image.getBoundingClientRect();
      const source = image.currentSrc || image.src || "";
      if (rect.width < 80 || rect.height < 80 || !source.startsWith("https://")) continue;
      out.push({ id: "i" + out.length, text: "", photoURL: source, outgoing: rect.left + rect.width / 2 > middle, top: Math.round(rect.top) });
    }
    return out.sort((a, b) => a.top - b.top).map(({ top, ...rest }) => rest);
  }

  function shape() {
    return {
      links: document.querySelectorAll('a[href*="/direct/t/"]').length,
      listItems: document.querySelectorAll('[role="listitem"]').length,
      buttons: document.querySelectorAll('[role="button"]').length,
      rows: document.querySelectorAll('[role="row"]').length,
      textBlocks: document.querySelectorAll('[dir="auto"]').length,
      dialogs: document.querySelectorAll('[role="dialog"]').length,
      composer: !!composer(),
    };
  }

  function page() {
    const path = location.pathname;
    if (/^\/accounts\/login|^\/challenge|^\/checkpoint/.test(path)) return "login";
    if (/^\/direct\/t\//.test(path)) return "thread";
    if (/^\/direct\//.test(path)) return "inbox";
    return "other";
  }

  globalThis.__FC_DIRECT__ = {
    snapshot() {
      dismissPrompts();
      const kind = page();
      const result = { page: kind, path: location.pathname, ready: document.readyState !== "loading", shape: shape() };
      if (kind === "inbox") result.threads = threads();
      if (kind === "thread") {
        result.threadId = threadIdFrom(location.pathname);
        result.title = title();
        result.messages = messages();
        result.canSend = !!composer();
      }
      return result;
    },
    open(id, index) {
      if (!String(id).startsWith("row:")) {
        const link = [...document.querySelectorAll('a[href*="/direct/t/"]')].find((a) => threadIdFrom(a.getAttribute("href")) === id);
        if (link) { link.click(); return true; }
        location.assign("/direct/t/" + encodeURIComponent(id) + "/");
        return true;
      }
      const row = threads()[Number(index)];
      if (!row) return false;
      const candidates = [...document.querySelectorAll('[role="listitem"], [role="button"], [role="link"]')]
        .filter((element) => visible(element) && element.querySelector("img") && lines(element).length >= 2 && lines(element).length <= 6)
        .filter((element) => !element.closest("nav") && !element.closest('[role="dialog"]'));
      const rows = candidates.filter((element) => !candidates.some((other) => other !== element && other.contains(element)));
      const target = rows[Number(index)];
      if (!target) return false;
      target.click();
      return true;
    },
    scrollUp() {
      const root = conversationRoot();
      root.scrollTop = Math.max(0, root.scrollTop - root.clientHeight * 0.8);
      return true;
    },
    send(text) {
      const value = String(text || "").slice(0, 2000);
      const box = composer();
      if (!value.trim() || !box) return { ok: false, code: box ? "empty" : "composer_missing" };
      box.focus();
      if (box.tagName === "TEXTAREA") {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        setter.call(box, value);
        box.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        document.execCommand("selectAll", false);
        document.execCommand("insertText", false, value);
      }
      setTimeout(() => {
        const send = [...document.querySelectorAll('div[role="button"], button')]
          .find((button) => /^(enviar|send|enviar mensagem)$/i.test(clean(button.innerText) || clean(button.getAttribute("aria-label"))));
        if (send) send.click();
        else box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      }, 120);
      return { ok: true };
    },
  };
})();
