/**
 * DOM presentation: screens, HUD, level map, shop, settings and toasts.
 * Game logic stays in Game; this module only reflects it.
 */
import { ADS_COIN_PACK, BOOSTER_ORDER, BOOSTERS, BUNDLES, DAILY_REWARDS, ECONOMY, QUESTS, SKINS, THEMES } from './config.js';
import { LEVELS, LEVELS_PER_WORLD, WORLDS } from './levels.js';

const $ = (id) => document.getElementById(id);
const starsMarkup = () => `
  <svg class="icon star"><use href="#i-star"></use></svg>
  <svg class="icon star"><use href="#i-star"></use></svg>
  <svg class="icon star"><use href="#i-star"></use></svg>`;

export class UI {
  constructor({ store, onAction }) {
    this.store = store;
    this.onAction = onAction;
    this.screens = [...document.querySelectorAll('.screen')];
    this.currentScreen = 'menu';
    this.backTarget = 'menu';
    this.installOpen = false;
    this.toastTimer = 0;
    this.levelNameTimer = 0;
    /** Rewarded ad button is shown only when the platform reports it usable. */
    this.adsAvailable = false;
    this.adsBusy = false;
    this.coinsAdAvailable = false;
    this.coinsAdBusy = false;
    /** Level map: show only ten worlds unless the player expands it. */
    this.showAllWorlds = false;

    this.el = {
      gameUi: $('gameUi'),
      hudLevel: $('hudLevel'),
      hudCoins: $('hudCoins'),
      hudCoinChip: $('hudCoinChip'),
      dockShots: $('dockShots'),
      shotsPill: $('shotsPill'),
      progressFill: $('progressFill'),
      boosterBar: $('boosterBar'),
      hudSound: $('btnSound'),
      hudMusic: $('btnMusic'),
      stageLevelName: $('stageLevelName'),
      targetHint: $('targetHint'),
      targetHintText: $('targetHintText'),
      cancelBooster: $('btnCancelBooster'),
      toast: $('toast'),
      levelGrid: $('levelGrid'),
      completeStars: $('completeStars'),
      completeCoins: $('completeCoins'),
      levelsProgressFill: $('levelsProgressFill'),
      levelsProgressText: $('levelsProgressText'),
      shopList: $('shopList'),
      bundleRow: $('bundleRow'),
      themeRow: $('themeRow'),
      skinRow: $('skinRow'),
      questsBadge: $('questsBadge'),
      questDailySub: $('questDailySub'),
      questList: $('questList'),
      btnClaimDaily: $('btnClaimDaily'),
      btnContinueCoins: $('btnContinueCoins'),
      continueCost: $('continueCost'),
      menuStars: $('menuStars'),
      menuStarsWrap: $('menuStarsWrap'),
      menuStarsDot: $('menuStarsDot'),
      playSub: $('playSub'),
      installHint: $('installHint'),
      installScreen: document.querySelector('[data-screen="install"]'),
      winStars: $('winStars'),
      winScore: $('winScore'),
      winCoins: $('winCoins'),
      winShots: $('winShots'),
      btnNextLevel: $('btnNextLevel'),
      loseTitle: $('loseTitle'),
      loseText: $('loseText'),
      loseScore: $('loseScore'),
      loseCoins: $('loseCoins'),
      loseLeft: $('loseLeft'),
      pauseShots: $('pauseShots'),
      toggleSound: $('toggleSound'),
      toggleMusic: $('toggleMusic'),
      confirmReset: $('confirmReset'),
      offlineStatus: $('offlineStatus'),
      offlineGate: $('offlineGate'),
      btnOfflineRetry: $('btnOfflineRetry'),
      shopCoinsAd: $('shopCoinsAd'),
      coinsShop: $('coinsShop'),
      coinsRow: $('coinsRow'),
      btnRemoveAds: $('btnRemoveAds'),
      adBanner: $('adBanner'),
      gameBanner: $('gameBanner'),
      btnContinueAd: $('btnContinueAd'),
    };

    this.bind();
    this.renderAll();
    this.applySettings();
    this.updateInstallHint();
    this.showScreen('menu');
  }

