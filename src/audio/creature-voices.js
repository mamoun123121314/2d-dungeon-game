/* ---------------------------------------------------------------------------
   Creature voices — a synthesised voice for every kind of monster.

   The game shipped 16 enemy types that all growled through the SAME two
   recordings: a human "male hurt" grunt and a human "male death" cry. A
   skeleton, a slime, a bat and a stone golem all sounded like the same man
   being punched, because that is literally what was playing.

   Every creature now gets its own voice built out of oscillators and filtered
   noise at playback time. Nothing is downloaded and nothing is added to the
   file: a voice is described by a handful of numbers, and one small synth
   engine turns that description into sound. The six families below are shaped
   by what the creature is made of, so the pitch and the timbre agree with the
   sprite the player is looking at:

     bone    hollow, dry, rattling — no throat, just a clatter of sticks
     flesh   a wet, snapping verbal bark with a real throat behind it
     stone   a grinding, low, dusty rumble with grit in it
     beast   a hissing, snarling animal throat
     arcane  a wailing, formless spectral tone that bends in pitch
     ooze    a bubbling, glottal gurgle that ends in a wet plop
     insect  a thin, buzzing, chitinous rasp

   Each family has an `hurt` and a `die` variant. The game asks for
   `creatureHurt('golem')` and this file works out the rest.
   --------------------------------------------------------------------------- */

/* Family for every enemy type in the bestiary. Anything not listed falls back
   to `flesh`, which is the neutral "humanoid throat" case. */
const CREATURE_FAMILY = {
  skeleton: 'bone',
  crawler:  'bone',
  archer:   'bone',
  orc:      'flesh',
  cultist:  'flesh',
  revenant: 'flesh',
  guardian: 'stone',
  golem:    'stone',
  slime:    'ooze',
  hound:    'beast',
  imp:      'beast',
  bat:      'insect',
  necro:    'arcane',
  wisp:     'arcane',
  ice:      'arcane',
  boss:     'stone',
};

/* Per-creature overrides, so two creatures in the same family still differ.
   `pitch` is a multiplier on the family's base note (lower = bigger body),
   `grit` adds noise, `bend` is how far the pitch slides over the sound. */
const CREATURE_VOICE = {
  /* --- bone --- */
  crawler:  { pitch: 1.34, grit: 0.16, bend: -0.22, dur: 0.30, decay: 'ratchet' },
  skeleton: { pitch: 0.97, grit: 0.10, bend: -0.30, dur: 0.34, decay: 'ratchet' },
  archer:   { pitch: 1.12, grit: 0.13, bend: -0.26, dur: 0.30, decay: 'ratchet' },
  /* --- flesh --- */
  orc:      { pitch: 0.74, grit: 0.30, bend: -0.34, dur: 0.42, decay: 'snarl' },
  cultist:  { pitch: 1.02, grit: 0.18, bend: -0.20, dur: 0.40, decay: 'breath' },
  revenant: { pitch: 0.80, grit: 0.26, bend: -0.30, dur: 0.44, decay: 'breath' },
  /* --- stone --- */
  golem:    { pitch: 0.42, grit: 0.62, bend: -0.14, dur: 0.56, decay: 'grind' },
  guardian: { pitch: 0.50, grit: 0.52, bend: -0.18, dur: 0.52, decay: 'grind' },
  boss:     { pitch: 0.30, grit: 0.55, bend: -0.10, dur: 0.85, decay: 'grind' },
  /* --- beast --- */
  hound:    { pitch: 1.28, grit: 0.44, bend: -0.42, dur: 0.26, decay: 'snarl' },
  imp:      { pitch: 1.46, grit: 0.34, bend: -0.36, dur: 0.24, decay: 'snarl' },
  /* --- arcane --- */
  necro:    { pitch: 0.68, grit: 0.06, bend: 0.34, dur: 0.52, decay: 'wail' },
  wisp:     { pitch: 1.42, grit: 0.04, bend: 0.48, dur: 0.42, decay: 'wail' },
  ice:      { pitch: 1.10, grit: 0.09, bend: 0.40, dur: 0.48, decay: 'wail' },
  /* --- ooze --- */
  slime:    { pitch: 0.88, grit: 0.20, bend: -0.20, dur: 0.38, decay: 'bubble' },
  /* --- insect --- */
  bat:      { pitch: 1.62, grit: 0.24, bend: -0.18, dur: 0.20, decay: 'buzz' },
};

const FAMILY_BASE_HZ = {
  bone:   196,
  flesh:  138,
  stone:  62,
  beast:  172,
  arcane: 260,
  ooze:   96,
  insect: 520,
};

/* How the families differ in shape. `harmonic` is the ratio of the second
   partial to the first — small integers sound hollow and vocal, wide ones
   sound metallic or insectile. */
