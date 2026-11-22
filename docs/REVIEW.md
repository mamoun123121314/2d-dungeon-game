# Dungeon Rogue — code review, bug findings and improvement ideas

Date: 2026-11-22
Scope: `index.html`, `src/game-core.js`, `src/audio/creature-voices.js`,
`src/render/dungeon-detail.js`, `src/pwa.js`, the test suite and the save format.

**Implementation status (2026-11-22):** every bug and every idea below has been
implemented on this branch. The “not fixed deliberately” section is retained as
a record of what the issues were and how each was closed; it is no longer a list
of open work. All nine original suites still pass, plus two new suites
(`features` and `replay`) and the optional balance lab. See the verification
section at the end.

## How this review was done

1. Read every gameplay system (dungeon generation, loot, save/load, combat, AI,
   UI, mobile input, audio hooks) rather than skimming for lint errors.
2. Ran the full suite on the starting branch:
   `node tests/run-all.mjs` → **all 9 suites passed** initially, *except* the
   browser smoke test, which failed intermittently on "the hero moves on input".
   Chasing that flake exposed a real save/load bug (see #5).
3. Ran a 9,000-frame headless stress pass (random movement, attacks, spells,
   potions, talent spends, floor descents, shop/shrine UI) checking for NaNs,
   out-of-range hp/mana, negative gold and frame errors. No crashes surfaced;
   the state invariants held.
4. Reproduced save/seed behaviour directly in the page: rebuilding the same
   floor twice produced **identical tiles but different props, monsters, shop
   stock and bounties**. That is the root of several bugs below.
5. Added regression tests for every fix. Final state: **all 9 suites pass**,
   including 20+ new assertions.

Commands:

```sh
python3 scripts/check_site.py
npm test
```

---

## Bugs found

Severity is player impact, not lines of code. “Fixed” means changed in this
branch and covered by a test.

### 1. “Continue” could load the wrong run — **fixed**

`$('continueBtn').addEventListener('click', continueRun)` passed the browser's
`MouseEvent` as `continueRun(slotId)`. `Save.slot(event)` found no matching id
and silently fell back to slot I. A player whose newest save was in *Cinder
Vault* or *Reliquary* could click Continue and get *Hall of Ashes* — or a
failed load if slot I was empty.

Fix: the button calls `continueRun()` with no argument, and `continueRun`
ignores anything that is not a string. The loader is now authoritative about
“newest”.

Test: *“Continue resumes the newest slot, not slot I.”*

### 2. A save seed did not reproduce the floor — **fixed**

Only the tile layout was generated inside `withSeededRng`. `spawnProps`,
`spawnEnemies`, `rollBounties`, `rollEndlessAffixes` and `spawnMerchantStock`
ran afterwards on the global `Math.random` stream. Two builds of floor 3 with
seed 12345 had identical tiles but different chests, crates, monsters and
merchant stock. Any reload therefore rebuilt a different floor, despite the
README and the save system promising the opposite.

Fix: the whole content pass now runs inside a derived seed
(`withSeededRng(d.seed ^ 0x9e3779b9)`), and the remaining direct
`Math.random()` calls in item rolls, bounty/affix rolls and enemy speed jitter
were routed through `rngNow()`. Floor content is now reproducible without
changing the layout draws.

Test: *“it also reproduces its props, monsters, stock and bounties.”*

### 3. Reloading reset the floor's live state — **fixed**

Because the floor was rebuilt from the seed and only the player was overlaid:

- every opened chest closed again (infinite loot by reloading);
- every smashed crate returned;
- every slain monster respawned (kill/bounty farming);
- loot lying on the ground was deleted;
- a vault whose guardian had fallen re-locked its door.

Fix: the snapshot now includes `props` (opened/dead, keyed by index), `enemies`
(type, position, hp, max hp, elite trait, affixes, statuses, aggro, cooldown,
vault guard), ground `drops`, `vaultUnlocked`, and `shopStock`.
`restoreFloorState()` replays them on top of the freshly built floor, with
defensive validation (species whitelist, number clamps, walkable checks,
corpse/cap limits). The state is index/kind-checked so a changed floor layout
degrades safely instead of corrupting the run.

Test group: *“Floor state”* — 9 assertions.

### 4. Merchant rerolls reset on every load — **fixed**

`Save.load()` assigned `Game.shopRerolls` and `Game.shopRerollCost` **before**
`buildFloor()`, and `spawnMerchantStock()` then reset them to “2 rerolls at
20 + floor × 6”. Reloading therefore refunded spent rerolls and reset the
escalating price. Stock was also re-rolled, so a bad reroll could be undone.

Fix: stock, prices, rerolls and reroll cost are saved; `restoreFloorState()`
applies them **after** `buildFloor()`.

Test: *“spent rerolls stay spent”*, *“the reroll price keeps climbing”*,
*“the merchant's stock is the one you left.”*

### 5. Loading a run could replay a chapter and freeze the hero — **fixed**

`STORY.seen` was not part of the save. Every load replayed the current floor's
chapter card 900 ms later. Because the card holds the world, a resumed run
stopped responding with nothing apparently wrong. This is what made the browser
smoke test flake: the card could open during the 500 ms movement check. A quick
descent could also fire the previous floor's delayed card on the next floor.

Fix: `storySeen` is saved and restored before the floor is built; old saves
treat chapters up to their floor as read. The delayed card now verifies that its
floor is still current.

Tests: *“a reloaded run does not replay a chapter it has already told”*,
*“the chapters the run has read are saved.”*

### 6. A restored body could be embedded in a wall and unable to move — **fixed**

The loader accepted any position whose *tile* was walkable. It ignored the
hero's 15 px collision circle. A position exactly on a wall edge (or a save
made flush against masonry) restored with the circle already overlapping the
wall, so every direction was “blocked” and `moveWithCollision()` could not move
at all. The failing browser test showed exactly this: all four neighbouring
tiles walkable, 0 px of movement.

