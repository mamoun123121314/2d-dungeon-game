/* Each creature must sound like itself.
 *
 * The bug: all 16 enemy types played the SAME two samples — a human male hurt
 * grunt and a human male death cry — so a stone golem, a bat and a slime were
 * indistinguishable. This suite renders every creature's voice through the real
 * synth and checks that they actually differ, using an OfflineAudioContext so
 * the result can be measured rather than listened to.
 */
import { launch, serve, waitForBoot } from './harness.mjs';

const server = await serve();
const { browser, page } = await launch({ width: 900, height: 600 });
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

try {
  await page.goto(server.url, { waitUntil: 'load' });
  await waitForBoot(page);

  /* ---- the types the game actually spawns ---- */
  const types = await page.evaluate(() => Object.keys(ENEMY_TYPES));
  check('the bestiary is readable', types.length >= 16, `${types.length} types`);

  /* ---- render each voice and fingerprint it ---- */
  const rendered = await page.evaluate(async (allTypes) => {
    /* the voice bank is a classic script, so it installed itself on window */
    const out = {};
    for (const t of allTypes) {
      out[t] = {};
      for (const variant of ['hurt', 'die']) {
        /* Render offline so the measurement is deterministic and silent. */
        const ctx = new OfflineAudioContext(1, 44100 * 1.6, 44100);
        const dest = ctx.createGain();
        dest.connect(ctx.destination);
        const voice = window.createCreatureVoices({
          getCtx: () => ctx,
          getOut: () => dest,
          getVerbIn: () => null,
        });
        const ok = variant === 'die' ? voice.die(t, { volume: 0.8 }) : voice.hurt(t, { volume: 0.6 });
        const buf = await ctx.startRendering();
        const d = buf.getChannelData(0);
        /* simple descriptors of the sound */
        let peak = 0, energy = 0, zc = 0;
        for (let i = 0; i < d.length; i++) {
          const v = Math.abs(d[i]);
          if (v > peak) peak = v;
          energy += d[i] * d[i];
          if (i > 0 && ((d[i - 1] <= 0 && d[i] > 0) || (d[i - 1] >= 0 && d[i] < 0))) zc++;
        }
        /* spectral centroid via a coarse zero-shot approach: energy-weighted
           brightness proxy = zero crossings per second, normalised by duration */
        const rms = Math.sqrt(energy / d.length);
        out[t][variant] = {
          ok, peak: +peak.toFixed(4), rms: +rms.toFixed(5),
          zcr: +(zc / (d.length / 44100)).toFixed(1),
        };
      }
    }
    return out;
  }, types);

  /* ---- every creature must actually make a sound ---- */
  const silent = types.filter((t) => !rendered[t].hurt.ok || rendered[t].hurt.rms < 1e-4);
  check('every creature voice produces sound', silent.length === 0,
        silent.length ? `silent: ${silent.join(', ')}` : `${types.length}/${types.length} audible`);

  /* ---- and must be its OWN sound ---- */
  const total = types.length;
  const identical = [];
  for (let i = 0; i < total; i++) {
    for (let j = i + 1; j < total; j++) {
      const a = rendered[types[i]].hurt, b = rendered[types[j]].hurt;
      const closeRms = Math.abs(a.rms - b.rms) / Math.max(a.rms, b.rms, 1e-9) < 0.02;
      const closeZcr = Math.abs(a.zcr - b.zcr) / Math.max(a.zcr, b.zcr, 1e-9) < 0.02;
      if (closeRms && closeZcr) identical.push(`${types[i]}~${types[j]}`);
    }
  }
  check('no two creatures share the same voice', identical.length === 0,
        identical.length ? `indistinguishable: ${identical.slice(0, 5).join(', ')}` : `${total} distinct voices`);

  /* ---- the families must be genuinely different in pitch ---- */
  const brightness = types.map((t) => rendered[t].hurt.zcr);
  const spread = Math.max(...brightness) / Math.max(1, Math.min(...brightness.filter((z) => z > 0)));
  check('voices span a wide range of pitch/brightness', spread > 2.5,
        `brightest is ${spread.toFixed(1)}x the darkest`);

  /* ---- death must differ from hurt for the same creature ---- */
  const sameVariant = types.filter((t) => {
    const a = rendered[t].hurt, b = rendered[t].die;
    return Math.abs(a.zcr - b.zcr) / Math.max(a.zcr, b.zcr, 1e-9) < 0.02;
  });
  check('a creature dies differently from how it is hurt', sameVariant.length === 0,
        sameVariant.length ? `same: ${sameVariant.join(', ')}` : '');

  /* ---- the game routes creature hits through these voices ---- */
  const wired = await page.evaluate(() => ({
    hasFn: typeof playCreatureVoice === 'function',
    hasBank: typeof CreatureVoice === 'object' && CreatureVoice !== null,
    families: typeof CreatureVoice === 'object' && CreatureVoice ? CreatureVoice.familyOf('golem') : null,
  }));
  check('the game routes enemy hits through the creature voices',
        wired.hasFn && wired.hasBank && wired.families === 'stone',
        JSON.stringify(wired));

  /* ---- nothing may fall back to the shared human clip ---- */
  const fallbacks = await page.evaluate((allTypes) => {
    /* count how many types would hit the old shared-sample fallback */
    return allTypes.filter((t) => !CreatureVoice.has(t));
  }, types);
  check('no creature falls back to the shared human grunt', fallbacks.length === 0,
        fallbacks.length ? `falling back: ${fallbacks.join(', ')}` : '');
} catch (e) {
  console.error('  FAIL  threw:', e && e.message);
  failures++;
} finally {
  await browser.close();
  await server.close();
}

console.log(failures === 0 ? '\ncreatureVoices: PASS' : `\ncreatureVoices: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