  bind() {
    document.addEventListener('click', (event) => {
      if (event.target.closest('#installHintClose')) {
        event.preventDefault();
        event.stopPropagation();
        this.dismissInstallHint();
        return;
      }
      const actionEl = event.target.closest('[data-action]');
      if (!actionEl) return;
      event.preventDefault();
      this.onAction(actionEl.dataset.action, { ...actionEl.dataset }, actionEl);
    });

    document.addEventListener('contextmenu', (event) => {
      if (event.target.closest('#game') || event.target.closest('.screen')) {
        event.preventDefault();
      }
    });

    // Keep the game surface from being zoomed by a double tap on iOS.
    let lastTouch = 0;
    document.addEventListener(
      'touchend',
      (event) => {
        const now = Date.now();
        if (now - lastTouch < 280 && event.target.closest('#game')) event.preventDefault();
        lastTouch = now;
      },
      { passive: false },
    );

    window.addEventListener('resize', () => this.updateInstallHint());
  }

  /* ------------------------------------------------------------- screens */

  showScreen(name) {
    this.currentScreen = name;
    for (const screen of this.screens) {
      screen.classList.toggle('is-active', screen.dataset.screen === name);
    }
    this.installOpen = false;
    this.el.installScreen?.classList.remove('is-active');
    this.hideConfirm();
    document.body.dataset.screen = name || 'game';
    document.body.classList.toggle('mode-menu', ['menu', 'levels', 'shop', 'settings'].includes(name));
  }

  showInstall() {
    if (!this.el.installScreen) return;
    this.installOpen = true;
    this.el.installScreen.classList.add('is-active');
    document.body.dataset.screen = 'install';
  }

  closeInstall() {
    this.installOpen = false;
    this.el.installScreen?.classList.remove('is-active');
    document.body.dataset.screen = this.currentScreen || 'menu';
  }

  hideConfirm() {
    this.el.confirmReset.hidden = true;
  }

  showConfirm() {
    this.el.confirmReset.hidden = false;
  }

  isMetaScreen() {
    return ['menu', 'levels', 'shop', 'settings'].includes(this.currentScreen);
  }

  /* --------------------------------------------------------------- toast */

  toast(text, duration = 2000) {
    clearTimeout(this.toastTimer);
    this.el.toast.textContent = text;
    this.el.toast.classList.add('is-show');
    this.toastTimer = setTimeout(() => this.el.toast.classList.remove('is-show'), duration);
  }

  flashLevelName(name) {
    clearTimeout(this.levelNameTimer);
    this.el.stageLevelName.textContent = name;
    this.el.stageLevelName.classList.add('is-show');
    this.levelNameTimer = setTimeout(() => {
      this.el.stageLevelName.classList.remove('is-show');
    }, 1900);
  }

  /* --------------------------------------------------------------- coins */

  setCoins(value, { bump = true } = {}) {
    const text = Number(value).toLocaleString('ru-RU');
    this.el.hudCoins.textContent = text;
    document.querySelectorAll('.js-coins').forEach((node) => {
      node.textContent = text;
    });
    if (bump) {
      this.el.hudCoinChip.classList.remove('is-bump');
      // restart the CSS animation
      void this.el.hudCoinChip.offsetWidth;
      this.el.hudCoinChip.classList.add('is-bump');
    }
    this.updateQuestBadge();
  }

  /* ---------------------------------------------------------------- menu */

  renderAll() {
    this.setCoins(this.store.coins, { bump: false });
    this.renderMenu();
    this.renderLevels();
    this.renderShop();
    this.renderQuests();
    this.applyTheme();
    this.applySettings();
  }

  /* --------------------------------------------------------- cosmetics */

  /** Paints the chosen field theme through a CSS variable. */
  applyTheme() {
    const theme = this.store.theme;
    document.documentElement.style.setProperty('--stage-bg', theme.bg);
    document.documentElement.style.setProperty('--stage-accent', theme.accent);
  }

  /* ------------------------------------------------------------ quests */

  updateQuestBadge() {
    if (!this.el.questsBadge) return;
    let ready = 0;
    if (this.store.dailyRewardIndex() !== null) ready += 1;
    for (const quest of QUESTS) {
      if (!this.store.questClaimed(quest.id) && this.store.questProgressOf(quest) >= quest.target) {
        ready += 1;
      }
    }
    this.el.questsBadge.hidden = ready === 0;
    this.el.questsBadge.textContent = String(ready);
  }