Fix: after restoring position, `circleHitsWalls(x, y, PLAYER_COLLISION_RADIUS)`
is checked and `findFreeSpot(..., TILE)` nudges the body to a spot that has both
clearance and somewhere to walk.

Tests: *“the saved body was initially overlapping the wall”*, *“a saved
position flush with a wall is repaired.”*

### 7. Importing a malformed backup could wipe every run — **fixed**

`importBackupFile()` removed all three slots **before** checking that the backup
contained any readable run. A file with a valid header but invalid run payloads
destroyed the player's saves and then reported “no active run”. Unknown slot ids
also funnelled into slot I through `Save.slot()`'s fallback.

Fix: validate and collect runs first, refuse the import if it claims runs but
none are readable, ignore unknown slot ids, and only then clear/write.

### 8. Panels could stack and leave a “ghost pause” — **fixed**

- Loading a slot from **Profile & Backup** (opened from the pause menu) left the
  paused game state behind but kept the pause overlay painted over the resumed
  run.
- Pressing `I` or `T` while paused put `Game.state` back to `playing` while the
  pause panel stayed visible; closing the panel then resumed the world behind a
  pause screen.

Fix: `continueRun()` clears the in-game panels and flags before loading;
opening the satchel/talents removes the pause overlay.

Tests: *“opening the satchel dismisses the pause panel”*, *“closing the satchel
leaves no ghost pause screen”*, *“loading while paused clears the pause panel.”*

### 9. The mute icon lied after a reload — **fixed**

`boot()` ended by unconditionally writing `♪` into `#soundBtn`, overwriting the
muted `✕` that had just been restored from Settings. The game was silent but
looked unmuted.

Fix: removed the override. Test: *“the mute icon still reads muted after a
reload.”*

### 10. Opened chests stayed interaction targets — **fixed**

`nearestInteractable()` never skipped `chest.opened`. Standing by an opened
chest kept the hint bar saying “press F to open the chest” (F did nothing), and
the chest could outrank the stairs or merchant next to it.

Fix: opened chests are skipped. Test: *“an opened chest is no longer offered as
a target.”*

### 11. Hit-stop was decremented but never applied — **fixed**

