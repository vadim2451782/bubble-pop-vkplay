/**
 * Global game configuration: colours, boosters, scoring, storage keys.
 * Pure data — safe to import from tests and from the service worker era.
 */

/** Columns in an even grid row. Odd rows are staggered and hold COLS - 1. */
export const COLS = 11;

/** Bubble colours. `base` is the main tone, `light` the highlight and
 *  `dark`/`deep` the shaded rim. All bubbles are drawn as glossy 3D spheres. */
export const COLORS = [
  { id: 'red', base: '#ff3d5f', light: '#ffb3c2', dark: '#c40036', deep: '#65001c', glow: '#ff6b86' },
  { id: 'blue', base: '#2f8cff', light: '#a9d8ff', dark: '#0a55c9', deep: '#062a6e', glow: '#63b0ff' },
  { id: 'green', base: '#2fd06d', light: '#a6f5c2', dark: '#0d9147', deep: '#04512a', glow: '#5cf094' },
  { id: 'yellow', base: '#ffcf3d', light: '#fff3b0', dark: '#cf9000', deep: '#6f4a00', glow: '#ffe373' },
  { id: 'purple', base: '#a95bff', light: '#e2c8ff', dark: '#6f1bc9', deep: '#39076e', glow: '#c58bff' },
  { id: 'orange', base: '#ff8434', light: '#ffc9a3', dark: '#c94b00', deep: '#6b2600', glow: '#ffa966' },
];

export const COLOR_BY_ID = Object.fromEntries(COLORS.map((c) => [c.id, c]));

export const RAINBOW = 'rainbow';

/** Boosters and their shop prices (in coins). */
export const BOOSTERS = {
  bomb: {
    id: 'bomb',
    name: 'Бомба',
    desc: 'Взрывает выбранный шарик и всех соседей вокруг него.',
    price: 90,
    color: '#ff6b5e',
  },
  lightning: {
    id: 'lightning',
    name: 'Молния',
    desc: 'Уничтожает на поле все шарики выбранного цвета.',
    price: 100,
    color: '#7dd3ff',
  },
  rainbow: {
    id: 'rainbow',
    name: 'Радужный шар',
    desc: 'Следующий выстрел подходит к шарику любого цвета.',
    price: 70,
    color: '#f0a6ff',
  },
  rocket: {
    id: 'rocket',
    name: 'Ракета',
    desc: 'Заряжается как снаряд: при попадании сжигает весь вертикальный столбец.',
    price: 80,
    color: '#ffa94d',
  },
};

export const BOOSTER_ORDER = ['bomb', 'lightning', 'rainbow', 'rocket'];

/** Scoring rules. Coins are much rarer than bubbles: 1 per 4 popped/fallen,
 *  and the level-completion bonus is also reduced fourfold. */
export const SCORE = {
  bubble: 10,
  clusterBonus: 10,
  falling: 15,
  boosterBubble: 5,
  winBase: 10,
  winPerStar: 5,
};

/** How many bubbles must be cleared to earn one coin. */
export const BUBBLES_PER_COIN = 4;

/**
 * Level payouts. What the level earned while it was played (one coin per four
 * bubbles plus the win bonus) is divided before it reaches the wallet:
 * a won level pays 1/2.2, a lost one pays 1/3. Everything is rounded down.
 * Shop prices, booster costs and other rewards are not affected.
 */
export const REWARD = {
  winDivisor: 3,
  loseDivisor: 4,
};

/** Coins paid by the rewarded "+coins" placement of the store build. */
export const ADS_COIN_PACK = 15;

/** Extra shots the player may buy with one rewarded view after losing. */
export const LOSE_CONTINUE_SHOTS = 5;

/**
 * In-app products of the store build. Prices are fallbacks: the real price
 * comes from RuStore Pay / Google Play and is shown when the bridge answers.
 */
export const COIN_PACKS = [
  { id: 'coins_100', coins: 100, price: '49 ₽' },
  { id: 'coins_500', coins: 500, price: '199 ₽' },
  { id: 'coins_1200', coins: 1200, price: '449 ₽' },
];

export const REMOVE_ADS_PRODUCT = { id: 'remove_ads', price: '199 ₽' };

export const START_COINS = 50;
export const START_BOOSTERS = { bomb: 1, lightning: 1, rainbow: 1, rocket: 1 };

export const MAX_LEVEL = 1000;

export const STORAGE_KEY = 'bubblepop.save.v1';
export const SAVE_VERSION = 1;
/** Bumped when the 100-level catalogue is reordered, so old star records can
 *  be remapped by their stable source id instead of landing on other levels. */
export const CATALOG_VERSION = 3;

/** Physics / presentation tuning. */
export const TUNING = {
  shotSpeed: 1350, // px per second along the traced path
  maxTraceSteps: 20000, // safety valve for malformed angles
  minAngle: 0.2, // radians away from horizontal (~11.5 degrees)
  collisionInset: 4, // px shaved from each bubble for the circle intersection
};

/* ------------------------------------------------------------ economy */

/** Coin prices of the in-game services. */
export const ECONOMY = {
  continueCost: 50, // +5 shots after a loss, without watching an ad
  undoCost: 25, // take the last shot back
  shuffleCost: 75, // reshuffle colours on the board
};

/** Daily login rewards, one per day of a seven day streak. */
export const DAILY_REWARDS = [10, 15, 20, 30, 40, 60, 100];

/** Three quests a day; progress resets at local midnight. */
export const QUESTS = [
  { id: 'levels', title: 'Пройти 2 уровня', target: 2, reward: 30 },
  { id: 'bubbles', title: 'Лопнуть 60 шариков', target: 60, reward: 30 },
  { id: 'stars', title: 'Собрать 4 звезды', target: 4, reward: 40 },
];

/** Booster bundles: three of a kind for less than the single price. */
export const BUNDLES = [
  { id: 'bomb3', booster: 'bomb', count: 3, price: 230 },
  { id: 'lightning3', booster: 'lightning', count: 3, price: 260 },
  { id: 'rainbow3', booster: 'rainbow', count: 3, price: 180 },
  { id: 'rocket3', booster: 'rocket', count: 3, price: 200 },
];

/** Field themes. `bg` is painted on the stage, `accent` tints the HUD. */
export const THEMES = [
  {
    id: 'classic',
    name: 'Классика',
    price: 0,
    bg: 'radial-gradient(120% 90% at 50% 0%, #1f4f9e 0%, #12306c 42%, #071736 100%)',
    accent: '#2f8cff',
  },
  {
    id: 'night',
    name: 'Ночь',
    price: 250,
    bg: 'radial-gradient(120% 90% at 50% 0%, #2a2450 0%, #171336 45%, #070512 100%)',
    accent: '#8f7bff',
  },
  {
    id: 'sunset',
    name: 'Закат',
    price: 350,
    bg: 'radial-gradient(120% 90% at 50% 0%, #8a3b6b 0%, #4a1f4e 45%, #150a24 100%)',
    accent: '#ff8a5c',
  },
];

/** Cannon skins: only the barrel colour changes, gameplay stays the same. */
export const SKINS = [
  { id: 'classic', name: 'Классика', price: 0, color: '#c9dcff' },
  { id: 'gold', name: 'Золотая', price: 300, color: '#ffd35c' },
  { id: 'neon', name: 'Неон', price: 300, color: '#7cf0ff' },
];

