/* Shared, dependency-free policy. Exercised directly by the regression suite. */
(() => {
  const auth = /^\/(accounts|challenge|checkpoint|two_factor|oauth)(\/|$)/i;
  function allowedURL(value) {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && (u.hostname === 'instagram.com' || u.hostname.endsWith('.instagram.com')) && !auth.test(u.pathname);
    } catch { return false; }
  }
  function failure(code, message) { return Object.assign(new Error(message), {code}); }
  class SingleFlight {
    active = null;
    run(key, work) {
      if (this.active) {
        if (this.active.key === key) return this.active.promise;
        return Promise.reject(failure('monitor_busy', 'Já existe uma operação em curso.'));
      }
      // Reserve synchronously, before any asynchronous preflight can yield.
      const entry = {key, promise: null};
      this.active = entry;
      entry.promise = Promise.resolve().then(work).finally(() => {
        if (this.active === entry) this.active = null;
      });
      return entry.promise;
    }
  }
  function sanitizeText(value, max = 600) {
    return String(value ?? '').replace(/https?:\/\/[^\s]+/gi, '[URL]')
      .replace(/\b(?:Bearer\s+)[\w.\-~+/=:]+/gi, '[TOKEN]')
      .replace(/\b(sessionid|csrftoken|password|passwd|token|authorization|cookie)\b["']?\s*[:=]\s*["']?[^\s,;}]+/gi, '$1=[REMOVIDO]').slice(0, max);
  }
  function dueTarget(targets, now) {
    return targets.filter(t => t.enabled && !t.running && Number(t.nextRunAt) > 0 && Number(t.nextRunAt) <= now)
      .sort((a,b) => Number(a.nextRunAt) - Number(b.nextRunAt))[0] || null;
  }
  globalThis.FollowCheckPolicy = Object.freeze({allowedURL, SingleFlight, sanitizeText, dueTarget, failure});
})();
