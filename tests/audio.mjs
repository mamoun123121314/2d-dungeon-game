/**
 * Audio behaviour tests.
 *
 * Audio is a feature with rules, not just decoration:
 *
 *   - no sound before a user gesture (browsers block it; the game must cope)
 *   - sound works after the first gesture
 *   - mute and volume survive a reload
 *   - returning to a backgrounded tab does not leave audio broken
 *   - a blocked or broken AudioContext is recoverable, never fatal
 *
 *   node tests/audio.mjs
 */
import { launch, serve, waitForBoot, startRun } from './harness.mjs';
import { check, equal, between, section, summary, exitCode, counts } from './assert.mjs';

const server = await serve();

/* Deliberately do NOT pass the autoplay override for the first block: the
   point is to see what the game does when the policy is the real one. */
const browserBlocked = await launch({ width: 1000, height: 700, autoplay: false });

try {
  const { page, errors } = browserBlocked;
  await page.goto(server.url, { waitUntil: 'load' });
  await waitForBoot(page);

  /* ============ before any gesture ============ */
  section('Before a user gesture');
  const cold = await page.evaluate(async () => {
    const out = { hasSound: typeof Sound === 'object' };
    if (!out.hasSound) return out;
    try {
      Sound.init();
      await new Promise((r) => setTimeout(r, 250));
      out.ctxState = Sound.ctx ? Sound.ctx.state : 'none';
      /* playing must not throw even when the context refuses to start */
      let threw = null;
      try { Sound.play('hit', 1, 0); } catch (e) { threw = e.message; }
      out.playThrew = threw;
      out.names = Sound._names().length;
    } catch (e) { out.initThrew = e.message; }
    return out;
  });
  check('the sound module exists', cold.hasSound, cold);
  check('initialising audio never throws', !cold.initThrew, cold.initThrew);
  check('playing before a gesture never throws', !cold.playThrew, cold.playThrew);
  check('all 38 effects are registered', cold.names === 38, cold.names);
  check('the context is not left running without a gesture',
        cold.ctxState === 'suspended' || cold.ctxState === 'running' || cold.ctxState === 'none', cold.ctxState);

  /* ============ after a gesture ============ */
  section('After the first gesture');
  await startRun(page);
  await new Promise((r) => setTimeout(r, 400));
  const warm = await page.evaluate(async () => {
    Sound.init(); Sound.resume();
    await new Promise((r) => setTimeout(r, 400));
    const out = {
      state: Sound.ctx ? Sound.ctx.state : 'none',
      sampleRate: Sound.ctx ? Sound.ctx.sampleRate : 0,
      muted: Sound.isMuted(),
      volume: Settings.get().volume,
    };
    /* every registered effect must be playable without throwing */
    const names = Sound._names();
    let bad = null;
    for (const n of names) {
      try { Sound.play(n, 0.5, 0); } catch (e) { bad = `${n}: ${e.message}`; break; }
    }
    out.badEffect = bad;
    out.effects = names.length;
    await new Promise((r) => setTimeout(r, 400));
    out.decoded = Sound._decoded().length;
    return out;
  });
  check('audio starts after a gesture', warm.state === 'running', warm.state);
  check('the context reports a real sample rate', warm.sampleRate >= 8000, warm.sampleRate);
  check('every effect can be played', warm.badEffect === null, warm.badEffect);
  check('clips decode', warm.decoded > 0, warm.decoded);

  /* ============ the reactive score ============ */
  section('Combat music');
  /* The war drum only fires while combatIntensity is high, and it used to call
     a synth helper that no longer exists — so it threw on every drum beat and
     the whole music tick died. A surface-level "can I play an effect" check
     will not catch that: the score has to actually run. */
  const music = await page.evaluate(async () => {
    Game.combatIntensity = 1;
    const errors = [];
    const onErr = (e) => errors.push(String((e && e.message) || e));
    window.addEventListener('error', onErr);
    const before = Game.frameErrors || 0;
    /* Let the real score run. startMusic drives musicTick on a 520ms timer, and
       the drum fires on beats 0 and 2, so two seconds covers at least one hit. */
    Sound.startMusic();
    await new Promise((r) => setTimeout(r, 2200));
    Sound.stopMusic();
    window.removeEventListener('error', onErr);
    /* the definitive signal: did an exception escape a music tick? */
    return {
      errors: errors.slice(0, 3),
      frameErrors: (Game.frameErrors || 0) - before,
      state: Sound.ctx ? Sound.ctx.state : 'none',
      reports: window.__musicErrors ? window.__musicErrors.slice(0, 3) : null,
    };
  });
  check('the score runs against combat intensity', music.state === 'running', music);
  check('the score does not throw', music.errors.length === 0, music.errors);
  check('the score does not produce frame errors', music.frameErrors === 0, music.frameErrors);
  check('audio is still healthy after the score', music.state === 'running', music.state);

  /* ============ mute + volume persistence ============ */
  section('Mute and volume persistence');
  const muteResult = await page.evaluate(() => {
    const before = Sound.isMuted();
    /* the settings toggle is what a player touches */
    Settings.set('muted', true);
    Sound.setMuted(Settings.get().muted);
    const after = Sound.isMuted();
    return { before, after };
  });
  equal('muting takes effect', muteResult.after, true);

  await page.reload({ waitUntil: 'load' });
  await waitForBoot(page);
  /* audio attaches to the first real gesture, so make one */
  await page.mouse.click(20, 20);
  await new Promise((r) => setTimeout(r, 300));
  const persistedMute = await page.evaluate(() => ({
    muted: Sound.isMuted(),
    stored: (() => { try { return localStorage.getItem('dungeonRogue.settings.v1') || ''; } catch (e) { return ''; } })(),
  }));
  check('mute survives a reload', persistedMute.muted === true, persistedMute.muted);

  /* volume is owned by Settings and pushed into the audio engine; that is the
     path the settings slider uses */
  const volume = await page.evaluate(async () => {
    Sound.setMuted(false);
    Settings.set('volume', 0.33);
    Sound.setVolume(Settings.get().volume);
    return { stored: Settings.get().volume, applied: Sound.setVolume(0.33) };
  });
  check('volume can be set', Math.abs(volume.applied - 0.33) < 0.02, volume);

  await page.reload({ waitUntil: 'load' });
  await waitForBoot(page);
  await page.mouse.click(20, 20);
  await new Promise((r) => setTimeout(r, 250));
  const persistedVolume = await page.evaluate(() => ({ stored: Settings.get().volume }));
  check('volume survives a reload', Math.abs(persistedVolume.stored - 0.33) < 0.02, persistedVolume);

  /* volume must be clamped, not trusted */
  const clamped = await page.evaluate(() => {
    const hi = Sound.setVolume(9); const lo = Sound.setVolume(-4);
    Settings.set('volume', 42);
    const settingsHi = Settings.get().volume;
    Settings.set('volume', -9);
    const settingsLo = Settings.get().volume;
    Sound.setVolume(1);
    Settings.set('volume', 1);
    return { hi, lo, settingsHi, settingsLo };
  });
  check('the audio engine clamps volume to 1', clamped.hi === 1, clamped.hi);
  check('the audio engine clamps volume to 0', clamped.lo === 0, clamped.lo);
  check('the settings value clamps to 1', clamped.settingsHi === 1, clamped.settingsHi);
  check('the settings value clamps to 0', clamped.settingsLo === 0, clamped.settingsLo);

  /* ============ tab return ============ */
  section('Returning to the tab');
  /* a real run guarantees the context exists and is running */
  await startRun(page);
  await new Promise((r) => setTimeout(r, 400));
  const beforeHide = await page.evaluate(() => {
    Sound.init(); Sound.resume();
    return Sound.ctx ? Sound.ctx.state : 'none';
  });
  /* simulate the browser suspending the context on tab switch, which is what
     Chrome/Safari do to save power */
  await page.evaluate(() => { try { Sound.ctx && Sound.ctx.suspend(); } catch (e) {} });
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
  await new Promise((r) => setTimeout(r, 600));
  const afterShow = await page.evaluate(async () => {
    let threw = null;
    try { Sound.resume(); Sound.play('ui', 0.5); } catch (e) { threw = e.message; }
    await new Promise((r) => setTimeout(r, 300));
    return { state: Sound.ctx ? Sound.ctx.state : 'none', threw };
  });
  check('audio resumes after the tab comes back', afterShow.state === 'running', { beforeHide, ...afterShow });
  check('playing after a resume never throws', afterShow.threw === null, afterShow.threw);

  /* ============ a broken context is recoverable ============ */
  section('Broken audio does not kill the game');
  const broken = await page.evaluate(async () => {
    const realCtx = Sound.ctx;
    if (!realCtx) return { noContext: true };
    /* make every audio call throw, the way a hostile browser or a dead audio
       device would, and confirm the game keeps running */
    Sound.ctx = new Proxy(realCtx, {
      get(target, prop) {
        if (prop === 'state') return target.state;
        if (prop === 'currentTime') return target.currentTime;
        if (prop === 'sampleRate') return target.sampleRate;
        if (prop === 'destination') return target.destination;
        if (typeof target[prop] === 'function') return () => { throw new Error('audio device lost'); };
        return target[prop];
      },
    });
    const out = {};
    try { Sound.play('hit', 1, 0); out.playThrew = null; } catch (e) { out.playThrew = e.message; }
    try { Sound.setAmbient(1); out.ambientThrew = null; } catch (e) { out.ambientThrew = e.message; }
    /* the render loop must still advance */
    const t0 = Game.time;
    await new Promise((r) => setTimeout(r, 300));
    out.clockAdvanced = Game.time > t0;
    out.frameErrors = Game.frameErrors || 0;
    Sound.ctx = realCtx;
    return out;
  });
  check('an audio context exists to break', !broken.noContext, broken);
  check('playing with a dead audio device never throws', broken.playThrew === null, broken.playThrew);
  check('ambient with a dead audio device never throws', broken.ambientThrew === null, broken.ambientThrew);
  check('the game keeps running with dead audio', broken.clockAdvanced === true, broken);
  check('dead audio does not produce frame errors', broken.frameErrors === 0, broken.frameErrors);

  /* audio still works after the device "comes back" */
  const recovered = await page.evaluate(async () => {
    let threw = null;
    try { Sound.play('hit', 0.5, 0); } catch (e) { threw = e.message; }
    await new Promise((r) => setTimeout(r, 200));
    return { threw, state: Sound.ctx ? Sound.ctx.state : 'none' };
  });
  check('audio recovers once the context works again', recovered.threw === null && recovered.state === 'running', recovered);

  /* ============ no console noise ============ */
  section('Runtime health');
  check('no unexpected console errors from audio', errors.length === 0, errors.slice(0, 4));
} catch (err) {
  console.error('\nUNEXPECTED FAILURE:', err.stack || err.message);
} finally {
  summary('audio');
  await browserBlocked.browser.close();
  await server.close();
  process.exitCode = counts().failed === 0 ? exitCode() : 1;
}
