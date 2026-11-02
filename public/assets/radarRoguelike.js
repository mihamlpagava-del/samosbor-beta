/**
 * ============================================================================
 * MODULE: radarRoguelike.js (2D Top-Down Radar Shooter - «РЕЙД: САМОСБОР»)
 * ============================================================================
 * Complete implementation:
 * - Weapon synchronization with base inventory (melee or firearms)
 * - Firearm pickups on map with limited ammunition & auto-fallback to melee
 * - Tactical mouse crosshair (turns red when hovering on enemies)
 * - Fog of war (darkness, explored memory, flashlight vision cone & radar reveal)
 * - Diverse procedural monsters (Slime, Creeper, Spitter with acid projectiles, Brute)
 * - 5-minute level countdown timer until catastrophic Samosbor event
 * - Extraction elevator zone requiring 5-second continuous hold
 * - Procedural Web Audio API sound synthesizer (RadarAudio)
 * - Death penalty: complete loss of un-evacuated loot, partial XP awarded
 * - Extraction victory: all loot secured + extraction bonus + full XP
 * - Interactive End-of-Raid CRT Summary Dialog
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

      // Radar & Time Limits
      this.radarAngle = 0;
      this.radarSpeed = 0.038;
      this.levelTimeLeft = 300.0; // 5:00 minutes (300 seconds)
      this.samosborActive = false;

      // Extraction 5-second hold zone
      this.evacHoldTimer = 0;
      this.evacHoldRequired = 5.0;
      this.isPlayerInElevator = false;
      this.lastBeepSecond = 5;

      // Level Grid & Fog of War (40x40)
      this.mapData = null;
      this.tileSize = 32;
      this.fogExplored = null;
      this.fogVisible = null;

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
        armor: 14,
        talonsEarned: 0,
        xpEarned: 0,
        monstersKilled: 0,
        collectedLoot: [],
        type: 'player',
        isPlayer: true,
        damageFlashTimer: 0,
        isDead: false,
        deathTick: 0,
        isShooting: false,
        shootProgress: 0,
        isSwinging: false,
        swingProgress: 0,
        // Equipped weapon from base inventory
        baseWeapon: { id: 'pipe', name: 'Тяжелая водопроводная труба', dmg: 28, isRanged: false, ammo: Infinity },
        weapon: null
      };

      // Camera Mode: TDS (Top-Down 2D) vs FPS (First-Person 3D Raycasting)
      this.cameraMode = 'TDS';
      this.isEvacuating = false;

      // Entities & World
      this.entities = [];
      this.projectiles = [];
      this.particles = [];
      this.crates = [];
      this.weaponDrops = [];
      this.doors = [];
      this.elevator = null;

      // Controls & Mouse
      this.keys = {};
      this.mouse = { x: 0, y: 0, worldX: 0, worldY: 0, isDown: false, isOverEnemy: false };
      this.isPointerLocked = false;
      this.currentRoomName = 'Жилая ячейка №556';
      this.lastAttackTime = 0;

      // CRT Collapse Animation
      this.isCollapsing = false;
      this.collapseProgress = 0;

      this.onExitCallback = null;
    }

    init(canvasElement, onExit) {
      this.canvas = canvasElement;
      this.ctx = canvasElement.getContext('2d');
      this.onExitCallback = onExit;

      // Enable custom tactical crosshair by hiding default cursor
      this.canvas.style.cursor = 'none';

      this.setupInputListeners();
      this.buildFloor();
      this.syncPlayerFromBase();
    }

    /**
     * Synchronize equipped gear from player's Living Cell profile
     */
    syncPlayerFromBase() {
      if (typeof clientMe !== 'undefined' && clientMe) {
        this.player.hp = clientMe.hp || 100;
        this.player.maxHp = clientMe.maxHp || 100;
        this.player.armor = (clientMe.stats && clientMe.stats.def) ? clientMe.stats.def : 14;

        // Check weapon equipped in base
        const eqW = (clientMe.equipped && clientMe.equipped.weapon) ? clientMe.equipped.weapon : null;
        if (eqW && typeof GAME_ITEMS !== 'undefined' && GAME_ITEMS[eqW]) {
          const item = GAME_ITEMS[eqW];
          const isGun = (item.subtype === 'ranged' || eqW.includes('gun') || eqW.includes('pistol') || eqW.includes('rifle') || eqW.includes('shotgun'));
          this.player.baseWeapon = {
            id: eqW,
            name: typeof getItemDisplayName === 'function' ? getItemDisplayName(item, eqW) : (item.name || eqW),
            dmg: item.dmg || 28,
            isRanged: isGun,
            ammo: isGun ? 24 : Infinity,
            maxAmmo: isGun ? 24 : Infinity,
            gunType: eqW.includes('shotgun') ? 'shotgun' : (eqW.includes('rifle') ? 'rifle' : 'pistol')
          };
        } else {
          this.player.baseWeapon = {
            id: 'pipe',
            name: 'Тяжелая водопроводная труба',
            dmg: 28,
            isRanged: false,
            ammo: Infinity,
            maxAmmo: Infinity
          };
        }
      } else {
        this.player.baseWeapon = {
          id: 'pipe',
          name: 'Водопроводная труба',
          dmg: 28,
          isRanged: false,
          ammo: Infinity
        };
      }

      // Initialize Tactical Belt (ПОЯС)
      const medkitsFromInv = this.countInventoryMedkits();
      this.player.belt = {
        activeSlot: 1,
        slot1: Object.assign({}, this.player.baseWeapon),
        slot2: this.getSecondaryWeaponFromBase(),
        medkits: Math.max(2, Math.min(5, medkitsFromInv)),
        maxMedkits: 5
      };

      // Start raid with active weapon from belt
      this.player.weapon = this.player.belt.slot1;
    }

    countInventoryMedkits() {
      let count = 0;
      if (typeof clientMe !== 'undefined' && clientMe) {
        if (Array.isArray(clientMe.inventory)) {
          for (const id of clientMe.inventory) {
            if (!id) continue;
            const it = (typeof GAME_ITEMS !== 'undefined') ? GAME_ITEMS[id] : null;
            if (id.includes('medkit') || id.includes('bandage') || id.includes('stim') || (it && it.type === 'heal')) {
              count++;
            }
          }
        }
        if (Array.isArray(clientMe.quickSlots)) {
          for (const id of clientMe.quickSlots) {
            if (!id) continue;
            const it = (typeof GAME_ITEMS !== 'undefined') ? GAME_ITEMS[id] : null;
            if (id.includes('medkit') || id.includes('bandage') || id.includes('stim') || (it && it.type === 'heal')) {
              count++;
            }
          }
        }
      }
      return Math.max(2, Math.min(5, count));
    }

    getSecondaryWeaponFromBase() {
      if (typeof clientMe !== 'undefined' && clientMe && Array.isArray(clientMe.inventory)) {
        const eqW = (clientMe.equipped && clientMe.equipped.weapon) ? clientMe.equipped.weapon : null;
        for (const id of clientMe.inventory) {
          if (!id || id === eqW) continue;
          const it = (typeof GAME_ITEMS !== 'undefined') ? GAME_ITEMS[id] : null;
          if (it && (it.subtype === 'ranged' || id.includes('gun') || id.includes('pistol') || id.includes('rifle') || id.includes('shotgun'))) {
            return {
              id: id,
              name: typeof getItemDisplayName === 'function' ? getItemDisplayName(it, id) : (it.name || id),
              dmg: it.dmg || 34,
              isRanged: true,
              ammo: 20,
              maxAmmo: 20,
              gunType: id.includes('shotgun') ? 'shotgun' : (id.includes('rifle') ? 'rifle' : 'pistol')
            };
          }
        }
      }
      return null;
    }

    switchBeltSlot(slotNum) {
      if (!this.player.belt) return;
      if (slotNum === 1) {
        if (!this.player.belt.slot1) return;
        this.player.belt.activeSlot = 1;
        this.player.weapon = this.player.belt.slot1;
        if (typeof RadarAudio !== 'undefined') RadarAudio.playWeaponSwitch();
        const wName = (this.player.weapon && this.player.weapon.name) ? String(this.player.weapon.name) : 'ОРУЖИЕ';
        this.spawnFloatingNotice(`[1] ${wName.toUpperCase()}`, '#88ff9e');
      } else if (slotNum === 2) {
        if (!this.player.belt.slot2) {
          this.spawnFloatingNotice('СЛОТ 2 [ПУСТО]', '#888888');
          if (typeof RadarAudio !== 'undefined') RadarAudio.playBuzzer();
          return;
        }
        this.player.belt.activeSlot = 2;
        this.player.weapon = this.player.belt.slot2;
        if (typeof RadarAudio !== 'undefined') RadarAudio.playWeaponSwitch();
        const wName = (this.player.weapon && this.player.weapon.name) ? String(this.player.weapon.name) : 'ОРУЖИЕ';
        this.spawnFloatingNotice(`[2] ${wName.toUpperCase()}`, '#33d4ff');
      }
    }

    useBeltMedkit() {
      // If near wounded NPC, heal them!
      const nearbyWounded = this.getNearbyWoundedNPC();
      if (nearbyWounded) {
        this.healWoundedNPC(nearbyWounded);
        return;
      }

      // Otherwise heal player
      if (!this.player.belt || this.player.belt.medkits <= 0) {
        this.spawnFloatingNotice('НЕТ АПТЕЧЕК НА ПОЯСЕ!', '#ff3b30');
        if (typeof RadarAudio !== 'undefined') RadarAudio.playBuzzer();
        return;
      }

      if (this.player.hp >= this.player.maxHp) {
        this.spawnFloatingNotice('ЗДОРОВЬЕ УЖЕ ПОЛНОЕ', '#88ff9e');
        return;
      }

      this.player.belt.medkits--;
      const healAmount = 45;
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + healAmount);
      if (typeof RadarAudio !== 'undefined') RadarAudio.playHeal();
      this.spawnFloatingNotice(`+${healAmount} HP [АПТЕЧКА С ПОЯСА]`, '#00ff66');

      for (let i = 0; i < 8; i++) {
        this.particles.push({
          x: this.player.x + (Math.random() - 0.5) * 16,
          y: this.player.y + (Math.random() - 0.5) * 16,
          vx: (Math.random() - 0.5) * 2,
          vy: -1.5 - Math.random() * 1.5,
          color: '#00ff66',
          alpha: 1.0,
          sz: 3
        });
      }
    }

    getNearbyWoundedNPC() {
      for (const e of this.entities) {
        if (e.type === 'liquidator' && e.isWounded) {
          if (Math.hypot(this.player.x - e.x, this.player.y - e.y) < 48) {
            return e;
          }
        }
      }
      return null;
    }

    takeWeaponFromNPC(npc) {
      if (!npc.hasWeapon || !npc.gun) {
        this.spawnFloatingNotice('У БОЙЦА НЕТ ОРУЖИЯ', '#888888');
        if (typeof RadarAudio !== 'undefined') RadarAudio.playBuzzer();
        return;
      }
      const takenGun = Object.assign({}, npc.gun);
      npc.hasWeapon = false;
      npc.gun = null;

      // Equip into secondary belt slot (or slot 1 if empty)
      this.player.belt.slot2 = takenGun;
      this.player.belt.activeSlot = 2;
      this.player.weapon = this.player.belt.slot2;

      if (typeof RadarAudio !== 'undefined') RadarAudio.playLootPickup();
      const gunTitle = (takenGun && takenGun.name) ? String(takenGun.name) : 'Огнестрел';
      this.spawnFloatingNotice(`⚡ ЗАБРАНО ОРУЖИЕ: ${gunTitle.toUpperCase()} [${takenGun.ammo || 20}]`, '#33d4ff');
    }

    healWoundedNPC(npc) {
      if (!this.player.belt || this.player.belt.medkits <= 0) {
        this.spawnFloatingNotice('НЕТ АПТЕЧЕК НА ПОЯСЕ! [НУЖНА АПТЕЧКА]', '#ff3b30');
        if (typeof RadarAudio !== 'undefined') RadarAudio.playBuzzer();
        return;
      }

      this.player.belt.medkits--;
      npc.hp = npc.maxHp;
      npc.isWounded = false;
      npc.isLoyalFollower = true;
      this.player.talonsEarned += 30;
      this.player.xpEarned += 45;

      if (typeof RadarAudio !== 'undefined') RadarAudio.playHeal();
      this.spawnFloatingNotice(`💚 БОЕЦ СПАСЕН! ТЕПЕРЬ ОН ПРИКРЫВАЕТ ВАС! (+45 XP, +30 ТАЛОНОВ)`, '#00ff66');

      for (let i = 0; i < 12; i++) {
        this.particles.push({
          x: npc.x + (Math.random() - 0.5) * 20,
          y: npc.y + (Math.random() - 0.5) * 20,
          vx: (Math.random() - 0.5) * 2,
          vy: -1.5 - Math.random() * 2,
          color: '#00ff66',
          alpha: 1.0,
          sz: 3
        });
      }
    }

    buildFloor() {
      const pLvl = (typeof clientMe !== 'undefined' && clientMe && clientMe.level) ? clientMe.level : (this.player.level || 1);
      this.player.level = pLvl;

      if (typeof LevelGen !== 'undefined') {
        this.mapData = LevelGen.generate(pLvl);
      } else {
        return;
      }

      const W = this.mapData.width;
      const H = this.mapData.height;
      this.tileSize = this.mapData.tileSize || 32;

      // Initialize Fog of War
      this.fogExplored = Array(H).fill(null).map(() => new Uint8Array(W));
      this.fogVisible = Array(H).fill(null).map(() => new Uint8Array(W));

      // Reset Timers
      this.levelTimeLeft = 300.0;
      this.samosborActive = false;
      this.evacHoldTimer = 0;
      this.lastBeepSecond = 5;

      // Position Player
      this.player.x = this.mapData.playerSpawn.x;
      this.player.y = this.mapData.playerSpawn.y;
      this.player.vx = 0;
      this.player.vy = 0;
      this.player.hp = this.player.maxHp;
      this.player.talonsEarned = 0;
      this.player.xpEarned = 0;
      this.player.isDead = false;
      this.player.deathTick = 0;
      this.player.isShooting = false;
      this.player.shootProgress = 0;
      this.player.isSwinging = false;
      this.player.swingProgress = 0;
      this.isCollapsing = false;
      this.collapseProgress = 0;

      this.crates = this.mapData.lootCrates || [];
      this.weaponDrops = this.mapData.weaponDrops || [];
      this.doors = this.mapData.doors || [];
      this.elevator = this.mapData.elevator || { x: 500, y: 500, w: 64, h: 64 };
      this.lamps = this.mapData.lamps || [];

      // Initialize Entities (Dynamic Bestiary Scaled to Player Level)
      this.entities = [];
      const mutants = this.mapData.mutants || this.mapData.mutantSpawns || [];
      mutants.forEach((m, idx) => {
        this.entities.push(Object.assign({
          id: `mutant_${idx}`,
          type: 'monster',
          name: m.name || 'Мутант',
          homeX: m.x,
          homeY: m.y,
          radius: m.radius || 13,
          angle: Math.random() * Math.PI * 2,
          vx: 0,
          vy: 0,
          speed: m.speed || 1.6,
          hp: m.hp || 50,
          maxHp: m.maxHp || 50,
          dmg: m.dmg || 18,
          behavior: m.behavior || 'wander_skitter',
          color: m.color || '#ff3b30',
          state: 'IDLE_WANDER',
          stateTimer: Math.random() * 60,
          wanderTarget: { x: m.x, y: m.y },
          damageFlashTimer: 0,
          phosphorAlpha: 0.1,
          lastAttackTime: 0,
          lastSpitTime: 0,
          leapCooldown: 0,
          isMimicDisguised: m.behavior === 'radar_disguise'
        }, m));
      });

      // Patrol Liquidators (Allies)
      const allies = this.mapData.allies || this.mapData.patrolSpawns || [];
      allies.forEach((p, idx) => {
        this.entities.push(Object.assign({
          id: `patrol_${idx}`,
          type: 'liquidator',
          name: p.name || `Ликвидатор [Патруль ${idx + 1}]`,
          homeX: p.x,
          homeY: p.y,
          radius: 13,
          angle: 0,
          vx: 0,
          vy: 0,
          speed: 1.8,
          hp: p.hp || 140,
          maxHp: p.maxHp || 140,
          isWounded: false,
          hasWeapon: true,
          gun: { id: 'pm_gun', name: 'Пистолет Макарова', dmg: 28, ammo: 30, maxAmmo: 30, isRanged: true, gunType: 'pistol' },
          isLoyalFollower: false,
          attackCooldown: 10,
          state: 'PATROL',
          stateTimer: 0,
          wanderTarget: { x: p.x, y: p.y },
          damageFlashTimer: 0,
          phosphorAlpha: 1.0
        }, p));
      });
    }

    setupInputListeners() {
      window.addEventListener('keydown', (e) => {
        if (!this.isRunning) return;
        this.keys[e.code] = true;
        this.keys[e.key.toLowerCase()] = true;

        if (e.code === 'Digit1') {
          const nearbyWounded = this.getNearbyWoundedNPC();
          if (nearbyWounded && nearbyWounded.hasWeapon) {
            this.takeWeaponFromNPC(nearbyWounded);
          } else {
            this.switchBeltSlot(1);
          }
        }
        if (e.code === 'Digit2') {
          const nearbyWounded = this.getNearbyWoundedNPC();
          if (nearbyWounded && this.player.belt && this.player.belt.medkits > 0) {
            this.healWoundedNPC(nearbyWounded);
          } else {
            this.switchBeltSlot(2);
          }
        }
        if (e.code === 'Digit3' || e.code === 'KeyQ') {
          this.useBeltMedkit();
        }

        if (this.player.isDead || this.player.hp <= 0) {
          if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape' || e.code === 'KeyE') {
            if (typeof handleRadarFleeCell === 'function') {
              handleRadarFleeCell();
            } else {
              this.finishRaid(false);
            }
            return;
          }
        }

        if (e.code === 'Escape') {
          if (typeof confirmExitRadarRaid === 'function') {
            confirmExitRadarRaid();
          } else {
            this.exitToCell();
          }
        }
        if (e.code === 'KeyE' || e.code === 'Space') {
          this.interactNearby();
        }
        if (e.code === 'KeyG') {
          if (this.cameraMode === 'TDS') {
            this.cameraMode = 'FPS';
            try { this.canvas.requestPointerLock(); } catch(err){}
            this.spawnFloatingNotice('📷 КАМЕРА: [FPS 3D]', '#00ffaa');
          } else {
            this.cameraMode = 'TDS';
            if (document.pointerLockElement === this.canvas) {
              try { document.exitPointerLock(); } catch(err){}
            }
            this.spawnFloatingNotice('📷 КАМЕРА: [TDS 2D]', '#00ffaa');
          }
        }
        if (e.code === 'F2') {
          if (typeof AsciiRenderer !== 'undefined') {
            AsciiRenderer.enabled = !AsciiRenderer.enabled;
            this.spawnFloatingNotice(`ANSI ШЕЙДЕР: ${AsciiRenderer.enabled ? 'ВКЛ' : 'ВЫКЛ'}`, '#1fe044');
          }
        }
      });

      document.addEventListener('pointerlockchange', () => {
        this.isPointerLocked = (document.pointerLockElement === this.canvas);
      });

      window.addEventListener('keyup', (e) => {
        if (!this.isRunning) return;
        this.keys[e.code] = false;
        this.keys[e.key.toLowerCase()] = false;
      });

      if (this.canvas) {
        this.canvas.addEventListener('click', () => {
          if (this.cameraMode === 'FPS' && !this.isPointerLocked && !this.player.isDead) {
            try { this.canvas.requestPointerLock(); } catch(err){}
          }
        });

        this.canvas.addEventListener('mousemove', (e) => {
          if (!this.isRunning) return;
          const rect = this.canvas.getBoundingClientRect();
          this.mouse.x = e.clientX - rect.left;
          this.mouse.y = e.clientY - rect.top;

          const cam = this.getCameraOffset();
          this.mouse.worldX = this.mouse.x + cam.x;
          this.mouse.worldY = this.mouse.y + cam.y;

          if (this.cameraMode === 'FPS') {
            if (this.isPointerLocked) {
              this.player.angle += (e.movementX || 0) * 0.0028;
            } else {
              if (e.movementX !== undefined && Math.abs(e.movementX) < 120) {
                this.player.angle += e.movementX * 0.0035;
              } else {
                const midX = this.canvas.width / 2;
                this.player.angle += (this.mouse.x - midX) * 0.00015;
              }
            }
            // Keep crosshair anchored in FPS mode
            this.mouse.x = this.canvas.width / 2;
            this.mouse.y = this.canvas.height / 2;
          } else {
            this.player.angle = Math.atan2(this.mouse.worldY - this.player.y, this.mouse.worldX - this.player.x);
          }

          // Check if hovering over any hostile monster
          this.mouse.isOverEnemy = this.entities.some(ent => {
            if (ent.type === 'liquidator') return false;
            return Math.hypot(ent.x - this.mouse.worldX, ent.y - this.mouse.worldY) < ent.radius + 12;
          });
        });

        this.canvas.addEventListener('mousedown', (e) => {
          if (!this.isRunning) return;
          if (this.player.isDead || this.player.hp <= 0) {
            if (typeof handleRadarFleeCell === 'function') {
              handleRadarFleeCell();
            } else {
              this.finishRaid(false);
            }
            return;
          }
          if (e.button === 0) {
            // Check door interaction first
            if (this.cameraMode === 'FPS') {
              if (!this.isPointerLocked) {
                try { this.canvas.requestPointerLock(); } catch(err){}
              }
              const frontDoor = this.getDoorInFront(68);
              if (frontDoor) {
                this.toggleDoor(frontDoor);
                return;
              }
            } else {
              const clickedDoor = this.doors.find(d => Math.hypot(this.mouse.worldX - (d.x + 16), this.mouse.worldY - (d.y + 16)) < 28);
              if (clickedDoor && Math.hypot(this.player.x - (clickedDoor.x + 16), this.player.y - (clickedDoor.y + 16)) < 65) {
                this.toggleDoor(clickedDoor);
                return;
              }
            }
            this.mouse.isDown = true;
            this.handlePlayerAttack();
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

    loop(timestamp) {
      if (!this.isRunning) return;
      this.tick++;

      try {
        this.update(timestamp);
        this.render();
      } catch (error) {
        console.error("Non-fatal loop error:", error);
      }

      if (this.isRunning) {
        this.animFrameId = requestAnimationFrame(this.loop.bind(this));
      }
    }

    /**
     * Player Attack: Melee Swing vs Firearm Shooting
     */
    handlePlayerAttack() {
      if (this.player.isDead) return;
      const now = Date.now();
      const weapon = this.player.weapon;

      if (!weapon) return;

      if (!weapon.isRanged) {
        // MELEE ATTACK (Slash arc in 48px cone)
        if (now - this.lastAttackTime < 320) return;
        this.lastAttackTime = now;

        this.player.isSwinging = true;
        this.player.swingProgress = 0;

        // Procedural Melee Audio
        if (typeof RadarAudio !== 'undefined') {
          RadarAudio.playMeleeSwing();
        }

        // Damage all monsters in forward cone
        const swingRange = 52;
        const pAng = this.player.angle;
        let hitAny = false;

        for (const e of this.entities) {
          if (e.type === 'liquidator') continue; // Do not hit allies
          const dist = Math.hypot(e.x - this.player.x, e.y - this.player.y);
          if (dist <= swingRange + e.radius) {
            const angToE = Math.atan2(e.y - this.player.y, e.x - this.player.x);
            let diff = Math.abs(angToE - pAng);
            if (diff > Math.PI) diff = Math.PI * 2 - diff;

            if (diff < 1.1) { // 65 degree cone
              e.hp -= weapon.dmg || 28;
              e.damageFlashTimer = 10;
              hitAny = true;

              // Knockback
              e.x += Math.cos(angToE) * 16;
              e.y += Math.sin(angToE) * 16;
              this.spawnHitParticles(e.x, e.y, '#ff3b30', 8);

              if (typeof RadarAudio !== 'undefined') {
                RadarAudio.playMeleeHit();
                RadarAudio.playMonsterHurt();
              }

              if (e.hp <= 0) {
                this.killMonster(e);
              }
            }
          }
        }
      } else {
        // FIREARM RANGED ATTACK
        if (now - this.lastAttackTime < 200) return;
        this.lastAttackTime = now;

        if (weapon.ammo <= 0) {
          // Empty click! Switch back to melee weapon
          this.spawnFloatingNotice('ПАТРОНЫ ИСЧЕРПАНЫ! ДОСТАЮ БЛИЖНИЙ БОЙ', '#ffaa00');
          this.player.weapon = Object.assign({}, this.player.baseWeapon);
          if (typeof RadarAudio !== 'undefined') RadarAudio.playMeleeHit();
          return;
        }

        weapon.ammo--;
        this.player.isShooting = true;
        this.player.shootProgress = 0;

        // Procedural Gunshot Audio
        if (typeof RadarAudio !== 'undefined') {
          RadarAudio.playGunshot(weapon.gunType || 'pistol');
        }

        const isShotgun = (weapon.gunType === 'shotgun');
        const pellets = isShotgun ? 4 : 1;
        const speed = isShotgun ? 13 : 15;

        for (let i = 0; i < pellets; i++) {
          const spread = (Math.random() - 0.5) * (isShotgun ? 0.28 : 0.06);
          const shotAngle = this.player.angle + spread;

          this.projectiles.push({
            x: this.player.x + Math.cos(shotAngle) * 18,
            y: this.player.y + Math.sin(shotAngle) * 18,
            vx: Math.cos(shotAngle) * speed,
            vy: Math.sin(shotAngle) * speed,
            damage: isShotgun ? 22 : (weapon.dmg || 32),
            isPlayer: true,
            life: isShotgun ? 35 : 55,
            color: '#88ff9e'
          });
        }

        // Gunshot noise aggros nearby mutants in 360px
        for (const e of this.entities) {
          if (e.type !== 'liquidator') {
            if (Math.hypot(e.x - this.player.x, e.y - this.player.y) < 360) {
              e.state = 'CHASE';
              e.stateTimer = 200;
            }
          }
        }

        // If ammo ran out on this shot, notify fallback
        if (weapon.ammo <= 0) {
          setTimeout(() => {
            if (this.player.weapon === weapon && weapon.ammo <= 0) {
              this.spawnFloatingNotice('ПАТРОНЫ КОНЧИЛИСЬ! БЛИЖНИЙ БОЙ НАГОТОВЕ', '#ffaa00');
              this.player.weapon = Object.assign({}, this.player.baseWeapon);
            }
          }, 350);
        }
      }
    }

    killMonster(monster) {
      const idx = this.entities.indexOf(monster);
      if (idx !== -1) {
        this.entities.splice(idx, 1);
        this.player.monstersKilled = (this.player.monstersKilled || 0) + 1;
        const cost = monster.cost || 2;
        const bounty = 10 + cost * 4;
        const xp = 15 + cost * 5;
        this.player.talonsEarned += bounty;
        this.player.xpEarned += xp;
        this.spawnFloatingNotice(`+${bounty} ТАЛОНОВ, +${xp} XP`, '#ffd700');

        // Slime split on death
        if (monster.behavior === 'slime_split' && typeof Progression !== 'undefined' && Progression.createSlimeChildren) {
          const children = Progression.createSlimeChildren(monster);
          for (const child of children) {
            this.entities.push(child);
            this.spawnHitParticles(child.x, child.y, '#33cc55', 6);
          }
        }
      }
    }

    interactNearby() {
      // 0. Nearby Wounded Liquidator
      const nearbyWounded = this.getNearbyWoundedNPC();
      if (nearbyWounded) {
        if (this.player.belt && this.player.belt.medkits > 0) {
          this.healWoundedNPC(nearbyWounded);
        } else if (nearbyWounded.hasWeapon) {
          this.takeWeaponFromNPC(nearbyWounded);
        } else {
          this.spawnFloatingNotice('БОЕЦ БЕЗОРУЖЕН И ТРЕБУЕТ АПТЕЧКУ С ПОЯСА!', '#ffaa00');
        }
        return;
      }

      // 1. Doors (front direction priority in FPS, radial check in TDS)
      const frontDoor = this.getDoorInFront(68);
      if (frontDoor) {
        this.toggleDoor(frontDoor);
        return;
      }
      for (const d of this.doors) {
        if (Math.hypot(this.player.x - (d.x + 16), this.player.y - (d.y + 16)) < 55) {
          this.toggleDoor(d);
          return;
        }
      }

      // 2. Weapon drops
      for (const drop of this.weaponDrops) {
        if (!drop.pickedUp && Math.hypot(this.player.x - drop.x, this.player.y - drop.y) < 38) {
          this.pickupWeapon(drop);
          return;
        }
      }

      // 3. Loot crates
      for (const crate of this.crates) {
        if (!crate.opened && Math.hypot(this.player.x - crate.x, this.player.y - crate.y) < 40) {
          this.openCrate(crate);
          return;
        }
      }
    }

    getDoorInFront(maxDist = 68) {
      const TS = this.tileSize;
      const cos = Math.cos(this.player.angle);
      const sin = Math.sin(this.player.angle);
      for (let dist = 12; dist <= maxDist; dist += 8) {
        const checkX = this.player.x + cos * dist;
        const checkY = this.player.y + sin * dist;
        const tx = Math.floor(checkX / TS);
        const ty = Math.floor(checkY / TS);
        const door = this.doors.find(d => d.tileX === tx && d.tileY === ty);
        if (door) return door;
      }
      return null;
    }

    toggleDoor(d) {
      if (!d) return;
      d.isOpen = !d.isOpen;
      if (typeof RadarAudio !== 'undefined' && RadarAudio.playDoorToggle) {
        RadarAudio.playDoorToggle(d.isOpen);
      }
      this.spawnFloatingNotice(d.isOpen ? 'ГЕРМОДВЕРЬ ОТКРЫТА' : 'ГЕРМОДВЕРЬ ЗАКРЫТА', '#ffaa00');
    }

    pickupWeapon(drop) {
      if (!drop) return;
      if (drop.pickedUp) return;
      const weapon = drop.weapon || drop;
      if (!weapon) return;

      const type = (weapon.type || weapon.id || weapon.gunId || weapon.name || '').toUpperCase();
      if (!type) return;
      drop.pickedUp = true;

      const gName = weapon.name || weapon.title || type || 'Огнестрельное оружие';
      const gAmmo = (weapon.ammo !== undefined) ? weapon.ammo : (drop.ammo || 20);
      const gMaxAmmo = (weapon.maxAmmo !== undefined) ? weapon.maxAmmo : (drop.maxAmmo || 20);
      const gDmg = weapon.dmg || drop.dmg || 34;
      const gType = weapon.gunType || drop.gunType || 'rifle';
      const gId = type || 'GUN';

      const newGun = {
        id: gId,
        name: gName,
        dmg: gDmg,
        isRanged: true,
        ammo: gAmmo,
        maxAmmo: gMaxAmmo,
        gunType: gType
      };

      if (this.player.belt) {
        this.player.belt.slot2 = newGun;
        this.player.belt.activeSlot = 2;
        this.player.weapon = this.player.belt.slot2;
      } else {
        this.player.weapon = newGun;
      }

      // Add dropped firearm to collected loot for evacuation
      if (!this.player.collectedLoot) this.player.collectedLoot = [];
      const invWeaponId = gType === 'pistol' ? 'weapon_pistol' : (gType === 'shotgun' ? 'weapon_shotgun' : 'weapon_crowbar');
      this.player.collectedLoot.push(invWeaponId);

      if (typeof RadarAudio !== 'undefined') RadarAudio.playLootPickup();
      const displayName = String(gName).toUpperCase();
      this.spawnFloatingNotice(`⚡ ПОДОБРАН В СЛОТ 2: ${displayName} [${gAmmo}]`, '#33d4ff');
    }

    pickWeapon(weapon) {
      if (!weapon) return;
      const type = (weapon.type || weapon.id || weapon.name || '').toUpperCase();
      if (!type) return;
      return this.pickupWeapon(weapon);
    }

    openCrate(crate) {
      crate.opened = true;
      if (typeof RadarAudio !== 'undefined') RadarAudio.playLootPickup();

      if (!this.player.collectedLoot) this.player.collectedLoot = [];

      if (crate.type === 'ammo') {
        if (this.player.weapon && this.player.weapon.isRanged) {
          this.player.weapon.ammo += crate.amount || 18;
          this.spawnFloatingNotice(`+${crate.amount || 18} ПАТРОНОВ`, '#33d4ff');
        } else {
          this.spawnFloatingNotice('ПАТРОНЫ [НУЖНО ОГНЕСТРЕЛЬНОЕ ОРУЖИЕ]', '#888888');
        }
        this.player.collectedLoot.push('special_knife');
      } else {
        const bonusTalons = crate.amount || 30;
        const bonusXp = 20;
        this.player.talonsEarned += bonusTalons;
        this.player.xpEarned += bonusXp;
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 25);

        const lootPool = ['mat_scrap', 'mat_tape', 'mat_chem', 'food_ration', 'food_medkit', 'mat_electro'];
        const rolledItem = lootPool[Math.floor(Math.random() * lootPool.length)];
        this.player.collectedLoot.push(rolledItem);

        if (this.player.belt && this.player.belt.medkits < this.player.belt.maxMedkits) {
          this.player.belt.medkits++;
          this.spawnFloatingNotice(`+${bonusTalons} ТАЛОНОВ, +25 HP, +1 АПТЕЧКА, +ХАБАР`, '#f5a623');
        } else {
          this.spawnFloatingNotice(`+${bonusTalons} ТАЛОНОВ, +25 HP, +ХАБАР`, '#f5a623');
        }
      }
    }

    spawnFloatingNotice(text, color = '#1fe044') {
      this.particles.push({
        x: this.player.x - 35,
        y: this.player.y - 28,
        vx: 0,
        vy: -0.65,
        text: text,
        color: color,
        alpha: 1.0,
        isText: true
      });
    }

    /**
     * Simulation Update
     */
    update() {
      if (this.isCollapsing) {
        this.collapseProgress += 0.04;
        return;
      }

      // 1. Level 5-minute Timer
      this.levelTimeLeft = Math.max(0, this.levelTimeLeft - (1 / 60));
      if (this.levelTimeLeft <= 0 && !this.samosborActive) {
        this.samosborActive = true;
        if (typeof RadarAudio !== 'undefined') RadarAudio.playSamosborAlarm();
        this.spawnFloatingNotice('ВНИМАНИЕ! САМОСБОР ПРОРВАЛ СЕКТОР!', '#ff0033');
      }

      // 1b. Airtight Blast Door Smooth Slide Animations
      if (this.doors) {
        for (let di = 0; di < this.doors.length; di++) {
          const d = this.doors[di];
          if (d.openProgress === undefined) d.openProgress = d.isOpen ? 1.0 : 0.0;
          const target = d.isOpen ? 1.0 : 0.0;
          if (d.openProgress !== target) {
            const step = 0.08;
            if (d.openProgress < target) d.openProgress = Math.min(target, d.openProgress + step);
            else d.openProgress = Math.max(target, d.openProgress - step);

            // Synchronize grid matrix state (2 = closed/closing, 3 = fully open)
            if (this.mapData && this.mapData.grid && this.mapData.grid[d.tileY]) {
              this.mapData.grid[d.tileY][d.tileX] = (d.openProgress >= 0.95) ? 3 : 2;
            }
          }
        }
      }

      if (this.samosborActive && this.tick % 60 === 0) {
        this.damagePlayer(12, 'САМОСБОР');
      }

      // Check combat state to switch dynamic battle music vs ambient exploration
      if (this.tick % 30 === 0 && typeof playRaidMusic === 'function') {
        const hasCombat = this.entities.some(e => e.type === 'monster' && e.hp > 0 && (e.state === 'CHASE' || Math.hypot(e.x - this.player.x, e.y - this.player.y) < 240));
        playRaidMusic(hasCombat ? 'combat' : 'explore');
      }

      // 2. Radar Sweep Angle Rotation
      this.radarAngle += this.radarSpeed;
      if (this.radarAngle >= Math.PI * 2) this.radarAngle -= Math.PI * 2;

      // 3. Attack animation decays
      if (this.player.isSwinging) {
        this.player.swingProgress += 0.16;
        if (this.player.swingProgress >= 1.0) {
          this.player.isSwinging = false;
        }
      }
      if (this.player.isShooting) {
        this.player.shootProgress += 0.25;
        if (this.player.shootProgress >= 1.0) {
          this.player.isShooting = false;
        }
      }

      // 4. Player Input Movement & Inertia (only if alive)
      let moveX = 0, moveY = 0;
      if (!this.player.isDead) {
        if (this.cameraMode === 'FPS') {
          const cos = Math.cos(this.player.angle);
          const sin = Math.sin(this.player.angle);
          let fwd = 0;
          let strafe = 0;
          if (this.keys['KeyW'] || this.keys['ArrowUp'] || this.keys['w']) fwd += 1;
          if (this.keys['KeyS'] || this.keys['ArrowDown'] || this.keys['s']) fwd -= 1;
          if (this.keys['KeyA'] || this.keys['ArrowLeft'] || this.keys['a']) strafe -= 1;
          if (this.keys['KeyD'] || this.keys['ArrowRight'] || this.keys['d']) strafe += 1;

          moveX = fwd * cos - strafe * sin;
          moveY = fwd * sin + strafe * cos;
        } else {
          if (this.keys['KeyW'] || this.keys['ArrowUp'] || this.keys['w']) moveY -= 1;
          if (this.keys['KeyS'] || this.keys['ArrowDown'] || this.keys['s']) moveY += 1;
          if (this.keys['KeyA'] || this.keys['ArrowLeft'] || this.keys['a']) moveX -= 1;
          if (this.keys['KeyD'] || this.keys['ArrowRight'] || this.keys['d']) moveX += 1;
        }
      }

      if (moveX !== 0 && moveY !== 0) {
        moveX *= 0.7071;
        moveY *= 0.7071;
      }

      const accel = 0.45;
      const friction = 0.82;
      this.player.vx = (this.player.vx + moveX * accel * this.player.speed) * friction;
      this.player.vy = (this.player.vy + moveY * accel * this.player.speed) * friction;

      const nextX = this.player.x + this.player.vx;
      const nextY = this.player.y + this.player.vy;

      if (!this.isTileSolid(nextX, this.player.y, this.player.radius)) this.player.x = nextX;
      else this.player.vx = 0;

      if (!this.isTileSolid(this.player.x, nextY, this.player.radius)) this.player.y = nextY;
      else this.player.vy = 0;

      // 5. Update Fog of War
      this.updateFogOfWar();

      // 6. Extraction Elevator Zone (5-Second Continuous Hold)
      this.updateElevatorExtraction();

      // Proximity auto-pickup for weapons and loot
      for (const drop of this.weaponDrops) {
        if (!drop.pickedUp && Math.hypot(this.player.x - drop.x, this.player.y - drop.y) < 22) {
          this.pickupWeapon(drop);
        }
      }
      for (const crate of this.crates) {
        if (!crate.opened && Math.hypot(this.player.x - crate.x, this.player.y - crate.y) < 22) {
          this.openCrate(crate);
        }
      }

      if (this.player.damageFlashTimer > 0) this.player.damageFlashTimer--;

      // 7. Update Entities
      this.updateEntities();

      // 8. Update Projectiles
      this.updateProjectiles();

      // 9. Update Particles
      this.updateParticles();

      // 10. Check Player Death
      if (this.player.hp <= 0 && !this.player.isDead) {
        this.player.isDead = true;
        this.player.deathTick = 0;
        this.isCollapsing = false;
        if (typeof RadarAudio !== 'undefined') RadarAudio.playPlayerHurt();
        this.showDeathPrompt();
      }
      if (this.player.isDead) {
        this.player.deathTick = (this.player.deathTick || 0) + 1;
      }
    }

    /**
     * Show Death Modal Overlay: [ 🏃 БЕЖАТЬ В ЖИЛ-ЯЧЕЙКУ ]
     */
    showDeathPrompt() {
      const deathOverlay = document.getElementById('radar-death-overlay');
      if (deathOverlay) {
        deathOverlay.style.display = 'flex';
        const fleeBtn = document.getElementById('btn-radar-flee-cell');
        if (fleeBtn) fleeBtn.focus();
      } else {
        setTimeout(() => this.finishRaid(false), 1600);
      }
    }

    /**
     * 5-Second Extraction Zone Hold
     */
    updateElevatorExtraction() {
      if (!this.elevator) return;
      const elevCenterX = this.elevator.x + 16;
      const elevCenterY = this.elevator.y + 16;
      const dist = Math.hypot(this.player.x - elevCenterX, this.player.y - elevCenterY);

      if (dist < 46) {
        this.isPlayerInElevator = true;
        this.evacHoldTimer = Math.min(this.evacHoldRequired, this.evacHoldTimer + (1 / 60));

        const secondsLeft = Math.ceil(this.evacHoldRequired - this.evacHoldTimer);
        if (secondsLeft !== this.lastBeepSecond && secondsLeft > 0) {
          this.lastBeepSecond = secondsLeft;
          if (typeof RadarAudio !== 'undefined') RadarAudio.playCountdownBeep(secondsLeft <= 2);
        }

        if (this.evacHoldTimer >= this.evacHoldRequired) {
          this.evacuateSuccess();
        }
      } else {
        this.isPlayerInElevator = false;
        this.evacHoldTimer = 0;
        this.lastBeepSecond = 5;
      }
    }

    evacuateSuccess() {
      if (this.isEvacuating) return;
      this.isEvacuating = true;
      this.isCollapsing = true;
      if (typeof RadarAudio !== 'undefined') RadarAudio.playLootPickup();
      this.spawnFloatingNotice('🏆 ЭВАКУАЦИЯ УСПЕШНА! ВЫХОД В ЖИЛЯЧЕЙКУ...', '#ffd700');
      setTimeout(() => this.finishRaid(true), 1100);
    }

    /**
     * End of Raid: Death vs Evacuation
     */
    finishRaid(won) {
      try {
        this.stop();
        if (typeof stopRaidMusic === 'function') {
          stopRaidMusic();
        }

        const earnedXP = won ? (this.player.xpEarned + 60) : Math.floor(this.player.xpEarned * 0.4);
        const earnedTalons = won ? (this.player.talonsEarned + 100) : 0; // If dead, all loot is lost!
        const lootItems = (won && Array.isArray(this.player.collectedLoot)) ? [...this.player.collectedLoot] : [];
        const kills = this.player.monstersKilled || 0;

        // Credit rewards immediately to local player profile
        if (typeof clientMe !== 'undefined' && clientMe) {
          clientMe.xp = (clientMe.xp || 0) + earnedXP;
          if (won) {
            clientMe.hp = clientMe.maxHp || 100;
            if (clientMe.stats) clientMe.stats.hp = clientMe.stats.maxHp || 100;
            clientMe.talons = (clientMe.talons || 0) + earnedTalons;
            clientMe.roomsCleared = (clientMe.roomsCleared || 0) + 1;
            if (lootItems.length > 0) {
              if (!clientMe.inventory) clientMe.inventory = [];
              for (const lItem of lootItems) {
                if (clientMe.inventory.length < 12) {
                  clientMe.inventory.push(lItem);
                }
              }
            }
          } else {
            clientMe.hp = 0;
            if (clientMe.stats) clientMe.stats.hp = 0;
          }
          clientMe.monstersKilled = (clientMe.monstersKilled || 0) + kills;

          // Check level up
          while (clientMe.xp >= (clientMe.level || 1) * 100) {
            clientMe.xp -= (clientMe.level || 1) * 100;
            clientMe.level = (clientMe.level || 1) + 1;
            if (clientMe.stats) clientMe.stats.maxHp = (clientMe.stats.maxHp || 100) + 10;
            if (won) {
              clientMe.hp = clientMe.stats.maxHp;
              if (clientMe.stats) clientMe.stats.hp = clientMe.stats.maxHp;
            }
          }
        }

        // Notify server to persistently save in database & broadcast
        if (typeof socket !== 'undefined' && socket && socket.connected) {
          try {
            socket.emit('radarRaidComplete', {
              won: won,
              talons: earnedTalons,
              xp: earnedXP,
              kills: kills,
              lootItems: lootItems
            });
          } catch (e) {
            console.error('[RadarRoguelike] Failed emitting radarRaidComplete:', e);
          }
        }

        // Hide death overlay
        const deathOverlay = document.getElementById('radar-death-overlay');
        if (deathOverlay) deathOverlay.style.display = 'none';

        // Return immediately to living cell (hub-screen)
        if (typeof closeRadarRoguelikeModal === 'function') {
          closeRadarRoguelikeModal();
        }

        // Update hub UI to display credited XP, talons, and inventory
        if (typeof updateUI === 'function' && typeof clientMe !== 'undefined' && clientMe) {
          updateUI(clientMe, window.sectorPlayers || []);
        }

        // Show prominent status message on hub screen
        const hubNotice = document.getElementById('hub-error');
        if (hubNotice) {
          if (won) {
            hubNotice.style.color = '#1fe044';
            hubNotice.innerHTML = `🏆 ЭВАКУАЦИЯ УСПЕШНА! Зачислено: <b style="color:#ffd700;">+${earnedTalons}</b> талонов, <b style="color:#1fe044;">+${earnedXP} XP</b>${lootItems.length ? `, хабар: +${lootItems.length} предм.` : ''}!`;
          } else {
            hubNotice.style.color = '#ff3b30';
            hubNotice.innerHTML = `☠️ ЛИКВИДАТОР ЭВАКУИРОВАН! Талоны потеряны. Спасено опыта: <b style="color:#1fe044;">+${earnedXP} XP</b>.`;
          }
          hubNotice.style.display = 'block';
          setTimeout(() => { if (hubNotice.style.color === 'rgb(31, 224, 68)' || hubNotice.style.color === 'rgb(255, 59, 48)') hubNotice.style.display = 'none'; }, 7000);
        }

        if (won && typeof playSound === 'function') {
          playSound('victory');
        }
      } catch (err) {
        console.error('[RadarRoguelike] finishRaid error:', err);
        if (typeof closeRadarRoguelikeModal === 'function') {
          closeRadarRoguelikeModal();
        }
      }
    }

    showRaidSummaryModal(won, talons, xp) {
      let modal = document.getElementById('raid-summary-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'raid-summary-modal';
        modal.className = 'modal-overlay';
        document.body.appendChild(modal);
      }
      modal.style.position = 'fixed';
      modal.style.inset = '0';
      modal.style.zIndex = '100050';
      modal.style.background = 'rgba(0, 8, 4, 0.94)';
      modal.style.display = 'flex';
      modal.style.justifyContent = 'center';
      modal.style.alignItems = 'center';

      const headerColor = won ? '#1fe044' : '#ff3b30';
      const title = won ? '🏆 УСПЕШНАЯ ЭВАКУАЦИЯ В ЖИЛЯЧЕЙКУ!' : '☠️ ВЫЛАЗКА ПРОВАЛЕНА // ЛИКВИДАТОР ПОГИБ';
      const desc = won
        ? `Вы благополучно добрались до шахты лифта и вынесли все найденные трофеи.`
        : `Биометрия утеряна в глубинах сектора. Все собранные за рейд талоны и найденный хабар безвозвратно утеряны.`;

      modal.innerHTML = `
        <div style="background: rgba(4, 20, 7, 0.96); border: 2px solid ${headerColor}; padding: 24px; max-width: 480px; width: 90%; text-align: center; font-family: 'Share Tech Mono', monospace; box-shadow: 0 0 25px ${headerColor};">
          <div style="font-size: 20px; font-weight: bold; color: ${headerColor}; letter-spacing: 2px; margin-bottom: 12px; text-shadow: 0 0 10px ${headerColor};">${title}</div>
          <div style="font-size: 13px; color: #ddd; line-height: 1.5; margin-bottom: 16px;">${desc}</div>
          <div style="background: rgba(0, 0, 0, 0.6); border: 1px dashed ${headerColor}; padding: 12px; margin-bottom: 18px; font-size: 14px;">
            <div style="color: ${won ? '#ffd700' : '#888'}; margin-bottom: 6px;">ТАЛОНЫ: ${won ? `+${talons}` : 'ПОТЕРЯНЫ (0)'}</div>
            <div style="color: #1fe044;">ОПЫТ (XP): +${xp}</div>
          </div>
          <button id="btn-return-living-cell" style="width: 100%; padding: 14px; font-family: inherit; font-size: 15px; font-weight: bold; letter-spacing: 1.5px; background: rgba(31,224,68,0.22); border: 2px solid #1fe044; color: #1fe044; cursor: pointer; box-shadow: 0 0 15px rgba(31,224,68,0.4); text-transform: uppercase;">
            🚪 ВЕРНУТЬСЯ В ЖИЛ-ЯЧЕЙКУ
          </button>
        </div>
      `;

      const doReturn = () => {
        modal.style.display = 'none';
        if (typeof closeRadarRoguelikeModal === 'function') {
          closeRadarRoguelikeModal();
        }
      };

      const btn = document.getElementById('btn-return-living-cell');
      if (btn) {
        btn.onclick = doReturn;
        setTimeout(() => btn.focus(), 50);
      }
    }

    /**
     * Fog of War: Reveal tiles via flashlight vision cone & rotating radar beam
     */
    updateFogOfWar() {
      if (!this.mapData || !this.fogExplored) return;
      const TS = this.tileSize;
      const W = this.mapData.width;
      const H = this.mapData.height;
      const px = this.player.x;
      const py = this.player.y;

      // Clear visible buffer
      for (let y = 0; y < H; y++) {
        this.fogVisible[y].fill(0);
      }

      const visionRadius = 240;
      const sweepRadius = 420;

      const pTileX = Math.floor(px / TS);
      const pTileY = Math.floor(py / TS);
      const tileRadius = Math.ceil(visionRadius / TS);

      // 1. Direct Flashlight Visibility
      for (let ty = Math.max(0, pTileY - tileRadius); ty <= Math.min(H - 1, pTileY + tileRadius); ty++) {
        for (let tx = Math.max(0, pTileX - tileRadius); tx <= Math.min(W - 1, pTileX + tileRadius); tx++) {
          const worldCellX = tx * TS + TS / 2;
          const worldCellY = ty * TS + TS / 2;
          const dist = Math.hypot(worldCellX - px, worldCellY - py);

          if (dist <= visionRadius) {
            this.fogExplored[ty][tx] = 1;
            this.fogVisible[ty][tx] = 1;
          }
        }
      }

      // 2. Radar Sweep Beam Reveal
      const radarCos = Math.cos(this.radarAngle);
      const radarSin = Math.sin(this.radarAngle);
      for (let d = 20; d <= sweepRadius; d += 25) {
        const sx = px + radarCos * d;
        const sy = py + radarSin * d;
        const stx = Math.floor(sx / TS);
        const sty = Math.floor(sy / TS);

        if (stx >= 0 && stx < W && sty >= 0 && sty < H) {
          this.fogExplored[sty][stx] = 1;
          this.fogVisible[sty][stx] = 1;
        }
      }

      // 3. Wall Lanterns Ambient Illumination ("Фонари")
      if (this.lamps) {
        for (const lamp of this.lamps) {
          const ltx = lamp.tileX;
          const lty = lamp.tileY;
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const tx = ltx + dx;
              const ty = lty + dy;
              if (tx >= 0 && tx < W && ty >= 0 && ty < H) {
                this.fogExplored[ty][tx] = 1;
                this.fogVisible[ty][tx] = 1;
              }
            }
          }
        }
      }
    }

    isTileSolid(worldX, worldY, radius = 8) {
      if (!this.mapData || !this.mapData.grid) return false;
      const TS = this.tileSize;
      const W = this.mapData.width;
      const H = this.mapData.height;

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
        const cell = this.mapData.grid[ty][tx];
        if (cell === 1) return true;
        if (cell === 2) {
          const d = this.doors.find(dr => dr.tileX === tx && dr.tileY === ty);
          if (d) {
            const prog = (d.openProgress !== undefined) ? d.openProgress : (d.isOpen ? 1 : 0);
            if (prog < 0.8) return true;
          } else {
            return true;
          }
        }
      }
      return false;
    }

    updateEntities() {
      const px = this.player.x;
      const py = this.player.y;
      const now = Date.now();

      if (this.player.isDead) {
        for (const e of this.entities) {
          e.vx = 0;
          e.vy = 0;
        }
        return;
      }

      for (const e of this.entities) {
        if (e.damageFlashTimer > 0) e.damageFlashTimer--;

        // Visibility relative to Flashlight, player aura & lamps
        const distToPlayer = Math.hypot(px - e.x, py - e.y);
        const angleToE = Math.atan2(e.y - py, e.x - px);
        let diff = Math.abs(angleToE - this.player.angle);
        if (diff > Math.PI * 2) diff %= Math.PI * 2;
        if (diff > Math.PI) diff = Math.PI * 2 - diff;

        // Flashlight beam: 390px range, ~52 deg cone, or 85px ambient aura
        const inFlashlight = distToPlayer < 390 && diff < 0.48;
        const inAura = distToPlayer < 85;

        // Check lanterns
        let inLamp = false;
        for (const lamp of this.mapData.lamps || []) {
          if (Math.hypot(lamp.x - e.x, lamp.y - e.y) < (lamp.radius || 150)) {
            inLamp = true;
            break;
          }
        }

        e.inLightCone = inFlashlight || inAura || inLamp;
        if (e.inLightCone) {
          e.phosphorAlpha = 1.0;
        } else {
          e.phosphorAlpha = Math.max(0.2, (e.phosphorAlpha || 1.0) - 0.02);
        }

        // Entity AI Behavior
        if (e.type !== 'liquidator') {
          // --- TIER 1-3 DYNAMIC BEHAVIORS ---

          // 1. Spore Turret (Stationary Spore Pod)
          if (e.behavior === 'turret_spore') {
            e.vx = 0;
            e.vy = 0;
            e.sporeCooldown = (e.sporeCooldown || 0) + 1;
            if (e.sporeCooldown > 110 && distToPlayer < 380) {
              e.sporeCooldown = 0;
              const sAng = Math.atan2(py - e.y, px - e.x);
              if (typeof RadarAudio !== 'undefined') RadarAudio.playAcidSpit();
              this.projectiles.push({
                x: e.x + Math.cos(sAng) * 16,
                y: e.y + Math.sin(sAng) * 16,
                vx: Math.cos(sAng) * 5.5,
                vy: Math.sin(sAng) * 5.5,
                damage: e.dmg || 22,
                isPlayer: false,
                life: 60,
                color: '#bb44ee'
              });
            }
          }
          // 2. Rogue Liquidator (Ranged Shotgun Operator)
          else if (e.behavior === 'ranged_shotgun') {
            const ang = Math.atan2(py - e.y, px - e.x);
            e.angle = ang;
            if (distToPlayer < 140) {
              e.vx = -Math.cos(ang) * e.speed;
              e.vy = -Math.sin(ang) * e.speed;
            } else if (distToPlayer > 220) {
              e.vx = Math.cos(ang) * e.speed;
              e.vy = Math.sin(ang) * e.speed;
            } else {
              e.vx = 0; e.vy = 0;
            }

            e.shotgunCooldown = (e.shotgunCooldown || 0) + 1;
            if (e.shotgunCooldown > 95 && distToPlayer < 280) {
              e.shotgunCooldown = 0;
              if (typeof RadarAudio !== 'undefined') RadarAudio.playGunshot('shotgun');
              for (let s = -1; s <= 1; s++) {
                const spreadAng = ang + s * 0.16;
                this.projectiles.push({
                  x: e.x + Math.cos(ang) * 16,
                  y: e.y + Math.sin(ang) * 16,
                  vx: Math.cos(spreadAng) * 9.5,
                  vy: Math.sin(spreadAng) * 9.5,
                  damage: 14,
                  isPlayer: false,
                  life: 40,
                  color: '#ff6600'
                });
              }
            }
          }
          // 3. Black Slime (Leaves slowing acid puddle)
          else if (e.behavior === 'slime_split') {
            if (this.tick % 45 === 0) {
              this.particles.push({
                x: e.x,
                y: e.y,
                vx: 0,
                vy: 0,
                sz: 7,
                color: '#33cc55',
                alpha: 0.8,
                isAcidPuddle: true,
                life: 250
              });
            }
            // Standard Chase / Wander
            if (distToPlayer < 200) e.state = 'CHASE';
            if (e.state === 'CHASE') {
              const ang = Math.atan2(py - e.y, px - e.x);
              e.vx = Math.cos(ang) * e.speed;
              e.vy = Math.sin(ang) * e.speed;
              e.angle = ang;
              if (distToPlayer < e.radius + this.player.radius + 4) {
                this.damagePlayer(e.dmg || 10, e.name);
                e.vx *= -1.5; e.vy *= -1.5;
              }
            }
          }
          // 4. Voice Mimic (Disguised radar blip)
          else if (e.behavior === 'radar_disguise') {
            if (e.isMimicDisguised) {
              if (distToPlayer < 130 || e.damageFlashTimer > 0) {
                e.isMimicDisguised = false;
                e.state = 'CHASE';
                this.spawnFloatingNotice('ИМИТАТОР РАСКРЫТ!', '#ff3366');
                if (typeof RadarAudio !== 'undefined') RadarAudio.playMonsterHurt();
              } else {
                // Calm wander
                e.vx = Math.cos(e.angle) * 0.8;
                e.vy = Math.sin(e.angle) * 0.8;
              }
            } else {
              // Rapid charge
              const ang = Math.atan2(py - e.y, px - e.x);
              const sprintSpd = e.sprintSpeed || 3.6;
              e.vx = Math.cos(ang) * sprintSpd;
              e.vy = Math.sin(ang) * sprintSpd;
              e.angle = ang;
              if (distToPlayer < e.radius + this.player.radius + 4) {
                this.damagePlayer(e.dmg || 24, e.name);
                e.vx *= -1.5; e.vy *= -1.5;
              }
            }
          }
          // 5. Six-Legged Horror (Flanking AI & Leaps)
          else if (e.behavior === 'leap_flank') {
            e.leapCooldown = (e.leapCooldown || 0) + 1;
            const ang = Math.atan2(py - e.y, px - e.x);

            if (e.leapCooldown > 130 && distToPlayer < 220) {
              // Leap strike!
              e.leapCooldown = 0;
              e.vx = Math.cos(ang) * 8.5;
              e.vy = Math.sin(ang) * 8.5;
              this.spawnFloatingNotice('ПРЫЖОК!', '#ff0044');
            } else {
              // Flank around player
              const flankAng = ang + Math.PI / 4;
              e.vx = Math.cos(flankAng) * e.speed;
              e.vy = Math.sin(flankAng) * e.speed;
            }
            e.angle = ang;
            if (distToPlayer < e.radius + this.player.radius + 5) {
              this.damagePlayer(e.dmg || 44, e.name);
              e.vx *= -1.5; e.vy *= -1.5;
            }
          }
          // 6. Feral Inhabitant (Rushes towards flashlight beam)
          else if (e.behavior === 'rush_flashlight') {
            if (e.inLightCone) {
              e.state = 'CHASE';
              const ang = Math.atan2(py - e.y, px - e.x);
              e.vx = Math.cos(ang) * (e.speed * 1.55); // Rapid sprint into the light!
              e.vy = Math.sin(ang) * (e.speed * 1.55);
              e.angle = ang;
            } else if (distToPlayer < 180) {
              e.state = 'CHASE';
              const ang = Math.atan2(py - e.y, px - e.x);
              e.vx = Math.cos(ang) * e.speed;
              e.vy = Math.sin(ang) * e.speed;
              e.angle = ang;
            } else {
              e.vx = 0; e.vy = 0;
            }

            if (distToPlayer < e.radius + this.player.radius + 4) {
              this.damagePlayer(e.dmg || 14, e.name);
              e.vx *= -1.5; e.vy *= -1.5;
            }
          }
          // 7. General Fallback AI
          else {
            if (distToPlayer < 220) e.state = 'CHASE';
            if (e.state === 'CHASE') {
              const ang = Math.atan2(py - e.y, px - e.x);
              e.vx = Math.cos(ang) * e.speed;
              e.vy = Math.sin(ang) * e.speed;
              e.angle = ang;
              if (distToPlayer < e.radius + this.player.radius + 4) {
                this.damagePlayer(e.dmg || 18, e.name);
                e.vx *= -1.5; e.vy *= -1.5;
              }
            } else {
              e.vx = 0; e.vy = 0;
            }
          }
        } else {
          // Patrol Liquidator AI (Combat & Rescue)
          if (e.hp <= 45 || e.hp <= e.maxHp * 0.38) {
            e.isWounded = true;
            e.vx = 0;
            e.vy = 0;
            e.callForHelpTimer = (e.callForHelpTimer || 0) + 1;
            if (e.callForHelpTimer > 180) {
              e.callForHelpTimer = 0;
              this.particles.push({
                x: e.x - 45,
                y: e.y - 30,
                vx: 0,
                vy: -0.5,
                text: '⚠️ РАНЕН! БРАТОК, ПОМОГИ!',
                color: '#ffaa00',
                alpha: 1.0,
                isText: true,
                life: 60
              });
            }
          } else {
            // Healthy Liquidator: scans for hostiles and engages
            if (e.attackCooldown > 0) e.attackCooldown--;

            let nearestMonster = null;
            let minDist = 260;
            for (const m of this.entities) {
              if (m.type === 'monster' && m.hp > 0) {
                const dm = Math.hypot(m.x - e.x, m.y - e.y);
                if (dm < minDist) {
                  minDist = dm;
                  nearestMonster = m;
                }
              }
            }

            if (nearestMonster) {
              const mAng = Math.atan2(nearestMonster.y - e.y, nearestMonster.x - e.x);
              e.angle = mAng;

              if (e.hasWeapon && e.gun && e.gun.ammo > 0) {
                // Keep tactical distance
                if (minDist < 90) {
                  e.vx = -Math.cos(mAng) * e.speed;
                  e.vy = -Math.sin(mAng) * e.speed;
                } else if (minDist > 170) {
                  e.vx = Math.cos(mAng) * (e.speed * 0.9);
                  e.vy = Math.sin(mAng) * (e.speed * 0.9);
                } else {
                  e.vx = 0;
                  e.vy = 0;
                }

                // Fire at monster!
                if (e.attackCooldown <= 0) {
                  e.attackCooldown = (e.gun.gunType === 'shotgun') ? 52 : (e.gun.gunType === 'rifle' ? 24 : 38);
                  e.gun.ammo--;

                  const spread = (Math.random() - 0.5) * 0.12;
                  const fireAng = mAng + spread;
                  this.projectiles.push({
                    x: e.x + Math.cos(fireAng) * 16,
                    y: e.y + Math.sin(fireAng) * 16,
                    vx: Math.cos(fireAng) * 8.5,
                    vy: Math.sin(fireAng) * 8.5,
                    damage: e.gun.dmg || 28,
                    isPlayer: true,
                    life: 45,
                    color: '#88ff9e'
                  });

                  if (typeof RadarAudio !== 'undefined') {
                    RadarAudio.playGunshot(e.gun.gunType || 'rifle');
                  }
                }
              } else {
                // Out of ammo or unarmed - retreat from monster
                e.vx = -Math.cos(mAng) * e.speed;
                e.vy = -Math.sin(mAng) * e.speed;
              }
            } else {
              // No monsters in sight
              if (e.isLoyalFollower) {
                // Follow the player as loyal escort
                const dPlayer = Math.hypot(px - e.x, py - e.y);
                if (dPlayer > 70) {
                  const pAng = Math.atan2(py - e.y, px - e.x);
                  e.angle = pAng;
                  e.vx = Math.cos(pAng) * (e.speed * 1.1);
                  e.vy = Math.sin(pAng) * (e.speed * 1.1);
                } else {
                  e.vx = 0;
                  e.vy = 0;
                }
              } else {
                // Autonomous patrol between waypoints
                e.stateTimer = (e.stateTimer || 0) - 1;
                if (e.stateTimer <= 0) {
                  e.stateTimer = 90 + Math.random() * 120;
                  e.wanderTarget = {
                    x: e.homeX + (Math.random() - 0.5) * 180,
                    y: e.homeY + (Math.random() - 0.5) * 180
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
              }
            }
          }
        }

        const nextEx = e.x + (e.vx || 0);
        const nextEy = e.y + (e.vy || 0);
        if (!this.isTileSolid(nextEx, e.y, e.radius)) e.x = nextEx;
        if (!this.isTileSolid(e.x, nextEy, e.radius)) e.y = nextEy;
      }
    }

    damagePlayer(amount, source = 'Удар мутанта') {
      if (this.player.isDead || this.player.hp <= 0) return;
      if (this.player.damageFlashTimer > 0) return;
      const actualDmg = Math.max(5, amount - Math.floor(this.player.armor * 0.35));
      this.player.hp = Math.max(0, this.player.hp - actualDmg);
      this.player.damageFlashTimer = 14;

      if (typeof RadarAudio !== 'undefined') {
        RadarAudio.playPlayerHurt();
      }

      for (let i = 0; i < 7; i++) {
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

      if (this.player.hp <= 0 && !this.player.isDead) {
        this.player.isDead = true;
        this.player.deathTick = 0;
        this.isCollapsing = false;
        if (typeof RadarAudio !== 'undefined') RadarAudio.playPlayerHurt();
        this.showDeathPrompt();
      }
    }

    updateProjectiles() {
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const p = this.projectiles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life--;

        if (this.isTileSolid(p.x, p.y, 4) || p.life <= 0) {
          this.spawnHitParticles(p.x, p.y, p.color || '#1fe044', 4);
          this.projectiles.splice(i, 1);
          continue;
        }

        if (p.isPlayer) {
          // Check monster hit
          let hit = false;
          for (let j = this.entities.length - 1; j >= 0; j--) {
            const e = this.entities[j];
            if (e.type !== 'liquidator') {
              if (Math.hypot(p.x - e.x, p.y - e.y) < e.radius + 6) {
                e.hp -= p.damage;
                e.damageFlashTimer = 8;
                this.spawnHitParticles(p.x, p.y, '#ff3b30', 6);
                if (typeof RadarAudio !== 'undefined') RadarAudio.playMonsterHurt();
                hit = true;

                if (e.hp <= 0) {
                  this.killMonster(e);
                }
                break;
              }
            }
          }
          if (hit) this.projectiles.splice(i, 1);
        } else {
          // Monster acid projectile hitting player
          if (Math.hypot(p.x - this.player.x, p.y - this.player.y) < this.player.radius + 6) {
            this.damagePlayer(p.damage, 'Кислотный плевок');
            this.projectiles.splice(i, 1);
          }
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
     * Master Render (Supports Dual-Mode: TDS 2D vs FPS 3D Raycasting)
     */
    render() {
      const w = this.canvas.width;
      const h = this.canvas.height;
      const cam = this.getCameraOffset();

      // Determine target context for world rendering (supports Swaggerfall ANSI text-mode shader)
      let worldCtx = this.ctx;
      let offscreenCanvas = null;

      if (typeof AsciiRenderer !== 'undefined' && AsciiRenderer.enabled) {
        const off = AsciiRenderer.getOffscreen(w, h);
        worldCtx = off.ctx;
        offscreenCanvas = off.canvas;
      }

      // Deep solid darkness background
      worldCtx.fillStyle = '#020503';
      worldCtx.fillRect(0, 0, w, h);

      if (this.cameraMode === 'FPS') {
        // --- FIRST PERSON 3D RAYCASTING MODE ---
        this.renderFPS(worldCtx, w, h);
      } else {
        // --- TOP-DOWN 2D TACTICAL VIEW MODE ---
        worldCtx.save();
        worldCtx.translate(-cam.x, -cam.y);

        // 1. Draw Map Tiles with Fog of War
        this.drawTilesWithFog(worldCtx, cam, w, h);

        // 2. Draw Airtight Doors
        for (const door of this.doors) {
          if (this.isCellExplored(door.tileX, door.tileY)) {
            if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawDoorTile) {
              SpriteFactory.drawDoorTile(worldCtx, door, this.tileSize, this.tick, 1.0);
            }
          }
        }

        // 2b. Draw Wall Lanterns ("Фонари") with warm amber glow
        if (this.lamps) {
          for (const lamp of this.lamps) {
            if (this.isCellExplored(lamp.tileX, lamp.tileY)) {
              if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawWallLamp) {
                SpriteFactory.drawWallLamp(worldCtx, lamp, this.tileSize, this.tick, 1.0);
              }
            }
          }
        }

        // 3. Draw Loot Crates
        for (const crate of this.crates) {
          if (this.isCellExplored(crate.tileX, crate.tileY)) {
            if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawLootCrate) {
              SpriteFactory.drawLootCrate(worldCtx, crate, this.tileSize, this.tick, crate.phosphorAlpha || 0.8);
            }
          }
        }

        // 4. Draw Dropped Firearms
        for (const drop of this.weaponDrops) {
          if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawDroppedWeapon) {
            SpriteFactory.drawDroppedWeapon(worldCtx, drop, this.tileSize, this.tick, drop.phosphorAlpha || 0.8);
          }
        }

        // 5. Draw Extraction Elevator Shaft
        if (this.elevator && this.isCellExplored(this.elevator.tileX, this.elevator.tileY)) {
          if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawElevatorShaft) {
            SpriteFactory.drawElevatorShaft(worldCtx, this.elevator, this.tileSize, this.tick, 1.0);
          }
        }

        // 6. Draw Projectiles
        for (const p of this.projectiles) {
          worldCtx.fillStyle = p.color || '#ffeedd';
          worldCtx.beginPath();
          worldCtx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          worldCtx.fill();
          worldCtx.strokeStyle = '#ffffff';
          worldCtx.stroke();
        }

        // 7. Draw Melee Swing Slash Arc
        if (this.player.isSwinging && typeof SpriteFactory !== 'undefined' && SpriteFactory.drawMeleeSwingArc) {
          SpriteFactory.drawMeleeSwingArc(worldCtx, this.player.x, this.player.y, this.player.angle, this.player.swingProgress);
        }

        // 8. Draw AI Entities
        for (const e of this.entities) {
          if (typeof SpriteFactory !== 'undefined') {
            SpriteFactory.drawEntity(worldCtx, e, this.tick);
          }
        }

        // 9. Draw Player
        if (typeof SpriteFactory !== 'undefined') {
          SpriteFactory.drawEntity(worldCtx, this.player, this.tick);
        }

        // 10. Particles & Floating Text
        for (const pt of this.particles) {
          worldCtx.save();
          worldCtx.globalAlpha = Math.max(0, pt.alpha);
          if (pt.isText) {
            worldCtx.fillStyle = pt.color;
            worldCtx.font = 'bold 12px "Share Tech Mono", monospace';
            worldCtx.fillText(pt.text, pt.x, pt.y);
          } else {
            worldCtx.fillStyle = pt.color;
            worldCtx.fillRect(pt.x, pt.y, pt.sz, pt.sz);
          }
          worldCtx.restore();
        }

        worldCtx.restore();

        // 11. Dynamic Darkness & Volumetric Flashlight
        this.drawDynamicDarkness(worldCtx, cam, w, h);
      }

      // 12. Full-Color Swaggerfall (ANSI Text-Mode) Shader Post-Process!
      if (offscreenCanvas && typeof AsciiRenderer !== 'undefined' && AsciiRenderer.enabled) {
        AsciiRenderer.render(offscreenCanvas, this.ctx, w, h);
      }

      // 13. Draw Tactical HUD & Crosshair on display context
      this.drawRadarHUD(this.ctx, w, h);

      if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawCrosshair) {
        const crosshairX = (this.cameraMode === 'FPS') ? (w / 2) : this.mouse.x;
        const crosshairY = (this.cameraMode === 'FPS') ? (h / 2) : this.mouse.y;
        SpriteFactory.drawCrosshair(this.ctx, crosshairX, crosshairY, this.tick, this.mouse.isOverEnemy);
      }

      // 14. Death / Wounded Screen Banner
      if (this.player.isDead || this.player.hp <= 0) {
        this.drawDeathWoundedCanvas(this.ctx, w, h);
      }

      // 15. CRT Collapse on Game Over / Victory
      if (this.isCollapsing) {
        this.drawCRTCollapse(this.ctx, w, h);
      }
    }

    drawDeathWoundedCanvas(ctx, w, h) {
      ctx.save();
      ctx.fillStyle = 'rgba(8, 2, 2, 0.85)';
      ctx.fillRect(0, 0, w, h);

      const bannerW = Math.min(520, w * 0.92);
      const bannerH = 150;
      const bannerX = (w - bannerW) / 2;
      const bannerY = (h - bannerH) / 2;

      ctx.fillStyle = 'rgba(24, 4, 4, 0.96)';
      ctx.fillRect(bannerX, bannerY, bannerW, bannerH);
      ctx.strokeStyle = '#ff3b30';
      ctx.lineWidth = 3;
      ctx.strokeRect(bannerX, bannerY, bannerW, bannerH);

      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff3b30';
      ctx.font = 'bold 24px "Share Tech Mono", monospace';
      ctx.shadowColor = '#ff3b30';
      ctx.shadowBlur = 14;
      ctx.fillText('⚠️ ВЫ РАНЕНЫ! ⚠️', w / 2, bannerY + 42);

      ctx.fillStyle = '#e8d0d0';
      ctx.font = '12.5px "Share Tech Mono", monospace';
      ctx.shadowBlur = 0;
      ctx.fillText('Критическое повреждение систем жизнеобеспечения.', w / 2, bannerY + 66);

      const btnW = bannerW - 50;
      const btnH = 46;
      const btnX = (w - btnW) / 2;
      const btnY = bannerY + 84;

      ctx.fillStyle = 'rgba(255, 59, 48, 0.28)';
      ctx.fillRect(btnX, btnY, btnW, btnH);
      ctx.strokeStyle = '#ff3b30';
      ctx.lineWidth = 2;
      ctx.strokeRect(btnX, btnY, btnW, btnH);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 15px "Share Tech Mono", monospace';
      ctx.shadowColor = '#ff3b30';
      ctx.shadowBlur = 8;
      ctx.fillText('🏃 БЕЖАТЬ В ЖИЛ-ЯЧЕЙКУ [КЛИК]', w / 2, btnY + 29);
      ctx.restore();
    }

    /**
     * First-Person 3D Raycasting Renderer (DDA Wolf3D style -> Swaggerfall ANSI text-mode)
     */
    renderFPS(ctx, w, h) {
      if (!this.mapData || !this.mapData.grid) return;
      const grid = this.mapData.grid;
      const mapW = this.mapData.width;
      const mapH = this.mapData.height;
      const TS = this.tileSize;

      const px = this.player.x;
      const py = this.player.y;
      const pAngle = this.player.angle;
      const fov = 1.15; // ~66 degrees field of view
      const halfFov = fov / 2;
      const halfH = h / 2;

      // 1. Perspective industrial ceiling and floor
      const ceilGrad = ctx.createLinearGradient(0, 0, 0, halfH);
      ceilGrad.addColorStop(0, '#040d06');
      ceilGrad.addColorStop(1, '#0c1a10');
      ctx.fillStyle = ceilGrad;
      ctx.fillRect(0, 0, w, halfH);

      // Overhead concrete crossbeams and conduit shadow lines
      ctx.fillStyle = 'rgba(20, 36, 26, 0.4)';
      for (let cy = 12; cy < halfH; cy += Math.max(6, Math.floor(cy * 0.28))) {
        const beamH = Math.max(1, Math.floor(cy * 0.04));
        ctx.fillRect(0, cy, w, beamH);
      }

      const flrGrad = ctx.createLinearGradient(0, halfH, 0, h);
      flrGrad.addColorStop(0, '#09150c');
      flrGrad.addColorStop(1, '#020503');
      ctx.fillStyle = flrGrad;
      ctx.fillRect(0, halfH, w, halfH);

      // Floor plate perspective seam lines
      ctx.fillStyle = 'rgba(26, 44, 32, 0.35)';
      for (let fy = halfH + 8; fy < h; fy += Math.max(5, Math.floor((fy - halfH) * 0.22))) {
        const seamH = Math.max(1, Math.floor((fy - halfH) * 0.03));
        ctx.fillRect(0, fy, w, seamH);
      }

      // 2. DDA Raycaster for vertical wall strips
      const colStep = 2; // High density 2px columns
      const numCols = Math.ceil(w / colStep);
      const zBuffer = new Float32Array(numCols);

      for (let i = 0; i < numCols; i++) {
        const screenX = i * colStep;
        const rayAngle = pAngle - halfFov + (i / numCols) * fov;
        const sin = Math.sin(rayAngle);
        const cos = Math.cos(rayAngle);

        let mapX = Math.floor(px / TS);
        let mapY = Math.floor(py / TS);

        const deltaDistX = Math.abs(1 / (cos || 0.00001));
        const deltaDistY = Math.abs(1 / (sin || 0.00001));

        let stepX, stepY;
        let sideDistX, sideDistY;

        if (cos < 0) {
          stepX = -1;
          sideDistX = (px / TS - mapX) * deltaDistX;
        } else {
          stepX = 1;
          sideDistX = (mapX + 1.0 - px / TS) * deltaDistX;
        }

        if (sin < 0) {
          stepY = -1;
          sideDistY = (py / TS - mapY) * deltaDistY;
        } else {
          stepY = 1;
          sideDistY = (mapY + 1.0 - py / TS) * deltaDistY;
        }

        let hit = 0;
        let side = 0;
        let hitTile = 1;
        let hitDoor = null;
        let maxSteps = 42;

        while (hit === 0 && maxSteps-- > 0) {
          if (sideDistX < sideDistY) {
            sideDistX += deltaDistX;
            mapX += stepX;
            side = 0;
          } else {
            sideDistY += deltaDistY;
            mapY += stepY;
            side = 1;
          }

          if (mapX < 0 || mapX >= mapW || mapY < 0 || mapY >= mapH) {
            hit = 1;
            break;
          }

          const cell = grid[mapY][mapX];
          if (cell === 1) {
            hit = 1;
            hitTile = 1;
          } else if (cell === 2) {
            const door = this.doors.find(dr => dr.tileX === mapX && dr.tileY === mapY);
            const openProg = door ? ((door.openProgress !== undefined) ? door.openProgress : (door.isOpen ? 1 : 0)) : 0;
            if (openProg < 0.02) {
              hit = 1;
              hitTile = 2;
              hitDoor = door;
            } else if (openProg >= 0.98) {
              // Completely open, ray passes right through!
            } else {
              // Sliding door: calculate wallX at this boundary
              let curPerp;
              if (side === 0) {
                curPerp = (mapX - px / TS + (1 - stepX) / 2) / (cos || 0.00001);
              } else {
                curPerp = (mapY - py / TS + (1 - stepY) / 2) / (sin || 0.00001);
              }
              let dWallX = (side === 0) ? (py / TS + curPerp * sin) : (px / TS + curPerp * cos);
              dWallX -= Math.floor(dWallX);
              if (dWallX < 0) dWallX += 1.0;
              const halfGap = openProg * 0.5;
              if (dWallX >= (0.5 - halfGap) && dWallX <= (0.5 + halfGap)) {
                // Ray passes through sliding gap into the room behind
              } else {
                hit = 1;
                hitTile = 2;
                hitDoor = door;
              }
            }
          }
        }

        let perpDist;
        if (side === 0) {
          perpDist = (mapX - px / TS + (1 - stepX) / 2) / (cos || 0.00001);
        } else {
          perpDist = (mapY - py / TS + (1 - stepY) / 2) / (sin || 0.00001);
        }
        if (perpDist < 0.05) perpDist = 0.05;

        zBuffer[i] = perpDist * TS;

        // Fish-eye correction
        const distCorrection = Math.cos(rayAngle - pAngle);
        const correctedDist = perpDist * distCorrection;

        const lineH = Math.min(h * 2.5, Math.floor((h / correctedDist) * 0.95));
        const drawStart = Math.max(0, Math.floor(halfH - lineH / 2));
        const drawEnd = Math.min(h, Math.floor(halfH + lineH / 2));

        // Calculate exact wall hit U-coordinate (wallX in [0.0 .. 1.0))
        let wallX;
        if (side === 0) {
          wallX = (py / TS) + perpDist * sin;
        } else {
          wallX = (px / TS) + perpDist * cos;
        }
        wallX -= Math.floor(wallX);
        if (wallX < 0) wallX += 1.0;

        // Material key resolution
        const isDoor = (hitTile === 2);
        let matKey = 'concrete_old';
        if (isDoor) {
          matKey = 'door_blast';
          const openProg = (hitDoor && hitDoor.openProgress !== undefined) ? hitDoor.openProgress : 0;
          if (openProg > 0 && openProg < 0.98) {
            const halfGap = openProg * 0.5;
            if (wallX < 0.5) {
              wallX = (wallX / Math.max(0.01, (0.5 - halfGap))) * 0.5;
            } else {
              wallX = 0.5 + ((wallX - (0.5 + halfGap)) / Math.max(0.01, (0.5 - halfGap))) * 0.5;
            }
            wallX = Math.max(0, Math.min(0.999, wallX));
          }
        } else if (this.mapData.wallMaterials && this.mapData.wallMaterials[mapY]) {
          matKey = this.mapData.wallMaterials[mapY][mapX] || 'concrete_old';
        }

        // Texture retrieval from TextureManager
        const texImg = (typeof TextureManager !== 'undefined') ? TextureManager.get(matKey) : null;
        const texW = (texImg && texImg.naturalWidth) ? texImg.naturalWidth : 128;
        const texH = (texImg && texImg.naturalHeight) ? texImg.naturalHeight : 128;

        let texX = Math.floor(wallX * texW);
        if (side === 0 && cos > 0) texX = texW - texX - 1;
        if (side === 1 && sin < 0) texX = texW - texX - 1;
        if (texX < 0) texX = 0;
        if (texX >= texW) texX = texW - 1;

        // Draw Textured Wall Strip
        if (texImg && texImg.complete && texImg.naturalWidth > 0) {
          ctx.drawImage(texImg, texX, 0, 1, texH, screenX, drawStart, colStep, drawEnd - drawStart);
        } else {
          // Atmospheric Material Fallback
          const sideDarken = side === 1 ? 0.72 : 1.0;
          if (isDoor) {
            // Authentic Samosbor blast door fallback with hazard stripes & lock wheel
            const isHazardStripe = (Math.floor(wallX * 8 + (drawEnd - drawStart) * 0.05) % 2 === 0);
            const stripeColor = isHazardStripe ? [190, 150, 20] : [35, 42, 38];
            ctx.fillStyle = `rgb(${Math.floor(stripeColor[0] * sideDarken)}, ${Math.floor(stripeColor[1] * sideDarken)}, ${Math.floor(stripeColor[2] * sideDarken)})`;
            ctx.fillRect(screenX, drawStart, colStep, drawEnd - drawStart);

            // Center locking seal line
            if (Math.abs(wallX - 0.5) < 0.06) {
              ctx.fillStyle = '#111813';
              ctx.fillRect(screenX, drawStart, colStep, drawEnd - drawStart);
            }
          } else {
            const fb = (typeof TextureManager !== 'undefined') 
              ? TextureManager.getFallback(matKey) 
              : [55, 65, 60];
            ctx.fillStyle = `rgb(${Math.floor(fb[0] * sideDarken)}, ${Math.floor(fb[1] * sideDarken)}, ${Math.floor(fb[2] * sideDarken)})`;
            ctx.fillRect(screenX, drawStart, colStep, drawEnd - drawStart);
          }
        }

        // --- DYNAMIC LIGHTING, SHADING & DISTANCE FOG ---
        const maxShadeDist = 18;
        let shade = Math.max(0.04, Math.min(1.0, 1.0 - perpDist / maxShadeDist));
        if (side === 1) shade *= 0.76; // 3D side shadow depth

        // Local wall lanterns volumetric illumination
        if (this.lamps && this.lamps.length > 0) {
          const hitWorldX = px + cos * (perpDist * TS);
          const hitWorldY = py + sin * (perpDist * TS);
          for (let li = 0; li < this.lamps.length; li++) {
            const lamp = this.lamps[li];
            const ld = Math.hypot(hitWorldX - lamp.x, hitWorldY - lamp.y);
            if (ld < 110) {
              const lampFactor = (1.0 - ld / 110) * 0.42;
              const flicker = Math.sin(this.tick * 0.16 + lamp.tileX * 5) * 0.06;
              shade = Math.min(1.0, shade + Math.max(0, lampFactor + flicker));
            }
          }
        }

        // Smooth darkness falloff overlay
        const darkAlpha = 1.0 - shade;
        if (darkAlpha > 0.02) {
          ctx.fillStyle = `rgba(1, 8, 4, ${darkAlpha.toFixed(2)})`;
          ctx.fillRect(screenX, drawStart, colStep, drawEnd - drawStart);
        }

        // Samosbor Emergency Siren Pulsing Tint
        if (this.samosborActive) {
          const pulse = 0.35 + Math.sin(this.tick * 0.2) * 0.25;
          ctx.fillStyle = `rgba(180, 20, 20, ${pulse.toFixed(2)})`;
          ctx.fillRect(screenX, drawStart, colStep, drawEnd - drawStart);
        }

        // Hermetic Door Electronic Status Indicator (LED)
        if (isDoor) {
          const doorLedY = drawStart + lineH * 0.14;
          const doorLedH = Math.max(2, Math.floor(lineH * 0.045));
          const isOpened = (hitDoor && hitDoor.isOpen);
          const isLocked = (hitDoor && hitDoor.isLocked);
          const ledColor = isOpened ? '#1fe044' : isLocked ? '#ffcc00' : '#ff3b30';
          ctx.fillStyle = ledColor;
          ctx.fillRect(screenX, doorLedY, colStep, doorLedH);
        }
      }

      // 3. Billboard Entities (Monsters, Allies, Loot, Crates, Elevator)
      const visibleSprites = [];

      if (this.elevator) {
        visibleSprites.push({
          x: this.elevator.x + 16,
          y: this.elevator.y + 16,
          type: 'elevator',
          key: 'loot_crate',
          color: '#33d4ff',
          name: '[E] ШАХТА ЭВАКУАЦИИ'
        });
      }

      for (const crate of this.crates) {
        if (!crate.opened) {
          visibleSprites.push({
            x: crate.x,
            y: crate.y,
            type: 'crate',
            key: 'loot_crate',
            color: '#f5a623'
          });
        }
      }

      for (const drop of this.weaponDrops) {
        if (!drop.pickedUp) {
          let itemKey = 'loot_crate';
          if (drop.weapon) {
            const wId = (drop.weapon.id || drop.weapon.type || '').toLowerCase();
            if (wId.includes('shotgun') || wId.includes('ks23') || wId.includes('saiga')) itemKey = 'weapon_shotgun';
            else if (wId.includes('pipe') || wId.includes('crowbar') || wId.includes('melee')) itemKey = 'weapon_pipe';
            else if (wId.includes('flame') || wId.includes('fire')) itemKey = 'weapon_flamethrower';
            else if (wId.includes('rifle') || wId.includes('ak')) itemKey = 'weapon_rifle';
            else itemKey = 'weapon_pistol';
          } else if (drop.item) {
            const iId = (drop.item.id || drop.item.type || '').toLowerCase();
            if (iId.includes('med') || iId.includes('heal')) itemKey = 'food_medkit';
            else if (iId.includes('ammo')) itemKey = 'ammo_box';
            else if (iId.includes('filter')) itemKey = 'gas_filter';
            else itemKey = 'loot_crate';
          }
          visibleSprites.push({
            x: drop.x,
            y: drop.y,
            type: 'weapon',
            key: itemKey,
            color: '#00ffaa'
          });
        }
      }

      for (const ally of (this.allies || [])) {
        visibleSprites.push({
          x: ally.x,
          y: ally.y,
          type: 'ally',
          key: 'liquidator',
          color: '#1fe044',
          hp: ally.hp,
          maxHp: ally.maxHp
        });
      }

      for (const ent of this.entities) {
        if (ent.hp > 0) {
          let mKey = 'black_slime';
          const eType = (ent.type || '').toLowerCase();
          if (eType.includes('madman') || eType.includes('feral')) mKey = 'feral_inhabitant';
          else if (eType.includes('cult') || eType.includes('mimic')) mKey = 'voice_mimic';
          else if (eType.includes('pod') || eType.includes('mold') || eType.includes('spore')) mKey = 'spore_pod';
          else if (eType.includes('liquidator')) mKey = 'rogue_liquidator';
          else if (eType.includes('centipede') || eType.includes('horror')) mKey = 'six_legged_horror';
          else mKey = 'black_slime';

          visibleSprites.push({
            x: ent.x,
            y: ent.y,
            type: 'monster',
            key: mKey,
            color: ent.color || '#ff3b30',
            hp: ent.hp,
            maxHp: ent.maxHp
          });
        }
      }

      for (const sp of visibleSprites) {
        const dx = sp.x - px;
        const dy = sp.y - py;
        sp.dist = Math.hypot(dx, dy);

        let ang = Math.atan2(dy, dx) - pAngle;
        while (ang < -Math.PI) ang += 2 * Math.PI;
        while (ang > Math.PI) ang -= 2 * Math.PI;
        sp.angle = ang;
        sp.perpDist = sp.dist * Math.cos(ang);
      }

      // Filter sprites in front of camera
      const inFrontSprites = visibleSprites.filter(sp => sp.perpDist > 8 && Math.cos(sp.angle) > 0.08 && Math.abs(sp.angle) < fov * 0.95);

      // Sort furthest to nearest by perpendicular distance
      inFrontSprites.sort((a, b) => b.perpDist - a.perpDist);

      for (const sp of inFrontSprites) {
        const screenX = Math.floor((w / 2) + Math.tan(sp.angle) * (w / 2) / Math.tan(fov / 2));
        const sprHeight = Math.min(h * 2.2, Math.floor((h / (sp.perpDist / TS)) * 0.88));
        const aspect = (sp.type === 'weapon' || sp.type === 'crate') ? 0.65 : 0.82;
        const sprWidth = Math.max(4, Math.floor(sprHeight * aspect));

        // Ground firmly on floor base
        const wallBase = halfH + Math.floor(((h / (sp.perpDist / TS)) * 0.95) / 2);
        const sprTop = Math.floor(wallBase - sprHeight);
        const sprLeft = Math.floor(screenX - sprWidth / 2);
        const sprRight = sprLeft + sprWidth;

        if (sprRight <= 0 || sprLeft >= w) continue;

        const perpDistWorld = sp.perpDist;
        const shade = Math.max(0.08, Math.min(1.0, 1.0 - perpDistWorld / (TS * 18)));
        const darkAlpha = 1.0 - shade;

        let sprImg = null;
        if (typeof TextureManager !== 'undefined' && TextureManager.getSprite && sp.key) {
          sprImg = TextureManager.getSprite(sp.key);
        }

        let anyStripeVisible = false;

        // PER-COLUMN STRIPE RENDERING & Z-BUFFER OCCLUSION (NO X-RAY GLITCH)
        for (let stripeX = Math.max(0, sprLeft); stripeX < Math.min(w, sprRight); stripeX += colStep) {
          const bufIdx = Math.floor(stripeX / colStep);
          if (bufIdx >= 0 && bufIdx < numCols && zBuffer[bufIdx] < perpDistWorld) {
            // Occluded by wall or blast door!
            continue;
          }

          anyStripeVisible = true;
          const u = (stripeX - sprLeft) / sprWidth;

          if (sprImg && sprImg.complete && sprImg.naturalWidth > 0) {
            const srcX = Math.floor(u * sprImg.naturalWidth);
            ctx.drawImage(sprImg, srcX, 0, 1, sprImg.naturalHeight, stripeX, sprTop, colStep, sprHeight);
          } else {
            // Fallback billboard
            if (sp.type === 'elevator') {
              ctx.fillStyle = 'rgba(51, 212, 255, 0.45)';
              ctx.fillRect(stripeX, sprTop, colStep, sprHeight);
            } else {
              ctx.fillStyle = sp.color || '#ff3b30';
              ctx.fillRect(stripeX, sprTop + sprHeight * 0.15, colStep, sprHeight * 0.85);
            }
          }

          // Shading overlay
          if (darkAlpha > 0.05) {
            ctx.fillStyle = `rgba(1, 8, 4, ${darkAlpha.toFixed(2)})`;
            ctx.fillRect(stripeX, sprTop, colStep, sprHeight);
          }
        }

        // Health bar rendered only if sprite is visible
        if (anyStripeVisible && sp.hp !== undefined && sp.maxHp) {
          const centerBufIdx = Math.floor(screenX / colStep);
          if (centerBufIdx < 0 || centerBufIdx >= numCols || zBuffer[centerBufIdx] >= perpDistWorld * 0.9) {
            const hpPct = Math.max(0, Math.min(1, sp.hp / sp.maxHp));
            const barW = Math.max(22, Math.min(68, sprWidth * 0.85));
            const barH = Math.max(3, Math.floor(sprHeight * 0.06));
            const barX = Math.floor(screenX - barW / 2);
            const barY = Math.max(8, sprTop - barH - 4);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fillRect(barX, barY, barW, barH);
            ctx.fillStyle = (sp.type === 'ally') ? '#1fe044' : '#ff3b30';
            ctx.fillRect(barX, barY, Math.floor(barW * hpPct), barH);
          }
        }
      }

      // 4. Tactical Crosshair (Turns red when aiming at enemy)
      let isAimingAtEnemy = false;
      const centerBufIdx = Math.floor((w / 2) / colStep);
      const wallDistAtCenter = (centerBufIdx >= 0 && centerBufIdx < numCols) ? zBuffer[centerBufIdx] : 9999;

      for (const ent of this.entities) {
        if (ent.hp > 0) {
          const dx = ent.x - px;
          const dy = ent.y - py;
          const dist = Math.hypot(dx, dy);
          let ang = Math.atan2(dy, dx) - pAngle;
          while (ang < -Math.PI) ang += 2 * Math.PI;
          while (ang > Math.PI) ang -= 2 * Math.PI;
          if (Math.abs(ang) < 0.055 && dist < wallDistAtCenter) {
            isAimingAtEnemy = true;
            break;
          }
        }
      }

      const chX = Math.floor(w / 2);
      const chY = Math.floor(h / 2);
      const chColor = isAimingAtEnemy ? '#ff3333' : '#33ff00';

      ctx.save();
      ctx.strokeStyle = chColor;
      ctx.fillStyle = chColor;
      ctx.lineWidth = 1.5;

      // 12x12 px crosshair with 2px gap at center
      ctx.beginPath();
      ctx.moveTo(chX - 7, chY);
      ctx.lineTo(chX - 2, chY);
      ctx.moveTo(chX + 2, chY);
      ctx.lineTo(chX + 7, chY);
      ctx.moveTo(chX, chY - 7);
      ctx.lineTo(chX, chY - 2);
      ctx.moveTo(chX, chY + 2);
      ctx.lineTo(chX, chY + 7);
      ctx.stroke();

      ctx.fillRect(chX - 0.5, chY - 0.5, 1, 1);
      ctx.restore();

      // 5. First-Person Weapon Model & Hands
      this.drawFPSWeapon(ctx, w, h);
    }

    /**
     * First-Person Weapon View with Procedural Bobbing & Recoil
     */
    drawFPSWeapon(ctx, w, h) {
      const isMoving = (this.player.vx !== 0 || this.player.vy !== 0);
      const bobX = isMoving ? Math.sin(this.tick * 0.18) * 8 : 0;
      const bobY = isMoving ? Math.abs(Math.cos(this.tick * 0.18)) * 6 : 0;

      const recoil = this.player.isShooting ? (1.0 - (this.player.shootProgress || 0)) * 28 : 0;
      const swingOffset = this.player.isSwinging ? Math.sin((this.player.swingProgress || 0) * Math.PI) * 75 : 0;

      const gunX = w / 2 + 55 + bobX - swingOffset;
      const gunY = h - 45 + bobY - recoil;

      const weapon = this.player.weapon || this.player.baseWeapon;
      const wId = (weapon && (weapon.id || weapon.type || weapon.gunType || weapon.name || '')).toLowerCase();
      const isRanged = weapon && (weapon.isRanged || wId.includes('shotgun') || wId.includes('rifle') || wId.includes('pistol') || wId.includes('ks23'));

      ctx.save();
      if (isRanged) {
        if (wId.includes('shotgun') || wId.includes('ks23') || wId.includes('saiga')) {
          // --- KS-23 Heavy Riot Shotgun ---
          // Heavy steel barrel
          ctx.fillStyle = '#1e2822';
          ctx.fillRect(gunX - 26, gunY - 110, 38, 130);
          ctx.fillStyle = '#2f3f35';
          ctx.fillRect(gunX - 20, gunY - 145, 26, 45);
          // Ribbed pump slide (wooden / bakelite grip)
          ctx.fillStyle = '#52341b';
          ctx.fillRect(gunX - 24, gunY - 80, 34, 32);
          for (let ry = gunY - 76; ry < gunY - 52; ry += 6) {
            ctx.fillStyle = '#3a2312';
            ctx.fillRect(gunX - 24, ry, 34, 2);
          }
          // Brass bead front sight
          ctx.fillStyle = '#ffd700';
          ctx.fillRect(gunX - 8, gunY - 148, 4, 4);
        } else {
          // --- Makarov / Pistol / Rifle ---
          ctx.fillStyle = '#1c2e22';
          ctx.fillRect(gunX - 20, gunY - 95, 32, 115);
          ctx.fillStyle = '#2d4c38';
          ctx.fillRect(gunX - 15, gunY - 130, 22, 40);
          // Green phosphor tritium sights
          ctx.fillStyle = '#1fe044';
          ctx.shadowColor = '#1fe044';
          ctx.shadowBlur = 6;
          ctx.fillRect(gunX - 6, gunY - 133, 4, 4);
        }

        // Muzzle Flash VFX
        if (this.player.isShooting && (this.player.shootProgress || 0) < 0.35) {
          ctx.fillStyle = '#fff488';
          ctx.shadowColor = '#ff9900';
          ctx.shadowBlur = 26;
          ctx.beginPath();
          ctx.arc(gunX - 6, gunY - 152, 24, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#ff6600';
          ctx.beginPath();
          ctx.moveTo(gunX - 6, gunY - 188);
          ctx.lineTo(gunX + 18, gunY - 140);
          ctx.lineTo(gunX - 28, gunY - 140);
          ctx.closePath();
          ctx.fill();

          // Sparks
          ctx.fillStyle = '#ffffff';
          for (let spk = 0; spk < 4; spk++) {
            const sx = gunX - 6 + (Math.random() - 0.5) * 40;
            const sy = gunY - 152 - Math.random() * 35;
            ctx.fillRect(sx, sy, 2, 2);
          }
        }
      } else {
        // --- Heavy Steel Pipe with Red Valve (Melee) ---
        // Massive angled pipe
        ctx.fillStyle = '#3e4e44';
        ctx.fillRect(gunX - 18, gunY - 130, 28, 150);
        // Pipe sheen highlight
        ctx.fillStyle = '#657e6e';
        ctx.fillRect(gunX - 12, gunY - 130, 8, 150);
        // Threaded joint rings
        ctx.fillStyle = '#25322b';
        ctx.fillRect(gunX - 22, gunY - 110, 36, 12);
        ctx.fillRect(gunX - 22, gunY - 40, 36, 12);
        // Red industrial valve wheel
        ctx.fillStyle = '#d62828';
        ctx.beginPath();
        ctx.arc(gunX - 4, gunY - 75, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1c221e';
        ctx.beginPath();
        ctx.arc(gunX - 4, gunY - 75, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#d62828';
        ctx.fillRect(gunX - 6, gunY - 92, 4, 34);
        ctx.fillRect(gunX - 21, gunY - 77, 34, 4);
      }
      ctx.restore();
    }

    /**
     * Dynamic Lighting & Darkness: Darkness covers the block, pierced by player flashlight & lanterns
     */
    drawDynamicDarkness(ctx, cam, w, h) {
      if (!this.darknessCanvas) {
        this.darknessCanvas = document.createElement('canvas');
      }
      if (this.darknessCanvas.width !== w || this.darknessCanvas.height !== h) {
        this.darknessCanvas.width = w;
        this.darknessCanvas.height = h;
      }
      const dctx = this.darknessCanvas.getContext('2d');

      // 1. Fill entire screen with moody bunker darkness (0.86 allows faint perception of walls/doors)
      dctx.globalCompositeOperation = 'source-over';
      dctx.fillStyle = 'rgba(2, 6, 3, 0.86)';
      dctx.fillRect(0, 0, w, h);

      // 2. Cut out light sources using destination-out
      dctx.globalCompositeOperation = 'destination-out';

      // 2a. Wall Lanterns (Wide warm room illumination)
      if (this.lamps) {
        for (const lamp of this.lamps) {
          const lx = lamp.x - cam.x;
          const ly = lamp.y - cam.y;
          if (lx > -240 && lx < w + 240 && ly > -240 && ly < h + 240) {
            const lGrad = dctx.createRadialGradient(lx, ly, 10, lx, ly, 220);
            lGrad.addColorStop(0, 'rgba(0,0,0, 1.0)');
            lGrad.addColorStop(0.5, 'rgba(0,0,0, 0.85)');
            lGrad.addColorStop(0.85, 'rgba(0,0,0, 0.4)');
            lGrad.addColorStop(1, 'rgba(0,0,0, 0.0)');
            dctx.fillStyle = lGrad;
            dctx.beginPath();
            dctx.arc(lx, ly, 220, 0, Math.PI * 2);
            dctx.fill();
          }
        }
      }

      // 2b. Player Ambient Aura (Illuminates the room around player)
      const px = this.player.x - cam.x;
      const py = this.player.y - cam.y;

      const aGrad = dctx.createRadialGradient(px, py, 12, px, py, 150);
      aGrad.addColorStop(0, 'rgba(0,0,0, 1.0)');
      aGrad.addColorStop(0.65, 'rgba(0,0,0, 0.85)');
      aGrad.addColorStop(1, 'rgba(0,0,0, 0.0)');
      dctx.fillStyle = aGrad;
      dctx.beginPath();
      dctx.arc(px, py, 150, 0, Math.PI * 2);
      dctx.fill();

      // 2c. Player Flashlight Cone (Фонарик рассеивает тьму широким лучом!)
      const pAngle = this.player.angle;
      const beamDist = 480;
      const spread = 0.65; // ~75 degree wide volumetric cone

      const fGrad = dctx.createRadialGradient(px, py, 18, px, py, beamDist);
      fGrad.addColorStop(0, 'rgba(0,0,0, 1.0)');
      fGrad.addColorStop(0.35, 'rgba(0,0,0, 0.98)');
      fGrad.addColorStop(0.75, 'rgba(0,0,0, 0.90)');
      fGrad.addColorStop(0.92, 'rgba(0,0,0, 0.45)');
      fGrad.addColorStop(1, 'rgba(0,0,0, 0.0)');
      dctx.fillStyle = fGrad;
      dctx.beginPath();
      dctx.moveTo(px, py);
      dctx.arc(px, py, beamDist, pAngle - spread, pAngle + spread);
      dctx.closePath();
      dctx.fill();

      // Reset darkness context
      dctx.globalCompositeOperation = 'source-over';

      // 3. Draw the darkness mask over main canvas
      ctx.drawImage(this.darknessCanvas, 0, 0);

      // 4. Draw volumetric beam haze & floating dust motes
      this.drawVolumetricBeamHaze(ctx, px, py, pAngle, beamDist, spread);
    }

    drawVolumetricBeamHaze(ctx, px, py, angle, dist, spread) {
      ctx.save();
      const vGrad = ctx.createRadialGradient(px, py, 15, px, py, dist);
      vGrad.addColorStop(0, 'rgba(136, 255, 158, 0.16)');
      vGrad.addColorStop(0.4, 'rgba(31, 224, 68, 0.08)');
      vGrad.addColorStop(0.85, 'rgba(11, 56, 20, 0.03)');
      vGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = vGrad;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.arc(px, py, dist, angle - spread, angle + spread);
      ctx.closePath();
      ctx.fill();

      // Dust motes in the flashlight cone
      const now = Date.now() * 0.001;
      ctx.fillStyle = 'rgba(200, 255, 210, 0.35)';
      for (let i = 0; i < 16; i++) {
        const d = 30 + ((i * 23 + now * 18) % (dist - 40));
        const offAng = (Math.sin(now + i) * spread * 0.75);
        const mx = px + Math.cos(angle + offAng) * d;
        const my = py + Math.sin(angle + offAng) * d;
        ctx.fillRect(mx, my, 1.5, 1.5);
      }
      ctx.restore();
    }

    isCellExplored(tx, ty) {
      if (!this.fogExplored || ty < 0 || ty >= this.mapData.height || tx < 0 || tx >= this.mapData.width) return false;
      return this.fogExplored[ty][tx] === 1;
    }

    drawTilesWithFog(ctx, cam, w, h) {
      if (!this.mapData || !this.mapData.grid) return;
      const TS = this.tileSize;
      const startX = Math.max(0, Math.floor(cam.x / TS));
      const endX = Math.min(this.mapData.width - 1, Math.ceil((cam.x + w) / TS));
      const startY = Math.max(0, Math.floor(cam.y / TS));
      const endY = Math.min(this.mapData.height - 1, Math.ceil((cam.y + h) / TS));

      for (let y = startY; y <= endY; y++) {
        for (let x = startX; x <= endX; x++) {
          const explored = this.fogExplored ? this.fogExplored[y][x] : 1;
          if (explored === 0) continue; // Unexplored cells are pitch black!

          const isVisible = this.fogVisible ? this.fogVisible[y][x] : 1;
          const alpha = isVisible ? 1.0 : 0.22; // Dim memory for explored distant cells

          const tile = this.mapData.grid[y][x];
          const wx = x * TS;
          const wy = y * TS;

          if (tile === 1) { // TILE_WALL
            if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawWallTile) {
              SpriteFactory.drawWallTile(ctx, wx, wy, TS, alpha);
            }
          } else { // TILE_FLOOR
            if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawFloorTile) {
              SpriteFactory.drawFloorTile(ctx, wx, wy, TS, alpha);
            }
          }
        }
      }
    }

    drawRadarHUD(ctx, w, h) {
      ctx.save();
      const cx = w / 2;
      const cy = h / 2;

      // 1. Top-Left Status Panel (РАДАР-ДЕТЕКТОР РУ-4)
      const tlX = 16;
      const tlY = 16;
      const tlW = 340;
      const tlH = 92;

      ctx.fillStyle = 'rgba(4, 20, 7, 0.94)';
      ctx.fillRect(tlX, tlY, tlW, tlH);
      ctx.strokeStyle = this.samosborActive ? '#ff3b30' : '#1fe044';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(tlX, tlY, tlW, tlH);

      // Title bar header tab
      ctx.fillStyle = 'rgba(31, 224, 68, 0.16)';
      ctx.fillRect(tlX + 1, tlY + 1, tlW - 2, 22);

      ctx.font = 'bold 11px "Share Tech Mono", monospace';
      ctx.fillStyle = this.samosborActive ? '#ff3b30' : '#1fe044';
      ctx.fillText('[ РАДАР-ДЕТЕКТОР РУ-4 ]', tlX + 14, tlY + 16);

      // Timer Display (5:00 countdown)
      const mins = Math.floor(this.levelTimeLeft / 60);
      const secs = Math.floor(this.levelTimeLeft % 60);
      const timeStr = `0${mins}:${secs < 10 ? '0' : ''}${secs}`;

      ctx.font = 'bold 12px "Share Tech Mono", monospace';
      ctx.fillStyle = this.samosborActive ? '#ff0033' : (this.levelTimeLeft < 60 ? '#ffaa00' : '#1fe044');
      ctx.fillText(this.samosborActive ? 'САМОСБОР: ПРОРЫВ БЛОКА! ⚠️' : `САМОСБОР ЧЕРЕЗ: ${timeStr}`, tlX + 14, tlY + 42);

      ctx.font = '11px monospace';
      ctx.fillStyle = '#88ff9e';
      const sectorName = (this.currentRoomName || 'ЖИЛАЯ ЯЧЕЙКА №556').toUpperCase();
      ctx.fillText(`СЕКТОР: ${sectorName.slice(0, 26)}`, tlX + 14, tlY + 60);
      ctx.fillText(`ТАЛОНЫ: ${this.player.talonsEarned}  |  XP: +${this.player.xpEarned}`, tlX + 14, tlY + 78);

      // 2. Bottom-Right CRT Telemetry Panel
      const hudW = 310;
      const hudH = 104;
      const hudX = w - hudW - 16;
      const hudY = h - hudH - 16;

      ctx.fillStyle = 'rgba(4, 20, 7, 0.94)';
      ctx.fillRect(hudX, hudY, hudW, hudH);
      ctx.strokeStyle = '#1fe044';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(hudX, hudY, hudW, hudH);

      const hpPct = Math.max(0, this.player.hp / this.player.maxHp);
      const segments = 10;
      const filled = Math.round(hpPct * segments);
      let segBar = '[';
      for (let s = 0; s < segments; s++) segBar += (s < filled) ? '||' : '  ';
      segBar += ']';

      ctx.font = 'bold 12px "Share Tech Mono", monospace';
      ctx.fillStyle = this.player.hp < 30 ? '#ff3b30' : '#1fe044';
      ctx.fillText(`HP: ${segBar} ${this.player.hp}/${this.player.maxHp}`, hudX + 16, hudY + 26);

      // Active Weapon & Ammo Telemetry
      const weapon = this.player.weapon;
      const wName = weapon ? String(weapon.name) : 'Кулаки';
      const ammoStr = (weapon && weapon.isRanged) ? `${weapon.ammo}/${weapon.maxAmmo}` : 'БЕСКОНЕЧНО (БЛИЖНИЙ БОЙ)';

      ctx.font = '11px monospace';
      ctx.fillStyle = '#88ff9e';
      ctx.fillText(`ОРУЖИЕ: ${wName.slice(0, 22)}`, hudX + 16, hudY + 50);
      ctx.fillText(`ПАТРОНЫ: ${ammoStr}`, hudX + 16, hudY + 70);
      ctx.fillText(`БРОНЯ: ${this.player.armor} DEF`, hudX + 16, hudY + 90);

      // 3. Tactical Quick Belt (ПОЯС БЫСТРОГО ДОСТУПА) - Bottom Left
      const beltW = 490;
      const beltH = 56;
      const beltX = 16;
      const beltY = h - beltH - 16;

      ctx.fillStyle = 'rgba(4, 20, 7, 0.94)';
      ctx.fillRect(beltX, beltY, beltW, beltH);
      ctx.strokeStyle = '#1fe044';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(beltX, beltY, beltW, beltH);

      // Slot 1: Primary Weapon (Extra wide so full weapon name fits cleanly)
      const slot1W = 194;
      const isSlot1 = (this.player.belt && this.player.belt.activeSlot === 1);
      ctx.fillStyle = isSlot1 ? 'rgba(31, 224, 68, 0.24)' : 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(beltX + 6, beltY + 6, slot1W, 44);
      ctx.strokeStyle = isSlot1 ? '#1fe044' : 'rgba(31, 224, 68, 0.4)';
      ctx.strokeRect(beltX + 6, beltY + 6, slot1W, 44);

      ctx.font = 'bold 10px "Share Tech Mono", monospace';
      ctx.fillStyle = isSlot1 ? '#1fe044' : '#888888';
      ctx.fillText('[1] ОСНОВНОЕ', beltX + 12, beltY + 22);
      const s1Name = this.player.belt && this.player.belt.slot1 ? String(this.player.belt.slot1.name) : 'Труба';
      const s1Ammo = this.player.belt && this.player.belt.slot1 ? (this.player.belt.slot1.isRanged ? `${this.player.belt.slot1.ammo}` : '∞') : '∞';
      ctx.font = '10px monospace';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${s1Name.slice(0, 20)} [${s1Ammo}]`, beltX + 12, beltY + 40);

      // Slot 2: Secondary / Looted Weapon
      const slot2W = 152;
      const isSlot2 = (this.player.belt && this.player.belt.activeSlot === 2);
      ctx.fillStyle = isSlot2 ? 'rgba(51, 212, 255, 0.24)' : 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(beltX + 206, beltY + 6, slot2W, 44);
      ctx.strokeStyle = isSlot2 ? '#33d4ff' : 'rgba(51, 212, 255, 0.4)';
      ctx.strokeRect(beltX + 206, beltY + 6, slot2W, 44);

      ctx.font = 'bold 10px "Share Tech Mono", monospace';
      ctx.fillStyle = isSlot2 ? '#33d4ff' : '#888888';
      ctx.fillText('[2] ЗАПАСНОЕ', beltX + 212, beltY + 22);
      const s2Name = this.player.belt && this.player.belt.slot2 ? String(this.player.belt.slot2.name) : '[ПУСТО]';
      const s2Ammo = this.player.belt && this.player.belt.slot2 ? (this.player.belt.slot2.isRanged ? `${this.player.belt.slot2.ammo}` : '∞') : '-';
      ctx.font = '10px monospace';
      ctx.fillStyle = this.player.belt && this.player.belt.slot2 ? '#ffffff' : '#666666';
      ctx.fillText(`${s2Name.slice(0, 16)} [${s2Ammo}]`, beltX + 212, beltY + 40);

      // Slot 3: Quick First-Aid Medkit
      const slot3W = 120;
      ctx.fillStyle = 'rgba(0, 45, 20, 0.55)';
      ctx.fillRect(beltX + 364, beltY + 6, slot3W, 44);
      ctx.strokeStyle = '#00ff66';
      ctx.strokeRect(beltX + 364, beltY + 6, slot3W, 44);

      ctx.font = 'bold 10px "Share Tech Mono", monospace';
      ctx.fillStyle = '#00ff66';
      ctx.fillText('[3 / Q] ПОЯС', beltX + 370, beltY + 22);
      const medCount = this.player.belt ? this.player.belt.medkits : 0;
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = medCount > 0 ? '#ffea00' : '#ff4444';
      ctx.fillText(`💉 АПТЕЧКА x${medCount}`, beltX + 370, beltY + 40);

      // 4. Interactive Prompt for Nearby Wounded NPC
      const nearbyWounded = this.getNearbyWoundedNPC();
      if (nearbyWounded) {
        const popW = 430;
        const popH = 66;
        const popX = 16;
        const popY = beltY - popH - 12;

        ctx.fillStyle = 'rgba(30, 10, 0, 0.96)';
        ctx.fillRect(popX, popY, popW, popH);
        ctx.strokeStyle = '#ffaa00';
        ctx.lineWidth = 2;
        ctx.strokeRect(popX, popY, popW, popH);

        ctx.fillStyle = '#ffaa00';
        ctx.font = 'bold 12px "Share Tech Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('⚠️ ВПЕРЕДИ РАНЕНЫЙ ЛИКВИДАТОР! ВЫБЕРИТЕ ДЕЙСТВИЕ:', cx, popY + 20);

        ctx.font = '11px monospace';
        ctx.fillStyle = '#33d4ff';
        const gunTitle = (nearbyWounded.hasWeapon && nearbyWounded.gun) ? nearbyWounded.gun.name : 'НЕТ ОРУЖИЯ';
        ctx.fillText(`[1] ЗАБРАТЬ ОРУЖИЕ (${gunTitle})`, cx - 100, popY + 44);

        ctx.fillStyle = (this.player.belt && this.player.belt.medkits > 0) ? '#00ff66' : '#ff5555';
        ctx.fillText(`[2 / Q] ВЫЛЕЧИТЬ С ПОЯСА (${this.player.belt ? this.player.belt.medkits : 0} шт.)`, cx + 115, popY + 44);
        ctx.textAlign = 'left';
      }

      // 5. 5-Second Extraction Zone Gauge & Progress Bar
      if (this.isPlayerInElevator) {
        const holdPct = Math.min(1.0, this.evacHoldTimer / this.evacHoldRequired);
        const holdSecLeft = Math.max(0, this.evacHoldRequired - this.evacHoldTimer).toFixed(1);

        ctx.fillStyle = 'rgba(0, 45, 15, 0.96)';
        ctx.fillRect(cx - 220, h - 110, 440, 52);
        ctx.strokeStyle = '#00ff66';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(cx - 220, h - 110, 440, 52);

        // Progress bar track & fill
        ctx.fillStyle = '#061a0b';
        ctx.fillRect(cx - 200, h - 76, 400, 10);
        ctx.fillStyle = '#1fe044';
        ctx.fillRect(cx - 200, h - 76, Math.round(400 * holdPct), 10);

        ctx.fillStyle = '#88ff9e';
        ctx.font = 'bold 13px "Share Tech Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`⚡ УДЕРЖАНИЕ ШАХТЫ ЭВАКУАЦИИ: ${holdSecLeft}с... ⚡`, cx, h - 86);
        ctx.textAlign = 'left';
      }

      // 6. CRT Scanlines
      ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
      for (let y = 0; y < h; y += 4) {
        ctx.fillRect(0, y, w, 1.5);
      }

      ctx.restore();
    }

    drawCRTCollapse(ctx, w, h) {
      ctx.save();
      const p = Math.min(1.0, this.collapseProgress);

      if (p < 0.6) {
        const curH = h * (1 - p / 0.6);
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, (h - curH) / 2);
        ctx.fillRect(0, (h + curH) / 2, w, (h - curH) / 2);
      } else {
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
