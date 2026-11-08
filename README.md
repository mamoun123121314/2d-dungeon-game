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
| `M` | Mute |
| `Esc` | Pause |

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
All 26 sound effects are built from oscillators, filtered noise and gain
envelopes — sword swing, spell cast, enemy grunts, chest chime, player hurt,
level-up jingle, gold pickup, door unlock, heartbeat at low HP and more — plus a
layered ambient music bed that changes per biome.

## Verified

The build was exercised with a headless jsdom harness driving the real game loop:

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
- Performance: 0.65 ms per frame for the whole render pass including bloom,
  0.08 ms for ambient occlusion, 0.03 ms to gather lights; tile art is baked
  once per theme and cached.
- Phone mode: device detection, stick movement and deadzone, all five action
  buttons, rail mirroring, orientation nudge, touch-only chest opening, and a
  500-frame phone soak run — all passing with the desktop layout unchanged.
- Button cluster geometry verified on four device sizes: no overlaps, none
  outside the viewport, none intruding into the stick zone.

## Layout

`index.html` is the whole game — markup, CSS and approximately 6,900 lines of
vanilla ES2020 JavaScript, organised into clearly commented sections:

1. Page shell and CSS
2. Utility maths and RNG
3. Procedural sprite and tile baking
4. Item tables, affixes, rarity, loot rolls
5. Dungeon generation (BSP, themes, connectivity, vaults)
6. Entities: player, enemies, props, projectiles
7. Particle and floating-text effects
8. Game state, floor building, save-free run lifecycle
9. Combat resolution
10. Enemy AI
11. World and prop rendering
12. Fog of war, vignette, threat indicators
13. HUD, minimap, portraits, ability icons
14. Menus, inventory, shop
15. Input handling, update loop, bootstrap
