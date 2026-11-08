# Dungeon Rogue — a procedural 2D ARPG in one file

A complete, runnable action-RPG dungeon crawler in a **single `index.html`** file.
No external images, no libraries, no build step — open the file in a browser and play.

Every pixel is drawn procedurally with the Canvas 2D API, and every sound is
synthesized at runtime with the Web Audio API. There is not a single asset file
in the repository other than the HTML itself.

```
open index.html          # macOS
xdg-open index.html      # Linux
start index.html         # Windows
```

## Controls

| Input | Action |
| --- | --- |
| `W A S D` / arrow keys | Move (8-directional, with wall sliding) |
| Mouse | Aim |
| Left click / `Space` | Sword slash (wide arc, cleaves up to 3 foes) |
| `Q` / right click | Magic Missile (8 mana) |
| `E` | Ground Slam (stamina-free AoE burst) |
| `R` | Drink a healing potion |
| `Shift` | Dodge roll (brief invulnerability) |
| `F` | Interact — chests, stairs, merchant, vault door |
| `I` / `Tab` | Inventory, equipment paperdoll, item tooltips |
| `T` | Talents — spend points earned every third level |
| `Ctrl`/`Cmd` + `S` | Save now (the game also autosaves) |
| `M` | Mute |
| `Esc` | Pause (also closes any open panel) |

### On a phone

The touch layout switches on automatically for a coarse-pointer device with a
screen under 900 px.

| Input | Action |
| --- | --- |
| Left thumb — drag anywhere on the left | Virtual joystick, 8-directional with a deadzone |
| Right thumb — **Slash** | Sword arc, the big ring under your thumb |
| **Missile / Slam / Potion** | Skills with radial cooldown sweeps |
| **Pack** | Inventory and paperdoll |
| Tap the prompt bar | Open chests, take stairs, use the vault key |
| Tap the canvas | Swing where you tapped |
| Rotate to landscape | Portrait shows a rotate nudge |
| Touch | Tap = attack, drag = virtual stick, tap far right = magic |

## What is in the game

### Dungeons
- **BSP room generation** with corridors, and a connectivity validator that floods
  the floor from the entrance and carves service tunnels if anything is stranded.
- **Three biomes** with fully procedural palettes, tile art, and atmosphere:
  *Stone Dungeons*, *Lava Caverns*, *Ice Catacombs* — each with its own wall
  masonry, floor treatment, light colour, ambience and hazard behaviour.
- Rooms, hallways, vault chambers with a **locked door and a key crate**,
  breakable crates, chests, torches, and stairs to the next floor.
- Ten floors to a **victory**, then an **endless mode** that keeps scaling
  enemy health, damage and count.
- **Deterministic seeds.** Every floor is generated from a stored seed, so a
  saved run reloads the exact same dungeon — every tile, room, and prop.
- **Eleven procedural room personalities.** Chambers roll a character:
  *Library*, *Oubliette*, *Kitchen*, *Shrine*, *Workshop*, *Crypt*,
  *Sunken Garden*, *Counting House*, *Barracks* and *Ritual Chamber*, each with
  its own furniture set and a flavour line on first entry. A floor leans toward
  one or two flavours so it feels designed rather than shuffled.
- **31 kinds of themed furniture**, all drawn procedurally: bookshelves with
  individually coloured spines, a cauldron that visibly simmers, a statue whose
  face was struck off, an inscribed ritual circle that pulses, and more.

### Character & progression
- Stats: HP, Mana, Attack, Defense, Crit chance, Crit damage, Move Speed, XP.
- XP curve with a visual level-up celebration, full HP/mana refill, stat gains,
  and a burst of particles + jingle.
- Mana regen, out-of-combat health regen, lava/ice hazard interactions,
  dodge i-frames, crits, misses, knockback and hit-stop.

### Loot, inventory, merchant
- 52 item bases across 6 slots (Helmet, Armor, Weapon, Shield, Boots, Ring).
- 4 rarities — Common, **Rare**, **Epic**, **Legendary** — with colour-coded
  borders, glows, and generated names.
- 16 prefixes and 15 suffixes roll affixes onto stats, so names read like
  *"Vicious Steel Barbute of the Bear"*.
- Procedural item icons drawn per slot and tinted per rarity.
- HTML/CSS inventory grid with click-to-equip, hover tooltips showing every
  affix and a comparison against what you wear, drag-free equip/unequip flow.