`Game.hitStop` was set to 0.03 s on player damage and decremented each frame,
but no code read it, so the advertised impact freeze did not exist.

Fix: the simulated `dt` is multiplied by 0.3 while hit-stop lasts (animation
time is untouched). Combat now has the small impact beat the README describes.

### 12. Props stacked on the same tile — **fixed**

Crates, braziers, chests and clutter each called `randomRoomFloor()` without
checking existing props. Reproduction produced two crates at the same pixel
(double loot, one sprite), and chests could spawn inside furniture. The
guaranteed key crate had the same problem.

Fix: a generous `propNear()` check plus retrying spot searches; the key crate
also refuses occupied spots. Prop layout is still seed-deterministic.

### 13. Save bloat: equipment was serialised twice — **fixed**

`snapshotRun()` wrote the full equipment map both under `player.equipment` and
at the top level, with the player copy never read. Removed the duplicate (the
loader still reads old saves that have it).

### Smaller issues fixed along the way

- Exporting a backup while paused did not save the live run first; it exported
  the previous autosave while claiming success.
- An item melted for gold because the satchel was full did not count toward
  `totalGold` or the end-of-run gold total.
- A flawless-kill bounty's counter was saved but the live streak behind it was
  not; the first kill after a reload rewound progress to 1.
- README/meta tags still claimed a “single HTML file” and “every sound
  synthesized”, although the project is now three local scripts and mostly
  recorded audio. Updated.

---

## Known issues — all fixed in the 2026 systems pass

These were real at review time. Each now has a concrete implementation and a
regression test or a documented limit; the original reasoning is kept so the
trade-offs are still visible.

### A. `solid` props do not collide with anything (medium)

**Fixed:** `circleBlocked()` now unions walls with a 64 px prop hash; solid props with radius ≥11 get a `min(13, 0.78r)` collider, movement slides against it, enemies use the same check, and the spawn pass runs after the prop hash is rebuilt so seeded floors stay identical. Tiny debris stays walkable.

`Prop.solid` is set for crates, chests, statues, bookshelves, tables, etc., but
`circleHitsWalls()` only consults dungeon tiles. Consequently the hero and every
monster can walk straight through furniture, chests and unbroken crates.
`solid` currently affects only *placement* checks. Adding colliders is the right
fix, but it needs:

- circle-vs-prop collision with the same corner sliding as walls;
- AI steering/avoidance, or enemies will grind on furniture;
- spawn-time reachability checks so a prop cannot seal a door or the shrine;
- a way to break/step over small props.

This is worth doing as a dedicated gameplay pass, not as a quiet patch.

### B. Save-scumming inside the autosave window (medium)

**Fixed:** `Save.requestSave()` debounces a write 200 ms after every transaction (chest, crate, purchase, reroll, sale, talent spend, station, relic, hunt, corpse, level-up and floor change). The 5 s autosave remains as the backstop.

Saves happen every 5 s. Anything done in the last few seconds can be undone by
reloading: a bad reroll, a purchase, a chest's contents. Floor state now
persists, but the *transaction* is not committed until the next write. A cheap
mitigation is to call `Save.save()` after loot/purchase/reroll/level-up; a full
fix needs either a write-through event log or “one autosave per action” with
debouncing.

### C. Determinism covers generation, not simulation (low/medium)

**Fixed:** the loop is a fixed 60 Hz accumulator with render interpolation. `update()` swaps in the per-run `Game.simRng` for the whole simulation and stores its state in the save. `tests/replay.mjs` runs four seeds through the same input timeline twice and requires identical player, enemy and RNG state.

The seed guarantees the same floor, props, monsters and stock. It does not
guarantee identical combat: `update()` uses variable `dt`, and AI/cooldowns are
integrated from it. A 30 fps machine and a 144 fps machine can resolve a fight
differently. A fixed 60 Hz accumulator with render interpolation would make
runs reproducible (and enable replays/daily challenges). See improvement #1.

### D. No line-of-sight on interactions (low)

**Fixed:** `nearestInteractable()` raycasts the tile grid between hero and target; a chest on the far side of a wall is no longer offered. Stairs, stations, remains and vault prompts use the same check.

