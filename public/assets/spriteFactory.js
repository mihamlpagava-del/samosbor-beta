/**
 * ============================================================================
 * MODULE: spriteFactory.js (Top-Down Radar Roguelike Sprite & Lighting Factory)
 * ============================================================================
 * High-performance 2D canvas renderer supporting:
 * - Real sliced sprite rendering for 4 Hero weapon classes & 33 Monster archetypes
 * - Procedural Volumetric Flashlight cone with floating phosphor dust motes (Image 1 reference)
 * - Wall-mounted warm amber lanterns ("Фонари") with dynamic radial glow & flicker
 * - Sliced environment tiles (Hazard walls, metal floors, grates, vents, blast doors)
 * - Helipad extraction platform with circular 'H' symbol & animated green chevron ring
 * - Sliced supply crates (ammo, medical, tech, rations) & dropped firearms
 * - Overhead CRT health bars, tactical crosshair, melee swing arcs, and CRT decay
 */

(function (global) {
  'use strict';

  const SpriteFactory = {
    images: {},
    manifest: null,

    /**
     * Lazy-load or retrieve an image asset
     */
    getImage(path) {
      if (!path) return null;
      if (!this.images[path]) {
        const img = new Image();
        img.src = path;
        this.images[path] = img;
      }
      return this.images[path];
    },

    /**
     * Check if an image is fully loaded and ready to draw
     */
    isImageReady(img) {
      return img && img.complete && img.naturalWidth > 0;
    },

    /**
     * Render Volumetric Flashlight Cone (from Image 1 mockup reference)
     * Projects a glowing green beam forward from player hands with floating dust motes
     */
    drawVolumetricFlashlight(ctx, player, tick) {
      if (!ctx || !player) return;

      const px = player.x;
      const py = player.y;
      const angle = player.angle || 0;
      const dist = 480;
      const spread = 0.65; // ~75 degrees cone
      const flicker = 0.96 + Math.sin(tick * 0.16) * 0.04;

      ctx.save();

      // 1. Warm/green ambient halo around player body (illuminates room)
      const haloGrad = ctx.createRadialGradient(px, py, 8, px, py, 150 * flicker);
      haloGrad.addColorStop(0, 'rgba(136, 255, 158, 0.45)');
      haloGrad.addColorStop(0.5, 'rgba(31, 224, 68, 0.22)');
      haloGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(px, py, 150 * flicker, 0, Math.PI * 2);
      ctx.fill();

      // 2. Volumetric Forward Light Cone
      const coneGrad = ctx.createRadialGradient(px, py, 16, px, py, dist * flicker);
      coneGrad.addColorStop(0, 'rgba(180, 255, 195, 0.55)');
      coneGrad.addColorStop(0.28, 'rgba(80, 240, 120, 0.32)');
      coneGrad.addColorStop(0.7, 'rgba(25, 180, 60, 0.16)');
      coneGrad.addColorStop(1, 'rgba(4, 20, 7, 0)');

      ctx.fillStyle = coneGrad;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.arc(px, py, dist * flicker, angle - spread, angle + spread);
      ctx.closePath();
      ctx.fill();

      // 3. Floating Phosphor Dust Motes inside the beam
      ctx.fillStyle = 'rgba(220, 255, 230, 0.65)';
      for (let i = 0; i < 16; i++) {
        const seed = (tick * 0.04 + i * 1.618) % 1.0;
        const pDist = 30 + seed * (dist * 0.9);
        const pAngle = angle + (Math.sin(tick * 0.05 + i * 2) * spread * 0.85);
        const mx = px + Math.cos(pAngle) * pDist;
        const my = py + Math.sin(pAngle) * pDist;
        const sz = 1.2 + (i % 2) * 1.0;
        ctx.fillRect(mx, my, sz, sz);
      }

      ctx.restore();
    },

    /**
     * Render Wall-mounted Lantern with Warm Amber Light ("Фонари")
     */
    drawWallLamp(ctx, lamp, TS, tick, alpha = 1.0) {
      if (!ctx || !lamp) return;

      const lx = lamp.x;
      const ly = lamp.y;
      const seed = lamp.seed || 0;
      const flicker = 0.88 + Math.sin(tick * 0.12 + seed) * 0.08 + (Math.sin(tick * 0.35 + seed * 2) * 0.04);
      const rad = (lamp.radius || 135) * flicker;

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1.0, alpha));

      // 1. Warm radial amber illumination on floor and wall
      const glowGrad = ctx.createRadialGradient(lx, ly, 6, lx, ly, rad);
      glowGrad.addColorStop(0, 'rgba(255, 205, 95, 0.60)');
      glowGrad.addColorStop(0.4, 'rgba(255, 145, 35, 0.30)');
      glowGrad.addColorStop(0.8, 'rgba(220, 90, 10, 0.10)');
      glowGrad.addColorStop(1, 'rgba(4, 20, 7, 0)');

      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(lx, ly, rad, 0, Math.PI * 2);
      ctx.fill();

      // 2. Wall lamp fixture sprite
      const lampImg = this.getImage('assets/radar/tiles/wall_lamp.png');
      if (this.isImageReady(lampImg)) {
        ctx.drawImage(lampImg, lx - 8, ly - 8, 16, 16);
      } else {
        // Fallback procedural lamp fixture
        ctx.fillStyle = '#ffaa33';
        ctx.beginPath();
        ctx.arc(lx, ly, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.restore();
    },

    /**
     * Render Floor Tile using sliced industrial textures
     */
    drawFloorTile(ctx, wx, wy, TS, alpha, seed = 0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1.0, alpha));

      // Deterministic pseudo-random Soviet bunker floor panel selection
      const tx = Math.floor(wx / TS);
      const ty = Math.floor(wy / TS);
      const hash = Math.abs(((tx * 73856093) ^ (ty * 19349663) ^ (seed * 83492791)) >>> 0);
      const tileIndex = hash % 16;
      const imgPath = `assets/radar/tiles/floor_panel_${tileIndex}.png`;
      const img = this.getImage(imgPath);

      if (this.isImageReady(img)) {
        ctx.drawImage(img, wx, wy, TS, TS);
      } else {
        // Fallback dark metal tile
        ctx.fillStyle = '#061609';
        ctx.fillRect(wx, wy, TS, TS);
        ctx.strokeStyle = '#0b3814';
        ctx.lineWidth = 1;
        ctx.strokeRect(wx + 0.5, wy + 0.5, TS - 1, TS - 1);
      }

      ctx.restore();
    },

    /**
     * Render Top-Down Heavy Bunker Wall Tile from the 8 sliced textures
     */
    drawWallTile(ctx, wx, wy, TS, alpha, seed = 0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1.0, alpha));

      const tx = Math.floor(wx / TS);
      const ty = Math.floor(wy / TS);
      const hash = Math.abs(((tx * 92837111) ^ (ty * 68928749) ^ (seed * 49287313)) >>> 0);
      const wallIdx = hash % 8;
      const imgPath = `assets/radar/tiles/wall_panel_${wallIdx}.png`;
      const img = this.getImage(imgPath);

      if (this.isImageReady(img)) {
        ctx.drawImage(img, wx, wy, TS, TS);
      } else {
        // Fallback dark bunker concrete block
        ctx.fillStyle = '#141e17';
        ctx.fillRect(wx, wy, TS, TS);
        ctx.strokeStyle = '#274b30';
        ctx.lineWidth = 1;
        ctx.strokeRect(wx + 0.5, wy + 0.5, TS - 1, TS - 1);
      }

      ctx.restore();
    },

    /**
     * Render Evacuation Helipad / Elevator Platform
     */
    drawElevatorShaft(ctx, elevator, TS, tick, alpha = 1.0) {
      if (!ctx || !elevator) return;

      const x = elevator.x;
      const y = elevator.y;
      const w = elevator.w || TS;
      const h = elevator.h || TS;

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1.0, alpha));

      const img = this.getImage('assets/radar/tiles/elevator_pad.png');
      if (this.isImageReady(img)) {
        // Center the 64x64 or 96x96 extraction pad over the elevator tile
        const padSize = 64;
        ctx.drawImage(img, x + w / 2 - padSize / 2, y + h / 2 - padSize / 2, padSize, padSize);
      } else {
        // Fallback platform
        ctx.fillStyle = '#061c0c';
        ctx.fillRect(x - 16, y - 16, w + 32, h + 32);
        ctx.strokeStyle = '#1fe044';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 16, y - 16, w + 32, h + 32);

        // Central 'H' mark
        ctx.fillStyle = '#1fe044';
        ctx.font = 'bold 22px "Share Tech Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('H', x + w / 2, y + h / 2);
      }

      // Animated green chevron border pulsing
      const pulse = 0.5 + Math.sin(tick * 0.12) * 0.5;
      ctx.strokeStyle = `rgba(31, 224, 68, ${0.4 + pulse * 0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, 28 + pulse * 4, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    },

    /**
     * Render Airtight Blast Door ("Гермодверь")
     */
    drawDoorTile(ctx, door, TS, tick, alpha = 1.0) {
      if (!ctx || !door) return;

      const x = door.x;
      const y = door.y;
      const w = door.w || TS;
      const h = door.h || TS;

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1.0, alpha));

      const img = this.getImage('assets/radar/tiles/door_blast.png');
      if (this.isImageReady(img)) {
        if (door.isOpen) {
          ctx.globalAlpha *= 0.35;
          ctx.drawImage(img, x, y, w, h);
        } else {
          ctx.drawImage(img, x, y, w, h);
        }
      } else {
        // Fallback procedural blast door
        ctx.fillStyle = door.isOpen ? 'rgba(11, 40, 18, 0.4)' : '#1a1005';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = door.isOpen ? '#1fe044' : '#ffaa00';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      }

      ctx.restore();
    },

    /**
     * Render Supply Crate
     */
    drawLootCrate(ctx, crate, TS, tick, alpha = 1.0) {
      if (!ctx || !crate || crate.opened) return;

      const x = crate.x;
      const y = crate.y;
      const type = crate.type || 'ammo';

      let imgName = 'crate_ammo';
      if (type === 'med') imgName = 'crate_med';
      else if (type === 'tech') imgName = 'crate_tech';
      else if (type === 'ration') imgName = 'crate_wood';

      ctx.save();
      ctx.globalAlpha = Math.max(0.1, Math.min(1.0, alpha));

      const img = this.getImage(`assets/radar/tiles/${imgName}.png`);
      if (this.isImageReady(img)) {
        ctx.drawImage(img, x - 14, y - 14, 28, 28);
      } else {
        // Fallback procedural crate
        ctx.fillStyle = type === 'ammo' ? '#0a2210' : '#221505';
        ctx.fillRect(x - 10, y - 10, 20, 20);
        ctx.strokeStyle = type === 'ammo' ? '#1fe044' : '#f5a623';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 10, y - 10, 20, 20);
      }

      // Pulsing glow indicator
      const pulse = 0.5 + Math.sin(tick * 0.15 + crate.id) * 0.5;
      ctx.strokeStyle = type === 'med' ? '#ff3344' : '#f5a623';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 14 + pulse * 2, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    },

    /**
     * Render Dropped Weapon on the floor
     */
    drawDroppedWeapon(ctx, drop, TS, tick, alpha = 1.0) {
      if (!ctx || !drop || drop.pickedUp) return;

      const x = drop.x;
      const y = drop.y;
      const pulse = Math.sin(tick * 0.12) * 2;

      ctx.save();
      ctx.globalAlpha = Math.max(0.1, Math.min(1.0, alpha));

      // Amber glow outline
      ctx.fillStyle = 'rgba(255, 170, 0, 0.2)';
      ctx.beginPath();
      ctx.arc(x, y, 16 + pulse, 0, Math.PI * 2);
      ctx.fill();

      // Gun silhouette
      ctx.strokeStyle = '#ffaa00';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 8, y);
      ctx.lineTo(x + 10, y);
      ctx.lineTo(x + 10, y + 4);
      ctx.lineTo(x + 4, y + 4);
      ctx.lineTo(x + 4, y + 8);
      ctx.stroke();

      ctx.fillStyle = '#ffcc00';
      ctx.font = 'bold 9px "Share Tech Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(drop.name || 'ОГНЕСТРЕЛ', x, y - 14);

      ctx.restore();
    },

    /**
     * Render Main Entities: Player, Allies, and 33 Monster Archetypes
     */
    drawEntity(ctx, entity, tick, options = {}) {
      if (!ctx || !entity) return;

      const x = entity.x || 0;
      const y = entity.y || 0;
      const radius = entity.radius || 13;
      const angle = entity.angle || 0;
      const vx = entity.vx || 0;
      const vy = entity.vy || 0;
      const speed = Math.hypot(vx, vy);
      const isMoving = speed > 0.08;

      const phosphorAlpha = Math.max(0.1, Math.min(1.0, entity.phosphorAlpha !== undefined ? entity.phosphorAlpha : 1.0));

      ctx.save();
      ctx.globalAlpha = phosphorAlpha;

      const isDamageFlash = entity.damageFlashTimer && entity.damageFlashTimer > 0;

      // 1. Draw Player
      if (entity.isPlayer) {
        // Flashlight beam forward towards aim angle
        this.drawVolumetricFlashlight(ctx, entity, tick);

        // Calculate 8-direction octant from aim/facing angle
        // 0: East, 1: South-East, 2: South, 3: South-West, 4: West, 5: North-West, 6: North, 7: North-East
        const normAngle = (angle % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
        const octant = Math.round(normAngle / (Math.PI / 4)) % 8;

        // Weapon type
        let weaponType = 'melee';
        if (entity.weapon && entity.weapon.isRanged) {
          const gt = entity.weapon.gunType || 'pistol';
          if (gt === 'shotgun') weaponType = 'shotgun';
          else if (gt === 'rifle' || gt === 'ak') weaponType = 'rifle';
          else weaponType = 'pistol';
        }

        // Walk frames
        const walkStep2 = isMoving ? Math.floor(tick * 0.28) % 2 : 0;
        const walkStep3 = isMoving ? Math.floor(tick * 0.28) % 3 : 0;

        let dirKey = 's_0';
        switch (octant) {
          case 0: dirKey = `e_${walkStep2}`; break;
          case 1: dirKey = 'se_0'; break;
          case 2: dirKey = `s_${walkStep3}`; break;
          case 3: dirKey = 'sw_0'; break;
          case 4: dirKey = `w_${walkStep2}`; break;
          case 5: dirKey = 'nw_0'; break;
          case 6: dirKey = `n_${walkStep2}`; break;
          case 7: dirKey = 'ne_0'; break;
        }

        let spritePath = `assets/radar/player/hero_${weaponType}_${dirKey}.png`;
        let img = this.getImage(spritePath);
        if (!this.isImageReady(img)) {
          spritePath = `assets/radar/player/hero_${dirKey}.png`;
          img = this.getImage(spritePath);
        }

        // Hop & Squash-stretch walk cycle ("скукоживается чуть и подпрыгивает")
        let hopY = 0;
        let scaleX = 1.0;
        let scaleY = 1.0;

        if (isMoving) {
          const phase = tick * 0.38;
          const bounce = Math.abs(Math.sin(phase)); // 0 to 1
          hopY = -bounce * 4.8; // podprygivaet
          // Skukozhivaetsia on foot plant (bounce near 0), stretches at apex
          const squash = (0.45 - bounce) * 0.12;
          scaleX = 1.0 + squash;
          scaleY = 1.0 - squash;
        } else {
          // Gentle breathing idle
          const breath = Math.sin(tick * 0.08) * 0.025;
          scaleX = 1.0 - breath * 0.5;
          scaleY = 1.0 + breath;
        }

        ctx.save();
        ctx.translate(x, y + hopY);
        ctx.scale(scaleX, scaleY);

        if (isDamageFlash) {
          ctx.filter = 'brightness(3) drop-shadow(0 0 8px #ffffff)';
        }

        if (this.isImageReady(img)) {
          // Render centered 80x80 sprite cleanly
          const drawSize = 52;
          ctx.drawImage(img, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
        } else {
          // Fallback procedural player
          this.drawPlayerVector(ctx, radius, isDamageFlash, entity, isMoving, tick);
        }

        ctx.restore();
      }
      // 2. Draw Patrol Liquidator (Ally)
      else if (entity.type === 'liquidator') {
        ctx.save();
        ctx.translate(x, y);

        const isFacingLeft = Math.cos(angle) < 0;
        if (isFacingLeft) {
          ctx.scale(-1, 1);
        }

        if (entity.isWounded) {
          ctx.filter = 'sepia(0.7) hue-rotate(-50deg) saturate(2.5) brightness(0.85)';
        }

        const walkStep = isMoving ? Math.floor(tick * 0.25) % 2 : 0;
        const img = this.getImage(`assets/radar/player/hero_rifle_e_${walkStep}.png`);

        if (this.isImageReady(img)) {
          const drawSize = 48;
          ctx.drawImage(img, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
        } else {
          this.drawPlayerVector(ctx, radius, isDamageFlash, entity, isMoving, tick, entity.isWounded ? '#ff8800' : '#33d4ff');
        }

        ctx.restore();
      }
      // 3. Draw Monster (From 33 Monster Archetypes)
      else {
        ctx.save();
        ctx.translate(x, y);

        // Top-down isometric orientation: flip horizontally when facing left, don't rotate upside-down
        const isFacingLeft = Math.cos(angle) < 0;
        if (isFacingLeft) {
          ctx.scale(-1, 1);
        }

        let mId = entity.monsterId || entity.archetype || 'mold_crawler';
        const ruAliases = {
          cherveobrazniy_narost: 'worm_growth',
          myasnoy_kultist: 'meat_cultist',
          svinoryl: 'pig_snout',
          nekro_santehnik: 'necro_plumber',
          toksichniy_plevun: 'toxic_spitter',
          amalgama_ploti: 'flesh_amalgam',
          biomeh_strazh: 'biomech_guardian'
        };
        if (ruAliases[mId]) {
          mId = ruAliases[mId];
        }

        // Animate frames _f0, _f1, _f2, _f3
        const animSpeed = isMoving ? 0.22 : 0.09;
        const fIdx = Math.floor(tick * animSpeed) % 4;
        let img = this.getImage(`assets/radar/entities/${mId}_f${fIdx}.png`);
        if (!this.isImageReady(img)) {
          img = this.getImage(`assets/radar/entities/${mId}.png`);
        }

        if (this.isImageReady(img)) {
          if (isDamageFlash) {
            ctx.filter = 'brightness(3) drop-shadow(0 0 10px #ffffff)';
          }
          const sz = Math.max(38, radius * 2.8);
          // Organic bobbing walk cycle
          const bob = isMoving ? Math.sin(tick * 0.3) * 2.0 : Math.sin(tick * 0.08) * 0.8;
          ctx.drawImage(img, -sz / 2, -sz / 2 + bob, sz, sz);
        } else {
          // Fallback procedural monster
          this.drawMonsterVector(ctx, radius, isDamageFlash, entity, tick);
        }

        ctx.restore();
      }

      // Overhead floating health bar
      this.drawOverheadHealthBar(ctx, entity, x, y, radius, isDamageFlash);

      ctx.restore();
    },

    /**
     * Fallback vector drawing for player
     */
    drawPlayerVector(ctx, r, isFlash, entity, isMoving, tick, baseColor = '#1fe044') {
      const color = isFlash ? '#ffffff' : baseColor;

      // Backpack / O2 tanks
      ctx.fillStyle = '#0a2210';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(-r * 0.7, -r * 0.8, r * 1.4, r * 0.5, 3);
      ctx.fill();
      ctx.stroke();

      // Shoulders / Armor
      ctx.fillStyle = isFlash ? '#ffffff' : '#0e3a18';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Helmet visor
      ctx.fillStyle = '#88ff9e';
      ctx.beginPath();
      ctx.ellipse(0, 2, r * 0.55, r * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();

      // Gun / Weapon forward
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(r * 0.3, 0);
      ctx.lineTo(r * 0.3, r + 8);
      ctx.stroke();
    },

    /**
     * Fallback vector drawing for monsters
     */
    drawMonsterVector(ctx, r, isFlash, entity, tick) {
      const color = isFlash ? '#ffffff' : (entity.color || '#ff3b30');
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
    },

    /**
     * Overhead Floating CRT Health Bar
     */
    drawOverheadHealthBar(ctx, entity, x, y, radius, isFlash) {
      if (entity.isDead || (entity.hp <= 0)) return;

      const maxHp = entity.maxHp || 100;
      const hp = Math.max(0, entity.hp);
      const pct = Math.min(1.0, hp / maxHp);

      const barW = Math.max(26, radius * 2.2);
      const barH = 4;
      const barX = x - barW / 2;
      const barY = y - radius - 14;

      ctx.save();
      ctx.fillStyle = '#220000';
      ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);

      let fillCol = entity.isPlayer ? '#1fe044' : (entity.type === 'liquidator' ? '#33d4ff' : '#ff3b30');
      if (entity.tier === 'boss') fillCol = '#cc22ff';
      if (isFlash) fillCol = '#ffffff';

      ctx.fillStyle = fillCol;
      ctx.fillRect(barX, barY, Math.floor(barW * pct), barH);

      // Boss name tag
      if (entity.tier === 'boss') {
        ctx.fillStyle = '#ff88ff';
        ctx.font = 'bold 9px "Share Tech Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`⚡ ${entity.name} ⚡`, x, barY - 4);
      } else if (entity.type === 'liquidator') {
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        if (entity.isWounded) {
          const pulse = (Math.sin(Date.now() * 0.008) > 0) ? '#ffaa00' : '#ff3333';
          ctx.fillStyle = pulse;
          ctx.fillText('⚠️ РАНЕН [E]', x, barY - 4);
        } else if (entity.isLoyalFollower) {
          ctx.fillStyle = '#00ff66';
          ctx.fillText('★ НАПАРНИК', x, barY - 4);
        }
      }

      ctx.restore();
    },

    /**
     * Tactical CRT Crosshair
     */
    drawCrosshair(ctx, screenX, screenY, tick, isTargetEnemy) {
      if (!ctx) return;

      const size = 16;
      const pulse = Math.sin(tick * 0.15) * 1.5;
      const color = isTargetEnemy ? '#ff3b30' : '#1fe044';

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = color;
      ctx.shadowBlur = isTargetEnemy ? 12 : 6;

      // Outer targeting brackets
      ctx.beginPath();
      ctx.arc(screenX, screenY, size + pulse, 0, Math.PI * 2);
      ctx.stroke();

      // Crosshair tick marks
      ctx.beginPath();
      ctx.moveTo(screenX - size - 6, screenY);
      ctx.lineTo(screenX - 4, screenY);
      ctx.moveTo(screenX + 4, screenY);
      ctx.lineTo(screenX + size + 6, screenY);
      ctx.moveTo(screenX, screenY - size - 6);
      ctx.lineTo(screenX, screenY - 4);
      ctx.moveTo(screenX, screenY + 4);
      ctx.lineTo(screenX, screenY + size + 6);
      ctx.stroke();

      // Center aiming dot
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(screenX, screenY, 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    },

    /**
     * Melee Slash Arc VFX
     */
    drawMeleeSwingArc(ctx, x, y, angle, progress) {
      if (!ctx) return;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);

      const arcDist = 32;
      const arcWidth = 0.8;
      const p = Math.max(0, Math.min(1.0, progress));

      ctx.strokeStyle = `rgba(136, 255, 158, ${1.0 - p})`;
      ctx.lineWidth = 4 * (1.0 - p);
      ctx.beginPath();
      ctx.arc(0, 0, arcDist, -arcWidth + p * 1.6, arcWidth);
      ctx.stroke();

      ctx.restore();
    }
  };

  global.SpriteFactory = SpriteFactory;
})(typeof window !== 'undefined' ? window : this);
