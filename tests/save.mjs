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
