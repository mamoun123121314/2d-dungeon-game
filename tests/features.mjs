/**
 * Feature tests for the 2026 systems pass: run identity, Heat, room stations,
 * relics, hunts, corpse runs, ghost races, chronicles, key rebinding, the
 * screen-reader log, PWA shell and deterministic simulation.
 *
 *   node tests/features.mjs
 */
import { launch, serve, waitForBoot, startRun } from './harness.mjs';
import { check, equal, between, section, summary, exitCode, counts } from './assert.mjs';

const server = await serve();
const { browser, page, errors } = await launch({ width: 1000, height: 720 });

try {
  await page.goto(server.url, { waitUntil: 'load' });
  await waitForBoot(page);
  await startRun(page);

  section('Run identity');
  const identity = await page.evaluate(() => {
    const seed = 0x7f3a91c2;
    const code = seedToCode(seed);
    return {
      code, round: codeToSeed(code), seed: seed >>> 0,
      dailyA: dailySeed(), dailyB: dailySeed(),
      bad: codeToSeed('NOT-A-RUN'),
    };
  });
  check('a seed renders as a DR code', /^DR-[0-9A-Z]{4}-[0-9A-Z]{3}$/.test(identity.code), identity.code);
  equal('the code round-trips to the same seed', identity.round, identity.seed);
  equal('the daily seed is stable for the whole UTC day', identity.dailyA, identity.dailyB);
  equal('garbage is not accepted as a code', identity.bad, 0);

  section('Heat');
  const heat = await page.evaluate(() => {
    Settings.set('heat', 2);
    setChosenHeat(2);
    const active = Array.from(document.querySelectorAll('#heatRow .heatChip')).find(b => b.classList.contains('active'));
    Game.heat = 2;
    const light2 = heroLightMult();
    Game.heat = 3;
    const light3 = heroLightMult();
    startRun({ seed: 123456, heat: 2 });
    if (STORY.open && STORY.close) STORY.close();
    Game.state = 'playing'; Game.paused = false;
    return {
      setting: Settings.get().heat, gameHeat: Game.heat, active: active && active.dataset.heat,
      light2, light3, code: Game.lastSeedCode,
    };
  });
  equal('the heat chip is the selected one', heat.active, '2');
  equal('Heat reaches the running game', heat.gameHeat, 2);
  check('higher Heat darkens the hero light', heat.light3 < heat.light2, heat);

  section('Room stations');
  const stations = await page.evaluate(() => {
    startRun({ seed: 777001, heat: 0 });
    if (STORY.open && STORY.close) STORY.close();
    Game.state = 'playing'; Game.paused = false;
    buildFloor(3, false, 777003);
    if (STORY.open && STORY.close) STORY.close();
    const all = Game.props.filter(pr => pr.station);
    const pr = all.find(p => p.station === 'library') || all[0];
    const out = { kinds: Object.keys(STATIONS).length, count: all.length, station: pr && pr.station };
    if (pr) {
      Game.player.x = pr.x; Game.player.y = pr.y + 34;
      Game.player.gold = 500;
      const near = nearestInteractable();
      out.offered = !!(near && near.station);
      out.used = useStation(pr);
      out.marked = !!pr.used;
      Game.player.x = pr.x; Game.player.y = pr.y + 34;
      out.stillOffered = !!(nearestInteractable() && nearestInteractable().station);
    }
    return out;
  });
  equal('there are six station personalities', stations.kinds, 6);
  check('at least one station is placed on a floor', stations.count >= 1, stations);
  check('a station is an interaction target', stations.offered === true, stations);
  check('using a station marks it used', stations.used !== false && stations.marked === true, stations);
  check('a used station is no longer offered', stations.stillOffered === false, stations);

  section('Relic draft');
  const relics = await page.evaluate(() => {
    startRun({ seed: 424242, heat: 0 });
    if (STORY.open && STORY.close) STORY.close();
    Game.state = 'playing'; Game.paused = false;
    Game.floor = 5;
    Game.relics = [];
    offerRelicDraft();
    const shown = document.getElementById('relicDraftOverlay').classList.contains('show');
    const buttons = document.querySelectorAll('#relicChoices [data-relic]').length;
    const first = document.querySelector('#relicChoices [data-relic]');
    const id = first && first.dataset.relic;
    const picked = id ? chooseRelic(id) : false;
    Game.relics = [];
    const hpBefore = Game.player.maxHp;
    Game.relics = ['warden'];
    const hpAfter = Game.player.maxHp;
    Game.relics = ['glassEdge'];
    const hpGlass = Game.player.maxHp;
    return { shown, buttons, picked, owned: Game.relics.length, id, hpBefore, hpAfter, hpGlass,
             hud: document.getElementById('relicBar').textContent,
             table: RELICS.length };
  });
  check('the draft paints three choices', relics.shown && relics.buttons === 3, relics);
  check('a choice becomes a run relic', relics.picked && relics.owned >= 1, relics);
  check('Warden Heart raises max health', relics.hpAfter > relics.hpBefore, relics);
  check('Glass Edge trades health for damage', relics.hpGlass < relics.hpBefore, relics);
  check('relics are shown on the HUD', relics.hud.length > 0, relics);
  check('the relic pool is broad enough for repeat drafts', relics.table >= 10, relics.table);

  section('Hunts');
  const hunt = await page.evaluate(() => {
    startRun({ seed: 5551212, heat: 0 });
    if (STORY.open && STORY.close) STORY.close();
    Game.state = 'playing'; Game.paused = false;
    buildFloor(4, false, 5551215);
    if (STORY.open && STORY.close) STORY.close();
    Game.state = 'playing'; Game.paused = false;
    const target = Game.enemies.find(e => e.huntTarget);
    const before = (Save.meta().hunts || []).length;
    if (target) completeHunt(target);
    const m = Save.meta();
    return { exists: !!Game.hunt, named: target ? target.huntName : null, target: !!target,
             killed: Game.hunt && Game.hunt.killed, before, after: (m.hunts || []).length,
             shards: m.shards, title: (m.titles || []).slice(-1)[0] };
  });
  check('a floor has a named hunt target', hunt.exists && hunt.target, hunt);
  check('the target has a readable name', typeof hunt.named === 'string' && hunt.named.length > 3, hunt.named);
  check('completing the hunt is recorded', hunt.killed && hunt.after === hunt.before + 1, hunt);
  check('completing the hunt pays shards and a title', hunt.shards > 0 && !!hunt.title, hunt);

  section('Corpse runs');
  const corpse = await page.evaluate(() => {
    const m = Save.meta();
    const item = Save.slimItem({ kind: 'ring', slot: 'ring', name: 'Test Ring', rarity: 2,
      tier: 1, baseName: 'Test Ring', stats: { hp: 4 }, value: 12, iconSeed: 3 });
    m.corpse = { floor: 3, seed: 999, x: 0, y: 0, name: 'Test Delver', item, recovered: false };
    Save.writeMeta(m);
    startRun({ seed: 909090, heat: 0 });
    if (STORY.open && STORY.close) STORY.close();
    Game.state = 'playing'; Game.paused = false;
    Game.corpse = corpseForRun();
    buildFloor(3, false, 999);
    if (STORY.open && STORY.close) STORY.close();
    Game.state = 'playing'; Game.paused = false;
    const pr = Game.corpseProp;
    const offered = !!Game.corpse;
    const before = Game.player.inventory.length;
    let recovered = false;
    if (pr) recovered = recoverCorpse(pr);
    return { offered, placed: !!pr, recovered,
             hasItem: Game.player.inventory.length > before,
             meta: Save.meta().corpse };
  });
  check('a dead run leaves a corpse record', corpse.offered, corpse);
  check('the corpse is placed on the death floor', corpse.placed, corpse);
  check('touching the remains recovers an item', corpse.recovered && corpse.hasItem, corpse);
  check('the corpse is marked recovered', !corpse.meta || corpse.meta.recovered === true, corpse.meta);

  section('Ghost race');
  const ghost = await page.evaluate(() => {
    startRun({ seed: 3141592, heat: 0 });
    if (STORY.open && STORY.close) STORY.close();
    Game.state = 'playing'; Game.paused = false;
    Game.elapsedRun = 5;
    Game.ghostRecording.points = [[100, 100, 1, 1], [140, 110, 1, 2], [180, 120, 1, 3]];
    Game.ghostRecording.lastT = 3;
    saveGhostBest();
    const key = seedToCode(3141592);
    const stored = Save.meta().ghosts[key];
    Game.ghost = stored;
    Game.floor = 1; Game.elapsedRun = 2.5;
    const pose = ghostPose();
    return { stored: !!stored, points: stored ? stored.points.length : 0,
             depth: stored ? stored.bestDepth : 0, pose };
  });
  check('a ghost is stored under the run code', ghost.stored, ghost);
  check('the ghost keeps the recorded path', ghost.points === 3, ghost);
  check('the ghost can be sampled at the same elapsed time', ghost.pose && ghost.pose.x === 140, ghost);

  section('Chronicle');
  const chronicle = await page.evaluate(() => {
    Game.player.level = 7;
    Game.floor = 6;
    Game.runStats = { kills: 42, chests: 5, items: 8, gold: 900, depth: 6, time: 200 };
    Game.elapsedRun = 200;
    Game.deathBy = 'a Test Wraith';
    Game.relics = ['warden'];
    const text = buildChronicleText('death');
    const before = (Save.meta().chronicles || []).length;
    publishChronicle('death');
    const after = (Save.meta().chronicles || []).length;
    return { text, before, after, seed: Game.lastSeedCode };
  });
  check('a chronicle names the run seed', chronicle.text.includes(chronicle.seed), chronicle.text.slice(0, 120));
  check('a chronicle records the killing blow', /Test Wraith/.test(chronicle.text), chronicle.text);
  check('a chronicle is appended to meta memory', chronicle.after === chronicle.before + 1, chronicle);

  section('Key bindings');
  const keys = await page.evaluate(() => {
    resetKeybinds();
    const defaults = keybindCode('interact');
    setKeybind('interact', 'KeyG');
    const remapped = keybindCode('interact');
    const action = boundActionForCode('KeyG');
    const oldAction = boundActionForCode('KeyF');
    setKeybind('magic', 'KeyG');
    const conflict = keybindCode('interact');
    resetKeybinds();
    return { defaults, remapped, action, oldAction, conflict, reset: keybindCode('interact'),
             rows: document.querySelectorAll('#keybindList .keybindRow').length };
  });
  equal('the default interact key is F', keys.defaults, 'KeyF');
  equal('a binding can be remapped', keys.remapped, 'KeyG');
  equal('the remapped code dispatches its action', keys.action, 'interact');
  check('the old code no longer owns the action', !keys.oldAction, keys.oldAction);
  check('a conflicting bind steals the code', keys.conflict !== 'KeyG', keys.conflict);
  equal('reset restores the default', keys.reset, 'KeyF');
  check('the settings page lists every binding', keys.rows === 10, keys.rows);

  section('Screen reader and PWA shell');
  const assist = await page.evaluate(async () => {
    SR.announce('Chest opened: Test Barbute', true);
    await new Promise(r => setTimeout(r, 30));
    const log = document.getElementById('srLog');
    const manifest = await fetch('./manifest.webmanifest').then(r => r.ok ? r.json() : null).catch(() => null);
    const sw = await fetch('./sw.js').then(r => r.ok ? r.text() : '').catch(() => '');
    return {
      text: log ? log.textContent : '', live: log && log.getAttribute('aria-live'),
      manifest: manifest && manifest.name, icons: manifest && (manifest.icons || []).length,
      sw: /dungeon-rogue-v/.test(sw), installBtn: !!document.getElementById('installBtn'),
      photoMode: typeof togglePhotoMode, frame: typeof saveFrame, clip: typeof recordClip,
    };
  });
  check('announcements reach the live region', assist.text.includes('Test Barbute'), assist.text);
  check('the live region is polite or assertive', assist.live === 'polite' || assist.live === 'assertive', assist.live);
  check('a web app manifest exists', !!assist.manifest, assist.manifest);
  check('the manifest ships maskable icons', assist.icons >= 2, assist.icons);
  check('the service worker caches the game', assist.sw, assist.sw);
  check('photo mode, frame export and clip recording exist',
    assist.photoMode === 'function' && assist.frame === 'function' && assist.clip === 'function', assist);

  section('Deterministic simulation');
  const replay = await page.evaluate(() => {
    const runOnce = () => {
      startRun({ seed: 20261122, heat: 1 });
      if (STORY.open && STORY.close) STORY.close();
      Game.state = 'playing'; Game.paused = false;
      Game.player.invuln = 999;          /* isolate movement from combat rolls */
      Game.input.touchDir = { x: 1, y: 0.35 };
      for (let i = 0; i < 180; i++) update(1 / 60);
      Game.input.touchDir = null;
      const p = Game.player;
      return { x: +p.x.toFixed(4), y: +p.y.toFixed(4), hp: p.hp,
               sim: Game.simRng.getState(), enemies: Game.enemies.length,
               enemy: Game.enemies[0] ? [+Game.enemies[0].x.toFixed(3), +Game.enemies[0].y.toFixed(3)] : null };
    };
    const a = runOnce();
    const b = runOnce();
    return { a, b, same: JSON.stringify(a) === JSON.stringify(b) };
  });
  check('seed + inputs reproduce the same position', replay.a.x === replay.b.x && replay.a.y === replay.b.y, replay);
  check('seed + inputs reproduce the same simulation stream', replay.a.sim === replay.b.sim, replay);

  section('Runtime health');
  check('no console or page errors during feature tests', errors.length === 0, errors.slice(0, 4));
} catch (err) {
  console.error('\nUNEXPECTED FAILURE:', err.stack || err.message);
} finally {
  summary('features');
  await browser.close();
  await server.close();
  process.exitCode = counts().failed === 0 ? exitCode() : 1;
}