const FAMILY_SHAPE = {
  bone:   { partials: [1, 2.02, 2.98, 4.1], wave: 'triangle', noise: 0.42, q: 5,  rasps: 7 },
  flesh:  { partials: [1, 2.0, 3.01],       wave: 'sawtooth', noise: 0.30, q: 2.2, rasps: 3 },
  stone:  { partials: [1, 1.5, 2.02, 3.0],  wave: 'sawtooth', noise: 0.72, q: 1.4, rasps: 2 },
  beast:  { partials: [1, 2.4, 3.7],        wave: 'sawtooth', noise: 0.52, q: 3.0, rasps: 4 },
  arcane: { partials: [1, 1.414, 2.0, 2.83], wave: 'sine',    noise: 0.10, q: 8,  rasps: 2 },
  ooze:   { partials: [1, 1.8, 2.7],        wave: 'sine',     noise: 0.34, q: 2.6, rasps: 3 },
  insect: { partials: [1, 3.6, 6.2],        wave: 'square',   noise: 0.30, q: 9,  rasps: 9 },
};

/* A short burst of noise, generated once per call. Cheap: a few thousand
   samples, which is nothing next to the music. */
function makeNoiseBuffer(ctx, seconds, rng) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = rng() * 2 - 1;
  return buf;
}

