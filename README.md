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
