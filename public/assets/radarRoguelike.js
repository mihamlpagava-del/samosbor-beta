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
      this.emergencySiegeActive = false;
      this.siegeTriggered = false;
      this.siegeSurvived = false;
      this.siegeTimer = 300;
      this.siegePrepTimer = 15;
      this.siegeBarricades = [];
      this.explosiveBarrels = [];
      this.elevatorTerminal = null;
      this.vokhrCrate = null;
      this.siegeAlertBanner = null;
      this.bossSpawned = false;
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
    this.emergencySiegeActive = false;
    this.siegeTriggered = false;
    this.siegeSurvived = false;
    this.siegeTimer = 300;
    this.siegePrepTimer = 15;
    this.siegeBarricades = [];
    this.explosiveBarrels = [];
    this.elevatorTerminal = null;
    this.vokhrCrate = null;
    this.siegeAlertBanner = null;
    this.bossSpawned = false;
    this.siegeSpawnTimer = 0;
    this.forceEmergencySiege = false;
      this.doors = [];
      this.elevator = null;
      this.decals = [];
      this.lightSources = [];
      this.screenFlashTimer = 0;
      this.screenShakeTimer = 0;
      this.screenShakeIntensity = 0;
      this.bobTimer = 0;

      // Controls & Mouse
      this.keys = {};
      this.mouse = { x: 0, y: 0, worldX: 0, worldY: 0, isDown: false, isOverEnemy: false };
      this.isPointerLocked = false;
      this.currentRoomName = 'Жилая ячейка №556';
      this.lastAttackTime = 0;
      this.touchMoveVector = { x: 0, y: 0, active: false };
      this.touchTurnDirection = 0;
      this.isHUDHidden = false;
      this.isTouchControlsActive = false;

      // CRT Collapse Animation
      this.isCollapsing = false;
      this.collapseProgress = 0;

      this.onExitCallback = null;
    }

    init(canvasElement, onExit) {
      this.canvas = canvasElement;
      window.radarRoguelikeGame = this;
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

    toggleBeltSlot() {
      if (!this.player.belt) return;
      const current = this.player.belt.activeSlot || 1;
      const target = (current === 1) ? 2 : 1;
      if (target === 2 && !this.player.belt.slot2) {
        this.switchBeltSlot(1);
      } else {
        this.switchBeltSlot(target);
      }
    }

    toggleHUDVisibility() {
      const now = Date.now();
      if (this.lastHUDToggleTime && (now - this.lastHUDToggleTime < 250)) {
        return;
      }
      this.lastHUDToggleTime = now;
      this.isHUDHidden = !this.isHUDHidden;
      this.spawnFloatingNotice(
        this.isHUDHidden ? '👁️ ИНТЕРФЕЙС: СКРЫТ [I]' : '👁️ ИНТЕРФЕЙС: ВКЛ [I]',
        this.isHUDHidden ? '#ffcc00' : '#00ffaa'
      );
      const raidBtn = document.getElementById('btn-toggle-gamepad-raid');
      const audioToggles = document.querySelector('.raid-audio-toggles');
      const abortBtn = document.getElementById('btn-radar-abort');
      const touchOverlay = document.getElementById('radar-touch-overlay');
      const displayVal = this.isHUDHidden ? 'none' : '';
      if (raidBtn) raidBtn.style.display = displayVal;
      if (audioToggles) audioToggles.style.display = displayVal;
      if (abortBtn) abortBtn.style.display = displayVal;
      if (touchOverlay) {
        if (this.isHUDHidden) touchOverlay.style.display = 'none';
        else if (this.isTouchControlsActive) touchOverlay.style.display = 'block';
      }
    }

    toggleCameraMode() {
      if (this.cameraMode === 'TDS') {
        this.cameraMode = 'FPS';
        if (!this.isTouchControlsActive) {
          try { this.canvas.requestPointerLock(); } catch(err){}
        }
        this.spawnFloatingNotice('📷 КАМЕРА: [FPS 3D]', '#00ffaa');
      } else {
        this.cameraMode = 'TDS';
        if (document.pointerLockElement === this.canvas) {
          try { document.exitPointerLock(); } catch(err){}
        }
        this.spawnFloatingNotice('📷 КАМЕРА: [TDS 2D]', '#00ffaa');
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
        this.mapData = LevelGen.generate(pLvl, this.currentRaidFloor || 1, this.mapSeed || null);
      } else {
        return;
      }

      const W = this.mapData.width;
      const H = this.mapData.height;
      this.tileSize = this.mapData.tileSize || 32;

      // Initialize Fog of War
      this.fogExplored = Array(H).fill(null).map(() => new Uint8Array(W));
      this.fogVisible = Array(H).fill(null).map(() => new Uint8Array(W));
      // Environmental Lore & Interactive Dungeon Traps
      this.recorders = this.mapData.recorders || [];
      this.wallNotes = this.mapData.wallNotes || [];
      this.electricTraps = this.mapData.electricTraps || [];
      this.fleshVents = this.mapData.fleshVents || [];
      this.activeTapeSubtitle = null;
      this.activeWallNoteCard = null;
      this.floorMultiplier = (this.currentRaidFloor === 2 ? 1.5 : (this.currentRaidFloor === 3 ? 2.0 : (this.currentRaidFloor >= 4 ? 3.0 : 1.0)));
      this.lootDisplayTalons = this.player.talonsEarned || 0;
      this.lootFlashTimer = 0;
      this.blueDamageFlash = 0;


      // Reset Timers
      this.levelTimeLeft = 300.0;
      this.samosborActive = false;
      this.evacHoldTimer = 0;
      this.emergencySiegeActive = false;
      this.siegeTriggered = false;
      this.siegeSurvived = false;
      this.siegeTimer = 300;
      this.siegePrepTimer = 15;
      this.siegeBarricades = [];
      this.explosiveBarrels = [];
      this.elevatorTerminal = null;
      this.vokhrCrate = null;
      this.siegeAlertBanner = null;
      this.bossSpawned = false;
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
      this.barrels = (this.mapData.explosiveBarrels || []).map(b => Object.assign({}, b, { exploded: false }));
      this.weaponDrops = this.mapData.weaponDrops || [];
      this.doors = this.mapData.doors || [];
      this.elevator = this.mapData.elevator || { x: 500, y: 500, w: 64, h: 64 };
      this.lamps = this.mapData.lamps || [];
      this.decals = [];
      this.lightSources = [];

      // Initialize Dynamic Map Light Sources (Emergency Red, Warm Amber & Sparking Panels)
      for (let li = 0; li < this.lamps.length; li++) {
        const lamp = this.lamps[li];
        const isRed = (lamp.tileX % 3 === 0);
        this.lightSources.push({
          type: isRed ? 'emergency_lamp' : 'amber_lamp',
          x: lamp.x,
          y: lamp.y,
          tileX: lamp.tileX,
          tileY: lamp.tileY,
          color: isRed ? '#ff3b30' : '#ffaa22',
          rgb: isRed ? [255, 59, 48] : [255, 170, 34],
          radius: isRed ? 125 : 135,
          baseRadius: isRed ? 125 : 135,
          intensity: isRed ? 0.9 : 0.82,
          flicker: true
        });
      }

      // Add 2-4 Sparking Electrical Panels in corridors
      if (this.mapData.corridorPoints && this.mapData.corridorPoints.length > 0) {
        const cpLen = this.mapData.corridorPoints.length;
        const panelCount = Math.min(4, Math.max(2, Math.floor(cpLen / 25)));
        for (let pi = 0; pi < panelCount; pi++) {
          const pt = this.mapData.corridorPoints[(pi * 31 + 7) % cpLen];
          this.lightSources.push({
            type: 'sparking_panel',
            x: pt.x * this.tileSize + this.tileSize / 2,
            y: pt.y * this.tileSize + 6,
            tileX: pt.x,
            tileY: pt.y,
            color: '#aaddff',
            rgb: [170, 221, 255],
            radius: 85,
            baseRadius: 85,
            intensity: 0.25,
            flicker: true,
            isSparking: false,
            sparkTimer: 20 + Math.random() * 80
          });
        }
      }

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

        // Close Wall Note Document if open
        if (this.activeWallNoteCard) {
          if (e.code === 'KeyE' || e.code === 'Escape' || e.code === 'Space') {
            this.activeWallNoteCard = null;
            return;
          }
        }

        // Struggle free from Tentacle Grate Trap on Space / F
        if (e.code === 'Space' || e.code === 'KeyF') {
          for (const trap of (this.fleshVents || [])) {
            if (trap.entangled) {
              trap.entangled = false;
              trap.dormantTimer = 30.0;
              this.spawnFloatingNotice('ВЫ ВЫРВАЛИСЬ ИЗ ЩУПАЛЕЦ!', '#ffd700');
              if (typeof RadarAudio !== 'undefined' && RadarAudio.playKickMelee) {
                RadarAudio.playKickMelee(true);
              }
            }
          }
        }

        if (e.code === 'Digit1' || e.code === 'Numpad1' || e.key === '1') {
          const elevDist = this.elevator ? Math.hypot(this.player.x - (this.elevator.x + 32), this.player.y - (this.elevator.y + 32)) : 999;
          if ((this.isPlayerInElevator || elevDist < 68) && !this.emergencySiegeActive && !this.isEvacuating) {
            e.preventDefault();
            this.evacuateSuccess();
            return;
          }
          const nearbyWounded = this.getNearbyWoundedNPC();
          if (nearbyWounded && nearbyWounded.hasWeapon) {
            this.takeWeaponFromNPC(nearbyWounded);
          } else {
            this.switchBeltSlot(1);
          }
        }
        if (e.code === 'Digit2' || e.code === 'Numpad2' || e.key === '2') {
          const elevDist = this.elevator ? Math.hypot(this.player.x - (this.elevator.x + 32), this.player.y - (this.elevator.y + 32)) : 999;
          if ((this.isPlayerInElevator || elevDist < 68) && !this.emergencySiegeActive && !this.isEvacuating) {
            e.preventDefault();
            this.descendToNextFloor();
            return;
          }
          const nearbyWounded = this.getNearbyWoundedNPC();
          if (nearbyWounded && this.player.belt && this.player.belt.medkits > 0) {
            this.healWoundedNPC(nearbyWounded);
          } else {
            this.switchBeltSlot(2);
          }
        }
        if (e.code === 'Digit3' || e.code === 'Numpad3') {
          e.preventDefault();
          if (typeof toggleRaidMusic === 'function') toggleRaidMusic();
        } else if (e.code === 'Digit4' || e.code === 'Numpad4') {
          e.preventDefault();
          if (typeof toggleRaidSfx === 'function') toggleRaidSfx();
        } else if (e.code === 'KeyQ') {
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
        if (this.isTypingChat) {
          if (e.code === 'Enter') {
            const trimmed = (this.chatInput || '').trim();
            if (trimmed.length > 0) {
              this.playerSpeech = { text: trimmed, timer: 300 };
              if (typeof socket !== 'undefined' && socket && socket.emit) {
                socket.emit('raidPlayerChat', { text: trimmed });
                socket.emit('chatFPS', { text: trimmed });
              }
            }
            this.isTypingChat = false;
            this.chatInput = '';
          } else if (e.code === 'Escape') {
            this.isTypingChat = false;
            this.chatInput = '';
          } else if (e.code === 'Backspace') {
            this.chatInput = this.chatInput.slice(0, -1);
          } else if (e.key && e.key.length === 1) {
            if (this.chatInput.length < 60) this.chatInput += e.key;
          }
          e.preventDefault();
          return;
        }

        if (e.code === 'KeyR') {
          this.reloadWeapon();
        }
        if (e.code === 'KeyF') {
          this.quickKick();
        }
        if (e.code === 'KeyT') {
          this.isTypingChat = !this.isTypingChat;
          this.chatInput = '';
          e.preventDefault();
          return;
        }
        if (e.code === 'KeyG') {
          this.toggleCameraMode();
        }
        if (e.code === 'KeyI' || e.key === 'i' || e.key === 'I' || e.key === 'ш' || e.key === 'Ш' || e.keyCode === 73) {
          e.preventDefault();
          this.toggleHUDVisibility();
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

          const rect = this.canvas.getBoundingClientRect();
          const clickX = (e.clientX !== undefined && rect.width > 0) ? (e.clientX - rect.left) * (this.canvas.width / rect.width) : this.mouse.x;
          const clickY = (e.clientY !== undefined && rect.height > 0) ? (e.clientY - rect.top) * (this.canvas.height / rect.height) : this.mouse.y;

          if (e.button === 0) {
            // If HUD is hidden, check click on restore UI pill in top-right
            if (this.isHUDHidden) {
              const pillW = 160;
              const pillH = 28;
              const pillX = this.canvas.width - pillW - 16;
              const pillY = 14;
              if (clickX >= pillX && clickX <= pillX + pillW && clickY >= pillY && clickY <= pillY + pillH) {
                this.toggleHUDVisibility();
                return;
              }
            }

            // Click on elevator platform tactical choice overlay ([1] Evac vs [2] Descend)
            const elevDist = this.elevator ? Math.hypot(this.player.x - (this.elevator.x + 32), this.player.y - (this.elevator.y + 32)) : 999;
            if ((this.isPlayerInElevator || elevDist < 68) && !this.emergencySiegeActive && !this.isEvacuating) {
              const optW = 380;
              const optH = 58;
              const optX = (this.canvas.width - optW) / 2;
              const optY = this.canvas.height - 165;
              if (clickX >= optX && clickX <= optX + optW) {
                if (clickY >= optY && clickY < optY + 30) {
                  this.evacuateSuccess();
                  return;
                } else if (clickY >= optY + 30 && clickY <= optY + optH + 10) {
                  this.descendToNextFloor();
                  return;
                }
              }
            }

            // Check click on sidebar buttons (Controls box)
            if (!this.isTouchControlsActive && this.canvas && this.canvas.width > 580 && (!this.isPointerLocked || this.cameraMode === 'TDS')) {
              const sbW = 208;
              const sbX = this.canvas.width - sbW - 16;
              const sbY = 175; // Lowered cleanly below Loot HUD
              if (clickX >= sbX && clickX <= sbX + sbW) {
                // Click on [G] Camera mode row (Row 0)
                if (clickY >= sbY + 24 && clickY <= sbY + 48) {
                  this.toggleCameraMode();
                  return;
                }
                // Click on [I] Hide UI row (Row 6)
                if (clickY >= sbY + 146 && clickY <= sbY + 172) {
                  this.toggleHUDVisibility();
                  return;
                }
                // Click on [3] Music row (Row 7)
                if (clickY >= sbY + 172 && clickY <= sbY + 194) {
                  if (typeof toggleRaidMusic === 'function') toggleRaidMusic();
                  return;
                }
                // Click on [4] Sounds row (Row 8)
                if (clickY >= sbY + 194 && clickY <= sbY + 220) {
                  if (typeof toggleRaidSfx === 'function') toggleRaidSfx();
                  return;
                }
              }
            }

            // Handle Active NPC Dialog click first
            if (this.activeDialog && this.activeDialog.npc) {
              const npc = this.activeDialog.npc;
              if (npc.quest && npc.quest.completed && !npc.quest.turnedIn) {
                this.turnInNPCQuest(npc);
              } else {
                this.activeDialog = null;
              }
              return;
            }
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
        // Check hitting Breaker Box or Flesh Vent with melee swing
        for (const trap of (this.electricTraps || [])) {
          const box = trap.breakerBox;
          if (box && !box.disabled && Math.hypot(this.player.x - box.x, this.player.y - box.y) < swingRange + 16) {
            box.disabled = true;
            trap.disabled = true;
            this.spawnHitParticles(box.x, box.y, '#00f0ff', 12);
            this.spawnFloatingNotice('⚡ ЩИТОК ОБЕСТОЧЕН! ПРОВОДА БЕЗОПАСНЫ!', '#00ffaa');
            if (typeof RadarAudio !== 'undefined' && RadarAudio.playBreakerSwitch) {
              RadarAudio.playBreakerSwitch();
            }
          }
        }
        for (const vent of (this.fleshVents || [])) {
          if (vent.dormantTimer <= 0 && Math.hypot(this.player.x - vent.x, this.player.y - vent.y) < swingRange + 16) {
            vent.dormantTimer = 30.0;
            this.spawnHitParticles(vent.x, vent.y, '#880066', 10);
            this.spawnFloatingNotice('🦑 ЩУПАЛЬЦА ВТЯНУЛИСЬ В КОЛЛЕКТОР (-30 СЕК.)', '#bb44ee');
            if (typeof RadarAudio !== 'undefined' && RadarAudio.playMonsterHurt) {
              RadarAudio.playMonsterHurt();
            }
          }
        }


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

        // PvP Melee Strike: hit remote players in melee arc
        if (this.isPvP || this.raidMode === 'PVP') {
          for (const rId in (this.remotePlayers || {})) {
            const rp = this.remotePlayers[rId];
            if (!rp || rp.hp <= 0) continue;
            const dist = Math.hypot(rp.renderX - this.player.x, rp.renderY - this.player.y);
            if (dist <= swingRange + 20) {
              const angToP = Math.atan2(rp.renderY - this.player.y, rp.renderX - this.player.x);
              let diff = Math.abs(angToP - pAng);
              if (diff > Math.PI) diff = Math.PI * 2 - diff;
              if (diff < 1.15) {
                const meleeDmg = weapon.dmg || 35;
                rp.hp = Math.max(0, (rp.hp || 100) - meleeDmg);
                rp.damageFlashTimer = 10;
                this.spawnHitParticles(rp.renderX, rp.renderY, '#ff3b30', 10);
                this.spawnFloatingNotice(`💥 УДАР: -${meleeDmg} HP [${rp.name || 'Боец'}]`, '#ff3366');
                if (typeof RadarAudio !== 'undefined') RadarAudio.playMeleeHit();
                if (typeof socket !== 'undefined' && socket && socket.emit) {
                  socket.emit('pvpHitPlayer', {
                    roomCode: this.currentRoomCode,
                    targetId: rId,
                    dmg: meleeDmg,
                    weapon: weapon.name || 'Труба'
                  });
                }
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

        // Broadcast gunshot to multiplayer room for PvP & Coop sync
        if (typeof socket !== 'undefined' && socket && socket.emit && (this.currentRoomCode || this.isPvP || this.raidMode === 'PVP')) {
          socket.emit('shootFPS', {
            roomCode: this.currentRoomCode,
            x: Math.round(this.player.x),
            y: Math.round(this.player.y),
            angle: Number(this.player.angle.toFixed(3)),
            weapon: weapon.gunType || (isShotgun ? 'shotgun' : 'rifle'),
            dmg: isShotgun ? 44 : (weapon.dmg || 32)
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
        // Check NPC Quests for monster elimination
        for (const n of (this.npcs || [])) {
          if (n.quest && n.quest.targetKills && !n.quest.completed) {
            n.quest.currentKills = (n.quest.currentKills || 0) + 1;
            if (n.quest.currentKills >= n.quest.targetKills) {
              n.quest.completed = true;
              this.spawnFloatingNotice(`🏆 ЗАДАНИЕ ВЫПОЛНЕНО: ${n.quest.title}! ПОГОВОРИТЕ С ${n.name}`, '#00ffaa');
            } else {
              this.spawnFloatingNotice(`Квест [${n.name}]: ${n.quest.currentKills}/${n.quest.targetKills} мутантов`, '#00ffcc');
            }
          }
        }
        this.spawnFloatingNotice(`+${bounty} ТАЛОНОВ, +${xp} XP`, '#ffd700');

        // Spawn Blood / Slime Decal on floor
        const isSlimeDecal = (monster.type === 'black_slime' || (monster.name || '').includes('Слизь') || (monster.name || '').includes('Кокон'));
        const decalColor = isSlimeDecal ? '#184720' : '#470808';
        const splatterColor = isSlimeDecal ? '#2fe04e' : '#991111';
        const rad = 16 + Math.random() * 8;
        if (!this.decals) this.decals = [];
        this.decals.push({
          x: monster.x,
          y: monster.y,
          radius: rad,
          color: decalColor,
          splatterColor: splatterColor,
          isSlime: isSlimeDecal,
          splatters: Array.from({ length: 6 }, () => ({
            dx: (Math.random() - 0.5) * rad * 2.2,
            dy: (Math.random() - 0.5) * rad * 2.2,
            r: 1.5 + Math.random() * 2.5
          }))
        });
        if (this.decals.length > 50) this.decals.shift();

        // 35% chance to drop Medical Kit or Ammo Box
        if (Math.random() < 0.35) {
          const isMed = Math.random() < 0.55;
          this.weaponDrops.push({
            id: isMed ? ('drop_med_' + Date.now()) : ('drop_ammo_' + Date.now()),
            x: monster.x,
            y: monster.y,
            tileX: Math.floor(monster.x / this.tileSize),
            tileY: Math.floor(monster.y / this.tileSize),
            pickedUp: false,
            isMedkit: isMed,
            item: { id: isMed ? 'food_medkit' : 'ammo_box', type: isMed ? 'heal' : 'ammo' },
            name: isMed ? 'Аптечка первой помощи' : 'Коробка патронов'
          });
        }

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
      // 0. Active Dialog Turn-in or Dismissal
      if (this.activeDialog && this.activeDialog.npc) {
        const npc = this.activeDialog.npc;
        if (npc.quest && npc.quest.completed && !npc.quest.turnedIn) {
          this.turnInNPCQuest(npc);
        } else {
          this.activeDialog = null;
        }
        return;
      }

      // 1. Friendly NPCs with Dialogues & Quests (Radius 68px)
      const nearbyNPC = (this.npcs || []).find(n => Math.hypot(this.player.x - n.x, this.player.y - n.y) < 68);
      if (nearbyNPC) {
        this.activeDialog = { npc: nearbyNPC };
        if (typeof RadarAudio !== 'undefined' && RadarAudio.playKeycardUnlock) {
          RadarAudio.playKeycardUnlock();
        }
        const q = nearbyNPC.quest;
        if (q && q.completed && !q.turnedIn) {
          this.spawnFloatingNotice('НАЖМИТЕ [E] ЧТОБЫ СДАТЬ ЗАДАНИЕ И ЗАБРАТЬ ТАЛОНЫ!', '#00ffaa');
        }
        return;
      }

      // 2. Nearby Wounded Liquidator
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

      // 3. Supply Chests (openable with [E])
      for (const chest of (this.chests || [])) {
        if (!chest.opened && Math.hypot(this.player.x - chest.x, this.player.y - chest.y) < 48) {
          this.openChest(chest);
          return;
        }
      }

      // 4. Airtight Hermetic Blast Doors (Front check in FPS, radial in TDS)
      // Tape Recorders (PROP_RECORDER)
      for (const rec of (this.recorders || [])) {
        const dRec = Math.hypot(this.player.x - rec.x, this.player.y - rec.y);
        if (dRec < 48) {
          rec.isPlaying = true;
          rec.listened = true;
          if (typeof RadarAudio !== 'undefined' && RadarAudio.playTapeRecorderAudio) {
            RadarAudio.playTapeRecorderAudio();
          }
          this.activeTapeSubtitle = { text: rec.text, timer: 7.0 };
          this.player.xpEarned = (this.player.xpEarned || 0) + 25;
          this.spawnFloatingNotice('+25 XP [КАССЕТА ЛИКВИДАТОРА]', '#00ffaa');

          if (!this.player.journal) this.player.journal = [];
          this.player.journal.push({
            title: `Кассета №${rec.tapeId}`,
            text: rec.text,
            time: new Date().toLocaleTimeString()
          });
          return;
        }
      }

      // Wall Decal Notes (WALL_DECAL_NOTE)
      for (const note of (this.wallNotes || [])) {
        const dNote = Math.hypot(this.player.x - note.x, this.player.y - note.y);
        if (dNote < 48) {
          this.activeWallNoteCard = note;
          if (typeof RadarAudio !== 'undefined' && RadarAudio.playLootPickup) {
            RadarAudio.playLootPickup();
          }
          return;
        }
      }

      // VOKhR Supply Crate
      if (this.vokhrCrate && !this.vokhrCrate.opened) {
        const dCrate = Math.hypot(this.player.x - (this.vokhrCrate.x + 16), this.player.y - (this.vokhrCrate.y + 12));
        if (dCrate < 52) {
          this.openVokhrCrate();
          return;
        }
      }

      const frontDoor = this.getDoorInFront(75);
      if (frontDoor) {
        this.toggleDoor(frontDoor);
        return;
      }
      for (const d of (this.doors || [])) {
        if (Math.hypot(this.player.x - (d.x + 16), this.player.y - (d.y + 16)) < 55) {
          this.toggleDoor(d);
          return;
        }
      }

      // 5. Weapon drops
      for (const drop of (this.weaponDrops || [])) {
        if (!drop.pickedUp && Math.hypot(this.player.x - drop.x, this.player.y - drop.y) < 38) {
          this.pickupWeapon(drop);
          return;
        }
      }

      // 6. Loot crates
      for (const crate of (this.crates || [])) {
        if (!crate.opened && Math.hypot(this.player.x - crate.x, this.player.y - crate.y) < 40) {
          this.openCrate(crate);
          return;
        }
      }
    }

    /**
     * Complete and Turn in NPC Quest, crediting Talons and rewards
     */
    turnInNPCQuest(npc) {
      if (!npc || !npc.quest || npc.quest.turnedIn) return;
      const q = npc.quest;
      q.turnedIn = true;

      const rewardTalons = q.rewardTalons || 250;
      this.player.talonsEarned = (this.player.talonsEarned || 0) + rewardTalons;
      this.player.xpEarned = (this.player.xpEarned || 0) + (q.rewardXp || 100);

      if (q.rewardMedkits) {
        if (this.player.belt) {
          this.player.belt.medkits = Math.min(this.player.belt.maxMedkits || 5, (this.player.belt.medkits || 0) + q.rewardMedkits);
        }
      }

      if (q.rewardAmmo && this.player.weapon && this.player.weapon.isRanged) {
        this.player.weapon.ammo = Math.min(this.player.weapon.maxAmmo || 30, (this.player.weapon.ammo || 0) + q.rewardAmmo);
      }

      if (q.rewardWeapon) {
        if (this.player.belt) {
          this.player.belt.slot2 = Object.assign({}, q.rewardWeapon);
        }
      }

      if (typeof RadarAudio !== 'undefined') {
        if (RadarAudio.playLevelUp) RadarAudio.playLevelUp();
        else if (RadarAudio.playKeycardUnlock) RadarAudio.playKeycardUnlock();
      }

      this.spawnFloatingNotice(`🏆 ЗАДАНИЕ СДАНО: +${rewardTalons} ТАЛОНОВ!`, '#00ffaa');

      // Instantly save talons to client profile
      if (typeof clientMe !== 'undefined' && clientMe) {
        clientMe.talons = (clientMe.talons || 0) + rewardTalons;
        if (typeof updateHubStats === 'function') updateHubStats();
        if (typeof socket !== 'undefined' && socket && socket.emit) {
          socket.emit('addTalonsReward', { talons: rewardTalons, reason: `Квест: ${q.title}` });
        }
      }
    }

    getDoorInFront(maxDist = 75) {
      const TS = this.tileSize;
      const cos = Math.cos(this.player.angle);
      const sin = Math.sin(this.player.angle);
      for (let dist = 12; dist <= maxDist; dist += 6) {
        const checkX = this.player.x + cos * dist;
        const checkY = this.player.y + sin * dist;
        const tx = Math.floor(checkX / TS);
        const ty = Math.floor(checkY / TS);
        const door = (this.doors || []).find(d => d.tileX === tx && d.tileY === ty);
        if (door) return door;
      }
      return null;
    }

    toggleDoor(d) {
      if (!d) return;
      if (d.requiresKeycard && !this.player.hasKeycard) {
        if (typeof RadarAudio !== 'undefined' && RadarAudio.playDoorDenied) {
          RadarAudio.playDoorDenied();
        }
        this.spawnFloatingNotice('ТРЕБУЕТСЯ ЭЛЕКТРОННАЯ КЛЮЧ-КАРТА!', '#ff3366');
        return;
      }
      if (d.requiresKeycard && this.player.hasKeycard && d.isLocked) {
        d.isLocked = false;
        if (typeof RadarAudio !== 'undefined' && RadarAudio.playKeycardUnlock) {
          RadarAudio.playKeycardUnlock();
        }
        this.spawnFloatingNotice('ДОСТУП РАЗРЕШЕН // ЗАМОК РАЗБЛОКИРОВАН', '#00ffaa');
      }

      d.isOpen = !d.isOpen;
      if (typeof RadarAudio !== 'undefined') {
        if (RadarAudio.playSpatialDoor) {
          const dx = (d.x + 16) - this.player.x;
          const pan = Math.max(-1, Math.min(1, dx / 200));
          RadarAudio.playSpatialDoor(pan, 1.0, d.isOpen);
        } else if (RadarAudio.playDoorToggle) {
          RadarAudio.playDoorToggle(d.isOpen);
        }
      }
      this.spawnFloatingNotice(d.isOpen ? 'ГЕРМОДВЕРЬ ОТКРЫВАЕТСЯ...' : 'ГЕРМОДВЕРЬ ЗАКРЫВАЕТСЯ...', '#00ffaa');
    }

    pickupWeapon(drop) {
      if (!drop) return;
      if (drop.pickedUp) return;
      if (drop.isMedkit || (drop.item && (drop.item.id === 'food_medkit' || drop.item.type === 'heal'))) {
        drop.pickedUp = true;
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 35);
        this.spawnFloatingNotice('+35 HP (АПТЕЧКА ИСПОЛЬЗОВАНА)', '#33ff55');
        if (typeof RadarAudio !== 'undefined' && RadarAudio.playUseHeal) RadarAudio.playUseHeal();
        return;
      }
      if (drop.item && drop.item.id === 'ammo_box') {
        drop.pickedUp = true;
        if (this.player.weapon && this.player.weapon.isRanged) {
          this.player.weapon.ammo = (this.player.weapon.ammo || 0) + 20;
          this.spawnFloatingNotice('+20 ПАТРОНОВ', '#ffd700');
        } else {
          this.spawnFloatingNotice('ПОЛУЧЕНЫ ПАТРОНЫ', '#ffd700');
        }
        return;
      }
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

      // --- FPS CAMERA ROLL & PROCEDURAL RECOIL DECAY ---
      let strafeDir = 0;
      if (this.keys['KeyA'] || this.keys['a']) strafeDir -= 1;
      if (this.keys['KeyD'] || this.keys['d']) strafeDir += 1;
      const targetRoll = strafeDir * 0.035;
      this.cameraRoll = (this.cameraRoll || 0) + (targetRoll - (this.cameraRoll || 0)) * 0.1;

      this.recoilY = (this.recoilY || 0) * 0.85; // lerp(recoilY, 0, 0.15)
      this.recoilX = (this.recoilX || 0) * 0.85;
      if (Math.abs(this.recoilY) < 0.01) this.recoilY = 0;
      if (Math.abs(this.recoilX) < 0.01) this.recoilX = 0;

      // --- WEAPON RELOAD PROGRESS ---
      if (this.isReloading) {
        this.reloadProgress = (this.reloadProgress || 0) + (1 / 60) / 1.1;
        if (this.reloadProgress >= 1.0) {
          this.isReloading = false;
          this.reloadProgress = 0;
          if (this.player.weapon) {
            this.player.weapon.mag = this.player.weapon.magCapacity || 8;
          }
          this.spawnFloatingNotice('✅ ПЕРЕЗАРЯЖЕНО', '#00ffaa');
        }
      }

      // --- QUICK MELEE KICK PROGRESS ---
      if (this.isKicking) {
        this.kickProgress = (this.kickProgress || 0) + (1 / 60) / 0.28;
        if (this.kickProgress >= 1.0) {
          this.isKicking = false;
          this.kickProgress = 0;
        }
      }

      // --- PARTICLE SHELL CASINGS SIMULATION ---
      if (this.casings && this.casings.length > 0) {
        for (let ci = this.casings.length - 1; ci >= 0; ci--) {
          const c = this.casings[ci];
          c.screenX += c.vx;
          c.screenY += c.vy;
          c.vy += 0.65; // gravity
          c.rot += c.vrot;
          if (c.screenY >= c.floorY) {
            c.screenY = c.floorY;
            if (!c.bounced) {
              c.bounced = true;
              c.vy = -c.vy * 0.38;
              c.vx *= 0.6;
              c.vrot *= 0.5;
              if (typeof RadarAudio !== 'undefined' && RadarAudio.playShellCasingDrop) {
                RadarAudio.playShellCasingDrop(0.35);
              }
            } else {
              c.vx *= 0.8;
              c.vy = 0;
              c.vrot = 0;
            }
          }
          c.life -= 0.012;
          if (c.life <= 0) this.casings.splice(ci, 1);
        }
      }

      // --- MULTIPLAYER SNAPSHOT INTERPOLATION (80-100 MS DELAY BUFFER) ---
      const renderTime = Date.now() - 90;
      for (const id in this.remotePlayers) {
        const peer = this.remotePlayers[id];
        if (peer.isShootingTimer > 0) peer.isShootingTimer--;
        if (peer.alertTimer > 0) peer.alertTimer--;

        const snaps = peer.snapshots;
        if (!snaps || snaps.length === 0) {
          peer.renderX = (peer.targetX !== undefined) ? peer.targetX : (peer.renderX || 0);
          peer.renderY = (peer.targetY !== undefined) ? peer.targetY : (peer.renderY || 0);
          peer.renderAngle = (peer.targetAngle !== undefined) ? peer.targetAngle : (peer.renderAngle || 0);
          continue;
        }

        if (snaps.length === 1 || renderTime <= snaps[0].time) {
          peer.renderX = snaps[0].x;
          peer.renderY = snaps[0].y;
          peer.renderAngle = snaps[0].angle;
        } else if (renderTime >= snaps[snaps.length - 1].time) {
          const last = snaps[snaps.length - 1];
          peer.renderX += (last.x - peer.renderX) * 0.35;
          peer.renderY += (last.y - peer.renderY) * 0.35;
          let diff = (last.angle - peer.renderAngle);
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          peer.renderAngle += diff * 0.35;
        } else {
          for (let i = 0; i < snaps.length - 1; i++) {
            const s1 = snaps[i];
            const s2 = snaps[i + 1];
            if (s1.time <= renderTime && renderTime <= s2.time) {
              const span = s2.time - s1.time;
              const t = span > 0 ? (renderTime - s1.time) / span : 0;
              peer.renderX = s1.x + (s2.x - s1.x) * t;
              peer.renderY = s1.y + (s2.y - s1.y) * t;

              let diff = (s2.angle - s1.angle);
              while (diff < -Math.PI) diff += Math.PI * 2;
              while (diff > Math.PI) diff -= Math.PI * 2;
              peer.renderAngle = s1.angle + diff * t;
              break;
            }
          }
        }
      }

      // --- PROXIMITY CHAT SPEECH BUBBLE DECAY ---
      if (this.playerSpeech) {
        this.playerSpeech.timer--;
        if (this.playerSpeech.timer <= 0) this.playerSpeech = null;
      }
      for (const rId in this.remotePlayers) {
        const rp = this.remotePlayers[rId];
        if (rp.speech) {
          rp.speech.timer--;
          if (rp.speech.timer <= 0) rp.speech = null;
        }
      }

      // 1a. Viewmodel Bobbing & Screen Feedback Timers
      const isPlayerMoving = (this.player.vx !== 0 || this.player.vy !== 0);
      if (isPlayerMoving) {
        this.bobTimer = (this.bobTimer || 0) + (1 / 60) * 8;
        this.weaponBobX = Math.cos(this.bobTimer) * 6;
        this.weaponBobY = Math.abs(Math.sin(this.bobTimer)) * 6;
      } else {
        this.weaponBobX = (this.weaponBobX || 0) * 0.85;
        this.weaponBobY = (this.weaponBobY || 0) * 0.85;
      }

      // Player Damage Red Vignette Decay
      if (this.playerDamageVignette > 0) {
        this.playerDamageVignette = Math.max(0, this.playerDamageVignette - 0.05);
      }

      if (this.screenFlashTimer > 0) this.screenFlashTimer--;
      if (this.screenShakeTimer > 0) this.screenShakeTimer--;

      // Dynamic light sources & sparking panels update
      if (this.lightSources) {
        for (let lsi = 0; lsi < this.lightSources.length; lsi++) {
          const ls = this.lightSources[lsi];
          if (ls.type === 'sparking_panel') {
            ls.sparkTimer = (ls.sparkTimer || 50) - 1;
            if (ls.sparkTimer <= 0) {
              ls.isSparking = true;
              ls.intensity = 1.0;
              ls.radius = 110;
              ls.sparkTimer = 60 + Math.random() * 110;

              // Spawn blue-white electric sparks
              for (let spki = 0; spki < 4; spki++) {
                this.particles.push({
                  x: ls.x + (Math.random() - 0.5) * 6,
                  y: ls.y + (Math.random() - 0.5) * 6,
                  vx: (Math.random() - 0.5) * 4.5,
                  vy: -1 - Math.random() * 3,
                  color: '#e6f5ff',
                  alpha: 1.0,
                  sz: 1.8,
                  life: 14,
                  gravity: 0.18
                });
              }
            } else if (ls.isSparking && ls.sparkTimer < 56) {
              ls.isSparking = false;
              ls.intensity = 0.25;
              ls.radius = ls.baseRadius;
            }
          }
        }
      }

      // Decay entity flinch & damage flash
      for (let ei = 0; ei < this.entities.length; ei++) {
        const ent = this.entities[ei];
        if (ent.flinchX) ent.flinchX *= 0.65;
        if (ent.flinchY) ent.flinchY *= 0.65;
        if (ent.damageFlashTimer > 0) ent.damageFlashTimer--;
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

      // High-Frequency 30 FPS Movement Sync to Multiplayer Room
      if (this.tick % 2 === 0 && typeof socket !== 'undefined' && socket && socket.emit && this.currentRoomCode) {
        socket.emit('playerInputFPS', {
          roomCode: this.currentRoomCode,
          x: Math.round(this.player.x),
          y: Math.round(this.player.y),
          angle: Number(this.player.angle.toFixed(2)),
          hp: this.player.hp,
          weapon: (this.player.weapon && (this.player.weapon.gunType || this.player.weapon.id)) || 'pipe'
        });
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
        let touchX = (this.touchMoveVector && this.touchMoveVector.active) ? this.touchMoveVector.x : 0;
        let touchY = (this.touchMoveVector && this.touchMoveVector.active) ? this.touchMoveVector.y : 0;

        if (this.cameraMode === 'FPS') {
          const cos = Math.cos(this.player.angle);
          const sin = Math.sin(this.player.angle);
          let fwd = 0;
          let strafe = 0;
          if (this.keys['KeyW'] || this.keys['ArrowUp'] || this.keys['w']) fwd += 1;
          if (this.keys['KeyS'] || this.keys['ArrowDown'] || this.keys['s']) fwd -= 1;
          if (this.keys['KeyA'] || this.keys['ArrowLeft'] || this.keys['a']) strafe -= 1;
          if (this.keys['KeyD'] || this.keys['ArrowRight'] || this.keys['d']) strafe += 1;

          // Touch joystick input (y < 0 is forward, y > 0 is backward)
          fwd += -touchY;
          strafe += touchX;

          fwd = Math.max(-1, Math.min(1, fwd));
          strafe = Math.max(-1, Math.min(1, strafe));

          moveX = fwd * cos - strafe * sin;
          moveY = fwd * sin + strafe * cos;
        } else {
          if (this.keys['KeyW'] || this.keys['ArrowUp'] || this.keys['w']) moveY -= 1;
          if (this.keys['KeyS'] || this.keys['ArrowDown'] || this.keys['s']) moveY += 1;
          if (this.keys['KeyA'] || this.keys['ArrowLeft'] || this.keys['a']) moveX -= 1;
          if (this.keys['KeyD'] || this.keys['ArrowRight'] || this.keys['d']) moveX += 1;

          moveX += touchX;
          moveY += touchY;

          // In TDS mode, if moving via touch joystick, update player face angle towards movement vector
          if (this.touchMoveVector && this.touchMoveVector.active && (Math.abs(touchX) > 0.15 || Math.abs(touchY) > 0.15)) {
            if (!this.mouse.isDown) {
              this.player.angle = Math.atan2(touchY, touchX);
            }
          }
        }
      }

              // Continuous touch turn rotation (supports both FPS 3D and TDS 2D)
        if (this.touchTurnDirection) {
          const turnRate = (this.cameraMode === 'FPS') ? 0.052 : 0.065;
          this.player.angle += this.touchTurnDirection * turnRate;
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
    
    /**
     * Emergency Event: "Elevator Failure: Airlock Defense"
     */
    triggerElevatorSiegeEvent() {
      if (this.siegeTriggered || this.emergencySiegeActive) return;
      this.siegeTriggered = true;
      this.emergencySiegeActive = true;
      this.evacHoldTimer = 0;
      this.isEvacuating = false;
      this.siegeTimer = 300; // 5:00 minutes
      this.siegePrepTimer = 15; // 15 seconds express preparation
      this.siegeSpawnTimer = 0;
      this.bossSpawned = false;

      // Audio: Sheared winch gear, metallic screech & wailing siren
      if (typeof RadarAudio !== 'undefined' && RadarAudio.playWinchFailure) {
        RadarAudio.playWinchFailure();
      }

      // Red glitch error notification
      this.siegeAlertBanner = {
        timer: 10.0
      };

      // Unseal all sector blast doors
      for (const d of (this.doors || [])) {
        d.isLocked = false;
        d.isOpen = true;
        d.openProgress = 1.0;
      }

      const elevCenterX = this.elevator.x + 16;
      const elevCenterY = this.elevator.y + 16;

      // Mount Hydraulic Terminal at center of elevator
      this.elevatorTerminal = {
        x: elevCenterX,
        y: elevCenterY,
        hp: 500,
        maxHp: 500
      };

      // Place Barricade build slots at elevator room entrances
      this.siegeBarricades = [];
      const nearbyDoors = (this.doors || []).filter(d => Math.hypot((d.x + 16) - elevCenterX, (d.y + 16) - elevCenterY) < 260);
      if (nearbyDoors.length > 0) {
        nearbyDoors.forEach((d, idx) => {
          this.siegeBarricades.push({
            id: 'barricade_' + idx,
            x: d.x,
            y: d.y,
            w: 32,
            h: 32,
            hp: 300,
            maxHp: 300,
            isConstructed: false,
            buildProgress: 0.0,
            canRepair: false
          });
        });
      } else {
        this.siegeBarricades.push(
          { id: 'barricade_0', x: elevCenterX - 64, y: elevCenterY - 16, w: 32, h: 32, hp: 300, maxHp: 300, isConstructed: false, buildProgress: 0.0, canRepair: false },
          { id: 'barricade_1', x: elevCenterX + 32, y: elevCenterY - 16, w: 32, h: 32, hp: 300, maxHp: 300, isConstructed: false, buildProgress: 0.0, canRepair: false },
          { id: 'barricade_2', x: elevCenterX - 16, y: elevCenterY - 64, w: 32, h: 32, hp: 300, maxHp: 300, isConstructed: false, buildProgress: 0.0, canRepair: false }
        );
      }

      // Spawn Rusted VOKhR Supply Crate inside the room
      this.vokhrCrate = {
        x: elevCenterX - 48,
        y: elevCenterY - 40,
        w: 32,
        h: 24,
        opened: false,
        inRange: false
      };

      this.spawnFloatingNotice('⚠️ [ОШИБКА 77-Б] ЗАКЛИНИЛО ТРОС! ВСЕ ГЕРМОЗАТВОРЫ ОТКРЫТЫ!', '#ff0033');
    }

    openVokhrCrate() {
      if (!this.vokhrCrate || this.vokhrCrate.opened) return;
      this.vokhrCrate.opened = true;
      if (typeof RadarAudio !== 'undefined' && RadarAudio.playLootPickup) {
        RadarAudio.playLootPickup();
      }
      this.spawnFloatingNotice('📦 ВСКРЫТ ЯЩИК ВОХР! ВЗЯТЫ ПАТРОНЫ, АПТЕЧКА И БОЧКИ!', '#ffd700');

      if (!this.player.belt) this.player.belt = { medkits: 1, ammoClips: 2 };
      this.player.belt.medkits = (this.player.belt.medkits || 0) + 1;
      this.player.belt.ammoClips = (this.player.belt.ammoClips || 0) + 2;
      if (this.player.weapon && this.player.weapon.ammo !== undefined) {
        this.player.weapon.ammo += 24;
      }

      const cx = this.vokhrCrate.x;
      const cy = this.vokhrCrate.y;
      this.explosiveBarrels.push(
        { id: 'barrel_' + Date.now() + '_1', x: cx + 55, y: cy + 10, radius: 13, hp: 20 },
        { id: 'barrel_' + Date.now() + '_2', x: cx - 25, y: cy + 65, radius: 13, hp: 20 }
      );
    }

    detonateExplosiveBarrel(barrel) {
      if (!barrel || barrel.exploded) return;
      barrel.exploded = true;
      const bIdx = this.explosiveBarrels.indexOf(barrel);
      if (bIdx !== -1) this.explosiveBarrels.splice(bIdx, 1);

      if (typeof RadarAudio !== 'undefined' && RadarAudio.playBarrelExplosion) {
        RadarAudio.playBarrelExplosion();
      }

      const bx = barrel.x;
      const by = barrel.y;
      const aoeRadius = 95;
      const aoeDamage = 140;

      // Fiery shockwave particles
      for (let i = 0; i < 28; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = Math.random() * 5 + 2;
        this.particles.push({
          x: bx,
          y: by,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          sz: Math.random() * 8 + 4,
          color: Math.random() < 0.6 ? '#ff6600' : '#ffcc00',
          alpha: 1.0,
          life: 30 + Math.random() * 20
        });
      }

      // Add toxic puddle & scorch decal
      if (this.decals) {
        this.decals.push({
          x: bx,
          y: by,
          color: '#332211',
          radius: 36,
          splatters: [
            { dx: -12, dy: 6, r: 14, color: '#ff5500' },
            { dx: 14, dy: -8, r: 16, color: '#33aa44' },
            { dx: 5, dy: 14, r: 12, color: '#221100' }
          ]
        });
      }

      // Damage mutants in AoE
      for (let i = this.entities.length - 1; i >= 0; i--) {
        const ent = this.entities[i];
        if (ent.type !== 'liquidator' && ent.hp > 0) {
          const dist = Math.hypot(ent.x - bx, ent.y - by);
          if (dist < aoeRadius + (ent.radius || 13)) {
            const falloff = 1.0 - (dist / (aoeRadius + 13)) * 0.5;
            const dmg = Math.round(aoeDamage * falloff);
            ent.hp -= dmg;
            ent.damageFlashTimer = 12;
            this.spawnFloatingNotice(`-${dmg} [ВЗРЫВ!]`, '#ff3300');
            if (ent.hp <= 0) {
              this.killMonster(ent);
            }
          }
        }
      }

      // Damage player if caught
      const pDist = Math.hypot(this.player.x - bx, this.player.y - by);
      if (pDist < aoeRadius) {
        const pDmg = Math.round(55 * (1.0 - pDist / aoeRadius));
        this.damagePlayer(pDmg, 'Взрыв хим-бочки');
      }

      // Damage barricades if nearby
      for (const bar of (this.siegeBarricades || [])) {
        if (bar.isConstructed && bar.hp > 0) {
          const bDist = Math.hypot(bar.x + 16 - bx, bar.y + 16 - by);
          if (bDist < aoeRadius) {
            bar.hp -= 40;
            if (bar.hp <= 0) bar.hp = 0;
          }
        }
      }
    }

    updateSiege(dt) {
      if (!this.emergencySiegeActive) return;

      if (this.siegeAlertBanner && this.siegeAlertBanner.timer > 0) {
        this.siegeAlertBanner.timer -= dt;
      }

      // Handle Barricade Building & Repair when holding [E]
      const isHoldingE = !!(this.keys['KeyE'] || this.keys['e'] || this.keys['KeyH'] || this.keys['Space']);
      for (const b of (this.siegeBarricades || [])) {
        const distToPlayer = Math.hypot(this.player.x - (b.x + 16), this.player.y - (b.y + 16));
        b.canRepair = (distToPlayer < 46 && b.isConstructed && b.hp < b.maxHp);
        if (distToPlayer < 46 && isHoldingE) {
          if (!b.isConstructed) {
            b.buildProgress = Math.min(1.0, (b.buildProgress || 0) + (dt / 1.6));
            if (this.tick % 15 === 0 && typeof RadarAudio !== 'undefined' && RadarAudio.playBarricadeConstruct) {
              RadarAudio.playBarricadeConstruct();
            }
            if (b.buildProgress >= 1.0) {
              b.isConstructed = true;
              b.hp = b.maxHp;
              if (typeof RadarAudio !== 'undefined' && RadarAudio.playBarricadeConstruct) {
                RadarAudio.playBarricadeConstruct();
              }
              this.spawnFloatingNotice('🔨 БАРРИКАДА ВОЗВЕДЕНА! [300 HP]', '#00ffaa');
            }
          } else if (b.isConstructed && b.hp < b.maxHp) {
            b.hp = Math.min(b.maxHp, b.hp + 75 * dt);
            if (this.tick % 20 === 0 && typeof RadarAudio !== 'undefined' && RadarAudio.playBarricadeConstruct) {
              RadarAudio.playBarricadeConstruct();
            }
          }
        }
      }

      // 1. Preparation Phase (15s)
      if (this.siegePrepTimer > 0) {
        this.siegePrepTimer -= dt;
        if (this.siegePrepTimer <= 0) {
          this.siegePrepTimer = 0;
          this.spawnFloatingNotice('⚠️ ПЕРВАЯ ВОЛНА ПОШЛА! ОГОНЬ НА ПОРАЖЕНИЕ!', '#ff3333');
          if (typeof RadarAudio !== 'undefined') RadarAudio.playSamosborAlarm();
        }
        return;
      }

      // 2. Active Defense Timer (300 -> 0s)
      this.siegeTimer = Math.max(0, this.siegeTimer - dt);
      const elapsed = 300 - this.siegeTimer;

      // Hydraulic terminal check
      if (this.elevatorTerminal && this.elevatorTerminal.hp <= 0) {
        this.collapseElevatorShaft();
        return;
      }

      // 3. Assault Wave Spawning
      this.siegeSpawnTimer = (this.siegeSpawnTimer || 0) + dt;
      const elevCenterX = this.elevator.x + 16;
      const elevCenterY = this.elevator.y + 16;

      if (elapsed < 120) {
        // Wave 1: Fast crawling vermin
        if (this.siegeSpawnTimer >= 3.8) {
          this.siegeSpawnTimer = 0;
          this.spawnSiegeMutant('vermin', elevCenterX, elevCenterY);
        }
      } else if (elapsed < 240) {
        // Wave 2: Acid spitters & cultists
        if (this.siegeSpawnTimer >= 3.2) {
          this.siegeSpawnTimer = 0;
          this.spawnSiegeMutant(Math.random() < 0.5 ? 'acid_spitter' : 'cultist', elevCenterX, elevCenterY);
        }
      } else {
        // Wave 3: Final minute mini-boss
        if (!this.bossSpawned) {
          this.bossSpawned = true;
          this.spawnMiniBossButcher(elevCenterX, elevCenterY);
        }
        if (this.siegeSpawnTimer >= 4.5) {
          this.siegeSpawnTimer = 0;
          this.spawnSiegeMutant('vermin', elevCenterX, elevCenterY);
        }
      }

      // 4. Mutant AI assault behavior
      for (let i = 0; i < this.entities.length; i++) {
        const ent = this.entities[i];
        if (ent.type !== 'liquidator' && ent.isSiegeAttacker && ent.hp > 0) {
          const termX = this.elevatorTerminal ? this.elevatorTerminal.x : elevCenterX;
          const termY = this.elevatorTerminal ? this.elevatorTerminal.y : elevCenterY;
          const dTerm = Math.hypot(termX - ent.x, termY - ent.y);

          let blockedBar = null;
          for (const bar of (this.siegeBarricades || [])) {
            if (bar.isConstructed && bar.hp > 0) {
              const dBar = Math.hypot(bar.x + 16 - ent.x, bar.y + 16 - ent.y);
              if (dBar < 30) {
                blockedBar = bar;
                break;
              }
            }
          }

          if (blockedBar) {
            ent.vx = 0;
            ent.vy = 0;
            blockedBar.hp -= (ent.dmg || 18) * dt;
            if (this.tick % 30 === 0 && typeof RadarAudio !== 'undefined') {
              RadarAudio.playBarricadeHit();
            }
            if (blockedBar.hp <= 0) {
              blockedBar.hp = 0;
              blockedBar.isConstructed = false;
              this.spawnHitParticles(blockedBar.x + 16, blockedBar.y + 16, '#ff3b30', 10);
              this.spawnFloatingNotice('💥 БАРРИКАДА РАЗБИТА!', '#ff2222');
            }
          } else if (dTerm < 36 && this.elevatorTerminal) {
            ent.vx = 0;
            ent.vy = 0;
            this.elevatorTerminal.hp -= (ent.dmg || 20) * dt;
            if (this.tick % 25 === 0) {
              this.spawnHitParticles(this.elevatorTerminal.x, this.elevatorTerminal.y, '#ff3333', 3);
            }
          } else {
            const ang = Math.atan2(termY - ent.y, termX - ent.x);
            ent.angle = ang;
            ent.vx = Math.cos(ang) * ent.speed;
            ent.vy = Math.sin(ang) * ent.speed;

            const dPlayer = Math.hypot(this.player.x - ent.x, this.player.y - ent.y);
            if (dPlayer < ent.radius + this.player.radius + 4) {
              this.damagePlayer((ent.dmg || 16) * dt * 2, ent.name);
            }
          }
        }
      }

      // 5. Rescued NPC ally suppression fire
      for (const ally of (this.npcs || [])) {
        if (ally.isLoyalFollower && ally.hp > 0) {
          const targetBar = (this.siegeBarricades || []).find(b => b.isConstructed && b.hp > 0);
          const guardX = targetBar ? targetBar.x + 16 : elevCenterX - 24;
          const guardY = targetBar ? targetBar.y + 24 : elevCenterY;

          const dGuard = Math.hypot(guardX - ally.x, guardY - ally.y);
          if (dGuard > 24) {
            const ang = Math.atan2(guardY - ally.y, guardX - ally.x);
            ally.vx = Math.cos(ang) * (ally.speed * 1.1);
            ally.vy = Math.sin(ang) * (ally.speed * 1.1);
            ally.angle = ang;
          } else {
            ally.vx = 0;
            ally.vy = 0;
          }

          ally.siegeFireTimer = (ally.siegeFireTimer || 0) + dt;
          if (ally.siegeFireTimer >= 0.95) {
            let nearestEnemy = null;
            let nearestDist = 320;
            for (const ent of this.entities) {
              if (ent.type !== 'liquidator' && ent.hp > 0) {
                const d = Math.hypot(ent.x - ally.x, ent.y - ally.y);
                if (d < nearestDist) {
                  nearestDist = d;
                  nearestEnemy = ent;
                }
              }
            }
            if (nearestEnemy) {
              ally.siegeFireTimer = 0;
              const fAng = Math.atan2(nearestEnemy.y - ally.y, nearestEnemy.x - ally.x);
              ally.angle = fAng;
              if (typeof RadarAudio !== 'undefined' && RadarAudio.playGunshot) {
                RadarAudio.playGunshot('pistol');
              }
              this.projectiles.push({
                x: ally.x + Math.cos(fAng) * 16,
                y: ally.y + Math.sin(fAng) * 16,
                vx: Math.cos(fAng) * 14,
                vy: Math.sin(fAng) * 14,
                damage: 28,
                isPlayer: true,
                life: 50,
                color: '#00ffaa'
              });
            }
          }
        }
      }

      // 6. Siege Resolution (00:00)
      if (this.siegeTimer <= 0) {
        this.emergencySiegeActive = false;
        this.siegeSurvived = true;
        if (typeof RadarAudio !== 'undefined' && RadarAudio.playPneumaticHorn) {
          RadarAudio.playPneumaticHorn();
        }
        this.spawnFloatingNotice('🏆 ГИДРАВЛИКА ВОССТАНОВЛЕНА! ГЕРМОЗАТВОР КЛЕТИ ОТКРЫТ!', '#00ffaa');
        this.spawnFloatingNotice('НАГРАДА ЗА ВЫЖИВАНИЕ В ОСАДЕ: +100% К ОЧКАМ И ТАЛОНАМ!', '#ffd700');

        for (const ent of this.entities) {
          if (ent.isSiegeAttacker) ent.hp = 0;
        }

        setTimeout(() => {
          this.evacuateSuccess();
        }, 1800);
      }
    }

    spawnSiegeMutant(type, targetX, targetY) {
      const TS = this.tileSize || 32;
      const grid = this.mapData ? this.mapData.grid : null;
      if (!grid) return;

      const eTileX = Math.floor(targetX / TS);
      const eTileY = Math.floor(targetY / TS);

      let spawnTile = null;
      for (let attempt = 0; attempt < 30; attempt++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 10 + Math.floor(Math.random() * 8);
        const tx = Math.floor(eTileX + Math.cos(ang) * dist);
        const ty = Math.floor(eTileY + Math.sin(ang) * dist);
        if (grid[ty] && grid[ty][tx] === 0) {
          spawnTile = { x: tx * TS + TS / 2, y: ty * TS + TS / 2 };
          break;
        }
      }
      if (!spawnTile) return;

      const mutantData = {
        id: 'siege_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        type: 'monster',
        isSiegeAttacker: true,
        x: spawnTile.x,
        y: spawnTile.y,
        homeX: spawnTile.x,
        homeY: spawnTile.y,
        state: 'CHASE'
      };

      if (type === 'vermin') {
        mutantData.name = Math.random() < 0.5 ? 'Плесень-ползун' : 'Чумная крыса';
        mutantData.hp = 35;
        mutantData.maxHp = 35;
        mutantData.dmg = 14;
        mutantData.speed = 2.4;
        mutantData.radius = 11;
        mutantData.color = '#ff6633';
      } else if (type === 'acid_spitter') {
        mutantData.name = 'Плевун кислотой';
        mutantData.hp = 75;
        mutantData.maxHp = 75;
        mutantData.dmg = 24;
        mutantData.speed = 1.6;
        mutantData.radius = 14;
        mutantData.color = '#9933ff';
        mutantData.behavior = 'turret_spore';
      } else {
        mutantData.name = 'Обезумевший жилец';
        mutantData.hp = 95;
        mutantData.maxHp = 95;
        mutantData.dmg = 26;
        mutantData.speed = 1.9;
        mutantData.radius = 13;
        mutantData.color = '#ff2222';
      }

      this.entities.push(mutantData);
    }

    spawnMiniBossButcher(targetX, targetY) {
      const TS = this.tileSize || 32;
      const grid = this.mapData ? this.mapData.grid : null;
      if (!grid) return;

      const eTileX = Math.floor(targetX / TS);
      const eTileY = Math.floor(targetY / TS);

      let sx = targetX + 180;
      let sy = targetY - 120;
      for (let attempt = 0; attempt < 20; attempt++) {
        const ang = Math.random() * Math.PI * 2;
        const tx = Math.floor(eTileX + Math.cos(ang) * 8);
        const ty = Math.floor(eTileY + Math.sin(ang) * 8);
        if (grid[ty] && grid[ty][tx] === 0) {
          sx = tx * TS + TS / 2;
          sy = ty * TS + TS / 2;
          break;
        }
      }

      this.spawnFloatingNotice('⚠️ ТРЕВОГА! ИЗ ВЕНТИЛЯЦИИ ВЫВАЛИЛСЯ БРОНИРОВАННЫЙ МЯСНИК!', '#ff0033');
      if (typeof RadarAudio !== 'undefined') RadarAudio.playSamosborAlarm();

      this.entities.push({
        id: 'boss_butcher_' + Date.now(),
        type: 'monster',
        name: 'Бронированный Мясник',
        isSiegeAttacker: true,
        isBoss: true,
        x: sx,
        y: sy,
        homeX: sx,
        homeY: sy,
        hp: 450,
        maxHp: 450,
        dmg: 48,
        speed: 1.65,
        radius: 22,
        color: '#cc1111',
        state: 'CHASE'
      });
    }

    collapseElevatorShaft() {
      if (this.isCollapsing) return;
      this.isCollapsing = true;
      this.emergencySiegeActive = false;
      if (typeof RadarAudio !== 'undefined') {
        RadarAudio.playWinchFailure();
        RadarAudio.playBarrelExplosion();
      }
      this.spawnFloatingNotice('💥 КАТАСТРОФА! ПУЛЬТ УНИЧТОЖЕН! ШАХТА ОБРУШИЛАСЬ!', '#ff0000');
      this.damagePlayer(999, 'Обрушение шахты лифта');
      setTimeout(() => {
        this.finishRaid(false);
      }, 1900);
    }

    updateElevatorExtraction() {
      if (!this.elevator) return;
      const elevCenterX = this.elevator.x + 32;
      const elevCenterY = this.elevator.y + 32;
      const dist = Math.hypot(this.player.x - elevCenterX, this.player.y - elevCenterY);

      if (dist < 64) {
        this.isPlayerInElevator = true;
        this.evacHoldTimer = Math.min(this.evacHoldRequired, this.evacHoldTimer + (1 / 60));

        const secondsLeft = Math.ceil(this.evacHoldRequired - this.evacHoldTimer);
        if (secondsLeft !== this.lastBeepSecond && secondsLeft > 0) {
          this.lastBeepSecond = secondsLeft;
          if (typeof RadarAudio !== 'undefined') RadarAudio.playCountdownBeep(secondsLeft <= 2);
        }

        if (this.evacHoldTimer >= this.evacHoldRequired) {
          const floor = this.currentRaidFloor || 1;
          const shouldTriggerSiege = !this.siegeTriggered && !this.emergencySiegeActive && !this.siegeSurvived &&
            ((floor >= 2 && Math.random() < 0.20) || this.forceEmergencySiege);

          if (shouldTriggerSiege) {
            this.triggerElevatorSiegeEvent();
          } else {
            this.evacuateSuccess();
          }
        }
      } else {
        this.isPlayerInElevator = false;
        this.evacHoldTimer = 0;
        this.lastBeepSecond = 5;
      }
    }

    /**
     * Descend to the next floor depth via extraction cargo elevator shaft
     */
    descendToNextFloor() {
      if (this.isEvacuating) return;

      const currentFloor = this.currentRaidFloor || 1;
      const nextFloor = currentFloor + 1;
      this.currentRaidFloor = nextFloor;
      this.floorDepth = nextFloor;

      // Save player progression, health, and equipment
      const savedTalons = this.player.talonsEarned || 0;
      const savedXp = (this.player.xpEarned || 0) + 100;
      const savedHp = Math.min(this.player.maxHp, this.player.hp + 25);
      const savedLoot = (this.player.collectedLoot || []).slice();
      const savedWeapon = Object.assign({}, this.player.weapon);
      const savedBaseWeapon = Object.assign({}, this.player.baseWeapon);
      const savedBelt = this.player.belt ? JSON.parse(JSON.stringify(this.player.belt)) : null;
      const savedHasKeycard = !!this.player.hasKeycard;

      // Sound transition
      if (typeof RadarAudio !== 'undefined') {
        if (RadarAudio.playLevelUp) RadarAudio.playLevelUp();
        else if (RadarAudio.playKeycardUnlock) RadarAudio.playKeycardUnlock();
      }

      // Rebuild map for the deeper floor depth
      this.buildFloor();

      // Restore saved progress and inventory on new floor
      this.player.talonsEarned = savedTalons;
      this.player.xpEarned = savedXp;
      this.player.collectedLoot = savedLoot;
      this.player.hp = savedHp;
      this.player.weapon = savedWeapon;
      this.player.baseWeapon = savedBaseWeapon;
      if (savedBelt) this.player.belt = savedBelt;
      this.player.hasKeycard = savedHasKeycard;

      // Update multi-floor loot multiplier
      this.floorMultiplier = (nextFloor === 2 ? 1.5 : (nextFloor === 3 ? 2.0 : (nextFloor >= 4 ? 3.0 : 1.0)));

      // Reset extraction state for new floor
      this.isPlayerInElevator = false;
      this.evacHoldTimer = 0;
      this.lastBeepSecond = 5;

      // Fullscreen 2.5s banner for multi-floor descent
      this.multiFloorBanner = {
        floor: nextFloor,
        mult: this.floorMultiplier,
        timer: 160
      };

      this.spawnFloatingNotice(`⚡ СПУСК НА ЭТАЖ ${nextFloor}! МНОЖИТЕЛЬ ХАБАРА: x${this.floorMultiplier.toFixed(1)} (+100 XP)`, '#ffd700');
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

    /**
     * 4-Player Live Raid Networking Initialization
     */
        /**
     * Multiplayer FPS Mode Integration (25 Hz Socket.IO Real-Time Sync)
     */
    initRaidNetworking() {
      if (typeof socket === 'undefined' || !socket || !socket.on) return;
      if (this._hasRaidNetwork) {
        socket.emit('joinRaidFPS', {
          roomCode: this.currentRoomCode,
          x: Math.round(this.player.x),
          y: Math.round(this.player.y),
          angle: Number(this.player.angle.toFixed(2)),
          hp: this.player.hp,
          weapon: (this.player.weapon && this.player.weapon.gunType) || 'pipe'
        });
        return;
      }
      this._hasRaidNetwork = true;

      // Join FPS multiplayer session
      socket.emit('joinRaidFPS', {
        roomCode: this.currentRoomCode,
        isPvP: !!this.isPvP,
        mode: this.raidMode || (this.isPvP ? 'PVP' : 'PVE'),
        x: Math.round(this.player.x),
        y: Math.round(this.player.y),
        angle: Number(this.player.angle.toFixed(2)),
        hp: this.player.hp,
        weapon: (this.player.weapon && this.player.weapon.gunType) || 'pipe'
      });

      // 1. Initial State from Server
      socket.on('initRaidFPS', (data) => {
        if (!data) return;
        this.myNetworkId = data.yourId;
        this.currentRoomCode = data.roomCode;
        if (data.isPvP !== undefined) this.isPvP = !!data.isPvP;
        if (data.mode) this.raidMode = data.mode;
        this.remotePlayers = {};

        for (const id in (data.players || {})) {
          if (id !== this.myNetworkId) {
            const p = data.players[id];
            this.remotePlayers[id] = {
              id: p.id,
              name: p.name || 'Ликвидатор',
              renderX: p.x,
              renderY: p.y,
              renderAngle: p.angle || 0,
              targetX: p.x,
              targetY: p.y,
              targetAngle: p.angle || 0,
              hp: p.hp || 100,
              maxHp: p.maxHp || 100,
              weapon: p.weapon || 'pipe',
              isShootingTimer: 0
            };
          }
        }
        const total = Object.keys(this.remotePlayers).length + 1;
        const maxPl = this.isPvP ? 16 : 4;
        const modeTitle = this.isPvP ? '☠️ PVP СМЕРТЕЛЬНЫЙ БОЙ' : '👥 КООП-РЕЙД';
        this.spawnFloatingNotice(`${modeTitle}: ${total}/${maxPl} ЛИКВИДАТОРОВ В СЕТИ`, this.isPvP ? '#ff3366' : '#33d4ff');
      });

      // PvP Damage from opponent
      socket.on('playerHurtFPS', (data) => {
        if (!data) return;
        if (data.targetId === this.myNetworkId) {
          const wDesc = data.weapon ? ` [${data.weapon}]` : '';
          this.damagePlayer(data.dmg, `Боец: ${data.attackerName || 'Ликвидатор'}${wDesc}`);
          this.spawnFloatingNotice(`ПОЛУЧЕН УРОН: -${data.dmg} HP ОТ ${data.attackerName || 'ВРАГА'}!`, '#ff3333');
        } else if (this.remotePlayers && this.remotePlayers[data.targetId]) {
          this.remotePlayers[data.targetId].hp = data.hp;
          this.remotePlayers[data.targetId].damageFlashTimer = 10;
          this.spawnHitParticles(this.remotePlayers[data.targetId].renderX, this.remotePlayers[data.targetId].renderY, '#ff3b30', 8);
        }
      });

      // PvP Death / Killfeed Notice
      socket.on('playerKilledFPS', (data) => {
        if (!data) return;
        const killMsg = `☠️ ${data.killerName} [${data.weapon || 'Огнестрел'}] ${data.victimName}`;
        this.spawnFloatingNotice(killMsg, '#ff3366');
        if (data.victimId === this.myNetworkId) {
          this.player.isDead = true;
          this.showDeathPrompt();
        } else if (data.killerId === this.myNetworkId) {
          this.spawnFloatingNotice(`🏆 ВЫ УНИЧТОЖИЛИ ${data.victimName}! +150 ТАЛОНОВ`, '#ffd700');
          this.player.talonsEarned = (this.player.talonsEarned || 0) + (data.rewardTalons || 150);
          if (typeof RadarAudio !== 'undefined' && RadarAudio.playLevelUp) {
            RadarAudio.playLevelUp();
          }
        }
      });

      // 2. Continuous 25 Hz World State Updates from Server
      // Zero-latency instant peer movement
      socket.on('peerMovedFPS', (data) => {
        if (!data || !data.id || data.id === this.myNetworkId) return;
        if (!this.remotePlayers[data.id]) {
          this.remotePlayers[data.id] = {
            id: data.id,
            name: data.name || 'Боец',
            renderX: data.x,
            renderY: data.y,
            renderAngle: data.angle || 0,
            targetX: data.x,
            targetY: data.y,
            targetAngle: data.angle || 0,
            hp: data.hp || 100,
            maxHp: 100,
            weapon: data.weapon || 'pipe',
            isShootingTimer: 0
          };
        } else {
          const peer = this.remotePlayers[data.id];
          peer.targetX = data.x;
          peer.targetY = data.y;
          peer.targetAngle = data.angle || 0;
          if (data.hp !== undefined) peer.hp = data.hp;
          if (data.weapon) peer.weapon = data.weapon;
          if (data.name) peer.name = data.name;
          if (!peer.snapshots) peer.snapshots = [];
          peer.snapshots.push({ time: Date.now(), x: data.x, y: data.y, angle: data.angle || 0 });
          if (peer.snapshots.length > 15) peer.snapshots.shift();
        }
      });

      socket.on('serverUpdateFPS', (data) => {
        if (!data || !data.players) return;
        for (const id in data.players) {
          if (id === this.myNetworkId) continue;
          const sPlayer = data.players[id];
          if (!this.remotePlayers[id]) {
            this.remotePlayers[id] = {
              id: sPlayer.id,
              name: sPlayer.name || 'Ликвидатор',
              renderX: sPlayer.x,
              renderY: sPlayer.y,
              renderAngle: sPlayer.angle || 0,
              targetX: sPlayer.x,
              targetY: sPlayer.y,
              targetAngle: sPlayer.angle || 0,
              hp: sPlayer.hp || 100,
              maxHp: sPlayer.maxHp || 100,
              weapon: sPlayer.weapon || 'pipe',
              isShootingTimer: 0
            };
          } else {
            const peer = this.remotePlayers[id];
            peer.targetX = sPlayer.x;
            peer.targetY = sPlayer.y;
            peer.targetAngle = sPlayer.angle || 0;
            if (sPlayer.hp !== undefined) peer.hp = sPlayer.hp;
            if (sPlayer.weapon) peer.weapon = sPlayer.weapon;
            if (sPlayer.name) peer.name = sPlayer.name;
            if (!peer.snapshots) peer.snapshots = [];
            peer.snapshots.push({ time: Date.now(), x: sPlayer.x, y: sPlayer.y, angle: sPlayer.angle || 0 });
            if (peer.snapshots.length > 15) peer.snapshots.shift();
          }
        }
      });

      // 3. New Peer Joined
      socket.on('playerJoinedFPS', (data) => {
        if (!data || !data.id || data.id === this.myNetworkId) return;
        const p = data.player || {};
        this.remotePlayers[data.id] = {
          id: data.id,
          name: p.name || 'Боец',
          renderX: p.x || 200,
          renderY: p.y || 200,
          renderAngle: p.angle || 0,
          targetX: p.x || 200,
          targetY: p.y || 200,
          targetAngle: p.angle || 0,
          hp: p.hp || 100,
          maxHp: 100,
          weapon: p.weapon || 'pipe',
          isShootingTimer: 0
        };
        this.spawnFloatingNotice(`👤 ${p.name || 'Боец'} подключился к сектору`, '#00ffaa');
      });

      // 4. Peer Shot VFX & SFX
      socket.on('peerShotVFX', (data) => {
        if (!data || data.shooterId === this.myNetworkId) return;
        const peer = this.remotePlayers[data.shooterId];
        if (peer) {
          peer.isShootingTimer = 6;
        }

        // Spatial Gunshot Audio from peer's world coordinates
        if (typeof RadarAudio !== 'undefined') {
          const sParam = this.getSpatialSoundParams(data.originX, data.originY);
          if (RadarAudio.playGunshot) {
            RadarAudio.playGunshot(data.weapon || 'pistol');
          }
        }

        // Projectile tracer
        const speed = 16;
        this.projectiles.push({
          x: data.originX + Math.cos(data.angle) * 16,
          y: data.originY + Math.sin(data.angle) * 16,
          vx: Math.cos(data.angle) * speed,
          vy: Math.sin(data.angle) * speed,
          damage: 0,
          isPlayer: false,
          isPeer: true,
          life: 40,
          color: '#ffe066'
        });
      });

      // 5. Peer Chat Speech Bubble
      socket.on('peerChatFPS', (data) => {
        if (!data || !data.id || data.id === this.myNetworkId) return;
        if (!this.remotePlayers[data.id]) {
          this.remotePlayers[data.id] = { name: data.name, renderX: 200, renderY: 200, targetX: 200, targetY: 200, renderAngle: 0, targetAngle: 0, hp: 100, maxHp: 100 };
        }
        this.remotePlayers[data.id].speech = { text: data.text, timer: 300 };
        this.spawnFloatingNotice(`💬 ${data.name}: ${data.text}`, '#ffffff');
      });

      // 6. Peer Left Session
      socket.on('playerLeftFPS', (peerId) => {
        if (this.remotePlayers[peerId]) {
          const uname = this.remotePlayers[peerId].name || 'Боец';
          delete this.remotePlayers[peerId];
          this.spawnFloatingNotice(`🚪 ${uname} покинул рейд`, '#ffaa00');
        }
      });

      // Fixed 25 Hz Client Input Streaming (every 40 ms)
      if (this.netInputTimer) clearInterval(this.netInputTimer);
      this.netInputTimer = setInterval(() => {
        if (!this.isRunning || typeof socket === 'undefined' || !socket || !socket.emit) return;
        socket.emit('playerInputFPS', {
          roomCode: this.currentRoomCode,
          forward: !!(this.keys['KeyW'] || this.keys['w'] || this.keys['ArrowUp'] || (this.touchMoveVector && this.touchMoveVector.active && this.touchMoveVector.y < -0.2)),
          backward: !!(this.keys['KeyS'] || this.keys['s'] || this.keys['ArrowDown'] || (this.touchMoveVector && this.touchMoveVector.active && this.touchMoveVector.y > 0.2)),
          strafeLeft: !!(this.keys['KeyA'] || this.keys['a'] || (this.touchMoveVector && this.touchMoveVector.active && this.touchMoveVector.x < -0.2)),
          strafeRight: !!(this.keys['KeyD'] || this.keys['d'] || (this.touchMoveVector && this.touchMoveVector.active && this.touchMoveVector.x > 0.2)),
          angle: Number(this.player.angle.toFixed(3)),
          x: Math.round(this.player.x),
          y: Math.round(this.player.y),
          hp: this.player.hp,
          weapon: (this.player.weapon && this.player.weapon.gunType) || 'pipe'
        });
      }, 40);
    }

    /**
     * Weapon Reload Mechanic ('R')
     */
    reloadWeapon() {
      const weapon = this.player.weapon;
      if (!weapon || !weapon.isRanged || this.isReloading || this.isKicking) return;
      this.isReloading = true;
      this.reloadProgress = 0;
      if (typeof RadarAudio !== 'undefined' && RadarAudio.playWeaponReload) {
        RadarAudio.playWeaponReload();
      }
      this.spawnFloatingNotice('🔄 ПЕРЕЗАРЯДКА...', '#ffd700');
    }

    /**
     * Quick Melee Combat Boot Kick ('F')
     */
    quickKick() {
      if (this.isKicking || this.player.isDead) return;
      this.isKicking = true;
      this.kickProgress = 0;

      if (typeof RadarAudio !== 'undefined' && RadarAudio.playKickMelee) {
        RadarAudio.playKickMelee(false);
      }

      // 1.5 tiles kick range (48px)
      const kickRange = this.tileSize * 1.5;
      const pAng = this.player.angle;
      let hitTarget = false;
      // Check hitting Breaker Box or Flesh Vent with quick kick
      for (const trap of (this.electricTraps || [])) {
        const box = trap.breakerBox;
        if (box && !box.disabled && Math.hypot(this.player.x - box.x, this.player.y - box.y) < kickRange + 16) {
          box.disabled = true;
          trap.disabled = true;
          this.spawnHitParticles(box.x, box.y, '#00f0ff', 12);
          this.spawnFloatingNotice('⚡ ЩИТОК ОБЕСТОЧЕН! ПРОВОДА БЕЗОПАСНЫ!', '#00ffaa');
          if (typeof RadarAudio !== 'undefined' && RadarAudio.playBreakerSwitch) {
            RadarAudio.playBreakerSwitch();
          }
        }
      }
      for (const vent of (this.fleshVents || [])) {
        if (vent.dormantTimer <= 0 && Math.hypot(this.player.x - vent.x, this.player.y - vent.y) < kickRange + 16) {
          vent.dormantTimer = 30.0;
          this.spawnHitParticles(vent.x, vent.y, '#880066', 10);
          this.spawnFloatingNotice('🦑 ЩУПАЛЬЦА ВТЯНУЛИСЬ В КОЛЛЕКТОР (-30 СЕК.)', '#bb44ee');
          if (typeof RadarAudio !== 'undefined' && RadarAudio.playMonsterHurt) {
            RadarAudio.playMonsterHurt();
          }
        }
      }


      for (const e of this.entities) {
        if (e.type === 'liquidator' || e.hp <= 0) continue;
        const dist = Math.hypot(e.x - this.player.x, e.y - this.player.y);
        if (dist <= kickRange + (e.radius || 12)) {
          const angToE = Math.atan2(e.y - this.player.y, e.x - this.player.x);
          let diff = Math.abs(angToE - pAng);
          if (diff > Math.PI) diff = Math.PI * 2 - diff;

          if (diff < 0.75) { // ~43 degree forward cone
            hitTarget = true;
            e.hp -= 15;
            e.damageFlashTimer = 10;
            e.flinchX = Math.cos(angToE) * 14;
            e.flinchY = Math.sin(angToE) * 14;

            // Stun & Interrupt attack preparation for 500ms (30 frames at 60fps)
            e.attackWindup = 0;
            e.stunTimer = 30;

            // Knockback by 1 tile (32px), checking collision with solid walls
            const pushDist = this.tileSize * 1.0;
            const nx = e.x + Math.cos(angToE) * pushDist;
            const ny = e.y + Math.sin(angToE) * pushDist;
            const ntx = Math.floor(nx / this.tileSize);
            const nty = Math.floor(ny / this.tileSize);
            if (this.mapData && this.mapData.grid && this.mapData.grid[nty] && this.mapData.grid[nty][ntx] !== 1) {
              e.x = nx;
              e.y = ny;
            }

            this.spawnHitParticles(e.x, e.y, '#ff3b30', 10);
            this.spawnFloatingNotice('-15 [ПИНОК!]', '#ffcc00');

            if (typeof RadarAudio !== 'undefined') {
              RadarAudio.playKickMelee(true);
              const p = this.getSpatialSoundParams(e.x, e.y);
              if (RadarAudio.playSpatialMonsterHurt) {
                RadarAudio.playSpatialMonsterHurt(p.pan, p.distFactor);
              }
            }

            if (e.hp <= 0) {
              this.killMonster(e);
            }
            break; // Kick hits frontmost target
          }
        }
      }
    }

    /**
     * Spatial Stereo Sound Angle & Distance Calculation
     */
    getSpatialSoundParams(soundX, soundY) {
      const dx = soundX - this.player.x;
      const dy = soundY - this.player.y;
      const soundAngle = Math.atan2(dy, dx) - this.player.angle;
      const pan = Math.sin(soundAngle); // -1.0 (left) to +1.0 (right)
      const dist = Math.hypot(dx, dy);
      const distFactor = Math.max(0.06, Math.min(1.0, 1.0 - (dist / (this.tileSize * 16))));
      return { pan, distFactor, dist };
    }

    /**
     * Render Particle Brass Shell Casings in FPS Mode
     */
    drawFPSCasings(ctx) {
      if (!this.casings || this.casings.length === 0) return;
      ctx.save();
      for (let i = 0; i < this.casings.length; i++) {
        const c = this.casings[i];
        ctx.save();
        ctx.translate(c.screenX, c.screenY);
        ctx.rotate(c.rot);

        // Drop shadow
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(-c.width / 2 + 2, -c.size / 2 + 3, c.width, c.size);

        // Casing Body
        ctx.fillStyle = c.color;
        ctx.fillRect(-c.width / 2, -c.size / 2, c.width, c.size);

        // Metallic Rim / Primer Cap
        ctx.fillStyle = c.capColor || '#ffd700';
        ctx.fillRect(-c.width / 2, c.size / 2 - 2.5, c.width, 2.5);

        ctx.restore();
      }
      ctx.restore();
    }

    /**
     * Render Quick Melee Combat Boot Kick Animation
     */
    drawFPSKick(ctx, w, h) {
      const p = this.kickProgress || 0;
      const ease = Math.sin(p * Math.PI); // 0 -> 1 -> 0

      const kickX = w * 0.42 + ease * 40;
      const kickY = h + 120 - ease * (h * 0.55);

      ctx.save();
      ctx.translate(kickX, kickY);
      ctx.rotate(-0.25 + ease * 0.45);

      // Heavy Combat Boot (Liquidator Hazmat Leg)
      // Murky green trouser leg
      ctx.fillStyle = '#324233';
      ctx.beginPath();
      ctx.moveTo(-35, 120);
      ctx.lineTo(25, 120);
      ctx.lineTo(15, -40);
      ctx.lineTo(-25, -40);
      ctx.closePath();
      ctx.fill();

      // Boot shaft (Heavy reinforced black leather)
      ctx.fillStyle = '#171c19';
      ctx.fillRect(-26, -55, 48, 55);

      // Metal shin buckle & strap
      ctx.fillStyle = '#4c5c50';
      ctx.fillRect(-28, -42, 52, 6);
      ctx.fillStyle = '#9cb3a0';
      ctx.fillRect(-6, -44, 12, 10);

      // Boot Foot & Sole
      ctx.fillStyle = '#111613';
      ctx.beginPath();
      ctx.moveTo(-28, 0);
      ctx.lineTo(45, 0);
      ctx.lineTo(55, -28); // Toe
      ctx.lineTo(-28, -28); // Heel
      ctx.closePath();
      ctx.fill();

      // Steel Toe Cap
      ctx.fillStyle = '#677f6f';
      ctx.beginPath();
      ctx.arc(42, -14, 15, -Math.PI / 2, Math.PI / 2);
      ctx.fill();

      // Deep tread sole lugs
      ctx.fillStyle = '#080c09';
      for (let lx = -25; lx < 45; lx += 10) {
        ctx.fillRect(lx, 0, 6, 6);
      }

      ctx.restore();

      // Motion swoosh trail
      if (ease > 0.4) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.arc(w * 0.45, h * 0.6, 95, -0.6, 0.4);
        ctx.stroke();
      }
    }

    /**
     * Interactive Supply Chest Open
     */
    openChest(chest) {
      if (!chest || chest.opened) return;
      if (chest.requiresKeycard && chest.isLocked) {
        if (this.player.hasKeycard) {
          chest.isLocked = false;
          chest.requiresKeycard = false;
          this.spawnFloatingNotice('🔓 СУНДУК ВСКРЫТ КЛЮЧ-КАРТОЙ!', '#00ffaa');
          if (typeof RadarAudio !== 'undefined' && RadarAudio.playKeycardUnlock) {
            RadarAudio.playKeycardUnlock();
          }
        } else {
          this.spawnFloatingNotice('⚠️ СУНДУК ЗАПЕРТ // ТРЕБУЕТСЯ КЛЮЧ-КАРТА ДОПУСКА!', '#ff3333');
          if (typeof RadarAudio !== 'undefined' && RadarAudio.playDoorDenied) {
            RadarAudio.playDoorDenied();
          }
          return;
        }
      }

      chest.opened = true;
      if (typeof RadarAudio !== 'undefined' && RadarAudio.playLootPickup) {
        RadarAudio.playLootPickup();
      }
      const l = chest.loot || { talons: 100, ammo: 15, medkits: 1 };
      this.player.talonsEarned += (l.talons || 0);
      this.player.xpEarned += 45;

      // Update NPC quests regarding chests
      for (const n of (this.npcs || [])) {
        if (n.quest && n.quest.requiresChest && !n.quest.completed) {
          n.quest.completed = true;
          this.spawnFloatingNotice(`🏆 ЗАДАНИЕ ВЫПОЛНЕНО: ${n.quest.title}! ПОГОВОРИТЕ С ${n.name}`, '#00ffaa');
        }
      }

      if (l.weapon) {
        this.player.weapon = Object.assign({}, l.weapon);
        this.spawnFloatingNotice(`📦 В СУНДУКЕ НАЙДЕН ${l.weapon.name}! +${l.talons} ТАЛОНОВ`, '#00ffaa');
      } else if (l.hasKeycard) {
        this.player.hasKeycard = true;
        for (const n of (this.npcs || [])) {
          if (n.quest && n.quest.requiresKeycard && !n.quest.completed) {
            n.quest.completed = true;
            this.spawnFloatingNotice(`🏆 КЛЮЧ-КАРТА НАЙДЕНА! ВЕРНИТЕСЬ К ${n.name}`, '#00ffaa');
          }
        }
        this.spawnFloatingNotice('🔑 В СУНДУКЕ НАЙДЕНА КЛЮЧ-КАРТА ДОСТУПА!', '#00ffaa');
      } else {
        this.spawnFloatingNotice(`📦 СУНДУК: +${l.talons} ТАЛОНОВ, +${l.ammo || 0} ПАТРОНОВ`, '#ffd700');
      }
    }

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
        for (const lamp of (this.lightSources || this.lamps)) {
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

    checkClutterCollision(worldX, worldY, radius = 10) {
      if (!this.props) return false;
      for (let i = 0; i < this.props.length; i++) {
        const p = this.props[i];
        if (p.isPassable) continue;
        const pr = p.radius || 12;
        const dx = worldX - p.x;
        const dy = worldY - p.y;
        if (dx * dx + dy * dy < (radius + pr) * (radius + pr)) {
          return true;
        }
      }
      return false;
    }

    hasLineOfSight(x1, y1, x2, y2) {
      if (!this.mapData || !this.mapData.grid) return true;
      const TS = this.tileSize;
      const grid = this.mapData.grid;
      const W = this.mapData.width;
      const H = this.mapData.height;

      const dx = x2 - x1;
      const dy = y2 - y1;
      const dist = Math.hypot(dx, dy);
      if (dist <= TS * 0.5) return true;

      const steps = Math.ceil(dist / (TS * 0.35));
      const stepX = dx / steps;
      const stepY = dy / steps;

      for (let i = 1; i < steps; i++) {
        const cx = x1 + stepX * i;
        const cy = y1 + stepY * i;
        const tx = Math.floor(cx / TS);
        const ty = Math.floor(cy / TS);

        if (tx < 0 || tx >= W || ty < 0 || ty >= H) return false;
        if (grid[ty][tx] === 1) return false;
        if (grid[ty][tx] === 2) {
          const d = this.doors.find(dr => dr.tileX === tx && dr.tileY === ty);
          const prog = d ? (d.openProgress !== undefined ? d.openProgress : (d.isOpen ? 1 : 0)) : 0;
          if (prog < 0.6) return false;
        }
      }
      return true;
    }

    isPointInFlashlight(tx, ty) {
      const px = this.player.x;
      const py = this.player.y;
      const dx = tx - px;
      const dy = ty - py;
      const dist = Math.hypot(dx, dy);
      if (dist > 450) return false;
      if (dist < 75) return true; // Close ambient radius

      const ang = Math.atan2(dy, dx);
      let diff = Math.abs(ang - this.player.angle);
      while (diff > Math.PI) diff = Math.PI * 2 - diff;
      return diff < 0.55; // ~63 degree flashlight beam cone
    }

    drawSoundPing(ctx, x, y, timer = 30) {
      const ripple = (1 - timer / 60) * 45;
      const alpha = Math.max(0, timer / 60);
      ctx.save();
      ctx.strokeStyle = `rgba(255, 60, 60, ${alpha * 0.75})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 10 + ripple, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = `rgba(255, 200, 50, ${alpha})`;
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('🔊 ШУМ', x, y - 14 - ripple * 0.3);
      ctx.restore();
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
      this.screenFlashTimer = 10;
      this.screenShakeTimer = 8;
      this.screenShakeIntensity = Math.min(8, 3 + Math.floor(amount / 8));
      this.playerDamageVignette = 1.0;
      // Camera angle pitch twitch (+/- 2 degrees)
      this.player.angle += (Math.random() - 0.5) * (4 * Math.PI / 180);

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

        // Check hit on breaker box to disable electric wire trap
        for (const trap of (this.electricTraps || [])) {
          const box = trap.breakerBox;
          if (box && !box.disabled && Math.hypot(p.x - box.x, p.y - box.y) < 18) {
            box.disabled = true;
            trap.disabled = true;
            this.spawnHitParticles(box.x, box.y, '#00f0ff', 12);
            this.spawnFloatingNotice('⚡ ЩИТОК ОБЕСТОЧЕН! ПРОВОДА БЕЗОПАСНЫ!', '#00ffaa');
            if (typeof RadarAudio !== 'undefined' && RadarAudio.playBreakerSwitch) {
              RadarAudio.playBreakerSwitch();
            }
            this.projectiles.splice(i, 1);
            continue;
          }
        }

        // Check hit on flesh vent trap to force tentacles into sewer
        for (const vent of (this.fleshVents || [])) {
          if (vent.dormantTimer <= 0 && Math.hypot(p.x - vent.x, p.y - vent.y) < 20) {
            vent.dormantTimer = 30.0;
            this.spawnHitParticles(vent.x, vent.y, '#880066', 10);
            this.spawnFloatingNotice('🦑 ЩУПАЛЬЦА ВТЯНУЛИСЬ В КОЛЛЕКТОР (-30 СЕК.)', '#bb44ee');
            if (typeof RadarAudio !== 'undefined' && RadarAudio.playMonsterHurt) {
              RadarAudio.playMonsterHurt();
            }
            this.projectiles.splice(i, 1);
            continue;
          }
        }

        // Check hit on explosive chemical barrels
        for (let bi = (this.explosiveBarrels || []).length - 1; bi >= 0; bi--) {
          const barrel = this.explosiveBarrels[bi];
          if (Math.hypot(p.x - barrel.x, p.y - barrel.y) < (barrel.radius || 13) + 4) {
            this.detonateExplosiveBarrel(barrel);
            this.projectiles.splice(i, 1);
            continue;
          }
        }

        if (this.isTileSolid(p.x, p.y, 4) || p.life <= 0) {
          this.spawnHitParticles(p.x, p.y, p.color || '#1fe044', 4);
          this.projectiles.splice(i, 1);
          continue;
        }

        if (p.isPlayer) {
          let hit = false;

          // PvP Check: projectile collision against remote players
          if (this.isPvP || this.raidMode === 'PVP') {
            for (const rId in (this.remotePlayers || {})) {
              const rp = this.remotePlayers[rId];
              if (!rp || rp.hp <= 0) continue;
              if (Math.hypot(p.x - rp.renderX, p.y - rp.renderY) < 24) {
                const dmg = p.damage || 30;
                rp.hp = Math.max(0, (rp.hp || 100) - dmg);
                rp.damageFlashTimer = 10;
                this.spawnHitParticles(p.x, p.y, '#ff3b30', 8);
                this.spawnFloatingNotice(`💥 ПОПАДАНИЕ: -${dmg} HP [${rp.name || 'Боец'}]`, '#ff3366');
                if (typeof RadarAudio !== 'undefined') RadarAudio.playMonsterHurt();
                if (typeof socket !== 'undefined' && socket && socket.emit) {
                  socket.emit('pvpHitPlayer', {
                    roomCode: this.currentRoomCode,
                    targetId: rId,
                    dmg: dmg,
                    weapon: (this.player.weapon && this.player.weapon.name) || 'Огнестрел'
                  });
                }
                hit = true;
                break;
              }
            }
            if (hit) {
              this.projectiles.splice(i, 1);
              continue;
            }
          }

          // Check monster hit
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

      // Screen Shake offset
      if (this.screenShakeTimer > 0) {
        const sInt = this.screenShakeIntensity || 4;
        const sX = (Math.random() - 0.5) * sInt * 2;
        const sY = (Math.random() - 0.5) * sInt * 2;
        this.ctx.save();
        this.ctx.translate(sX, sY);
      }

      // Screen Shake offset
      if (this.screenShakeTimer > 0) {
        const sInt = this.screenShakeIntensity || 4;
        const sX = (Math.random() - 0.5) * sInt * 2;
        const sY = (Math.random() - 0.5) * sInt * 2;
        this.ctx.save();
        this.ctx.translate(sX, sY);
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

        // 1c. Draw Floor Blood & Slime Decals
        if (this.decals) {
          for (let di = 0; di < this.decals.length; di++) {
            const dec = this.decals[di];
            if (this.isCellExplored(Math.floor(dec.x / this.tileSize), Math.floor(dec.y / this.tileSize))) {
              if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawDecal) {
                SpriteFactory.drawDecal(worldCtx, dec);
              }
            }
          }
        }

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

        // 2c. Draw Living Cell & Bunker Props
        for (const prop of (this.props || [])) {
          if (this.isCellExplored(prop.tileX, prop.tileY)) {
            if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawProp) {
              SpriteFactory.drawProp(worldCtx, prop, this.tileSize, this.tick, 1.0);
            }
          }
        }

        // 2d. Draw Supply Chests
        for (const chest of (this.chests || [])) {
          if (this.isCellExplored(chest.tileX, chest.tileY)) {
            if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawChest) {
              SpriteFactory.drawChest(worldCtx, chest, this.tileSize, this.tick);
            }
          }
        }

        // 2e. Draw Friendly NPCs
        for (const npc of (this.npcs || [])) {
          if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawEntity) {
            SpriteFactory.drawEntity(worldCtx, Object.assign({}, npc, { isPlayer: false, color: '#00ffaa' }), this.tick);
          }
        }

        
        // Environmental Lore: Tape Recorders in 2D
        for (const rec of (this.recorders || [])) {
          if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawTapeRecorder) {
            SpriteFactory.drawTapeRecorder(worldCtx, rec, this.tileSize, this.tick, 1.0);
          }
        }

        // Environmental Lore: Wall Notes in 2D
        for (const note of (this.wallNotes || [])) {
          if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawWallNote) {
            SpriteFactory.drawWallNote(worldCtx, note, this.tileSize, this.tick, 1.0);
          }
        }

        // Interactive Dungeon Traps: Electric Wires in 2D
        for (const trap of (this.electricTraps || [])) {
          if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawElectricWireTrap) {
            SpriteFactory.drawElectricWireTrap(worldCtx, trap, this.tileSize, this.tick, 1.0);
          }
          if (trap.breakerBox && typeof SpriteFactory !== 'undefined' && SpriteFactory.drawBreakerBox) {
            SpriteFactory.drawBreakerBox(worldCtx, trap.breakerBox, this.tileSize, this.tick, 1.0);
          }
        }

        // Interactive Dungeon Traps: Flesh Vents in 2D
        for (const vent of (this.fleshVents || [])) {
          if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawFleshVentTrap) {
            SpriteFactory.drawFleshVentTrap(worldCtx, vent, this.tileSize, this.tick, 1.0);
          }
        }

        // Airlock Defense Barricades in 2D
        for (const bar of (this.siegeBarricades || [])) {
          if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawBarricade) {
            SpriteFactory.drawBarricade(worldCtx, bar, this.tileSize, this.tick, 1.0);
          }
        }

        // VOKhR Supply Crate in 2D
        if (this.vokhrCrate && typeof SpriteFactory !== 'undefined' && SpriteFactory.drawVokhrCrate) {
          SpriteFactory.drawVokhrCrate(worldCtx, this.vokhrCrate, this.tileSize, this.tick, 1.0);
        }

        // Hydraulic Elevator Terminal in 2D
        if (this.elevatorTerminal && typeof SpriteFactory !== 'undefined' && SpriteFactory.drawElevatorTerminal) {
          SpriteFactory.drawElevatorTerminal(worldCtx, this.elevatorTerminal, this.tileSize, this.tick, this.siegeTimer, 1.0);
        }

        // 3b. Draw Hazardous Explosive Barrels
        for (const barrel of (this.explosiveBarrels || [])) {
          if (!barrel.exploded) {
            if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawExplosiveBarrel) {
              SpriteFactory.drawExplosiveBarrel(worldCtx, barrel, this.tileSize, this.tick, 1.0);
            }
          }
        }
        for (const barrel of (this.barrels || [])) {
          if (!barrel.exploded && this.isCellExplored(barrel.tileX, barrel.tileY)) {
            if (typeof SpriteFactory !== 'undefined' && SpriteFactory.drawExplosiveBarrel) {
              SpriteFactory.drawExplosiveBarrel(worldCtx, barrel, this.tileSize, this.tick, 1.0);
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

        // 8. Draw AI Entities with Line-of-Sight & Stealth Fog-of-War
        for (const e of this.entities) {
          if (e.hp <= 0) continue;
          if (e.alertTimer > 0) e.alertTimer--;

          const hasLOS = this.hasLineOfSight(this.player.x, this.player.y, e.x, e.y);
          const inLight = this.isPointInFlashlight(e.x, e.y);
          const isLoud = (e.alertTimer && e.alertTimer > 0) || (e.isShootingTimer && e.isShootingTimer > 0);
          const isRevealed = (hasLOS && inLight) || isLoud;

          if (!isRevealed) {
            if (isLoud) this.drawSoundPing(worldCtx, e.x, e.y, e.alertTimer || 30);
            continue; // Hidden in fog of war stealth!
          }

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
      // Screen Flash Damage Vignette (Red radial aura on hit)
      if (this.screenFlashTimer > 0) {
        const vAlpha = (this.screenFlashTimer / 10) * 0.45;
        const vGrad = this.ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.max(w, h) * 0.72);
        vGrad.addColorStop(0, 'rgba(255, 0, 0, 0)');
        vGrad.addColorStop(0.6, 'rgba(255, 0, 0, 0.15)');
        vGrad.addColorStop(1, `rgba(220, 0, 0, ${vAlpha.toFixed(2)})`);
        this.ctx.fillStyle = vGrad;
        this.ctx.fillRect(0, 0, w, h);
      }

      this.drawRadarHUD(this.ctx, w, h);
      if (this.screenShakeTimer > 0) {
        this.ctx.restore();
      }

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
      const pAngle = this.player.angle + ((this.recoilX || 0) * 0.004);
      const fov = 1.15; // ~66 degrees field of view
      const halfFov = fov / 2;
      const halfH = Math.floor(h / 2 - (this.recoilY || 0) + (this.horizonOffset || 0));

      ctx.save();
      // Apply Camera Roll on strafing
      if (Math.abs(this.cameraRoll || 0) > 0.0005) {
        ctx.translate(w / 2, h / 2);
        ctx.rotate(this.cameraRoll);
        ctx.translate(-w / 2, -h / 2);
      }

      // 1. High-Performance Hardware-Accelerated Ceiling & Floor (Zero-allocation 60+ FPS)
      const ceilGrad = ctx.createLinearGradient(0, 0, 0, halfH);
      ceilGrad.addColorStop(0, '#040d07');
      ceilGrad.addColorStop(0.35, '#08170e');
      ceilGrad.addColorStop(0.85, '#030805');
      ceilGrad.addColorStop(1, '#010402');
      ctx.fillStyle = ceilGrad;
      ctx.fillRect(0, 0, w, halfH);

      const floorGrad = ctx.createLinearGradient(0, halfH, 0, h);
      floorGrad.addColorStop(0, '#010402');
      floorGrad.addColorStop(0.12, '#06130a');
      floorGrad.addColorStop(0.55, '#122618');
      floorGrad.addColorStop(0.85, '#193822');
      floorGrad.addColorStop(1, '#21472b');
      ctx.fillStyle = floorGrad;
      ctx.fillRect(0, halfH, w, h - halfH);

      // Fast vector perspective concrete seams (2 draw calls total)
      ctx.strokeStyle = 'rgba(0, 255, 120, 0.055)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let row = 1; row <= 12; row++) {
        const t = row / 12;
        const py = halfH + Math.pow(t, 2.0) * (h - halfH);
        ctx.moveTo(0, py);
        ctx.lineTo(w, py);
      }
      for (let col = -4; col <= 4; col++) {
        const bx = w / 2 + col * (w * 0.16);
        ctx.moveTo(w / 2, halfH);
        ctx.lineTo(bx, h);
      }
      ctx.stroke();

      // Fast vector perspective ceiling cable trays (1 draw call)
      ctx.strokeStyle = 'rgba(0, 180, 80, 0.035)';
      ctx.beginPath();
      for (let row = 1; row <= 8; row++) {
        const t = row / 8;
        const cy = halfH - Math.pow(t, 2.0) * halfH;
        ctx.moveTo(0, cy);
        ctx.lineTo(w, cy);
      }
      ctx.stroke();

      // 2. DDA Raycaster for vertical wall strips
      const colStep = 3; // Optimized 3px columns (matches 6px ASCII grid)
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
            const isHazardStripe = (Math.floor(wallX * 8 + (drawEnd - drawStart) * 0.05) % 2 === 0);
            const stripeColor = isHazardStripe ? [190, 150, 20] : [35, 42, 38];
            ctx.fillStyle = `rgb(${Math.floor(stripeColor[0] * sideDarken)}, ${Math.floor(stripeColor[1] * sideDarken)}, ${Math.floor(stripeColor[2] * sideDarken)})`;
            ctx.fillRect(screenX, drawStart, colStep, drawEnd - drawStart);

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
        // Directional Wall Shading: horizontal hits (side === 1) shaded by 0.75x, vertical hits (side === 0) 1.0x
        const sideDarken = (side === 1) ? 0.75 : 1.0;
        let shade = Math.max(0.04, Math.min(1.0, 1.0 - perpDist / maxShadeDist)) * sideDarken;

        
        // Wall Bullet Impact Decal overlay
        if (this.wallDecals && this.wallDecals.length > 0) {
          for (let wdi = 0; wdi < this.wallDecals.length; wdi++) {
            const wd = this.wallDecals[wdi];
            if (wd.tileX === mapX && wd.tileY === mapY) {
              const dY = halfH;
              const dH = Math.max(3, Math.floor(lineH * 0.08));
              ctx.fillStyle = '#080c09';
              ctx.fillRect(screenX, dY, colStep, dH);
            }
          }
        }

        // Dynamic Map Lights accumulation (Emergency Red, Warm Amber & Sparking Panels)
        const hitWorldX = px + cos * (perpDist * TS);
        const hitWorldY = py + sin * (perpDist * TS);
        let lightR = 0, lightG = 0, lightB = 0;

        if (this.lightSources) {
          for (let li = 0; li < this.lightSources.length; li++) {
            const ls = this.lightSources[li];
            const ld = Math.hypot(hitWorldX - ls.x, hitWorldY - ls.y);
            const effRad = ls.radius + (ls.flicker ? (Math.sin(this.tick * 0.25 + ls.x) * 3 + (Math.random() - 0.5) * 2) : 0);
            if (ld < effRad) {
              const atten = Math.pow(1.0 - ld / effRad, 1.8) * (ls.intensity || 0.8);
              lightR += ls.rgb[0] * atten;
              lightG += ls.rgb[1] * atten;
              lightB += ls.rgb[2] * atten;
              shade = Math.min(1.0, shade + atten * 0.45);
            }
          }
        }

        // Smooth darkness falloff overlay
        const darkAlpha = 1.0 - shade;
        if (darkAlpha > 0.02) {
          ctx.fillStyle = `rgba(1, 8, 4, ${darkAlpha.toFixed(2)})`;
          ctx.fillRect(screenX, drawStart, colStep, drawEnd - drawStart);
        }

        // Inner Corner Ambient Occlusion (AO): Top 10% and Bottom 10% fast darkening
        const colH = drawEnd - drawStart;
        const aoH = Math.max(2, Math.floor(colH * 0.08));
        if (aoH > 1) {
          ctx.fillStyle = 'rgba(2, 8, 4, 0.55)';
          ctx.fillRect(screenX, drawStart, colStep, aoH);
          ctx.fillRect(screenX, drawEnd - aoH, colStep, aoH);
        }

        // Tint wall strip with colored light accumulation
        if (lightR > 4 || lightG > 4 || lightB > 4) {
          const maxL = Math.max(lightR, lightG, lightB);
          const lAlpha = Math.min(0.48, (maxL / 255) * 0.55);
          ctx.fillStyle = `rgba(${Math.min(255, Math.floor(lightR))}, ${Math.min(255, Math.floor(lightG))}, ${Math.min(255, Math.floor(lightB))}, ${lAlpha.toFixed(2)})`;
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

      // 3. Billboard Entities (Decals, Monsters, Allies, Loot, Crates, Elevator)
      const visibleSprites = [];

      // Blood & Slime Floor Decals
      if (this.decals) {
        for (let di = 0; di < this.decals.length; di++) {
          const dec = this.decals[di];
          visibleSprites.push({
            x: dec.x,
            y: dec.y,
            type: 'decal',
            color: dec.color,
            splatterColor: dec.splatterColor,
            radius: dec.radius,
            isFloorDecal: true
          });
        }
      }

      if (this.elevator) {
        visibleSprites.push({
          x: this.elevator.x + 32,
          y: this.elevator.y + 32,
          type: 'elevator',
          key: 'exit_elevator',
          color: '#00ff88',
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
          const isMed = !!(drop.isMedkit || (drop.item && (drop.item.id === 'food_medkit' || drop.item.type === 'heal')) || (drop.name && drop.name.includes('Аптечк')));
          let itemKey = isMed ? 'food_medkit' : 'loot_crate';
          if (!isMed) {
            if (drop.weapon) {
              const wId = (drop.weapon.id || drop.weapon.type || '').toLowerCase();
              if (wId.includes('shotgun') || wId.includes('ks23') || wId.includes('saiga')) itemKey = 'weapon_shotgun';
              else if (wId.includes('pipe') || wId.includes('crowbar') || wId.includes('melee')) itemKey = 'weapon_pipe';
              else if (wId.includes('flame') || wId.includes('fire')) itemKey = 'weapon_flamethrower';
              else if (wId.includes('rifle') || wId.includes('ak')) itemKey = 'weapon_rifle';
              else itemKey = 'weapon_pistol';
            } else if (drop.item) {
              const iId = (drop.item.id || drop.item.type || '').toLowerCase();
              if (iId.includes('ammo')) itemKey = 'ammo_box';
              else if (iId.includes('filter')) itemKey = 'gas_filter';
              else itemKey = 'loot_crate';
            }
          }

          visibleSprites.push({
            x: drop.x,
            y: drop.y,
            type: 'weapon',
            key: itemKey,
            isMedkit: isMed,
            color: isMed ? '#33ff77' : '#00ffaa'
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

      // Remote Live Players in 4-Player FPS Raid with Interpolated Coordinates
      for (const rId in (this.remotePlayers || {})) {
        const rp = this.remotePlayers[rId];
        visibleSprites.push({
          x: rp.renderX !== undefined ? rp.renderX : rp.x,
          y: rp.renderY !== undefined ? rp.renderY : rp.y,
          type: 'peer',
          key: 'liquidator',
          color: '#33d4ff',
          name: rp.name || 'Ликвидатор',
          hp: rp.hp || 100,
          maxHp: rp.maxHp || 100,
          speech: rp.speech,
          isShooting: (rp.isShootingTimer > 0)
        });
      }

      // Bestiary Monsters in FPS Mode with Complete Monster Variety
      for (const ent of this.entities) {
        if (ent.hp > 0) {
          let mKey = 'black_slime';
          const eType = (ent.type || ent.id || '').toLowerCase();
          const eName = (ent.name || '').toLowerCase();

          if (eType.includes('boss_slime') || eName.includes('протоплазма')) mKey = 'boss_slime';
          else if (eType.includes('boss_reactor') || eName.includes('реактор')) mKey = 'boss_reactor';
          else if (eType.includes('hound') || eName.includes('гончая')) mKey = 'concrete_hound';
          else if (eType.includes('spider') || eName.includes('паук')) mKey = 'arachnid';
          else if (eType.includes('spitter') || eName.includes('плевун')) mKey = 'acid_spitter';
          else if (eType.includes('corpse') || eName.includes('трупоед')) mKey = 'corpse_feeder';
          else if (eType.includes('centipede') || eType.includes('six_legged') || eName.includes('шестижоп') || eType.includes('horror')) mKey = 'six_legged_horror';
          else if (eType.includes('rogue') || eType.includes('liquidator') || eName.includes('отступник')) mKey = 'rogue_liquidator';
          else if (eType.includes('pod') || eType.includes('mold') || eType.includes('spore') || eName.includes('споровик')) mKey = 'spore_pod';
          else if (eType.includes('cult') || eType.includes('mimic') || eType.includes('voice') || eName.includes('имитатор')) mKey = 'voice_mimic';
          else if (eType.includes('madman') || eType.includes('feral') || eName.includes('одичавший') || eName.includes('жилец')) mKey = 'feral_inhabitant';
          else mKey = 'black_slime';

          visibleSprites.push({
            x: ent.x + (ent.flinchX || 0),
            y: ent.y + (ent.flinchY || 0),
            type: 'monster',
            key: mKey,
            color: ent.color || '#ff3b30',
            hp: ent.hp,
            maxHp: ent.maxHp,
            damageFlashTimer: ent.damageFlashTimer || 0
          });
        }
      }

      // Friendly NPCs in FPS
      for (const npc of (this.npcs || [])) {
        visibleSprites.push({
          x: npc.x,
          y: npc.y,
          type: 'npc',
          key: 'npc_liquidator',
          color: '#00ffaa',
          name: npc.name,
          npc: npc
        });
      }

      // Living Cell & Office Props in FPS
      for (const prop of (this.props || [])) {
        visibleSprites.push({
          x: prop.x,
          y: prop.y,
          type: 'prop',
          key: 'crate_wood',
          prop: prop,
          color: '#8b5a2b'
        });
      }

      // Supply Chests in FPS
      for (const chest of (this.chests || [])) {
        if (!chest.opened) {
          visibleSprites.push({
            x: chest.x,
            y: chest.y,
            type: 'chest',
            key: chest.requiresKeycard ? 'crate_tech' : 'crate_supply',
            color: chest.requiresKeycard ? '#ff3366' : '#ffd700',
            chest: chest
          });
        }
      }

      // Environmental Lore: Tape Recorders in FPS
      for (const rec of (this.recorders || [])) {
        visibleSprites.push({
          x: rec.x,
          y: rec.y,
          type: 'recorder',
          key: 'item_recorder',
          recorder: rec,
          color: '#222624'
        });
      }

      // Environmental Lore: Wall Notes in FPS
      for (const note of (this.wallNotes || [])) {
        visibleSprites.push({
          x: note.x,
          y: note.y,
          type: 'wall_note',
          key: 'wall_note',
          note: note,
          color: '#ded1b4'
        });
      }

      // Interactive Dungeon Traps in FPS
      for (const trap of (this.electricTraps || [])) {
        visibleSprites.push({
          x: trap.x,
          y: trap.y,
          type: 'electric_wire',
          key: 'electric_wire',
          trap: trap,
          color: '#00f0ff'
        });
        if (trap.breakerBox) {
          visibleSprites.push({
            x: trap.breakerBox.x,
            y: trap.breakerBox.y,
            type: 'breaker_box',
            key: 'breaker_box',
            box: trap.breakerBox,
            color: '#33443a'
          });
        }
      }

      for (const vent of (this.fleshVents || [])) {
        visibleSprites.push({
          x: vent.x,
          y: vent.y,
          type: 'flesh_vent',
          key: 'flesh_vent',
          vent: vent,
          color: '#661155'
        });
      }

      // Airlock Defense Barricades in FPS
      for (const bar of (this.siegeBarricades || [])) {
        visibleSprites.push({
          x: bar.x + 16,
          y: bar.y + 16,
          type: 'barricade',
          key: 'barricade',
          barricade: bar,
          color: '#e6a100',
          hp: bar.hp,
          maxHp: bar.maxHp
        });
      }

      // Explosive Chemical Barrels in FPS
      for (const barrel of (this.explosiveBarrels || [])) {
        if (!barrel.exploded) {
          visibleSprites.push({
            x: barrel.x,
            y: barrel.y,
            type: 'barrel',
            key: 'barrel_explosive',
            color: '#ffaa00',
            name: '⚠️ ХИМ-БОЧКА'
          });
        }
      }

      // VOKhR Supply Crate in FPS
      if (this.vokhrCrate && !this.vokhrCrate.opened) {
        visibleSprites.push({
          x: this.vokhrCrate.x + 16,
          y: this.vokhrCrate.y + 12,
          type: 'vokhr_crate',
          key: 'vokhr_crate',
          crate: this.vokhrCrate,
          color: '#5a6b47'
        });
      }

      // Hydraulic Elevator Terminal in FPS
      if (this.elevatorTerminal) {
        visibleSprites.push({
          x: this.elevatorTerminal.x,
          y: this.elevatorTerminal.y,
          type: 'elevator_terminal',
          key: 'terminal',
          terminal: this.elevatorTerminal,
          color: '#ff3333',
          hp: this.elevatorTerminal.hp,
          maxHp: this.elevatorTerminal.maxHp
        });
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
      const inFrontSprites = visibleSprites.filter(sp => sp.perpDist > 22 && Math.cos(sp.angle) > 0.08 && Math.abs(sp.angle) < fov * 0.95);

      // Sort furthest to nearest by perpendicular distance
      inFrontSprites.sort((a, b) => b.perpDist - a.perpDist);

      for (const sp of inFrontSprites) {
        const screenX = Math.floor((w / 2) + Math.tan(sp.angle) * (w / 2) / Math.tan(fov / 2));
        const perpDistWorld = sp.perpDist;
        const wallBase = halfH + Math.floor(((h / (perpDistWorld / TS)) * 0.95) / 2);

        // Ground Decal Rendering
        if (sp.isFloorDecal) {
          const decalW = Math.max(6, Math.floor((h / (perpDistWorld / TS)) * 0.65));
          const decalH = Math.max(3, Math.floor(decalW * 0.3));
          const decLeft = Math.floor(screenX - decalW / 2);
          const decTop = Math.floor(wallBase - decalH);

          for (let stripeX = Math.max(0, decLeft); stripeX < Math.min(w, decLeft + decalW); stripeX += colStep) {
            const bufIdx = Math.floor(stripeX / colStep);
            if (bufIdx >= 0 && bufIdx < numCols && zBuffer[bufIdx] < perpDistWorld) continue;

            const u = (stripeX - decLeft) / decalW;
            const distFromCenter = Math.abs(u - 0.5) * 2;
            const sliceH = Math.floor(decalH * Math.sqrt(Math.max(0, 1 - distFromCenter * distFromCenter)));
            const sliceTop = wallBase - sliceH;

            ctx.fillStyle = sp.color || '#470808';
            ctx.fillRect(stripeX, sliceTop, colStep, sliceH);
          }
          continue;
        }

        const isItem = (sp.type === 'weapon' || sp.type === 'crate');
        const aspect = isItem ? (sp.isKeycard ? 1.05 : 0.68) : 0.82;
        const baseSprHeight = Math.min(h * 2.2, Math.floor((h / (perpDistWorld / TS)) * 0.88));

        // Hover & Pseudo-3D Spin for dropped loot
        let hoverYOffset = 0;
        let spinScaleX = 1.0;
        if (sp.type === 'weapon') {
          hoverYOffset = Math.sin(Date.now() * 0.003 + sp.x) * (baseSprHeight * 0.09);
          spinScaleX = Math.cos(Date.now() * 0.004 + sp.y);
        }

        const sprHeight = baseSprHeight;
        const sprWidth = Math.max(4, Math.floor(sprHeight * aspect * Math.abs(spinScaleX)));
        const sprTop = Math.floor(wallBase - sprHeight - hoverYOffset);
        const sprLeft = Math.floor(screenX - sprWidth / 2);
        const sprRight = sprLeft + sprWidth;

        if (sprRight <= 0 || sprLeft >= w) continue;

        const shade = Math.max(0.08, Math.min(1.0, 1.0 - perpDistWorld / (TS * 18)));
        const darkAlpha = 1.0 - shade;

        // Ground Light Halo for items
        if (sp.type === 'weapon') {
          const haloW = Math.max(8, Math.floor((h / (perpDistWorld / TS)) * 0.55));
          const haloH = Math.max(3, Math.floor(haloW * 0.28));
          const haloLeft = Math.floor(screenX - haloW / 2);
          for (let hx = Math.max(0, haloLeft); hx < Math.min(w, haloLeft + haloW); hx += colStep) {
            const bufIdx = Math.floor(hx / colStep);
            if (bufIdx >= 0 && bufIdx < numCols && zBuffer[bufIdx] < perpDistWorld) continue;
            ctx.fillStyle = sp.isKeycard ? 'rgba(0, 229, 255, 0.55)' : (sp.isMedkit ? 'rgba(51, 255, 100, 0.35)' : 'rgba(255, 170, 0, 0.35)');
            ctx.fillRect(hx, wallBase - haloH / 2, colStep, haloH);
          }
        }

        let sprImg = null;
        if (typeof TextureManager !== 'undefined' && TextureManager.getSprite && sp.key) {
          sprImg = TextureManager.getSprite(sp.key);
        }

        let anyStripeVisible = false;

        // PER-COLUMN STRIPE RENDERING & Z-BUFFER OCCLUSION
        for (let stripeX = Math.max(0, sprLeft); stripeX < Math.min(w, sprRight); stripeX += colStep) {
          const bufIdx = Math.floor(stripeX / colStep);
          if (bufIdx >= 0 && bufIdx < numCols && zBuffer[bufIdx] < perpDistWorld) {
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
              // Glowing Floating Neon "S" Exit Glyph
              const hoverY = Math.sin(this.tick * 0.08) * 14;
              const sTop = sprTop + hoverY;
              ctx.fillStyle = '#00ffcc';
              ctx.shadowColor = '#00ffaa';
              ctx.shadowBlur = 18;
              ctx.fillRect(stripeX, sTop, colStep, sprHeight * 0.7);
              ctx.shadowBlur = 0;
            } else if (sp.type === 'npc') {
              ctx.fillStyle = '#00ffaa';
              ctx.fillRect(stripeX, sprTop, colStep, sprHeight);
            } else if (sp.type === 'recorder') {
              const rec = sp.recorder;
              const blink = rec && !rec.listened && (Math.floor(this.tick / 16) % 2 === 0);
              ctx.fillStyle = blink ? '#ff2222' : '#33403a';
              ctx.fillRect(stripeX, sprTop + sprHeight * 0.45, colStep, sprHeight * 0.55);
            } else if (sp.type === 'wall_note') {
              ctx.fillStyle = '#dfd3b6';
              ctx.fillRect(stripeX, sprTop + sprHeight * 0.25, colStep, sprHeight * 0.7);
            } else if (sp.type === 'electric_wire') {
              const trap = sp.trap;
              ctx.fillStyle = (trap && trap.isArcing && !trap.disabled) ? '#00f0ff' : '#1c2420';
              ctx.fillRect(stripeX, sprTop, colStep, sprHeight * 0.9);
            } else if (sp.type === 'breaker_box') {
              const box = sp.box;
              ctx.fillStyle = (box && box.disabled) ? '#00e676' : '#ff3b30';
              ctx.fillRect(stripeX, sprTop + sprHeight * 0.35, colStep, sprHeight * 0.5);
            } else if (sp.type === 'flesh_vent') {
              const vent = sp.vent;
              ctx.fillStyle = (vent && vent.dormantTimer > 0) ? '#1f1b17' : '#661155';
              ctx.fillRect(stripeX, sprTop + sprHeight * 0.75, colStep, sprHeight * 0.25);
            } else {
              ctx.fillStyle = sp.color || '#ff3b30';
              ctx.fillRect(stripeX, sprTop + sprHeight * 0.15, colStep, sprHeight * 0.85);
            }
          }

          // Damage Flash (Bright White / Red Flash on hit)
          if (sp.damageFlashTimer > 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
            ctx.fillRect(stripeX, sprTop, colStep, sprHeight);
          }

          // Shading overlay
          if (darkAlpha > 0.05) {
            ctx.fillStyle = `rgba(1, 8, 4, ${darkAlpha.toFixed(2)})`;
            ctx.fillRect(stripeX, sprTop, colStep, sprHeight);
          }
        }

        // Name tag, speech bubble and health bar rendered only if sprite is visible
        if (anyStripeVisible && sp.type === 'peer') {
          const centerBufIdx = Math.floor(screenX / colStep);
          if (centerBufIdx < 0 || centerBufIdx >= numCols || zBuffer[centerBufIdx] >= perpDistWorld * 0.9) {
            const barW = Math.max(30, Math.min(75, sprWidth * 0.85));
            const barH = 4;
            const barX = Math.floor(screenX - barW / 2);
            const barY = Math.max(12, sprTop - 6);

            // Green ASCII Name Tag
            ctx.fillStyle = '#00ffcc';
            ctx.font = 'bold 10.5px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(sp.name || 'Ликвидатор', screenX, barY - 4);

            // Health bar (Green Phosphor)
            const hpPct = Math.max(0, Math.min(1, sp.hp / sp.maxHp));
            ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
            ctx.fillRect(barX, barY, barW, barH);
            ctx.fillStyle = '#1fe044';
            ctx.fillRect(barX, barY, Math.floor(barW * hpPct), barH);

            // Muzzle Flash on Peer
            if (sp.isShooting) {
              ctx.fillStyle = '#fff488';
              ctx.shadowColor = '#ff9900';
              ctx.shadowBlur = 18;
              ctx.beginPath();
              ctx.arc(screenX + sprWidth * 0.25, sprTop + sprHeight * 0.55, 12, 0, Math.PI * 2);
              ctx.fill();
              ctx.shadowBlur = 0;
            }

            // Floating Speech Bubble over Peer in FPS
            if (sp.speech && typeof SpriteFactory !== 'undefined' && SpriteFactory.drawSpeechBubble) {
              SpriteFactory.drawSpeechBubble(ctx, screenX, barY - 26, sp.speech.text, sp.name, 1.0);
            }
          }
        }

        // Floating 3D Interaction Prompts for Lore & Traps
        if (anyStripeVisible) {
          const centerBufIdx = Math.floor(screenX / colStep);
          if (centerBufIdx >= 0 && centerBufIdx < numCols && zBuffer[centerBufIdx] >= perpDistWorld * 0.9) {
            if (sp.recorder && sp.recorder.inRange && !sp.recorder.isPlaying) {
              ctx.fillStyle = '#00ffaa';
              ctx.font = 'bold 9px "Share Tech Mono", monospace';
              ctx.textAlign = 'center';
              ctx.fillText('[ E ] ПРОСЛУШАТЬ ЗАПИСЬ', screenX, sprTop - 6);
            } else if (sp.note && sp.note.inRange) {
              ctx.fillStyle = '#ffd700';
              ctx.font = 'bold 9px "Share Tech Mono", monospace';
              ctx.textAlign = 'center';
              ctx.fillText('[ E ] ЧИТАТЬ ЗАПИСКУ', screenX, sprTop - 6);
            } else if (sp.box && sp.box.inRange && !sp.box.disabled) {
              ctx.fillStyle = '#ffaa00';
              ctx.font = 'bold 9px "Share Tech Mono", monospace';
              ctx.textAlign = 'center';
              ctx.fillText('[ ВЫСТРЕЛ / УДАР ] ОБЕСТОЧИТЬ', screenX, sprTop - 6);
            }
          }
        }

        // Health bar rendered only if sprite is visible
        if (anyStripeVisible && sp.type !== 'peer' && sp.hp !== undefined && sp.maxHp) {
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

      if (!isAimingAtEnemy && (this.isPvP || this.raidMode === 'PVP') && this.remotePlayers) {
        for (const rId in this.remotePlayers) {
          const rp = this.remotePlayers[rId];
          if (rp && rp.hp > 0) {
            const dx = rp.renderX - px;
            const dy = rp.renderY - py;
            const dist = Math.hypot(dx, dy);
            let ang = Math.atan2(dy, dx) - pAngle;
            while (ang < -Math.PI) ang += 2 * Math.PI;
            while (ang > Math.PI) ang -= 2 * Math.PI;
            if (Math.abs(ang) < 0.065 && dist < wallDistAtCenter) {
              isAimingAtEnemy = true;
              break;
            }
          }
        }
      }

      // Synchronize aim state to unified tactical crosshair
      this.mouse.isOverEnemy = isAimingAtEnemy;

      // --- VOLUMETRIC FLASHLIGHT BEAM & DUST PARTICLES ---
      ctx.save();
      const beamOriginX = Math.floor(w * 0.78);
      const beamOriginY = h + 10;
      const beamTargetX = Math.floor(w * 0.5);
      const beamTargetY = halfH;

      const beamGrad = ctx.createRadialGradient(beamTargetX, beamTargetY, 20, beamOriginX, beamOriginY, Math.hypot(w, h) * 0.75);
      beamGrad.addColorStop(0, 'rgba(220, 255, 205, 0.09)');
      beamGrad.addColorStop(0.32, 'rgba(175, 245, 185, 0.055)');
      beamGrad.addColorStop(0.68, 'rgba(110, 210, 145, 0.022)');
      beamGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = beamGrad;
      ctx.beginPath();
      ctx.moveTo(beamOriginX - 50, beamOriginY);
      ctx.lineTo(beamTargetX - 160, beamTargetY - 50);
      ctx.lineTo(beamTargetX + 160, beamTargetY - 50);
      ctx.lineTo(beamOriginX + 50, beamOriginY);
      ctx.closePath();
      ctx.fill();

      // Procedural Floating Dust Particles (28-35 particles)
      if (!this.fpsDustParticles) {
        this.fpsDustParticles = [];
        for (let pi = 0; pi < 32; pi++) {
          this.fpsDustParticles.push({
            x: Math.random() * w,
            y: Math.random() * h,
            vx: (Math.random() - 0.5) * 0.35,
            vy: -0.2 - Math.random() * 0.3,
            phase: Math.random() * Math.PI * 2,
            sz: Math.random() > 0.6 ? 2 : 1.2,
            baseAlpha: 0.25 + Math.random() * 0.55
          });
        }
      }

      for (let pi = 0; pi < this.fpsDustParticles.length; pi++) {
        const dp = this.fpsDustParticles[pi];
        dp.phase += 0.03;
        dp.x += dp.vx + Math.cos(dp.phase) * 0.25;
        dp.y += dp.vy + Math.sin(dp.phase * 0.8) * 0.2;

        if (dp.y < 0) dp.y = h;
        if (dp.y > h) dp.y = 0;
        if (dp.x < 0) dp.x = w;
        if (dp.x > w) dp.x = 0;

        const distToTarget = Math.hypot(dp.x - beamTargetX, dp.y - beamTargetY);
        const inBeamFactor = Math.max(0, 1.0 - distToTarget / (w * 0.45));
        if (inBeamFactor > 0.05) {
          const pAlpha = (dp.baseAlpha * inBeamFactor * (0.6 + Math.sin(dp.phase) * 0.4)).toFixed(2);
          ctx.fillStyle = `rgba(225, 255, 215, ${pAlpha})`;
          ctx.fillRect(dp.x, dp.y, dp.sz, dp.sz);
        }
      }
      ctx.restore();

      // 5. First-Person Weapon Model & Liquidator Hazmat Hands
      this.drawFPSWeapon(ctx, w, h);

      // 6. Particle Brass Shell Casings
      this.drawFPSCasings(ctx);

      // 7. Quick Melee Combat Boot Kick
      if (this.isKicking) {
        this.drawFPSKick(ctx, w, h);
      }

      ctx.restore(); // Restore Camera Roll transformation
    }

    /**
     * First-Person Weapon Rig with Liquidator Hazmat Hand & Procedural Bobbing & Recoil
     */
    drawFPSWeapon(ctx, w, h) {
      const bobX = Math.cos(this.bobTimer || 0) * 4;
      const bobY = Math.abs(Math.sin(this.bobTimer || 0)) * 6;

      const weapon = this.player.weapon || this.player.baseWeapon;
      const wId = (weapon && (weapon.id || weapon.type || weapon.gunType || weapon.name || '')).toLowerCase();
      const isShotgun = wId.includes('shotgun') || wId.includes('ks23') || wId.includes('saiga') || wId.includes('дробовик') || wId.includes('кс-23') || wId.includes('обрез');
      const isRifle = wId.includes('rifle') || wId.includes('ak') || wId.includes('flame') || wId.includes('auto') || wId.includes('автомат') || wId.includes('ак-74') || wId.includes('огнемет');
      const isPistol = wId.includes('pistol') || wId.includes('makarov') || wId.includes('gun') || wId.includes('пистолет') || wId.includes('пм');
      const isMelee = !weapon.isRanged && !isShotgun && !isRifle && !isPistol;

      ctx.save();

      // Melee Swing Motion (Sharp diagonal slash 180ms)
      if (isMelee) {
        const p = this.player.isSwinging ? (this.player.swingProgress || 0) : 0;
        const swingEase = Math.sin(p * Math.PI);
        const slashRot = -0.55 + swingEase * 1.35;
        const slashX = -swingEase * 130;
        const slashY = swingEase * 50;

        const armX = w * 0.65 + bobX + slashX;
        const armY = h * 0.88 + bobY + slashY;

        ctx.save();
        ctx.translate(armX, armY);
        ctx.rotate(slashRot);

        // Pipe body
        ctx.fillStyle = '#3c4c41';
        ctx.fillRect(-14, -165, 26, 190);
        // Metallic sheen highlight
        ctx.fillStyle = '#677f6f';
        ctx.fillRect(-8, -165, 8, 190);
        // Joint rings
        ctx.fillStyle = '#222d26';
        ctx.fillRect(-18, -145, 34, 12);
        ctx.fillRect(-18, -80, 34, 12);
        // Red industrial valve wheel
        ctx.fillStyle = '#d32f2f';
        ctx.beginPath();
        ctx.arc(0, -115, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1c241e';
        ctx.beginPath();
        ctx.arc(0, -115, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#d32f2f';
        ctx.fillRect(-3, -135, 6, 40);
        ctx.fillRect(-20, -118, 40, 6);

        // Liquidator Glove & Hazmat Sleeve
        // Rubber glove gripping handle
        ctx.fillStyle = '#232a26';
        ctx.beginPath();
        ctx.ellipse(0, 0, 22, 26, 0.1, 0, Math.PI * 2);
        ctx.fill();
        // Knuckle padding
        ctx.fillStyle = '#171c19';
        ctx.fillRect(-12, -8, 24, 8);

        // Forearm sleeve (Murky green hazmat OZK)
        ctx.fillStyle = '#324233';
        ctx.beginPath();
        ctx.moveTo(-24, 20);
        ctx.lineTo(34, 15);
        ctx.lineTo(55, 160);
        ctx.lineTo(-45, 160);
        ctx.closePath();
        ctx.fill();
        // Sleeve fold lines
        ctx.strokeStyle = '#1e2920';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-20, 50);
        ctx.lineTo(25, 45);
        ctx.moveTo(-15, 95);
        ctx.lineTo(35, 90);
        ctx.stroke();

        ctx.restore();

        // High-speed slash blur trail during attack
        if (this.player.isSwinging && p > 0.1 && p < 0.85) {
          ctx.strokeStyle = 'rgba(51, 255, 100, 0.45)';
          ctx.lineWidth = 14;
          ctx.beginPath();
          ctx.arc(w / 2 - 20, h / 2 + 30, 110, -0.8 + p * 1.5, 0.4 + p * 1.5);
          ctx.stroke();
        }
      } else if (wId.includes('rifle') || wId.includes('ak') || wId.includes('flame') || wId.includes('auto')) {
        // --- AK-74 / Flamethrower Assault Rig (Dual Hands, Slanted Muzzle Brake & Curved Mag) ---
        const isFlame = wId.includes('flame') || wId.includes('fire');
        const reloadDip = this.isReloading ? Math.sin((this.reloadProgress || 0) * Math.PI) * (h * 0.42) : 0;
        const recoil = this.player.isShooting ? Math.sin((this.player.shootProgress || 0) * Math.PI) * 26 : 0;
        const recoilRot = this.player.isShooting ? -Math.sin((this.player.shootProgress || 0) * Math.PI) * 0.12 : 0;

        const gunX = w / 2 + 55 + bobX;
        const gunY = h - 45 + bobY - recoil + reloadDip;

        ctx.save();
        ctx.translate(gunX, gunY);
        ctx.rotate(recoilRot);

        // Long barrel & receiver
        ctx.fillStyle = '#1c241e';
        ctx.fillRect(-22, -180, 28, 205);
        ctx.fillStyle = '#2a362e';
        ctx.fillRect(-17, -210, 18, 45);

        // Slanted Muzzle Brake / Flamethrower Nozzle
        if (isFlame) {
          ctx.fillStyle = '#b87333';
          ctx.fillRect(-24, -225, 32, 18);
          ctx.fillStyle = '#33aaff';
          ctx.beginPath();
          ctx.arc(-8, -230, 4 + Math.sin(Date.now() * 0.02) * 1.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = '#131b15';
          ctx.fillRect(-20, -222, 24, 15);
          ctx.fillStyle = '#445749';
          ctx.fillRect(-12, -226, 8, 4);
        }

        // Wood / Polymer Handguard
        ctx.fillStyle = isFlame ? '#2a3a30' : '#6b3a1d';
        ctx.fillRect(-24, -130, 32, 55);

        // Curved Magazine / Fuel canister
        ctx.fillStyle = isFlame ? '#992222' : '#8a4b22';
        ctx.beginPath();
        ctx.moveTo(-16, -45);
        ctx.quadraticCurveTo(-45, -15, -35, 35);
        ctx.lineTo(-18, 28);
        ctx.quadraticCurveTo(-28, -10, -10, -45);
        ctx.closePath();
        ctx.fill();

        // Left hand gripping handguard forward
        ctx.fillStyle = '#232a26';
        ctx.beginPath();
        ctx.ellipse(-14, -105, 16, 22, 0.2, 0, Math.PI * 2);
        ctx.fill();
        // Left sleeve
        ctx.fillStyle = '#324233';
        ctx.beginPath();
        ctx.moveTo(-28, -98);
        ctx.lineTo(-8, -92);
        ctx.lineTo(-75, 140);
        ctx.lineTo(-120, 140);
        ctx.closePath();
        ctx.fill();

        // Right hand on pistol grip & trigger
        ctx.fillStyle = '#232a26';
        ctx.beginPath();
        ctx.ellipse(6, 18, 18, 24, -0.15, 0, Math.PI * 2);
        ctx.fill();
        // Right sleeve
        ctx.fillStyle = '#324233';
        ctx.beginPath();
        ctx.moveTo(-8, 30);
        ctx.lineTo(24, 24);
        ctx.lineTo(75, 140);
        ctx.lineTo(25, 140);
        ctx.closePath();
        ctx.fill();

        // Muzzle Flash / Flamethrower Jet
        if (this.player.isShooting && (this.player.shootProgress || 0) < 0.4) {
          if (isFlame) {
            const fGrad = ctx.createRadialGradient(-8, -260, 10, -8, -260, 75);
            fGrad.addColorStop(0, '#ffffff');
            fGrad.addColorStop(0.3, '#ffcc00');
            fGrad.addColorStop(0.7, '#ff4400');
            fGrad.addColorStop(1, 'rgba(255, 40, 0, 0)');
            ctx.fillStyle = fGrad;
            ctx.beginPath();
            ctx.arc(-8, -260, 75, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillStyle = '#fff275';
            ctx.shadowColor = '#ffaa00';
            ctx.shadowBlur = 25;
            ctx.beginPath();
            ctx.arc(-8, -232, 18, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ff6600';
            ctx.beginPath();
            ctx.moveTo(-8, -270);
            ctx.lineTo(16, -225);
            ctx.lineTo(-32, -225);
            ctx.closePath();
            ctx.fill();
            ctx.shadowBlur = 0;
          }
        }

        ctx.restore();
      } else if (isShotgun) {
        // --- KS-23 Heavy Riot Shotgun (Dual Hands) ---
        const recoil = this.player.isShooting ? Math.sin((this.player.shootProgress || 0) * Math.PI) * 36 : 0;
        const recoilRot = this.player.isShooting ? -Math.sin((this.player.shootProgress || 0) * Math.PI) * 0.16 : 0;
        const pumpProg = (this.player.isShooting && this.player.shootProgress > 0.45 && this.player.shootProgress < 0.85)
          ? Math.sin((this.player.shootProgress - 0.45) / 0.4 * Math.PI) * 18 : 0;

        const reloadDip = this.isReloading ? Math.sin((this.reloadProgress || 0) * Math.PI) * (h * 0.42) : 0;
        const gunX = w / 2 + 50 + bobX;
        const gunY = h - 45 + bobY - recoil + reloadDip;

        ctx.save();
        ctx.translate(gunX, gunY);
        ctx.rotate(recoilRot);

        // Barrel & Receiver
        ctx.fillStyle = '#19221c';
        ctx.fillRect(-24, -160, 36, 185);
        ctx.fillStyle = '#2b3930';
        ctx.fillRect(-18, -195, 24, 55);
        // Brass bead sight
        ctx.fillStyle = '#ffd700';
        ctx.fillRect(-8, -198, 4, 4);

        // Ribbed wooden/bakelite pump forend (slides on pump action)
        const pumpY = -110 + pumpProg;
        ctx.fillStyle = '#5c351c';
        ctx.fillRect(-26, pumpY, 40, 42);
        for (let ry = pumpY + 5; ry < pumpY + 38; ry += 7) {
          ctx.fillStyle = '#3a2010';
          ctx.fillRect(-26, ry, 40, 2);
        }

        // Left Hand supporting pump forend
        ctx.fillStyle = '#232a26';
        ctx.beginPath();
        ctx.ellipse(-18, pumpY + 22, 16, 20, 0.3, 0, Math.PI * 2);
        ctx.fill();
        // Left Arm sleeve coming from bottom-left
        ctx.fillStyle = '#324233';
        ctx.beginPath();
        ctx.moveTo(-32, pumpY + 30);
        ctx.lineTo(-12, pumpY + 35);
        ctx.lineTo(-75, 140);
        ctx.lineTo(-120, 140);
        ctx.closePath();
        ctx.fill();

        // Right Hand on trigger & grip
        ctx.fillStyle = '#232a26';
        ctx.beginPath();
        ctx.ellipse(8, 20, 18, 24, -0.2, 0, Math.PI * 2);
        ctx.fill();
        // Right Arm sleeve coming from bottom-right
        ctx.fillStyle = '#324233';
        ctx.beginPath();
        ctx.moveTo(-6, 32);
        ctx.lineTo(26, 25);
        ctx.lineTo(75, 140);
        ctx.lineTo(25, 140);
        ctx.closePath();
        ctx.fill();

        // Ejected brass shell during racking
        if (pumpProg > 6) {
          ctx.fillStyle = '#ffd700';
          ctx.fillRect(28 + pumpProg * 1.5, -70 - pumpProg * 0.8, 14, 6);
        }

        // Muzzle blast fireball & sparks
        if (this.player.isShooting && (this.player.shootProgress || 0) < 0.32) {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(-6, -208, 16, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#ff9900';
          ctx.shadowColor = '#ff6600';
          ctx.shadowBlur = 28;
          ctx.beginPath();
          ctx.arc(-6, -214, 30, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#ff4400';
          ctx.beginPath();
          ctx.moveTo(-6, -255);
          ctx.lineTo(24, -195);
          ctx.lineTo(-36, -195);
          ctx.closePath();
          ctx.fill();
          ctx.shadowBlur = 0;

          // Flying sparks
          ctx.fillStyle = '#ffffff';
          for (let spk = 0; spk < 6; spk++) {
            const sx = -6 + (Math.random() - 0.5) * 55;
            const sy = -215 - Math.random() * 45;
            ctx.fillRect(sx, sy, 2.5, 2.5);
          }
        }

        ctx.restore();
      } else {
        // --- Makarov Pistol / Rifle (Right Hand Gripping) ---
        const recoil = this.player.isShooting ? Math.sin((this.player.shootProgress || 0) * Math.PI) * 22 : 0;
        const recoilRot = this.player.isShooting ? -Math.sin((this.player.shootProgress || 0) * Math.PI) * 0.18 : 0;

        const reloadDipPistol = this.isReloading ? Math.sin((this.reloadProgress || 0) * Math.PI) * (h * 0.42) : 0;
        const gunX = w / 2 + 60 + bobX;
        const gunY = h - 45 + bobY - recoil + reloadDipPistol;

        ctx.save();
        ctx.translate(gunX, gunY);
        ctx.rotate(recoilRot);

        // Blued steel slide & receiver
        ctx.fillStyle = '#1c2620';
        ctx.fillRect(-18, -125, 28, 135);
        ctx.fillStyle = '#2c3c32';
        ctx.fillRect(-13, -155, 18, 42);

        // Green phosphor tritium sights
        ctx.fillStyle = '#1fe044';
        ctx.shadowColor = '#1fe044';
        ctx.shadowBlur = 6;
        ctx.fillRect(-5, -158, 4, 4);
        ctx.shadowBlur = 0;

        // Textured Bakelite Grip
        ctx.fillStyle = '#5c2c1a';
        ctx.fillRect(-15, -15, 22, 45);

        // Right Hand holding pistol grip
        ctx.fillStyle = '#232a26';
        ctx.beginPath();
        ctx.ellipse(-2, 10, 18, 24, -0.15, 0, Math.PI * 2);
        ctx.fill();

        // Right Arm sleeve
        ctx.fillStyle = '#324233';
        ctx.beginPath();
        ctx.moveTo(-16, 25);
        ctx.lineTo(18, 18);
        ctx.lineTo(65, 140);
        ctx.lineTo(15, 140);
        ctx.closePath();
        ctx.fill();

        // Muzzle Flash
        if (this.player.isShooting && (this.player.shootProgress || 0) < 0.35) {
          ctx.fillStyle = '#fff488';
          ctx.shadowColor = '#ff9900';
          ctx.shadowBlur = 24;
          ctx.beginPath();
          ctx.arc(-4, -170, 20, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#ff6600';
          ctx.beginPath();
          ctx.moveTo(-4, -205);
          ctx.lineTo(16, -160);
          ctx.lineTo(-24, -160);
          ctx.closePath();
          ctx.fill();
          ctx.shadowBlur = 0;
        }

        ctx.restore();
      }

      ctx.restore();
    }

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


    /**
     * Active Quest Tracker Banner (Positioned high at top, persists even when HUD is hidden)
     */
    drawActiveQuestBanner(ctx, w, h) {
      // Find active NPC quest on this floor
      let activeQuest = null;
      let activeNPC = null;
      for (const n of (this.npcs || [])) {
        if (n.quest && !n.quest.turnedIn) {
          activeQuest = n.quest;
          activeNPC = n;
          break;
        }
      }
      if (!activeQuest) return;

      const q = activeQuest;
      const isDone = q.completed;
      const progStr = q.targetKills ? `(${q.currentKills || 0}/${q.targetKills})` : (q.requiresKeycard ? (this.player.hasKeycard ? '[КАРТА НАЙДЕНА]' : '[ИЩИТЕ КАРТУ]') : '');
      const text = isDone ? `🏆 КВЕСТ ВЫПОЛНЕН: ${q.title}! ВЕРНИТЕСЬ К ${activeNPC.name}! [E]` : `📜 КВЕСТ: ${q.title} — ${q.desc || ''} ${progStr}`;

      ctx.save();
      ctx.font = 'bold 11px "Share Tech Mono", monospace';
      const textW = ctx.measureText(text).width;
      const barW = Math.min(w - 32, Math.max(340, textW + 36));
      const barH = 26;
      const barX = (w - barW) / 2;
      const barY = 12; // Raised high at the top!

      // Glowing cyber-frame
      ctx.fillStyle = isDone ? 'rgba(0, 32, 16, 0.94)' : 'rgba(4, 18, 9, 0.92)';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.strokeStyle = isDone ? '#00ffaa' : '#ffd700';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(barX, barY, barW, barH);

      // Left accent badge
      ctx.fillStyle = isDone ? '#00ffaa' : '#ffd700';
      ctx.fillRect(barX + 2, barY + 2, 4, barH - 4);

      // Text
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isDone ? '#00ffaa' : '#ffd700';
      ctx.fillText(text, w / 2, barY + barH / 2);

      ctx.restore();
    }

    /**
     * NPC Dialogue & Quest Modal (Raised higher up, persists even when HUD is hidden)
     */
    drawNPCDialogModal(ctx, w, h) {
      if (!this.activeDialog || !this.activeDialog.npc) return;
      const npc = this.activeDialog.npc;
      const dw = Math.min(560, w * 0.92);
      const dh = 180;
      const dx = (w - dw) / 2;
      const dy = Math.max(42, Math.floor(h * 0.08)); // Positioned just below quest tracker banner

      ctx.save();
      ctx.fillStyle = 'rgba(4, 18, 9, 0.96)';
      ctx.fillRect(dx, dy, dw, dh);
      ctx.strokeStyle = '#00ffaa';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(dx, dy, dw, dh);

      // Header bar
      ctx.fillStyle = 'rgba(0, 255, 170, 0.18)';
      ctx.fillRect(dx + 2, dy + 2, dw - 4, 26);
      ctx.font = 'bold 13px "Share Tech Mono", monospace';
      ctx.fillStyle = '#00ffaa';
      ctx.textAlign = 'left';
      ctx.fillText(`[ СВЯЗЬ ] ${npc.name} // ${npc.role || 'Ликвидатор'}`, dx + 14, dy + 19);

      // Dialogue speech (Word wrapped)
      ctx.font = '12px monospace';
      ctx.fillStyle = '#d0ebd4';
      const words = (npc.dialogue || '').split(' ');
      let line = '';
      let lineY = dy + 50;
      for (let wi = 0; wi < words.length; wi++) {
        const testLine = line + words[wi] + ' ';
        if (ctx.measureText(testLine).width > dw - 28) {
          ctx.fillText(line, dx + 14, lineY);
          line = words[wi] + ' ';
          lineY += 17;
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line, dx + 14, lineY);

      // Quest status & action button
      if (npc.quest) {
        const q = npc.quest;
        const statusY = dy + 128;
        ctx.fillStyle = q.completed ? '#00ffaa' : '#ffd700';
        ctx.font = 'bold 12px "Share Tech Mono", monospace';
        const progStr = q.targetKills ? `(${q.currentKills || 0}/${q.targetKills})` : (q.requiresKeycard ? (this.player.hasKeycard ? '[ЕСТЬ КАРТА]' : '[ИЩИТЕ КАРТУ]') : '');
        ctx.fillText(`📜 ${q.title}: ${q.desc || ''} ${progStr}`, dx + 14, statusY);

        ctx.fillStyle = q.turnedIn ? '#666666' : q.completed ? '#00ffaa' : '#ffd700';
        ctx.fillText(q.turnedIn ? '✅ ЗАДАНИЕ ЗАВЕРШЕНО' : q.completed ? '[ E / КЛИК ] СДАТЬ ЗАДАНИЕ И ПОЛУЧИТЬ НАГРАДУ!' : '[ E / КЛИК ] ПРИНЯТО К ИСПОЛНЕНИЮ', dx + 14, dy + 158);
      }

      ctx.restore();
    }

    /**
     * Floating Quick Chat Input Box
     */
    drawQuickChat(ctx, w, h) {
      const cw = Math.min(520, w * 0.88);
      const ch = 38;
      const cx = (w - cw) / 2;
      const cy = h - 140;
      ctx.save();
      ctx.fillStyle = 'rgba(4, 18, 8, 0.94)';
      ctx.fillRect(cx, cy, cw, ch);
      ctx.strokeStyle = '#00ffaa';
      ctx.lineWidth = 2;
      ctx.strokeRect(cx, cy, cw, ch);
      ctx.font = 'bold 13px "Share Tech Mono", monospace';
      ctx.fillStyle = '#00ffaa';
      ctx.textAlign = 'left';
      ctx.fillText(`[T] ЧАТ: ${this.chatInput}_`, cx + 12, cy + 24);
      ctx.restore();
    }

    drawRadarHUD(ctx, w, h) {
      ctx.save();
      const cx = w / 2;
      const cy = h / 2;

      // 0. Player Damage Red Vignette Reaction
      if (this.playerDamageVignette > 0.01) {
        const vGrad = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.45, cx, cy, Math.max(w, h) * 0.82);
        vGrad.addColorStop(0, 'rgba(255, 0, 0, 0)');
        vGrad.addColorStop(0.7, `rgba(180, 0, 0, ${(this.playerDamageVignette * 0.45).toFixed(2)})`);
        vGrad.addColorStop(1, `rgba(220, 10, 10, ${(this.playerDamageVignette * 0.85).toFixed(2)})`);
        ctx.fillStyle = vGrad;
        ctx.fillRect(0, 0, w, h);
      }

      // --- PERSISTENT QUEST & DIALOG (Visible even when UI is hidden via [I]!) ---
      this.drawActiveQuestBanner(ctx, w, h);
      this.drawNPCDialogModal(ctx, w, h);
      if (this.isTypingChat) {
        this.drawQuickChat(ctx, w, h);
      }
      if (this.playerSpeech && typeof SpriteFactory !== 'undefined' && SpriteFactory.drawSpeechBubble) {
        const cam = this.getCameraOffset();
        const sx = (this.cameraMode === 'FPS') ? (w / 2) : (this.player.x - cam.x);
        const sy = (this.cameraMode === 'FPS') ? (h * 0.38) : (this.player.y - cam.y - 34);
        SpriteFactory.drawSpeechBubble(ctx, sx, sy, this.playerSpeech.text, 'Вы', 1.0);
      }

      // If HUD is hidden via [I] (Cinematic immersion mode - Quest banner & dialog remain active!)
      if (this.isHUDHidden) {
        // Draw a neat restore UI pill in the top-right corner
        const pillW = 160;
        const pillH = 28;
        const pillX = w - pillW - 16;
        const pillY = 14;
        ctx.fillStyle = 'rgba(4, 20, 7, 0.92)';
        ctx.fillRect(pillX, pillY, pillW, pillH);
        ctx.strokeStyle = '#00ffaa';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(pillX, pillY, pillW, pillH);
        ctx.font = 'bold 11px "Share Tech Mono", monospace';
        ctx.fillStyle = '#00ffaa';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('👁️ ПОКАЗАТЬ UI [I]', pillX + pillW / 2, pillY + pillH / 2);

        ctx.restore();
        return;
      }

      
      // 1. Top-Left Status Panel (РАДАР-ДЕТЕКТОР РУ-4) - Fixed 280px width, no overlap
      // Blue Electric Shock Flash Reaction
      if (this.blueDamageFlash > 0) {
        const bfAlpha = (this.blueDamageFlash / 12) * 0.45;
        ctx.fillStyle = `rgba(0, 220, 255, ${bfAlpha.toFixed(2)})`;
        ctx.fillRect(0, 0, w, h);
        this.blueDamageFlash--;
      }

      // Risk vs Reward Loot HUD in Top Right
      const rhW = 208;
      const rhX = w - rhW - 16;
      const rhY = 56;
      const rhH = 74;

      const targetTalons = (this.player.talonsEarned || 0);
      if (this.lootDisplayTalons === undefined) this.lootDisplayTalons = targetTalons;
      if (this.lootDisplayTalons < targetTalons) {
        this.lootDisplayTalons = Math.min(targetTalons, this.lootDisplayTalons + Math.ceil((targetTalons - this.lootDisplayTalons) * 0.15) + 1);
        this.lootFlashTimer = 15;
      }
      const isFlashing = (this.lootFlashTimer > 0);
      if (this.lootFlashTimer > 0) this.lootFlashTimer--;

      ctx.fillStyle = isFlashing ? 'rgba(30, 25, 5, 0.94)' : 'rgba(2, 14, 5, 0.92)';
      ctx.fillRect(rhX, rhY, rhW, rhH);
      ctx.strokeStyle = isFlashing ? '#ffd700' : '#1fe044';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(rhX, rhY, rhW, rhH);

      ctx.fillStyle = isFlashing ? 'rgba(255, 215, 0, 0.2)' : 'rgba(31, 224, 68, 0.16)';
      ctx.fillRect(rhX + 1, rhY + 1, rhW - 2, 18);
      ctx.font = 'bold 10px "Share Tech Mono", monospace';
      ctx.fillStyle = isFlashing ? '#ffd700' : '#1fe044';
      ctx.textAlign = 'left';
      ctx.fillText('┌─[ ХАБАР В РЮКЗАКЕ ]', rhX + 8, rhY + 13);

      ctx.font = 'bold 10px "Share Tech Mono", monospace';
      ctx.fillStyle = isFlashing ? '#ffffff' : '#ffd700';
      ctx.fillText(`💰 ТАЛОНЫ: +${this.lootDisplayTalons} Т.`, rhX + 12, rhY + 34);

      const lootItems = (this.player.collectedLoot || []).length;
      ctx.fillStyle = '#00ffaa';
      ctx.fillText(`📦 РЕДКИЙ ЛУТ: ${lootItems} ПРЕДМЕТ${lootItems === 1 ? '' : (lootItems >= 2 && lootItems <= 4 ? 'А' : 'ОВ')}`, rhX + 12, rhY + 50);

      const multStr = (this.floorMultiplier && this.floorMultiplier > 1.0) ? `x${this.floorMultiplier.toFixed(1)}` : 'x1.0';
      ctx.fillStyle = (this.floorMultiplier && this.floorMultiplier > 1.0) ? '#ffaa00' : '#88a892';
      ctx.fillText(`⚡ МНОЖИТЕЛЬ ЭТАЖА: ${multStr}`, rhX + 12, rhY + 66);

      // Elevator Platform Tactical Choice Overlay
      if (this.isPlayerInElevator && !this.emergencySiegeActive && !this.isEvacuating) {
        const optW = 360;
        const optH = 54;
        const optX = cx - optW / 2;
        const optY = h - 165;

        ctx.fillStyle = 'rgba(2, 14, 8, 0.92)';
        ctx.fillRect(optX, optY, optW, optH);
        ctx.strokeStyle = '#00ffaa';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(optX, optY, optW, optH);

        ctx.textAlign = 'center';
        ctx.font = 'bold 10px "Share Tech Mono", monospace';
        ctx.fillStyle = '#ffd700';
        ctx.fillText('[ 1 ] ЭВАКУАЦИЯ В ЖИЛЯЧЕЙКУ (УДЕРЖИВАТЬ [E])', cx, optY + 20);

        const nextMult = ((this.currentRaidFloor || 1) + 1 >= 4 ? 3.0 : ((this.currentRaidFloor || 1) + 1 === 3 ? 2.0 : 1.5));
        ctx.fillStyle = '#00ffaa';
        ctx.fillText(`[ 2 ] СПУСК НА СЛЕДУЮЩИЙ ЭТАЖ (+1 // БОНУС x${nextMult.toFixed(1)})`, cx, optY + 40);
      }

      // Tentacle Entangled Struggle Prompt
      if ((this.fleshVents || []).some(t => t.entangled)) {
        ctx.fillStyle = 'rgba(40, 5, 20, 0.92)';
        ctx.fillRect(cx - 180, cy + 60, 360, 36);
        ctx.strokeStyle = '#ff0033';
        ctx.lineWidth = 2;
        ctx.strokeRect(cx - 180, cy + 60, 360, 36);

        ctx.textAlign = 'center';
        ctx.font = 'bold 12px "Share Tech Mono", monospace';
        ctx.fillStyle = '#ff3333';
        ctx.fillText('⚠️ ЩУПАЛЬЦА СХВАТИЛИ ВАС! [ ПРОБЕЛ / F ] ВЫРВАТЬСЯ!', cx, cy + 83);
      }

      // Tape Recorder Subtitle Display
      if (this.activeTapeSubtitle && this.activeTapeSubtitle.timer > 0) {
        this.activeTapeSubtitle.timer -= (1 / 60);
        const subW = Math.min(w - 32, 640);
        const subH = 46;
        const subX = cx - subW / 2;
        const subY = h - 90;

        ctx.fillStyle = 'rgba(4, 16, 8, 0.92)';
        ctx.fillRect(subX, subY, subW, subH);
        ctx.strokeStyle = '#00ffaa';
        ctx.lineWidth = 1;
        ctx.strokeRect(subX, subY, subW, subH);

        ctx.fillStyle = 'rgba(0, 255, 170, 0.12)';
        const scanY = subY + (this.tick % 44);
        ctx.fillRect(subX, scanY, subW, 2);

        ctx.textAlign = 'center';
        ctx.font = 'bold 11px "Share Tech Mono", monospace';
        ctx.fillStyle = '#00ffaa';
        ctx.fillText(this.activeTapeSubtitle.text, cx, subY + 26);
      }

      // Descent Multiplier Fullscreen Warning Banner
      if (this.descentBanner && this.descentBanner.timer > 0) {
        this.descentBanner.timer -= (1 / 60);
        const banW = Math.min(w - 40, 560);
        const banH = 92;
        const banX = (w - banW) / 2;
        const banY = (h - banH) / 2;

        ctx.fillStyle = 'rgba(10, 5, 0, 0.95)';
        ctx.fillRect(banX, banY, banW, banH);
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(banX, banY, banW, banH);

        ctx.fillStyle = '#ffd700';
        for (let s = banX + 4; s < banX + banW - 8; s += 16) {
          ctx.fillRect(s, banY + 2, 8, 4);
          ctx.fillRect(s, banY + banH - 6, 8, 4);
        }

        ctx.textAlign = 'center';
        ctx.font = 'bold 14px "Share Tech Mono", monospace';
        ctx.fillStyle = '#ffaa00';
        ctx.fillText('⚠️ ВЫ СДЕЛАЛИ ВЫБОР: СПУСК В ГЛУБИНУ!', cx, banY + 30);

        ctx.font = 'bold 12px "Share Tech Mono", monospace';
        ctx.fillStyle = '#ffd700';
        ctx.fillText(`МНОЖИТЕЛЬ ДОБЫЧИ x${this.descentBanner.mult.toFixed(1)} АКТИВИРОВАН!`, cx, banY + 52);

        ctx.font = 'bold 10px "Share Tech Mono", monospace';
        ctx.fillStyle = '#00ffaa';
        ctx.fillText('ВСЕ НАЙДЕННЫЕ ТАЛОНЫ И ОПЫТ УМНОЖАЮТСЯ!', cx, banY + 72);
      }

      // Wall Note Interactive Soviet Document Card Overlay
      if (this.activeWallNoteCard) {
        const cardW = Math.min(w - 32, 440);
        const cardH = 260;
        const cardX = cx - cardW / 2;
        const cardY = cy - cardH / 2;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillRect(0, 0, w, h);

        ctx.fillStyle = '#dfd3b6';
        ctx.fillRect(cardX, cardY, cardW, cardH);
        ctx.strokeStyle = '#6e5e43';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(cardX, cardY, cardW, cardH);

        ctx.fillStyle = '#4a3d2c';
        ctx.beginPath();
        ctx.arc(cx, cardY + 12, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.textAlign = 'center';
        ctx.font = 'bold 9px "Share Tech Mono", monospace';
        ctx.fillStyle = '#3a3324';
        ctx.fillText('СССР // ГИГАХРУЩ // СЛУЖБА БЕЗОПАСНОСТИ СЕКТОРА', cx, cardY + 32);

        ctx.font = 'bold 12px "Share Tech Mono", monospace';
        ctx.fillStyle = '#1c170d';
        ctx.fillText(this.activeWallNoteCard.title || 'СЛУЖЕБНАЯ ЗАПИСКА', cx, cardY + 54);

        ctx.strokeStyle = '#998767';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cardX + 24, cardY + 64);
        ctx.lineTo(cardX + cardW - 24, cardY + 64);
        ctx.stroke();

        ctx.textAlign = 'left';
        ctx.font = 'bold 10px "Share Tech Mono", monospace';
        ctx.fillStyle = '#524531';
        ctx.fillText(`КОМУ: ${this.activeWallNoteCard.header || 'ДЕЖУРНОМУ'}`, cardX + 24, cardY + 84);

        ctx.font = '11px "Share Tech Mono", monospace';
        ctx.fillStyle = '#1a160f';
        const words = (this.activeWallNoteCard.text || '').split(' ');
        let line = '';
        let lineY = cardY + 108;
        for (let wi = 0; wi < words.length; wi++) {
          const testLine = line + words[wi] + ' ';
          if (ctx.measureText(testLine).width > cardW - 52) {
            ctx.fillText(line, cardX + 24, lineY);
            line = words[wi] + ' ';
            lineY += 18;
          } else {
            line = testLine;
          }
        }
        ctx.fillText(line, cardX + 24, lineY);

        ctx.save();
        ctx.translate(cardX + cardW - 75, cardY + cardH - 55);
        ctx.rotate(-0.15);
        ctx.strokeStyle = 'rgba(180, 20, 20, 0.75)';
        ctx.lineWidth = 2;
        ctx.strokeRect(-45, -16, 90, 32);
        ctx.font = 'bold 8px "Share Tech Mono", monospace';
        ctx.fillStyle = 'rgba(180, 20, 20, 0.85)';
        ctx.textAlign = 'center';
        ctx.fillText(this.activeWallNoteCard.stamp || 'СЕКРЕТНО', 0, 4);
        ctx.restore();

        ctx.textAlign = 'center';
        ctx.font = 'bold 10px "Share Tech Mono", monospace';
        ctx.fillStyle = '#807054';
        ctx.fillText('[ E ] / [ ESC ] — ЗАКРЫТЬ ДОКУМЕНТ', cx, cardY + cardH - 14);
      }

      const tlX = 16;
      const tlY = 12;
      const tlW = 280;
      const tlH = 86;

      // Vertical Tactical Controls Sidebar along Right Edge (Positioned UNDER Loot HUD, no overlap!)
      if (!this.isTouchControlsActive && w > 580) {
        const sbW = 208;
        const sbX = w - sbW - 16;
        const sbY = 175; // Positioned cleanly below Loot HUD (56 + 74 = 130 + 45px padding)
        const sbH = 224;

        ctx.fillStyle = 'rgba(2, 14, 5, 0.92)';
        ctx.fillRect(sbX, sbY, sbW, sbH);
        ctx.strokeStyle = '#1fe044';
        ctx.lineWidth = 1;
        ctx.strokeRect(sbX, sbY, sbW, sbH);

        // Header Tab
        ctx.fillStyle = 'rgba(31, 224, 68, 0.16)';
        ctx.fillRect(sbX + 1, sbY + 1, sbW - 2, 20);
        ctx.font = 'bold 10px "Share Tech Mono", monospace';
        ctx.fillStyle = '#1fe044';
        ctx.textAlign = 'center';
        ctx.fillText('УПРАВЛЕНИЕ РЕЙДОМ', sbX + sbW / 2, sbY + 14);

        // Control key mappings list
        const camLabel = (this.cameraMode === 'FPS') ? '📷 [G] TDS 2D' : '📷 [G] FPS 3D';
        const hints = [
          { key: camLabel, desc: '' },
          { key: '[WASD]', desc: 'Движение' },
          { key: '[F]', desc: 'Пинок ногой' },
          { key: '[R]', desc: 'Перезарядка' },
          { key: '[1] / [2]', desc: 'Оружие' },
          { key: '[Q]', desc: 'Аптечка' },
          { key: '[I]', desc: 'Скрыть UI' },
          { key: '[3]', desc: 'Музыка' },
          { key: '[4]', desc: 'Звуки' }
        ];

        let rowY = sbY + 36;
        ctx.textAlign = 'left';
        for (const hint of hints) {
          ctx.font = 'bold 10px "Share Tech Mono", monospace';
          ctx.fillStyle = '#00ffaa';
          ctx.fillText(hint.key, sbX + 10, rowY);
          if (hint.desc) {
            ctx.font = '10px monospace';
            ctx.fillStyle = '#a4ffd9';
            ctx.fillText(hint.desc, sbX + 82, rowY);
          }
          rowY += 20;
        }
      }

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
      ctx.fillText('[Q] АПТЕЧКА', beltX + 370, beltY + 22);
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
