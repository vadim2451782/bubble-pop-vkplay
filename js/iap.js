/**
 * In-app purchases for the store builds.
 *
 * Two backends are supported:
 *   - `native`: the Android plugin `NativeIAP` (Google Play Billing in the Play
 *     build). RuStore uses the web backend below so the seller can be a
 *     self-employed person, not the store's billing.
 *   - `web`: our own YooKassa backend, injected by the store build as
 *     `window.__PAY_API__`.
 *
 *   getProducts({ ids })  -> { products: [{ productId, price, title }] }
 *   purchase({ productId }) -> { status: 'success' | 'cancelled' | 'error',
 *                                purchaseId, productId, error }
 *   restore()             -> { purchases: [{ productId, purchaseId }] }
 *
 * In a plain browser there is no bridge and no backend: the shop hides purchase
 * controls and the game stays fully playable.
 */

import { COIN_PACKS, REMOVE_ADS_PRODUCT } from './config.js';

const PAY_API = (window.__PAY_API__ || '').replace(/\/+$/, '');
const POLL_INTERVAL = 2000;
const DEVICE_KEY = 'bubblepop:device';

/** Stable per-install id so the server can hand purchases back to this device. */
function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = window.crypto?.randomUUID ? window.crypto.randomUUID() : dev--;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}
const POLL_TIMEOUT = 5 * 60 * 1000;
const BUSY_TIMEOUT = 45 * 1000;

export class Iap {
  constructor() {
    this.mode = PAY_API ? 'web' : window.__STORE__ ? 'native' : 'none';
    this.ready = false;
    this.busy = false;
    this.busySince = 0;
    this.prices = new Map();
    this.onRestore = null;
  }

  get enabled() {
    return this.mode === 'web' || this.mode === 'native';
  }

  get bridge() {
    return window.Capacitor?.Plugins?.NativeIAP || null;
  }

  get productIds() {
    return [...COIN_PACKS.map((pack) => pack.id), REMOVE_ADS_PRODUCT.id];
  }

  async init() {
    if (!this.enabled) return this;
    if (this.mode === 'web') {
      try {
        const response = await fetch(`${PAY_API}/api/health`, { cache: 'no-store' });
        const data = await response.json();
        this.ready = data?.ok === true && data?.configured === true;
        if (!this.ready) console.warn('[iap] payment backend is not configured yet');
      } catch (error) {
        console.warn('[iap] payment backend unreachable:', error);
      }
      return this;
    }
    const bridge = this.bridge;
    if (!bridge) {
      console.warn('[iap] NativeIAP plugin is not installed — purchases stay hidden.');
      return this;
    }
    try {
      if (bridge.initialize) await bridge.initialize({});
      this.ready = true;
      await this.loadPrices();
    } catch (error) {
      console.warn('[iap] init failed:', error);
    }
    return this;
  }

  /** Real store prices for the shop; falls back to the constants on error. */
  async loadPrices() {
    if (!this.ready || this.mode === 'web') return this.prices;
    try {
      const result = await this.bridge.getProducts({ ids: this.productIds });
      for (const product of result?.products || []) {
        if (product?.productId && product.price) this.prices.set(product.productId, product.price);
      }
    } catch (error) {
      console.warn('[iap] getProducts failed:', error);
    }
    return this.prices;
  }

  priceOf(productId, fallback) {
    return this.prices.get(productId) || fallback;
  }

