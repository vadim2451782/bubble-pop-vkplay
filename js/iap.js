/**
 * In-app purchases for the store builds.
 *
 * Talks to the Android plugin `NativeIAP` (RuStore Pay SDK in the RuStore
 * build, Google Play Billing in the Play build):
 *
 *   getProducts({ ids })  -> { products: [{ productId, price, title }] }
 *   purchase({ productId }) -> { status: 'success' | 'cancelled' | 'error',
 *                                purchaseId, productId, error }
 *   restore()             -> { purchases: [{ productId, purchaseId }] }
 *
 * In a plain browser there is no bridge: the shop hides purchase controls and
 * the game stays fully playable.
 */

import { COIN_PACKS, REMOVE_ADS_PRODUCT } from './config.js';

export class Iap {
  constructor() {
    this.mode = window.__STORE__ ? 'native' : 'none';
    this.ready = false;
    this.busy = false;
    this.prices = new Map();
    this.onRestore = null;
  }

  get enabled() {
    return this.mode === 'native';
  }

  get bridge() {
    return window.Capacitor?.Plugins?.NativeIAP || null;
  }

  get productIds() {
    return [...COIN_PACKS.map((pack) => pack.id), REMOVE_ADS_PRODUCT.id];
  }

  async init() {
    if (!this.enabled) return this;
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
    if (!this.ready) return this.prices;
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
    if (!this.ready || this.busy) return { ok: false, reason: 'NOT_READY' };
    this.busy = true;
    try {
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

  /** Non-consumables bought earlier (for "restore purchases"). */
  async restore() {
    if (!this.ready) return [];
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
