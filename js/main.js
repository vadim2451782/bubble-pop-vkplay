/**
 * Application controller: boots the game, wires DOM input, animation loop,
 * screen transitions, boosters, audio and PWA registration.
 */
import { ADS_COIN_PACK, BOOSTERS, BOOSTER_ORDER, BUNDLES, COIN_PACKS, ECONOMY, LOSE_CONTINUE_SHOTS, MAX_LEVEL, RAINBOW, REMOVE_ADS_PRODUCT, REWARD, SCORE, TUNING } from './config.js';
import { getLevel, getNextLevel, LEVELS } from './levels.js';
import { createLayout } from './layout.js';
import { Game } from './game.js';
import { Renderer } from './renderer.js';
import { Store } from './storage.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';
import { platform } from './platform.js';
import { ads } from './ads.js';
import { iap } from './iap.js';
import { net } from './net.js';
import { vkplay } from './vkplay.js';
import { bubbleAtPoint, clampAimAngle } from './physics.js';

const QA = new URLSearchParams(window.location.search).has('qa');
const canvas = document.getElementById('game');
const stage = document.getElementById('stage');
// On Pikabu the same save object is mirrored into the platform cloud storage.
const cloudSlot = platform.enabled ? { save: (state) => platform.writeSave(state) } : null;
const store = new Store(null, undefined, cloudSlot);
const audio = new AudioEngine(store.settings);
const renderer = new Renderer(canvas);
const ui = new UI({ store, onAction });

let game = null;
let layout = null;
let currentLevelId = 1;
let view = makeView();
let paused = false;
let resultScreenOpen = false;
let resolveTimer = 0;
let rafId = 0;
let lastTs = 0;
let currentMetaBack = 'menu';
/** Board state right before the last shot, for the paid undo. */
let lastShotSnapshot = null;
let currentSettingsBack = 'menu';
let resizeQueued = false;
let activePointerId = null;
let lastBounceSoundAt = 0;

function makeView() {
  return {
    aimAngle: -Math.PI / 2,
    aiming: false,
    aimTrace: null,
    flying: null,
    boosterMode: null,
    hoverCell: null,
    nextHovered: false,
    rainbow: false,
    rocket: false,
  };
}

/* --------------------------------------------------------------- lifecycle */

function startLoop() {
  if (rafId) return;
  lastTs = performance.now();
  const frame = (ts) => {
    rafId = requestAnimationFrame(frame);
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
    dt = Math.min(dt, 0.05);
    renderer.update(dt);
    updateGame(dt);
    if (game) renderer.draw(view);
  };
  rafId = requestAnimationFrame(frame);
}

function updateGame(dt) {
  if (!game) return;
  if (view.flying) {
    if (!paused && !resultScreenOpen) {
      const trace = view.flying.trace;
      const traceLength = Math.max(1, trace.length);
      const previous = view.flying.progress;
      const next = Math.min(1, previous + (TUNING.shotSpeed * dt) / traceLength);
      const sparkColor = trace.rainbow ? 'purple' : trace.shotColor || 'blue';
      for (const bounce of trace.bouncePoints || []) {
        const at = bounce.distance / traceLength;
        if (at > previous && at <= next) {
          renderer.addParticles(bounce.x, bounce.y, sparkColor, 4, 0.4);
          if (performance.now() - lastBounceSoundAt > 60) {
            audio.play('bounce');
            lastBounceSoundAt = performance.now();
          }
        }
      }
      view.flying.progress = next;
      if (view.flying.progress >= 1) finishFlight();
    }
    return;
  }
  if (!paused && game.phase === 'aim' && !view.aimTrace) refreshAim();
}

function resizeStage() {
  const rect = stage.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  renderer.resize(rect.width, rect.height);
  if (!game) return;
  layout = createLayout(rect.width, rect.height, game.level.rows.length);
  game.layout = layout;
  renderer.layout = layout;
  // The board may now have room for more rows (window got bigger, or the
  // player opened fullscreen): let the grid grow before anything is drawn.
  game.grid.ensureCapacity(layout.maxRows);
  renderer.sprites.clear();
  renderer.ensureSprites();
  refreshAim();
}

function queueResize() {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    resizeStage();
    // The banner is a native view pinned to CSS coordinates: recreate it so it
    // follows the new layout after a resize or a fullscreen switch.
    if (window.__STORE__ && game && !resultScreenOpen && !paused) {
      ads.hideBanner();
      refreshGameBanner();
    }
  });
}

/**
 * Demo build: the store build with a simulated banner, so the layout can be
 * reviewed in a desktop browser instead of installing an APK on a phone.
 */
const DEMO_ADS = window.__DEMO_ADS__ === true;
let demoBannerEl = null;

function setDemoAdStrip(visible, reserve = true) {
  if (!DEMO_ADS) return;
  if (!demoBannerEl) {
    demoBannerEl = document.createElement('div');
    demoBannerEl.className = 'demo-banner';
    demoBannerEl.innerHTML =
      '<span class="demo-banner__tag">Реклама</span>' +
      '<span class="demo-banner__thumb"></span>' +
      '<span class="demo-banner__text"><b>Демо-баннер</b><small>так выглядит место под рекламу Яндекса</small></span>';
    document.querySelector('.app')?.append(demoBannerEl);
  }
  demoBannerEl.hidden = !visible;
  if (reserve) ui.setBannerReserved(visible);
}

/** Width of the game column the ad has to match. */
function bannerWidth() {
  return Math.min(window.innerWidth || 360, 680);
}

/**
 * Banner strip at the bottom of the screen while a level is played.
 * The strip height is measured once per width and cached: reserving a guessed
 * height first and correcting it later made the whole board jump.
 */
function refreshGameBanner() {
  if (DEMO_ADS) {
    setDemoAdStrip(Boolean(game) && !resultScreenOpen && !paused);
    return;
  }
  if (!window.__STORE__) return;
  if (!game || resultScreenOpen || paused || !ads.bannerSupported || ads.removeAds) {
    ui.setBannerReserved(false);
    ads.hideBanner();
    return;
  }
  const width = bannerWidth();
  const known = ads.bannerHeightCached(width);
  if (known > 0) {
    ui.setBannerReserved(true, known + 10);
    ads.showBanner({ width });
    return;
  }
  // First show for this width: measure, then reserve and show in one step.
  ads.bannerHeight(width).then((height) => {
    if (!game || resultScreenOpen || paused) return;
    ui.setBannerReserved(true, (height > 0 ? height : 58) + 10);
    ads.showBanner({ width });
  });
}

/** Hides the ad but keeps the strip reserved (result screens, no layout jump). */
function pauseGameBanner() {
  if (DEMO_ADS) {
    setDemoAdStrip(false, false);
    return;
  }
  ads.hideBanner();
}