  renderQuests() {
    if (!this.el.questList) return;
    const index = this.store.dailyRewardIndex();
    const streak = this.store.dailyStreak();
    const reward = index === null ? DAILY_REWARDS[Math.min(streak, DAILY_REWARDS.length - 1)] : DAILY_REWARDS[index];
    const dayLabel = index === null ? 'получено сегодня' : `день ${(streak % DAILY_REWARDS.length) + 1} · +${reward} монет`;
    this.el.questDailySub.textContent = index === null ? `Серия: ${streak} дн. · приходите завтра` : dayLabel;
    if (this.el.btnClaimDaily) {
      this.el.btnClaimDaily.disabled = index === null;
      this.el.btnClaimDaily.textContent = index === null ? 'Получено' : 'Забрать';
    }

    this.el.questList.innerHTML = QUESTS.map((quest) => {
      const progress = Math.min(quest.target, this.store.questProgressOf(quest));
      const claimed = this.store.questClaimed(quest.id);
      const done = progress >= quest.target;
      const percent = Math.round((progress / quest.target) * 100);
      const button = claimed
        ? '<span class="quest__done">Получено</span>'
        : `<button class="btn btn--gold btn--sm" data-action="claimQuest" data-quest="${quest.id}" type="button" ${done ? '' : 'disabled'}>+${quest.reward}</button>`;
      return `
        <article class="quest${done ? ' is-done' : ''}${claimed ? ' is-claimed' : ''}">
          <div class="quest__head"><b>${quest.title}</b><small>${progress} из ${quest.target}</small></div>
          <div class="quest__bar"><i style="width:${percent}%"></i></div>
          ${button}
        </article>`;
    }).join('');

    this.updateQuestBadge();
  }

  /* --------------------------------------------------------- shop extras */

  renderShopExtras() {
    if (this.el.bundleRow) {
      this.el.bundleRow.innerHTML = BUNDLES.map((bundle) => {
        const booster = BOOSTERS[bundle.booster];
        const full = booster.price * bundle.count;
        const save = full - bundle.price;
        return `
          <button class="bundle" data-action="buyBundle" data-bundle="${bundle.id}" type="button">
            <span class="bundle__icon"><svg class="icon"><use href="#i-${bundle.booster === 'lightning' ? 'lightning' : bundle.booster}"></use></svg></span>
            <span class="bundle__text"><b>${bundle.count} × ${booster.name}</b><small>выгода ${save} монет</small></span>
            <span class="bundle__price"><svg class="icon"><use href="#i-coin"></use></svg>${bundle.price}</span>
          </button>`;
      }).join('');
    }

    const cosmeticRow = (row, list, kind) => {
      if (!row) return;
      row.innerHTML = list.map((item) => {
        const owned = this.store.ownsCosmetic(kind, item.id);
        const active = kind === 'theme'
          ? this.store.state.cosmetics.theme === item.id
          : this.store.state.cosmetics.skin === item.id;
        const label = active ? 'Выбрано' : owned ? 'Выбрать' : `${item.price}`;
        return `
          <button class="cosmetic${active ? ' is-active' : ''}${owned ? ' is-owned' : ''}"
            data-action="cosmetic" data-kind="${kind}" data-id="${item.id}" type="button"
            ${kind === 'theme' ? `style="--swatch:${item.bg}"` : `style="--swatch:${item.color}"`}>
            <span class="cosmetic__swatch"></span>
            <b>${item.name}</b>
            <small>${label}${active || owned ? '' : ' монет'}</small>
          </button>`;
      }).join('');
    };
    cosmeticRow(this.el.themeRow, THEMES, 'theme');
    cosmeticRow(this.el.skinRow, SKINS, 'skin');
  }

  setContinueCoinsVisible(visible) {
    if (!this.el.btnContinueCoins) return;
    this.el.btnContinueCoins.hidden = !visible;
    if (this.el.continueCost) this.el.continueCost.textContent = String(ECONOMY.continueCost);
  }

