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
      const cx = x + w / 2;
      const cy = y + h / 2;

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1.0, alpha));

      // Doorway Threshold / Archway Base
      ctx.fillStyle = '#06130a';
      ctx.fillRect(x, y, w, h);

      // Yellow/Black Hazard Border on Archway Frame
      ctx.strokeStyle = '#ffaa00';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

      const openProg = (door.openProgress !== undefined) ? door.openProgress : (door.isOpen ? 1.0 : 0.0);

      // Check if preloaded texture is available
      const doorTexKey = (door && (door.isExit || door.isEmergencyExit)) ? 'door_exit' : 'door_blast';
      const tex = (typeof TextureManager !== 'undefined' && TextureManager.textures) ? (TextureManager.textures[doorTexKey] || TextureManager.textures['door_blast']) : null;

      if (openProg >= 0.95) {
        // FULLY OPEN DOOR: Sliding blast plates recessed into wall pockets
        ctx.fillStyle = 'rgba(0, 40, 18, 0.45)';
        ctx.fillRect(x + 2, y + 2, w - 4, h - 4);

        // Flashing green LED pathway guides
        const greenPulse = 0.6 + Math.sin(tick * 0.15) * 0.4;
        ctx.fillStyle = `rgba(0, 255, 170, ${greenPulse})`;
        ctx.shadowColor = '#00ffaa';
        ctx.shadowBlur = 8;
        ctx.fillRect(x + 2, cy - 3, 4, 6);
        ctx.fillRect(x + w - 6, cy - 3, 4, 6);
        ctx.shadowBlur = 0;

        // Recessed metal door edges
        ctx.fillStyle = '#445548';
        ctx.fillRect(x, y + 1, 3, h - 2);
        ctx.fillRect(x + w - 3, y + 1, 3, h - 2);
      } else {
        // CLOSED OR SLIDING BLAST DOOR
        if (tex && tex.isLoaded && tex.isLoaded()) {
          // If door is sliding, split into two sliding halves
          if (openProg > 0) {
            const slideOffset = (w * 0.45) * openProg;
            // Left half
            ctx.drawImage(tex.img, 0, 0, tex.img.width / 2, tex.img.height, x - slideOffset, y, w / 2, h);
            // Right half
            ctx.drawImage(tex.img, tex.img.width / 2, 0, tex.img.width / 2, tex.img.height, cx + slideOffset, y, w / 2, h);
          } else {
            ctx.drawImage(tex.img, x, y, w, h);
          }
        } else {
          // Procedural high-detail hermetic door
          ctx.fillStyle = '#1e1c18';
          ctx.fillRect(x + 1, y + 1, w - 2, h - 2);

          // Diagonal hazard warning stripes along top & bottom
          ctx.fillStyle = '#ffaa00';
          for (let d = 2; d < w - 4; d += 8) {
            ctx.fillRect(x + d, y + 2, 4, 3);
            ctx.fillRect(x + d, y + h - 5, 4, 3);
          }

          // Central locking pressure wheel
          ctx.strokeStyle = '#ffcc00';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, 8, 0, Math.PI * 2);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy);
          ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy + 8);
          ctx.stroke();

          // Lock Status LED: Red = locked, Amber = unlockable
          ctx.fillStyle = door.requiresKeycard ? '#ff3b30' : '#ff9900';
          ctx.shadowColor = ctx.fillStyle;
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(cx, cy, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }

        // Stencil "ШЛЮЗ" or "ВЫХОД"
        if (openProg < 0.3) {
          ctx.fillStyle = 'rgba(255, 200, 0, 0.75)';
          ctx.font = 'bold 7px "Share Tech Mono", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(door.requiresKeycard ? '🔒 КАРТА' : 'ШЛЮЗ', cx, y + 5);
        }
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
      const cx = x + w / 2;
      const cy = y + h / 2;

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1.0, alpha));

      // Draw high-resolution procedural / PNG exit elevator platform
      let elevImg = (typeof TextureManager !== 'undefined' && TextureManager.get) ? (TextureManager.get('exit_elevator') || TextureManager.get('elevator_pad')) : null;
      if (!elevImg && typeof AssetGenerator !== 'undefined') {
        elevImg = AssetGenerator.get('exit_elevator');
      }

      if (elevImg) {
        ctx.drawImage(elevImg, x, y, w, h);
      } else {
        ctx.fillStyle = '#071813';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
      }

      // Upward volumetric light cone from elevator platform
      const conePulse = 0.4 + Math.sin(tick * 0.1) * 0.35;
      const coneGrad = ctx.createRadialGradient(cx, cy, 4, cx, cy, 46);
      coneGrad.addColorStop(0, `rgba(0, 255, 136, ${(0.35 * conePulse).toFixed(2)})`);
      coneGrad.addColorStop(0.65, `rgba(0, 255, 136, ${(0.12 * conePulse).toFixed(2)})`);
      coneGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = coneGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, 46, 0, Math.PI * 2);
      ctx.fill();

      // Pulsing cyan & neon green energy field
      const pulse = 0.5 + Math.sin(tick * 0.12) * 0.5;
      const hoverY = Math.sin(tick * 0.08) * 3;

      ctx.strokeStyle = `rgba(0, 255, 170, ${0.4 + pulse * 0.6})`;
      ctx.lineWidth = 3;
      ctx.shadowColor = '#00ffaa';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(cx, cy + hoverY, 22 + pulse * 4, 0, Math.PI * 2);
      ctx.stroke();

      // Floating, Glowing Neon "S" Glyph (Samosbor Extraction / Descent)
      ctx.fillStyle = '#00ffaa';
      ctx.font = 'bold 28px "Share Tech Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('S', cx, cy + hoverY);

      // Stencil label underneath
      ctx.shadowBlur = 6;
      ctx.font = 'bold 8px "Share Tech Mono", monospace';
      ctx.fillStyle = '#7affb8';
      ctx.fillText('ЭВАКУАЦИЯ', cx, cy + hoverY + 18);
      ctx.shadowBlur = 0;

      ctx.restore();
    },

    /**
     * Render Loot Supply Crate
     */
    
    /**
     * Render Hazardous Explosive Chemical Barrel (Yellow/Rust Industrial Trefoil)
     */
    drawExplosiveBarrel(ctx, barrel, TS, tick = 0, alpha = 1.0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1.0, alpha));

      const bx = barrel.x;
      const by = barrel.y;
      const r = barrel.radius || 13;

      // Base cylinder shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.arc(bx, by + 2, r + 1, 0, Math.PI * 2);
      ctx.fill();

      // Industrial Rusted Yellow Barrel Body
      ctx.fillStyle = '#b8860b'; // Dark goldenrod / rust yellow
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();

      // Top steel chime ring
      ctx.strokeStyle = '#2b2210';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Inner lid
      ctx.fillStyle = '#3a2d14';
      ctx.beginPath();
      ctx.arc(bx, by, r * 0.65, 0, Math.PI * 2);
      ctx.fill();

      // Biohazard / Radiation Trefoil Icon (Red/Black warning symbol)
      const pulse = 0.8 + Math.sin(tick * 0.1) * 0.2;
      ctx.fillStyle = `rgba(220, 20, 20, ${pulse.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(bx, by, r * 0.35, 0, Math.PI * 2);
      ctx.fill();

      // Danger Warning Hash Pattern
      ctx.strokeStyle = '#ff3300';
      ctx.lineWidth = 1.5;
      for (let a = 0; a < 3; a++) {
        const ang = (a * (Math.PI * 2 / 3)) + tick * 0.02;
        ctx.beginPath();
        ctx.moveTo(bx + Math.cos(ang) * (r * 0.25), by + Math.sin(ang) * (r * 0.25));
        ctx.lineTo(bx + Math.cos(ang) * (r * 0.8), by + Math.sin(ang) * (r * 0.8));
        ctx.stroke();
      }

      ctx.restore();
    },

    
    /**
     * Render Airlock Defense Barricade
     */
    
    /**
     * Render Soviet Cassette Tape Recorder «Весна-306» (PROP_RECORDER)
     */
    drawTapeRecorder(ctx, rec, TS, tick = 0, alpha = 1.0) {
      if (!ctx || !rec) return;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1.0, alpha));

      const rx = rec.x;
      const ry = rec.y;
      const w = 26;
      const h = 20;

      // Use retro pixel-art tape recorder sprite
      let recImg = (typeof TextureManager !== 'undefined' && TextureManager.getSprite) ? TextureManager.getSprite('item_recorder') : null;
      if (!recImg && typeof AssetGenerator !== 'undefined') recImg = AssetGenerator.get('item_recorder');

      if (recImg) {
        ctx.drawImage(recImg, rx - w / 2, ry - h / 2, w, h);
      } else {
        ctx.fillStyle = '#222624';
        ctx.fillRect(rx - w / 2, ry - h / 2, w, h);
        ctx.strokeStyle = '#48544e';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(rx - w / 2, ry - h / 2, w, h);
      }

      // Aluminum faceplate
      ctx.fillStyle = '#6b7570';
      ctx.fillRect(rx - w / 2 + 3, ry - h / 2 + 3, w - 6, h - 10);

      // Cassette transparent window
      ctx.fillStyle = '#111413';
      ctx.fillRect(rx - w / 2 + 5, ry - h / 2 + 5, w - 10, 6);

      // Tape spools (spinning if playing/listened)
      const spoolAng = rec.isPlaying ? (tick * 0.15) : 0;
      ctx.fillStyle = '#f0f0f0';
      ctx.beginPath();
      ctx.arc(rx - 4, ry - h / 2 + 8, 2, 0, Math.PI * 2);
      ctx.arc(rx + 4, ry - h / 2 + 8, 2, 0, Math.PI * 2);
      ctx.fill();

      // Speaker grille on bottom
      ctx.fillStyle = '#151a18';
      for (let g = -7; g <= 7; g += 3) {
        ctx.fillRect(rx + g, ry + 2, 1.5, 4);
      }

      // Blinking red [REC] LED indicator
      const blink = rec.listened ? false : ((Math.floor(tick / 16) % 2) === 0);
      ctx.fillStyle = blink ? '#ff2222' : (rec.listened ? '#00e676' : '#551111');
      ctx.beginPath();
      ctx.arc(rx + w / 2 - 4, ry - h / 2 + 4, 1.5, 0, Math.PI * 2);
      ctx.fill();

      // Stencil brand name
      ctx.fillStyle = '#9aa8a1';
      ctx.font = 'bold 5px "Share Tech Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText('ВЕСНА', rx - w / 2 + 4, ry - h / 2 + 12);

      // Hover prompt if player in range
      if (rec.inRange && !rec.isPlaying) {
        const pulse = 0.8 + 0.2 * Math.sin(tick * 0.15);
        ctx.fillStyle = `rgba(0, 255, 170, ${pulse})`;
        ctx.font = 'bold 8px "Share Tech Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('[ E ] ПРОСЛУШАТЬ ЗАПИСЬ', rx, ry - 14);
      }

      ctx.restore();
    },

    /**
     * Render Official Wall Dispatch Note (WALL_DECAL_NOTE)
     */
    drawWallNote(ctx, note, TS, tick = 0, alpha = 1.0) {
      if (!ctx || !note) return;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1.0, alpha));

      const nx = note.x;
      const ny = note.y;
      const w = 18;
      const h = 24;

      // Drop shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(nx - w / 2 + 1, ny - h / 2 + 2, w, h);

      // Yellowed aged Soviet paper sheet (A4 ratio)
      ctx.fillStyle = '#ded1b4';
      ctx.fillRect(nx - w / 2, ny - h / 2, w, h);
      ctx.strokeStyle = '#85785a';
      ctx.lineWidth = 1;
      ctx.strokeRect(nx - w / 2, ny - h / 2, w, h);

      // Rebar stud / rusted nail pinning top center
      ctx.fillStyle = '#594a38';
      ctx.beginPath();
      ctx.arc(nx, ny - h / 2 + 2.5, 1.5, 0, Math.PI * 2);
      ctx.fill();

      // Faint lines of typed text
      ctx.fillStyle = '#4a4435';
      for (let l = ny - h / 2 + 6; l < ny + h / 2 - 4; l += 3) {
        ctx.fillRect(nx - w / 2 + 2, l, w - 4, 1);
      }

      // Red Soviet round seal/stamp
      ctx.strokeStyle = 'rgba(180, 20, 20, 0.65)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(nx + w / 2 - 5, ny + h / 2 - 5, 3, 0, Math.PI * 2);
      ctx.stroke();

      // Hover prompt
      if (note.inRange) {
        ctx.fillStyle = '#ffd700';
        ctx.font = 'bold 8px "Share Tech Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('[ E ] ЧИТАТЬ ЗАПИСКУ', nx, ny - 16);
      }

      ctx.restore();
    },

    /**
     * Render Severed High-Voltage Electric Wire Trap (TRAP_ELECTRIC_WIRE)
     */
    drawElectricWireTrap(ctx, trap, TS, tick = 0, alpha = 1.0) {
      if (!ctx || !trap) return;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1.0, alpha));

      const tx = trap.x;
      const ty = trap.y;
      const isDisabled = trap.disabled;
      const isArcing = !isDisabled && trap.isArcing;

      // Hanging dangling cables swaying slightly
      const sway = Math.sin(tick * 0.05 + tx) * 3;
      ctx.strokeStyle = isDisabled ? '#222' : '#1c2420';
      ctx.lineWidth = 2.5;

      ctx.beginPath();
      ctx.moveTo(tx - 10, ty - 16);
      ctx.quadraticCurveTo(tx - 6 + sway, ty, tx - 8 + sway, ty + 10);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(tx + 10, ty - 16);
      ctx.quadraticCurveTo(tx + 6 - sway, ty, tx + 8 - sway, ty + 12);
      ctx.stroke();

      // Exposed copper strands
      ctx.fillStyle = isDisabled ? '#332211' : '#b87333';
      ctx.fillRect(tx - 9 + sway, ty + 10, 2, 4);
      ctx.fillRect(tx + 7 - sway, ty + 12, 2, 4);

      // Electrical Arc Burst
      if (isArcing) {
        const glow = 0.8 + Math.random() * 0.2;
        ctx.strokeStyle = `rgba(0, 240, 255, ${glow})`;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 16;

        // Jagged electric lightning arc between cable ends
        ctx.beginPath();
        let curX = tx - 8 + sway;
        let curY = ty + 12;
        ctx.moveTo(curX, curY);
        for (let s = 0; s < 4; s++) {
          curX += (tx + 8 - sway - curX) * 0.3 + (Math.random() - 0.5) * 8;
          curY += (Math.random() - 0.5) * 6;
          ctx.lineTo(curX, curY);
        }
        ctx.lineTo(tx + 8 - sway, ty + 14);
        ctx.stroke();

        // Blue flare glow center
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc((tx - 8 + sway + tx + 8 - sway) / 2, ty + 12, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      ctx.restore();
    },

    /**
     * Render Electrical Breaker Box / Fuse Panel
     */
    drawBreakerBox(ctx, box, TS, tick = 0, alpha = 1.0) {
      if (!ctx || !box) return;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1.0, alpha));

      const bx = box.x;
      const by = box.y;
      const w = 18;
      const h = 22;
      const isDisabled = box.disabled;

      // Industrial metal box
      ctx.fillStyle = isDisabled ? '#222824' : '#33443a';
      ctx.fillRect(bx - w / 2, by - h / 2, w, h);
      ctx.strokeStyle = isDisabled ? '#444' : '#6a8c78';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx - w / 2, by - h / 2, w, h);

      // Warning hazard triangle
      ctx.fillStyle = isDisabled ? '#554422' : '#ffcc00';
      ctx.beginPath();
      ctx.moveTo(bx, by - h / 2 + 3);
      ctx.lineTo(bx - 4, by - h / 2 + 9);
      ctx.lineTo(bx + 4, by - h / 2 + 9);
      ctx.closePath();
      ctx.fill();

      // Knife switch / Breaker Lever
      ctx.strokeStyle = isDisabled ? '#555' : '#ff3b30';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      if (isDisabled) {
        ctx.moveTo(bx, by + 1); ctx.lineTo(bx + 4, by + 7); // down position
      } else {
        ctx.moveTo(bx, by + 1); ctx.lineTo(bx - 4, by - 5); // up position
      }
      ctx.stroke();

      // Indicator LED
      ctx.fillStyle = isDisabled ? '#00e676' : ((Math.floor(tick / 12) % 2 === 0) ? '#ffaa00' : '#ff3300');
      ctx.beginPath();
      ctx.arc(bx + w / 2 - 3, by + h / 2 - 3, 1.5, 0, Math.PI * 2);
      ctx.fill();

      // Prompt
      if (box.inRange && !isDisabled) {
        ctx.fillStyle = '#ffaa00';
        ctx.font = 'bold 8px "Share Tech Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('[ ВЫСТРЕЛ / УДАР ] ОБЕСТОЧИТЬ', bx, by - 14);
      }

      ctx.restore();
    },

    /**
     * Render Biomechanical Flesh Vent Trap (TRAP_FLESH_VENT)
     */
    drawFleshVentTrap(ctx, trap, TS, tick = 0, alpha = 1.0) {
      if (!ctx || !trap) return;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1.0, alpha));

      const vx = trap.x;
      const vy = trap.y;
      const w = 28;
      const h = 28;
      const isDormant = trap.dormantTimer > 0;
      const isEntangled = trap.entangled;

      // Dark drain hole underneath
      ctx.fillStyle = '#060706';
      ctx.fillRect(vx - w / 2, vy - h / 2, w, h);

      // Pulsating organic corruption / dark slime in drain
      if (!isDormant) {
        const slimePulse = 0.6 + 0.4 * Math.sin(tick * 0.1 + vx);
        ctx.fillStyle = `rgba(60, 10, 50, ${slimePulse})`;
        ctx.beginPath();
        ctx.arc(vx, vy, 11, 0, Math.PI * 2);
        ctx.fill();
      }

      // Iron drain grate bars
      ctx.strokeStyle = '#3d3830';
      ctx.lineWidth = 2;
      ctx.strokeRect(vx - w / 2, vy - h / 2, w, h);

      for (let g = vx - w / 2 + 5; g < vx + w / 2; g += 6) {
        ctx.beginPath();
        ctx.moveTo(g, vy - h / 2 + 2);
        ctx.lineTo(g, vy + h / 2 - 2);
        ctx.stroke();
      }

      // Writhing tentacles reaching out if entangled or idling
      if (isEntangled || (!isDormant && trap.inRange)) {
        ctx.strokeStyle = '#771166';
        ctx.lineWidth = 3;
        for (let t = 0; t < 4; t++) {
          const ang = t * (Math.PI / 2) + Math.sin(tick * 0.15 + t) * 0.4;
          const reach = isEntangled ? 18 : 8;
          ctx.beginPath();
          ctx.moveTo(vx, vy);
          ctx.quadraticCurveTo(
            vx + Math.cos(ang + 0.3) * (reach * 0.6),
            vy + Math.sin(ang + 0.3) * (reach * 0.6),
            vx + Math.cos(ang) * reach,
            vy + Math.sin(ang) * reach
          );
          ctx.stroke();
        }
      }

      // Dormant indicator
      if (isDormant) {
        ctx.fillStyle = '#555';
        ctx.font = 'bold 7px "Share Tech Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('СПИТ', vx, vy + 3);
      }

      ctx.restore();
    },

    drawBarricade(ctx, barricade, TS, tick = 0, alpha = 1.0) {
      if (!ctx || !barricade) return;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1.0, alpha));

      const bx = barricade.x;
      const by = barricade.y;
      const w = barricade.w || TS;
      const h = barricade.h || TS;
      const hp = barricade.hp !== undefined ? barricade.hp : 300;
      const maxHp = barricade.maxHp || 300;
      const isConstructed = barricade.isConstructed;

      if (!isConstructed) {
        // Holographic Blueprint / Scrap Pile waiting to be constructed
        const pulse = 0.4 + 0.3 * Math.sin(tick * 0.15);
        ctx.strokeStyle = `rgba(255, 170, 0, ${pulse})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(bx, by, w, h);
        ctx.setLineDash([]);

        // Debris / Scaffolding silhouette
        ctx.fillStyle = 'rgba(100, 70, 20, 0.3)';
        ctx.fillRect(bx + 2, by + 2, w - 4, h - 4);

        // Construction progress ring / bar
        if (barricade.buildProgress > 0) {
          const prog = Math.min(1.0, barricade.buildProgress);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          ctx.fillRect(bx, by - 12, w, 8);
          ctx.fillStyle = '#ffaa00';
          ctx.fillRect(bx + 1, by - 11, (w - 2) * prog, 6);
          ctx.strokeStyle = '#ffd700';
          ctx.lineWidth = 1;
          ctx.strokeRect(bx, by - 12, w, 8);
        }

        // Action prompt
        ctx.fillStyle = '#ffaa00';
        ctx.font = 'bold 9px "Share Tech Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('[ E ] ЗАБАРРИКАДИРОВАТЬ', bx + w / 2, by + h / 2 + 3);
      } else if (hp <= 0) {
        // Destroyed / Breached Barricade
        ctx.fillStyle = '#221a12';
        ctx.fillRect(bx, by, w, h);
        ctx.strokeStyle = '#553311';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(bx + 4, by + 4); ctx.lineTo(bx + w - 4, by + h - 4);
        ctx.moveTo(bx + w - 4, by + 4); ctx.lineTo(bx + 4, by + h - 4);
        ctx.stroke();

        ctx.fillStyle = '#ff3333';
        ctx.font = 'bold 9px "Share Tech Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('ПРОБИТО!', bx + w / 2, by + h / 2 + 3);
      } else {
        // Reinforced Steel Plates & Heavy Timber Beams
        ctx.fillStyle = '#2d2822';
        ctx.fillRect(bx, by, w, h);

        // Bolted metal frame
        ctx.strokeStyle = '#4a3f32';
        ctx.lineWidth = 2;
        ctx.strokeRect(bx + 1, by + 1, w - 2, h - 2);

        // Diagonal bracing cross-beam
        ctx.fillStyle = '#1c1712';
        ctx.beginPath();
        ctx.moveTo(bx + 3, by + 3);
        ctx.lineTo(bx + 8, by + 3);
        ctx.lineTo(bx + w - 3, by + h - 3);
        ctx.lineTo(bx + w - 8, by + h - 3);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(bx + w - 3, by + 3);
        ctx.lineTo(bx + w - 8, by + 3);
        ctx.lineTo(bx + 3, by + h - 3);
        ctx.lineTo(bx + 8, by + h - 3);
        ctx.closePath();
        ctx.fill();

        // Yellow-Black Hazard caution striping
        ctx.strokeStyle = '#e6a100';
        ctx.lineWidth = 2;
        for (let s = bx + 4; s < bx + w - 4; s += 8) {
          ctx.beginPath();
          ctx.moveTo(s, by + h / 2 - 3);
          ctx.lineTo(s + 4, by + h / 2 + 3);
          ctx.stroke();
        }

        // Metal rivets in corners
        ctx.fillStyle = '#8a7d6b';
        ctx.fillRect(bx + 3, by + 3, 2, 2);
        ctx.fillRect(bx + w - 5, by + 3, 2, 2);
        ctx.fillRect(bx + 3, by + h - 5, 2, 2);
        ctx.fillRect(bx + w - 5, by + h - 5, 2, 2);

        // HP Bar overhead
        const pct = Math.max(0, hp / maxHp);
        const barW = Math.max(w, 40);
        const barX = bx + (w - barW) / 2;
        const barY = by - 12;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillRect(barX, barY, barW, 7);

        const hpColor = pct > 0.5 ? '#00e676' : pct > 0.25 ? '#ffaa00' : '#ff3333';
        ctx.fillStyle = hpColor;
        ctx.fillRect(barX + 1, barY + 1, (barW - 2) * pct, 5);

        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, barY, barW, 7);

        // Stencil text
        ctx.font = 'bold 8px "Share Tech Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.fillText(`${hp}/${maxHp}`, bx + w / 2, barY - 2);

        // If damaged and player can repair
        if (hp < maxHp && barricade.canRepair) {
          ctx.fillStyle = '#00ffaa';
          ctx.font = 'bold 8px "Share Tech Mono", monospace';
          ctx.fillText('[ E ] ЧИНИТЬ (+75 HP)', bx + w / 2, by + h + 11);
        }
      }

      ctx.restore();
    },

    /**
     * Render Emergency Hydraulic Elevator Terminal
     */
    drawElevatorTerminal(ctx, terminal, TS, tick = 0, siegeTimer = 300, alpha = 1.0) {
      if (!ctx || !terminal) return;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1.0, alpha));

      const tx = terminal.x;
      const ty = terminal.y;
      const hp = terminal.hp !== undefined ? terminal.hp : 500;
      const maxHp = terminal.maxHp || 500;

      // Heavy industrial pedestal
      ctx.fillStyle = '#1a1f1d';
      ctx.fillRect(tx - 16, ty - 14, 32, 28);
      ctx.strokeStyle = '#384d43';
      ctx.lineWidth = 2;
      ctx.strokeRect(tx - 16, ty - 14, 32, 28);

      // CRT screen casing
      ctx.fillStyle = '#080d0b';
      ctx.fillRect(tx - 12, ty - 10, 24, 20);

      // Blinking Emergency Screen (Red / Amber glitch)
      const flash = (Math.floor(tick / 18) % 2 === 0);
      ctx.fillStyle = flash ? '#991111' : '#330808';
      ctx.fillRect(tx - 10, ty - 8, 20, 16);

      // Glitch raster line
      ctx.fillStyle = 'rgba(255, 200, 200, 0.3)';
      const scanY = ty - 8 + (tick % 16);
      ctx.fillRect(tx - 10, scanY, 20, 2);

      // Error 77-B stencil on CRT
      ctx.fillStyle = flash ? '#ffffff' : '#ff4444';
      ctx.font = 'bold 7px "Share Tech Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('77-Б', tx, ty + 2);

      // Cable bundle running down
      ctx.strokeStyle = '#ff9900';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(tx - 6, ty + 14);
      ctx.lineTo(tx - 6, ty + 22);
      ctx.moveTo(tx + 6, ty + 14);
      ctx.lineTo(tx + 6, ty + 22);
      ctx.stroke();

      // Overhead Hydraulic Restart Gauge & Terminal HP
      const barW = 86;
      const barX = tx - barW / 2;
      const barY = ty - 26;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.fillRect(barX - 2, barY - 14, barW + 4, 26);
      ctx.strokeStyle = '#ff3333';
      ctx.lineWidth = 1;
      ctx.strokeRect(barX - 2, barY - 14, barW + 4, 26);

      // Time formatting
      const mins = Math.floor(Math.max(0, siegeTimer) / 60);
      const secs = Math.floor(Math.max(0, siegeTimer) % 60);
      const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

      ctx.fillStyle = '#ffaa00';
      ctx.font = 'bold 9px "Share Tech Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`ОТКАТ ГИДРАВЛИКИ: ${timeStr}`, tx, barY - 3);

      // Terminal HP Bar
      const pct = Math.max(0, hp / maxHp);
      ctx.fillStyle = '#220000';
      ctx.fillRect(barX, barY + 1, barW, 7);
      ctx.fillStyle = pct > 0.4 ? '#ff3333' : '#ff1100';
      ctx.fillRect(barX, barY + 1, barW * pct, 7);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 7px "Share Tech Mono", monospace';
      ctx.fillText(`ПУЛЬТ: ${hp} / ${maxHp} HP`, tx, barY + 7);

      ctx.restore();
    },

    /**
     * Render Heavy Rusted VOKhR Supply Crate
     */
    drawVokhrCrate(ctx, crate, TS, tick = 0, alpha = 1.0) {
      if (!ctx || !crate) return;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1.0, alpha));

      const cx = crate.x;
      const cy = crate.y;
      const w = crate.w || 32;
      const h = crate.h || 24;
      const isOpened = crate.opened;

      if (isOpened) {
        // Open empty crate
        ctx.fillStyle = '#1c1a14';
        ctx.fillRect(cx, cy, w, h);
        ctx.strokeStyle = '#383023';
        ctx.lineWidth = 2;
        ctx.strokeRect(cx, cy, w, h);

        ctx.fillStyle = '#2e261a';
        ctx.fillRect(cx - 2, cy - 6, w + 4, 6); // open hinged lid
      } else {
        // Sturdy Soviet Military Metal Chest (Olive / Khaki)
        ctx.fillStyle = '#3a442e'; // Dark Soviet Khaki
        ctx.fillRect(cx, cy, w, h);

        // Reinforced rusted steel trim & iron corner brackets
        ctx.strokeStyle = '#5a6b47';
        ctx.lineWidth = 2;
        ctx.strokeRect(cx + 1, cy + 1, w - 2, h - 2);

        // Center latch & padlock
        ctx.fillStyle = '#d4af37';
        ctx.fillRect(cx + w / 2 - 2, cy + h / 2 - 3, 4, 6);

        // Soviet Red Star stencil on lid
        ctx.fillStyle = '#cc2222';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('★', cx + w / 2, cy + h / 2 - 2);

        // Stencil ID underneath
        ctx.fillStyle = '#c5d1b4';
        ctx.font = 'bold 6px "Share Tech Mono", monospace';
        ctx.fillText('ВОХР-7', cx + w / 2, cy + h - 3);

        // Action prompt if player in range
        if (crate.inRange) {
          ctx.fillStyle = '#ffd700';
          ctx.font = 'bold 9px "Share Tech Mono", monospace';
          ctx.fillText('[ E ] ВСКРЫТЬ ЯЩИК ВОХР', cx + w / 2, cy - 6);
        }
      }

      ctx.restore();
    },

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

    /**
     * Render Authentic Soviet Environmental Props & Clutter
     * (Office Desk, Soviet Chair, Industrial Fridge ZIL, Wooden Crate, Floor Fan, Bunk)
     */
    drawProp(ctx, prop, TS, tick, alpha = 1.0) {
      if (!ctx || !prop) return;
      const x = prop.x;
      const y = prop.y;
      const type = prop.type || 'office_desk';

      ctx.save();
      ctx.globalAlpha = Math.max(0.2, Math.min(1.0, alpha));

      // Soft ground contact shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.ellipse(x, y + 2, (prop.radius || 12) * 1.1, (prop.radius || 12) * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();

      if (type === 'office_desk' || type === 'desk') {
        // 1. Shabby Retro Office Desk with Papers & Terminal/Lamp
        ctx.fillStyle = '#2a221b';
        ctx.fillRect(x - 14, y - 10, 28, 20);
        ctx.strokeStyle = '#3e342b';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 14, y - 10, 28, 20);

        ctx.fillStyle = '#dcd3be';
        ctx.fillRect(x - 10, y - 7, 8, 6);
        ctx.fillStyle = '#9b3024';
        ctx.fillRect(x + 2, y - 6, 7, 9);
        ctx.fillStyle = '#ece4d0';
        ctx.fillRect(x - 4, y + 1, 8, 5);

        ctx.fillStyle = '#111813';
        ctx.fillRect(x - 11, y + 1, 5, 5);
        ctx.fillStyle = '#1fe044';
        ctx.fillRect(x - 10, y + 2, 3, 3);
      } else if (type === 'chair') {
        // 2. Soviet Metal-frame Chair with Leatherette Seat
        ctx.fillStyle = '#4a2414';
        ctx.beginPath();
        ctx.arc(x, y, 7.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#2b150a';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.strokeStyle = '#737f77';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y - 3, 8, Math.PI * 0.8, Math.PI * 2.2);
        ctx.stroke();

        ctx.fillStyle = '#556059';
        ctx.fillRect(x - 7, y - 7, 2.5, 2.5);
        ctx.fillRect(x + 5, y - 7, 2.5, 2.5);
        ctx.fillRect(x - 7, y + 5, 2.5, 2.5);
        ctx.fillRect(x + 5, y + 5, 2.5, 2.5);
      } else if (type === 'fridge') {
        // 3. Heavy Industrial Soviet Refrigerator "ЗИЛ" / Freezer
        ctx.fillStyle = '#3a4740';
        ctx.fillRect(x - 12, y - 13, 24, 26);
        ctx.strokeStyle = '#1e2622';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 12, y - 13, 24, 26);

        ctx.strokeStyle = '#25302a';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - 11, y - 3);
        ctx.lineTo(x + 11, y - 3);
        ctx.stroke();

        ctx.fillStyle = '#a8b5ae';
        ctx.fillRect(x + 7, y - 1, 3, 7);

        ctx.fillStyle = 'rgba(140, 60, 20, 0.7)';
        ctx.fillRect(x - 9, y + 6, 4, 3);
        ctx.fillRect(x + 2, y - 10, 5, 2);
      } else if (type === 'crate') {
        // 4. Wooden / Metal Military Supply Crate
        ctx.fillStyle = '#4a3b2c';
        ctx.fillRect(x - 11, y - 11, 22, 22);
        ctx.strokeStyle = '#282017';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 11, y - 11, 22, 22);

        ctx.strokeStyle = '#63513e';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 10, y - 10);
        ctx.lineTo(x + 10, y + 10);
        ctx.moveTo(x + 10, y - 10);
        ctx.lineTo(x - 10, y + 10);
        ctx.stroke();

        ctx.fillStyle = '#8a2018';
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('★', x, y);
      } else if (type === 'vent_fan') {
        // 5. Heavy Industrial Floor Fan / Blower
        ctx.fillStyle = '#1c2420';
        ctx.fillRect(x - 6, y - 6, 12, 12);

        ctx.strokeStyle = '#4e6156';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.stroke();

        const fanAng = (tick * 0.22) % (Math.PI * 2);
        ctx.strokeStyle = '#8fa397';
        ctx.lineWidth = 2.5;
        for (let b = 0; b < 3; b++) {
          const bAng = fanAng + (b * Math.PI * 2 / 3);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(bAng) * 8.5, y + Math.sin(bAng) * 8.5);
          ctx.stroke();
        }

        ctx.fillStyle = '#1fe044';
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      } else if (type === 'bunk') {
        // 6. Two-Tier Soviet Metal Bunk Bed
        ctx.fillStyle = '#1e2420';
        ctx.fillRect(x - 14, y - 10, 28, 20);
        ctx.fillStyle = '#2d3b31';
        ctx.fillRect(x - 12, y - 8, 24, 16);
        ctx.fillStyle = '#c5d1c8';
        ctx.fillRect(x - 11, y - 7, 7, 14);
        ctx.fillStyle = '#4c5c50';
        ctx.fillRect(x - 14, y - 10, 3, 20);
        ctx.fillRect(x + 11, y - 10, 3, 20);
      } else {
        ctx.fillStyle = '#2b362f';
        ctx.fillRect(x - 9, y - 9, 18, 18);
        ctx.strokeStyle = '#415247';
        ctx.strokeRect(x - 9, y - 9, 18, 18);
      }

      ctx.restore();
    },
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

      let dropSprite = null;
      if (typeof TextureManager !== 'undefined' && TextureManager.getSprite) {
        if (isKeycard) dropSprite = TextureManager.getSprite(drop.keycardType || 'keycard_red');
        else if (isMed) dropSprite = TextureManager.getSprite('item_medkit_military');
        else if (isAmmo) dropSprite = TextureManager.getSprite(isShotgun ? 'item_ammo_shotgun' : 'item_ammo_pistol');
      }
      if (!dropSprite && typeof AssetGenerator !== 'undefined') {
        if (isKeycard) dropSprite = AssetGenerator.get(drop.keycardType || 'keycard_red');
        else if (isMed) dropSprite = AssetGenerator.get('item_medkit_military');
        else if (isAmmo) dropSprite = AssetGenerator.get(isShotgun ? 'item_ammo_shotgun' : 'item_ammo_pistol');
      }

      if (dropSprite) {
        ctx.drawImage(dropSprite, itemX, itemY, itemW, itemH);
      } else if (isKeycard) {
        ctx.fillStyle = '#0a2e38';
        ctx.fillRect(itemX, itemY + 2, itemW, 14);
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(itemX, itemY + 2, itemW, 14);
      } else if (isMed) {
        ctx.fillStyle = '#e8ece9';
        ctx.fillRect(itemX, itemY + 2, itemW, 14);
        ctx.strokeStyle = '#2d4734';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(itemX, itemY + 2, itemW, 14);
      } else if (isAmmo) {
        ctx.fillStyle = '#2d4427';
        ctx.fillRect(itemX, itemY + 3, itemW, 12);
        ctx.strokeStyle = '#47683d';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(itemX, itemY + 3, itemW, 12);
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