function hideGameBanner() {
  if (DEMO_ADS) {
    setDemoAdStrip(false);
    return;
  }
  ui.setBannerReserved(false);
  ads.hideBanner();
}

/* ------------------------------------------------------------------ audio */

function unlockAudio() {
  if (audio.unlocked) return;
  audio.unlock().catch(() => {});
}

function toggleSound() {
  const next = !store.settings.sound;
  store.setSettings({ sound: next });
  audio.setSettings({ sound: next });
  ui.applySettings();
  if (next) {
    unlockAudio();
    audio.play('click');
  }
}

function toggleMusic() {
  const next = !store.settings.music;
  store.setSettings({ music: next });
  audio.setSettings({ music: next });
  ui.applySettings();
  if (next) {
    unlockAudio();
    audio.play('click');
  }
}

/* ------------------------------------------------------------------ level */

function startLevel(id, { announce = true } = {}) {
  ads.hideBanner();
  const level = getLevel(id);
  clearTimeout(resolveTimer);
  resolveTimer = 0;
  resultScreenOpen = false;
  paused = false;
  currentLevelId = level.id;
  view = makeView();
  activePointerId = null;

  const rect = stage.getBoundingClientRect();
  const width = rect.width || window.innerWidth;
  const height = rect.height || window.innerHeight;
  layout = createLayout(width, height, level.rows.length);
  game = new Game({ level, layout, rng: Math.random });

  renderer.resize(width, height);
  renderer.setLevel(game);
  ui.showScreen(null);
  ui.hideTargetHint();
  ui.syncHud(game);
  if (announce) ui.flashLevelName(`${level.id} · ${level.name}`);
  refreshAim();
  ensureAudioOnGesture();
  startLoop();
  refreshGameBanner();
}

function ensureAudioOnGesture() {
  unlockAudio();
}

function refreshAim() {
  if (!game || game.phase !== 'aim' || view.flying) {
    view.aimTrace = null;
    return;
  }
  view.aimAngle = clampAimAngle(view.aimAngle);
  view.aimTrace = game.createShot(view.aimAngle);
  view.rainbow = !!(game && game.isRainbow());
  view.rocket = !!(game && game.isRocket());
}

function finishFlight() {
  if (!game || !view.flying) return;
  const trace = view.flying.trace;
  view.flying = null;
  lastShotSnapshot = snapshotGame();
  const beforePopped = game.stats.popped;
  const result = game.applyShot(trace);
  const poppedNow = Math.max(0, game.stats.popped - beforePopped);
  if (poppedNow > 0) store.questProgress('bubbles', poppedNow);
  if (!result) {
    refreshAim();
    return;
  }
  handleShotResult(result, trace);
}

function handleShotResult(result, trace) {
  const R = layout.radius;
  if (result.rocket) {
    if (result.rocketTarget && result.removed.length) {
      const beamX = layout.cellX(result.rocketTarget.r, result.rocketTarget.c);
      renderer.addStreak(beamX, layout.top, beamX, layout.dangerY, '#ffd27a', 9, 0.55);
      let sx = 0;
      let sy = 0;
      for (const cell of result.removed) {
        const x = layout.cellX(cell.r, cell.c);
        const y = layout.cellY(cell.r);
        sx += x;
        sy += y;
        renderer.addParticles(x, y, cell.color, 8, 1);
        renderer.ring(x, y, cell.color, R * 1.9);
      }
      renderer.addFloater(sx / result.removed.length, sy / result.removed.length, `+${result.scoreGain}`);
    }
    renderer.shake(9);
    renderer.flash(0.15, '#ffe0a8');
    audio.play('rocket');
  } else if (result.popped.length) {
    renderer.popCells(result.popped, result.shotColor);
    const average = result.popped.reduce(
      (acc, cell) => ({
        x: acc.x + layout.cellX(cell.r, cell.c),
        y: acc.y + layout.cellY(cell.r),
      }),
      { x: 0, y: 0 },
    );
    average.x /= result.popped.length;
    average.y /= result.popped.length;
    renderer.addFloater(average.x, average.y - R * 0.4, `+${result.scoreGain}`);
    renderer.shake(3 + Math.min(7, result.popped.length * 0.6));
    audio.play('pop', { combo: result.popped.length });
  } else if (result.placed) {
    const x = layout.cellX(result.placed.r, result.placed.c);
    const y = layout.cellY(result.placed.r);
    renderer.ring(x, y, result.shotColor, R * 1.5);
    renderer.addParticles(x, y, result.shotColor, 3, 0.35);
    audio.play(result.bounces ? 'bounce' : 'place');
  }

  if (result.falling.length) {
    renderer.fallCells(result.falling);
    audio.play('fall');
    const average = result.falling.reduce(
      (acc, cell) => ({
        x: acc.x + layout.cellX(cell.r, cell.c),
        y: acc.y + layout.cellY(cell.r),
      }),
      { x: 0, y: 0 },
    );
    average.x /= result.falling.length;
    average.y /= result.falling.length;
    renderer.addFloater(average.x, average.y, `+${result.falling.length * SCORE.falling}`, '#a9e0ff');
  }

  // Coins are no longer credited shot by shot: the level pays out once, when
  // its outcome is known (see settleLevelReward), so the coin chip and the
  // result screen always agree with the wallet.
  if (result.coinsGain) {
    ui.setCoins(store.coins, { bump: false });
  }
  ui.syncHud(game);
  refreshAim();
  scheduleResult();
}

function scheduleResult() {
  if (!game) return;
  if (game.phase === 'won') {
    clearTimeout(resolveTimer);
    resolveTimer = setTimeout(finishWin, 700);
  } else if (game.phase === 'lost') {
    clearTimeout(resolveTimer);
    resolveTimer = setTimeout(finishLose, 700);
  }
}

/**
 * Pays the level out exactly once.
 *
 * Raw reward = coins collected during the level (1 per 4 bubbles) plus the win
 * bonus (10 + 5 per star). It is then cut down: a won level keeps 1/2.2, a lost
 * one 1/3, rounded down. The guard on the game object makes the payout
 * idempotent: reopening the result screen, returning from the shop or pressing
 * "Заново" never credits the same level twice.
 */
function settleLevelReward(outcome) {
  if (!game || game.rewardPaid !== undefined) return 0;
  const collected = Math.max(0, game.coinsEarned || 0);
  const stars = Math.max(1, game.stars || 1);
  const bonus = outcome === 'win' ? SCORE.winBase + stars * SCORE.winPerStar : 0;
  const raw = collected + bonus;
  const divisor = outcome === 'win' ? REWARD.winDivisor : REWARD.loseDivisor;
  const paid = Math.floor(raw / divisor);
  game.rewardPaid = paid;
  game.rewardRaw = raw;
  if (paid > 0) store.addCoins(paid);
  ui.setCoins(store.coins, { bump: paid > 0 });
  return paid;
}

