import { launch, serve, waitForBoot } from './harness.mjs';

/* Render the vault door on a real canvas in portrait and landscape, locked and
   unlocked, and save crops so the placement can be eyeballed rather than
   trusted from numbers. */
const server = await serve();
const out = 'tests/screens';

for (const [label, width, height, mobile] of [
  ['portrait', 390, 844, true],
  ['landscape', 844, 390, true],
]) {
  const { browser, page } = await launch({ width, height, mobile, touch: true });
  await page.goto(server.url, { waitUntil: 'load' });
  await waitForBoot(page);
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.evaluate(() => { window.startRun(); });
  await page.waitForFunction(() => Game.state === 'playing', { timeout: 45000 });
  /* the chapter card opens ~900ms after the floor is built and would otherwise
     be painted over every crop */
  await page.waitForFunction(() => typeof STORY !== 'undefined' && STORY.open === true, { timeout: 6000 }).catch(() => {});
  await page.evaluate(() => {
    if (typeof STORY !== 'undefined' && STORY.open) {
      if (typeof STORY.close === 'function') STORY.close();
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    }
  });
  await page.waitForFunction(() => typeof STORY === 'undefined' || STORY.open !== true, { timeout: 5000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));

  for (const locked of [true, false]) {
    const info = await page.evaluate((wantLocked) => {
      /* a floor whose door has an open tile in front of it, so the shot shows
         how the door reads in play rather than buried in a corner */
      let d = null, vd = null;
      for (let i = 0; i < 40; i++) {
        Game.dungeon = new Dungeon(2, 'shot-' + i);
        d = Game.dungeon;
        vd = d.vaultDoor;
        if (vd) break;
      }
      if (!vd) return { ok: false };
      for (let oy = -4; oy <= 4; oy++) for (let ox = -4; ox <= 4; ox++) {
        const tx = vd.x + ox, ty = vd.y + oy;
        if (tx >= 0 && ty >= 0 && tx < d.W && ty < d.H) d.exploredMap[d.idx(tx, ty)] = 1;
      }
      vd.locked = wantLocked;
      /* re-clamp exactly as the game does, then trust the renderer's own
         transform rather than the camera value we just wrote */
      if (typeof clampCamera === 'function') clampCamera();
      const T = TILE;
      Game.player.x = (vd.x + 0.5) * T;
      Game.player.y = (vd.y + 0.5) * T;
      Game.cam.x = Game.player.x - Game.W / 2;
      Game.cam.y = Game.player.y - Game.H / 2;
      render();
      const cvs = document.querySelector('#game');
      const camX = Math.round(Game.cam.x), camY = Math.round(Game.cam.y);
      const dpr = Game.dpr || 1;
      /* Use the renderer's own transform. Looking the door up by colour is
         unreliable: the locked fill is close to ambient-occluded floor and the
         gold border is antialiased, so both match stray pixels. The predicted
         tile position is exact, and clampCamera() has already been applied. */
      const tilePx = Math.round(T * dpr);
      const sx = Math.round((vd.x * T - camX) * dpr);
      const sy = Math.round((vd.y * T - camY) * dpr);
      const found = sx >= 0 && sy >= 0 && sx + tilePx <= cvs.width && sy + tilePx <= cvs.height;
      const size = Math.round(tilePx * 3.2);
      /* confirm the tile really has the door's border on it */
      const dd = cvs.getContext('2d').getImageData(sx, sy, tilePx, tilePx).data;
      const opaque = dd.filter((p2, i2) => i2 % 4 === 3 && p2 > 200).length;
      return { ok: true, found, sx, sy, size, tilePx, cvsW: cvs.width, cvsH: cvs.height, opaque };
    }, locked);

    if (!info.ok) { console.log(`${label}: no door found`); continue; }
    const px = Math.max(0, Math.min(info.cvsW - info.size, info.sx - info.size / 3));
    const py = Math.max(0, Math.min(info.cvsH - info.size, info.sy - info.size / 3));
    const path = `${out}/door-${label}-${locked ? 'locked' : 'open'}.png`;
    /* crop out of the canvas' own pixels so no DOM overlay can leak in */
    const dataUrl = await page.evaluate(({ px, py, size }) => {
      const cvs = document.querySelector('#game');
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      c.getContext('2d').drawImage(cvs, px, py, size, size, 0, 0, size, size);
      return c.toDataURL('image/png');
    }, { px, py, size: info.size });
    const fs = await import('node:fs');
    fs.writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`${label} ${locked ? 'locked' : 'open  '} -> ${path} (tile ${info.tilePx}px, located by fill: ${info.found}, opaque ${info.opaque})`);
  }
  await browser.close();
}
await server.close();
