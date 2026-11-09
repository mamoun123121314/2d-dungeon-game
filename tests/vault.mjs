/* Round 5 lock-in: the vault door must exist, be reachable, and actually seal.
 *
 * The user reported the door "does nothing" and sits in the wrong place. Both
 * were real, and both lived in generation rather than rendering:
 *
 *   1. lockVault() walled every mouth it did not pick, sometimes sealing the
 *      chosen mouth's only approach, so the door ended up unreachable — it
 *      looked embedded in masonry and could not be interacted with.
 *   2. The chamber was frequently not sealed at all: repairConnectivity()
 *      floods through the DOOR tile (it is walkable) and its carve pass happily
 *      dug a second entrance, so 20% of vaults could be walked into with the
 *      door still locked.
 *
 * Every assertion here is measured by walking the tile grid the same way the
 * player's collision check does, with a locked DOOR treated as solid. A BFS
 * that ignores the lock reports phantom leaks — that mistake hid bug 2 for a
 * whole round, so it is pinned below as its own check.
 */
import { launch, serve, waitForBoot, startRun } from './harness.mjs';

const SEEDS = Number(process.env.VAULT_SEEDS || 80);

const server = await serve('/home/user/2d-dungeon-game');
const { browser, page } = await launch({ width: 900, height: 600 });
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