function finishWin() {
  if (!game || game.phase !== 'won' || resultScreenOpen) return;
  resultScreenOpen = true;
  pauseGameBanner();
  paused = true;
  const level = game.level;
  const stars = Math.max(1, game.stars || 1);
  const paid = settleLevelReward('win');
  store.completeLevel(level.id, stars, game.score);
  store.questProgress('levels', 1);
  store.questProgress('stars', stars);
  ui.setCoins(store.coins);
  ui.renderAll();
  audio.play('win');
  if (level.id >= MAX_LEVEL) {
    const totalStars = LEVELS.reduce((sum, item) => sum + store.getLevelRecord(item.id).stars, 0);
    ui.showComplete({ stars: totalStars, coins: store.coins });
    for (let i = 0; i < 3; i += 1) {
      setTimeout(() => audio.play('star'), 420 + i * 240);
    }
    return;
  }
  const next = getNextLevel(level.id);
  ui.showWin({
    game,
    stars,
    coins: paid,
    nextExists: !!next,
  });
  ads.maybeInterstitial();
  for (let i = 0; i < stars; i += 1) {
    setTimeout(() => audio.play('star'), 420 + i * 240);
  }
}

function finishLose() {
  if (!game || game.phase !== 'lost' || resultScreenOpen) return;
  resultScreenOpen = true;
  pauseGameBanner();
  paused = true;
  const paid = settleLevelReward('lose');
  audio.play('lose');
  ui.showLose({ game, reason: game.loseReason, coins: paid });
  ui.setContinueAdVisible(ads.rewardedSupported);
  ui.setContinueCoinsVisible(store.coins >= ECONOMY.continueCost);
  ads.maybeInterstitial();
}

/** "+5 шаров" after a loss: one rewarded view, applied once. */
async function continueWithAd() {
  if (!game || game.phase !== 'lost' || !ads.rewardedSupported) return;
  const button = document.getElementById('btnContinueAd');
  if (button) button.disabled = true;
  const canShow = await ads.canShowRewarded();
  if (!canShow) {
    if (button) button.disabled = false;
    ui.setContinueAdVisible(false);
    ui.toast('Реклама сейчас недоступна');
    return;
  }
  audio.pauseAll();
  const result = await ads.showRewarded();
  audio.resumeAll();
  if (!result.reward) {
    if (button) button.disabled = false;
    ui.toast('Реклама не досмотрена — шары не начислены', 2600);
    return;
  }
  game.shots += LOSE_CONTINUE_SHOTS;
  game.phase = 'aim';
  game.loseReason = null;
  resultScreenOpen = false;
  paused = false;
  ui.setContinueAdVisible(false);
  ui.showScreen(null);
  ui.syncHud(game);
  refreshAim();
  ui.toast(`+${LOSE_CONTINUE_SHOTS} шаров`);
}

/** "+5 шаров" after a loss, paid with coins (no ad needed). */
function continueWithCoins() {
  if (!game || game.phase !== 'lost' || resultScreenOpen === false) return;
  if (store.coins < ECONOMY.continueCost) {
    ui.toast('Не хватает монет — загляните в задания');
    return;
  }
  store.spendCoins(ECONOMY.continueCost);
  ui.setCoins(store.coins);
  game.shots += LOSE_CONTINUE_SHOTS;
  game.phase = 'aim';
  game.loseReason = null;
  resultScreenOpen = false;
  paused = false;
  lastShotSnapshot = null;
  ui.setContinueCoinsVisible(false);
  ui.setContinueAdVisible(false);
  ui.showScreen(null);
  ui.syncHud(game);
  refreshAim();
  audio.play('buy');
  ui.toast(`+${LOSE_CONTINUE_SHOTS} шаров за ${ECONOMY.continueCost} монет`);
}

/* ------------------------------------------------------- undo & shuffle */

function snapshotGame() {
  if (!game) return null;
  const cells = [];
  game.grid.forEachOccupied((color, r, c) => cells.push({ r, c, color }));
  return {
    cells,
    shots: game.shots,
    score: game.score,
    current: game.current,
    next: game.next,
    stats: { ...game.stats },
  };
}

function restoreSnapshot(snapshot) {
  if (!game || !snapshot) return;
  for (const row of game.grid.rows) row.fill(null);
  for (const cell of snapshot.cells) game.grid.set(cell.r, cell.c, cell.color);
  game.shots = snapshot.shots;
  game.score = snapshot.score;
  game.current = snapshot.current;
  game.next = snapshot.next;
  game.stats = { ...snapshot.stats };
  game.phase = 'aim';
  game.loseReason = null;
  view.flying = null;
  view.boosterMode = null;
  resultScreenOpen = false;
  paused = false;
  ui.showScreen(null);
  ui.syncHud(game);
  ui.setCoins(store.coins);
  refreshAim();
}

function undoShot() {
  if (!game || resultScreenOpen) return;
  if (!lastShotSnapshot) {
    ui.toast('Пока нечего отменять');
    return;
  }
  if (store.coins < ECONOMY.undoCost) {
    ui.toast('Не хватает монет');
    return;
  }
  store.spendCoins(ECONOMY.undoCost);
  const snapshot = lastShotSnapshot;
  lastShotSnapshot = null;
  restoreSnapshot(snapshot);
  audio.play('click');
  ui.toast(`Выстрел отменён · −${ECONOMY.undoCost} монет`);
}

function shuffleBoard() {
  if (!game || game.phase !== 'aim' || resultScreenOpen) return;
  if (store.coins < ECONOMY.shuffleCost) {
    ui.toast('Не хватает монет');
    return;
  }
  const cells = [];
  game.grid.forEachOccupied((color, r, c) => cells.push({ r, c }));
  if (cells.length < 2) {
    ui.toast('Поле почти пустое');
    return;
  }
  const colors = cells.map(({ r, c }) => game.grid.get(r, c));
  const noTriples = () => {
    for (const { r, c } of cells) {
      const color = game.grid.get(r, c);
      let same = 0;
      for (const [rr, cc] of game.grid.neighbors(r, c)) {
        if (game.grid.get(rr, cc) === color) same += 1;
      }
      if (same >= 2) return false;
    }
    return true;
  };
  let attempt = 0;
  do {
    for (let i = colors.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [colors[i], colors[j]] = [colors[j], colors[i]];
    }
    cells.forEach((cell, index) => game.grid.set(cell.r, cell.c, colors[index]));
    attempt += 1;
  } while (!noTriples() && attempt < 40);

  store.spendCoins(ECONOMY.shuffleCost);
  lastShotSnapshot = null;
  ui.setCoins(store.coins);
  ui.syncHud(game);
  refreshAim();
  audio.play('click');
  ui.toast(`Поле перемешано · −${ECONOMY.shuffleCost} монет`);
}

