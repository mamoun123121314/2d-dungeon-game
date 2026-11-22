/**
 * Balance lab — a headless autoplay bot for the seeded dungeon.
 *
 * It boots the real game in the same Chromium used by the test suite, plays a
 * batch of seeds with a simple policy (walk at the nearest monster, swing,
 * drink when hurt, take the stairs when the floor is quiet) and prints the
 * deaths-per-floor and time-to-floor curves that no assertion test can see.
 *
 *   node scripts/balance-lab.mjs                 # 20 seeded runs
 *   node scripts/balance-lab.mjs --runs 100      # longer sweep
 *   node scripts/balance-lab.mjs --runs 30 --contract reclaimer --heat 2
 *   node scripts/balance-lab.mjs --json report.json
 *
 * This is deliberately NOT part of CI: a balance number is a conversation
 * starter, not a pass/fail gate.
 */
import fs from 'node:fs';
import { launch, serve, waitForBoot, startRun } from '../tests/harness.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const RUNS = Math.max(1, Math.min(500, Math.floor(Number(arg('runs', 20)))));
const CONTRACT = arg('contract', 'standard');
const HEAT = Math.max(0, Math.min(3, Math.floor(Number(arg('heat', 0)))));
const JSON_OUT = arg('json', '');
const MAX_STEPS = Math.max(600, Math.floor(Number(arg('steps', 60 * 90))));
const BASE_SEED = Math.floor(Number(arg('seed', 20260101))) || 20260101;

const server = await serve();
const { browser, page, errors } = await launch({ width: 960, height: 640 });

try {
  await page.goto(server.url, { waitUntil: 'load' });
  await waitForBoot(page);

  const results = [];
  for (let run = 0; run < RUNS; run++) {
    const seed = (BASE_SEED + run * 7919) | 0;
    const result = await page.evaluate(async ({ seed, contract, heat, maxSteps }) => {
      Settings.set('contract', contract);
      Settings.set('heat', heat);
      startRun({ seed, heat });
      if (STORY.open && STORY.close) STORY.close();
      Game.state = 'playing'; Game.paused = false;
      const p = Game.player;
      const floors = {};
      let steps = 0;
      let lastFloor = Game.floor;
      let t0 = performance.now();
      const nearestEnemy = () => {
        let best = null, bd = Infinity;
        for (const e of Game.enemies) {
          if (!e.alive || e.guardsVault) continue;
          const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
          if (d < bd) { bd = d; best = e; }
        }
        return best ? { e: best, d: Math.sqrt(bd) } : null;
      };
      while (steps < maxSteps && !p.dead && Game.state === 'playing') {
        steps++;
        if (p.hp < p.maxHp * 0.45 && p.potions > 0) drinkPotion();
        const near = nearestEnemy();
        if (near) {
          Game.input.touchDir = { x: (near.e.x - p.x) / (near.d || 1), y: (near.e.y - p.y) / (near.d || 1) };
          if (near.d < 96) Combat.playerAttack();
          if (near.d < 200 && p.mana > 12) Combat.playerMagic();
          if (near.d < 90 && p.mana > 20) Combat.playerSlam();
        } else {
          /* clear floor: walk onto the stairs and descend to keep the run moving */
          const s = Game.dungeon.stairs;
          const sx = (s.x + 0.5) * TILE, sy = (s.y + 0.5) * TILE;
          Game.input.touchDir = { x: sx - p.x, y: sy - p.y };
          if (Math.hypot(sx - p.x, sy - p.y) < 40) descend();
        }
        update(1 / 60);
        if (Game.floor !== lastFloor) {
          floors[lastFloor] = +(Game.elapsedRun).toFixed(1);
          lastFloor = Game.floor;
        }
        if (steps % 60 === 0 && Game.paused) { Game.paused = false; Game.state = 'playing'; }
      }
      Game.input.touchDir = null;
      const ms = performance.now() - t0;
      return {
        seed, died: !!p.dead, floor: Game.floor, level: p.level, kills: Game.runStats.kills,
        gold: p.gold, gearScore: Math.round(p.totalScore), seconds: +Game.elapsedRun.toFixed(1),
        steps, ms: Math.round(ms), floors,
      };
    }, { seed, contract: CONTRACT, heat: HEAT, maxSteps: MAX_STEPS });
    results.push(result);
    process.stdout.write(`run ${String(run + 1).padStart(2)}/${RUNS}  seed ${seed}  floor ${String(result.floor).padStart(2)}  lvl ${String(result.level).padStart(2)}  ${result.died ? 'died ' : 'lived'}  ${result.seconds}s\n`);
  }

  const deathsByFloor = {};
  const reached = {};
  for (const r of results) {
    reached[r.floor] = (reached[r.floor] || 0) + 1;
    if (r.died) deathsByFloor[r.floor] = (deathsByFloor[r.floor] || 0) + 1;
  }
  const avg = (fn) => results.reduce((a, r) => a + fn(r), 0) / results.length;
  const summary = {
    runs: RUNS, contract: CONTRACT, heat: HEAT,
    deaths: results.filter(r => r.died).length,
    deathRate: +(results.filter(r => r.died).length / RUNS).toFixed(3),
    averageFloor: +avg(r => r.floor).toFixed(2),
    averageLevel: +avg(r => r.level).toFixed(2),
    averageKills: Math.round(avg(r => r.kills)),
    averageGold: Math.round(avg(r => r.gold)),
    averageSeconds: +avg(r => r.seconds).toFixed(1),
    averageSimMs: Math.round(avg(r => r.ms)),
    reachedFloor: reached,
    deathsByFloor,
  };
  console.log('\n' + JSON.stringify(summary, null, 2));
  if (errors.length) console.log('page errors:', errors.slice(0, 4));
  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({ summary, results }, null, 2));
    console.log('wrote ' + JSON_OUT);
  }
} finally {
  await browser.close();
  await server.close();
}