  renderMenu() {
    let stars = 0;
    let completed = 0;
    for (const level of LEVELS) {
      const rec = this.store.getLevelRecord(level.id);
      stars += rec.stars;
      if (rec.stars > 0) completed += 1;
    }
    this.el.menuStars.textContent = String(stars);
    this.el.menuStarsWrap.hidden = stars === 0;
    this.el.menuStarsDot.hidden = stars === 0;
    const unlocked = this.store.unlocked;
    const allDone = completed >= LEVELS.length;
    const label = allDone
      ? 'Все уровни пройдены'
      : unlocked <= 1 && stars === 0
        ? 'Начать игру'
        : `Продолжить · уровень ${unlocked}`;
    this.el.playSub.textContent = label;
  }

  renderLevels() {
    const currentLevel = Math.min(LEVELS.length, this.store.unlocked);
    const currentWorld = Math.floor((currentLevel - 1) / LEVELS_PER_WORLD);
    // The map shows a window of ten worlds: the player's current block plus the
    // next one as a dimmed teaser. Older worlds stay reachable through the
    // "show all" toggle.
    const VISIBLE_WORLDS = 10;
    const firstWorld = this.showAllWorlds
      ? 0
      : Math.max(0, currentWorld - (VISIBLE_WORLDS - 1));
    const lastWorld = this.showAllWorlds
      ? WORLDS.length - 1
      : Math.min(WORLDS.length - 1, currentWorld + 1);
    const worlds = [];
    let completed = 0;

    for (let w = 0; w < WORLDS.length; w += 1) {
      const start = w * LEVELS_PER_WORLD + 1;
      if (start > LEVELS.length) break;
      const end = Math.min(LEVELS.length, start + LEVELS_PER_WORLD - 1);
      let worldDone = 0;
      let worldStars = 0;
      const tiles = [];

      for (let id = start; id <= end; id += 1) {
        const rec = this.store.getLevelRecord(id);
        if (rec.stars > 0) {
          worldDone += 1;
          completed += 1;
        }
        worldStars += rec.stars;
      }
      this.worldProgress = this.worldProgress || [];
      this.worldProgress[w] = { done: worldDone, stars: worldStars, total: end - start + 1 };

      if (w < firstWorld || w > lastWorld) continue;

      const world = WORLDS[w];
      const isPreview = w > currentWorld;
      for (let id = start; id <= end; id += 1) {
        const level = LEVELS[id - 1];
        const unlocked = id <= this.store.unlocked;
        const rec = this.store.getLevelRecord(id);
        const classes = ['level-tile'];
        if (!unlocked) classes.push('is-locked');
        if (rec.stars > 0) classes.push('is-done');
        if (id === currentLevel && unlocked) classes.push('is-current');
        tiles.push(`
          <button class="${classes.join(' ')}" type="button"
            style="--tile-glow:${world.glow};--tile-tint:${world.tint}"
            data-action="${unlocked ? 'level' : 'lockedLevel'}" data-level="${id}"
            ${unlocked ? '' : 'aria-disabled="true"'}
            aria-label="Уровень ${id}. ${level.name}. ${rec.stars} из 3 звёзд${unlocked ? '' : '. Закрыт'}">
            ${unlocked ? '' : '<svg class="icon lock-chip"><use href="#i-lock"></use></svg>'}
            <b>${id}</b>
            ${rec.stars > 0 ? `<div class="stars" data-stars="${rec.stars}" aria-hidden="true">${starsMarkup()}</div>` : ''}
            <small>${unlocked ? (rec.stars > 0 ? 'пройден' : 'играть') : 'закрыт'}</small>
          </button>`);
      }

      const worldUnlocked = start <= this.store.unlocked;
      const isCurrentWorld = currentLevel >= start && currentLevel <= end;
      const previewTiles = Array.from({ length: end - start + 1 }, () => '<span class="level-tile level-tile--dim" aria-hidden="true">?</span>').join('');
      worlds.push(`
        <section class="level-world${worldUnlocked ? '' : ' is-locked'}${isCurrentWorld ? ' is-current' : ''}${isPreview ? ' is-preview' : ''}"
          style="--world-tint:${world.tint};--world-glow:${world.glow}">
          <header class="level-world__head">
            <span class="level-world__emoji" aria-hidden="true">
              <svg class="icon"><use href="#${world.icon}"></use></svg>
            </span>
            <div class="level-world__title">
              <h3>${world.name}</h3>
              <small>${isPreview ? 'откроется после текущего мира' : `${worldDone} из ${end - start + 1} · ★ ${worldStars}`}</small>
            </div>
            ${worldUnlocked && !isPreview ? '' : '<span class="level-world__lock"><svg class="icon"><use href="#i-lock"></use></svg></span>'}
          </header>
          <div class="level-world__grid">${isPreview ? previewTiles : tiles.join('')}</div>
        </section>`);
    }

    const moreLabel = this.showAllWorlds ? 'Свернуть до 10 миров' : 'Показать все миры';
    const more = WORLDS.length > VISIBLE_WORLDS
      ? `<button class="level-more" type="button" data-action="toggleAllWorlds">${moreLabel}</button>`
      : '';
    this.el.levelGrid.innerHTML = `${more}${worlds.join('')}`;
    const percent = Math.round((completed / LEVELS.length) * 100);
    this.el.levelsProgressFill.style.width = `${percent}%`;
    this.el.levelsProgressText.textContent = `${completed} из ${LEVELS.length} уровней`;

    // Open the map at the first uncompleted level once the screen is visible.
    requestAnimationFrame(() => this.scrollLevelsToCurrent());
  }

