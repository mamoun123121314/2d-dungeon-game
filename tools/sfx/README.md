# Sound effects build

The effects in `index.html` are **real recordings**, not synthesis. This folder
is the reproducible recipe that produced them, kept so a future change can be
rebuilt rather than hand-patched.

## Where the audio comes from

All source files are from the **Oculus Audio Pack**, published by Meta in
[`facebookincubator/Meta-open-sound`](https://github.com/facebookincubator/Meta-open-sound)
under **CC0 1.0**. `want.txt` lists the 39 files used, by their pack names.

## Rebuilding

```sh
python3 -m venv venv && ./venv/bin/pip install numpy soundfile lameenc
# fetch the source recordings (any method; the names in want.txt are the paths
# under corpora/oculus-audio-pack/ogg/ in that repository)
mkdir -p all
while read -r f; do
  gh api "repos/facebookincubator/Meta-open-sound/contents/corpora/oculus-audio-pack/ogg/$f.ogg" \
    -H "Accept: application/vnd.github.raw" > "all/$f.ogg"
done < want.txt
./venv/bin/python onset.py     # measures each clip's transient and tail
./venv/bin/python make_sfx.py  # layers, EQs, adds the room tail, normalises
./venv/bin/python emit.py      # encodes 64 kbps MP3, writes clips.js (base64)
```

`clips.js` is then pasted into the `const CLIPS = {...}` table in `index.html`.
`sheets.py` writes listening sheets (one WAV per family plus a showcase) into
`sheets/` if you want to audition the set without launching the game. The
checked-in sheets are the current build.

## Processing, in order

1. **Trim** to the measured transient (each sample is silent for up to 0.6 s at
   the front) and to its -20 dB tail.
2. **Layer** where one recording is too thin: `hit` is a punch plus a metal
   ring, `crit` adds a hammer and a skull crack, `stairs` is three footsteps
   plus a creak.
3. **EQ** with a small analytic filter bank (presence lift, rumble cut).
4. **Room tail** by convolving with a synthetic decaying-noise impulse.
5. **Loudness**: peak-normalise, then pull the RMS to a common target so a key
   turning in a lock is audible next to a sword blow.
6. **Encode** to 64 kbps mono MP3 — about 13 dB better than the noise floor of
   the quietest clip at this length, so nothing audible is lost.