function createCreatureVoices(deps) {
  /* deps: { getCtx, getDest, getVerbIn } — everything is fetched lazily so this
     module never holds a stale AudioContext across a mute/restart. */
  const { getCtx, getOut, getVerbIn } = deps;

  function voice(type, variant, opts = {}) {
    const ctx = getCtx();
    if (!ctx) return false;
    const family = CREATURE_FAMILY[type] || 'flesh';
    const cfg = CREATURE_VOICE[type] || CREATURE_VOICE.skeleton;
    const shape = FAMILY_SHAPE[family];
    const dying = variant === 'die';

    const now = ctx.currentTime + 0.005;
    const pitchMul = (cfg.pitch || 1) * (dying ? 0.88 : 1) * (opts.pitch || 1);
    const base = FAMILY_BASE_HZ[family] * pitchMul;
    const dur = (cfg.dur || 0.3) * (dying ? 1.45 : 1);
    const level = (dying ? 0.85 : 0.62) * (opts.volume == null ? 1 : opts.volume);

    /* one gain node feeds a panner and a reverb send, mirroring the mixer the
       sampled effects already use, so a creature voice sits in the same space */
    const out = ctx.createGain();
    out.gain.value = level;

    const pan = Number.isFinite(opts.pan) ? Math.max(-1, Math.min(1, opts.pan)) : 0;
    if (ctx.createStereoPanner) {
      const pn = ctx.createStereoPanner();
      pn.pan.value = pan;
      out.connect(pn); pn.connect(getOut());
    } else {
      out.connect(getOut());
    }
    const verb = getVerbIn();
    if (verb) {
      const send = ctx.createGain();
      send.gain.value = family === 'arcane' ? 0.34 : 0.16;
      out.connect(send); send.connect(verb);
    }

    const rng = (() => { let s = (Math.random() * 4294967296) >>> 0; return () => {
      s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296;
    }; })();

    /* ---- the throat: a stack of partials with a shared filter ---- */
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = shape.q;
    filter.frequency.setValueAtTime(base * 2.2, now);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(40, base * 2.2 * (1 + (cfg.bend || 0))), now + dur);
    filter.connect(out);

    const oscs = [];
    shape.partials.forEach((ratio, i) => {
      const o = ctx.createOscillator();
      o.type = shape.wave;
      /* slight detune per partial so the stack beats gently instead of buzzing */
      const detune = 1 + (rng() - 0.5) * 0.02;
      o.frequency.setValueAtTime(base * ratio * detune, now);
      o.frequency.exponentialRampToValueAtTime(
        Math.max(30, base * ratio * detune * (1 + (cfg.bend || 0) * (1 + i * 0.15))),
        now + dur);
      const pg = ctx.createGain();
      pg.gain.value = (i === 0 ? 0.55 : 0.22 / i);
      o.connect(pg); pg.connect(filter);
      o.start(now); o.stop(now + dur + 0.06);
      oscs.push(o);
    });

    /* ---- the body: filtered noise for breath, grit or hiss ---- */
    const noiseAmt = (shape.noise + (cfg.grit || 0)) * (dying ? 0.8 : 1);
    if (noiseAmt > 0.02) {
      const nbuf = makeNoiseBuffer(ctx, dur + 0.08, rng);
      const ns = ctx.createBufferSource();
      ns.buffer = nbuf;
      const nf = ctx.createBiquadFilter();
      nf.type = family === 'insect' ? 'highpass' : family === 'stone' ? 'lowpass' : 'bandpass';
      nf.frequency.value = family === 'stone' ? base * 3.2
        : family === 'insect' ? base * 1.6
        : base * 2.6;
      nf.Q.value = shape.q * 0.6;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, now);
      ng.gain.linearRampToValueAtTime(noiseAmt * 0.5, now + dur * 0.14);
      ng.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      ns.connect(nf); nf.connect(ng); ng.connect(out);
      ns.start(now); ns.stop(now + dur + 0.08);
    }

    /* ---- family-specific flourishes ---- */

    /* bone: a dry ratchet of short clicks, like knuckles on a table */
    if (family === 'bone') {
      const clicks = dying ? 9 : 5;
      for (let i = 0; i < clicks; i++) {
        const at = now + (i / clicks) * dur * 0.9 + rng() * 0.012;
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = base * (2.4 + rng() * 2.2);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.linearRampToValueAtTime(0.10 + rng() * 0.05, at + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.035);
        o.connect(g); g.connect(out);
        o.start(at); o.stop(at + 0.05);
      }
    }

    /* ooze: pitch-dropping bubbles plus a wet plop at the end */
    if (family === 'ooze') {
      const pops = dying ? 7 : 4;
      for (let i = 0; i < pops; i++) {
        const at = now + rng() * dur * 0.8;
        const o = ctx.createOscillator();
        o.type = 'sine';
        const f0 = base * (2.2 + rng() * 2.4);
        o.frequency.setValueAtTime(f0, at);
        o.frequency.exponentialRampToValueAtTime(f0 * 0.35, at + 0.09);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.linearRampToValueAtTime(0.16, at + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.11);
        o.connect(g); g.connect(out);
        o.start(at); o.stop(at + 0.13);
      }
      const at = now + dur * 0.82;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = base * 1.6;
      const nbuf = makeNoiseBuffer(ctx, 0.12, rng);
      const ns = ctx.createBufferSource(); ns.buffer = nbuf;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.22, at);
      ng.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
      ns.connect(lp); lp.connect(ng); ng.connect(out);
      ns.start(at); ns.stop(at + 0.13);
    }

    /* insect: a fast tremolo that reads as wingbeat rather than a note */
    if (family === 'insect') {
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 34 + rng() * 14;
      const lg = ctx.createGain();
      lg.gain.value = 0.45;
      const mod = ctx.createGain();
      mod.gain.value = 0.55;
      lfo.connect(lg); lg.connect(mod.gain);
      mod.connect(out);
      lfo.start(now); lfo.stop(now + dur + 0.06);
    }

    /* stone: a couple of heavy grit skitters, like rubble shifting */
    if (family === 'stone') {
      for (let i = 0; i < shape.rasps; i++) {
        const at = now + rng() * dur;
        const nbuf = makeNoiseBuffer(ctx, 0.05, rng);
        const ns = ctx.createBufferSource(); ns.buffer = nbuf;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = base * 6;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.12 + rng() * 0.10, at);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
        ns.connect(lp); lp.connect(g); g.connect(out);
        ns.start(at); ns.stop(at + 0.06);
      }
    }

    /* arcane: a slow vibrato so the tone reads as unsteady and inhuman */
    if (family === 'arcane') {
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 5.5 + rng() * 3;
      const lg = ctx.createGain();
      lg.gain.value = base * 0.06;
      lfo.connect(lg);
      oscs.forEach((o) => lg.connect(o.frequency));
      lfo.start(now); lfo.stop(now + dur + 0.06);
    }

    /* ---- envelope: a short attack, then the family's own decay shape ---- */
    out.gain.setValueAtTime(0.0001, now);
    out.gain.linearRampToValueAtTime(level, now + (dying ? 0.03 : 0.02));

    const decayShape = cfg.decay || 'breath';
    if (decayShape === 'grind') {
      /* stone grinds and then stops dead rather than fading */
      out.gain.setValueAtTime(level, now + dur * 0.66);
      out.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    } else if (decayShape === 'snarl') {
      out.gain.linearRampToValueAtTime(level * 0.72, now + dur * 0.35);
      out.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    } else if (decayShape === 'wail') {
      out.gain.linearRampToValueAtTime(level * 0.85, now + dur * 0.45);
      out.gain.exponentialRampToValueAtTime(0.0001, now + dur * 1.15);
    } else if (decayShape === 'ratchet') {
      out.gain.setValueAtTime(level, now + dur * 0.5);
      out.gain.exponentialRampToValueAtTime(0.0001, now + dur * 0.95);
    } else {
      out.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    }
    return true;
  }

  return {
    hurt(type, opts) { return voice(type, 'hurt', opts); },
    die(type, opts) { return voice(type, 'die', opts); },
    familyOf(type) { return CREATURE_FAMILY[type] || 'flesh'; },
    has(type) { return !!CREATURE_VOICE[type]; },
  };
}

/* Install into the global the game core expects. A classic script keeps every
   other global in this game untouched — see the note at the top of the file. */
window.createCreatureVoices = createCreatureVoices;
window.CREATURE_FAMILY = CREATURE_FAMILY;
window.CREATURE_VOICE = CREATURE_VOICE;
window.CreatureVoice = createCreatureVoices({
  getCtx: () => (typeof Sound !== 'undefined' ? Sound.ctx : null),
  getOut: () => Sound.sfxBus(),
  getVerbIn: () => Sound.verbBus(),
});
