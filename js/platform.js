/**
 * Platform bridge for the Pikabu Games build (games.pikabu.ru).
 *
 * The PWA build never sets `window.__PIKABU__`, so every method here is a
 * no-op there and the game keeps working exactly as before.
 *
 * Contract with the SDK (https://games.pikabu.ru/sdk/docs):
 *   PkbSDK.init()              -> sdk
 *   sdk.gameStarted()          -> tells the platform the game is interactive
 *   sdk.ads.rewarded           -> { isSupported, canShow(), show() }
 *   sdk.storage                -> get/set (sync) + flush()
 *
 * Everything is defensive: if the SDK does not load (offline, ad blocker,
 * plain GitHub Pages preview outside the platform), the game runs without
 * ads and without cloud saves instead of failing.
 */

const SCRIPT_TIMEOUT = 3000;
const CALL_TIMEOUT = 4000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = (promise, ms, fallback) =>
  Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    wait(ms).then(() => fallback),
  ]);

export class Platform {
  constructor() {
    this.enabled = typeof window !== 'undefined' && window.__PIKABU__ === true;
    this.sdk = null;
    this.ready = false;
    this.cloudKey = 'save';
    this.lastError = null;
  }

  /** Resolves when the SDK is usable, or when it is clear it never will be. */
  async init() {
    if (!this.enabled) return this;
    try {
      const sdkGlobal = await this.waitForSdkGlobal(SCRIPT_TIMEOUT);
      if (!sdkGlobal) {
        this.lastError = 'sdk-script-missing';
        console.warn('[pikabu] SDK script not loaded — running without platform features.');
        return this;
      }
      this.sdk = await withTimeout(sdkGlobal.init(), CALL_TIMEOUT, null);
      if (!this.sdk) {
        this.lastError = 'sdk-init-timeout';
        console.warn('[pikabu] PkbSDK.init() did not complete.');
        return this;
      }
      this.ready = true;
      this.onStorageError();
    } catch (error) {
      this.lastError = String(error && error.message ? error.message : error);
      console.warn('[pikabu] SDK init failed:', error);
    }
    return this;
  }

  async waitForSdkGlobal(timeout) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (window.PkbSDK && typeof window.PkbSDK.init === 'function') return window.PkbSDK;
      await wait(50);
    }
    return null;
  }

  onStorageError() {
    try {
      this.sdk.on?.('storageSaveError', (reason) => {
        console.warn('[pikabu] cloud save error:', reason);
        if (reason === 'REVISION_CONFLICT' && typeof this.onConflict === 'function') {
          this.onConflict();
        }
      });
    } catch (error) {
      /* events are optional */
    }
  }

  /* ------------------------------------------------------------------ game */

  /** Signal the platform that the first screen is interactive. */
  markStarted() {
    if (!this.ready) return;
    try {
      this.sdk.gameStarted();
    } catch (error) {
      console.warn('[pikabu] gameStarted() failed:', error);
    }
  }

  /* ------------------------------------------------------------------- ads */

  get rewarded() {
    return this.ready ? this.sdk?.ads?.rewarded || null : null;
  }

  get rewardedSupported() {
    return Boolean(this.rewarded && this.rewarded.isSupported);
  }

  /** True when the format can be shown right now (may change between calls). */
  async canShowRewarded() {
    const ad = this.rewarded;
    if (!ad || !ad.isSupported) return false;
    const allowed = await withTimeout(ad.canShow(), CALL_TIMEOUT, false);
    return allowed === true;
  }

  /**
   * Shows the rewarded ad. Returns { reward, rendered, reason }.
   * Never throws: the caller keeps the game playable in every case.
   */
  async showRewarded() {
    const ad = this.rewarded;
    if (!ad || !ad.isSupported) return { reward: false, rendered: false, reason: 'NOT_SUPPORTED' };
    try {
      const result = await withTimeout(ad.show(), 120000, { rendered: false, reason: 'TIMEOUT' });
      return {
        reward: result?.reward === true,
        rendered: result?.rendered === true,
        reason: result?.reason || null,
      };
    } catch (error) {
      console.warn('[pikabu] rewarded show() failed:', error);
      return { reward: false, rendered: false, reason: 'EXCEPTION' };
    }
  }

  /* --------------------------------------------------------------- cloud */

  readSave() {
    if (!this.ready) return null;
    try {
      const value = this.sdk.storage.get(this.cloudKey);
      return value && typeof value === 'object' ? value : null;
    } catch (error) {
      console.warn('[pikabu] cloud read failed:', error);
      return null;
    }
  }

  writeSave(state) {
    if (!this.ready) return false;
    try {
      this.sdk.storage.set(this.cloudKey, state);
      return true;
    } catch (error) {
      console.warn('[pikabu] cloud write failed:', error);
      return false;
    }
  }

  async flush() {
    if (!this.ready) return false;
    try {
      const result = await withTimeout(this.sdk.storage.flush(), CALL_TIMEOUT, { success: false });
      return result?.success === true;
    } catch (error) {
      return false;
    }
  }
}

export const platform = new Platform();
