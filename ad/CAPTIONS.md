# Dungeon Rogue — ad copy

Play link: **https://mamoun123121314.github.io/dungeon-rogue/**

---

## TikTok / Instagram Reels / YouTube Shorts

**File:** `dungeon_rogue_vertical.mp4` (9:16, 1080×1920, 22.7s)

**Caption:**

> I built an entire action RPG that runs in a browser tab. No download, no install, no account. 🗡️
>
> Every floor is generated fresh. Bosses have three phases and change tactics mid-fight. Gear rolls its own names. There's a talent tree, elemental builds, and an endless mode that starts stacking curses on you past floor 10.
>
> It's one HTML file. Zero asset files. 38 recorded sound effects, encoded straight into the page.
>
> Play free 👉 link in bio
>
> #indiegame #gamedev #browsergame #roguelike #arpg #pixelart #solodev #webdev #gaming #dungeon

**On-screen text already in the video:** FREE. / INSTANT. / NO DOWNLOAD. — so the caption can lead with the story instead of repeating it.

---

## Instagram / Facebook feed

**File:** `dungeon_rogue_feed.mp4` (4:5, 1080×1350, 22.7s)

**Caption:**

> An entire action RPG in a single HTML file.
>
> Eleven room themes. Six elite traits. Bosses with three-phase movesets. Twenty-one talent ranks. Elemental status effects that actually matter. And an autosave that lets you close the tab and come back mid-run.
>
> No engine, no asset files, no audio folder — 38 real recordings are base64'd straight into the HTML, so a swing or a scream plays without a single network request.
>
> Free to play, link in bio.

---

## X / Twitter / Reddit / Discord

**File:** `dungeon_rogue_wide.mp4` (16:9, 1280×720, 20.8s)

**Post:**

> I made a full action RPG that ships as one HTML file.
>
> No engine, no asset files, no audio folder. Procedural floors, three-phase bosses, elemental builds, talent trees, endless mode, autosave. 38 sound effects — real CC0 recordings, not oscillators — are inlined as base64 and decoded on demand, so the whole game is still one file that runs offline.
>
> Play it in your browser — free, nothing to install:
> https://mamoun123121314.github.io/dungeon-rogue/
>
> Built with vanilla JS + Canvas 2D. Happy to answer anything about how it works.

**Short version for a quote-tweet:**

> one HTML file. no engine, no assets, no install.
> procedural floors, 3-phase bosses, elemental builds, endless mode.
> play free 👇
> https://mamoun123121314.github.io/dungeon-rogue/

---

## Notes

- **Audio, accurately:** the 38 sound effects are real recordings from the
  Oculus Audio Pack (Meta Open Sound, CC0-1.0), trimmed and loudness-matched,
  encoded to 64 kbps mono MP3 and inlined as base64. They are **not**
  synthesised with oscillators. Only the reactive score and the ambient wind
  bed are generated in the Web Audio graph at runtime. The page is still a
  single file with no external requests — the recordings live inside the HTML.
- All gameplay footage is **captured from the real game** — the renderer was reimplemented in a headless harness to record actual draw calls, then composited with the engine's own torchlight fog.
- Vertical and feed versions put the gameplay in a framed panel with captions, because a 16:9 game cropped to 9:16 loses the whole scene.
- The still `art_vertical.png` is a separate AI-illustrated key art piece. It is **not** in-game footage — if you post it, don't claim it's a screenshot. Useful as a thumbnail or a pinned post.
- Videos are silent. If you want a soundtrack, the game's own SFX and the reactive score are the natural choice — ask and I'll cut a version with audio.
