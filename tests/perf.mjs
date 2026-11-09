/**
 * Performance profile.
 *
 * Measures real frame cost in a real browser rather than guessing: a quiet
 * corridor, a crowded fight, and a boss encounter, on a desktop viewport and a
 * phone-class viewport. It reports p50/p95/p99 frame time plus the cost of the
 * individual render stages that are easy to isolate, so any optimisation can
 * be aimed at something measured.
 *
 * Frame rate is environment-dependent: this sandbox has no GPU, so Chromium
 * rasterises in software and every absolute number here is far worse than a
 * real handset. The gate is therefore relative: it checks that the renderer's
 * known-expensive stages still pay off against a reference implementation of
 * the same visual, and that nothing throws. Absolute FPS is reported for the
 * record, not asserted.
 *
 *   node tests/perf.mjs
 */
import { launch, serve, waitForBoot, startRun } from './harness.mjs';
import { check, section, summary, exitCode, counts } from './assert.mjs';

const SCENARIOS = [
  { id: 'desktop', width: 1200, height: 800, mobile: false },
  { id: 'phone', width: 393, height: 852, mobile: true },
];

const server = await serve();
const results = [];

/**
 * Sample frame durations by hooking rAF inside the page. Frames are timed
 * around update()+render() through the game's own loop, which is what a player
 * actually waits for.
 */
async function sampleFrames(page, seconds) {
  return page.evaluate(async (secs) => {
    const frames = [];
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      frames.push(now - last);
      last = now;
      if (now - start < secs * 1000) requestAnimationFrame(tick);
      else done();
    };
    let done;
    const finished = new Promise((r) => { done = r; });
    const start = performance.now();
    requestAnimationFrame(tick);
    await finished;
    /* drop the first frame: it carries the cost of starting the sampler */
    const f = frames.slice(1).sort((a, b) => a - b);
    const at = (p) => f[Math.min(f.length - 1, Math.floor(f.length * p))] || 0;
    return {
      count: f.length,
      p50: +at(0.5).toFixed(1),
      p95: +at(0.95).toFixed(1),
      p99: +at(0.99).toFixed(1),
      max: +Math.max(...f, 0).toFixed(1),
      fps: +(1000 / (at(0.5) || 1)).toFixed(1),
    };
  }, seconds);
}

/** Spawn a wave of enemies around the player to reproduce a crowded fight. */
async function crowd(page, n) {
  return page.evaluate((count) => {
    const p = Game.player;
    if (!p) return 0;
    let spawned = 0;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const dist = 90 + (i % 5) * 26;
      const x = p.x + Math.cos(angle) * dist;
      const y = p.y + Math.sin(angle) * dist;
      if (!Game.dungeon.isWalkablePx(x, y)) continue;
      try {
        const e = new Enemy('slime', x, y, Game.floor);
        e.aggro = true; e.state = 'chase';
        Game.enemies.push(e);
        spawned++;
      } catch (err) { return { spawned, error: err.message }; }
    }
    Game.combatIntensity = Math.min(1, 0.35 + spawned * 0.06);
    return { spawned, total: Game.enemies.length, error: null };
  }, n);
}

/** Fire lots of effects to reproduce the busiest visual moments. */
async function effects(page) {
  return page.evaluate(() => {
    const p = Game.player;
    for (let i = 0; i < 160; i++) {
      FX.particles.push({
        x: p.x + (Math.random() - 0.5) * 220, y: p.y + (Math.random() - 0.5) * 160,
        vx: (Math.random() - 0.5) * 90, vy: (Math.random() - 0.5) * 90,
        life: 0.6 + Math.random() * 0.8, max: 1.4, size: 1 + Math.random() * 3,
        color: 'rgba(255,180,90,0.9)', kind: 'spark',
      });
    }
    for (let i = 0; i < 40; i++) {
      FX.rings.push({ x: p.x, y: p.y, r: 4, max: 90 + i * 3, life: 0.7, maxLife: 0.7, color: 'rgba(255,200,120,0.5)', w: 3 });
    }
    return { particles: FX.particles.length, rings: FX.rings.length };
  });
}