Chests, the merchant and the shrine are selected purely by distance. A chest on
the other side of a wall within 72 px can be opened. `circleHitsWalls` or a
simple grid raycast between hero and target would close this.

### E. Interaction radii disagree (low)

**Fixed:** a single `INTERACT_RADIUS = 72` is used by prompts, `descend()`, the vault prompt, stations and remains.

The stairs prompt appears within 72 px, but `descend()` accepts 52 px. Between
those distances the game says “press F to descend” and then refuses. A shared
`INTERACT_RADIUS` constant would fix the mismatch.

### F. Some transient combat state is not restored (low)

**Fixed:** player cooldowns, invulnerability, dodge window, hurt flash, buffs, Ember command, enemy status/aggro, opened/used props, floor loot, merchant rerolls, the Director state and the RNG stream all persist. In-flight projectiles are deliberately not serialised; enemies resume with a short safety cooldown so a load cannot instantly hit the player.

Enemy wind-ups, in-flight projectiles, knockback impulses and combo timers reset
on load. Enemies are restored with a short safety cooldown so a resumed fight
cannot instantly hit the player — a reasonable compromise, but not a
frame-exact resume.

### G. Accessibility is partial (low/medium)

**Fixed:** focus is trapped inside modal pages, every action key is rebindable, standard-mapping gamepad support exists, a polite screen-reader live region narrates chests/levels/vault/hunts/danger, and colour-blind mode adds shape codes to rarity drops and item names. Reduced motion, high contrast and large UI remain.

Overlays toggle `aria-hidden`, but there is no focus trap, no keyboard
re-mapping, no gamepad support, no screen-reader narration of combat/toasts, and
the colour-coded rarity/element system has no colour-blind alternative beyond
high contrast. The mobile layout and reduced-motion support are already strong.

---

## Out-of-the-box improvement ideas

Grouped by ambition. Effort is a rough estimate for one developer; impact is
“does it change how the game feels or how long people stay?”.

### Tier 1 — quick wins that make the existing game feel finished

**Status: all seven implemented.** Fixed timestep + interpolation; transactional
save writes; confirmed abandons plus death/victory backup export; prop colliders;
shared interaction radius with line-of-sight; rebindable keys, gamepad and focus
traps; screen-reader live region.

| # | Idea | Why it fits | Effort | Impact |
| --- | --- | --- | --- | --- |
| 1 | **Fixed 60 Hz simulation + render interpolation** | Turns the seed into a true run identity, removes frame-rate-dependent balance, and unlocks replays/dailies. Add an accumulator in `loop()`, call `update(1/60)` N times, keep a previous/current transform for rendering. | 1–2 days | High |
| 2 | **Save-on-transaction** | Write immediately after chests/crates, purchases/rerolls, talent spends and level-ups, with a 200 ms debounce. Kills the save-scum window without changing autosave. | 3–4 h | Medium |
| 3 | **Confirm dangerous actions** | `Abandon Run` currently ends the run on one click. Confirm with the slot name and floor, and add “Export backup” as a second button on the death screen. | 2 h | Medium |
| 4 | **Prop collider pass** | See known issue A. Start with chests, statues and unbroken crates; give the AI a small repulsion vector. | 2–3 days | High |
| 5 | **Interaction LOS + one radius constant** | Small correctness/polish win; closes a cheap exploit. | 2 h | Low |
| 6 | **Gamepad + rebindable keys + focus trap** | The game is already one-canvas and keyboard-driven; adding controller support and a key-bind page is mostly input plumbing. | 1–2 days | Medium |
| 7 | **Screen-reader combat log** | A polite live region announcing “Chest opened: Vicious Steel Barbute”, “Level 5”, “Vault unlocked”, plus the existing hint bar. Purely additive, no canvas work. | 4–6 h | Medium |

### Tier 2 — new systems that reuse what is already there