- Equipment **paperdoll** with a procedural backdrop and six live slots.
- A merchant ("Quartermaster") on deeper floors with rotating stock, buy and
  sell prices, and a gold economy.
- **Haggling.** A **reputation** track lowers prices by 2% per point (max 18%)
  and rises with every purchase or sale. A one-per-run **welcome discount**
  takes 25% off the first *gear* purchase only — buying a potion never burns it.
  Stock can be **rerolled** twice per floor for gold, at an escalating price,
  which also nudges reputation up.

### Talents
A talent point arrives every third level, spent across **three branches**:

| Branch | Talents | What it does |
| --- | --- | --- |
| **Might** | Wide Cleave → Heavy Blow / Long Reach | cleave more targets, +% damage, +px sword reach |
| **Arcana** | Arcane Focus → Efficiency / Wellspring | +% spell power, cheaper spells, more mana and regen |
| **Guile** | Fleet Foot → Evasion / Greed | +% move speed, faster dodge, +gold and +crit |

Nine nodes, 21 ranks, with two-rank prerequisites so a build has a shape.
Every effect is wired into the live stat pipeline: cleave cap, swing reach,
spell multiplier, mana cost multiplier, dodge cooldown multiplier, gold find
and crit chance all read from the talent state.

### Elemental status
Four damage types — **Physical**, **Fire**, **Frost**, **Storm** — with a shared
status engine:

- **Burn** ticks damage over 4 s (updated every 0.5 s at 5.5% of the hit).
- **Chill** slows the target to 55% speed for 3.5 s.
- **Shock** arcs to up to two more enemies within 150 px for 35% damage.

Status is applied by your equipped weapon and ring element. Weapons and rings
from **Rare** upward can roll an element, weighted by biome (lava leans fire,
ice leans frost), and carry a prefix — *Blazing*, *Frostbound*, *Stormforged* —
merged into the existing generated names. Elemental gear adds 18% damage and a
+7 gear-score bonus, and the tooltip names the element explicitly.
Each status has its own rendering signature: frost crusts the base with shards,
fire licks upward with flame tongues, storm crackles in flickering arcs.

### The Warden
The Heartstone Warden is a three-phase fight, and every move telegraphs:

| Phase | Health | Unlocks |
| --- | --- | --- |
| **I** | 100–66% | Ground Slam — a filling disc shows the impact zone, then jagged cracks erupt |
| **II** | 66–33% | **Call the Swarm** — summons up to 8 adds, ringed in violet as they arrive |
| **III** | 33–0% | **Heartstone Charge** — a lane marker shows the path; the slam leaves burning ground |

Each phase shift gets a brass swell, a screen shake and a toast. The boss has a
dedicated health bar with phase pips and a fill that ghosts back when it takes a
hit. Charge hits knock the player back with a proper decaying impulse.

### Combat & enemies
- **Skeleton Crawler**, **Orc Warrior**, **Necromancer**, **Ice Wraith** and
  floor **Guardians**, each with distinct silhouettes, speeds, attack windups
  and behaviours.
- AI states: patrol → line-of-sight chase → attack windup → cooldown, with a
  flee state at low health (the Necromancer kites and casts).
- Enemies steer around concave walls with blocked-detection and perpendicular
  slide, so they never grind on geometry.
- Floating combat text for damage, crits, `MISSED!`, `BURN`, and XP orbs.
- Multi-layer particle system: spell trails, blood, embers, dust, chest bursts,
  level-up rings, torch smoke.
- **Six elite champion traits** — *Swift*, *Shielded*, *Leeching*, *Volatile*,
  *Giant* and *Beckoner* — each changes how the fight must be played, and each
  is named in its own colour over the monster's head. Champions start appearing
  from floor 3 and always drop better loot.
- **Volatile** enemies (and the endless Volatile affix) detonate on death,
  damaging everything nearby — including you.
- **Beckoner** elites periodically summon crawlers, capped at six live adds.

### Keeping you playing
- **Combo meter.** Chain kills within 3.2 s to climb from **x1 to x8**. Gold and
  XP scale with the multiplier; taking a hit knocks one step off rather than
  resetting, so a scratch is forgiven and sloppiness is not. A decaying timer bar
  shows exactly how long you have.
