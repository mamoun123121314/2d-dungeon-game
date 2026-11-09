/**
 * Phone layout and touch-control tests.
 *
 * Honest scope: this drives a real Chromium with a phone viewport, a coarse
 * pointer, touch events and safe-area insets emulated. That catches broken
 * layout, missing hit targets, wrong DOM order and stuck virtual sticks. It
 * cannot reproduce iOS Safari's viewport quirks, real thumb physics, or the
 * wide range of Android browsers, so the README keeps that limit explicit.
 *
 *   node tests/mobile.mjs
 */
import fs from 'node:fs';
import { launch, serve, waitForBoot, startRun } from './harness.mjs';
import { check, equal, section, summary, exitCode, counts } from './assert.mjs';

fs.mkdirSync('tests/screens', { recursive: true });

const PHONES = [
  { name: 'iPhone SE', width: 375, height: 667, dpr: 2, inset: { top: 20, bottom: 0 } },
  { name: 'iPhone 14 Pro', width: 393, height: 852, dpr: 3, inset: { top: 59, bottom: 34 } },
  { name: 'Pixel 7', width: 412, height: 915, dpr: 2.6, inset: { top: 24, bottom: 16 } },
  { name: 'small Android', width: 360, height: 640, dpr: 2, inset: { top: 24, bottom: 0 } },
];

const server = await serve();
let browser;
const shotPath = (n) => `tests/screens/${n}.png`;

/* Emulate the safe-area insets the CSS reads through env(). Chromium has no
   way to set env() directly, so the test page defines the four variables the
   stylesheet would see and the checks assert the layout respects padding. */
const INSET_CSS = (inset) => `
  :root {
    --test-safe-top: ${inset.top}px;
    --test-safe-bottom: ${inset.bottom}px;
  }
`;

async function bootPhone(phone, { landscape = false } = {}) {
  const width = landscape ? phone.height : phone.width;
  const height = landscape ? phone.width : phone.height;
  const session = await launch({ width, height, mobile: true, touch: true });
  const { page, errors } = session;

  /* override device scale so dpr matches the real handset */
  await page.emulate({
    viewport: {
      width, height,
      deviceScaleFactor: phone.dpr,
      isMobile: true,
      hasTouch: true,
      isLandscape: landscape,
    },
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 ' +
               '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  });
  await page.evaluateOnNewDocument((css) => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = css;
      document.head.appendChild(s);
    });
  }, INSET_CSS(phone.inset));

  await page.goto(server.url, { waitUntil: 'load' });
  await waitForBoot(page);
  return session;
}