  scrollLevelsToCurrent() {
    const grid = this.el.levelGrid;
    if (!grid || !grid.clientHeight) return;
    const current = grid.querySelector('.level-tile.is-current');
    if (!current) {
      grid.scrollTop = 0;
      return;
    }
    const gridRect = grid.getBoundingClientRect();
    const tileRect = current.getBoundingClientRect();
    grid.scrollTop += tileRect.top - gridRect.top - (gridRect.height - tileRect.height) / 2;
  }

  toggleAllWorlds() {
    this.showAllWorlds = !this.showAllWorlds;
    this.renderLevels();
  }

  renderShop() {
    const ads = this.adsAvailable;
    const items = BOOSTER_ORDER.map((id) => {
      const booster = BOOSTERS[id];
      const owned = this.store.boosterCount(id);
      const affordable = this.store.coins >= booster.price;
      const busy = this.adsBusy ? 'disabled' : '';
      const adButton = ads
        ? `<button class="shop-ad" type="button" data-action="buyAd" data-booster="${id}"
             aria-label="Получить «${booster.name}» за просмотр рекламы" ${busy}>
             <svg class="icon"><use href="#i-play"></use></svg><span>реклама<br><b>+1</b></span>
           </button>`
        : '';
      return `
        <article class="shop-item">
          <div class="shop-item__icon" style="color:${booster.color}">
            <svg class="icon"><use href="#i-${id}"></use></svg>
          </div>
          <div class="shop-item__body">
            <b>${booster.name}${owned ? `<em>${owned} шт.</em>` : ''}</b>
            <p>${booster.desc}</p>
          </div>
          <div class="shop-item__actions">
            <button class="shop-buy" type="button" data-action="buy" data-booster="${id}"
              aria-label="Купить ${booster.name} за ${booster.price} монет"
              ${affordable && !this.adsBusy ? '' : 'disabled'}>
              <svg class="icon"><use href="#i-coin"></use></svg>${booster.price}
            </button>
            ${adButton}
          </div>
        </article>`;
    });
    this.el.shopList.innerHTML = items.join('');
    this.renderShopExtras();
  }

  /** Called by the controller when the platform reports ad availability. */
  setAdsAvailable(value) {
    const next = Boolean(value);
    if (next === this.adsAvailable) return;
    this.adsAvailable = next;
    if (this.currentScreen === 'shop') this.renderShop();
  }

  /** "+N монет за рекламу" row in the shop (store builds only). */
  setCoinsAdAvailable(value) {
    this.coinsAdAvailable = Boolean(value);
    const amount = $('shopCoinsAdAmount');
    if (amount) amount.textContent = `+${ADS_COIN_PACK} монет`;
    if (this.el.shopCoinsAd) this.el.shopCoinsAd.hidden = !this.coinsAdAvailable;
  }

