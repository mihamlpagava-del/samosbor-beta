/**
 * ============================================================================
 * MODULE: spriteFactory.js (Procedural Tactical Top-Down Renderer for Samosbor)
 * ============================================================================
 * Pure procedural vector and geometric rendering designed specifically for the
 * Full-Color Swaggerfall ANSI Text-Mode Shader:
 * - High-contrast volumetric bunker blast walls with dual bevels & bolted plates
 * - Distinct floor plates with rivets, blood splatters, and toxic acid puddles
 * - Airtight blast doors with locking wheels & status illumination
 * - Cargo elevator extraction platform with pulsing hazard borders
 * - Dedicated representations for Tier 1-3 Samosbor Bestiary
 * - Zero dependency on obsolete raster graphics
 */

(function (global) {
  'use strict';

  const SpriteFactory = {
    /**
     * Render Volumetric Flashlight Beam & Ambient Illumination Aura
     */
    drawVolumetricFlashlight(ctx, player, tick) {
      if (!ctx || !player) return;

      const px = 0;
      const py = 0;
      const angle = 0; // Relative to rotated player container

      const beamDist = 480;
      const spread = 0.65; // ~75 degrees

      ctx.save();

      // 1. Forward directional beam cone
      const coneGrad = ctx.createRadialGradient(px, py, 18, px, py, beamDist);
      coneGrad.addColorStop(0, 'rgba(180, 255, 200, 0.45)');
      coneGrad.addColorStop(0.35, 'rgba(40, 224, 80, 0.25)');
      coneGrad.addColorStop(0.75, 'rgba(20, 140, 50, 0.10)');
      coneGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = coneGrad;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.arc(px, py, beamDist, angle - spread, angle + spread);
      ctx.closePath();
      ctx.fill();

      // 2. Wide 360-degree ambient aura around the player (radius 150px)
      const auraGrad = ctx.createRadialGradient(px, py, 6, px, py, 150);
      auraGrad.addColorStop(0, 'rgba(140, 255, 170, 0.32)');
      auraGrad.addColorStop(0.5, 'rgba(31, 224, 68, 0.16)');
      auraGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = auraGrad;
      ctx.beginPath();
      ctx.arc(px, py, 150, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    },

    /**
     * Render Industrial Bulkhead Wall Lantern ("Фонарь") with warm amber halo
     */
    drawWallLamp(ctx, lamp, TS, tick, alpha = 1.0) {
      if (!ctx || !lamp) return;

      const lx = lamp.x;
      const ly = lamp.y;
      const isRed = (lamp.type === 'emergency_lamp' || lamp.color === '#ff3b30');
      const isSpark = (lamp.type === 'sparking_panel');

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1.0, alpha));

      if (isSpark) {
        // Electrical panel fixture
        ctx.fillStyle = '#222d26';
        ctx.fillRect(lx - 8, ly - 6, 16, 12);
        ctx.strokeStyle = '#445b4b';
        ctx.lineWidth = 1;
        ctx.strokeRect(lx - 8, ly - 6, 16, 12);

        // Warning lightning glyph
        ctx.fillStyle = '#ffd700';
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('⚡', lx, ly + 3);

        // Flash & electric glow on spark
        if (lamp.isSparking) {
          const sGrad = ctx.createRadialGradient(lx, ly, 2, lx, ly, 75);
          sGrad.addColorStop(0, 'rgba(230, 245, 255, 0.85)');
          sGrad.addColorStop(0.3, 'rgba(120, 200, 255, 0.45)');
          sGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = sGrad;
          ctx.beginPath();
          ctx.arc(lx, ly, 75, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(lx - 3, ly);
          ctx.lineTo(lx + (Math.random() - 0.5) * 8, ly + (Math.random() - 0.5) * 8);
          ctx.stroke();
        }
      } else {
        // Bulkhead Lantern (Amber or Emergency Red)
        const flicker = 0.94 + Math.sin(tick * 0.15 + (lamp.x % 17)) * 0.06;
        const rad = (lamp.radius || 200) * flicker;

        const grad = ctx.createRadialGradient(lx, ly, 4, lx, ly, rad);
        if (isRed) {
          grad.addColorStop(0, 'rgba(255, 60, 40, 0.5)');
          grad.addColorStop(0.35, 'rgba(200, 20, 20, 0.22)');
          grad.addColorStop(0.75, 'rgba(120, 10, 10, 0.08)');
          grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        } else {
          grad.addColorStop(0, 'rgba(255, 195, 75, 0.48)');
          grad.addColorStop(0.35, 'rgba(255, 150, 30, 0.22)');
          grad.addColorStop(0.75, 'rgba(180, 80, 10, 0.08)');
          grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        }

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(lx, ly, rad, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = isRed ? '#ff3b30' : '#ffaa33';
        ctx.beginPath();
        ctx.arc(lx, ly, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.strokeStyle = isRed ? '#551111' : '#553311';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(lx - 5, ly);
        ctx.lineTo(lx + 5, ly);
        ctx.moveTo(lx, ly - 5);
        ctx.lineTo(lx + 5, ly);
        ctx.stroke();
      }

      ctx.restore();
    },

    /**
     *      */
    drawFloorTile(ctx, wx, wy, TS, alpha, seed = 0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1.0, alpha));

      const tx = Math.floor(wx / TS);
      const ty = Math.floor(wy / TS);
      const hash = Math.abs(((tx * 73856093) ^ (ty * 19349663) ^ (seed * 83492791)) >>> 0);
      const variant = hash % 8;

      // Base bunker steel floor color
      let baseColor = '#0f1814';
      if (variant === 0 || variant === 1) baseColor = '#131e19';
      else if (variant === 2) baseColor = '#111a15';
      else if (variant === 3) baseColor = '#0c1410';

      ctx.fillStyle = baseColor;
      ctx.fillRect(wx, wy, TS, TS);

      // Subtle panel frame
      ctx.strokeStyle = '#1b2a22';
      ctx.lineWidth = 1;
      ctx.strokeRect(wx + 0.5, wy + 0.5, TS - 1, TS - 1);

      // Corner rivets
      ctx.fillStyle = '#2d4236';
      ctx.fillRect(wx + 2, wy + 2, 2, 2);
      ctx.fillRect(wx + TS - 4, wy + 2, 2, 2);
      ctx.fillRect(wx + 2, wy + TS - 4, 2, 2);
      ctx.fillRect(wx + TS - 4, wy + TS - 4, 2, 2);

      // Floor variation details
      if (variant === 4) {
        // Ventilation grille slots
        ctx.fillStyle = '#080d0a';
        for (let g = 8; g < TS - 6; g += 5) {
          ctx.fillRect(wx + 6, wy + g, TS - 12, 2);
        }
      } else if (variant === 5) {
        // Blood spatter
        ctx.fillStyle = 'rgba(160, 20, 25, 0.7)';
        ctx.beginPath();
        ctx.arc(wx + TS * 0.45, wy + TS * 0.55, 5, 0, Math.PI * 2);
        ctx.arc(wx + TS * 0.65, wy + TS * 0.35, 3, 0, Math.PI * 2);
        ctx.arc(wx + TS * 0.3, wy + TS * 0.7, 2.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (variant === 6) {
        // Toxic neon-green acid puddle
        ctx.fillStyle = 'rgba(40, 240, 80, 0.65)';
        ctx.beginPath();
        ctx.arc(wx + TS * 0.5, wy + TS * 0.5, 6, 0, Math.PI * 2);
        ctx.arc(wx + TS * 0.7, wy + TS * 0.6, 4, 0, Math.PI * 2);
        ctx.fill();
      } else if (variant === 7) {
        // Warning hazard threshold stripe on one edge
        ctx.fillStyle = '#d4af37';
        ctx.fillRect(wx + 2, wy + 2, TS - 4, 4);
        ctx.fillStyle = '#111111';
        for (let hx = wx + 4; hx < wx + TS - 6; hx += 8) {
          ctx.fillRect(hx, wy + 2, 4, 4);
        }
      }

      ctx.restore();
    },

    /**
     * Render Heavy Monolithic Bunker Wall Tile
     */
    drawWallTile(ctx, wx, wy, TS, alpha, seed = 0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1.0, alpha));

      const tx = Math.floor(wx / TS);
      const ty = Math.floor(wy / TS);
      const hash = Math.abs(((tx * 92837111) ^ (ty * 68928749) ^ (seed * 49287313)) >>> 0);
      const wallStyle = hash % 4;

      // Base solid concrete block
      ctx.fillStyle = '#1c2821';
      ctx.fillRect(wx, wy, TS, TS);

      // Outer bevel border: top-left highlight, bottom-right shadow
      ctx.strokeStyle = '#385244';
      ctx.lineWidth = 2;
      ctx.strokeRect(wx + 1, wy + 1, TS - 2, TS - 2);

      // Inner structural plate
      ctx.fillStyle = '#24342b';
      ctx.fillRect(wx + 4, wy + 4, TS - 8, TS - 8);

      // Structural reinforced features
      if (wallStyle === 0) {
        // Horizontal girder ribbing
        ctx.fillStyle = '#3a5244';
        ctx.fillRect(wx + 4, wy + 10, TS - 8, 3);
        ctx.fillRect(wx + 4, wy + 20, TS - 8, 3);
      } else if (wallStyle === 1) {
        // Vertical girder ribbing
        ctx.fillStyle = '#3a5244';
        ctx.fillRect(wx + 10, wy + 4, 3, TS - 8);
        ctx.fillRect(wx + 20, wy + 4, 3, TS - 8);
      } else if (wallStyle === 2) {
        // Reinforced corner pillar with X-struts
        ctx.strokeStyle = '#3d594a';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(wx + 6, wy + 6);
        ctx.lineTo(wx + TS - 6, wy + TS - 6);
        ctx.moveTo(wx + TS - 6, wy + 6);
        ctx.lineTo(wx + 6, wy + TS - 6);
        ctx.stroke();
      } else {
        // Central bolted armored plate
        ctx.fillStyle = '#1a2620';
        ctx.fillRect(wx + 8, wy + 8, TS - 16, TS - 16);
      }

      // Heavy corner bolts
      ctx.fillStyle = '#82a894';
      ctx.fillRect(wx + 2, wy + 2, 2.5, 2.5);
      ctx.fillRect(wx + TS - 4.5, wy + 2, 2.5, 2.5);
      ctx.fillRect(wx + 2, wy + TS - 4.5, 2.5, 2.5);
      ctx.fillRect(wx + TS - 4.5, wy + TS - 4.5, 2.5, 2.5);

      ctx.restore();
    },

    /**
     * Render Airtight Hermetic Blast Door ("Гермодверь")
     */
    drawDoorTile(ctx, door, TS, tick, alpha = 1.0) {
      if (!ctx || !door) return;

      const x = door.x;
      const y = door.y;
      const w = door.w || TS;
      const h = door.h || TS;

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1.0, alpha));

      if (door.isOpen) {
        // OPEN DOOR: Recessed sliding plates into wall frame
        ctx.fillStyle = 'rgba(6, 26, 12, 0.5)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#1fe044';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

        // Green pathway lights
        ctx.fillStyle = '#1fe044';
        ctx.fillRect(x + 2, y + h / 2 - 2, 4, 4);
        ctx.fillRect(x + w - 6, y + h / 2 - 2, 4, 4);
      } else {
        // CLOSED BLAST DOOR: Heavy reinforced steel with locking wheel & hazard stripes
        ctx.fillStyle = '#261b10';
        ctx.fillRect(x, y, w, h);

        ctx.strokeStyle = '#ff9900';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

        // Hazard warning border
        ctx.fillStyle = '#ffaa00';
        for (let d = 2; d < w - 4; d += 8) {
          ctx.fillRect(x + d, y + 2, 4, 3);
          ctx.fillRect(x + d, y + h - 5, 4, 3);
        }

        // Central locking wheel
        const cx = x + w / 2;
        const cy = y + h / 2;
        ctx.strokeStyle = '#ffcc00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 7, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(cx - 7, cy);
        ctx.lineTo(cx + 7, cy);
        ctx.moveTo(cx, cy - 7);
        ctx.lineTo(cx, cy + 7);
        ctx.stroke();

        ctx.fillStyle = '#ff3b30'; // Red lock indicator
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    },

    /**
     * Render Cargo Elevator Extraction Zone
     */
    drawElevatorShaft(ctx, elevator, TS, tick, alpha = 1.0) {
      if (!ctx || !elevator) return;

      const x = elevator.x;
      const y = elevator.y;
      const w = elevator.w || TS * 2;
      const h = elevator.h || TS * 2;

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1.0, alpha));

      // 1. Teal decontamination base
      ctx.fillStyle = '#0a2324';
      ctx.fillRect(x, y, w, h);

      // 2. Yellow-black hazard perimeter
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);

      // 3. Central lift platform
      const cx = x + w / 2;
      const cy = y + h / 2;

      ctx.fillStyle = '#10383a';
      ctx.beginPath();
      ctx.arc(cx, cy, 26, 0, Math.PI * 2);
      ctx.fill();

      // Pulsing teal evacuation circle
      const pulse = 0.5 + Math.sin(tick * 0.12) * 0.5;
      ctx.strokeStyle = `rgba(0, 229, 255, ${0.4 + pulse * 0.6})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, 24 + pulse * 3, 0, Math.PI * 2);
      ctx.stroke();

      // Bold 'H' / Elevator Symbol
      ctx.fillStyle = '#00e5ff';
      ctx.font = 'bold 22px "Share Tech Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('H', cx, cy);

      ctx.restore();
    },

    /**
     * Render Loot Supply Crate
     */
    drawLootCrate(ctx, crate, TS, tick, alpha = 1.0) {
      if (!ctx || !crate || crate.opened) return;

      const x = crate.x;
      const y = crate.y;
      const type = crate.type || 'crate_ammo';

      ctx.save();
      ctx.globalAlpha = Math.max(0.2, Math.min(1.0, alpha));

      let bodyColor = '#1e3020';
      let frameColor = '#3b82f6';
      let label = 'SUPPLY';

      if (type === 'crate_ammo') {
        bodyColor = '#1c2814';
        frameColor = '#22c55e';
        label = 'AMMO';
      } else if (type === 'crate_med') {
        bodyColor = '#2d1418';
        frameColor = '#ef4444';
        label = 'MED';
      } else if (type === 'crate_tech') {
        bodyColor = '#2c2210';
        frameColor = '#f59e0b';
        label = 'TECH';
      }

      // Container Box (22x22)
      ctx.fillStyle = bodyColor;
      ctx.fillRect(x - 11, y - 11, 22, 22);

      ctx.strokeStyle = frameColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 11, y - 11, 22, 22);

      // Stencil Label
      ctx.fillStyle = frameColor;
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label[0], x, y);

      // Subtle pulse
      const pulse = Math.sin(tick * 0.15) * 2;
      ctx.strokeStyle = frameColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 14 + pulse, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    },

    /**
     * Render Dropped Weapon / Item on Floor (2D TDS)
     */
    drawDroppedWeapon(ctx, drop, TS, tick, alpha = 1.0) {
      if (!ctx || !drop || drop.pickedUp) return;

      const x = drop.x;
      const y = drop.y;

      const isMed = !!(drop.isMedkit || (drop.item && (drop.item.id === 'food_medkit' || drop.item.type === 'heal')) || (drop.name && drop.name.includes('Аптечк')));
      const isKeycard = !!(drop.isKeycard || (drop.item && (drop.item.id === 'keycard' || drop.item.type === 'keycard')) || (drop.name && drop.name.includes('Ключ')));
      const isAmmo = !!(drop.isAmmo || (drop.item && (drop.item.id === 'ammo_box' || drop.item.type === 'ammo')) || (drop.name && drop.name.includes('Патрон')));

      const wId = drop.weapon ? (drop.weapon.id || drop.weapon.type || drop.weapon.gunType || '').toLowerCase() : '';
      const isShotgun = wId.includes('shotgun') || wId.includes('ks23') || wId.includes('saiga');
      const isPistol = !isShotgun && (wId.includes('pm') || wId.includes('pistol') || wId.includes('gun'));
      const isPipe = !isShotgun && !isPistol && (wId.includes('pipe') || wId.includes('crowbar') || wId.includes('melee'));

      const now = Date.now();

      // Dynamic Y-Axis Hover & Pseudo-3D Rotation
      const hoverY = Math.sin(now * 0.003 + (drop.x % 10)) * 4;
      const rawScaleX = Math.cos(now * 0.004 + (drop.y % 10));
      const scaleX = Math.abs(rawScaleX);

      // Pulsing Ground Light Halo (12 to 18 px)
      const pulseRad = 12 + ((Math.sin(tick * 0.12) + 1) * 3);

      ctx.save();
      ctx.globalAlpha = Math.max(0.2, Math.min(1.0, alpha));

      // 1. Floor Ground Light Halo
      const haloGrad = ctx.createRadialGradient(x, y + 4, 2, x, y + 4, pulseRad);
      if (isKeycard) {
        haloGrad.addColorStop(0, 'rgba(0, 229, 255, 0.55)');
        haloGrad.addColorStop(0.65, 'rgba(0, 160, 220, 0.22)');
        haloGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      } else if (isMed) {
        haloGrad.addColorStop(0, 'rgba(51, 255, 100, 0.48)');
        haloGrad.addColorStop(0.65, 'rgba(40, 220, 80, 0.2)');
        haloGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      } else if (isShotgun) {
        haloGrad.addColorStop(0, 'rgba(255, 110, 0, 0.48)');
        haloGrad.addColorStop(0.65, 'rgba(230, 80, 0, 0.2)');
        haloGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      } else {
        haloGrad.addColorStop(0, 'rgba(255, 185, 0, 0.45)');
        haloGrad.addColorStop(0.65, 'rgba(240, 140, 0, 0.2)');
        haloGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      }
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.ellipse(x, y + 4, pulseRad, pulseRad * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();

      // 2. Distinct Item & Weapon Icons
      const itemW = Math.max(4, Math.floor((isShotgun ? 24 : 18) * scaleX));
      const itemH = isShotgun ? 12 : 18;
      const itemX = x - itemW / 2;
      const itemY = y - 8 + hoverY;

      if (isKeycard) {
        // High-Security Electronic RFID Keycard
        ctx.fillStyle = '#0a2e38';
        ctx.fillRect(itemX, itemY + 2, itemW, 14);
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(itemX, itemY + 2, itemW, 14);

        // Gold chip & access badge
        if (scaleX > 0.35) {
          ctx.fillStyle = '#ffd700';
          ctx.fillRect(x - 3 * scaleX, itemY + 6, 6 * scaleX, 5);
          ctx.fillStyle = '#00e5ff';
          ctx.fillRect(x - 5 * scaleX, itemY + 12, 10 * scaleX, 2);
        }
      } else if (isMed) {
        // Detailed Army Medkit with Red Cross
        ctx.fillStyle = '#e8ece9';
        ctx.fillRect(itemX, itemY + 2, itemW, 14);
        ctx.strokeStyle = '#2d4734';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(itemX, itemY + 2, itemW, 14);
        if (scaleX > 0.3) {
          ctx.fillStyle = '#d32f2f';
          ctx.fillRect(x - 2 * scaleX, itemY + 4, 4 * scaleX, 10);
          ctx.fillRect(x - 5 * scaleX, itemY + 7, 10 * scaleX, 4);
        }
      } else if (isAmmo) {
        // Military Ribbed Ammo Tin
        ctx.fillStyle = '#2d4427';
        ctx.fillRect(itemX, itemY + 3, itemW, 12);
        ctx.strokeStyle = '#47683d';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(itemX, itemY + 3, itemW, 12);
        if (scaleX > 0.35) {
          ctx.fillStyle = '#ffcc00';
          ctx.font = 'bold 6px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('AMMO', x, itemY + 11);
        }
      } else if (isShotgun) {
        // --- Heavy Riot Shotgun KS-23 (Long heavy ribbed barrel, wooden pump forend & buttstock) ---
        ctx.save();
        // Barrel & magazine tube
        ctx.fillStyle = '#1c2620';
        ctx.fillRect(itemX, itemY + 4, itemW, 4);
        // Wooden buttstock
        ctx.fillStyle = '#5c351c';
        ctx.fillRect(itemX, itemY + 5, itemW * 0.35, 6);
        // Ribbed pump forend
        ctx.fillStyle = '#7a4524';
        ctx.fillRect(itemX + itemW * 0.45, itemY + 6, itemW * 0.3, 4);
        // Barrel band
        ctx.fillStyle = '#ffd700';
        ctx.fillRect(itemX + itemW * 0.85, itemY + 3, 2, 6);
        ctx.restore();
      } else if (isPistol) {
        // --- Makarov Pistol PM (Compact steel slide, brown bakelite grip) ---
        ctx.save();
        // Steel Slide
        ctx.fillStyle = '#232f27';
        ctx.fillRect(itemX + itemW * 0.2, itemY + 4, itemW * 0.75, 5);
        // Textured Bakelite Grip
        ctx.fillStyle = '#6e301d';
        ctx.fillRect(itemX + itemW * 0.2, itemY + 8, itemW * 0.38, 7);
        // Front post
        ctx.fillStyle = '#1fe044';
        ctx.fillRect(itemX + itemW * 0.88, itemY + 3, 2, 2);
        ctx.restore();
      } else {
        // Pipe / Melee weapon
        ctx.strokeStyle = '#4e6354';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(itemX, itemY + 14);
        ctx.lineTo(itemX + itemW, itemY + 4);
        ctx.stroke();
        // Red valve wheel
        ctx.fillStyle = '#d32f2f';
        ctx.beginPath();
        ctx.arc(x, itemY + 9, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      const dropLabel = drop.weapon ? (drop.weapon.name || 'ОРУЖИЕ').slice(0, 16) : (isKeycard ? 'КЛЮЧ-КАРТА' : (isMed ? 'АПТЕЧКА' : (isAmmo ? 'ПАТРОНЫ' : (drop.item ? (drop.item.name || 'ПРЕДМЕТ').slice(0, 14) : 'ХАБАР'))));
      ctx.fillStyle = isKeycard ? '#00e5ff' : (isMed ? '#33ff77' : (isShotgun ? '#ff8800' : '#ffb703'));
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(dropLabel, x, itemY - 4);

      ctx.restore();
    },

    /**
     * Render Interactive Openable Chest / Bunker Container
     */
    drawChest(ctx, chest, TS, tick) {
      if (!ctx || !chest) return;
      const cx = chest.x;
      const cy = chest.y;
      const isOpened = !!chest.opened;

      ctx.save();
      // Chest shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 8, 14, 7, 0, 0, Math.PI * 2);
      ctx.fill();

      // Industrial container body
      ctx.fillStyle = isOpened ? '#2a3b30' : '#3d5244';
      ctx.fillRect(cx - 12, cy - 8, 24, 16);
      ctx.strokeStyle = '#1a261f';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cx - 12, cy - 8, 24, 16);

      // Steel reinforcement bands
      ctx.fillStyle = '#1c2620';
      ctx.fillRect(cx - 10, cy - 8, 3, 16);
      ctx.fillRect(cx + 7, cy - 8, 3, 16);

      if (isOpened) {
        // Open lid shifted up
        ctx.fillStyle = '#223228';
        ctx.fillRect(cx - 13, cy - 14, 26, 6);
        ctx.strokeStyle = '#141e18';
        ctx.strokeRect(cx - 13, cy - 14, 26, 6);

        // Golden interior loot gleam
        ctx.fillStyle = '#ffd700';
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Locked hasp & lock
        ctx.fillStyle = '#ffd700';
        ctx.fillRect(cx - 2, cy - 1, 4, 5);

        // Pulsing interaction prompt
        const pulse = Math.sin(tick * 0.15) * 2;
        ctx.fillStyle = '#00ffcc';
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('[E] СУНДУК', cx, cy - 12 + pulse);
      }

      ctx.restore();
    },

    /**
     * Render Speech Bubble above player head
     */
    drawSpeechBubble(ctx, x, y, text, name, alpha = 1.0) {
      if (!ctx || !text) return;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1.0, alpha));

      ctx.font = 'bold 10px "Share Tech Mono", monospace';
      const textMetrics = ctx.measureText(text);
      const bubbleW = Math.max(60, textMetrics.width + 16);
      const bubbleH = 22;
      const bx = x - bubbleW / 2;
      const by = y - 38;

      // Dark translucent backing with terminal border
      ctx.fillStyle = 'rgba(8, 22, 14, 0.92)';
      ctx.beginPath();
      ctx.roundRect(bx, by, bubbleW, bubbleH, 4);
      ctx.fill();

      ctx.strokeStyle = '#1fe044';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Triangle pointer down to head
      ctx.fillStyle = 'rgba(8, 22, 14, 0.92)';
      ctx.beginPath();
      ctx.moveTo(x - 5, by + bubbleH);
      ctx.lineTo(x + 5, by + bubbleH);
      ctx.lineTo(x, by + bubbleH + 6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#1fe044';
      ctx.beginPath();
      ctx.moveTo(x - 5, by + bubbleH);
      ctx.lineTo(x, by + bubbleH + 6);
      ctx.lineTo(x + 5, by + bubbleH);
      ctx.stroke();

      // Text
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(text, x, by + 15);

      ctx.restore();
    },

    /**
     * drawDecal(ctx, decal) {
      if (!ctx || !decal) return;
      ctx.save();
      const x = decal.x;
      const y = decal.y;
      const rad = decal.radius || 18;

      // Dark pool
      ctx.fillStyle = decal.color || '#4a0808';
      ctx.beginPath();
      ctx.ellipse(x, y, rad, rad * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();

      // Satellite blood droplets
      if (decal.splatters) {
        ctx.fillStyle = decal.splatterColor || '#991111';
        for (let i = 0; i < decal.splatters.length; i++) {
          const sp = decal.splatters[i];
          ctx.beginPath();
          ctx.arc(x + sp.dx, y + sp.dy, sp.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    },

    /**
     *      */
    drawEntity(ctx, entity, tick) {
      if (!ctx || !entity) return;

      const x = (entity.x || 0) + (entity.flinchX || 0);
      const y = (entity.y || 0) + (entity.flinchY || 0);
      const radius = entity.radius || 13;
      const angle = entity.angle || 0;
      const isFlash = entity.damageFlashTimer && entity.damageFlashTimer > 0;

      ctx.save();

      // 1. PLAYER
      if (entity.isPlayer) {
        // Flashlight cone
        if (!entity.isDead) {
          this.drawVolumetricFlashlight(ctx, entity, tick);
        }

        ctx.translate(x, y);
        ctx.rotate(angle);

        if (entity.isDead) {
          // Dead body collapsed on floor
          ctx.fillStyle = '#7a1c1c';
          ctx.beginPath();
          ctx.ellipse(0, 0, radius * 1.3, radius * 0.8, 0, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#3a0c0c';
          ctx.beginPath();
          ctx.arc(radius * 0.8, 0, radius * 0.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Tactical operator token
          const bodyColor = isFlash ? '#ffffff' : '#14381b';
          const armorColor = isFlash ? '#ffffff' : '#22592d';
          const visorColor = isFlash ? '#ffffff' : '#1fe044';

          // Body circle
          ctx.fillStyle = bodyColor;
          ctx.beginPath();
          ctx.arc(0, 0, radius, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = visorColor;
          ctx.lineWidth = 2;
          ctx.stroke();

          // Visor / aiming chevron
          ctx.fillStyle = visorColor;
          ctx.beginPath();
          ctx.moveTo(radius * 0.8, 0);
          ctx.lineTo(radius * 0.2, -radius * 0.45);
          ctx.lineTo(radius * 0.35, 0);
          ctx.lineTo(radius * 0.2, radius * 0.45);
          ctx.closePath();
          ctx.fill();

          // Weapon barrel pointing forward
          ctx.strokeStyle = '#d4d4d4';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(radius * 0.6, 3);
          ctx.lineTo(radius * 1.5, 3);
          ctx.stroke();

          // Muzzle flash on firearm shot
          if (entity.isShooting) {
            ctx.fillStyle = '#ffee44';
            ctx.beginPath();
            ctx.arc(radius * 1.6, 3, 6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      // 2. ALLY LIQUIDATOR
      else if (entity.type === 'liquidator') {
        ctx.translate(x, y);
        ctx.rotate(angle);

        const allyColor = isFlash ? '#ffffff' : (entity.isWounded ? '#ff9900' : '#00ccff');

        ctx.fillStyle = '#0f2938';
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = allyColor;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Visor
        ctx.fillStyle = allyColor;
        ctx.beginPath();
        ctx.arc(radius * 0.4, 0, radius * 0.3, 0, Math.PI * 2);
        ctx.fill();

        // Weapon
        ctx.strokeStyle = '#aaaaaa';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(radius * 0.5, 3);
        ctx.lineTo(radius * 1.3, 3);
        ctx.stroke();
      }
      // 3. BESTIARY MONSTER
      else {
        ctx.translate(x, y);

        const bId = entity.id || entity.archetype || '';
        const isDisguised = entity.isMimicDisguised;

        if (isDisguised) {
          // Voice mimic disguised as friendly blip
          ctx.fillStyle = '#0f2938';
          ctx.beginPath();
          ctx.arc(0, 0, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#00e5ff';
          ctx.lineWidth = 2;
          ctx.stroke();
        } else if (bId.includes('slime')) {
          // Black Slime: pulsating amorphous bio-blob
          const wobble = Math.sin(tick * 0.2 + (entity.x % 10)) * 2;
          ctx.fillStyle = isFlash ? '#ffffff' : '#22c55e';
          ctx.beginPath();
          ctx.ellipse(0, 0, radius + wobble, radius - wobble * 0.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#15803d';
          ctx.lineWidth = 2;
          ctx.stroke();

          // Toxic core
          ctx.fillStyle = '#14532d';
          ctx.beginPath();
          ctx.arc(wobble * 0.5, 0, radius * 0.45, 0, Math.PI * 2);
          ctx.fill();
        } else if (bId.includes('spore') || bId.includes('pseudoflesh')) {
          // Spore Pod / Pseudoflesh: pulsating stationary purple turret
          const pulse = Math.sin(tick * 0.15) * 2;
          ctx.fillStyle = isFlash ? '#ffffff' : '#9333ea';
          ctx.beginPath();
          ctx.arc(0, 0, radius + pulse, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#c084fc';
          ctx.lineWidth = 2.5;
          ctx.stroke();

          // Spore nozzles
          ctx.fillStyle = '#581c87';
          for (let ang = 0; ang < Math.PI * 2; ang += Math.PI / 2) {
            ctx.beginPath();
            ctx.arc(Math.cos(ang) * (radius * 0.6), Math.sin(ang) * (radius * 0.6), 3, 0, Math.PI * 2);
            ctx.fill();
          }
        } else if (bId.includes('rogue_liquidator')) {
          // Rogue Liquidator: heavy armored renegade with shotgun
          ctx.rotate(angle);
          ctx.fillStyle = isFlash ? '#ffffff' : '#332014';
          ctx.beginPath();
          ctx.arc(0, 0, radius, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = '#ea580c';
          ctx.lineWidth = 2.5;
          ctx.stroke();

          // Shotgun barrel
          ctx.strokeStyle = '#64748b';
          ctx.lineWidth = 3.5;
          ctx.beginPath();
          ctx.moveTo(radius * 0.5, 2);
          ctx.lineTo(radius * 1.5, 2);
          ctx.stroke();
        } else if (bId.includes('six_legged') || entity.behavior === 'leap_flank') {
          // Six-Legged Horror: sprawling crimson monstrosity
          ctx.fillStyle = isFlash ? '#ffffff' : '#b91c1c';
          ctx.beginPath();
          ctx.arc(0, 0, radius, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2.5;
          ctx.stroke();

          // 6 sprawling legs
          ctx.strokeStyle = '#dc2626';
          ctx.lineWidth = 2;
          for (let i = 0; i < 6; i++) {
            const legAng = (i / 6) * Math.PI * 2 + Math.sin(tick * 0.2 + i) * 0.2;
            ctx.beginPath();
            ctx.moveTo(Math.cos(legAng) * radius, Math.sin(legAng) * radius);
            ctx.lineTo(Math.cos(legAng) * (radius * 1.7), Math.sin(legAng) * (radius * 1.7));
            ctx.stroke();
          }
        } else {
          // Feral Inhabitant / Standard Mutant: jagged aggressive stalker
          ctx.fillStyle = isFlash ? '#ffffff' : (entity.color || '#f97316');
          ctx.beginPath();
          ctx.arc(0, 0, radius, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          // Glowing predatory eyes
          ctx.fillStyle = '#ff0033';
          ctx.beginPath();
          ctx.arc(radius * 0.4, -radius * 0.3, 2, 0, Math.PI * 2);
          ctx.arc(radius * 0.4, radius * 0.3, 2, 0, Math.PI * 2);
          ctx.fill();
        }

        // Draw Health Bar above wounded enemy
        if (entity.hp < entity.maxHp && entity.hp > 0) {
          const barW = 24;
          const barH = 3;
          const pct = Math.max(0, entity.hp / entity.maxHp);

          ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          ctx.fillRect(-barW / 2, -radius - 10, barW, barH);

          ctx.fillStyle = pct > 0.4 ? '#22c55e' : '#ef4444';
          ctx.fillRect(-barW / 2, -radius - 10, barW * pct, barH);
        }
      }

      ctx.restore();
    },

    /**
     * Render Tactical Crosshair
     */
    drawCrosshair(ctx, mx, my, tick, isOverEnemy) {
      if (!ctx || mx === undefined || my === undefined) return;

      ctx.save();
      const color = isOverEnemy ? '#ff3b30' : '#1fe044';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;

      const sz = 8;
      const gap = 3;

      ctx.beginPath();
      ctx.moveTo(mx - sz - gap, my);
      ctx.lineTo(mx - gap, my);
      ctx.moveTo(mx + gap, my);
      ctx.lineTo(mx + sz + gap, my);
      ctx.moveTo(mx, my - sz - gap);
      ctx.lineTo(mx, my - gap);
      ctx.moveTo(mx, my + gap);
      ctx.lineTo(mx, my + sz + gap);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(mx, my, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      ctx.restore();
    },

    /**
     * Render Melee Swing Slash Arc
     */
    drawMeleeSwingArc(ctx, px, py, angle, progress) {
      if (!ctx) return;
      ctx.save();
      const radius = 54;
      const arcSpread = 1.2;
      const startAngle = angle - arcSpread * 0.5 + arcSpread * progress;

      ctx.strokeStyle = `rgba(31, 224, 68, ${1.0 - progress})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(px, py, radius, startAngle - 0.4, startAngle + 0.4);
      ctx.stroke();
      ctx.restore();
    }
  };

  global.SpriteFactory = SpriteFactory;
})(typeof window !== 'undefined' ? window : this);