try {
  await page.goto(server.url, { waitUntil: 'load' });
  await waitForBoot(page);

  /* Walk the grid with the shut door treated as solid, the way repairConnectivity
     and the reachability probes must. Returns the reachable set. */
  const probe = await page.evaluate(`(() => {
    const run = (treatDoorSolid) => {
      const out = [];
      for (let i = 0; i < ${SEEDS}; i++) {
        Game.floor = 1 + (i % 10);
        const d = new Dungeon(Game.floor, 'vault-' + i);
        const idx = (x, y) => y * d.W + x;
        const vd = d.vaultDoor, v = d.vaultRoom;
        const seen = new Set([idx(d.entrance.x, d.entrance.y)]);
        const q = [idx(d.entrance.x, d.entrance.y)];
        let enteredChamber = false;
        while (q.length) {
          const cur = q.pop();
          const cx = cur % d.W, cy = (cur - cx) / d.W;
          if (v && cx >= v.x && cx < v.x + v.w && cy >= v.y && cy < v.y + v.h) {
            enteredChamber = true;
            break;
          }
          for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= d.W || ny >= d.H) continue;
            if (treatDoorSolid && vd && nx === vd.x && ny === vd.y) continue;
            const n = idx(nx, ny);
            if (seen.has(n) || !d.isWalkable(nx, ny)) continue;
            seen.add(n); q.push(n);
          }
        }
        let approachable = false;
        if (vd) {
          for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            if (seen.has(idx(vd.x + dx, vd.y + dy))) approachable = true;
          }
        }
        /* The chamber is sealed by walling its own border ring, so the door is
           one of those border cells — it must sit exactly on the ring edge. */
        let onPerimeter = false;
        if (vd && v) {
          const insideX = vd.x >= v.x && vd.x < v.x + v.w;
          const insideY = vd.y >= v.y && vd.y < v.y + v.h;
          const onEdge = vd.x === v.x || vd.x === v.x + v.w - 1 ||
                         vd.y === v.y || vd.y === v.y + v.h - 1;
          onPerimeter = insideX && insideY && onEdge;
        }
        let doorTiles = 0;
        for (let y = 0; y < d.H; y++) for (let x = 0; x < d.W; x++) {
          if (d.get(x, y) === DOOR) doorTiles++;
        }
        out.push({ seed: 'vault-' + i, floor: d.floor, hasDoor: !!vd, approachable,
                   enteredChamber, onPerimeter, doorTiles, hasVault: !!v });
      }
      return out;
    };
    return { solid: run(true), walkthrough: run(false) };
  })()`);

  const s = probe.solid;
  const doors = s.filter((f) => f.hasDoor);
  const noDoor = s.filter((f) => !f.hasDoor);
  check(`${SEEDS} floors all got a vault chamber`, s.every((f) => f.hasVault),
        `${s.filter((f) => !f.hasVault).length} missing`);
  check(`every floor has a vault door`, noDoor.length === 0,
        noDoor.length ? `${noDoor.length} without: ${noDoor.slice(0,3).map((f)=>f.seed).join(', ')}` : '');
  check(`exactly one DOOR tile per floor`, doors.every((f) => f.doorTiles === 1),
        doors.filter((f) => f.doorTiles !== 1).map((f) => `${f.seed}:${f.doorTiles}`).join(', ') || '');
  check(`door sits on the chamber perimeter`, doors.every((f) => f.onPerimeter),
        doors.filter((f) => !f.onPerimeter).map((f) => f.seed).join(', ') || '');

  /* Bug 1: the door was buried in masonry and could not be reached. */
  const unreachable = doors.filter((f) => !f.approachable);
  check(`every door is reachable from the entrance`, unreachable.length === 0,
        unreachable.length ? `${unreachable.length} unreachable: ${unreachable.slice(0,3).map((f)=>f.seed).join(', ')}` : '');

  /* Bug 2: the chamber could be entered while the door was still locked. */
  const leaked = doors.filter((f) => f.enteredChamber);
  check(`no vault can be entered while locked`, leaked.length === 0,
        leaked.length ? `${leaked.length} leaked, e.g. ${leaked.slice(0,3).map((f)=>f.seed).join(', ')}` : '');

  /* The trap that hid bug 2: a flood that ignores the lock "proves" the vault
     is open. This asserts the method matters, so a future edit cannot quietly
     remove the lock check and still pass. */
  const naiveLeaks = probe.walkthrough.filter((f) => f.hasDoor && f.enteredChamber).length;
  check(`flooding through the shut door does enter the chamber (guard is load-bearing)`,
        naiveLeaks > 0, `a lock-ignoring flood reported ${naiveLeaks} enterable`);

  /* The seal must not come at the cost of the level: the stairs have to be
     reachable, and the floor must not be sliced into disconnected chunks. */
  const conn = await page.evaluate(`(() => {
    let stairsMissing = 0, worstStranded = 0, totalStranded = 0, n = 0;
    for (let i = 0; i < ${SEEDS}; i++) {
      Game.floor = 1 + (i % 10);
      const d = new Dungeon(Game.floor, 'vault-' + i);
      const idx = (x, y) => y * d.W + x;
      const vd = d.vaultDoor;
      const seen = new Set([idx(d.entrance.x, d.entrance.y)]);
      const q = [idx(d.entrance.x, d.entrance.y)];
      while (q.length) {
        const cur = q.pop();
        const cx = cur % d.W, cy = (cur - cx) / d.W;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= d.W || ny >= d.H) continue;
          if (vd && vd.locked && nx === vd.x && ny === vd.y) continue;
          const n2 = idx(nx, ny);
          if (seen.has(n2) || !d.isWalkable(nx, ny)) continue;
          seen.add(n2); q.push(n2);
        }
      }
      if (!seen.has(idx(d.stairs.x, d.stairs.y))) stairsMissing++;
      let st = 0;
      for (let y = 1; y < d.H - 1; y++) for (let x = 1; x < d.W - 1; x++) {
        if (!d.isWalkable(x, y) || d.isVaultInterior(x, y)) continue;
        if (!seen.has(idx(x, y))) st++;
      }
      totalStranded += st; worstStranded = Math.max(worstStranded, st); n++;
    }
    return { stairsMissing, worstStranded, avgStranded: totalStranded / n };
  })()`);

  check(`stairs reachable on every floor`, conn.stairsMissing === 0,
        `${conn.stairsMissing} floors with walls between entrance and stairs`);
  check(`sealing does not strand the level`, conn.worstStranded <= 20,
        `worst floor stranded ${conn.worstStranded} cells (avg ${conn.avgStranded.toFixed(1)})`);

  /* The door has to be usable: it can be opened once its requirement is met,
     and opening it really does let the player through. */
  const wiring = await page.evaluate(`(() => {
    Game.floor = 3;
    const d = new Dungeon(3, 'vault-wiring');
    Game.dungeon = d;
    if (!d.vaultDoor) return { noDoor: true };
    const vd = d.vaultDoor;
    const lockedAtStart = vd.locked;
    /* the chamber must be unreachable right now */
    const idx = (x, y) => y * d.W + x;
    const walk = (solid) => {
      const seen = new Set([idx(d.entrance.x, d.entrance.y)]);
      const q = [idx(d.entrance.x, d.entrance.y)];
      while (q.length) {
        const cur = q.pop();
        const cx = cur % d.W, cy = (cur - cx) / d.W;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= d.W || ny >= d.H) continue;
          if (solid && nx === vd.x && ny === vd.y) continue;
          const n = idx(nx, ny);
          if (seen.has(n) || !d.isWalkable(nx, ny)) continue;
          seen.add(n); q.push(n);
        }
      }
      return seen;
    };
    const before = walk(true);
    const v = d.vaultRoom;
    const reachedChamber =
      before.has(idx(v.x + 1, v.y + 1)) || before.has(idx(v.x + 1, v.y));
    /* now unlock it, exactly as the game does, and walk again */
    vd.locked = false;
    const after = walk(false);
    const reachedAfter = after.has(idx(v.x + 1, v.y + 1)) || after.has(idx(v.x + 1, v.y));
    return { lockedAtStart, doorTiles: 1, reachedChamber, reachedAfter, hasKeyField: 'needsKey' in d };
  })()`);
  check(`vault door starts locked`, wiring.lockedAtStart === true, `locked=${wiring.lockedAtStart}`);
  if (wiring.noDoor) {
    check('door usable', false, 'no vault door on floor 3');
  } else {
    check(`locked chamber cannot be entered`, wiring.reachedChamber === false,
          wiring.reachedChamber ? 'walked into the chamber with the door shut' : '');
    check(`unlocking the door opens the chamber`, wiring.reachedAfter === true,
          wiring.reachedAfter ? '' : 'still cut off after unlock — the door would "do nothing"');
  }
  check(`dungeon exposes the key requirement`, wiring.hasKeyField === true, 'needsKey missing');

  /* A vault is only fair if the key exists AND can be collected. The key crate
     is the guaranteed source; measured before this check, 6 of 120 floors put
     it in a pocket the entrance could not reach, which made the door
     permanently locked and the floor's reward unobtainable. */
  await startRun(page);
  const keys = await page.evaluate(`(() => {
    let floors = 0, missing = 0, unreachable = 0, samples = [];
    for (let i = 0; i < 60; i++) {
      Game.floor = 2 + (i % 8);
      Game.dungeon = new Dungeon(Game.floor, 'key-' + i);
      const d = Game.dungeon;
      if (!d.vaultDoor) continue;
      floors++;
      Game.props.length = 0;
      if (typeof spawnProps === 'function') spawnProps(d);
      const crates = Game.props.filter((p) => p.keyCrate || (p.loot && p.loot.key));
      if (!crates.length) { missing++; continue; }
      const idx = (x, y) => y * d.W + x;
      const vd = d.vaultDoor;
      const seen = new Set([idx(d.entrance.x, d.entrance.y)]);
      const q = [idx(d.entrance.x, d.entrance.y)];
      while (q.length) {
        const cur = q.pop();
        const cx = cur % d.W, cy = (cur - cx) / d.W;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= d.W || ny >= d.H) continue;
          if (vd && vd.locked && nx === vd.x && ny === vd.y) continue;
          const n = idx(nx, ny);
          if (seen.has(n) || !d.isWalkable(nx, ny)) continue;
          seen.add(n); q.push(n);
        }
      }
      const okOne = crates.some((p) => seen.has(idx(Math.floor(p.x / 32), Math.floor(p.y / 32))));
      if (!okOne) { unreachable++; if (samples.length < 3) samples.push(i); }
    }
    return { floors, missing, unreachable, samples };
  })()`);
  check(`a key exists on every floor with a vault`, keys.missing === 0,
        `${keys.missing}/${keys.floors} floors had no key crate`);
  check(`the key can always be reached`, keys.unreachable === 0,
        `${keys.unreachable}/${keys.floors} floors put the key out of reach`);

  /* Rendering: the door must draw at the tile it occupies, and a locked door
     must be visually distinct from an unlocked one — "it does nothing there"
     can mean nothing appears where the player taps. */
  await startRun(page);
  const draw = await page.evaluate(`(() => {
    Game.floor = 2;
    Game.dungeon = new Dungeon(2, 'vault-draw');
    const d = Game.dungeon;
    const vd = d.vaultDoor;
    if (!vd) return { noDoor: true };
    const T = TILE, dpr = Game.dpr || 1;
    /* the door only draws once explored (fog of war) */
    for (let oy = -3; oy <= 3; oy++) for (let ox = -3; ox <= 3; ox++) {
      const tx2 = vd.x + ox, ty2 = vd.y + oy;
      if (tx2 >= 0 && ty2 >= 0 && tx2 < d.W && ty2 < d.H) d.exploredMap[d.idx(tx2, ty2)] = 1;
    }
    /* put the hero on the door and let the camera follow, as in play */
    Game.player.x = (vd.x + 0.5) * T;
    Game.player.y = (vd.y + 0.5) * T;
    Game.cam.x = Game.player.x - Game.W / 2;
    Game.cam.y = Game.player.y - Game.H / 2;
    const cvs = document.querySelector('canvas');
    const ctx = cvs.getContext('2d');
    /* sample the door's own tile using the renderer's transform */
    const grab = () => {
      const camX = Math.round(Game.cam.x), camY = Math.round(Game.cam.y);
      const px = Math.round((vd.x * T - camX) * dpr);
      const py = Math.round((vd.y * T - camY) * dpr);
      const sz = Math.round(T * dpr);
      if (px < 0 || py < 0 || px + sz > cvs.width || py + sz > cvs.height) return null;
      return Array.from(ctx.getImageData(px, py, sz, sz).data);
    };
    /* render() is the real entry point the game loop calls */
    vd.locked = true;
    render();
    const lockedPixels = grab();
    vd.locked = false;
    render();
    const openPixels = grab();
    vd.locked = true;
    if (lockedPixels === null || openPixels === null) return { offscreen: true };
    let diff = 0;
    for (let i2 = 0; i2 < lockedPixels.length; i2++) if (lockedPixels[i2] !== openPixels[i2]) diff++;
    const nonBlank = lockedPixels.some((p, i2) => i2 % 4 === 3 && p > 0);
    const opaque = lockedPixels.filter((p, i2) => i2 % 4 === 3 && p > 200).length;
    return { noDoor: false, nonBlank, diff, opaque, tile: [vd.x, vd.y] };
  })()`);
  check('the door tile renders something', draw.noDoor ? false : draw.nonBlank === true,
        draw.noDoor ? 'no door' : (draw.offscreen ? 'door tile off screen' : 'blank framebuffer at the door'));
  check('locked and unlocked doors look different', draw.noDoor ? false : draw.diff > 0,
        draw.noDoor ? 'no door' : `changed pixels: ${draw.diff}`);
} catch (e) {
  console.error('  FAIL  threw:', e && e.message);
  failures++;
} finally {
  await browser.close();
  await server.close();
}

console.log(failures === 0 ? '\nvault: PASS' : `\nvault: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
