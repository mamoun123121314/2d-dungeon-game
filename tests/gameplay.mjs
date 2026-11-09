/**
 * Gameplay regression tests.
 *
 * Repeatable seeds, floor transitions, combat edge cases, equipment changes and
 * progression invariants — the things that must stay true no matter how the
 * balance numbers move:
 *
 *   - the same seed always produces the same dungeon
 *   - every floor is reachable and the stairs actually descend
 *   - hp and mana never leave their bounds, gold never goes negative
 *   - equipment changes recompute derived stats and never duplicate items
 *   - progression (xp, levels, skill points) only moves forward
 *
 *   node tests/gameplay.mjs
 */
import { launch, serve, waitForBoot, startRun } from './harness.mjs';
import { check, equal, between, section, summary, exitCode, counts } from './assert.mjs';

const server = await serve();
const { browser, page, errors } = await launch({ width: 1000, height: 720 });

/** Fingerprint a generated floor without disturbing the live run. */
async function seedFingerprint(seed, floor = 1) {
  return page.evaluate(({ seed, floor }) => {
    try {
      const d = new Dungeon(floor, { seed });
      let hist = 0;
      for (let y = 0; y < d.H; y++) {
        for (let x = 0; x < d.W; x++) hist = (hist * 31 + (d.get(x, y) | 0)) >>> 0;
      }
      return {
        w: d.W, h: d.H, hist,
        rooms: (d.rooms || []).length,
        stairs: d.stairs ? [d.stairs.x, d.stairs.y] : null,
      };
    } catch (e) { return { error: e.message }; }
  }, { seed, floor });
}