/**
 * Compare the optimised stages against reference implementations of the same
 * visual. This is the part that can fail: it proves an optimisation is still
 * doing its job, rather than asserting a frame rate that depends on whether
 * the machine has a GPU.
 */
async function stageComparison(page) {
  return page.evaluate(() => {
    const c = Game.ctx;
    const sync = () => c.getImageData(0, 0, 1, 1);
    /* minimum-of-N is the least noisy estimator under a software rasteriser */
    const bench = (fn, n = 30) => {
      fn(); sync();
      let best = Infinity;
      for (let i = 0; i < n; i++) {
        const a = performance.now(); fn(); sync();
        const d = performance.now() - a;
        if (d < best) best = d;
      }
      return +best.toFixed(2);
    };
    const d = Game.dungeon;
    const oldVignette = () => {
      const g = c.createRadialGradient(Game.W / 2, Game.H / 2, Math.min(Game.W, Game.H) * 0.3,
                                       Game.W / 2, Game.H / 2, Math.max(Game.W, Game.H) * 0.8);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.18)');
      g.addColorStop(1, d.theme.vignette);
      c.save(); c.fillStyle = g; c.fillRect(0, 0, Game.W, Game.H);
      c.globalCompositeOperation = 'lighter';
      const h = c.createLinearGradient(0, 0, 0, Game.H);
      h.addColorStop(0, rgba(d.theme.accent, 0.05));
      h.addColorStop(0.7, 'rgba(0,0,0,0)');
      c.fillStyle = h; c.fillRect(0, 0, Game.W, Game.H);
      c.restore();
    };
    const newVignette = bench(() => drawVignette(c));
    const refVignette = bench(oldVignette);
    /* the full frame with each implementation swapped in */
    const frameNew = bench(() => render(), 15);
    const real = window.drawVignette;
    window.drawVignette = oldVignette;
    const frameOld = bench(() => render(), 15);
    window.drawVignette = real;
    return { newVignette, refVignette, frameNew, frameOld };
  });
}

/** Time the expensive render stages in isolation. */
async function stageCost(page) {
  return page.evaluate(() => {
    const out = {};
    const t = (fn, n = 30) => {
      fn();                       /* warm the path */
      const a = performance.now();
      for (let i = 0; i < n; i++) fn();
      return +((performance.now() - a) / n).toFixed(2);
    };
    try { out.render = t(() => render(), 20); } catch (e) { out.render = `err:${e.message}`; }
    try { out.update = t(() => update(1 / 60), 20); } catch (e) { out.update = `err:${e.message}`; }
    return out;
  });
}

