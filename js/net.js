/**
 * Connectivity gate for the Google Play build.
 *
 * The store build keeps the game inside the app, but the ad network must be
 * reachable: without a real internet connection the game shows a blocking
 * screen instead of starting a level, so an ad slot is never silently lost.
 *
 * `navigator.onLine` alone lies on captive portals, so the gate also pings a
 * tiny endpoint. The PWA and Pikabu builds never enable it.
 */

const PING_URLS = [
  'https://www.gstatic.com/generate_204',
  'https://cloudflare.com/cdn-cgi/trace',
];
const PING_TIMEOUT = 4000;
const REPEAT_EVERY = 30000;

export class NetworkGate {
  constructor() {
    this.enabled = Boolean(window.__STORE__);
    this.online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
    this.listeners = new Set();
    this.timer = 0;
    this.checking = null;
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    for (const listener of this.listeners) {
      try {
        listener(this.online);
      } catch (error) {
        console.warn('[net] listener failed:', error);
      }
    }
  }

  setOnline(value) {
    const next = Boolean(value);
    if (next === this.online) return;
    this.online = next;
    this.emit();
  }

  /** Real request, not just navigator.onLine. Resolves to a boolean. */
  async ping() {
    if (typeof fetch !== 'function') return true;
    for (const url of PING_URLS) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = setTimeout(() => controller?.abort(), PING_TIMEOUT);
      try {
        await fetch(`${url}?t=${Date.now()}`, {
          method: 'GET',
          mode: 'no-cors',
          cache: 'no-store',
          signal: controller?.signal,
        });
        return true;
      } catch (error) {
        // Try the next endpoint: one blocked host does not mean "no internet".
      } finally {
        clearTimeout(timer);
      }
    }
    return false;
  }

  async check() {
    if (!this.enabled) return true;
    if (!navigator.onLine) {
      this.setOnline(false);
      return false;
    }
    if (this.checking) return this.checking;
    this.checking = this.ping()
      .then((ok) => {
        this.setOnline(ok);
        return ok;
      })
      .finally(() => {
        this.checking = null;
      });
    return this.checking;
  }

  start() {
    if (!this.enabled || this.timer) return this;
    window.addEventListener('online', () => this.check());
    window.addEventListener('offline', () => this.setOnline(false));
    this.timer = setInterval(() => this.check(), REPEAT_EVERY);
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = 0;
  }
}

export const net = new NetworkGate();
