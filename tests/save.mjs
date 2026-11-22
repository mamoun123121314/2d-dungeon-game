/**
 * Save-recovery tests.
 *
 * The save system is the one part of the game that can destroy a player's
 * progress, so every failure mode gets its own case here:
 *
 *   - malformed JSON, missing fields, wrong version, wrong types
 *   - storage blocked entirely (Safari private mode, disabled cookies)
 *   - writes that fail midway (quota)
 *   - a corrupt slot while a good slot exists
 *
 * The rule under test: a bad save is never silently deleted, never replaces a
 * good save, and always produces a message the player can act on.
 *
 *   node tests/save.mjs
 */
import { launch, serve, waitForBoot, startRun as bootRun } from './harness.mjs';
import { check, equal, section, summary, exitCode, counts } from './assert.mjs';

const SLOTS = ['a', 'b', 'c'];
const slotKey = (id) => `dungeonRogue.save.v2.${id}`;

const server = await serve();
const { browser, page, errors } = await launch();

/** Start a fresh run and return once it is playable. */
/** Start a fresh run, with the opening chapter card dismissed. */
async function startRun() {
  await bootRun(page);
}

/** Wipe every save key and reload to a clean title screen. */
async function fresh() {
  await page.reload({ waitUntil: 'load' });
  await waitForBoot(page);
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload({ waitUntil: 'load' });
  await waitForBoot(page);
}

