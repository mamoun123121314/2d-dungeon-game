/**
 * Replay-based fuzz harness.
 *
 * With a fixed 1/60 s simulation and a per-run RNG stream, (seed, input
 * timeline) must reproduce the same world twice. This suite drives a handful
 * of seeds with deterministic pseudo-random input, then rewinds and replays
 * the identical timeline. Any desync becomes a readable pair of states.
 *
 *   node tests/replay.mjs
 */
import { launch, serve, waitForBoot, startRun } from './harness.mjs';
import { check, equal, section, summary, exitCode, counts } from './assert.mjs';

const server = await serve();
const { browser, page, errors } = await launch({ width: 1000, height: 720 });

try {
  await page.goto(server.url, { waitUntil: 'load' });
  await waitForBoot(page);
  await startRun(page);

  section('Deterministic replay');
  const replays = await page.evaluate(() => {
    const out = [];
    const run = (seed, frames, policySeed) => {
      startRun({ seed, heat: 0 });
      if (STORY.open && STORY.close) STORY.close();
      Game.state = 'playing'; Game.paused = false;
      Game.player.invuln = 999;
      /* The simulation timeline includes aim as well as movement. Pin the
         cursor to the left-center of the viewport so a browser's stale mouse
         position cannot make the attack targets depend on the prior run's
         camera. */
      Game.input.mx = Game.W * 0.05;
      Game.input.my = Game.H * 0.5;
      const dirs = [];
      let s = policySeed >>> 0;
      const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
      for (let i = 0; i < frames; i++) {
        const a = rnd() * Math.PI * 2;
        dirs.push({ x: Math.cos(a), y: Math.sin(a) });
      }
      for (let i = 0; i < frames; i++) {
        Game.input.touchDir = dirs[i];
        if (i % 17 === 0) Combat.playerAttack();
        if (i % 29 === 0) Combat.playerMagic();
        update(1 / 60);
      }
      Game.input.touchDir = null;
      const p = Game.player;
      return {
        x: +p.x.toFixed(5), y: +p.y.toFixed(5), hp: +p.hp.toFixed(5),
        mana: +p.mana.toFixed(5), floor: Game.floor, kills: Game.runStats.kills,
        enemies: Game.enemies.length,
        enemy0: Game.enemies[0] ? [+Game.enemies[0].x.toFixed(4), +Game.enemies[0].y.toFixed(4), +Game.enemies[0].hp.toFixed(4)] : null,
        sim: Game.simRng.getState(),
      };
    };
    for (const seed of [1, 424242, 20261122, 9999999]) {
      const a = run(seed, 150, seed ^ 0xabcdef);
      const b = run(seed, 150, seed ^ 0xabcdef);
      out.push({ seed, a, b, same: JSON.stringify(a) === JSON.stringify(b) });
    }
    return out;
  });
  for (const r of replays) {
    check('seed ' + r.seed + ' replays exactly', r.same, r);
    check('seed ' + r.seed + ' stays inside bounds',
      Number.isFinite(r.a.x) && Number.isFinite(r.a.y) && r.a.hp >= 0 && r.a.mana >= 0,
      r.a);
  }
  check('no runtime errors during replay', errors.length === 0, errors.slice(0, 4));
} catch (err) {
  console.error('\nUNEXPECTED FAILURE:', err.stack || err.message);
} finally {
  summary('replay');
  await browser.close();
  await server.close();
  process.exitCode = counts().failed === 0 ? exitCode() : 1;
}
