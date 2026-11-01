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
        type: 'player',
        isPlayer: true,
        damageFlashTimer: 0,
        isDead: false,
        isSwinging: false,
        swingProgress: 0,
        // Equipped weapon from base inventory
        baseWeapon: { id: 'pipe', name: 'Тяжелая водопроводная труба', dmg: 28, isRanged: false, ammo: Infinity },
        weapon: null
      };

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
        this.spawnFloatingNotice(`[1] ${this.player.weapon.name.toUpperCase()}`, '#88ff9e');
      } else if (slotNum === 2) {
        if (!this.player.belt.slot2) {
          this.spawnFloatingNotice('СЛОТ 2 [ПУСТО]', '#888888');
          if (typeof RadarAudio !== 'undefined') RadarAudio.playBuzzer();
          return;
        }
        this.player.belt.activeSlot = 2;
        this.player.weapon = this.player.belt.slot2;
        if (typeof RadarAudio !== 'undefined') RadarAudio.playWeaponSwitch();
        this.spawnFloatingNotice(`[2] ${this.player.weapon.name.toUpperCase()}`, '#33d4ff');
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
      this.spawnFloatingNotice(`⚡ ЗАБРАНО ОРУЖИЕ: ${takenGun.name.toUpperCase()} [${takenGun.ammo}]`, '#33d4ff');
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
      if (typeof LevelGen !== 'undefined') {
        this.mapData = LevelGen.generate();
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
      this.player.isSwinging = false;
      this.isCollapsing = false;
      this.collapseProgress = 0;

      this.crates = this.mapData.lootCrates || [];
      this.weaponDrops = this.mapData.weaponDrops || [];
      this.doors = this.mapData.doors || [];
      this.elevator = this.mapData.elevator || { x: 500, y: 500, w: 32, h: 32 };
      this.lamps = this.mapData.lamps || [];

      // Initialize Entities (33 Monster Archetypes from manifest / levelGen)
      this.entities = [];
      (this.mapData.mutantSpawns || []).forEach((m, idx) => {
        this.entities.push({
          id: `mutant_${idx}`,
          type: 'monster',
          monsterId: m.monsterId || m.archetype || 'mold_crawler',
          archetype: m.archetype || m.monsterId || 'mold_crawler',
          name: m.name || 'Мутант',
          tier: m.tier || 'common',
          x: m.x,
          y: m.y,
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
          lastSpitTime: 0,
          lastSpawnTime: 0
        });
      });

      // Patrol Liquidators (Allies)
      const liquidatorGuns = [
        { id: 'ak_carbine', name: 'Автомат АК-74У', dmg: 28, ammo: 45, maxAmmo: 45, isRanged: true, gunType: 'rifle' },
        { id: 'shotgun', name: 'Дробовик КС-23', dmg: 65, ammo: 14, maxAmmo: 14, isRanged: true, gunType: 'shotgun' },
        { id: 'pm_gun', name: 'Пистолет Макарова', dmg: 32, ammo: 24, maxAmmo: 24, isRanged: true, gunType: 'pistol' }
      ];

      (this.mapData.patrolSpawns || []).forEach((p, idx) => {
        const gunPreset = Object.assign({}, liquidatorGuns[idx % liquidatorGuns.length]);
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
          isWounded: false,
          hasWeapon: true,
          gun: gunPreset,
          isLoyalFollower: false,
          attackCooldown: Math.floor(Math.random() * 20),
          callForHelpTimer: 0,
          state: 'PATROL',
          stateTimer: 0,
          wanderTarget: { x: p.x, y: p.y },
          damageFlashTimer: 0,
          phosphorAlpha: 0.3
        });
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

          // Check if hovering over any hostile monster
          this.mouse.isOverEnemy = this.entities.some(ent => {
            if (ent.type === 'liquidator') return false;
            return Math.hypot(ent.x - this.mouse.worldX, ent.y - this.mouse.worldY) < ent.radius + 12;
          });
        });

        this.canvas.addEventListener('mousedown', (e) => {
          if (!this.isRunning) return;
          if (e.button === 0) {
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

    loop() {
      if (!this.isRunning) return;
      this.tick++;

      this.update();
      this.render();

      this.animFrameId = requestAnimationFrame(this.loop);
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
        const bounty = (monster.type === 'brute') ? 35 : ((monster.type === 'spitter') ? 25 : 15);
        const xp = bounty + 10;
        this.player.talonsEarned += bounty;
        this.player.xpEarned += xp;
        this.spawnFloatingNotice(`+${bounty} ТАЛОНОВ, +${xp} XP`, '#ffd700');
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

      // 1. Doors
      for (const d of this.doors) {
        if (Math.hypot(this.player.x - d.x, this.player.y - d.y) < 45) {
          d.isOpen = !d.isOpen;
          if (typeof RadarAudio !== 'undefined') RadarAudio.playDoorToggle(d.isOpen);
          this.spawnFloatingNotice(d.isOpen ? 'ГЕРМОДВЕРЬ ОТКРЫТА' : 'ГЕРМОДВЕРЬ ЗАКРЫТА', '#ffaa00');
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

    pickupWeapon(drop) {
      drop.pickedUp = true;
      const newGun = {
        id: drop.gunId,
        name: drop.name,
        dmg: drop.dmg,
        isRanged: true,
        ammo: drop.ammo,
        maxAmmo: drop.maxAmmo,
        gunType: drop.gunType
      };
      if (this.player.belt) {
        this.player.belt.slot2 = newGun;
        this.player.belt.activeSlot = 2;
        this.player.weapon = this.player.belt.slot2;
      } else {
        this.player.weapon = newGun;
      }
      if (typeof RadarAudio !== 'undefined') RadarAudio.playLootPickup();
      this.spawnFloatingNotice(`⚡ ПОДОБРАН В СЛОТ 2: ${drop.name.toUpperCase()} [${drop.ammo}]`, '#33d4ff');
    }

    openCrate(crate) {
      crate.opened = true;
      if (typeof RadarAudio !== 'undefined') RadarAudio.playLootPickup();

      if (crate.type === 'ammo') {
        if (this.player.weapon && this.player.weapon.isRanged) {
          this.player.weapon.ammo += crate.amount || 18;
          this.spawnFloatingNotice(`+${crate.amount || 18} ПАТРОНОВ`, '#33d4ff');
        } else {
          this.spawnFloatingNotice('ПАТРОНЫ [НУЖНО ОГНЕСТРЕЛЬНОЕ ОРУЖИЕ]', '#888888');
        }
      } else {
        this.player.talonsEarned += crate.amount || 30;
        this.player.xpEarned += 20;
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 25);
        if (this.player.belt && this.player.belt.medkits < this.player.belt.maxMedkits) {
          this.player.belt.medkits++;
          this.spawnFloatingNotice(`+${crate.amount || 30} ТАЛОНОВ, +25 HP, +1 АПТЕЧКА НА ПОЯС`, '#f5a623');
        } else {
          this.spawnFloatingNotice(`+${crate.amount || 30} ТАЛОНОВ, +25 HP`, '#f5a623');
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

      // 3. Melee swing animation decay
      if (this.player.isSwinging) {
        this.player.swingProgress += 0.16;
        if (this.player.swingProgress >= 1.0) {
          this.player.isSwinging = false;
        }
      }

      // 4. Player Input Movement & Inertia
      let moveX = 0, moveY = 0;
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
        this.isCollapsing = true;
        if (typeof RadarAudio !== 'undefined') RadarAudio.playPlayerHurt();
        setTimeout(() => this.finishRaid(false), 1400);
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
      this.isCollapsing = true;
      if (typeof RadarAudio !== 'undefined') RadarAudio.playLootPickup();
      setTimeout(() => this.finishRaid(true), 1300);
    }

    /**
     * End of Raid: Death vs Evacuation
     */
    finishRaid(won) {
      this.stop();

      const earnedXP = won ? (this.player.xpEarned + 60) : Math.floor(this.player.xpEarned * 0.4);
      const earnedTalons = won ? (this.player.talonsEarned + 100) : 0; // If dead, all loot is lost!

      // Credit rewards to player account
      if (typeof clientMe !== 'undefined' && clientMe) {
        clientMe.xp = (clientMe.xp || 0) + earnedXP;
        if (won) {
          clientMe.talons = (clientMe.talons || 0) + earnedTalons;
        }
      }

      // Show summary popup
      this.showRaidSummaryModal(won, earnedTalons, earnedXP);

      if (typeof socket !== 'undefined' && socket) {
        socket.emit('terminalError', won
          ? `🏆 ЭВАКУАЦИЯ УСПЕШНА! Сохранено талонов: +${earnedTalons}, получено: +${earnedXP} XP.`
          : `☠️ ЛИКВИДАТОР ПОГИБ. Все найденные талоны потеряны. Получено опыта: +${earnedXP} XP.`
        );
      }
    }

    showRaidSummaryModal(won, talons, xp) {
      let modal = document.getElementById('raid-summary-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'raid-summary-modal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '100050';
        modal.style.background = 'rgba(0, 8, 4, 0.94)';
        modal.style.display = 'flex';
        modal.style.justifyContent = 'center';
        modal.style.alignItems = 'center';
        document.body.appendChild(modal);
      } else {
        modal.style.display = 'flex';
      }

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
          <button onclick="document.getElementById('raid-summary-modal').style.display='none'; closeRadarRoguelikeModal();" style="width: 100%; padding: 10px; font-family: inherit; font-size: 14px; font-weight: bold; background: rgba(31,224,68,0.2); border: 2px solid #1fe044; color: #1fe044; cursor: pointer;">
            ВЕРНУТЬСЯ В ЖИЛЯЧЕЙКУ
          </button>
        </div>
      `;
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
        if (this.mapData.grid[ty][tx] === 1) return true;

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
      const now = Date.now();

      for (const e of this.entities) {
        if (e.damageFlashTimer > 0) e.damageFlashTimer--;

        // Visibility relative to radar & fog of war
        const distToPlayer = Math.hypot(px - e.x, py - e.y);
        const angleToE = Math.atan2(e.y - py, e.x - px);
        let normAng = angleToE < 0 ? angleToE + Math.PI * 2 : angleToE;
        let diff = Math.abs(normAng - this.radarAngle);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;

        if (diff < 0.22 || distToPlayer < 220) {
          e.phosphorAlpha = 1.0;
        } else {
          e.phosphorAlpha = Math.max(0.04, (e.phosphorAlpha || 1.0) - 0.007);
        }

        // Entity AI Behavior
        if (e.type !== 'liquidator') {
          const isSpitter = (e.behavior === 'ranged_spit' || e.behavior === 'acid_spurt' || e.archetype === 'spitter' || e.archetype === 'toksichniy_plevun');
          if (isSpitter) {
            // Spitter worm / toxic spitter: keeps distance (160..240px) and spits acid projectiles
            if (distToPlayer < 260) {
              const ang = Math.atan2(py - e.y, px - e.x);
              e.angle = ang;
              if (distToPlayer < 140) {
                // Back up
                e.vx = -Math.cos(ang) * e.speed;
                e.vy = -Math.sin(ang) * e.speed;
              } else {
                e.vx = 0; e.vy = 0;
              }

              // Spit acid projectile
              if (now - (e.lastSpitTime || 0) > 2100) {
                e.lastSpitTime = now;
                if (typeof RadarAudio !== 'undefined') RadarAudio.playAcidSpit();
                this.projectiles.push({
                  x: e.x + Math.cos(ang) * 16,
                  y: e.y + Math.sin(ang) * 16,
                  vx: Math.cos(ang) * 7.5,
                  vy: Math.sin(ang) * 7.5,
                  damage: e.dmg || 20,
                  isPlayer: false,
                  life: 45,
                  color: '#88ff00'
                });
              }
            }
          } else {
            // Standard Chase / Wander logic
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
                e.vx = 0; e.vy = 0;
              }

              const aggroDist = (e.tier === 'boss' || e.tier === 'elite' || e.behavior === 'leap_ambush') ? 260 : 190;
              if (distToPlayer < aggroDist) {
                e.state = 'CHASE';
              }
            } else if (e.state === 'CHASE') {
              // Find closest target between player and active liquidator allies
              let tgtX = px;
              let tgtY = py;
              let tgtDist = distToPlayer;
              let tgtAlly = null;

              for (const ally of this.entities) {
                if (ally.type === 'liquidator' && ally.hp > 0) {
                  const dAlly = Math.hypot(ally.x - e.x, ally.y - e.y);
                  if (dAlly < tgtDist) {
                    tgtDist = dAlly;
                    tgtX = ally.x;
                    tgtY = ally.y;
                    tgtAlly = ally;
                  }
                }
              }

              const ang = Math.atan2(tgtY - e.y, tgtX - e.x);
              let moveSpeed = e.speed;
              if (e.behavior === 'leap_ambush' && tgtDist < 90) {
                moveSpeed *= 1.6; // Rapid lunge!
              }
              e.vx = Math.cos(ang) * moveSpeed;
              e.vy = Math.sin(ang) * moveSpeed;
              e.angle = ang;

              if (tgtAlly) {
                if (tgtDist < e.radius + tgtAlly.radius + 4) {
                  tgtAlly.hp = Math.max(0, tgtAlly.hp - (e.dmg || 18));
                  tgtAlly.damageFlashTimer = 10;
                  if (tgtAlly.hp <= 45) tgtAlly.isWounded = true;
                  e.vx *= -1.5;
                  e.vy *= -1.5;
                  this.spawnHitParticles(tgtAlly.x, tgtAlly.y, '#33d4ff', 6);
                  if (typeof RadarAudio !== 'undefined') RadarAudio.playMonsterHurt();
                }
              } else {
                if (distToPlayer < e.radius + this.player.radius + 4) {
                  this.damagePlayer(e.dmg || 18, e.name);
                  e.vx *= -1.5;
                  e.vy *= -1.5;
                }
              }
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
     * Master Render
     */
    render() {
      const ctx = this.ctx;
      const w = this.canvas.width;
      const h = this.canvas.height;
      const cam = this.getCameraOffset();

      // Deep solid darkness background
      ctx.fillStyle = '#020503';
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.translate(-cam.x, -cam.y);

      // 1. Draw Map Tiles with Fog of War
      this.drawTilesWithFog(ctx, cam, w, h);

      // 2. Draw Airtight Doors
      for (const door of this.doors) {
        if (this.isCellExplored(door.tileX, door.tileY)) {
          if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawDoorTile) {
            SpriteFactory.drawDoorTile(ctx, door, this.tileSize, 1.0);
          }
        }
      }

      // 2b. Draw Wall Lanterns ("Фонари") with warm amber glow
      if (this.lamps) {
        for (const lamp of this.lamps) {
          if (this.isCellExplored(lamp.tileX, lamp.tileY)) {
            if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawWallLamp) {
              SpriteFactory.drawWallLamp(ctx, lamp, this.tileSize, this.tick, 1.0);
            }
          }
        }
      }

      // 3. Draw Loot Crates
      for (const crate of this.crates) {
        if (this.isCellExplored(crate.tileX, crate.tileY)) {
          if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawLootCrate) {
            SpriteFactory.drawLootCrate(ctx, crate, this.tileSize, this.tick, crate.phosphorAlpha || 0.8);
          }
        }
      }

      // 4. Draw Dropped Firearms
      for (const drop of this.weaponDrops) {
        if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawDroppedWeapon) {
          SpriteFactory.drawDroppedWeapon(ctx, drop, this.tileSize, this.tick, drop.phosphorAlpha || 0.8);
        }
      }

      // 5. Draw Extraction Elevator Shaft
      if (this.elevator && this.isCellExplored(this.elevator.tileX, this.elevator.tileY)) {
        if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawElevatorShaft) {
          SpriteFactory.drawElevatorShaft(ctx, this.elevator, this.tileSize, this.tick, 1.0);
        }
      }

      // 6. Draw Projectiles
      for (const p of this.projectiles) {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }

      // 7. Draw Melee Swing Slash Arc
      if (this.player.isSwinging && typeof SpriteFactory !== 'undefined' && SpriteFactory.drawMeleeSwingArc) {
        SpriteFactory.drawMeleeSwingArc(ctx, this.player.x, this.player.y, this.player.angle, this.player.swingProgress);
      }

      // 8. Draw AI Entities
      for (const e of this.entities) {
        if (typeof SpriteFactory !== 'undefined') {
          SpriteFactory.drawEntity(ctx, e, this.tick);
        }
      }

      // 9. Draw Player
      if (typeof SpriteFactory !== 'undefined') {
        SpriteFactory.drawEntity(ctx, this.player, this.tick);
      }

      // 10. Particles & Floating Text
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

      // 11. Dynamic Darkness & Volumetric Flashlight (Тьма отступает при свете фонарика!)
      this.drawDynamicDarkness(ctx, cam, w, h);

      // 12. Draw Tactical HUD & Crosshair
      this.drawRadarHUD(ctx, w, h);

      // 13. Draw Tactical CRT Crosshair at mouse position
      if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawCrosshair) {
        SpriteFactory.drawCrosshair(ctx, this.mouse.x, this.mouse.y, this.tick, this.mouse.isOverEnemy);
      }

      // 14. CRT Collapse on Game Over / Victory
      if (this.isCollapsing) {
        this.drawCRTCollapse(ctx, w, h);
      }
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

      // 1. Fill entire screen with near-pitch darkness
      dctx.globalCompositeOperation = 'source-over';
      dctx.fillStyle = 'rgba(2, 6, 3, 0.985)';
      dctx.fillRect(0, 0, w, h);

      // 2. Cut out light sources using destination-out
      dctx.globalCompositeOperation = 'destination-out';

      // 2a. Wall Lanterns
      if (this.lamps) {
        for (const lamp of this.lamps) {
          const lx = lamp.x - cam.x;
          const ly = lamp.y - cam.y;
          if (lx > -180 && lx < w + 180 && ly > -180 && ly < h + 180) {
            const lGrad = dctx.createRadialGradient(lx, ly, 8, lx, ly, 170);
            lGrad.addColorStop(0, 'rgba(0,0,0, 1.0)');
            lGrad.addColorStop(0.5, 'rgba(0,0,0, 0.75)');
            lGrad.addColorStop(1, 'rgba(0,0,0, 0.0)');
            dctx.fillStyle = lGrad;
            dctx.beginPath();
            dctx.arc(lx, ly, 170, 0, Math.PI * 2);
            dctx.fill();
          }
        }
      }

      // 2b. Player Ambient Aura
      const px = this.player.x - cam.x;
      const py = this.player.y - cam.y;

      const aGrad = dctx.createRadialGradient(px, py, 6, px, py, 62);
      aGrad.addColorStop(0, 'rgba(0,0,0, 1.0)');
      aGrad.addColorStop(0.7, 'rgba(0,0,0, 0.85)');
      aGrad.addColorStop(1, 'rgba(0,0,0, 0.0)');
      dctx.fillStyle = aGrad;
      dctx.beginPath();
      dctx.arc(px, py, 62, 0, Math.PI * 2);
      dctx.fill();

      // 2c. Player Flashlight Cone (Фонарик рассеивает тьму вперед!)
      const pAngle = this.player.angle;
      const beamDist = 385;
      const spread = 0.45; // ~52 degree wide volumetric cone

      const fGrad = dctx.createRadialGradient(px, py, 16, px, py, beamDist);
      fGrad.addColorStop(0, 'rgba(0,0,0, 1.0)');
      fGrad.addColorStop(0.3, 'rgba(0,0,0, 0.98)');
      fGrad.addColorStop(0.75, 'rgba(0,0,0, 0.92)');
      fGrad.addColorStop(0.92, 'rgba(0,0,0, 0.5)');
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

      // 1. Top-Left Status Panel
      ctx.fillStyle = 'rgba(4, 20, 7, 0.9)';
      ctx.fillRect(16, 16, 330, 80);
      ctx.strokeStyle = this.samosborActive ? '#ff3b30' : '#1fe044';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(16, 16, 330, 80);

      // Timer Display (5:00 countdown)
      const mins = Math.floor(this.levelTimeLeft / 60);
      const secs = Math.floor(this.levelTimeLeft % 60);
      const timeStr = `0${mins}:${secs < 10 ? '0' : ''}${secs}`;

      ctx.fillStyle = this.samosborActive ? '#ff0033' : (this.levelTimeLeft < 60 ? '#ffaa00' : '#1fe044');
      ctx.font = 'bold 13px "Share Tech Mono", monospace';
      ctx.fillText(this.samosborActive ? '⚠️ САМОСБОР ПРОРВАЛ БЛОК!' : `⏰ ДО САМОСБОРА: ${timeStr}`, 28, 36);

      ctx.fillStyle = '#88ff9e';
      ctx.font = '11px monospace';
      ctx.fillText(`СЕКТОР: [ ${this.currentRoomName.toUpperCase()} ]`, 28, 56);
      ctx.fillText(`ДОБЫЧА: +${this.player.talonsEarned} ТАЛОНОВ | +${this.player.xpEarned} XP`, 28, 76);

      // 2. Bottom-Right CRT Telemetry Panel
      const hudW = 310;
      const hudH = 100;
      const hudX = w - hudW - 16;
      const hudY = h - hudH - 16;

      ctx.fillStyle = 'rgba(4, 20, 7, 0.9)';
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
      ctx.fillText(`HP: ${segBar} ${this.player.hp}/${this.player.maxHp}`, hudX + 14, hudY + 28);

      // Active Weapon & Ammo Telemetry
      const weapon = this.player.weapon;
      const wName = weapon ? weapon.name : 'Кулаки';
      const ammoStr = (weapon && weapon.isRanged) ? `${weapon.ammo}/${weapon.maxAmmo}` : 'БЕСКОНЕЧНО (БЛИЖНИЙ БОЙ)';

      ctx.font = '11px monospace';
      ctx.fillStyle = '#88ff9e';
      ctx.fillText(`ОРУЖИЕ: ${wName}`, hudX + 14, hudY + 52);
      ctx.fillText(`ПАТРОНЫ: ${ammoStr}`, hudX + 14, hudY + 72);
      ctx.fillText(`БРОНЯ: ${this.player.armor} DEF`, hudX + 14, hudY + 90);

      // 3. Tactical Quick Belt (ПОЯС БЫСТРОГО ДОСТУПА) - Bottom Center
      const beltW = 400;
      const beltH = 52;
      const beltX = cx - beltW / 2;
      const beltY = h - beltH - 16;

      ctx.fillStyle = 'rgba(4, 20, 7, 0.92)';
      ctx.fillRect(beltX, beltY, beltW, beltH);
      ctx.strokeStyle = '#1fe044';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(beltX, beltY, beltW, beltH);

      // Slot 1: Primary Weapon
      const slot1W = 130;
      const isSlot1 = (this.player.belt && this.player.belt.activeSlot === 1);
      ctx.fillStyle = isSlot1 ? 'rgba(31, 224, 68, 0.24)' : 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(beltX + 6, beltY + 6, slot1W, 40);
      ctx.strokeStyle = isSlot1 ? '#1fe044' : 'rgba(31, 224, 68, 0.4)';
      ctx.strokeRect(beltX + 6, beltY + 6, slot1W, 40);

      ctx.font = 'bold 10px "Share Tech Mono", monospace';
      ctx.fillStyle = isSlot1 ? '#1fe044' : '#888888';
      ctx.fillText('[1] ОСНОВНОЕ', beltX + 10, beltY + 20);
      const s1Name = this.player.belt && this.player.belt.slot1 ? this.player.belt.slot1.name : 'Труба';
      const s1Ammo = this.player.belt && this.player.belt.slot1 ? (this.player.belt.slot1.isRanged ? `${this.player.belt.slot1.ammo}` : '∞') : '∞';
      ctx.font = '9px monospace';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${s1Name.slice(0, 15)} [${s1Ammo}]`, beltX + 10, beltY + 36);

      // Slot 2: Secondary / Looted Weapon
      const isSlot2 = (this.player.belt && this.player.belt.activeSlot === 2);
      ctx.fillStyle = isSlot2 ? 'rgba(51, 212, 255, 0.24)' : 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(beltX + 142, beltY + 6, slot1W, 40);
      ctx.strokeStyle = isSlot2 ? '#33d4ff' : 'rgba(51, 212, 255, 0.4)';
      ctx.strokeRect(beltX + 142, beltY + 6, slot1W, 40);

      ctx.font = 'bold 10px "Share Tech Mono", monospace';
      ctx.fillStyle = isSlot2 ? '#33d4ff' : '#888888';
      ctx.fillText('[2] ЗАПАСНОЕ', beltX + 146, beltY + 20);
      const s2Name = this.player.belt && this.player.belt.slot2 ? this.player.belt.slot2.name : '[ПУСТО]';
      const s2Ammo = this.player.belt && this.player.belt.slot2 ? (this.player.belt.slot2.isRanged ? `${this.player.belt.slot2.ammo}` : '∞') : '-';
      ctx.font = '9px monospace';
      ctx.fillStyle = this.player.belt && this.player.belt.slot2 ? '#ffffff' : '#666666';
      ctx.fillText(`${s2Name.slice(0, 15)} [${s2Ammo}]`, beltX + 146, beltY + 36);

      // Slot 3: Quick First-Aid Medkit
      const slot3W = 112;
      ctx.fillStyle = 'rgba(0, 45, 20, 0.55)';
      ctx.fillRect(beltX + 278, beltY + 6, slot3W, 40);
      ctx.strokeStyle = '#00ff66';
      ctx.strokeRect(beltX + 278, beltY + 6, slot3W, 40);

      ctx.font = 'bold 10px "Share Tech Mono", monospace';
      ctx.fillStyle = '#00ff66';
      ctx.fillText('[3 / Q] ПОЯС', beltX + 282, beltY + 20);
      const medCount = this.player.belt ? this.player.belt.medkits : 0;
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = medCount > 0 ? '#ffea00' : '#ff4444';
      ctx.fillText(`💉 АПТЕЧКА x${medCount}`, beltX + 282, beltY + 36);

      // 4. Interactive Prompt for Nearby Wounded NPC
      const nearbyWounded = this.getNearbyWoundedNPC();
      if (nearbyWounded) {
        const popW = 430;
        const popH = 66;
        const popX = cx - popW / 2;
        const popY = beltY - popH - 14;

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
