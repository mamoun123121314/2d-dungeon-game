/* ---------------------------------------------------------------------------
   Dungeon detail pass — the things that make a floor look lived in.

   The tile art gives every stone its own shape, but a room still reads as
   "tiles" until something sits ON the floor and something catches the light
   at the edges. This module draws that layer, one tile at a time:

     * floor debris   — pebbles, bone chips, dropped coins, straw, spent
                        arrows: sparse, deterministic per tile, themed
     * puddles        — shallow water with a rim and a specular highlight
     * wall highlights— a warm rim where torchlight grazes a wall top, and a
                        cool fill on the shadow side, so walls stop being flat
     * wall-face depth— recessed mortar lines and a darker occlusion band at
                        the foot of each wall block

   Everything here is deterministic: a tile always gets the same debris, so
   nothing "shimmers" as the camera moves and a floor looks intentional rather
   than randomly sprinkled.
   --------------------------------------------------------------------------- */

function createDungeonDetail() {
  /* Cheap deterministic hash: same tile, same debris, every frame. */
  function h(x, y, salt) {
    let n = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
    n = (n ^ (n >>> 13)) * 1274126177 | 0;
    n = (n ^ (n >>> 16)) >>> 0;
    return n / 4294967296;
  }

  /* ---- debris styles per theme ---- */
  const DEBRIS = {
    stone: [
      { kind: 'pebble', col: 'rgba(150,156,170,0.42)' },
      { kind: 'bone',   col: 'rgba(226,222,206,0.50)' },
      { kind: 'straw',  col: 'rgba(150,126,72,0.34)' },
      { kind: 'coin',   col: 'rgba(214,176,86,0.55)' },
    ],
    lava: [
      { kind: 'pebble', col: 'rgba(92,72,64,0.50)' },
      { kind: 'bone',   col: 'rgba(206,196,176,0.44)' },
      { kind: 'ash',    col: 'rgba(30,24,22,0.55)' },
      { kind: 'ember',  col: 'rgba(255,140,60,0.55)' },
    ],
    ice: [
      { kind: 'pebble', col: 'rgba(150,186,208,0.40)' },
      { kind: 'bone',   col: 'rgba(220,232,240,0.46)' },
      { kind: 'shard',  col: 'rgba(190,232,255,0.55)' },
      { kind: 'coin',   col: 'rgba(196,176,120,0.45)' },
    ],
  };

  function debrisFor(themeKey, tx, ty) {
    const styles = DEBRIS[themeKey] || DEBRIS.stone;
    /* ~42% of tiles carry something; density is what makes it read as decay
       rather than confetti */
    if (h(tx, ty, 1) > 0.42) return null;
    const style = styles[Math.floor(h(tx, ty, 2) * styles.length) % styles.length];
    return {
      style,
      ox: h(tx, ty, 3) * 22 + 5,
      oy: h(tx, ty, 4) * 22 + 5,
      rot: h(tx, ty, 5) * Math.PI * 2,
      n: 1 + Math.floor(h(tx, ty, 6) * 3),
      variant: h(tx, ty, 7),
    };
  }

  function drawDebris(ctx, style, ox, oy, rot, n, variant) {
    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(rot);
    ctx.fillStyle = style.col;
    ctx.strokeStyle = style.col;
    for (let i = 0; i < n; i++) {
      const a = variant * 6 + i * 2.1;
      const dx = Math.cos(a) * (1.5 + i * 2.2);
      const dy = Math.sin(a) * (1.2 + i * 1.8);
      switch (style.kind) {
        case 'pebble': {
          const r = 0.9 + ((variant * 10 + i * 3) % 10) / 12;
          ctx.beginPath(); ctx.ellipse(dx, dy, r, r * 0.78, a, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'bone': {
          /* a short bone: shaft plus two knuckles */
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(dx - 2.2, dy); ctx.lineTo(dx + 2.2, dy); ctx.stroke();
          ctx.beginPath(); ctx.arc(dx - 2.4, dy, 1.05, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(dx + 2.4, dy, 1.05, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'straw': {
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.moveTo(dx - 3, dy + 1);
          ctx.quadraticCurveTo(dx, dy - 2.5, dx + 3, dy + 1.5);
          ctx.stroke();
          break;
        }
        case 'coin': {
          ctx.beginPath(); ctx.ellipse(dx, dy, 1.5, 1.1, a, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,240,190,0.35)';
          ctx.beginPath(); ctx.ellipse(dx - 0.4, dy - 0.35, 0.6, 0.45, a, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = style.col;
          break;
        }
        case 'ash': {
          ctx.beginPath(); ctx.ellipse(dx, dy, 2.2, 1.5, a, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'ember': {
          ctx.globalCompositeOperation = 'lighter';
          ctx.beginPath(); ctx.arc(dx, dy, 1.05, 0, Math.PI * 2); ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'shard': {
          ctx.beginPath();
          ctx.moveTo(dx, dy - 2.4);
          ctx.lineTo(dx + 1.3, dy + 1.2);
          ctx.lineTo(dx - 1.1, dy + 0.6);
          ctx.closePath(); ctx.fill();
          break;
        }
        default:
          ctx.beginPath(); ctx.arc(dx, dy, 1.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  /* ---- a shallow puddle with a rim and one specular streak ---- */
  function drawPuddle(ctx, sx, sy, seed, tint) {
    const px = sx + 5 + seed * 22;
    const py = sy + 5 + ((seed * 7) % 1) * 22;
    const rx = 6 + seed * 6, ry = 3.5 + seed * 3.5;
    ctx.save();
    /* the water body */
    ctx.fillStyle = tint || 'rgba(58,86,104,0.30)';
    ctx.beginPath(); ctx.ellipse(px, py, rx, ry, seed * 1.2, 0, Math.PI * 2); ctx.fill();
    /* a darker rim where the water sits against the stone */
    ctx.strokeStyle = 'rgba(0,0,0,0.24)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(px, py, rx, ry, seed * 1.2, 0, Math.PI * 2); ctx.stroke();
    /* specular: a thin bright streak, the thing that says "wet" */
    ctx.fillStyle = 'rgba(198,226,240,0.30)';
    ctx.beginPath();
    ctx.ellipse(px - rx * 0.32, py - ry * 0.34, rx * 0.30, ry * 0.22, seed * 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* ---- warm rim + cool shadow on a wall top, driven by nearby torches ---- */
  function drawWallHighlight(ctx, sx, sy, size, light, openness) {
    /* `light` is 0..1 how much torch is nearby; `openness` is how many of the
       four neighbours are open floor, which decides where the rim falls. */
    if (light <= 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(sx, sy, sx, sy + size * 0.62);
    g.addColorStop(0, `rgba(255,226,168,${0.13 * light})`);
    g.addColorStop(0.55, `rgba(255,206,140,${0.05 * light})`);
    g.addColorStop(1, 'rgba(255,200,130,0)');
    ctx.fillStyle = g;
    ctx.fillRect(sx, sy, size, size * 0.62);
    ctx.restore();

    /* cool fill on the shaded side, so the block has two temperatures */
    if (openness > 0) {
      ctx.save();
      const c = ctx.createLinearGradient(sx, sy + size * 0.55, sx, sy + size);
      c.addColorStop(0, 'rgba(120,150,190,0)');
      c.addColorStop(1, `rgba(120,150,190,${0.07 * (1 - light)})`);
      ctx.fillStyle = c;
      ctx.fillRect(sx, sy + size * 0.55, size, size * 0.45);
      ctx.restore();
    }
  }

  /* ---- recessed mortar + a darker band at the foot of a wall face ---- */
  function drawWallFaceDepth(ctx, sx, sy, size, faceH) {
    ctx.save();
    /* two horizontal joints, darker than the stones between them */
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.fillRect(sx, sy + faceH * 0.34, size, 1);
    ctx.fillRect(sx, sy + faceH * 0.69, size, 1);
    /* occlusion where the face meets the floor */
    const g = ctx.createLinearGradient(sx, sy + faceH - 3, sx, sy + faceH);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(sx, sy + faceH - 3, size, 3);
    ctx.restore();
  }

  return { debrisFor, drawDebris, drawPuddle, drawWallHighlight, drawWallFaceDepth, hash: h };
}

window.createDungeonDetail = createDungeonDetail;
window.DungeonDetail = createDungeonDetail();