try {
  for (const phone of PHONES) {
    section(`${phone.name} (${phone.width}x${phone.height} @${phone.dpr}x)`);
    const session = await bootPhone(phone);
    const { page, errors } = session;
    try {
      const mode = await page.evaluate(() => ({
        isPhone: Game.isPhone,
        bodyClass: document.body.classList.contains('is-phone'),
        enabled: Phone.enabled,
        coarse: matchMedia('(pointer: coarse)').matches,
        touchPoints: navigator.maxTouchPoints,
        dpr: Game.dpr,
        W: Game.W, H: Game.H,
      }));
      check('phone layout is detected', mode.isPhone === true && mode.enabled === true, mode);
      check('body gets the is-phone class', mode.bodyClass, mode);
      equal('canvas logical width matches the viewport', mode.W, phone.width);
      equal('canvas logical height matches the viewport', mode.H, phone.height);
      check('device pixel ratio is capped for phones', mode.dpr <= 1.5, mode.dpr);


      /* ---- start the run and drive the stick with real touch events ---- */
      await startRun(page);

      const touchInfo = await page.evaluate(() => ({
        state: Game.state,
        player: !!Game.player,
        walkable: Game.player && Game.dungeon ? Game.dungeon.isWalkablePx(Game.player.x, Game.player.y) : null,
      }));
      check('a run starts on a phone', touchInfo.state === 'playing' && touchInfo.player, touchInfo);
      check('the hero spawns on walkable ground', touchInfo.walkable === true, touchInfo);

      /* ---- controls are reachable and on screen ---- */
      const controls = await page.evaluate(() => {
        const rect = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return {
            x: r.x, y: r.y, w: r.width, h: r.height,
            visible: style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0,
          };
        };
        const ids = ['touchLayer', 'stickZone', 'stickBase', 'stickKnob', 'touchActions'];
        const out = {};
        for (const id of ids) out[id] = rect(document.getElementById(id));
        const buttons = Array.from(document.querySelectorAll('#touchActions .tBtn'));
        out.buttons = buttons.map((b) => ({ id: b.dataset.action || b.id, ...rect(b) }));
        return out;
      });
      check('joystick zone exists', controls.stickZone && controls.stickZone.visible, controls.stickZone);
      check('action rail exists', controls.touchActions && controls.touchActions.visible, controls.touchActions);
      check('action rail has buttons', controls.buttons.length >= 3, controls.buttons.length);

      /* hit targets: 44px is the usual accessibility floor for touch */
      const small = controls.buttons.filter((b) => b.visible && (b.w < 40 || b.h < 40));
      check('every action button is at least 40px', small.length === 0, small.map((b) => `${b.id}:${Math.round(b.w)}x${Math.round(b.h)}`));

      const offscreen = controls.buttons.filter((b) => b.visible
        && (b.x < -1 || b.y < -1 || b.x + b.w > phone.width + 1 || b.y + b.h > phone.height + 1));
      check('no action button sits off screen', offscreen.length === 0,
            offscreen.map((b) => `${b.id}@${Math.round(b.x)},${Math.round(b.y)}`));

      /* the portrait "rotate for more room" hint is pointer-events:none, but it
         used to be drawn straight over SLAM and PACK — the player could not see
         the button they were pressing. It must never overlap a control. */
      const nudge = await page.evaluate(() => {
        const el = document.getElementById('rotateNudge');
        const shown = getComputedStyle(el).display !== 'none';
        const n = el.getBoundingClientRect();
        const btns = Array.from(document.querySelectorAll('#touchActions .tBtn'))
          .filter((b) => getComputedStyle(b).display !== 'none')
          .map((b) => ({ id: b.dataset.action, r: b.getBoundingClientRect() }));
        const covered = btns.filter((b) => shown && !(b.r.right < n.left || b.r.left > n.right
          || b.r.bottom < n.top || b.r.top > n.bottom)).map((b) => b.id);
        return { shown, covered, rect: { top: Math.round(n.top), bottom: Math.round(n.bottom) } };
      });
      check('the portrait orientation hint covers no controls', nudge.covered.length === 0, nudge);

      /* ---- nothing is displayed twice, and no phone vital is missing ----
         The reported "double of everything": the top rail drew Ember's health
         bar AND the bottom-left chip drew her again, while the XP bar behind
         the hidden #playerHud was invisible on a phone. One readout per fact. */
      const hud = await page.evaluate(() => {
        const shown = (el) => {
          if (!el) return false;
          const b = el.getBoundingClientRect();
          return getComputedStyle(el).display !== 'none' && b.height > 0;
        };
        /* leaf elements only: a wrapper's textContent contains its children */
        const leaves = Array.from(document.querySelectorAll('body *'))
          .filter((el) => el.children.length === 0 && shown(el));
        const emberLabels = leaves
          .filter((el) => /^EMBER\b/i.test((el.textContent || '').trim()))
          .map((el) => (el.id || el.className || el.tagName) + ':' + el.textContent.trim());
        /* Ember's HP should be readable exactly once */
        const emberBars = leaves.filter((el) => /^EMBER\b/i.test((el.textContent || '').trim())
          || /^EMBER DOWN$/i.test((el.textContent || '').trim())).length;
        const xpEl = document.getElementById('pXpText');
        const saveEl = document.getElementById('saveToast');
        const slash = document.getElementById('tAttack');
        const sb = saveEl ? saveEl.getBoundingClientRect() : null;
        const ab = slash ? slash.getBoundingClientRect() : null;
        const overlap = !!(sb && ab && sb.width > 0
          && !(sb.right < ab.left || sb.left > ab.right || sb.bottom < ab.top || sb.top > ab.bottom));
        return {
          emberLabels,
          emberBars,
          railXpText: xpEl ? xpEl.textContent : null,
          railXpVisible: shown(xpEl),
          desktopXpVisible: shown(document.getElementById('xpBar')),
          xpBarCount: leaves.filter((el) => /XP$/.test((el.textContent || '').trim())).length,
          saveToastOverSlash: overlap,
          saveToastLeft: sb ? Math.round(sb.left) : null,
        };
      });
      check('Ember is shown once, not twice', hud.emberBars === 1, hud.emberLabels);
      check('the phone can see the XP bar', hud.railXpVisible === true && /XP$/.test(hud.railXpText || ''), hud.railXpText);
      check('XP is not displayed twice', hud.xpBarCount === 1, hud.xpBarCount);
      check('the autosave stamp does not sit on the attack button', hud.saveToastOverSlash === false, hud);

      /* #stickZone is the whole thumb region (46% x 62% of the screen); the
         thing that must clear the home indicator is the drawn ring, whose
         position is decided at touch time by Phone.place(). */
      const ring = await page.evaluate(async () => {
        const zone = document.getElementById('stickZone');
        const r = zone.getBoundingClientRect();
        const t = new Touch({ identifier: 1, target: zone,
          clientX: r.x + r.width / 2, clientY: window.innerHeight - 6 });
        zone.dispatchEvent(new TouchEvent('touchstart', {
          bubbles: true, cancelable: true,
          touches: [t], targetTouches: [t], changedTouches: [t],
        }));
        await new Promise((res) => setTimeout(res, 60));
        const base = document.getElementById('stickBase').getBoundingClientRect();
        const out = { top: Math.round(base.top), bottom: Math.round(base.bottom), base: Math.round(base.height) };
        zone.dispatchEvent(new TouchEvent('touchend', {
          bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [t],
        }));
        return out;
      });
      /* touching the very bottom of the screen must not put the ring under the
         gesture bar: Phone.place() subtracts the measured inset */
      check('the drawn joystick clears the home indicator',
            ring.bottom <= phone.height - phone.inset.bottom + 2,
            { ringBottom: ring.bottom, limit: phone.height - phone.inset.bottom });

      await page.screenshot({ path: shotPath(`phone-${phone.width}-play`) });

      /* synthesise a drag on the stick: down, move, hold, release */
      const dragResult = await page.evaluate(async () => {
        const zone = document.getElementById('stickZone');
        const r = zone.getBoundingClientRect();
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        const p = Game.player;
        const x0 = p.x, y0 = p.y;

        const fire = (type, x, y) => {
          const t = new Touch({
            identifier: 1, target: zone,
            clientX: x, clientY: y, pageX: x, pageY: y,
          });
          zone.dispatchEvent(new TouchEvent(type, {
            bubbles: true, cancelable: true, composed: true,
            touches: type === 'touchend' ? [] : [t],
            targetTouches: type === 'touchend' ? [] : [t],
            changedTouches: [t],
          }));
        };

        /* The spawn point is a real room, so one direction can be a wall. Try
           every direction and require at least one to move the hero. */
        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        const trials = [];
        let firstDir = null, heldOp = 0, heldActive = false, heldLeft = '';
        for (const [dx, dy] of dirs) {
          const sx = p.x, sy = p.y;
          fire('touchstart', cx, cy);
          fire('touchmove', cx + dx * 90, cy + dy * 90);   /* past maxR = full speed */
          await new Promise((r) => setTimeout(r, 100));
          if (!firstDir) firstDir = Game.input.touchDir;
          await new Promise((r) => setTimeout(r, 500));
          /* sample while the thumb is still down: release() clears both */
          if (!heldOp) {
            heldOp = Number(getComputedStyle(document.getElementById('stickKnob')).opacity);
            heldActive = document.body.classList.contains('stick-active');
            heldLeft = document.getElementById('stickKnob').style.left;
          }
          const dist = Math.hypot(p.x - sx, p.y - sy);
          fire('touchend', cx + dx * 90, cy + dy * 90);
          await new Promise((r) => setTimeout(r, 120));
          trials.push({ dir: [dx, dy], dist: +dist.toFixed(1) });
          if (dist > 4) break;                             /* proven: stop early */
        }
        const knob = document.getElementById('stickKnob');
        return {
          firstDir,
          trials,
          best: Math.max(...trials.map((t) => t.dist)),
          releasedDir: Game.input.touchDir,
          moved: Math.hypot(p.x - x0, p.y - y0),
          from: [Math.round(x0), Math.round(y0)],
          to: [Math.round(p.x), Math.round(p.y)],
          knobOp: heldOp,
          stickActive: heldActive,
          knobLeft: heldLeft,
        };
      });
      check('dragging the stick sets a direction',
            dragResult.firstDir && Math.hypot(dragResult.firstDir.x, dragResult.firstDir.y) > 0.5,
            dragResult.firstDir);
      check('the stick is drawn while held',
            dragResult.stickActive === true && dragResult.knobOp > 0.05,
            { active: dragResult.stickActive, opacity: dragResult.knobOp });
      check('the knob follows the thumb', /\d+px/.test(dragResult.knobLeft || ''), dragResult.knobLeft);
      check('the hero walks while the stick is held', dragResult.best > 4, dragResult.trials);
      check('releasing the stick stops the hero', dragResult.releasedDir === null, dragResult.releasedDir);

      /* ---- ability buttons respond to taps ---- */
      const tap = await page.evaluate(async () => {
        const want = ['attack', 'magic', 'potion', 'slam'];
        const out = {};
        const p = Game.player;
        for (const action of want) {
          const btn = document.querySelector(`#touchActions [data-action="${action}"]`);
          if (!btn) { out[action] = { missing: true }; continue; }
          /* make the ability genuinely usable, then let its cooldown clear */
          p.mana = p.maxMana;
          p.potions = Math.max(p.potions, 2);
          p.attackCd = 0; p.magicCd = 0; p.slamCd = 0; p.attackAnim = 0;
          const before = {
            mana: p.mana, pots: p.potions, projectiles: FX.projectiles.length,
            cd: p.attackCd, magicCd: p.magicCd, slamCd: p.slamCd, anim: p.attackAnim,
          };
          /* the rail binds pointerdown, which is what a thumb produces */
          btn.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true, cancelable: true, pointerId: 3, pointerType: 'touch',
            isPrimary: true, clientX: 2, clientY: 2, button: 0,
          }));
          btn.dispatchEvent(new PointerEvent('pointerup', {
            bubbles: true, cancelable: true, pointerId: 3, pointerType: 'touch', isPrimary: true,
          }));
          await new Promise((r) => setTimeout(r, 220));
          const after = {
            mana: p.mana, pots: p.potions, projectiles: FX.projectiles.length,
            cd: p.attackCd, magicCd: p.magicCd, slamCd: p.slamCd, anim: p.attackAnim,
          };
          out[action] = {
            reacted: after.mana < before.mana || after.pots < before.pots
              || after.projectiles > before.projectiles
              || after.cd > before.cd || after.magicCd > before.magicCd
              || after.slamCd > before.slamCd || after.anim > 0,
            before, after,
          };
          p.mana = p.maxMana;
        }
        out.anyReaction = Object.values(out).some((v) => v && v.reacted === true);
        out.detail = Object.fromEntries(Object.entries(out)
          .filter(([, v]) => v && typeof v === 'object' && 'reacted' in v)
          .map(([k, v]) => [k, v.reacted]));
        return out;
      });
      const present = Object.entries(tap).filter(([, v]) => v !== 'missing');
      check('attack/spell/potion/slam buttons exist', present.length >= 3,
            Object.entries(tap).filter(([, v]) => v === 'missing').map(([k]) => k));
      check('tapping an ability has a visible effect', tap.anyReaction === true, tap.detail);

      /* ---- menus still open and stay inside the viewport ---- */
      const menus = await page.evaluate(async () => {
        const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const fit = (id) => {
          const el = document.getElementById(id);
          if (!el) return null;
          const r = el.querySelector('.panel') ? el.querySelector('.panel').getBoundingClientRect() : el.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y),
                   fitsW: r.width <= window.innerWidth + 1, fitsH: r.height <= window.innerHeight + 1 };
        };
        toggleInventory(true); await frame();
        const inv = fit('inventoryOverlay');
        toggleInventory(false); await frame();
        togglePause(true); await frame();
        const pause = fit('pauseOverlay');
        togglePause(false); await frame();
        return { inv, pause, viewport: [window.innerWidth, window.innerHeight] };
      });
      check('inventory fits the phone width', menus.inv && menus.inv.fitsW, menus.inv);
      check('pause menu fits the phone', menus.pause && menus.pause.fitsW && menus.pause.fitsH, menus.pause);

      /* ---- rotated to landscape ---- */
      await page.setViewport({
        width: phone.height, height: phone.width,
        deviceScaleFactor: phone.dpr, isMobile: true, hasTouch: true, isLandscape: true,
      });
      await page.evaluate(() => { window.dispatchEvent(new Event('resize')); });
      await new Promise((r) => setTimeout(r, 500));
      const rotated = await page.evaluate(() => {
        /* #touchActions is a full-screen, click-through container; the buttons
           inside it are what must stay on screen and out from under the stick */
        const btns = Array.from(document.querySelectorAll('#touchActions .tBtn'))
          .map((b) => ({ id: b.dataset.action, r: b.getBoundingClientRect(), cs: getComputedStyle(b) }))
          .filter((b) => b.cs.display !== 'none' && b.r.width > 0);
        const stick = document.getElementById('stickZone');
        const s = stick ? stick.getBoundingClientRect() : null;
        const offscreen = btns.filter((b) => b.r.left < -1 || b.r.top < -1
          || b.r.right > window.innerWidth + 1 || b.r.bottom > window.innerHeight + 1);
        const overlapping = btns.filter((b) => s && !(b.r.right < s.left || b.r.left > s.right
          || b.r.bottom < s.top || b.r.top > s.bottom));
        return {
          W: Game.W, H: Game.H,
          canvasW: Game.canvas.width,
          buttonCount: btns.length,
          offscreen: offscreen.map((b) => b.id),
          overlapping: overlapping.map((b) => b.id),
          stickVisible: !!s && s.width > 0,
          state: Game.state,
        };
      });
      check('rotation resizes the canvas', rotated.W === phone.height && rotated.H === phone.width, rotated);
      check('the ability buttons stay on screen in landscape', rotated.offscreen.length === 0, rotated.offscreen);
      check('every ability button survives rotation', rotated.buttonCount >= 3, rotated.buttonCount);
      check('the joystick survives rotation', rotated.stickVisible, rotated);
      check('no ability button sits under the joystick', rotated.overlapping.length === 0, rotated.overlapping);
      check('the run keeps playing through a rotation', rotated.state === 'playing', rotated.state);
      await page.screenshot({ path: shotPath(`phone-${phone.width}-landscape`) });

      check('no console or page errors', errors.length === 0, errors.slice(0, 3));
    } finally {
      await session.browser.close();
    }
  }

  /* ---------- a wide desktop window must NOT get the phone UI ---------- */
  section('Desktop is not treated as a phone');
  const desktop = await launch({ width: 1400, height: 900 });
  try {
    await desktop.page.goto(server.url, { waitUntil: 'load' });
    await waitForBoot(desktop.page);
    const info = await desktop.page.evaluate(() => {
      /* Playwright's getComputedStyle reports the element's own value in some
         engines, so measure what actually renders instead of the leaf node's
         declaration: the layer is hidden by its PARENT's display:none. */
      const layer = document.getElementById('touchLayer');
      const r = layer.getBoundingClientRect();
      return {
        isPhone: Game.isPhone,
        bodyClass: document.body.classList.contains('is-phone'),
        layerDisplay: getComputedStyle(layer).display,
        layerRendered: r.width > 0 && r.height > 0,
        stickHitTest: (() => {
          const el = document.elementFromPoint(window.innerWidth * 0.2, window.innerHeight - 80);
          return el ? (el.id || el.className || el.tagName) : null;
        })(),
      };
    });
    check('desktop keeps the keyboard layout', info.isPhone === false && info.bodyClass === false, info);
    check('no touch layer is rendered on desktop', info.layerRendered === false, info);
    check('the joystick cannot swallow desktop clicks',
          !/stickZone|touchLayer/.test(String(info.stickHitTest)), info.stickHitTest);
  } finally {
    await desktop.browser.close();
  }
} catch (err) {
  console.error('\nUNEXPECTED FAILURE:', err.stack || err.message);
} finally {
  summary('mobile / touch');
  await server.close();
  process.exitCode = counts().failed === 0 ? exitCode() : 1;
}