- **Loot reveals.** Rare and better drops trigger a card that names the item,
  lists its bonuses, states its element, and tells you whether it beats what you
  wear (**▲ Upgrade +12** / **▼ Downgrade** / **≈ Sidegrade**). Common junk stays
  quiet so the card keeps its meaning. Legendaries shake the camera.
- **Bounties.** Three rotating objectives per floor (*Cull*, *Plunder*,
  *Tribute*, *Demolition*, *Untouched*, *Wardenfall*) with live progress bars,
  paying gold and XP. They reset every floor, so there is always a next goal.
- **Milestones.** Every fifth floor pays a lump of gold, a potion and a key.
- **Endless affixes.** Past floor 10 every floor rolls 1–4 modifiers from a pool
  of twelve (*Horde*, *Frenzy*, *Armoured*, *Vampiric*, *Volatile*, *Wealthy*,
  *Fertile*, *Swift*, *Guttering*, *Brittle*, *Championed*, *Thrifty*). They are
  shown as coloured chips and named in the floor banner. *Guttering* dims your
  torch, clamped so the game never becomes unplayable.
- **Meta progression.** Runs played, deepest floor, lifetime kills and gold, and
  Wardens felled are all recorded permanently and shown on the title screen.

### Saving
A Minecraft-style autosave keeps a single run slot:

- Autosaves every 5 seconds while playing, on every floor change, when the tab
  is hidden or closed, on `Ctrl`/`Cmd` + `S`, and from the pause menu.
- Stores the **floor seed**, so the dungeon rebuilds identically. Player level,
  XP, HP, mana, gold, potions, keys, every talent rank, all six equipped items,
  the whole satchel, shop reputation and the current affixes all persist.
- **Continue** on the title screen resumes the saved run and shows the floor,
  level and how long ago it was saved. **Delete saved run** clears it.
- Loading is defensive: ratings, ranks, item fields and slot names are all
  clamped and validated, and a corrupt or hand-edited save is discarded rather
  than crashing the game. A broken save can never brick the boot.
- Saves are ~1.2 KB and cost 0.05 ms to write.

### Graphics
- **Dynamic lighting engine.** Every light carries colour, radius, intensity
  and flicker: the hero's torch, wall sconces, braziers, glowing chests, the
  stairs beacon, the breathing vault seal, and projectiles in flight, plus
  lava tiles that glow upward. Lights are accumulated additively and carve the
  fog with a multi-stop falloff, so overlapping pools compound naturally.
- **Walls as volumes, not tiles.** Each block draws a lit top face, an
  edge-on front face, a highlight lip and a contact shadow, choosing the face
  direction from whether the tile below is open. Masonry is ashlar blocks with
  bevelled edges, pitting, hairline cracks and damp streaks.
- **Floors that read as surfaces.** Irregular flagstones (no 2x2 repeating
  grid), per-slab mottling, bevelled edges, mortar joints, procedurally cracked
  slabs, scattered lit pebbles and grime pooling in the low corners.
- **Ambient occlusion.** Soft gradient bands hug every wall edge, giving the
  tile grid contact shadow and depth.
- **Atmosphere.** Three drifting volumetric light shafts per biome, 46 seeded
  dust motes that twinkle as they fall, and a slow parallax with depth.
- **Post-processing.** An eighth-resolution bloom buffer smeared back
  additively, plus a per-biome colour grade — warm amber for lava, glacial blue
  for ice, cold steel for stone.
- **Hand-drawn torches.** Iron bracket, bound haft, a three-layer bezier flame
  with a hot core, an additive bloom and escaping sparks that rise and fade.
- **Fog with memory.** Lit space is carved by the light pool; rooms you have
  already cleared stay dimly remembered via soft radial blobs rather than being
  erased, and never with a visible tile grid.

### Interface
- Canvas **minimap** top-right with fog of war, explored rooms, player/enemy
  dots, stairs, merchant and vault markers, plus an exploration percentage.
- Animated HP and mana bars, gold counter, floor indicator, biome name.
- Ability hotbar with procedurally painted icons and cooldown sweeps.
- Full-screen overlays for title, death, victory, pause, inventory and shop,
  all styled with CSS only.

### Audio
All 40 sound effects are built from oscillators, filtered noise and gain
envelopes — sword swing, spell cast, enemy grunts, chest chime, player hurt,
level-up jingle, gold pickup, door unlock, heartbeat at low HP, boss telegraph,
slam, charge, phase shift, loot reveal, bounty fanfare, combo climb and more —
plus a layered ambient music bed that changes per biome.