/* --------------------------------------------------------- quests & shop */

function openQuests() {
  ui.showScreen('quests');
  ui.renderQuests();
  audio.play('click');
}

function claimDaily() {
  const result = store.claimDaily();
  if (!result.ok) {
    ui.toast('Бонус уже получен — приходите завтра');
    return;
  }
  ui.setCoins(store.coins);
  ui.renderQuests();
  audio.play('buy');
  ui.toast(`Ежедневный бонус: +${result.reward} монет`);
}

function claimQuest(id) {
  const result = store.claimQuest(id);
  if (!result.ok) {
    ui.toast('Задание ещё не выполнено');
    return;
  }
  ui.setCoins(store.coins);
  ui.renderQuests();
  audio.play('buy');
  ui.toast(`Задание выполнено: +${result.reward} монет`);
}

function buyBundle(id) {
  const bundle = BUNDLES.find((item) => item.id === id);
  if (!bundle) return;
  if (store.coins < bundle.price) {
    ui.toast('Не хватает монет');
    return;
  }
  store.spendCoins(bundle.price);
  store.addBooster(bundle.booster, bundle.count);
  ui.setCoins(store.coins);
  ui.renderShop();
  ui.syncHud(game);
  audio.play('buy');
  ui.toast(`+${bundle.count} × ${BOOSTERS[bundle.booster].name}`);
}

function useCosmetic(kind, id) {
  if (!store.ownsCosmetic(kind, id)) {
    const result = store.buyCosmetic(kind, id);
    if (!result.ok) {
      ui.toast(result.reason === 'coins' ? 'Не хватает монет' : 'Уже куплено');
      return;
    }
    ui.setCoins(store.coins);
    audio.play('buy');
  }
  store.useCosmetic(kind, id);
  ui.applyTheme();
  renderer.setSkin(store.skin.color);
  ui.renderShopExtras();
  audio.play('click');
  ui.toast('Применено');
}

function pauseGame() {
  if (!game || resultScreenOpen) return;
  cancelBooster();
  paused = true;
  view.aiming = false;
  activePointerId = null;
  ui.showPause(game);
}

function resumeGame() {
  if (!game) return;
  paused = false;
  resultScreenOpen = false;
  ui.showScreen(null);
  ui.syncHud(game);
  refreshAim();
  lastTs = performance.now();
  refreshGameBanner();
}

function returnToMenu() {
  hideGameBanner();
  clearTimeout(resolveTimer);
  resolveTimer = 0;
  // Leaving a level mid-way pays the same reduced reward as losing it, so the
  // coins already collected are not silently thrown away. A settled level
  // (win/lose screen was shown) pays nothing extra.
  if (game) settleLevelReward(game.phase === 'won' ? 'win' : 'lose');
  resultScreenOpen = false;
  paused = false;
  game = null;
  view = makeView();
  ui.hideTargetHint();
  ui.showScreen('menu');
  ui.renderAll();
}

function openLevels() {
  clearTimeout(resolveTimer);
  resultScreenOpen = false;
  paused = true;
  ui.showScreen('levels');
  ui.renderLevels();
  // The screen is visible now, so the map can scroll to the current level.
  requestAnimationFrame(() => ui.scrollLevelsToCurrent());
  currentMetaBack = 'menu';
}

function openShop(from = 'menu') {
  currentMetaBack = from;
  if (from === 'pause' || from === 'game') paused = true;
  view.aiming = false;
  audio.play('click');
  ui.showScreen('shop');
  ui.renderShop();
  ui.setCoins(store.coins, { bump: false });
  refreshAds();
  refreshStoreShop();
  refreshVkPlayShop();
  // The native rewarded ad may still be loading; check again in a moment.
  setTimeout(() => refreshAds(), 4000);
}

/** Coin packs, "remove ads" and the banner: store builds only. */
async function refreshStoreShop() {
  if (DEMO_ADS) {
    setDemoAdStrip(true);
    return;
  }
  if (!window.__STORE__) return;
  if (!iap.ready) {
    ui.renderCoinShop({});
    ui.setBannerSlot(false);
    return;
  }
  await iap.loadPrices();
  ui.renderCoinShop({
    packs: COIN_PACKS.map((pack) => ({ ...pack, price: iap.priceOf(pack.id, pack.price) })),
    hasRemoveAds: store.hasRemoveAds,
    removeAdsPrice: iap.priceOf(REMOVE_ADS_PRODUCT.id, REMOVE_ADS_PRODUCT.price),
  });

  if (ads.bannerSupported && !store.hasRemoveAds) {
    const bannerWidth = Math.min(window.innerWidth || 360, 680);
    const bannerH = await ads.bannerHeight(bannerWidth);
    ui.setBannerReserved(true, bannerH > 0 ? bannerH + 10 : 58);
    const shown = await ads.showBanner({ width: bannerWidth });
    if (!shown) ui.setBannerReserved(false);
    return;
  }
  ui.setBannerReserved(false);
  ads.hideBanner();
}

async function buyCoinsPack(productId) {
  const pack = COIN_PACKS.find((item) => item.id === productId);
  if (!pack || !iap.ready || iap.busy) return;
  const result = await iap.buy(productId);
  if (!result.ok) {
    ui.toast(result.reason === 'CANCELLED' ? 'Покупка отменена' : 'Не удалось совершить покупку');
    return;
  }
  const applied = store.grantPurchase(productId, result.purchaseId || String(Date.now()));
  if (!applied) {
    ui.toast('Эта покупка уже учтена');
    return;
  }
  store.addCoins(pack.coins);
  unlockAudio();
  audio.play('buy');
  ui.setCoins(store.coins);
  ui.renderShop();
  ui.renderMenu();
  refreshStoreShop();
  ui.toast(`+${pack.coins} монет`);
}

async function buyRemoveAds() {
  if (!iap.ready || iap.busy || store.hasRemoveAds) return;
  const result = await iap.buy(REMOVE_ADS_PRODUCT.id);
  if (!result.ok) {
    ui.toast(result.reason === 'CANCELLED' ? 'Покупка отменена' : 'Не удалось совершить покупку');
    return;
  }
  store.grantPurchase(REMOVE_ADS_PRODUCT.id, result.purchaseId || '');
  ads.setRemoveAds(true);
  ui.setBannerReserved(false);
  ui.setBannerSlot(false);
  ui.renderShop();
  ui.renderMenu();
  refreshStoreShop();
  ui.toast('Реклама отключена');
}

