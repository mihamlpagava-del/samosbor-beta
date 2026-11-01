/**
 * ============================================================================
 * MODULE: radarRoguelike.js (2D Top-Down Radar Roguelike Engine - «РЕЙД: САМОСБОР»)
 * ============================================================================
 * Complete implementation:
 * - 40x40 procedural floor generated via LevelGen.js
 * - Procedural rendering via SpriteFactory.js (Player, Mutants, Allies, Tiles)
 * - 360° rotating radar sweep line with phosphor persistence decay
 * - Floating overhead health bars (24x4px, flash on damage)
 * - CRT HUD: Telemetry (HP, Ammo, Status), scanlines, vignette & beam collapse
 * - Full WASD controls, mouse crosshair, impulse shooting & sound alert aggro
 * - Extraction elevator victory & death game over loop
 */

(function (global) {
  'use strict';

  class RadarRoguelikeEngine {
    constructor() {
      this.canvas = null;
      this.ctx = null;
      this.isRunning = false;
      this.tick = 0;
      this.animFrameId = null;

      // Radar Sweep
      this.radarAngle = 0;
      this.radarSpeed = 0.038; // Radians per frame

      // Level Map (40x40 grid, tileSize = 32px)
      this.mapData = null;
      this.tileSize = 32;

      // Player
      this.player = {
        x: 200,
        y: 200,
        radius: 13,
        angle: 0,
        vx: 0,
        vy: 0,
        speed: 2.9,
        hp: 100,
        maxHp: 100,
        armor: 15,
        ammo: 36,
        maxAmmo: 36,
        talonsEarned: 0,
        xpEarned: 0,
        type: 'player',
        isPlayer: true,
        damageFlashTimer: 0,
        isDead: false
      };

      // Entities (Mutants, Patrols, Projectiles, Particles)
      this.entities = [];
      this.projectiles = [];
      this.particles = [];
      this.crates = [];
      this.doors = [];
      this.elevator = null;

      // Input & Mouse
      this.keys = {};
      this.mouse = { x: 0, y: 0, worldX: 0, worldY: 0, isDown: false };
      this.currentRoomName = 'Жилая ячейка №556';
      this.lastShotTime = 0;

      // CRT Collapse Animation on Death / Victory
      this.isCollapsing = false;
      this.collapseProgress = 0;
      this.evacuationPrompt = false;

      this.onExitCallback = null;
    }

    /**
     * Initialize engine on canvas element
     */
    init(canvasElement, onExit) {
      this.canvas = canvasElement;
      this.ctx = canvasElement.getContext('2d');
      this.onExitCallback = onExit;

      this.setupInputListeners();
      this.buildFloor();
      this.syncPlayerFromBase();
    }

    syncPlayerFromBase() {
      if (typeof clientMe !== 'undefined' && clientMe) {
        this.player.hp = clientMe.hp || 100;
        this.player.maxHp = clientMe.maxHp || 100;
        this.player.armor = (clientMe.stats && clientMe.stats.def) ? clientMe.stats.def : 14;
      }
    }

    buildFloor() {
      if (typeof LevelGen !== 'undefined') {
        this.mapData = LevelGen.generate();
      } else {
        // Fallback simple map if LevelGen isn't loaded
        this.mapData = {
          width: 40,
          height: 40,
          tileSize: 32,
          grid: Array(40).fill(null).map(() => new Uint8Array(40).fill(0)),
          rooms: [{ id: 0, name: 'Жилая ячейка №556', x: 2, y: 2, w: 10, h: 8 }],
          doors: [],
          playerSpawn: { x: 160, y: 160 },
          elevator: { x: 300, y: 300, w: 32, h: 32 },
          lootCrates: [],
          mutantSpawns: [],
          patrolSpawns: []
        };
      }

      this.tileSize = this.mapData.tileSize || 32;

      // Position player at safe room spawn
      this.player.x = this.mapData.playerSpawn.x;
      this.player.y = this.mapData.playerSpawn.y;
      this.player.vx = 0;
      this.player.vy = 0;
      this.player.hp = this.player.maxHp;
      this.player.ammo = this.player.maxAmmo;
      this.player.talonsEarned = 0;
      this.player.xpEarned = 0;
      this.player.isDead = false;
      this.isCollapsing = false;
      this.collapseProgress = 0;

      this.crates = this.mapData.lootCrates || [];
      this.doors = this.mapData.doors || [];
      this.elevator = this.mapData.elevator || { x: 500, y: 500, w: 32, h: 32 };

      // Initialize AI Entities
      this.entities = [];

      // 1. Mutants (Hostile Wandering Biomass)
      (this.mapData.mutantSpawns || []).forEach((m, idx) => {
        this.entities.push({
          id: `mutant_${idx}`,
          type: 'mutant_slime',
          name: 'Мутант // Слизень',
          x: m.x,
          y: m.y,
          homeX: m.x,
          homeY: m.y,
          radius: 14,
          angle: Math.random() * Math.PI * 2,
          vx: 0,
          vy: 0,
          speed: m.speed || 1.6,
          hp: m.hp || 50,
          maxHp: m.maxHp || 50,
          state: 'IDLE_WANDER',
          stateTimer: Math.random() * 60,
          wanderTarget: { x: m.x, y: m.y },
          damageFlashTimer: 0,
          phosphorAlpha: 0.15,
          color: '#ff3b30'
        });
      });

      // 2. Patrol Liquidators (Friendly / Allies)
      (this.mapData.patrolSpawns || []).forEach((p, idx) => {
        this.entities.push({
          id: `patrol_${idx}`,
          type: 'liquidator',
          name: `Патрульный [Ликвидатор ${idx + 1}]`,
          x: p.x,
          y: p.y,
          homeX: p.x,
          homeY: p.y,
          radius: 13,
          angle: 0,
          vx: 0,
          vy: 0,
          speed: 1.8,
          hp: 120,
          maxHp: 120,
          state: 'PATROL',
          stateTimer: 0,
          wanderTarget: { x: p.x, y: p.y },
          damageFlashTimer: 0,
          phosphorAlpha: 0.25,
          color: '#1fe044'
        });
      });
    }

    setupInputListeners() {
      window.addEventListener('keydown', (e) => {
        if (!this.isRunning) return;
        this.keys[e.code] = true;
        this.keys[e.key.toLowerCase()] = true;

        if (e.code === 'Escape') {
          this.exitToCell();
        }
        if (e.code === 'KeyE' || e.code === 'Space') {
          this.interactNearby();
        }
        if (e.code === 'KeyR') {
          this.reloadAmmo();
        }
      });

      window.addEventListener('keyup', (e) => {
        if (!this.isRunning) return;
        this.keys[e.code] = false;
        this.keys[e.key.toLowerCase()] = false;
      });

      if (this.canvas) {
        this.canvas.addEventListener('mousemove', (e) => {
          if (!this.isRunning) return;
          const rect = this.canvas.getBoundingClientRect();
          this.mouse.x = e.clientX - rect.left;
          this.mouse.y = e.clientY - rect.top;

          const cam = this.getCameraOffset();
          this.mouse.worldX = this.mouse.x + cam.x;
          this.mouse.worldY = this.mouse.y + cam.y;

          this.player.angle = Math.atan2(this.mouse.worldY - this.player.y, this.mouse.worldX - this.player.x);
        });

        this.canvas.addEventListener('mousedown', (e) => {
          if (!this.isRunning) return;
          if (e.button === 0) {
            this.mouse.isDown = true;
            this.playerShoot();
          }
        });

        this.canvas.addEventListener('mouseup', () => {
          this.mouse.isDown = false;
        });
      }
    }

    start() {
      this.isRunning = true;
      this.resizeCanvas();
      window.addEventListener('resize', () => this.resizeCanvas());

      this.loop = this.loop.bind(this);
      if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
      this.animFrameId = requestAnimationFrame(this.loop);
    }

    stop() {
      this.isRunning = false;
      if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    }

    resizeCanvas() {
      if (!this.canvas) return;
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    }

    loop() {
      if (!this.isRunning) return;
      this.tick++;

      this.update();
      this.render();

      this.animFrameId = requestAnimationFrame(this.loop);
    }

    /**
     * Player Shooting & Sound Alert Noise
     */
    playerShoot() {
      if (this.player.isDead || this.player.ammo <= 0) {
        this.reloadAmmo();
        return;
      }

      const now = Date.now();
      if (now - this.lastShotTime < 180) return; // Fire rate limit
      this.lastShotTime = now;
      this.player.ammo--;

      // Play audio if available
      if (typeof playSound === 'function') {
        playSound('buy');
      }

      const speed = 14;
      const spread = (Math.random() - 0.5) * 0.08;
      const shotAngle = this.player.angle + spread;

      this.projectiles.push({
        x: this.player.x + Math.cos(shotAngle) * 16,
        y: this.player.y + Math.sin(shotAngle) * 16,
        vx: Math.cos(shotAngle) * speed,
        vy: Math.sin(shotAngle) * speed,
        damage: 28,
        isPlayer: true,
        life: 55,
        color: '#88ff9e'
      });

      // Muzzle flash particles
      for (let i = 0; i < 4; i++) {
        this.particles.push({
          x: this.player.x + Math.cos(shotAngle) * 18,
          y: this.player.y + Math.sin(shotAngle) * 18,
          vx: Math.cos(shotAngle + (Math.random() - 0.5) * 0.4) * (Math.random() * 4 + 2),
          vy: Math.sin(shotAngle + (Math.random() - 0.5) * 0.4) * (Math.random() * 4 + 2),
          color: '#ffffff',
          alpha: 1.0,
          sz: 2
        });
      }

      // Gunshot noise aggros nearby mutants within 350px!
      for (const e of this.entities) {
        if (e.type === 'mutant_slime') {
          const d = Math.hypot(e.x - this.player.x, e.y - this.player.y);
          if (d < 350) {
            e.state = 'CHASE';
            e.stateTimer = 180;
          }
        }
      }
    }

    reloadAmmo() {
      if (this.player.ammo < this.player.maxAmmo) {
        this.player.ammo = this.player.maxAmmo;
        this.spawnFloatingNotice('ПАТРОНЫ ПЕРЕЗАРЯЖЕНЫ [36]', '#1fe044');
      }
    }

    interactNearby() {
      // 1. Check extraction elevator
      if (this.elevator) {
        const dElev = Math.hypot(this.player.x - (this.elevator.x + 16), this.player.y - (this.elevator.y + 16));
        if (dElev < 48) {
          this.evacuateSuccess();
          return;
        }
      }

      // 2. Check nearby airtight doors
      for (const d of this.doors) {
        const dist = Math.hypot(this.player.x - d.x, this.player.y - d.y);
        if (dist < 45) {
          d.isOpen = !d.isOpen;
          this.spawnFloatingNotice(d.isOpen ? 'ГЕРМОДВЕРЬ ОТКРЫТА' : 'ГЕРМОДВЕРЬ ЗАКРЫТА', '#ffaa00');
          return;
        }
      }

      // 3. Check loot crates
      for (const crate of this.crates) {
        if (!crate.opened) {
          const dist = Math.hypot(this.player.x - crate.x, this.player.y - crate.y);
          if (dist < 40) {
            this.openCrate(crate);
            return;
          }
        }
      }
    }

    openCrate(crate) {
      crate.opened = true;
      if (crate.type === 'ammo') {
        this.player.ammo = this.player.maxAmmo;
        this.spawnFloatingNotice('+36 ПАТРОНОВ', '#33d4ff');
      } else {
        this.player.talonsEarned += crate.amount || 25;
        this.player.xpEarned += 15;
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 20);
        this.spawnFloatingNotice(`+${crate.amount || 25} ТАЛОНОВ, +20 HP`, '#f5a623');
      }
    }

    evacuateSuccess() {
      this.isCollapsing = true;
      const talons = this.player.talonsEarned + 100; // Extraction bonus!
      const xp = this.player.xpEarned + 50;

      if (typeof clientMe !== 'undefined' && clientMe) {
        clientMe.talons = (clientMe.talons || 0) + talons;
        clientMe.xp = (clientMe.xp || 0) + xp;
      }
      if (typeof socket !== 'undefined' && socket) {
        socket.emit('terminalError', `ЭВАКУАЦИЯ УСПЕШНА! Получено: +${talons} талонов, +${xp} XP.`);
      }

      setTimeout(() => {
        this.exitToCell(true);
      }, 1200);
    }

    spawnFloatingNotice(text, color = '#1fe044') {
      this.particles.push({
        x: this.player.x - 30,
        y: this.player.y - 28,
        vx: 0,
        vy: -0.6,
        text: text,
        color: color,
        alpha: 1.0,
        isText: true
      });
    }

    /**
     * Main Simulation Update
     */
    update() {
      if (this.isCollapsing) {
        this.collapseProgress += 0.04;
        return;
      }

      // 1. Radar Angle Rotation (360° sweep)
      this.radarAngle += this.radarSpeed;
      if (this.radarAngle >= Math.PI * 2) {
        this.radarAngle -= Math.PI * 2;
      }

      // 2. Player Input Movement with smooth inertia
      let moveX = 0;
      let moveY = 0;
      if (this.keys['KeyW'] || this.keys['ArrowUp'] || this.keys['w']) moveY -= 1;
      if (this.keys['KeyS'] || this.keys['ArrowDown'] || this.keys['s']) moveY += 1;
      if (this.keys['KeyA'] || this.keys['ArrowLeft'] || this.keys['a']) moveX -= 1;
      if (this.keys['KeyD'] || this.keys['ArrowRight'] || this.keys['d']) moveX += 1;

      if (moveX !== 0 && moveY !== 0) {
        moveX *= 0.7071;
        moveY *= 0.7071;
      }

      const accel = 0.45;
      const friction = 0.82;
      this.player.vx = (this.player.vx + moveX * accel * this.player.speed) * friction;
      this.player.vy = (this.player.vy + moveY * accel * this.player.speed) * friction;

      // Wall and Door Collision Check
      const nextX = this.player.x + this.player.vx;
      const nextY = this.player.y + this.player.vy;

      if (!this.isTileSolid(nextX, this.player.y, this.player.radius)) {
        this.player.x = nextX;
      } else {
        this.player.vx = 0;
      }

      if (!this.isTileSolid(this.player.x, nextY, this.player.radius)) {
        this.player.y = nextY;
      } else {
        this.player.vy = 0;
      }

      // Identify Current Room
      this.updateCurrentRoom();

      // Automatic proximity crate opening & elevator prompt
      if (this.elevator) {
        const dElev = Math.hypot(this.player.x - (this.elevator.x + 16), this.player.y - (this.elevator.y + 16));
        this.evacuationPrompt = (dElev < 50);
      }

      for (const crate of this.crates) {
        if (!crate.opened) {
          const dCrate = Math.hypot(this.player.x - crate.x, this.player.y - crate.y);
          if (dCrate < 24) {
            this.openCrate(crate);
          }
        }
      }

      // Damage flash timer decay
      if (this.player.damageFlashTimer > 0) this.player.damageFlashTimer--;

      // 3. Update AI Entities (Mutants & Liquidators)
      this.updateEntities();

      // 4. Update Projectiles
      this.updateProjectiles();

      // 5. Update Particles
      this.updateParticles();

      // 6. Check Player Death
      if (this.player.hp <= 0 && !this.player.isDead) {
        this.player.isDead = true;
        this.isCollapsing = true;
        if (typeof socket !== 'undefined' && socket) {
          socket.emit('terminalError', 'РЕЙД ПРЕРВАН: СИГНАЛ БИОМЕТРИИ ЛИКВИДАТОРА УТЕРЯН.');
        }
        setTimeout(() => this.exitToCell(false), 1400);
      }
    }

    updateCurrentRoom() {
      if (!this.mapData || !this.mapData.rooms) return;
      const px = this.player.x;
      const py = this.player.y;

      for (const r of this.mapData.rooms) {
        if (px >= r.worldX && px <= r.worldX + r.worldW && py >= r.worldY && py <= r.worldY + r.worldH) {
          this.currentRoomName = r.name;
          return;
        }
      }
      this.currentRoomName = 'Технический коридор';
    }

    isTileSolid(worldX, worldY, radius = 8) {
      if (!this.mapData || !this.mapData.grid) return false;
      const TS = this.tileSize;
      const W = this.mapData.width;
      const H = this.mapData.height;

      // Check perimeter points around radius
      const checkPoints = [
        { x: worldX - radius, y: worldY },
        { x: worldX + radius, y: worldY },
        { x: worldX, y: worldY - radius },
        { x: worldX, y: worldY + radius }
      ];

      for (const pt of checkPoints) {
        const tx = Math.floor(pt.x / TS);
        const ty = Math.floor(pt.y / TS);

        if (tx < 0 || tx >= W || ty < 0 || ty >= H) return true;
        if (this.mapData.grid[ty][tx] === 1) return true; // TILE_WALL

        // Check closed airtight doors
        for (const d of this.doors) {
          if (!d.isOpen && d.tileX === tx && d.tileY === ty) {
            return true;
          }
        }
      }
      return false;
    }

    updateEntities() {
      const px = this.player.x;
      const py = this.player.y;

      for (const e of this.entities) {
        if (e.damageFlashTimer > 0) e.damageFlashTimer--;

        // Phosphor decay trail relative to radar sweep angle
        const angleToEntity = Math.atan2(e.y - py, e.x - px);
        let normalizedAngle = angleToEntity < 0 ? angleToEntity + Math.PI * 2 : angleToEntity;
        let diff = Math.abs(normalizedAngle - this.radarAngle);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;

        if (diff < 0.2) {
          e.phosphorAlpha = 1.0; // Swept by beam! Maximum brightness
        } else {
          e.phosphorAlpha = Math.max(0.12, (e.phosphorAlpha || 1.0) - 0.006);
        }

        // Entity AI State Machine
        if (e.type === 'mutant_slime') {
          const distToPlayer = Math.hypot(px - e.x, py - e.y);

          if (e.state === 'IDLE_WANDER') {
            e.stateTimer--;
            if (e.stateTimer <= 0) {
              e.stateTimer = 60 + Math.random() * 90;
              e.wanderTarget = {
                x: e.homeX + (Math.random() - 0.5) * 160,
                y: e.homeY + (Math.random() - 0.5) * 160
              };
            }

            const dx = e.wanderTarget.x - e.x;
            const dy = e.wanderTarget.y - e.y;
            if (Math.hypot(dx, dy) > 8) {
              const ang = Math.atan2(dy, dx);
              e.vx = Math.cos(ang) * (e.speed * 0.6);
              e.vy = Math.sin(ang) * (e.speed * 0.6);
              e.angle = ang;
            } else {
              e.vx = 0;
              e.vy = 0;
            }

            // Aggro if player enters 190px range
            if (distToPlayer < 190) {
              e.state = 'CHASE';
              e.stateTimer = 180;
            }
          } else if (e.state === 'CHASE') {
            const ang = Math.atan2(py - e.y, px - e.x);
            e.vx = Math.cos(ang) * e.speed;
            e.vy = Math.sin(ang) * e.speed;
            e.angle = ang;

            // Attack player on contact
            if (distToPlayer < e.radius + this.player.radius + 4) {
              this.damagePlayer(14);
              e.vx *= -1.5;
              e.vy *= -1.5;
            }
          }
        } else if (e.type === 'liquidator') {
          // Patrol wander between friendly nodes
          e.stateTimer--;
          if (e.stateTimer <= 0) {
            e.stateTimer = 90 + Math.random() * 90;
            e.wanderTarget = {
              x: e.homeX + (Math.random() - 0.5) * 120,
              y: e.homeY + (Math.random() - 0.5) * 120
            };
          }
          const dx = e.wanderTarget.x - e.x;
          const dy = e.wanderTarget.y - e.y;
          if (Math.hypot(dx, dy) > 10) {
            const ang = Math.atan2(dy, dx);
            e.vx = Math.cos(ang) * (e.speed * 0.7);
            e.vy = Math.sin(ang) * (e.speed * 0.7);
            e.angle = ang;
          }
        }

        // Apply movement with wall collisions
        const nextEx = e.x + (e.vx || 0);
        const nextEy = e.y + (e.vy || 0);

        if (!this.isTileSolid(nextEx, e.y, e.radius)) e.x = nextEx;
        if (!this.isTileSolid(e.x, nextEy, e.radius)) e.y = nextEy;
      }
    }

    damagePlayer(amount) {
      if (this.player.damageFlashTimer > 0) return; // Brief invulnerability
      const actualDmg = Math.max(4, amount - Math.floor(this.player.armor * 0.35));
      this.player.hp = Math.max(0, this.player.hp - actualDmg);
      this.player.damageFlashTimer = 12;

      // Damage particles
      for (let i = 0; i < 6; i++) {
        this.particles.push({
          x: this.player.x,
          y: this.player.y,
          vx: (Math.random() - 0.5) * 4,
          vy: (Math.random() - 0.5) * 4,
          color: '#ff3b30',
          alpha: 1.0,
          sz: 2.5
        });
      }
    }

    updateProjectiles() {
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const p = this.projectiles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life--;

        // Check wall collision
        if (this.isTileSolid(p.x, p.y, 4) || p.life <= 0) {
          this.spawnHitParticles(p.x, p.y, '#1fe044', 4);
          this.projectiles.splice(i, 1);
          continue;
        }

        // Check enemy collision
        let hit = false;
        for (let j = this.entities.length - 1; j >= 0; j--) {
          const e = this.entities[j];
          if (e.type === 'mutant_slime') {
            const dist = Math.hypot(p.x - e.x, p.y - e.y);
            if (dist < e.radius + 6) {
              e.hp -= p.damage;
              e.damageFlashTimer = 8;
              this.spawnHitParticles(p.x, p.y, '#ff3b30', 6);
              hit = true;

              if (e.hp <= 0) {
                this.entities.splice(j, 1);
                this.player.talonsEarned += 15;
                this.player.xpEarned += 25;
                this.spawnFloatingNotice('+15 ТАЛОНОВ', '#ffd700');
              }
              break;
            }
          }
        }

        if (hit) {
          this.projectiles.splice(i, 1);
        }
      }
    }

    spawnHitParticles(x, y, color, count) {
      for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = Math.random() * 3 + 1;
        this.particles.push({
          x,
          y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          color,
          alpha: 1.0,
          sz: Math.random() * 2 + 1.5
        });
      }
    }

    updateParticles() {
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const pt = this.particles[i];
        pt.x += pt.vx || 0;
        pt.y += pt.vy || 0;
        pt.alpha -= pt.isText ? 0.02 : 0.04;
        if (pt.alpha <= 0) {
          this.particles.splice(i, 1);
        }
      }
    }

    getCameraOffset() {
      return {
        x: Math.round(this.player.x - this.canvas.width / 2),
        y: Math.round(this.player.y - this.canvas.height / 2)
      };
    }

    /**
     * Master Render
     */
    render() {
      const ctx = this.ctx;
      const w = this.canvas.width;
      const h = this.canvas.height;
      const cam = this.getCameraOffset();

      // CRT Persistence Trail: Slow dark phosphor fade
      ctx.fillStyle = 'rgba(4, 20, 7, 0.05)';
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.translate(-cam.x, -cam.y);

      // 1. Draw Map Tiles (Walls & Floors via SpriteFactory)
      this.drawTiles(ctx, cam, w, h);

      // 2. Draw Airtight Doors
      for (const door of this.doors) {
        if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawDoorTile) {
          SpriteFactory.drawDoorTile(ctx, door, this.tileSize, 1.0);
        }
      }

      // 3. Draw Loot Crates
      for (const crate of this.crates) {
        if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawLootCrate) {
          SpriteFactory.drawLootCrate(ctx, crate, this.tileSize, this.tick, crate.phosphorAlpha || 0.8);
        }
      }

      // 4. Draw Extraction Elevator Shaft
      if (this.elevator && typeof SpriteFactory !== 'undefined' && SpriteFactory.drawElevatorShaft) {
        SpriteFactory.drawElevatorShaft(ctx, this.elevator, this.tileSize, this.tick, 1.0);
      }

      // 5. Draw 360° Circular Radar Sweep Beam
      this.drawCircularSonar(ctx);

      // 6. Draw Projectiles
      for (const p of this.projectiles) {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }

      // 7. Draw AI Entities
      for (const e of this.entities) {
        if (typeof SpriteFactory !== 'undefined') {
          SpriteFactory.drawEntity(ctx, e, this.tick);
        }
      }

      // 8. Draw Player
      if (typeof SpriteFactory !== 'undefined') {
        SpriteFactory.drawEntity(ctx, this.player, this.tick);
      }

      // 9. Particles and Floating Notices
      for (const pt of this.particles) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, pt.alpha);
        if (pt.isText) {
          ctx.fillStyle = pt.color;
          ctx.font = 'bold 12px "Share Tech Mono", monospace';
          ctx.fillText(pt.text, pt.x, pt.y);
        } else {
          ctx.fillStyle = pt.color;
          ctx.fillRect(pt.x, pt.y, pt.sz, pt.sz);
        }
        ctx.restore();
      }

      ctx.restore();

      // 10. Draw CRT Post-Processing & HUD Telemetry
      this.drawRadarHUD(ctx, w, h);

      // 11. CRT Beam Collapse Animation (on Death or Extraction)
      if (this.isCollapsing) {
        this.drawCRTCollapse(ctx, w, h);
      }
    }

    drawTiles(ctx, cam, w, h) {
      if (!this.mapData || !this.mapData.grid) return;
      const TS = this.tileSize;
      const startX = Math.max(0, Math.floor(cam.x / TS));
      const endX = Math.min(this.mapData.width - 1, Math.ceil((cam.x + w) / TS));
      const startY = Math.max(0, Math.floor(cam.y / TS));
      const endY = Math.min(this.mapData.height - 1, Math.ceil((cam.y + h) / TS));

      for (let y = startY; y <= endY; y++) {
        for (let x = startX; x <= endX; x++) {
          const tile = this.mapData.grid[y][x];
          const wx = x * TS;
          const wy = y * TS;

          if (tile === 1) { // TILE_WALL
            if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawWallTile) {
              SpriteFactory.drawWallTile(ctx, wx, wy, TS, 1.0);
            } else {
              ctx.fillStyle = '#0b3814';
              ctx.fillRect(wx, wy, TS, TS);
            }
          } else { // TILE_FLOOR
            if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawFloorTile) {
              SpriteFactory.drawFloorTile(ctx, wx, wy, TS, 0.8);
            }
          }
        }
      }
    }

    /**
     * Circular Sonar Overlay with Angular Notches & Sweep Line
     */
    drawCircularSonar(ctx) {
      const px = this.player.x;
      const py = this.player.y;
      const sweepRadius = 420;

      ctx.save();

      // Gradient Sweep Cone
      const grad = ctx.createRadialGradient(px, py, 10, px, py, sweepRadius);
      grad.addColorStop(0, 'rgba(31, 224, 68, 0.22)');
      grad.addColorStop(1, 'rgba(31, 224, 68, 0.0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.arc(px, py, sweepRadius, this.radarAngle - 0.45, this.radarAngle);
      ctx.closePath();
      ctx.fill();

      // Sweep Beam Line
      ctx.strokeStyle = '#1fe044';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(this.radarAngle) * sweepRadius, py + Math.sin(this.radarAngle) * sweepRadius);
      ctx.stroke();

      ctx.restore();
    }

    /**
     * CRT HUD Telemetry & Scanline Overlay
     */
    drawRadarHUD(ctx, w, h) {
      ctx.save();

      // 1. Concentric Range Rings & Crosshairs
      const cx = w / 2;
      const cy = h / 2;
      ctx.strokeStyle = 'rgba(31, 224, 68, 0.12)';
      ctx.lineWidth = 1;
      [100, 200, 320].forEach(rad => {
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.stroke();
      });

      // Angular degree notches (0, 90, 180, 270)
      ctx.fillStyle = 'rgba(31, 224, 68, 0.35)';
      ctx.font = '9px monospace';
      ctx.fillText('0° N', cx - 10, cy - 325);
      ctx.fillText('90° E', cx + 325, cy + 3);
      ctx.fillText('180° S', cx - 14, cy + 335);
      ctx.fillText('270° W', cx - 355, cy + 3);

      // 2. Top-Left Status Panel
      ctx.fillStyle = 'rgba(4, 20, 7, 0.9)';
      ctx.fillRect(16, 16, 320, 68);
      ctx.strokeStyle = '#1fe044';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(16, 16, 320, 68);

      ctx.fillStyle = '#ff3b30';
      ctx.font = 'bold 12px "Share Tech Mono", monospace';
      ctx.fillText('СТАТУС: ТРЕВОГА // САМОСБОР', 28, 38);

      ctx.fillStyle = '#1fe044';
      ctx.font = '11px monospace';
      ctx.fillText(`СЕКТОР: [ ${this.currentRoomName.toUpperCase()} ]`, 28, 56);
      ctx.fillText(`РЕЙДОВЫЙ СБОР: +${this.player.talonsEarned} ТАЛОНОВ`, 28, 72);

      // 3. Bottom-Right CRT Telemetry Panel
      const hudW = 290;
      const hudH = 96;
      const hudX = w - hudW - 16;
      const hudY = h - hudH - 16;

      ctx.fillStyle = 'rgba(4, 20, 7, 0.9)';
      ctx.fillRect(hudX, hudY, hudW, hudH);
      ctx.strokeStyle = '#1fe044';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(hudX, hudY, hudW, hudH);

      // Segmented HP Bar
      const hpPct = Math.max(0, this.player.hp / this.player.maxHp);
      const segments = 10;
      const filled = Math.round(hpPct * segments);
      let segBar = '[';
      for (let s = 0; s < segments; s++) segBar += (s < filled) ? '||' : '  ';
      segBar += ']';

      ctx.font = 'bold 12px "Share Tech Mono", monospace';
      ctx.fillStyle = this.player.hp < 30 ? '#ff3b30' : '#1fe044';
      ctx.fillText(`HP: ${segBar} ${this.player.hp}/${this.player.maxHp}`, hudX + 14, hudY + 28);

      ctx.font = '11.5px monospace';
      ctx.fillStyle = '#88ff9e';
      ctx.fillText(`ПАТРОНЫ: ${this.player.ammo}/${this.player.maxAmmo} (7.62 мм)`, hudX + 14, hudY + 52);
      ctx.fillText(`БРОНЯ: ${this.player.armor} DEF | [R] ПЕРЕЗАРЯДКА`, hudX + 14, hudY + 74);

      // 4. Extraction Elevator Prompt Banner
      if (this.evacuationPrompt) {
        ctx.fillStyle = 'rgba(0, 40, 15, 0.95)';
        ctx.fillRect(cx - 210, h - 85, 420, 36);
        ctx.strokeStyle = '#88ff9e';
        ctx.lineWidth = 2;
        ctx.strokeRect(cx - 210, h - 85, 420, 36);

        ctx.fillStyle = '#88ff9e';
        ctx.font = 'bold 13px "Share Tech Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('⚡ НАЖМИТЕ [ E ] ДЛЯ ЭВАКУАЦИИ В ЖИЛЯЧЕЙКУ ⚡', cx, h - 62);
        ctx.textAlign = 'left';
      }

      // 5. CRT Scanlines & Screen Vignette
      ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
      for (let y = 0; y < h; y += 4) {
        ctx.fillRect(0, y, w, 1.5);
      }

      ctx.restore();
    }

    /**
     * CRT Beam Collapse on Game Over / Victory
     */
    drawCRTCollapse(ctx, w, h) {
      ctx.save();
      const p = Math.min(1.0, this.collapseProgress);

      if (p < 0.6) {
        // Vertical squeeze to a single horizontal beam
        const curH = h * (1 - p / 0.6);
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, (h - curH) / 2);
        ctx.fillRect(0, (h + curH) / 2, w, (h - curH) / 2);
      } else {
        // Horizontal collapse to a center dot, then black
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, h);

        const dotP = (p - 0.6) / 0.4;
        const curW = w * (1 - dotP);
        ctx.fillStyle = '#88ff9e';
        ctx.fillRect((w - curW) / 2, h / 2 - 1, curW, 2);
      }

      ctx.restore();
    }

    exitToCell(completed = false) {
      this.stop();
      if (typeof this.onExitCallback === 'function') {
        this.onExitCallback(completed);
      }
    }
  }

  global.RadarRoguelikeEngine = RadarRoguelikeEngine;
})(typeof window !== 'undefined' ? window : this);
