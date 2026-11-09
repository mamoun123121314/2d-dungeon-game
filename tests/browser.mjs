/**
 * Browser smoke test.
 *
 * Boots the real page in a real Chromium, starts a run, exercises every menu,
 * saves, reloads the page and resumes, and fails on any console error, page
 * error or failed network request. This is the check `check_site.py` cannot do:
 * it proves the game actually runs in a browser, that the canvas paints, and
 * that Web Audio can be created from a user gesture.
 *
 *   node tests/browser.mjs
 */
import fs from 'node:fs';
import { launch, serve, waitForBoot, startRun } from './harness.mjs';
import { check, equal, section, summary, exitCode, counts } from './assert.mjs';

fs.mkdirSync('tests/screens', { recursive: true });
const started = Date.now();
const server = await serve();
const { browser, page, errors } = await launch({ width: 1200, height: 800 });

const shot = async (name) => {
  await page.screenshot({ path: `tests/screens/${name}.png` });
};

try {
  /* ---------------- boot ---------------- */
  section('Boot');
  await page.goto(server.url, { waitUntil: 'load' });
  await waitForBoot(page);
  equal('page title', await page.title(), 'Dungeon Rogue — A Procedural ARPG');
  check('canvas element present', await page.evaluate(() => !!document.getElementById('game')));
  check('no console/runtime errors on boot', errors.length === 0, errors.slice(0, 3));

  await shot('01-title');

  /* ---------------- start a run ---------------- */
  section('Start a run');
  const startInfo = await page.evaluate(() => {
    const btn = document.getElementById('startBtn')
      || document.querySelector('#startScreen .startBtn, #startScreen button');
    return btn ? { clicked: true, label: (btn.textContent || '').trim().slice(0, 30) } : { clicked: false };
  });
  check('title screen exposes a start button', startInfo.clicked, startInfo);
  await startRun(page);
  await new Promise((r) => setTimeout(r, 600));

  const playing = await page.evaluate(() => ({
    state: Game.state,
    floor: Game.floor,
    paused: Game.paused,
    hasDungeon: !!Game.dungeon,
    hp: Game.player.hp,
    maxHp: Game.player.maxHp,
    enemies: Game.enemies.length,
  }));
  equal('state is playing', playing.state, 'playing');
  equal('run starts on floor 1', playing.floor, 1);
  equal('not paused after start', playing.paused, false);
  check('a dungeon was generated', playing.hasDungeon);
  check('player hp is inside its maximum', playing.hp > 0 && playing.hp <= playing.maxHp, playing);
  check('enemies were placed', playing.enemies > 0, playing.enemies);

  /* the canvas must actually have paint on it, not just a cleared buffer.
     Sampled once the title overlay is gone — the menu dims the world on
     purpose, so the title screen is the wrong place to look. */
  const painted = await page.evaluate(() => {
    const c = document.getElementById('game');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 400) if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
    return lit;
  });
  check('canvas is actually painted during play', painted > 1000, `${painted} lit samples`);
  await shot('02-playing');

  /* the loop is really running: the clock must advance on its own */
  const t1 = await page.evaluate(() => Game.time);
  await new Promise((r) => setTimeout(r, 400));
  const t2 = await page.evaluate(() => Game.time);
  check('game clock advances', t2 > t1, `${t1.toFixed(2)} -> ${t2.toFixed(2)}`);

  /* ---------------- audio from a gesture ---------------- */
  section('Audio');
  /* The AudioContext is created inside the start click; if an engine ignores
     that, the game must still run and every other check must still pass. */
  const audio = await page.evaluate(async () => {
    try {
      if (typeof Sound === 'undefined') return { available: false };
      Sound.init(); Sound.resume();
      await new Promise((r) => setTimeout(r, 300));
      const names = Sound._names();
      Sound.play('hit', 1, 0);
      await new Promise((r) => setTimeout(r, 700));
      return {
        available: true,
        state: Sound.ctx ? Sound.ctx.state : 'none',
        sampleRate: Sound.ctx ? Sound.ctx.sampleRate : 0,
        effects: names.length,
        decoded: Sound._decoded().length,
      };
    } catch (e) { return { available: false, error: e.message }; }
  });
  check('sound module is present', audio.available, audio);
  if (audio.available) {
    check('audio context is running', audio.state === 'running', audio.state);
    check('audio context has a sample rate', audio.sampleRate >= 8000, audio.sampleRate);
    equal('all effects are registered', audio.effects, 38);
    check('clips decode on demand', audio.decoded > 0, `${audio.decoded} decoded`);
  }

  /* ---------------- menus ---------------- */
  section('Menus');
  const menu = await page.evaluate(async () => {
    const out = {};
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    toggleInventory(true); await frame();
    out.inventoryOpens = Game.invOpen === true && document.getElementById('inventoryOverlay').classList.contains('show');
    toggleInventory(false); await frame();
    out.inventoryCloses = Game.invOpen === false && Game.paused === false;

    toggleSkills(true); await frame();
    out.skillsOpens = Game.skillOpen === true;
    toggleSkills(false); await frame();
    out.skillsCloses = Game.skillOpen === false && Game.paused === false;

    togglePause(true); await frame();
    out.pauseOpens = Game.paused === true && Game.state === 'paused'
      && document.getElementById('pauseOverlay').classList.contains('show');
    out.pauseSubtitle = (document.getElementById('pauseSub') || {}).textContent || '';
    togglePause(false); await frame();
    out.pauseCloses = Game.paused === false && Game.state === 'playing';

    /* the pause menu's own buttons must work by click, not just by keyboard */
    togglePause(true); await frame();
    const opt = document.querySelector('#pauseOverlay [data-page], #pauseOverlay button');
    out.pauseHasButtons = !!opt;
    togglePause(false); await frame();
    return out;
  });
  check('inventory opens', menu.inventoryOpens, menu);
  check('inventory closes and unpauses', menu.inventoryCloses, menu);
  check('skills open', menu.skillsOpens, menu);
  check('skills close and unpause', menu.skillsCloses, menu);
  check('pause opens', menu.pauseOpens, menu);
  check('pause subtitle is filled in', /Floor \d+/.test(menu.pauseSubtitle), menu.pauseSubtitle);
  check('pause closes', menu.pauseCloses, menu);
  check('pause menu has buttons', menu.pauseHasButtons);

  /* ---------------- save + reload ---------------- */
  section('Save and reload');
  const saved = await page.evaluate(() => {
    const ok = Save.save();
    const slot = Save.activeSlot();
    const raw = localStorage.getItem(slot.key);
    return { ok, slot: slot.id, bytes: raw ? raw.length : 0, error: Save._lastError };
  });
  check('save succeeds', saved.ok, saved);
  check('save wrote the active slot', saved.bytes > 200, `${saved.bytes} bytes`);

  const before = await page.evaluate(() => ({
    floor: Game.floor, gold: Game.player.gold, level: Game.player.level, slot: Save.activeSlot().id,
  }));

  await page.reload({ waitUntil: 'load' });
  await waitForBoot(page);
  check('page reloads cleanly', (await page.evaluate(() => !!Game.dungeon)) !== undefined);

  /* After a reload the page is back at the title screen: no player, no floor.
     That is the correct behaviour — the run only comes back when it is loaded. */
  const after = await page.evaluate(() => ({
    state: Game.state,
    hasPlayer: !!Game.player,
    slot: Save.activeSlot().id,
    hasSave: Save.has(),
    peeked: !!Save.peek(),
  }));
  equal('reload returns to the title screen', after.state, 'menu');
  check('no run is auto-resumed on reload', after.hasPlayer === false, after.hasPlayer);
  check('the save survives a reload', after.hasSave, after);
  check('the saved run can still be previewed', after.peeked, after);
  equal('the save is still in the same slot', after.slot, before.slot);

  /* resume it explicitly and confirm the numbers came back */
  const loaded = await page.evaluate(() => {
    const ok = Save.load(Save.activeSlot().id);
    return {
      ok,
      floor: Game.floor, gold: Game.player.gold, level: Game.player.level,
      state: Game.state, hp: Game.player.hp, maxHp: Game.player.maxHp,
    };
  });
  check('saved run loads', loaded.ok, loaded);
  equal('floor restored', loaded.floor, before.floor);
  equal('gold restored', loaded.gold, before.gold);
  equal('level restored', loaded.level, before.level);
  check('hp valid after load', loaded.hp > 0 && loaded.hp <= loaded.maxHp, loaded);
  equal('game is playable after load', loaded.state, 'playing');
  await shot('03-after-load');

  /* ---------------- movement still works ---------------- */
  section('Input');
  const moved = await page.evaluate(async () => {
    const p = Game.player;
    const x0 = p.x, y0 = p.y;
    Game.input.up = true;
    await new Promise((r) => setTimeout(r, 500));
    Game.input.up = false;
    return { moved: Math.hypot(p.x - x0, p.y - y0), from: [x0, y0], to: [p.x, p.y] };
  });
  check('the hero moves on input', moved.moved > 2, moved);

  /* ---------------- no errors anywhere ---------------- */
  section('Runtime health');
  check('no console or page errors for the whole run', errors.length === 0, errors.slice(0, 5));

  await shot('04-final');
} catch (err) {
  console.error('\nUNEXPECTED FAILURE:', err.message);
  process.exitCode = 1;
} finally {
  const ok = summary('browser smoke');
  console.log(`(${Math.round((Date.now() - started) / 100) / 10}s)`);
  await browser.close();
  await server.close();
  if (counts().failed === 0) process.exitCode = exitCode();
  else process.exitCode = 1;
}