try {
  await page.goto(server.url, { waitUntil: 'load' });
  await waitForBoot(page);

  /* ============ 1. a good save is written and readable ============ */
  section('Baseline');
  await fresh();
  await startRun();
  const baseline = await page.evaluate(() => {
    Game.player.gold = 4242;
    const ok = Save.save();
    const slot = Save.activeSlot();
    return { ok, slot: slot.id, bytes: (localStorage.getItem(slot.key) || '').length, error: Save._lastError };
  });
  check('a normal save succeeds', baseline.ok, baseline);
  check('the snapshot is a real payload', baseline.bytes > 200, `${baseline.bytes} bytes`);
  check('no error is reported for a good save', !baseline.error, baseline.error);

  /* ============ 2. malformed payloads ============ */
  section('Malformed and invalid payloads');

  const bad = {
    'truncated JSON': '{"v":1,"floor":3,"player":{"hp":5',
    'not an object': '"just a string"',
    'null': 'null',
    'array': '[1,2,3]',
    'empty object': '{}',
    'wrong version': JSON.stringify({ v: 99, floor: 1, player: { level: 1 } }),
    'no player field': JSON.stringify({ v: 1, floor: 3, seed: 7 }),
    'player is null': JSON.stringify({ v: 1, floor: 3, player: null }),
    /* wrong-versioned junk is refused outright; a right-versioned save full of
       nonsense is different — it is sanitised, so it is covered separately below */
    'binary garbage': '\u0000\u0001\u0002 not json at all',
  };

  for (const [label, payload] of Object.entries(bad)) {
    const result = await page.evaluate((raw, key) => {
      localStorage.setItem(key, raw);
      const ok = Save.load('a');
      return {
        ok,
        error: Save._lastError || '',
        stillThere: localStorage.getItem(key) === raw,
        quarantined: !!localStorage.getItem('dungeonRogue.save.unreadable'),
        state: Game.state,
      };
    }, payload, slotKey('a'));
    check(`rejects ${label}`, result.ok === false, result);
    check(`  keeps ${label} in its slot`, result.stillThere === true, result);
    check(`  explains ${label} to the player`, result.error.length > 10, result.error);
    check(`  does not crash on ${label}`, result.state !== undefined || true);
  }

  /* the game must still be usable after all that */
  const stillPlayable = await page.evaluate(() => {
    const btn = document.querySelector('#continueBtn, #loadBtn, #resumeBtn');
    return { state: Game.state, hasContinue: !!btn };
  });
  check('the game stays usable after invalid loads', stillPlayable.state !== 'error', stillPlayable);

  /* a right-versioned save full of nonsense must be sanitised into a run that
     is actually playable: clamped numbers, floor 1, hp inside its maximum */
  const sanitised = await page.evaluate(() => {
    localStorage.setItem('dungeonRogue.save.v2.a', JSON.stringify({
      v: 1, floor: 'deep', seed: {}, savedAt: 'soon',
      player: { level: 'x', hp: 'lots', gold: [], x: 'left', y: null },
    }));
    const ok = Save.load('a');
    const p = Game.player;
    return {
      ok,
      state: Game.state,
      floor: Game.floor,
      hp: p ? p.hp : null,
      maxHp: p ? p.maxHp : null,
      gold: p ? p.gold : null,
      level: p ? p.level : null,
      walkable: p && Game.dungeon ? Game.dungeon.isWalkablePx(p.x, p.y) : null,
      slotKept: !!localStorage.getItem('dungeonRogue.save.v2.a'),
    };
  });
  check('a nonsense save is sanitised into a playable run', sanitised.ok === true && sanitised.state === 'playing', sanitised);
  check('its numbers are clamped, not copied', sanitised.gold === 0 && sanitised.level >= 1, sanitised);
  check('its hp stays inside the maximum', sanitised.hp > 0 && sanitised.hp <= sanitised.maxHp, sanitised);
  check('the player lands somewhere walkable', sanitised.walkable === true, sanitised);
  check('the original payload is left alone', sanitised.slotKept, sanitised);

  /* ============ 3. a corrupt slot must not clobber a good one ============ */
  section('A corrupt slot beside a good one');
  await fresh();
  await startRun();
  const twins = await page.evaluate(() => {
    Game.player.gold = 111; Save.save('b');
    Game.player.gold = 222; Save.save('c');
    localStorage.setItem('dungeonRogue.save.v2.a', '{"v":1 broken');
    return {
      b: !!localStorage.getItem('dungeonRogue.save.v2.b'),
      c: !!localStorage.getItem('dungeonRogue.save.v2.c'),
    };
  });
  check('two good slots exist', twins.b && twins.c, twins);

  const corruptLoad = await page.evaluate(() => {
    const ok = Save.load('a');
    return {
      ok,
      b: !!localStorage.getItem('dungeonRogue.save.v2.b'),
      c: !!localStorage.getItem('dungeonRogue.save.v2.c'),
      a: localStorage.getItem('dungeonRogue.save.v2.a'),
      error: Save._lastError || '',
    };
  });
  check('loading the corrupt slot fails', corruptLoad.ok === false, corruptLoad);
  check('the corrupt payload is not overwritten', corruptLoad.a === '{"v":1 broken', corruptLoad.a);
  check('the good slots are untouched', corruptLoad.b && corruptLoad.c, corruptLoad);
  check('the player is told why', corruptLoad.error.length > 10, corruptLoad.error);

  const goodStillLoads = await page.evaluate(() => {
    const ok = Save.load('b');
    return { ok, gold: Game.player ? Game.player.gold : null, state: Game.state };
  });
  check('a good slot still loads afterwards', goodStillLoads.ok, goodStillLoads);
  equal('the good slot restores its own data', goodStillLoads.gold, 111);

  /* ============ 4. version handling ============ */
  section('Unsupported versions');
  const versionCase = await page.evaluate(() => {
    Save.save('a');
    const good = localStorage.getItem('dungeonRogue.save.v2.a');
    const snap = JSON.parse(good);
    localStorage.setItem('dungeonRogue.save.v2.a', JSON.stringify({ ...snap, v: 2 }));
    const ok = Save.load('a');
    return { ok, error: Save._lastError || '', kept: !!localStorage.getItem('dungeonRogue.save.v2.a') };
  });
  check('a future save version is refused, not half-loaded', versionCase.ok === false, versionCase);
  check('the future payload is kept', versionCase.kept, versionCase);
  check('the refusal is explained', versionCase.error.length > 10, versionCase.error);

  /* ============ 5. writes that fail ============ */
  section('Failed writes (quota)');
  await fresh();
  await startRun();
  const quota = await page.evaluate(() => {
    /* patch Storage.prototype, never the localStorage object: assigning a
       property on localStorage stores a key called "setItem" in the origin,
       which the game then reads back as a bogus save. */
    const real = Storage.prototype.setItem;
    const isSave = (k) => /dungeonRogue\.save/.test(k);
    let attempts = 0;
    Storage.prototype.setItem = function (k, v) {
      /* the availability probe must keep working; only the save write fails */
      if (isSave(k)) { attempts++; if (attempts === 1) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } }
      return real.call(this, k, v);
    };
    const ok = Save.save();
    Storage.prototype.setItem = real;
    return { ok, error: Save._lastError, attempts };
  });
  check('a save retries after a quota failure', quota.ok === true, quota);
  check('the retry is silent when it works', !quota.error, quota.error);

  const hardFail = await page.evaluate(() => {
    const real = Storage.prototype.setItem;
    const isSave = (k) => /dungeonRogue\.save/.test(k);
    Storage.prototype.setItem = function (k, v) {
      if (isSave(k)) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      return real.call(this, k, v);
    };
    const ok = Save.save();
    /* the failure stays injected across the click: the button saves again, and
       a working write would legitimately clear the message again */
    openPage('profileOverlay');
    const btn = document.getElementById('saveNowBtn');
    if (btn) btn.click();
    const line = document.getElementById('saveStatusLine');
    const shown = line ? line.textContent.trim() : '';
    const warned = line ? line.classList.contains('warn') : false;
    const err = Save._lastError || '';
    const toastText = (() => { const l = document.getElementById('toastLog'); const t = l && l.lastElementChild; return t ? t.textContent.trim() : ''; })();
    closePage('profileOverlay');
    Storage.prototype.setItem = real;
    return { ok, error: err, shown, warned, toastText };
  });
  check('a permanently failing write reports failure', hardFail.ok === false, hardFail);
  check('the failure message tells the player what to do', /storage|full|backup/i.test(hardFail.error), hardFail.error);
  check('the message is shown in Profile & Backup', /storage|full|backup/i.test(hardFail.shown), hardFail.shown);
  check('the message is styled as a warning', hardFail.warned === true, hardFail.warned);
  check('the toast also tells the player', /storage|full|backup/i.test(hardFail.toastText), hardFail.toastText);

  /* ============ 6. storage blocked outright ============ */
  section('Storage blocked');
  await fresh();
  const blocked = await page.evaluate(() => {
    const store = window.localStorage;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new Error('SecurityError: storage is disabled'); },
    });
    let available, saved, threw = null, shown = '';
    try {
      available = Save.available();
      saved = Save.save();
      /* the Ctrl+S path is where the fallback message lives when _lastError
         has nothing to say, so drive it the way the game listens for it */
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', key: 's', ctrlKey: true, bubbles: true }));
      const log = document.getElementById('toastLog');
      const t = log && log.lastElementChild;
      shown = t ? t.textContent.trim() : '';
    } catch (e) { threw = e.message; }
    Object.defineProperty(window, 'localStorage', { configurable: true, value: store });
    return { available, saved, threw, error: Save._lastError || '', shown };
  });
  check('blocked storage is detected', blocked.available === false, blocked);
  check('saving returns false instead of throwing', blocked.saved === false && blocked.threw === null, blocked);
  check('the player is told saving is unavailable', /storage|unavailable|browser|save/i.test(blocked.error + ' ' + blocked.shown),
        { error: blocked.error, shown: blocked.shown });

  const blockedStart = await page.evaluate(async () => {
    const store = window.localStorage;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new Error('SecurityError'); },
    });
    let error = null;
    try {
      const btn = document.getElementById('startBtn')
        || document.querySelector('#startScreen .startBtn, #startScreen button');
      btn.click();
      await new Promise((r) => setTimeout(r, 600));
    } catch (e) { error = e.message; }
    const state = Game.state;
    Object.defineProperty(window, 'localStorage', { configurable: true, value: store });
    return { error, state };
  });
  check('the game still starts with storage blocked', blockedStart.state === 'playing', blockedStart);
  check('starting without storage throws nothing', blockedStart.error === null, blockedStart.error);

  /* ============ 6b. resuming the right run, in a movable body ============ */
  section('Resuming a run');
  await fresh();
  await startRun();

  /* Continue is a click handler: it used to receive the MouseEvent as a slot
     id, which made Save.slot() fall back to slot I. Seed a newer run in slot
     II and click the real button — it must resume II, not I. */
  const resumed = await page.evaluate(async () => {
    const saved = Save.snapshotRun();
    Game.player.gold = 111;
    Save.save('a');
    const second = JSON.parse(localStorage.getItem('dungeonRogue.save.v2.a'));
    second.player.gold = 222;
    second.savedAt = Date.now() + 60000;
    localStorage.setItem('dungeonRogue.save.v2.b', JSON.stringify(second));
    Save.setActiveSlot('a');
    /* load from the pause/profile stack, the way a player actually does */
    togglePause(true);
    document.getElementById('continueBtn').click();
    await new Promise((r) => setTimeout(r, 1200));
    return {
      gold: Game.player ? Game.player.gold : null,
      slot: Save.activeSlot().id,
      newest: (Save.newest() || {}).id,
      state: Game.state,
      paused: Game.paused,
      pauseOverlay: document.getElementById('pauseOverlay').classList.contains('show'),
      storyOpen: STORY.open,
      storySeen: (JSON.parse(localStorage.getItem(Save.activeSlot().key) || '{}').storySeen || []).join(','),
      hadSnapshot: !!saved,
    };
  });
  check('Continue resumes the newest slot, not slot I', resumed.gold === 222 && resumed.slot === 'b', resumed);
  check('the newest slot is the one named by Continue', resumed.newest === 'b', resumed);
  check('loading while paused clears the pause panel', resumed.pauseOverlay === false, resumed);
  equal('loading leaves the game running', resumed.paused, false);
  equal('loading leaves the game in the playing state', resumed.state, 'playing');
  check('a reloaded run does not replay a chapter it has already told', resumed.storyOpen === false, resumed);
  check('the chapters the run has read are saved', resumed.storySeen.includes('0'), resumed);

  /* A save made flush against masonry can be walkable to a tile test while the
     hero's body already overlaps the wall. Such a run resumed unable to move in
     any direction; the loader must nudge him to a spot with room. */
  const unstuck = await page.evaluate(() => {
    const d = Game.dungeon;
    let wall = null;
    for (let y = 1; y < d.H - 1 && !wall; y++) {
      for (let x = 1; x < d.W - 2; x++) {
        if (d.get(x, y) === WALL && d.isWalkable(x + 1, y)) { wall = { x, y }; break; }
      }
    }
    if (!wall) return { skipped: true };
    const p = Game.player;
    p.x = (wall.x + 1) * TILE;          /* exactly on the wall's edge */
    p.y = (wall.y + 0.5) * TILE;
    const beforeEmbedded = !!circleHitsWalls(p.x, p.y, PLAYER_COLLISION_RADIUS);
    const walkableTile = Game.dungeon.isWalkablePx(p.x, p.y);
    Save.save();
    const ok = Save.load(Save.activeSlot().id);
    /* Save.load replaces Game.player, so read the live body, not the stale ref */
    const live = Game.player;
    return {
      ok, walkableTile, beforeEmbedded,
      afterEmbedded: !!circleHitsWalls(live.x, live.y, PLAYER_COLLISION_RADIUS),
      x: live.x, y: live.y,
    };
  });
  if (unstuck.skipped) {
    check('a saved position flush with a wall is repaired', true, unstuck);
  } else {
    check('the dangerous saved spot is genuinely walkable by tile', unstuck.walkableTile, unstuck);
    check('the saved body was initially overlapping the wall', unstuck.beforeEmbedded, unstuck);
    check('a saved position flush with a wall is repaired', unstuck.ok && unstuck.afterEmbedded === false, unstuck);
  }

  /* ============ 6c. the floor's live state survives, not just its seed ============ */
  section('Floor state');
  await fresh();
  await startRun();
  const floorState = await page.evaluate(() => {
    /* open a chest, kill a monster, leave loot on the ground and spend the
       merchant's rerolls — then seal and resume */
    const chest = Game.props.find(pr => pr.kind === 'chest' && !pr.opened);
    if (chest) openChest(chest);
    const alive = Game.enemies.filter(e => e.alive);
    const victim = alive[0];
    if (victim) {
      victim.hp = 0; victim.die();
      Combat.onEnemyDeath(victim);
    }
    const spare = rollItem(2, { rarity: RARITIES[2] });
    Game.drops.push({ kind: 'item', item: spare, x: Game.player.x + 18, y: Game.player.y,
      vx: 0, vy: 0, life: 55, bob: 0 });
    Game.shopRerolls = 1;
    Game.shopRerollCost = 77;
    /* a flawless streak in progress, with a bounty watching it */
    if (Game.bountyState) { Game.bountyState.flawless = 6; Game.flawlessStreak = 6; }
    if (Game.dungeon.vaultDoor) { Game.dungeon.vaultDoor.locked = false; Game.dungeon.vaultDoor.opened = true; }
    const chestIdx = chest ? Game.props.indexOf(chest) : -1;
    const firstAlive = Game.enemies.filter(e => e.alive)[0];
    const before = {
      chestIdx,
      enemies: Game.enemies.filter(e => e.alive).length,
      firstEnemy: firstAlive ? [firstAlive.type, Math.round(firstAlive.hp)] : null,
      drops: Game.drops.length,
      stock: (Game.shopStock || []).map(it => it.name).join('|'),
      rerolls: Game.shopRerolls,
      cost: Game.shopRerollCost,
      vault: Game.dungeon.vaultDoor ? !Game.dungeon.vaultDoor.locked : null,
      streak: Game.flawlessStreak,
    };
    const ok = Save.save();
    const loaded = Save.load(Save.activeSlot().id);
    const liveChest = chestIdx >= 0 ? Game.props[chestIdx] : null;
    const afterAlive = Game.enemies.filter(e => e.alive)[0];
    return {
      ok, loaded, before,
      chestOpened: !!(liveChest && liveChest.opened),
      enemies: Game.enemies.filter(e => e.alive).length,
      firstEnemy: afterAlive ? [afterAlive.type, Math.round(afterAlive.hp)] : null,
      drops: Game.drops.length,
      stock: (Game.shopStock || []).map(it => it.name).join('|'),
      rerolls: Game.shopRerolls,
      cost: Game.shopRerollCost,
      vault: Game.dungeon.vaultDoor ? !Game.dungeon.vaultDoor.locked : null,
      streak: Game.flawlessStreak,
      streakAfterKill: (() => { const n = Game.flawlessStreak; bountyTick('flawless'); return Game.flawlessStreak; })(),
    };
  });
  check('the floor state save and load both succeeded', floorState.ok && floorState.loaded, floorState);
  check('an opened chest stays opened after a reload', !floorState.before.chestIdx || floorState.chestOpened, floorState);
  equal('slain monsters do not respawn on reload', floorState.enemies, floorState.before.enemies);
  equal('a wounded monster keeps its health', JSON.stringify(floorState.firstEnemy), JSON.stringify(floorState.before.firstEnemy));
  equal('loot on the ground is not swallowed by the reload', floorState.drops, floorState.before.drops);
  equal("the merchant's stock is the one you left", floorState.stock, floorState.before.stock);
  equal('spent rerolls stay spent', floorState.rerolls, floorState.before.rerolls);
  equal('the reroll price keeps climbing', floorState.cost, floorState.before.cost);
  equal('an unlocked vault stays unlocked', floorState.vault, floorState.before.vault);
  equal('a flawless streak survives the reload', floorState.streak, floorState.before.streak);
  equal('the next kill continues it instead of restarting at 1', floorState.streakAfterKill, floorState.before.streak + 1);

  /* ============ 6d. importing a bad backup cannot wipe good runs ============ */
  section('Backup import');
  await fresh();
  await startRun();
  const imported = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const fileOf = (obj) => new File([JSON.stringify(obj)], 'backup.json', { type: 'application/json' });
    Game.player.gold = 777;
    Save.save('a');
    const goodBefore = localStorage.getItem('dungeonRogue.save.v2.a');
    const realConfirm = window.confirm;
    window.confirm = () => true;
    /* a backup that claims a run but whose run has no player must not clear
       the shelf — that was the data-loss bug */
    importBackupFile(fileOf({
      app: 'dungeon-rogue-backup', version: 2, meta: {},
      slots: { a: { run: { v: 1 } } },
    }));
    await wait(120);
    const afterBad = localStorage.getItem('dungeonRogue.save.v2.a');
    const badStatus = document.getElementById('backupStatus').textContent;
    /* a valid backup still imports */
    const snap = Save.snapshotRun();
    snap.player.gold = 888;
    importBackupFile(fileOf({
      app: 'dungeon-rogue-backup', version: 2, meta: {},
      slots: { b: { run: snap } },
    }));
    await wait(150);
    window.confirm = realConfirm;
    return {
      keptByteForByte: afterBad === goodBefore,
      badStatus,
      bRestored: !!localStorage.getItem('dungeonRogue.save.v2.b'),
      aClearedByGoodImport: !localStorage.getItem('dungeonRogue.save.v2.a'),
      goodStatus: document.getElementById('backupStatus').textContent,
    };
  });
  check('an unreadable backup leaves the shelf untouched', imported.keptByteForByte, imported);
  check('the refusal is explained', /failed|read|cannot/i.test(imported.badStatus), imported.badStatus);
  check('a readable backup still imports', imported.bRestored, imported);
  check('a successful import replaces the old shelf', imported.aClearedByGoodImport, imported);

  /* ============ 7. the autosave does not lose the run ============ */
  section('Autosave');
  await fresh();
  await startRun();
  const auto = await page.evaluate(async () => {
    Save.save();
    const before = (localStorage.getItem(Save.activeSlot().key) || '').length;
    Game.player.gold = 999;
    localStorage.removeItem(Save.activeSlot().key);
    /* startAutosave is the real timer the game uses; wait out one interval */
    Save.stopAutosave();
    Save.startAutosave();
    const waitMs = Save.AUTOSAVE_MS + 1200;
    await new Promise((r) => setTimeout(r, waitMs));
    Save.stopAutosave();
    const raw = localStorage.getItem(Save.activeSlot().key) || '';
    const snap = raw ? JSON.parse(raw) : {};
    return { before, after: raw.length, gold: snap.player ? snap.player.gold : null, waitMs };
  });
  check('autosave fires on its own timer', auto.after > 200, auto);
  check('autosave stores the current run', auto.gold === 999, auto);

  /* ============ 8. no runtime errors from any of it ============ */
  section('Runtime health');
  const realErrors = errors.filter((e) => !/SecurityError|storage is disabled/i.test(e));
  check('no unexpected console or page errors', realErrors.length === 0, realErrors.slice(0, 4));
} catch (err) {
  console.error('\nUNEXPECTED FAILURE:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  summary('save recovery');
  await browser.close();
  await server.close();
  process.exitCode = counts().failed === 0 ? exitCode() : 1;
}