  setCoinsAdBusy(value) {
    if (!this.el.shopCoinsAd) return;
    this.el.shopCoinsAd.disabled = Boolean(value);
  }

  showOffline() {
    if (!this.el.offlineGate) return;
    this.el.offlineGate.hidden = false;
  }

  hideOffline() {
    if (!this.el.offlineGate) return;
    this.el.offlineGate.hidden = true;
  }

  /* ----------------------------------------------------------- coin shop */

  /** Coin packs and the "remove ads" product, prices from the store bridge. */
  renderCoinShop({ packs = [], hasRemoveAds = false, removeAdsPrice = '', action = 'buyCoinsPack' } = {}) {
    if (!this.el.coinsRow || !this.el.coinsShop) return;
    this.el.coinsShop.hidden = packs.length === 0;
    this.el.coinsRow.innerHTML = packs
      .map(
        (pack) => `<button class="coin-pack" type="button" data-action="${action}" data-product="${pack.id}">
          <b>${pack.coins} шт</b><small>${pack.price}</small>
        </button>`,
      )
      .join('');
    const showRemove = !hasRemoveAds && Boolean(removeAdsPrice);
    this.el.btnRemoveAds.hidden = !showRemove;
    this.el.btnRemoveAds.textContent = showRemove ? `Убрать рекламу · ${removeAdsPrice}` : '';
    this.el.btnRemoveAds.dataset.action = 'buyRemoveAds';
  }

  setBannerSlot(visible) {
    if (!this.el.adBanner) return;
    this.el.adBanner.hidden = !visible;
  }

  bannerRect() {
    if (!this.el.adBanner) return null;
    const rect = this.el.adBanner.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  }

  /** Reserves bottom space for the native banner strip (exact ad height). */
  setBannerReserved(visible, height = 58) {
    document.body.classList.toggle('has-banner', Boolean(visible));
    document.documentElement.style.setProperty('--banner-h', `${Math.round(height)}px`);
  }

  /** Reserved slot under the board; the native banner sits exactly here. */
  setGameBannerSlot(visible) {
    if (!this.el.gameBanner) return;
    this.el.gameBanner.hidden = !visible;
  }

  gameBannerRect() {
    if (!this.el.gameBanner || this.el.gameBanner.hidden) return null;
    const rect = this.el.gameBanner.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  }

  setContinueAdVisible(visible) {
    if (!this.el.btnContinueAd) return;
    this.el.btnContinueAd.hidden = !visible;
    this.el.btnContinueAd.disabled = false;
  }

  setAdsBusy(value) {
    this.adsBusy = Boolean(value);
    if (this.currentScreen === 'shop') this.renderShop();
  }

  /* ----------------------------------------------------------------- hud */

  syncHud(game) {
    if (!game) return;
    const level = game.level;
    this.el.hudLevel.textContent = String(level.id);
    this.el.dockShots.textContent = String(game.shots);
    this.el.shotsPill.classList.toggle('is-low', game.shots <= 5);
    this.el.shotsPill.setAttribute('aria-label', `Осталось ходов: ${game.shots}`);
    const progress = game.startBubbles
      ? Math.round((1 - game.grid.count() / game.startBubbles) * 100)
      : 100;
    this.el.progressFill.style.width = `${Math.max(0, Math.min(100, progress))}%`;
    this.setCoins(this.store.coins, { bump: false });
    this.syncBoosters();
  }

  syncBoosters() {
    for (const id of BOOSTER_ORDER) {
      const button = this.el.boosterBar.querySelector(`[data-booster="${id}"]`);
      if (!button) continue;
      const count = this.store.boosterCount(id);
      const badge = button.querySelector('.booster__count');
      if (badge) {
        badge.classList.toggle('is-cart', count <= 0);
        if (count <= 0) {
          badge.innerHTML = '<svg class="icon"><use href="#i-shop"></use></svg><b>+</b>';
        } else {
          badge.textContent = String(count);
        }
      }
      button.classList.toggle('is-empty', count <= 0);
      button.disabled = false;
      button.setAttribute(
        'aria-label',
        count <= 0
          ? `${BOOSTERS[id].name}: нет в наличии. Открыть магазин.`
          : `${BOOSTERS[id].name}. В наличии: ${count}. ${BOOSTERS[id].desc}`,
      );
    }
  }