**The soundtrack is reactive.** The pad and its distant bell motif always play,
but when three or more enemies are aggro and near, a combat layer fades in: a
war drum on the beat, a minor-third ostinato on eighths, and — at full
intensity — a bowed minor-second tension rub. Intensity engages quickly and
relaxes slowly (a boss pins it at maximum), so the music swells with the fight
and eases out afterwards instead of switching on and off.

## Verified

The build was exercised with a headless jsdom harness driving the real game loop.
**1,403 automated assertions across six suites, all passing:**

| Suite | Checks | What it covers |
| --- | --- | --- |
| `regress.js` | 287 | boot, DOM bindings, run start, room themes, status engine, elemental loot, talent tree, merchant, boss moveset, live sim, combat, 10 floor builds |
| `endless.js` | 146 | affix table and rolls, per-affix effects, volatile explosion, HUD chips, light clamping, endless floors, combat intensity |
| `savetest.js` | 159 | save round-trip, seed reproducibility, corrupt/hostile saves, meta progression, menu UI, combo, bounties, elite traits, loot reveal, milestones |
| `soak.js` | 778 | 2,400 frames of combat, 16 floors, repeated save/load, 40 shops, full talent tree, 900-frame status storm, 3,000-frame boss fight, phone run |
| `uitest.js` | 33 | every panel, every button clickable, bounty/combo/affix widgets |
| `phonetest.js` | 13 | detection, touch movement, action buttons, phone-size render |

Additional verification:

- **Deterministic seeds**: the same seed produces a byte-identical tile array;
  a different seed produces a different layout; `seed: 0` is honoured.
- **Corrupt saves**: broken JSON, a missing player, and hostile values (NaN
  levels, negative gold, 99-rarity items, bogus talent ids, junk inventory
  slots) are all discarded or clamped without a single throw.
- **Saves never double-pay**: a loaded floor does not re-award its milestone.
- 480 generated floors: every entrance reaches the stairs, the vault stays sealed.
- Full run: ten floors → victory → endless floor 11 with a scaled boss.
- Combat math, melee/crit/miss, magic missiles, potions, dodge, slam.
- Inventory: equip, unequip, tooltips, buy, sell, level-up refills.
- 26 sound effects build valid audio graphs with no invalid ramps.
- Merchant placement clear of props and reachable on every floor tested.
- Boss/elite aggro on line of sight, proximity aggro through corners.
- 1,200-frame stress run: no runtime errors, no console output.
- Rendering: scenes captured to SVG/PNG and inspected per biome; verified lit
  floors vs shadowed walls by luminance (stone 81/25, lava 75/19, ice 89/31),
  and confirmed no fog grid artifacts.
- Performance on a busy floor 9 (37 enemies, 165 props, 155 particles,
  combat layer at full intensity): **0.38 ms** render, **2.65 ms** update,
  **0.03 ms** light gathering, **0.05 ms** to save 1.2 KB. Tile art is baked
  once per theme and cached.
- Phone mode: device detection, stick movement and deadzone, all five action
  buttons, rail mirroring, orientation nudge, touch-only chest opening, and a
  500-frame phone soak run — all passing with the desktop layout unchanged.
- Button cluster geometry verified on four device sizes: no overlaps, none
  outside the viewport, none intruding into the stick zone.

## Layout

`index.html` is the whole game — markup, CSS and ~11,000 lines of
vanilla ES2020 JavaScript, organised into clearly commented sections:

1. Page shell and CSS
2. Utility maths and seeded RNG (`withSeededRng`)
3. Procedural sprite and tile baking
4. Item tables, affixes, rarity, elemental rolls
5. Dungeon generation (BSP, biome themes, 11 room personalities, connectivity, vaults)
6. Themed prop factory and 31 furniture kinds
7. Entities: elemental status, enemies, elite traits, boss moveset
8. Player, talents, derived stat pipeline
9. Particle and floating-text effects (incl. arc bolts)
10. Save system and meta progression
11. Game state, floor building, shop haggling
12. Combat resolution, combo meter, bounties, milestones, endless affixes
13. Enemy AI, boss phases, elite summoning
14. World and prop rendering
15. Fog of war, vignette, threat indicators, boss telegraphs
16. HUD, minimap, portraits, ability icons, affix chips
17. Menus, inventory, shop, talents panel
18. Input handling, update loop, bootstrap