function backFromShop() {
  ads.hideBanner();
  if (currentMetaBack === 'pause' && game) {
    ui.showScreen('pause');
    paused = true;
  } else if (currentMetaBack === 'lose' && game) {
    ui.showScreen('lose');
  } else if (currentMetaBack === 'game' && game) {
    ui.showScreen(null);
    paused = false;
    ui.syncHud(game);
    refreshAim();
  } else {
    returnToMenu();
  }
}

function openSettings(from = 'menu') {
  currentSettingsBack = from;
  if (from === 'pause') paused = true;
  ui.showScreen('settings');
  ui.applySettings();
  audio.play('click');
}

function backFromSettings() {
  if (currentSettingsBack === 'pause' && game) {
    ui.showScreen('pause');
    paused = true;
  } else {
    returnToMenu();
  }
}

function nextLevel() {
  const next = getNextLevel(currentLevelId);
  if (next && next.id <= store.unlocked) {
    startLevel(next.id);
  } else {
    openLevels();
  }
}

function buyBooster(id) {
  const booster = BOOSTERS[id];
  if (!booster) return;
  const result = store.buyBooster(id, booster.price);
  if (!result.ok) {
    ui.toast('Не хватает монет — лопайте шарики!');
    audio.play('click');
    return;
  }
  unlockAudio();
  audio.play('buy');
  ui.setCoins(store.coins);
  ui.renderShop();
  ui.renderMenu();
  ui.syncBoosters();
  ui.toast(`${booster.name} куплен!`);
}

/**
 * Alternative way to get a booster: watch one rewarded ad, get one item.
 * Buying with coins always stays available, the ad is only an option.
 */
async function buyBoosterByAd(id) {
  const booster = BOOSTERS[id];
  if (!booster || ui.adsBusy) return;
  if (!ads.rewardedSupported) {
    ui.toast('Реклама недоступна — купите за монеты');
    return;
  }

  ui.setAdsBusy(true);
  const canShow = await ads.canShowRewarded();
  if (!canShow) {
    ui.setAdsBusy(false);
    ui.setAdsAvailable(false);
    ui.toast('Реклама сейчас недоступна — попробуйте позже');
    return;
  }

  audio.pauseAll();
  const result = await ads.showRewarded();
  audio.resumeAll();
  ui.setAdsBusy(false);

  if (!result.reward) {
    console.warn('[ads] rewarded not completed:', result.reason || 'closed early');
    ui.toast('Реклама не досмотрена — награда не начислена', 2600);
    refreshAds();
    return;
  }

  store.addBooster(id, 1);
  unlockAudio();
  audio.play('buy');
  ui.setCoins(store.coins, { bump: false });
  ui.syncBoosters();
  ui.renderShop();
  ui.renderMenu();
  ui.toast(`+1 ${booster.name} за просмотр рекламы`);
  refreshAds();
}

/** "+N монет за рекламу" — a new rewarded placement of the Play build. */
async function buyCoinsByAd() {
  if (ui.coinsAdBusy) return;
  if (!ads.rewardedSupported) {
    ui.setCoinsAdAvailable(false);
    ui.toast('Реклама недоступна');
    return;
  }
  ui.coinsAdBusy = true;
  ui.setCoinsAdBusy(true);
  const canShow = await ads.canShowRewarded();
  if (!canShow) {
    ui.coinsAdBusy = false;
    ui.setCoinsAdBusy(false);
    ui.setCoinsAdAvailable(false);
    ui.toast('Реклама сейчас недоступна — попробуйте позже');
    return;
  }
  audio.pauseAll();
  const result = await ads.showRewarded();
  audio.resumeAll();
  ui.coinsAdBusy = false;
  ui.setCoinsAdBusy(false);
  if (!result.reward) {
    ui.toast('Реклама не досмотрена — монеты не начислены', 2600);
    refreshAds();
    return;
  }
  store.addCoins(ADS_COIN_PACK);
  unlockAudio();
  audio.play('buy');
  ui.setCoins(store.coins);
  ui.renderShop();
  ui.renderMenu();
  ui.toast(`+${ADS_COIN_PACK} монет за просмотр рекламы`);
  refreshAds();
}

/** Ask the platform whether the rewarded button may be shown right now. */
async function refreshAds() {
  if (!ads.enabled) return;
  if (!ads.rewardedSupported) {
    ui.setAdsAvailable(false);
    ui.setCoinsAdAvailable(false);
    return;
  }
  const canShow = await ads.canShowRewarded();
  ui.setAdsAvailable(canShow);
  ui.setCoinsAdAvailable(canShow);
}

/* ---------------------------------------------------------------- boosters */

function cancelBooster() {
  view.boosterMode = null;
  view.hoverCell = null;
  ui.hideTargetHint();
}

function onBoosterClick(type) {
  if (!game || game.phase !== 'aim' || view.flying || paused || resultScreenOpen) return;
  if (!BOOSTER_ORDER.includes(type)) return;
  unlockAudio();

  if (view.boosterMode === type) {
    cancelBooster();
    return;
  }
  if (store.boosterCount(type) <= 0) {
    cancelBooster();
    openShop('game');
    return;
  }

  if (game.isRocket() && type !== 'rocket') {
    ui.toast('Сначала выстрелите ракетой', 1200);
    return;
  }

  if (type === 'rocket') {
    if (game.isRocket()) {
      ui.toast('Ракета уже заряжена', 1200);
      return;
    }
    if (game.isRainbow()) {
      ui.toast('Сначала выстрелите радужным шаром', 1200);
      return;
    }
    if (!game.armRocket()) return;
    store.consumeBooster('rocket');
    cancelBooster();
    view.rocket = true;
    ui.syncHud(game);
    ui.syncBoosters();
    ui.toast('Ракета заряжена!', 1200);
    audio.play('click');
    refreshAim();
    return;
  }

  if (type === 'rainbow') {
    if (!game.canUseBooster('rainbow')) return;
    if (game.isRainbow()) {
      ui.toast('Радужный шар уже заряжен', 1200);
      return;
    }
    store.consumeBooster('rainbow');
    game.useBooster('rainbow');
    view.rainbow = true;
    cancelBooster();
    ui.syncHud(game);
    ui.syncBoosters();
    ui.toast('Радужный шар заряжен!', 1400);
    audio.play('rainbow');
    refreshAim();
    return;
  }

  cancelBooster();
  view.boosterMode = type;
  view.aiming = false;
  ui.showTargetHint(type);
  audio.play('click');
}

function applyBoosterAt(cell) {
  const type = view.boosterMode;
  if (!type || !game || game.phase !== 'aim') return;
  if (store.boosterCount(type) <= 0) {
    cancelBooster();
    ui.toast('Бустеры закончились');
    return;
  }
  const result = game.useBooster(type, cell);
  if (!result) return;
  store.consumeBooster(type);
  cancelBooster();
  ui.syncHud(game);
  handleBoosterResult(result, type);
}

