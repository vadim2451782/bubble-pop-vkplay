/**
 * VK Play bridge: auth + in-game purchases for the browser build.
 *
 * Works only inside the VK Play iframe and only when a payment backend is
 * configured (window.__VKPLAY_API__). Outside the platform, or without a
 * backend, the shop stays hidden and the game plays exactly as before.
 *
 * Flow (per VK Play docs):
 *   iframeApi handshake → getLoginStatus → buy()
 *   buy → POST {API}/create-payment → payment URL → platform payment window
 *   platform → GET {API}/callback (server side) → paymentReceivedCallback
 */

import { COIN_PACKS } from './config.js';

const GMRID = '52062';
const SCRIPT_URL = `https://vkplay.ru/app/${GMRID}/static/mailru.core.js`;
const LOAD_TIMEOUT = 8000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class VkPlayBridge {
  constructor() {
    this.enabled = window.__VKPLAY__ === true;
    // QA hook: ?vkp=1 pretends the page is inside the VK Play iframe.
    this.inFrame = window.top !== window.self || new URLSearchParams(window.location.search).has('vkp');
    this.apiBase = window.__VKPLAY_API__ || '';
    this.ready = false;
    this.api = null;
    this.uid = null;
    this.loginStatus = null;
    this.pendingProduct = null;
    this.seenTids = new Set();
    this.onPaid = null;
    this.onError = null;
  }

  get available() {
    return Boolean(this.enabled && this.inFrame && this.apiBase && this.ready);
  }

  async init() {
    if (!this.enabled || !this.inFrame || !this.apiBase) return this;
    try {
      await this.loadScript();
      if (typeof window.iframeApi !== 'function') return this;
      this.api = await this.handshake();
      this.ready = Boolean(this.api);
      if (this.ready) this.askLoginStatus();
    } catch (error) {
      console.warn('[vkplay] init failed:', error);
    }
    return this;
  }

  loadScript() {
    if (window.iframeApi) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_URL;
      script.async = true;
      const timer = setTimeout(() => reject(new Error('script timeout')), LOAD_TIMEOUT);
      script.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      script.onerror = () => {
        clearTimeout(timer);
        reject(new Error('script failed'));
      };
      document.head.append(script);
    });
  }

  handshake() {
    const callbacks = {
      appid: Number(GMRID),
      getLoginStatusCallback: (status) => {
        this.loginStatus = Number(status?.loginStatus ?? -1);
      },
      userInfoCallback: (info) => {
        const uid = Number(info?.uid);
        if (Number.isFinite(uid)) this.uid = uid;
      },
      registerUserCallback: (info) => {
        const uid = Number(info?.uid);
        if (Number.isFinite(uid)) this.uid = uid;
      },
      paymentReceivedCallback: (data) => this.handlePayment(data),
      paymentWindowClosedCallback: () => {
        this.pendingProduct = null;
      },
    };
    return new Promise((resolve, reject) => {
      window.iframeApi(callbacks).then(resolve, reject);
    });
  }

  askLoginStatus() {
    try {
      this.api.getLoginStatus();
      this.api.userInfo();
    } catch (error) {
      console.warn('[vkplay] login status failed:', error);
    }
  }

  /** Opens the platform auth window; the page reloads afterwards (VK Play quirk). */
  login() {
    try {
      this.api?.authUser();
    } catch (error) {
      console.warn('[vkplay] auth failed:', error);
    }
  }

  /** Returns { ok, pending } — the item is credited on paymentReceivedCallback. */
  async buy(productId) {
    const pack = COIN_PACKS.find((item) => item.id === productId);
    if (!pack) return { ok: false, reason: 'UNKNOWN_PRODUCT' };
    if (!this.available) return { ok: false, reason: 'NOT_AVAILABLE' };
    if (!this.uid) {
      this.login();
      return { ok: false, reason: 'AUTH_REQUIRED' };
    }
    this.pendingProduct = productId;
    try {
      const response = await fetch(`${this.apiBase}/create-payment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ productId, uid: this.uid }),
      });
      const data = await response.json();
      if (!data?.url) {
        this.pendingProduct = null;
        return { ok: false, reason: data?.error || 'NO_URL' };
      }
      if (this.api?.paymentFrame) {
        this.api.paymentFrame({ merchant_param: data.merchantParam || {} });
      } else {
        window.open(data.url, '_blank', 'noopener');
      }
      return { ok: true, pending: true };
    } catch (error) {
      this.pendingProduct = null;
      console.warn('[vkplay] create-payment failed:', error);
      return { ok: false, reason: 'NETWORK' };
    }
  }

  handlePayment(data) {
    const tid = data?.tid || data?.order_id || null;
    // A purchase is credited once: right after our own create-payment, or by a
    // callback that carries a transaction id we have not seen yet.
    const productId = this.pendingProduct || (tid ? data?.merchant_param?.item_id : null) || null;
    this.pendingProduct = null;
    if (!productId) return;
    if (tid) {
      if (this.seenTids.has(tid)) return;
      this.seenTids.add(tid);
    }
    try {
      this.onPaid?.(productId, data);
    } catch (error) {
      console.warn('[vkplay] onPaid failed:', error);
    }
  }
}

export const vkplay = new VkPlayBridge();