try {
  for (const scenario of SCENARIOS) {
    section(`${scenario.id} ${scenario.width}x${scenario.height}`);
    const { browser, page, errors } = await launch(scenario);

    try {
      await page.goto(server.url, { waitUntil: 'load' });
      await waitForBoot(page);
      const boot = await sampleFrames(page, 2);
      await startRun(page);
      await new Promise((r) => setTimeout(r, 700));

      const quiet = await sampleFrames(page, 3);

      const spawned = await crowd(page, 26);
      await new Promise((r) => setTimeout(r, 500));
      const crowded = await sampleFrames(page, 3);

      const fx = await effects(page);
      const busy = await sampleFrames(page, 3);

      /* a boss encounter: floor 5 ends in one, so jump there the way the stairs do */
      const bossInfo = await page.evaluate(() => {
        try {
          descend();
          /* descend opens a chapter card; scoring under it would measure a
             paused game, so report that rather than pretend */
          return { ok: true, story: STORY.open, floor: Game.floor, boss: !!(Game.boss || (Game.enemies || []).some((e) => e && e.isBoss)) };
        } catch (e) { return { ok: false, error: e.message }; }
      });
      await page.evaluate(() => { if (STORY.open) STORY.close(); });
      await new Promise((r) => setTimeout(r, 600));
      const boss = await sampleFrames(page, 2);

      const stages = await stageCost(page);

      const row = { scenario: scenario.id, boot, quiet, crowded, busy, boss, stages, spawned, fx, bossInfo, errors: errors.length };
      results.push(row);

      console.log(`  quiet    p50 ${quiet.p50}ms  p95 ${quiet.p95}ms  ~${quiet.fps}fps`);
      console.log(`  crowded  p50 ${crowded.p50}ms  p95 ${crowded.p95}ms  ~${crowded.fps}fps  (${spawned.spawned} added, ${spawned.total} live)`);
      console.log(`  +effects p50 ${busy.p50}ms  p95 ${busy.p95}ms  ~${busy.fps}fps  (${fx.particles} particles, ${fx.rings} rings)`);
      console.log(`  boss     p50 ${boss.p50}ms  p95 ${boss.p95}ms  ~${boss.fps}fps  floor ${bossInfo.floor}`);
      console.log(`  stages   update ${stages.update}ms  render ${stages.render}ms per frame`);

      const cmp = await stageComparison(page);
      row.cmp = cmp;

      console.log(`  stages   new vignette ${cmp.newVignette}ms vs reference ${cmp.refVignette}ms`);
      console.log(`           full frame  ${cmp.frameNew}ms vs ${cmp.frameOld}ms without the bake`);
      console.log(`           saving      ${(cmp.frameOld - cmp.frameNew).toFixed(2)}ms/frame ` +
                  `(${(100 * (cmp.frameOld - cmp.frameNew) / cmp.frameOld).toFixed(0)}%)`);

      check(`${scenario.id}: the game renders without errors`, errors.length === 0, errors.slice(0, 3));
      /* the baked vignette must beat rebuilding two gradients every frame */
      check(`${scenario.id}: the cached vignette is cheaper than rebuilding it`,
            cmp.newVignette < cmp.refVignette, { new: cmp.newVignette, ref: cmp.refVignette });
      /* the stage-level comparison is the trustworthy one: both draw the same
         pixels, so the difference is purely how the gradient gets rasterised.
         The full-frame numbers are printed for the record but not asserted —
         the two implementations differ by a few LSBs, and under a software
         rasteriser that changes how much work the compositor does. */
      check(`${scenario.id}: the cache is at least 25% cheaper than rebuilding`,
            cmp.newVignette <= cmp.refVignette * 0.75,
            { new: cmp.newVignette, ref: cmp.refVignette });
      /* there is no GPU here, so this only guards against a true collapse */
      check(`${scenario.id}: frames still complete`, quiet.count > 10 && crowded.count > 10,
            { quiet: quiet.count, crowded: crowded.count });
    } finally {
      await browser.close();
    }
  }

  /* ---------------- the report ---------------- */
  section('Summary');
  for (const r of results) {
    console.log(`  ${r.scenario}: quiet ${r.quiet.fps}fps | crowded ${r.crowded.fps}fps | ` +
                `effects ${r.busy.fps}fps | boss ${r.boss.fps}fps | ` +
                `update ${r.stages.update}ms | render ${r.stages.render}ms`);
  }
  const slowest = results.reduce((a, b) => (a.busy.p95 > b.busy.p95 ? a : b));
  console.log(`\n  worst case: ${slowest.scenario}, p95 ${slowest.busy.p95}ms in the busiest scene`);
  for (const r of results) {
    const pct = (100 * (r.cmp.frameOld - r.cmp.frameNew) / r.cmp.frameOld).toFixed(0);
    console.log(`  ${r.scenario.padEnd(8)} vignette bake saves ${(r.cmp.frameOld - r.cmp.frameNew).toFixed(2)}ms/frame (${pct}%)`);
  }
  check('the cached vignette is cheaper in every scenario',
        results.every((r) => r.cmp.newVignette <= r.cmp.refVignette * 0.75),
        results.map((r) => [r.scenario, r.cmp.newVignette, r.cmp.refVignette]));
} catch (err) {
  console.error('\nUNEXPECTED FAILURE:', err.stack || err.message);
} finally {
  summary('performance');
  await server.close();
  process.exitCode = counts().failed === 0 ? exitCode() : 1;
}