function handleBoosterResult(result, type) {
  const R = layout.radius;
  const targetColor = result.target?.color || 'blue';

  if (type === 'bomb') {
    for (const cell of result.removed) {
      const x = layout.cellX(cell.r, cell.c);
      const y = layout.cellY(cell.r);
      renderer.ring(x, y, cell.color, R * 2.2);
      renderer.addParticles(x, y, cell.color, 8, 1.1);
    }
    renderer.shake(10);
    renderer.flash(0.16, '#ffd3a1');
    audio.play('bomb');
  } else if (type === 'lightning') {
    const seen = new Set();
    for (const cell of result.removed) {
      const x = layout.cellX(cell.r, cell.c);
      const y = layout.cellY(cell.r);
      if (!seen.has(cell.c)) {
        renderer.addStreak(x, layout.top, x, y, '#bdefff', 3.2, 0.45);
        seen.add(cell.c);
      }
      renderer.addParticles(x, y, cell.color, 7, 0.9);
      renderer.ring(x, y, cell.color, R * 1.9);
    }
    renderer.flash(0.22, '#c9f2ff');
    renderer.shake(8);
    audio.play('lightning');
  } else if (type === 'rocket') {
    const beamX = layout.cellX(result.target.r, result.target.c);
    renderer.addStreak(beamX, layout.top, beamX, layout.dangerY, '#ffd27a', 9, 0.55);
    for (const cell of result.removed) {
      const x = layout.cellX(cell.r, cell.c);
      const y = layout.cellY(cell.r);
      renderer.addParticles(x, y, cell.color, 8, 1);
      renderer.ring(x, y, cell.color, R * 1.9);
    }
    renderer.shake(9);
    renderer.flash(0.15, '#ffe0a8');
    audio.play('rocket');
  }

  if (result.falling.length) {
    renderer.fallCells(result.falling);
    audio.play('fall');
  }

  renderer.addFloater(
    layout.cellX(result.target.r, result.target.c),
    layout.cellY(result.target.r) - R * 0.6,
    `+${result.scoreGain}`,
  );

  ui.syncHud(game);
  refreshAim();
  scheduleResult();
}

/* ------------------------------------------------------------------ input */

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function angleFromPoint(point) {
  const dx = point.x - layout.shooterX;
  const dy = point.y - layout.shooterY;
  let angle = Math.atan2(dy, dx);
  if (angle >= 0) {
    angle = dx >= 0 ? -0.08 : -Math.PI + 0.08;
  }
  return clampAimAngle(angle);
}

function nearNextBubble(point) {
  const next = renderer.getNextBubblePosition();
  return Math.hypot(point.x - next.x, point.y - (next.y - next.radius * 0.15)) < next.radius * 1.75;
}

function swapBubbles() {
  if (!game || game.phase !== 'aim' || view.flying) return;
  if (!game.swap()) return;
  unlockAudio();
  audio.play('swap');
  ui.syncHud(game);
  refreshAim();
}

function shoot() {
  if (!game || game.phase !== 'aim' || view.flying || paused || resultScreenOpen) return;
  const trace = game.createShot(view.aimAngle);
  if (!trace) return;
  unlockAudio();
  view.aiming = false;
  view.aimTrace = null;
  view.flying = { trace, progress: 0 };
  audio.play('shoot');
}

function handlePointerDown(event) {
  if (!game || paused || resultScreenOpen) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const point = canvasPoint(event);

  if (view.boosterMode) {
    const cell = bubbleAtPoint(game.grid, layout, point.x, point.y, 1.08);
    if (cell) applyBoosterAt(cell);
    else ui.toast('Нажмите на шарик');
    return;
  }

  if (nearNextBubble(point)) {
    swapBubbles();
    return;
  }

  if (game.phase !== 'aim' || view.flying) return;
  if (activePointerId !== null) return;
  activePointerId = event.pointerId;
  unlockAudio();
  view.aiming = true;
  view.aimAngle = angleFromPoint(point);
  refreshAim();
}

function handlePointerMove(event) {
  if (!game) return;
  if (view.aiming && activePointerId !== null && event.pointerId !== activePointerId) return;
  const point = canvasPoint(event);
  view.nextHovered = nearNextBubble(point);

  if (view.boosterMode) {
    const cell = bubbleAtPoint(game.grid, layout, point.x, point.y, 1.08);
    view.hoverCell = cell;
    updateCursor(cell ? 'pointer' : 'crosshair');
    return;
  }

  if (view.aiming && !paused) {
    const previous = view.aimAngle;
    const next = angleFromPoint(point);
    if (Math.abs(previous - next) > 0.002) {
      view.aimAngle = next;
      refreshAim();
    }
  }
  updateCursor(view.nextHovered ? 'pointer' : 'crosshair');
}

function updateCursor(value) {
  if (canvas.style.cursor !== value) canvas.style.cursor = value;
}

function handlePointerUp(event) {
  if (!view.aiming || !game) return;
  if (activePointerId !== null && event.pointerId !== activePointerId) return;
  const point = canvasPoint(event);
  view.aiming = false;
  activePointerId = null;
  view.aimAngle = angleFromPoint(point);
  refreshAim();

  // Release below the dashed line cancels; release above it shoots.
  if (point.y >= layout.dangerY) {
    return;
  }
  shoot();
}

canvas.addEventListener('pointerdown', handlePointerDown, { passive: false });
window.addEventListener('pointermove', handlePointerMove, { passive: true });
window.addEventListener('pointerup', handlePointerUp, { passive: true });
window.addEventListener('pointercancel', (event) => {
  if (activePointerId !== null && event.pointerId !== activePointerId) return;
  view.aiming = false;
  activePointerId = null;
});

canvas.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });
document.addEventListener('gesturestart', (event) => event.preventDefault());
document.addEventListener('dblclick', (event) => {
  if (event.target.closest('#game') || event.target.closest('.screen')) event.preventDefault();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (ui.installOpen) {
      ui.closeInstall();
      return;
    }
    if (ui.currentScreen === 'settings') backFromSettings();
    else if (ui.currentScreen === 'shop') backFromShop();
    else if (ui.currentScreen === 'levels') openLevelsBack();
    else if (ui.currentScreen === 'pause') resumeGame();
    else if (ui.currentScreen) returnToMenu();
    else if (game) pauseGame();
    return;
  }
  if (!game || paused || resultScreenOpen || ui.currentScreen) return;
  if (event.key === 'ArrowLeft') {
    view.aimAngle = clampAimAngle(view.aimAngle - 0.07);
    refreshAim();
    event.preventDefault();
  } else if (event.key === 'ArrowRight') {
    view.aimAngle = clampAimAngle(view.aimAngle + 0.07);
    refreshAim();
    event.preventDefault();
  } else if (event.key === ' ' || event.key === 'ArrowUp') {
    event.preventDefault();
    unlockAudio();
    shoot();
  } else if (event.key === 's' || event.key === 'S') {
    swapBubbles();
  }
});

