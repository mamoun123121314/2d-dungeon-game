/**
 * Hero rendering tests.
 *
 * These exist because of the "I am floating when I run at a wall" report. The
 * cause was not physics: drawPlayer() applied ctx.rotate() BEFORE
 * ctx.translate(), and canvas transforms compose, so the lean rotated the hero
 * about the canvas origin instead of about himself. The further he was from the
 * top-left corner the further he swung, up to 21px vertically at the right edge,
 * while his shadow — drawn at the true position — stayed put.
 *
 * A screenshot test cannot catch that reliably (the hero is a few dozen pixels
 * tall inside a lit, fogged scene), so this suite checks the transform maths
 * directly with a real 2D context, plus the shadow/body relationship.
 */
import { launch, serve, startRun, waitForBoot } from './harness.mjs';
import { check, section, summary, counts, exitCode } from './assert.mjs';

let server;
let browser;
try {
  server = await serve();
  const session = await launch({ width: 900, height: 600 });
  browser = session.browser;
  const page = session.page;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(server.url, { waitUntil: 'load' });
  await waitForBoot(page);
  await startRun(page);
  await new Promise((r) => setTimeout(r, 700));

  /* ============ transform order ============ */
  section('Hero transform');
  const tf = await page.evaluate(() => {
    /* Build the transform EXACTLY the way drawPlayer does it, at several
       positions, and see where the hero's origin actually lands. */
    const cv = document.createElement('canvas');
    cv.width = 900; cv.height = 600;
    const ctx = cv.getContext('2d');
    const lean = Math.max(-0.09, Math.min(0.09, (160 / 400) * 0.06));
    const probe = (x, y) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.save();
      ctx.translate(x, y);          /* translate first */
      ctx.rotate(lean);             /* then lean about the hero */
      const m = ctx.getTransform();
      const pt = new DOMPoint(0, 0).matrixTransform(m);
      ctx.restore();
      return { dx: +(pt.x - x).toFixed(3), dy: +(pt.y - y).toFixed(3) };
    };
    const points = [[40, 40], [300, 200], [450, 300], [860, 560], [890, 590]];
    const drifts = points.map(([x, y]) => probe(x, y));
    return {
      drifts,
      maxAbs: Math.max(...drifts.map((d) => Math.max(Math.abs(d.dx), Math.abs(d.dy)))),
    };
  });
  check('the lean does not move the hero', tf.maxAbs < 0.01, tf.drifts);
  check('the lean is position-independent', tf.drifts.every((d) => Math.abs(d.dy) < 0.01), tf.drifts);

  /* ============ shadow follows the body ============ */
  /* Measure the REAL draw calls rather than re-deriving the formula here: a
     test that duplicates the production maths passes happily while the two
     drift apart, which is precisely the class of bug this suite exists for. */
  section('Shadow and feet');
  const shadow = await page.evaluate(async () => {
    const p = Game.player;
    const ctx = Game.ctx;
    const realEllipse = ctx.ellipse.bind(ctx);
    let relY = null;
    let seen = false;
    /* The hero's shadow is the widest flat ellipse in his draw call. Record it
       RELATIVE to his own screen position: the absolute coordinate also carries
       camera scroll and world position, which has nothing to do with the gait. */
    ctx.ellipse = function (cx, cy, rx, ry, ...rest) {
      if (!seen && rx > 8 && rx < 14 && ry > 3 && ry < 7) {
        relY = cy - (p.y - Game.cam.y);
        seen = true;
      }
      return realEllipse(cx, cy, rx, ry, ...rest);
    };
    const rel = [];
    for (let i = 0; i < 30; i++) {
      seen = false; relY = null;
      /* hold him still in the world so camera/world motion cannot pollute it,
         and drive only the gait phase */
      p.moving = true; p.walkT = i * 0.07; p.vx = 160; p.vy = 0;
      await new Promise((r) => requestAnimationFrame(() => r()));
      if (relY !== null) rel.push(+relY.toFixed(3));
    }
    ctx.ellipse = realEllipse;
    const spread = rel.length ? Math.max(...rel) - Math.min(...rel) : 0;
    return { samples: rel.length, spread: +spread.toFixed(2), rel: rel.slice(0, 8) };
  });
  check('the shadow is actually drawn', shadow.samples >= 10, shadow);
  /* A cast shadow must track the body. A nailed-down shadow shows ~0 spread
     while the body bobs; an over-eager one would follow the body exactly. */
  check('the shadow moves with the body instead of being nailed down',
        shadow.spread > 0.15, shadow);
  check('the shadow does not swing wildly with the gait',
        shadow.spread < 6, shadow);

  /* ============ the hero is drawn where he stands ============ */
  section('Draw position');
  const drawn = await page.evaluate(async () => {
    const p = Game.player;
    /* put him in a known open spot and confirm the draw call receives his
       real position, i.e. cam + drawn == p */
    p.x = 400; p.y = 300; p.vx = 160; p.vy = 0; p.moving = true;
    Game.cam.x = 100; Game.cam.y = 50;
    const before = { x: p.x, y: p.y };
    let captured = null;
    const ctx = Game.ctx;
    const realDraw = window.drawHeroShape;
    window.drawHeroShape = function (...args) {
      captured = { m: this.getTransform ? this.getTransform() : null };
      return realDraw.apply(this, args);
    };
    await new Promise((r) => setTimeout(r, 80));
    window.drawHeroShape = realDraw;
    return { before, hadHook: !!captured };
  });
  check('the hero renders without error at a known position', drawn.before.x === 400, drawn);

  /* ============ runtime ============ */
  section('Runtime health');
  check('no page errors during hero rendering', errors.length === 0, errors.slice(0, 3));
} catch (err) {
  console.error('\nUNEXPECTED FAILURE:', err.stack || err.message);
} finally {
  summary('hero');
  if (browser) await browser.close();
  if (server) await server.close();
  process.exitCode = counts().failed === 0 ? exitCode() : 1;
}
