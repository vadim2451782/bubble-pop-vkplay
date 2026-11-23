/**
 * Local persistence: coins, boosters, unlocked levels, stars and settings.
 * Works in Safari private mode (localStorage may throw) without crashing.
 */
import {
  START_COINS,
  START_BOOSTERS,
  BOOSTER_ORDER,
  STORAGE_KEY,
  SAVE_VERSION,
  CATALOG_VERSION,
  MAX_LEVEL,
} from './config.js';
import { LEVELS } from './levels.js';

export function createDefaultState() {
  return {
    version: SAVE_VERSION,
    catalogVersion: CATALOG_VERSION,
    coins: START_COINS,
    boosters: { ...START_BOOSTERS },
    unlocked: 1,
    currentLevel: 1,
    levels: {},
    settings: { sound: true, music: true, hintDismissed: false },
    /** Non-consumable purchases: removeAds disables banner and interstitials. */
    entitlements: { removeAds: false },
    /** Processed purchase ids, so a repeated callback never pays twice. */
    purchases: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

const int = (value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

export class Store {
  /**
   * @param backend  localStorage-compatible object (defaults to localStorage)
   * @param key      local storage key
   * @param cloud    optional platform save slot: { save(state) }
   */
  constructor(backend = null, key = STORAGE_KEY, cloud = null) {
    this.key = key;
    this.backend =
      backend || (typeof localStorage !== 'undefined' ? localStorage : null);
    this.cloud = cloud;
    this.state = this.load();
  }

  /**
   * Merges the platform (cloud) save into the local one once, at boot.
   * The newest save wins, so a player who played on another device keeps
   * progress instead of silently overwriting it with an older local copy.
   * Returns true when the cloud state replaced the local one.
   */
  hydrate(remote) {
    if (!remote || typeof remote !== 'object') {
      this.save();
      return false;
    }
    let next = null;
    try {
      next = this.sanitize(remote);
    } catch (error) {
      console.warn('BubblePop: cloud save is not readable.', error);
      return false;
    }
    const remoteTime = Number(next.updatedAt) || 0;
    const localTime = Number(this.state.updatedAt) || 0;
    if (remoteTime > localTime) {
      this.state = next;
      this.save();
      return true;
    }
    this.save();
    return false;
  }

  load() {
    if (!this.backend) return createDefaultState();
    try {
      const raw = this.backend.getItem(this.key);
      if (!raw) return createDefaultState();
      const parsed = JSON.parse(raw);
      return this.sanitize(parsed);
    } catch (error) {
      console.warn('BubblePop: could not read save, starting fresh.', error);
      return createDefaultState();
    }
  }

  sanitize(parsed) {
    const base = createDefaultState();
    if (!parsed || typeof parsed !== 'object') return base;
    const state = base;

    state.coins = int(parsed.coins, START_COINS, 0);
    state.unlocked = int(parsed.unlocked, 1, 1, MAX_LEVEL);
    state.currentLevel = int(parsed.currentLevel, state.unlocked, 1, MAX_LEVEL);
    state.createdAt = int(parsed.createdAt, Date.now(), 0);
    state.updatedAt = int(parsed.updatedAt, Date.now(), 0);

    for (const id of BOOSTER_ORDER) {
      state.boosters[id] = int(parsed.boosters?.[id], START_BOOSTERS[id], 0, 999);
    }

    if (parsed.settings && typeof parsed.settings === 'object') {
      state.settings.sound = parsed.settings.sound !== false;
      state.settings.music = parsed.settings.music !== false;
      state.settings.hintDismissed = parsed.settings.hintDismissed === true;
    }

    state.entitlements.removeAds = parsed.entitlements?.removeAds === true;
    state.purchases = Array.isArray(parsed.purchases)
      ? parsed.purchases.filter((id) => typeof id === 'string').slice(-200)
      : [];

    if (parsed.levels && typeof parsed.levels === 'object') {
      const sourceToNew = new Map(LEVELS.map((level) => [level.seedId, level.id]));
      const shouldRemap = int(parsed.catalogVersion, 0, 0, 999) !== CATALOG_VERSION;
      for (let oldId = 1; oldId <= MAX_LEVEL; oldId += 1) {
        const rec = parsed.levels[oldId];
        if (!rec || typeof rec !== 'object') continue;
        const id = shouldRemap ? sourceToNew.get(oldId) : oldId;
        if (!id) continue;
        state.levels[id] = {
          stars: int(rec.stars, 0, 0, 3),
          score: int(rec.score, 0, 0),
        };
      }

      // The catalogue was reordered (or is from the 24-level build). Map the
      // old unlocked/current ids through the stable pattern seed instead of
      // letting stars land on unrelated levels.
      if (shouldRemap) {
        const oldUnlocked = int(parsed.unlocked, 1, 1, MAX_LEVEL);
        let unlocked = 1;
        for (const [sourceId, id] of sourceToNew.entries()) {
          if (sourceId <= oldUnlocked) unlocked = Math.max(unlocked, id);
        }
        state.unlocked = Math.min(MAX_LEVEL, Math.max(1, unlocked));
        const oldCurrent = int(parsed.currentLevel, oldUnlocked, 1, MAX_LEVEL);
        state.currentLevel = sourceToNew.get(oldCurrent) || state.unlocked;
      }
    }
    return state;
  }

  save() {
    this.state.updatedAt = Date.now();
    if (this.cloud) {
      try {
        this.cloud.save(this.state);
      } catch (error) {
        console.warn('BubblePop: could not write cloud save.', error);
      }
    }
    if (!this.backend) return false;
    try {
      this.backend.setItem(this.key, JSON.stringify(this.state));
      return true;
    } catch (error) {
      console.warn('BubblePop: could not write save.', error);
      return false;
    }
  }

  get coins() {
    return this.state.coins;
  }

  get unlocked() {
    return this.state.unlocked;
  }

  get settings() {
    return this.state.settings;
  }

  getLevelRecord(id) {
    return this.state.levels[id] || { stars: 0, score: 0 };
  }

  addCoins(amount) {
    this.state.coins = int(this.state.coins + amount, this.state.coins, 0);
    this.save();
    return this.state.coins;
  }

  spendCoins(amount) {
    if (!Number.isFinite(amount) || amount < 0) return false;
    if (this.state.coins < amount) return false;
    this.state.coins -= amount;
    this.save();
    return true;
  }

  boosterCount(id) {
    return this.state.boosters[id] || 0;
  }

  addBooster(id, amount = 1) {
    if (!BOOSTER_ORDER.includes(id)) return false;
    this.state.boosters[id] = int((this.state.boosters[id] || 0) + amount, 0, 0, 999);
    this.save();
    return true;
  }

  consumeBooster(id) {
    if (!BOOSTER_ORDER.includes(id)) return false;
    if ((this.state.boosters[id] || 0) <= 0) return false;
    this.state.boosters[id] -= 1;
    this.save();
    return true;
  }

  buyBooster(id, price) {
    if (!BOOSTER_ORDER.includes(id)) return { ok: false, reason: 'unknown' };
    if (this.state.coins < price) return { ok: false, reason: 'coins' };
    this.state.coins -= price;
    this.state.boosters[id] = (this.state.boosters[id] || 0) + 1;
    this.save();
    return { ok: true, coins: this.state.coins, count: this.state.boosters[id] };
  }

  completeLevel(id, stars, score) {
    const key = String(id);
    const previous = this.state.levels[key] || { stars: 0, score: 0 };
    this.state.levels[key] = {
      stars: Math.max(previous.stars, int(stars, 0, 0, 3)),
      score: Math.max(previous.score, int(score, 0, 0)),
    };
    if (id >= this.state.unlocked) {
      this.state.unlocked = Math.min(MAX_LEVEL, id + 1);
    }
    this.state.currentLevel = Math.max(this.state.currentLevel, this.state.unlocked);
    this.save();
    return this.state.levels[key];
  }

  setSettings(patch) {
    Object.assign(this.state.settings, patch);
    this.save();
    return this.state.settings;
  }

  /* ------------------------------------------------------------- purchases */

  get hasRemoveAds() {
    return this.state.entitlements.removeAds === true;
  }

  hasPurchase(productId) {
    if (!productId) return false;
    return this.state.purchases.includes(productId);
  }

  /**
   * Records a purchase once. Returns false for a repeated callback or a
   * purchase id that was already applied, so coins are never paid twice.
   */
  grantPurchase(productId, purchaseId = '') {
    const key = purchaseId ? `${productId}:${purchaseId}` : productId;
    if (this.state.purchases.includes(key)) return false;
    if (productId === 'remove_ads' && this.hasRemoveAds) return false;
    this.state.purchases.push(key);
    if (this.state.purchases.length > 200) this.state.purchases.splice(0, this.state.purchases.length - 200);
    if (productId === 'remove_ads') this.state.entitlements.removeAds = true;
    this.save();
    return true;
  }

  resetProgress() {
    const settings = { ...this.state.settings };
    this.state = createDefaultState();
    this.state.settings = settings;
    this.state.currentLevel = 1;
    this.save();
    return this.state;
  }
}

/** Simple in-memory localStorage replacement for tests and private modes. */
export function createMemoryBackend(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    clear: () => data.clear(),
    get length() {
      return data.size;
    },
    key: (index) => [...data.keys()][index] ?? null,
  };
}