function openLevelsBack() {
  returnToMenu();
}

/* ----------------------------------------------------------------- actions */

function onAction(action, data = {}) {
  switch (action) {
    case 'play':
      // The store build needs the network (ads), so it does not start offline.
      if (window.__STORE__ && !net.online) {
        ui.showOffline();
        net.check().then((ok) => {
          if (ok) ui.hideOffline();
        });
        break;
      }
      unlockAudio();
      startLevel(store.unlocked);
      break;
    case 'levels':
      openLevels();
      break;
    case 'quests':
      openQuests();
      break;
    case 'questsBack':
      returnToMenu();
      break;
    case 'claimDaily':
      claimDaily();
      break;
    case 'claimQuest':
      claimQuest(data.quest);
      break;
    case 'buyBundle':
      buyBundle(data.bundle);
      break;
    case 'cosmetic':
      useCosmetic(data.kind === 'theme' ? 'theme' : 'skin', data.id);
      break;
    case 'continueCoins':
      continueWithCoins();
      break;
    case 'undoShot':
      undoShot();
      break;
    case 'shuffleBoard':
      shuffleBoard();
      break;
    case 'toggleAllWorlds':
      ui.toggleAllWorlds();
      audio.play('click');
      break;
    case 'completeClose':
      returnToMenu();
      break;
    case 'resetProgress':
      store.resetProgress();
      resultScreenOpen = false;
      ui.renderAll();
      ui.setCoins(store.coins);
      ui.toast('Прогресс стёрт — начинаем с первого уровня');
      audio.play('click');
      returnToMenu();
      break;
    case 'levelsBack':
      returnToMenu();
      break;
    case 'shop':
      openShop(ui.currentScreen === 'pause' ? 'game' : 'menu');
      break;
    case 'hudShop':
      if (game && !resultScreenOpen) {
        pauseGame();
        openShop('game');
      } else {
        openShop('menu');
      }
      break;
    case 'shopBack':
      backFromShop();
      break;
    case 'settings':
      openSettings('menu');
      break;
    case 'settingsBack':
      backFromSettings();
      break;
    case 'pauseSettings':
      openSettings('pause');
      break;
    case 'pauseShop':
      openShop('pause');
      break;
    case 'loseShop':
      openShop('lose');
      break;
    case 'install':
      ui.showInstall();
      break;
    case 'installBack':
      ui.closeInstall();
      break;
    case 'resume':
      resumeGame();
      break;
    case 'retry':
      startLevel(currentLevelId);
      break;
    case 'next':
      nextLevel();
      break;
    case 'menu':
      returnToMenu();
      break;
    case 'level':
      startLevel(Number(data.level) || 1);
      break;
    case 'lockedLevel':
      ui.toast('Уровень закрыт — пройдите предыдущие');
      break;
    case 'buy':
      buyBooster(data.booster);
      break;
    case 'buyAd':
      buyBoosterByAd(data.booster);
      break;
    case 'buyCoins':
      buyCoinsByAd();
      break;
    case 'buyCoinsPack':
      buyCoinsPack(data.product);
      break;
    case 'vkBuy':
      buyViaVkPlay(data.product);
      break;
    case 'buyRemoveAds':
      buyRemoveAds();
      break;
    case 'continueAd':
      continueWithAd();
      break;
    case 'reset':
      ui.showConfirm();
      break;
    default:
      break;
  }
}

/* ------------------------------------------------------------------- boot */

document.getElementById('btnPause').addEventListener('click', pauseGame);
document.getElementById('btnSound').addEventListener('click', toggleSound);
document.getElementById('btnMusic').addEventListener('click', toggleMusic);
document.getElementById('toggleSound').addEventListener('click', toggleSound);
document.getElementById('toggleMusic').addEventListener('click', toggleMusic);
document.getElementById('btnCancelBooster').addEventListener('click', () => {
  // The cross only hides the hint bar (it covers the top row). The booster
  // itself stays armed and is cancelled by tapping its button again.
  ui.hideTargetHintOnly();
});
document.getElementById('boosterBar').addEventListener('click', (event) => {
  const button = event.target.closest('[data-booster]');
  if (button) onBoosterClick(button.dataset.booster);
});
document.getElementById('confirmResetYes').addEventListener('click', () => {
  store.resetProgress();
  ui.hideConfirm();
  returnToMenu();
  ui.renderAll();
  ui.toast('Прогресс сброшен', 1800);
});
document.getElementById('confirmResetNo').addEventListener('click', () => {
  ui.hideConfirm();
});

window.addEventListener('resize', queueResize);
window.addEventListener('orientationchange', () => setTimeout(resizeStage, 250));
// The platform resizes the player (fullscreen, wide screen) through the
// container, and the transition can end without a window resize event.
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => queueResize()).observe(stage);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Platform requirement: no sound while the tab is hidden.
    audio.pauseAll();
    if (game && !paused && !resultScreenOpen && !ui.currentScreen) {
      pauseGame();
    }
    platform.flush();
    return;
  }
  if (audio.unlocked) audio.resumeAll();
});

/* PWA ---------------------------------------------------------------- */

async function initServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    ui.setOfflineReady(false);
    return;
  }
  if (!window.isSecureContext) {
    ui.setOfflineReady(false);
    return;
  }
  ui.setOfflineReady(false);
  try {
    const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    const ready = await navigator.serviceWorker.ready;
    ui.setOfflineReady(Boolean(ready.active));
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          ui.toast('Игра обновилась — перезапустите её', 3200);
        }
      });
    });
  } catch (error) {
    console.warn('BubblePop: service worker registration failed.', error);
    ui.setOfflineReady(false);
  }
}

// The PWA build keeps offline caching; the platform build drops it, because a
// cache-first worker would serve moderators a stale build.
if (!platform.enabled && !window.__STORE__ && !window.__VKPLAY__) window.addEventListener('load', initServiceWorker);
window.addEventListener('beforeinstallprompt', (event) => {
  // Safari does not use this, but Chrome/Edge can offer an install prompt.
  event.preventDefault();
  window.__installPrompt = event;
});

startLoop();

/* Platform boot (Pikabu Games) ---------------------------------------- */

