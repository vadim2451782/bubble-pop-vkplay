/**
 * Ads facade for both builds.
 *
 *   • Pikabu build  — delegates to the platform SDK (js/platform.js);
 *   • Google Play build — talks to the native Android plugin `NativeAds`
 *     (AdMob / Yandex Mobile Ads live behind it), or to the community
 *     `AdMob` plugin when it is installed;
 *   • plain browser — reports "nothing available", the UI hides ad buttons.
 *
 * The game only ever sees this interface, so a broken or missing ad bridge
 * never breaks gameplay.
 */

import { platform } from './platform.js';

const INTERSTITIAL_MIN_GAP = 120000; // platform-friendly rate limit
const INTERSTITIAL_EVERY_LEVELS = 2;

export class Ads {
  constructor() {
    this.mode = platform.enabled ? 'pikabu' : (window.__STORE__ ? 'native' : 'none');
    this.interstitialShownAt = 0;
    this.levelsSinceInterstitial = 0;
    this.ready = false;
    this.removeAds = false;
    this.bannerVisible = false;
  }

  get enabled() {
    return this.mode !== 'none';
  }

  get native() {
    return window.Capacitor?.Plugins?.NativeAds || null;
  }

  get admob() {
    return window.Capacitor?.Plugins?.AdMob || null;
  }

  async init() {
    if (this.mode !== 'native') {
      this.ready = this.mode === 'pikabu' ? platform.ready : false;
      return this;
    }
    const bridge = this.native || this.admob;
    if (!bridge) {
      console.warn('[ads] native ad bridge is not installed — ads stay hidden.');
      return this;
    }
    try {
      if (this.native?.initialize) await this.native.initialize({});
      else if (this.admob?.initialize) await this.admob.initialize({});
      this.ready = true;
    } catch (error) {
      console.warn('[ads] init failed:', error);
    }
    return this;
  }

  /* --------------------------------------------------------------- banner */

  /** "Remove ads" purchased: no banner, no interstitials, rewarded stays. */
  setRemoveAds(value) {
    this.removeAds = Boolean(value);
    if (this.removeAds) this.hideBanner();
  }

  get bannerSupported() {
    return this.mode === 'native' && Boolean(this.native?.showBanner || this.admob);
  }

  /**
   * Shows the adaptive banner inside the reserved slot. `rect` is the slot's
   * bounding box in CSS pixels; the native side converts it to dp.
   */
  /** Height (dp ≈ CSS px) the native banner needs for this width. */
  async bannerHeight(width) {
    if (!this.native?.getBannerHeight) return 0;
    try {
      const result = await this.native.getBannerHeight({ width: Math.round(width || 0) });
      return Number(result?.height) || 0;
    } catch (error) {
      console.warn('[ads] banner height failed:', error);
      return 0;
    }
  }

  async showBanner(rect) {
    if (!this.bannerSupported || this.removeAds) return false;
    if (this.bannerVisible) return true;
    try {
      if (this.native?.showBanner) {
        const result = await this.native.showBanner({
          x: Math.round(rect?.x || 0),
          y: Math.round(rect?.y || 0),
          width: Math.round(rect?.width || 0),
          height: Math.round(rect?.height || 0),
          density: window.devicePixelRatio || 1,
        });
        this.bannerVisible = result?.shown !== false;
      } else {
        this.bannerVisible = false;
      }
    } catch (error) {
      console.warn('[ads] banner failed:', error);
      this.bannerVisible = false;
    }
    return this.bannerVisible;
  }

  async hideBanner() {
    if (!this.bannerVisible && !this.native?.hideBanner) {
      this.bannerVisible = false;
      return;
    }
    this.bannerVisible = false;
    try {
      await this.native?.hideBanner?.();
    } catch (error) {
      console.warn('[ads] hideBanner failed:', error);
    }
  }

  /* ------------------------------------------------------------ rewarded */

  get rewardedSupported() {
    if (this.mode === 'pikabu') return platform.rewardedSupported;
    if (this.mode === 'native') return Boolean(this.native || this.admob);
    return false;
  }

  async canShowRewarded() {
    if (this.mode === 'pikabu') return platform.canShowRewarded();
    if (this.mode !== 'native') return false;
    try {
      if (this.native?.isRewardedReady) {
        const state = await this.native.isRewardedReady();
        return state?.ready === true;
      }
      if (this.admob) return true;
    } catch (error) {
      console.warn('[ads] rewarded availability check failed:', error);
    }
    return false;
  }

  /** Resolves { reward, rendered, reason } and never throws. */
  async showRewarded() {
    if (this.mode === 'pikabu') return platform.showRewarded();
    if (this.mode !== 'native') return { reward: false, rendered: false, reason: 'NOT_CONFIGURED' };
    try {
      if (this.native?.showRewarded) {
        const result = await this.native.showRewarded();
        return {
          reward: result?.reward === true,
          rendered: result?.rendered !== false,
          reason: result?.reason || null,
        };
      }
      if (this.admob) {
        await this.admob.prepareRewardVideoAd({});
        const result = await this.admob.showRewardVideoAd();
        return { reward: result?.reward === true || true, rendered: true, reason: null };
      }
    } catch (error) {
      console.warn('[ads] rewarded show failed:', error);
      return { reward: false, rendered: false, reason: 'EXCEPTION' };
    }
    return { reward: false, rendered: false, reason: 'NOT_CONFIGURED' };
  }

  /* -------------------------------------------------------- interstitial */

  /** Only between levels, at most once per two levels and 120 s. */
  async maybeInterstitial() {
    if (this.mode !== 'native' || !this.ready || this.removeAds) return false;
    this.levelsSinceInterstitial += 1;
    if (this.levelsSinceInterstitial < INTERSTITIAL_EVERY_LEVELS) return false;
    if (Date.now() - this.interstitialShownAt < INTERSTITIAL_MIN_GAP) return false;
    const bridge = this.native || this.admob;
    if (!bridge) return false;
    try {
      if (this.native?.showInterstitial) await this.native.showInterstitial();
      else if (this.admob) {
        await this.admob.prepareInterstitial({});
        await this.admob.showInterstitial();
      }
      this.interstitialShownAt = Date.now();
      this.levelsSinceInterstitial = 0;
      return true;
    } catch (error) {
      console.warn('[ads] interstitial failed:', error);
      return false;
    }
  }
}

export const ads = new Ads();