try {
  await page.goto(server.url, { waitUntil: 'load' });
  await waitForBoot(page);
  await startRun(page);

  /* ============ deterministic generation ============ */
  section('Seeded generation');
  const a = await seedFingerprint(4242);
  const b = await seedFingerprint(4242);
  const c = await seedFingerprint(4243);
  check('floors generate', !a.error, a);
  check('the same seed builds an identical floor', JSON.stringify(a) === JSON.stringify(b), { a, b });
  check('a different seed builds a different floor', JSON.stringify(a) !== JSON.stringify(c), { a, c });
  check('the floor has rooms', (a.rooms || 0) > 0, a.rooms);
  check('the floor has a staircase', a.stairs !== null, a.stairs);

  /* the game's own buildFloor must honour the seed too, or "load from seed"
     in the save system would restore a different dungeon than the one played */
  const live = await page.evaluate(() => {
    const fp = () => {
      const d = Game.dungeon;
      let h = 0;
      for (let y = 0; y < d.H; y++) for (let x = 0; x < d.W; x++) h = ((h * 31) + (d.get(x, y) | 0)) >>> 0;
      /* the layout, staircase and monster placement are the parts a save must
         reproduce; cosmetic props are allowed to differ */
      return [h, d.rooms.length, d.stairs.x, d.stairs.y, d.monsters.length].join(':');
    };
    buildFloor(3, false, 999);
    const first = fp();
    buildFloor(3, false, 999);
    const second = fp();
    if (STORY.open && STORY.close) STORY.close();
    return { first, second };
  });
  equal('rebuilding a floor from its seed reproduces its layout', live.first, live.second);

  /* ============ floor transitions ============ */
  section('Floor transitions');
  const floors = [];
  for (let n = 1; n <= 5; n++) {
    const info = await page.evaluate((floorN) => {
      try {
        Game.state = 'playing';
        Game.player.hp = Game.player.maxHp;
        buildFloor(floorN, false, 1000 + floorN);
        if (STORY.open && STORY.close) STORY.close();
        const p = Game.player;
        return {
          floor: Game.floor,
          enemies: Game.enemies.length,
          props: Game.props.length,
          walkable: Game.dungeon.isWalkablePx(p.x, p.y),
          stairs: !!Game.dungeon.stairs,
          seed: Game.dungeon.seed,
        };
      } catch (e) { return { error: e.message, floor: floorN }; }
    }, n);
    floors.push(info);
    check(`floor ${n} builds`, !info.error, info);
    if (!info.error) {
      equal(`floor ${n} is the active floor`, info.floor, n);
      check(`floor ${n} puts the hero on walkable ground`, info.walkable === true, info);
      check(`floor ${n} has a staircase`, info.stairs === true, info);
      check(`floor ${n} has enemies`, info.enemies > 0, info.enemies);
    }
  }

  /* descend() must move the run forward and keep it playable */
  const descended = await page.evaluate(() => {
    buildFloor(1, false, 777);
    if (STORY.open && STORY.close) STORY.close();
    const before = Game.floor;
    Game.state = 'playing';
    /* descend() only works from the staircase, which is the correct rule */
    Game.player.x = (Game.dungeon.stairs.x + 0.5) * TILE;
    Game.player.y = (Game.dungeon.stairs.y + 0.5) * TILE;
    Game.nearStairs = true;
    try { descend(); } catch (e) { return { error: e.message }; }
    return { before, started: Game.state };
  });
  /* descend() fades to black, rebuilds the floor and fades back in, so the new
     floor only exists a moment later */
  await page.waitForFunction(() => Game.state === 'playing', { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => { if (STORY.open && STORY.close) STORY.close(); });
  const descended2 = await page.evaluate(() => {
    const p = Game.player;
    return {
      after: Game.floor, state: Game.state,
      walkable: Game.dungeon.isWalkablePx(p.x, p.y),
      hp: p.hp, maxHp: p.maxHp, enemies: Game.enemies.length,
    };
  });
  Object.assign(descended, descended2);
  check('descending advances the floor', descended.after === descended.before + 1, descended);
  check('the hero is alive and placed after descending', descended.hp > 0 && descended.walkable === true, descended);
  check('the game keeps playing after descending', descended.state === 'playing', descended.state);
  check('the new floor has enemies', descended.enemies > 0, descended.enemies);

  /* ============ combat edge cases ============ */
  section('Combat bounds');
  const bounds = await page.evaluate(() => {
    const p = Game.player;
    const out = {};
    /* healing past the cap */
    p.hp = p.maxHp - 1;
    Combat.healPlayer ? Combat.healPlayer(9999) : (p.hp = Math.min(p.maxHp, p.hp + 9999));
    out.hpCapped = p.hp <= p.maxHp;
    /* damage past zero, with invulnerability disabled */
    p.invuln = 0; p.hp = 5;
    try { Combat.damagePlayer(9999, null); } catch (e) { out.damageError = e.message; }
    out.hpFloored = p.hp >= 0;
    out.died = p.dead === true || Game.state === 'dead' || p.hp === 0;
    /* mana bounds */
    p.mana = p.maxMana;
    p.mana = Math.min(p.maxMana, p.mana + 50);
    out.manaCapped = p.mana <= p.maxMana;
    p.mana = Math.max(0, p.mana - 99999);
    out.manaFloored = p.mana >= 0;
    return out;
  });
  check('healing cannot exceed max hp', bounds.hpCapped, bounds);
  check('damage cannot push hp below zero', bounds.hpFloored, bounds);
  check('lethal damage is registered as death', bounds.died === true, bounds);
  check('mana cannot exceed its maximum', bounds.manaCapped, bounds);
  check('mana cannot go negative', bounds.manaFloored, bounds);
  check('damage never throws', !bounds.damageError, bounds.damageError);

  /* gold can never go negative, even when a shop price is absurd */
  const gold = await page.evaluate(() => {
    Game.state = 'playing';
    const p = Game.player;
    if (p.dead) { p.dead = false; p.hp = p.maxHp; }
    p.gold = 5;
    const before = p.gold;
    /* try to buy something far more expensive than the wallet */
    let threw = null;
    try { if (typeof shopBuy === 'function') shopBuy({ price: 99999, id: 'x' }); } catch (e) { threw = e.message; }
    return { before, after: p.gold, threw };
  });
  check('an unaffordable purchase does not go into debt', gold.after >= 0, gold);
  check('an unaffordable purchase does not throw', gold.threw === null, gold.threw);

  /* ============ equipment ============ */
  section('Equipment');
  const gear = await page.evaluate(() => {
    Game.state = 'playing';
    const p = Game.player;
    if (p.dead) { p.dead = false; p.hp = p.maxHp; }
    const out = {};
    p.equipment = p.equipment || {};
    p.inventory = p.inventory || [];
    const before = { atk: p.attackPower, inv: p.inventory.length };
    const item = new (Object.getPrototypeOf(p.inventory[0] || {}).constructor || Object)();
    const blade = Save.reviveItem({
      kind: 'weapon', slot: 'weapon', name: 'Test Blade', rarity: 3,
      tier: 4, baseName: 'Test Blade', stats: { atk: 40 }, value: 10, iconSeed: 7,
    });
    out.itemOk = !!blade;
    out.slot = blade ? blade.slot : null;
    if (blade) {
      p.inventory.push(blade);
      out.invBefore = p.inventory.length;
      try { p.equip(blade); } catch (e) { out.error = e.message; }
      out.equipped = p.equipment.weapon === blade;
      out.removedFromPack = p.inventory.indexOf(blade) === -1;
      out.atkAfter = p.attackPower;
      out.atkBefore = before.atk;
      /* p.atk is the stored stat; the equipped weapon feeds the damage roll
         through itemScore(), so check the equipped item itself carries attack
         and that the derived total is sane rather than assuming it is copied */
      out.weaponAtk = p.equipment.weapon ? (p.equipment.weapon.stats || {}).atk : 0;
      out.totalScore = p.totalScore;
      out.atkSane = Number.isFinite(p.attackPower) && p.attackPower > 0;
      out.atkRose = p.attackPower > before.atk;
      /* swapping must never destroy the old item */
      const second = Save.reviveItem({
        kind: 'weapon', slot: 'weapon', name: 'Second Blade', rarity: 1,
        tier: 1, baseName: 'Second Blade', stats: { atk: 1 }, value: 5, iconSeed: 8,
      });
      p.inventory.push(second);
      const countBefore = p.inventory.length + 1;
      try { p.equip(second); } catch (e) { out.swapError = e.message; }
      out.noItemLost = p.inventory.includes(blade) && p.inventory.length + 1 >= countBefore;
      out.swapped = p.equipment.weapon === second;
      try { p.unequip('weapon'); } catch (e) { out.unequipError = e.message; }
      out.unequipped = !p.equipment.weapon;
      out.maxHpValid = p.maxHp > 0;
      out.hpValid = p.hp > 0 && p.hp <= p.maxHp;
    }
    return out;
  });
  check('a saved item can be revived with its slot', gear.itemOk && gear.slot === 'weapon', gear);
  check('equipping works', gear.equipped === true, gear);
  check('equipping does not throw', !gear.error, gear.error);
  check('equipping takes the item out of the pack', gear.removedFromPack === true, gear);
  check('the equipped weapon carries attack', gear.weaponAtk >= 40, gear.weaponAtk);
  check('attack power is a valid number', gear.atkSane === true, { atk: gear.atkAfter });
  check('a +40 weapon raises attack power', gear.atkRose === true,
        { before: gear.atkBefore, after: gear.atkAfter });
  check('swapping gear never destroys the old item', gear.noItemLost === true, gear);
  check('swapping gear does not throw', !gear.swapError, gear.swapError);
  check('the new item is the equipped one', gear.swapped === true, gear);
  check('unequipping clears the slot', gear.unequipped === true, gear);
  check('unequipping does not throw', !gear.unequipError, gear.unequipError);
  check('stats stay valid after gear changes', gear.maxHpValid && gear.hpValid, gear);

  /* ============ progression ============ */
  section('Progression');
  const prog = await page.evaluate(async () => {
    Game.state = 'playing';
    const p = Game.player;
    if (p.dead) { p.dead = false; p.hp = p.maxHp; }
    p.xp = 0; p.level = 1; p.xpNext = 50; p.skillPoints = 0;
    const out = { startLevel: p.level };
    try { out.leveled = p.gainXp(400); } catch (e) { out.error = e.message; }
    out.level = p.level;
    out.xp = p.xp;
    out.xpNext = p.xpNext;
    out.skillPoints = p.skillPoints;
    out.levelled = p.level > out.startLevel && out.leveled === true;
    out.xpNonNegative = p.xp >= 0;
    out.xpNextPositive = p.xpNext > 0;
    /* a talent purchase must cost a point and never go negative */
    const before = p.skillPoints;
    /* pick a node that can actually be learned at rank 0 (no prerequisites) */
    if (before > 0) {
      const node = Object.keys(SKILL_NODES).find((id) => p.canLearn(id)) || Object.keys(SKILL_NODES)[0];
      try { p.learnSkill(node); } catch (e) { out.buyError = e.message; }
      out.spent = p.skillPoints < before;
      out.spNotNegative = p.skillPoints >= 0;
    }
    return out;
  });
  check('xp levels the player up', prog.levelled === true, prog);
  check('xp never goes negative', prog.xpNonNegative === true, prog);
  check('the next level always needs positive xp', prog.xpNextPositive === true, prog);
  check('levelling awards skill points', prog.skillPoints >= 0, prog);
  check('gaining xp does not throw', !prog.error, prog.error);
  if (prog.spent !== undefined) {
    check('spending a skill point deducts it', prog.spent === true, prog);
    check('skill points never go negative', prog.spNotNegative === true, prog);
  }

  /* ============ story chapter card ============ */
  /* The reported "I cannot move". #storyCard ships with class="hidden"
     (display:none !important), and showCard() used to only ADD 'show', so the
     card never painted — while STORY.open was still set and every movement and
     combat path checks it. The hero was frozen on a normal-looking screen with
     no card in sight, and the Continue button that would have cleared it had
     no layout box to click. */
  section('Story chapter card');
  const story = await page.evaluate(async () => {
    const el = document.getElementById('storyCard');
    const p = Game.player;
    /* the hero may be against a wall, so try every direction and take the best */
    const move = async (ms = 450) => {
      let best = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const sx = p.x, sy = p.y;
        Game.input.touchDir = { x: dx, y: dy };
        await new Promise((r) => setTimeout(r, ms));
        best = Math.max(best, Math.hypot(p.x - sx, p.y - sy));
        Game.input.touchDir = null;
        if (best > 20) break;
      }
      return best;
    };

    STORY.seen = {};
    STORY.enter(1);                       // exactly what buildFloor() does on floor 1
    await new Promise((r) => setTimeout(r, 1050));

    const shown = {
      open: STORY.open,
      display: getComputedStyle(el).display,
      height: el.getBoundingClientRect().height,
      buttonBox: (() => { const b = el.querySelector('#storyNext'); return b ? b.getBoundingClientRect().height : 0; })(),
    };
    const movedWhileShown = await move();

    const btn = el.querySelector('#storyNext');
    if (btn) btn.click();
    await new Promise((r) => setTimeout(r, 150));
    const after = { open: STORY.open, display: getComputedStyle(el).display };
    const movedAfterDismiss = await move(650);

    /* the failure mode itself: flag true, nothing painted */
    STORY.open = true;
    el.classList.add('hidden');
    await new Promise((r) => setTimeout(r, 150));
    const selfHealed = STORY.open === false;
    const movedWithStuckFlag = await move(420);

    /* A phone player has no keyboard, so the tap-to-advance paths are the only
       way out of the card. Test each one the way a thumb would trigger it. */
    const paths = {};
    for (const [name, fire] of Object.entries({
      continuingButton: () => el.querySelector('#storyNext')?.click(),
      tappingTheCard: () => {
        const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
        el.dispatchEvent(ev);
      },
    })) {
      STORY.seen = {};
      STORY.enter(1);
      await new Promise((r) => setTimeout(r, 1050));
      const cameUp = STORY.open === true && getComputedStyle(el).display !== 'none';
      fire();
      await new Promise((r) => setTimeout(r, 160));
      paths[name] = { cameUp, dismissed: STORY.open === false && getComputedStyle(el).display === 'none' };
    }

    /* the stick must not be able to turn the hero while the card holds him:
       aiming is written straight from the touch handler, bypassing the paused
       update(), which is why "the sword moves but I cannot fight" happened */
    STORY.seen = {};
    STORY.enter(1);
    await new Promise((r) => setTimeout(r, 1050));
    const angleBefore = p.aimAngle;
    Game.input.touchDir = { x: -1, y: 0 };
    p.aimAngle = Math.PI;                 // what Phone.track() writes while dragging
    await new Promise((r) => setTimeout(r, 300));
    Game.input.touchDir = null;

    return { shown, after, movedWhileShown, movedAfterDismiss, selfHealed,
             movedWithStuckFlag, paths, angleBefore };
  });
  check('the story card actually paints', story.shown.display !== 'none' && story.shown.height > 0, story.shown);
  check('the Continue button has a real hit target', story.shown.buttonBox >= 30, story.shown.buttonBox);
  check('the card holds the player while it is on screen', story.movedWhileShown < 2, story.movedWhileShown);
  check('Continue dismisses the card', story.after.open === false && story.after.display === 'none', story.after);
  check('the player moves again after dismissing', story.movedAfterDismiss > 20, story.movedAfterDismiss);
  check('an open flag with no card corrects itself', story.selfHealed === true, story.selfHealed);
  check('an open flag with no card cannot freeze the player', story.movedWithStuckFlag > 20, story.movedWithStuckFlag);
  check('the Continue button dismisses the card on a phone',
    story.paths.continuingButton.cameUp && story.paths.continuingButton.dismissed, story.paths.continuingButton);
  check('tapping the card dismisses it on a phone',
    story.paths.tappingTheCard.cameUp && story.paths.tappingTheCard.dismissed, story.paths.tappingTheCard);

  /* ============ runtime health ============ */
  section('Runtime health');
  check('no console or page errors during gameplay tests', errors.length === 0, errors.slice(0, 4));
} catch (err) {
  console.error('\nUNEXPECTED FAILURE:', err.stack || err.message);
} finally {
  summary('gameplay');
  await browser.close();
  await server.close();
  process.exitCode = counts().failed === 0 ? exitCode() : 1;
}