async function bootPlatform() {
  if (!platform.enabled) return;
  await platform.init();
  if (!platform.ready) return;

  // Cloud save wins only when it is newer than the local one.
  if (store.hydrate(platform.readSave())) {
    ui.renderAll();
    ui.toast('Прогресс загружен из облака', 2600);
  }
  await refreshAds();
  platform.markStarted();
  console.info('[pikabu] SDK ready, gameStarted() sent.');
}

platform.onConflict = () => {
  ui.toast('Сохранение откроется после перезагрузки игры', 4000);
};

bootPlatform();

// Cosmetics apply from the very first frame.
renderer.setSkin(store.skin.color);
ui.applyTheme();

/* Store build (Google Play): native ads + internet gate ------------------ */

async function bootStoreBuild() {
  if (!window.__STORE__) return;
  await ads.init();
  // Measure the banner strip once at boot: reserving a guessed height later
  // made the whole board jump when the real ad height arrived.
  ads.bannerHeight(bannerWidth());
  await iap.init();
  ads.setRemoveAds(store.hasRemoveAds);
  if (iap.ready) {
    const owned = await iap.restore();
    for (const purchase of owned) {
      if (purchase?.productId === REMOVE_ADS_PRODUCT.id) {
        store.grantPurchase(REMOVE_ADS_PRODUCT.id, purchase.purchaseId || '');
      }
    }
    ads.setRemoveAds(store.hasRemoveAds);
  }
  await refreshAds();
  net.onChange((online) => {
    if (online) {
      ui.hideOffline();
    } else {
      if (game && !resultScreenOpen) pauseGame();
      ui.showOffline();
    }
  });
  net.start();
  const online = await net.check();
  if (!online) ui.showOffline();
}

bootStoreBuild();

/* VK Play: in-game purchases (browser build) ----------------------------- */

async function bootVkPlay() {
  if (window.__VKPLAY__ !== true) return;
  // VK Play rejects projects with ad integrations: drop the rewarded block
  // from the DOM entirely, not just hide it.
  document.getElementById('shopCoinsAd')?.remove();
  await vkplay.init();
  if (!vkplay.available) {
    console.info('[vkplay] payments are not configured — the shop stays hidden.');
    return;
  }
  vkplay.onPaid = (productId) => {
    const pack = COIN_PACKS.find((item) => item.id === productId);
    if (!pack) return;
    store.addCoins(pack.coins);
    unlockAudio();
    audio.play('buy');
    ui.setCoins(store.coins);
    ui.renderShop();
    ui.renderMenu();
    ui.toast(`+${pack.coins} монет`);
  };
  vkplay.onAuth = () => refreshVkPlayShop();
  refreshVkPlayShop();
}

function refreshVkPlayShop() {
  if (window.__VKPLAY__ !== true) return;
  if (!vkplay.available) {
    ui.renderCoinShop({});
    return;
  }
  ui.renderCoinShop({
    packs: COIN_PACKS.map((pack) => ({ id: pack.id, coins: pack.coins, price: pack.price })),
    action: 'vkBuy',
    hasRemoveAds: true,
  });
}

async function buyViaVkPlay(productId) {
  const result = await vkplay.buy(productId);
  if (result.ok) {
    ui.toast('Открываем окно оплаты…');
    return;
  }
  if (result.reason === 'AUTH_REQUIRED') {
    ui.toast('Войдите в аккаунт VK Play');
    return;
  }
  if (result.reason === 'NOT_AVAILABLE') {
    ui.toast('Оплата недоступна');
    return;
  }
  ui.toast('Не удалось открыть оплату');
}

bootVkPlay();

document.getElementById('btnOfflineRetry')?.addEventListener('click', async () => {
  const online = await net.check();
  if (online) ui.hideOffline();
  else ui.toast('Интернет не появился — проверьте соединение', 2400);
});

/* Debug/QA hooks ------------------------------------------------------ */

const debugApi = {
  startLevel,
  aim(angle) {
    if (!game) return;
    view.aimAngle = clampAimAngle(Number(angle));
    refreshAim();
  },
  shoot(angle) {
    if (angle !== undefined) {
      view.aimAngle = clampAimAngle(Number(angle));
      refreshAim();
    }
    shoot();
  },
  swap: swapBubbles,
  onBoosterClick,
  nextBubblePosition: () => renderer.getNextBubblePosition(),
};

if (QA) {
  debugApi.debug = {
    addCoins(amount) {
      store.addCoins(Number(amount) || 0);
      ui.setCoins(store.coins);
      ui.renderAll();
    },
    giveBoosters(amount = 1) {
      for (const id of BOOSTER_ORDER) store.addBooster(id, amount);
      ui.syncBoosters();
      ui.renderShop();
    },
    setShots(value) {
      if (!game) return;
      game.shots = Number(value) || 0;
      game.phase = game.evaluatePhase();
      ui.syncHud(game);
    },
    setCurrent(color) {
      if (!game) return;
      game.current = color;
      ui.syncHud(game);
      refreshAim();
    },
    clearBoard() {
      if (!game) return null;
      const cells = [];
      game.grid.forEachOccupied((color, r, c) => cells.push({ r, c }));
      game.grid.removeCells(cells);
      game.phase = game.evaluatePhase();
      game.stars = 3;
      ui.syncHud(game);
      refreshAim();
      return game.getState();
    },
    winNow() {
      if (!game) return;
      debugApi.debug.clearBoard();
      game.phase = 'won';
      game.stars = 3;
      finishWin();
    },
    loseNow() {
      if (!game) return;
      game.shots = 0;
      game.phase = 'lost';
      game.loseReason = 'shots';
      ui.syncHud(game);
      finishLose();
    },
    instantShot(angle) {
      if (!game) return null;
      view.aimAngle = clampAimAngle(Number(angle));
      const trace = game.createShot(view.aimAngle);
      if (!trace) return null;
      lastShotSnapshot = snapshotGame();
      const result = game.applyShot(trace);
      handleShotResult(result, trace);
      return result;
    },
    state: () => (game ? game.getState() : null),
  };
}

// Kept out of the platform build (unless ?qa) so players cannot tamper with the save.
if (QA || !platform.enabled) window.__bubblePop = {
  ...debugApi,
  get state() {
    return game ? game.getState() : null;
  },
  get layout() {
    return layout;
  },
  get view() {
    return {
      aimAngle: view.aimAngle,
      aiming: view.aiming,
      flying: !!view.flying,
      boosterMode: view.boosterMode,
      aimTrace: view.aimTrace,
    };
  },
  get screen() {
    return ui.currentScreen;
  },
  get save() {
    return JSON.parse(JSON.stringify(store.state));
  },
  /** QA only: the live Game instance, for tests that inspect the grid. */
  get game() {
    return game;
  },
  get paused() {
    return paused;
  },
  get levelId() {
    return currentLevelId;
  },
  ui,
  store,
};