**Status: all ten implemented.** Elemental reactions; six room stations; Ember
commands and scent; corpse runs; adaptive Director + Heat; seed codes, daily
descent and ghost race; photo mode and 5 s clips; chronicles with copy/download;
relic drafts; named hunts with persistent titles. Deliberate scope notes: the
ghost records at 1 Hz rather than 10 Hz (720 points is enough for a readable
silhouette and a small save), clips record the *next* five seconds rather than a
rolling buffer, and the relic pool is twelve readable relics rather than twenty
stat sticks.

1. **Elemental reactions (the highest-value gameplay idea).**
   The status engine, weapon elements and biome-weighted loot are already in
   place, but the ring's element is ignored whenever the weapon has one. Make
   both elements *coexist* and react: Fire + Frost = **Shatter** (burst damage,
   removes chill), Frost + Storm = **Conduction** (chain to wet/armoured foes),
   Fire + Storm = **Plasma** (burn spreads in an arc). This turns one affix roll
   into a build decision and gives the three biomes mechanical identity.

2. **Room personalities become mechanics, not decoration.**
   There are 11 personalities and 31 furniture kinds, all currently cosmetic.
   Turn six into one-use stations:
   - *Library*: read a book → identify a random item's hidden affix or reroll
     one item's stats once.
   - *Kitchen*: cauldron → turn two potions into an Elixir (heal + brief buff).
   - *Workshop*: anvil → upgrade one item's tier for gold, with a chance to
     crack it.
   - *Crypt*: sarcophagus → guaranteed rare, but wakes the room.
   - *Counting House*: gamble gold on a coin flip (thieves' guild reputation).
   - *Sunken Garden*: harvest a herb used by the cauldron.
   This is the cheapest way to make exploration *mean* something.

3. **Ember commands and scent.**
   She is already a pathing, biting, reviving companion with bond/upgrades.
   Add one contextual command (tap/press `C`): “fetch” sends her to the nearest
   drop or chest key and brings it back; “sniff” reveals a secret/vault key hint
   on a long cooldown; “guard” makes her body-block a lane. Bond rank could
   unlock a once-per-floor revive. Small UI, large emotional payoff.

4. **Dungeon memory across runs (corpse runs).**
   Store the death floor, seed, position and one carried item in the meta save.
   The next run on that slot shows a scar/ghost marker on the minimap; reaching
   it recovers the item and a line of story. This makes the existing “the
   dungeon remembers” fiction mechanical, and gives a reason to start a new run
   after a death instead of closing the tab.

5. **Adaptive Director + a player-facing risk dial.**
   Track time-to-kill, damage taken per floor, potion use and deaths. The
   Director can quietly shift spawn composition (not raw stats) toward more
   ranged/rushers when the player is comfortable. In parallel, an altar offers
   optional **Heat** (extra elite, darkness, no potions) for a loot-quality
   multiplier — a Hades-style difficulty the player chooses. The endless affix
   pool already supplies the vocabulary.

6. **Daily seed + shareable run codes + ghost race.**
   `withSeededRng` makes this nearly free. Show a code like `DR-7F3A-91C2`;
   typing it reproduces the daily dungeon and contract. Record the player's
   path/inputs or periodic state (10 Hz) for a ghost; replaying the ghost of
   your best run is a strong “one more run” hook with no server.

7. **Highlight reel / photo mode.**
   Pause, hide HUD, allow a small zoom/pan; `MediaRecorder` over
   `canvas.captureStream(30)` exports the last 5 seconds as WebM, along with the
   run seed. Attach the seed to the clip so viewers can play the same floor.

8. **A run chronicle.**
   At death/victory, compose a short prose chronicle from actual events: floor
   reached, oaths sworn, bounties completed, Ember's bond, the monster that
   killed you, a room epitaph. Render it in the existing menu shell and offer
   “Copy / download as Markdown”. It turns a run into a keepsake, not a score.

9. **Relic draft in Endless.**
   Every 3 floors after the Warden, offer three run-only relics (one of ~20
   procedural passives) — a Slay-the-Spire-style draft that keeps endless mode
   from becoming a stat wall. The oath and affix systems already show how to
   model run-only modifiers.

10. **Hunt board / named mini-bosses.**
    Generate named elites from the six champion traits plus a biome prefix
    (“Marrowhand, the Guttering”), give them a wanted poster in the merchant
    panel, and persist the hunt across slots. Killing one pays shards and a
    cosmetic title.

### Tier 3 — technical leverage

**Status: all six implemented.** Static floor bake plus half-resolution fog and
cached gradients; 64 px prop / 96 px enemy hashes; a replay suite in CI; PWA
manifest + offline service worker; and `scripts/balance-lab.mjs`, an optional
headless autoplay lab (kept out of CI on purpose).

1. **Pre-render the static floor to offscreen canvases.**
   The perf suite shows render is 2–5× the update cost on both viewports
   (32 ms desktop / 58 ms phone in a software rasteriser). Cache wall/floor
   tiles per room (they already exist as baked tiles), blit them, and only
   composite dynamic lights/fog/entities. This is the single biggest frame-time
   win available without WebGL.

2. **Downscale the light/fog buffers.**
   A half-resolution additive lightmap plus a 1/8 bloom (already present) can
   cut per-pixel gradient work substantially. Combine with cached gradients for
   torches/braziers instead of creating a radial gradient per light per frame.

3. **Spatial hash for separation/projectiles/interactions.**
   Enemy separation is O(n²); 60 enemies is 1,770 pairs. A 64 px grid makes it
   linear and keeps late endless floors cheap.

4. **Replay-based fuzz harness.**
   With fixed timestep + seeded generation, record `(seed, input timeline)` and
   replay in CI. Any desync or exception becomes a one-file reproduction. The
   existing headless harness already boots the real game.

5. **PWA install + offline-first.**
   The game already needs no network; a tiny service worker plus manifest lets
   players install it to the home screen and launch it offline. Keep the
   zero-server promise.

6. **Balance lab.**
   A headless bot that plays 500 runs with different contracts and reports
   deaths per floor, time-to-kill and gold curves. The seeded generation and
   harness make this practical, and it would catch balance regressions the
   current tests cannot see.

### Things I would *not* add

- Accounts, cloud saves or online multiplayer: they contradict the game's
  zero-dependency, local-first identity.
- External art/audio assets: the procedural look and inlined audio are the
  project's signature; new content should stay procedural.
- More stat affixes before the existing elements/furniture become mechanical —
  breadth without interactions just dilutes the loot pool.

---

## Suggested order of work (completed)

1. Merge the bug fixes in this branch (all covered by tests).
2. Fixed timestep + save-on-transaction (Tier 1 #1–2).
3. Elemental reactions + six furniture stations (Tier 2 #1–2).
4. Ember commands + corpse runs (Tier 2 #3–4).
5. Prop colliders + interaction LOS, then the render/perf pass (Tier 1 #4–5,
   Tier 3 #1–3).
6. Daily seed + ghost race, Heat/Director, relics, hunts, chronicle, photo mode
   and PWA (Tier 2 #5–10, Tier 3 #5).

All six steps are done on this branch.

## Verification after this review

```sh
python3 scripts/check_site.py   # PASS (220 unique IDs, 4 scripts, CSS balanced)
node tests/run-all.mjs          # 11/11 suites pass
node scripts/balance-lab.mjs --runs 20   # optional, not a gate
```

Current suite counts: browser 43/43, save 95/95, mobile 155/155, gameplay 75/75,
features 48/48, replay 9/9, hero 8/8, vault PASS (80 seeded floors), audio 31/31,
creature voices PASS, perf within its frame budget.

Coverage added across the whole pass: newest-slot Continue, story persistence,
collision-safe resume, floor-state persistence (chests, corpses, loot, vault,
merchant, flawless streak, used stations), deterministic content rebuild,
opened-chest targeting, panel stacking, the mute icon, backup-import validation,
every 2026 system above, and the seed+input replay guarantee.

Known limits that remain deliberate: in-flight projectiles are not serialised;
the ghost is a 1 Hz breadcrumb, not an input replay; clips capture forward, not
a rolling buffer; the balance lab uses a simple chase-and-swing bot and is a
trend tool rather than a tuner; and all saves remain local to one browser.