  setBoosterActive(type) {
    this.el.boosterBar.querySelectorAll('.booster').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.booster === type);
    });
  }

  showTargetHint(type) {
    const hints = {
      bomb: 'Выберите шарик для взрыва',
      lightning: 'Выберите цвет — молния уберёт его весь',
      rocket: 'Выберите шарик — ракета сожжёт столбец',
    };
    this.el.targetHintText.textContent = hints[type] || 'Выберите шарик';
    this.el.targetHint.hidden = false;
    this.setBoosterActive(type);
  }

  hideTargetHint() {
    this.el.targetHint.hidden = true;
    this.setBoosterActive(null);
  }

  /** Hides the hint bar but keeps the booster armed (its cross button). */
  hideTargetHintOnly() {
    this.el.targetHint.hidden = true;
  }

  /* ------------------------------------------------------------- results */

  showWin({ game, stars, coins, nextExists }) {
    this.syncHud(game);
    this.renderMenu();
    this.renderLevels();
    this.el.winStars.dataset.stars = '0';
    this.el.winScore.textContent = String(game.score);
    this.el.winCoins.textContent = `+${coins}`;
    this.el.winShots.textContent = String(game.shots);
    this.el.btnNextLevel.textContent = nextExists ? 'Далее' : 'К уровням';
    this.showScreen('win');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.el.winStars.dataset.stars = String(stars);
      });
    });
  }

  /** The very last level is cleared: a separate celebration, not the win card. */
  showComplete({ stars, coins }) {
    this.renderMenu();
    this.renderLevels();
    this.el.completeStars.textContent = `${stars}`;
    this.el.completeCoins.textContent = `${coins}`;
    this.showScreen('complete');
  }

  showLose({ game, reason, coins = 0 }) {
    this.syncHud(game);
    const overflow = reason === 'overflow';
    this.el.loseTitle.textContent = overflow ? 'Поле переполнено' : 'Ходы закончились';
    this.el.loseText.textContent = overflow
      ? 'Шарики коснулись нижней границы. Попробуйте другой маршрут — или возьмите бустер.'
      : 'Шарики остались на поле. Попробуйте ещё раз — или возьмите бустер.';
    this.el.loseScore.textContent = String(game.score);
    this.el.loseCoins.textContent = `+${coins}`;
    this.el.loseLeft.textContent = String(game.grid.count());
    this.showScreen('lose');
  }

  showPause(game) {
    if (game) {
      this.el.pauseShots.textContent = String(game.shots);
      this.syncHud(game);
    }
    this.showScreen('pause');
  }

  /* ------------------------------------------------------------ settings */

  applySettings() {
    const { sound, music } = this.store.settings;
    this.el.toggleSound.setAttribute('aria-checked', String(sound));
    this.el.toggleMusic.setAttribute('aria-checked', String(music));
    this.setIcon(this.el.hudSound, sound ? '#i-sound' : '#i-sound-off');
    this.setIcon(this.el.hudMusic, music ? '#i-music' : '#i-music-off');
    this.el.hudSound.classList.toggle('is-off', !sound);
    this.el.hudMusic.classList.toggle('is-off', !music);
  }

  setIcon(button, href) {
    const use = button.querySelector('use');
    if (use) use.setAttribute('href', href);
  }

  setOfflineReady(ready) {
    const node = this.el.offlineStatus;
    if (!node) return;
    node.innerHTML = ready ? '<i></i> офлайн' : '<i></i> кэш';
    node.style.opacity = ready ? '1' : '0.55';
  }

  updateInstallHint() {
    if (!this.el.installHint) return;
    const standalone =
      window.navigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches;
    this.el.installHint.hidden = standalone || this.store.settings.hintDismissed;
  }

  dismissInstallHint() {
    this.store.setSettings({ hintDismissed: true });
    if (this.el.installHint) this.el.installHint.hidden = true;
  }

  /* -------------------------------------------------------------- helpers */

  boosterButton(id) {
    return this.el.boosterBar.querySelector(`[data-booster="${id}"]`);
  }

  setNextLevelLabel(text) {
    this.el.btnNextLevel.textContent = text;
  }
}