  /** Returns { ok, productId, purchaseId, reason } and never throws. */
  async buy(productId) {
    if (!this.ready) return { ok: false, reason: 'NOT_READY' };
    // A pending payment must not lock the shop forever: after two minutes the
    // previous attempt is considered abandoned and a new one may start.
    if (this.busy) {
      if (Date.now() - this.busySince < BUSY_TIMEOUT) return { ok: false, reason: 'BUSY' };
      console.warn('[iap] previous payment attempt timed out, unlocking shop');
      this.busy = false;
    }
    this.busy = true;
    this.busySince = Date.now();
    try {
      if (this.mode === 'web') return await this.buyOnWeb(productId);
      const result = await this.bridge.purchase({ productId });
      const status = result?.status || (result?.purchaseId ? 'success' : 'error');
      if (status !== 'success') {
        return { ok: false, productId, reason: status === 'cancelled' ? 'CANCELLED' : 'ERROR', error: result?.error };
      }
      return { ok: true, productId, purchaseId: result?.purchaseId || '' };
    } catch (error) {
      console.warn('[iap] purchase failed:', error);
      return { ok: false, productId, reason: 'EXCEPTION' };
    } finally {
      this.busy = false;
    }
  }

  async buyOnWeb(productId) {
    let created = null;
    try {
      created = await fetch(`${PAY_API}/api/create-payment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ productId, deviceId: deviceId() }),
      }).then((response) => response.json());
    } catch (error) {
      console.warn('[iap] create-payment failed:', error);
      return { ok: false, productId, reason: 'NETWORK' };
    }
    if (!created?.ok || !created?.confirmationUrl) {
      return { ok: false, productId, reason: created?.error || 'CREATE_FAILED' };
    }
    // The native plugin opens the system browser, which bank pages require.
    // In a plain page fall back to a normal tab.
    const bridge = this.bridge;
    if (bridge?.openUrl) {
      try {
        await bridge.openUrl({ url: created.confirmationUrl });
      } catch (error) {
        console.warn('[iap] openUrl failed:', error);
        window.open(created.confirmationUrl, '_blank');
      }
    } else {
      window.open(created.confirmationUrl, '_blank');
    }
    const status = await this.waitForPayment(created.id);
    if (status === 'succeeded') return { ok: true, productId, purchaseId: created.id };
    return { ok: false, productId, reason: status === 'canceled' ? 'CANCELLED' : 'TIMEOUT' };
  }

  async waitForPayment(paymentId) {
    const startedAt = Date.now();
    // Re-check right away when the player returns from the browser.
    const wake = () => {
      if (document.visibilityState === 'visible') checkNow = true;
    };
    let checkNow = false;
    document.addEventListener('visibilitychange', wake);
    try {
      return await this.pollPayment(paymentId, startedAt, () => checkNow, () => { checkNow = false; });
    } finally {
      document.removeEventListener('visibilitychange', wake);
    }
  }

  async pollPayment(paymentId, startedAt, shouldCheckNow, clearCheckNow) {
    while (Date.now() - startedAt < POLL_TIMEOUT) {
      const wait = shouldCheckNow() ? 0 : POLL_INTERVAL;
      clearCheckNow();
      await new Promise((resolve) => setTimeout(resolve, wait));
      try {
        const response = await fetch(`${PAY_API}/api/payment-status?id=${encodeURIComponent(paymentId)}`, {
          cache: 'no-store',
        });
        const data = await response.json();
        if (data?.status === 'succeeded' || data?.status === 'canceled') return data.status;
      } catch (error) {
        console.warn('[iap] status poll failed:', error);
      }
    }
    return 'timeout';
  }

  /** Purchases the server recorded for this device but the app has not applied. */
  async claim() {
    if (this.mode !== 'web' || !this.ready) return [];
    try {
      const response = await fetch(`${PAY_API}/api/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId() }),
      });
      const data = await response.json();
      return Array.isArray(data?.purchases) ? data.purchases : [];
    } catch (error) {
      console.warn('[iap] claim failed:', error);
      return [];
    }
  }

  /** Non-consumables bought earlier (for "restore purchases"). */
  async restore() {
    if (!this.ready || this.mode === 'web') return [];
    try {
      const result = await this.bridge.restore();
      return Array.isArray(result?.purchases) ? result.purchases : [];
    } catch (error) {
      console.warn('[iap] restore failed:', error);
      return [];
    }
  }
}

export const iap = new Iap();
