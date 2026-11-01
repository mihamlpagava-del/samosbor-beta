/**
 * ============================================================================
 * MODULE: radarRoguelike.js (Top-Down Radar Roguelike Engine)
 * ============================================================================
 * Samosbor Tactical Radar Exploration Mode:
 * - Procedural room & corridor generation with airtight doors ("Гермодвери").
 * - Autonomous AI entities (Liquidator Patrol, Mutant Slime, Wandering Civilian).
 * - Finite State Machine (IDLE_WANDER, PATROL, CHASE, ATTACK).
 * - Rotating radar sweep beam with phosphor decay trail.
 * - Dynamic overhead CRT health bars and bottom-right telemetry HUD.
 */

(function (global) {
  'use strict';

  class RadarRoguelikeEngine {
    constructor() {
      this.canvas = null;
      this.ctx = null;
      this.isRunning = false;
      this.tick = 0;
      this.radarAngle = 0;
      this.radarSpeed = 0.035;

      this.map = {
        width: 1400,
        height: 1000,
        tileSize: 32,
        rooms: [],
        doors: [],
        walls: []
      };

      this.player = {
        x: 200,
        y: 200,
        radius: 12,
        angle: 0,
        vx: 0,
        vy: 0,
        speed: 2.8,
        hp: 100,
        maxHp: 100,
        armor: 15,
        ammo: 30,
        maxAmmo: 30,
        talonsEarned: 0,
        type: 'player',
        isPlayer: true,
        damageFlashTimer: 0
      };

      this.entities = [];
      this.projectiles = [];
      this.particles = [];
      this.keys = {};
      this.mouse = { x: 0, y: 0, worldX: 0, worldY: 0, isDown: false };
      this.currentRoomName = 'Жилая ячейка №556';
      this.lastAttackTime = 0;

      this.onExitCallback = null;
    }

    init(canvasElement, onExit) {
      this.canvas = canvasElement;
      this.ctx = canvasElement.getContext('2d');
      this.onExitCallback = onExit;

      this.setupInputListeners();
      this.generateProceduralMap();
      this.spawnEntities();
      this.syncPlayerFromBase();
    }

    syncPlayerFromBase() {
      if (typeof clientMe !== 'undefined' && clientMe) {
        this.player.hp = clientMe.hp || 100;
        this.player.maxHp = clientMe.maxHp || 100;
        this.player.armor = (clientMe.stats && clientMe.stats.def) ? clientMe.stats.def : 12;
      }
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
          this.interactWithNearbyObject();
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

      this.canvas.addEventListener('mousemove', (e) => {
        if (!this.isRunning) return;
        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = e.clientX - rect.left;
        this.mouse.y = e.clientY - rect.top;
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

    start() {
      this.isRunning = true;
      this.syncPlayerFromBase();
      this.resizeCanvas();
      window.addEventListener('resize', () => this.resizeCanvas());
      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
    }

    stop() {
      this.isRunning = false;
    }

    resizeCanvas() {
      if (!this.canvas) return;
      this.canvas.width = this.canvas.parentElement ? this.canvas.parentElement.clientWidth : 960;
      this.canvas.height = this.canvas.parentElement ? this.canvas.parentElement.clientHeight : 640;
    }

    /**
     * Генерация процедурного лабиринта комнат, коридоров и гермодверей
     */
    generateProceduralMap() {
      this.map.rooms = [
        { id: 0, name: 'Жилая ячейка №556', x: 80, y: 80, w: 260, h: 220, isSafe: true },
        { id: 1, name: 'Коридор Блока П-46', x: 340, y: 150, w: 280, h: 90, isCorridor: true },
        { id: 2, name: 'Технический склад ГО', x: 620, y: 60, w: 280, h: 260 },
        { id: 3, name: 'Вентиляционный шурф №3', x: 220, y: 300, w: 90, h: 280, isCorridor: true },
        { id: 4, name: 'Отстойник едкой слизи', x: 120, y: 580, w: 340, h: 280, isDanger: true },
        { id: 5, name: 'Трансформаторная подстанция', x: 460, y: 440, w: 300, h: 240 },
        { id: 6, name: 'Центральный распределитель', x: 760, y: 380, w: 340, h: 260 },
        { id: 7, name: 'Шахта резервного лифта E4', x: 840, y: 680, w: 260, h: 220, isExit: true }
      ];

      // Позиционируем игрока в центре стартовой ячейки
      this.player.x = 210;
      this.player.y = 190;

      // Гермодвери между комнатами
      this.map.doors = [
        { x: 340, y: 175, w: 14, h: 44, isOpen: false, name: 'Гермошлюз №1' },
        { x: 620, y: 175, w: 14, h: 44, isOpen: false, name: 'Шлюз Склада ГО' },
        { x: 245, y: 300, w: 44, h: 14, isOpen: false, name: 'Шлюз Шурфа' },
        { x: 245, y: 580, w: 44, h: 14, isOpen: false, name: 'Люк Отстойника' },
        { x: 460, y: 530, w: 14, h: 44, isOpen: false, name: 'Шлюз Трансформаторной' },
        { x: 760, y: 500, w: 14, h: 44, isOpen: false, name: 'Шлюз Распределителя' },
        { x: 960, y: 680, w: 44, h: 14, isOpen: false, name: 'Бронедверь Лифта E4' }
      ];
    }

    /**
     * Создание сущностей AI (Ликвидаторы, Слизни, Жильцы)
     */
    spawnEntities() {
      this.entities = [];

      // 1. Патрульный Ликвидатор (Neutral / Friendly AI)
      this.entities.push({
        id: 'liq_1',
        type: 'liquidator',
        name: 'Патрульный Ликвидатор [Сержант Громов]',
        x: 480,
        y: 195,
        radius: 13,
        angle: 0,
        vx: 0,
        vy: 0,
        speed: 1.8,
        hp: 180,
        maxHp: 180,
        state: 'PATROL',
        waypoints: [
          { x: 480, y: 195 },
          { x: 720, y: 180 },
          { x: 720, y: 250 },
          { x: 500, y: 195 }
        ],
        curWaypoint: 0,
        stateTimer: 0,
        phosphorAlpha: 1.0,
        damageFlashTimer: 0
      });

      // 2. Второй Ликвидатор на нижнем уровне
      this.entities.push({
        id: 'liq_2',
        type: 'liquidator',
        name: 'Ликвидатор охраны [Рядовой Зимин]',
        x: 820,
        y: 480,
        radius: 13,
        angle: 0,
        vx: 0,
        vy: 0,
        speed: 1.7,
        hp: 160,
        maxHp: 160,
        state: 'PATROL',
        waypoints: [
          { x: 820, y: 480 },
          { x: 980, y: 520 },
          { x: 860, y: 600 }
        ],
        curWaypoint: 0,
        stateTimer: 0,
        phosphorAlpha: 1.0,
        damageFlashTimer: 0
      });

      // 3. Заблудший жилец (Civilian / Stalker)
      this.entities.push({
        id: 'civ_1',
        type: 'civilian',
        name: 'Заблудший жилец [Дядя Толя]',
        x: 740,
        y: 120,
        radius: 11,
        angle: 0,
        vx: 0,
        vy: 0,
        speed: 1.2,
        hp: 75,
        maxHp: 75,
        state: 'IDLE_WANDER',
        homeRoom: this.map.rooms[2],
        stateTimer: 0,
        phosphorAlpha: 0.9,
        damageFlashTimer: 0
      });

      // 4. Мутанты / Слизни (Hostile Wanderers)
      const slimeSpawns = [
        { x: 200, y: 700, hp: 110, name: 'Хлюп-Мутант Сливной Трубы' },
        { x: 320, y: 760, hp: 130, name: 'Членистоногий Клещ Самосбора' },
        { x: 620, y: 520, hp: 160, name: 'Биомасса Коллектора' },
        { x: 920, y: 780, hp: 220, name: 'Аномальный Слизень Шахты' }
      ];

      slimeSpawns.forEach((s, idx) => {
        this.entities.push({
          id: `mut_${idx}`,
          type: 'mutant_slime',
          name: s.name,
          x: s.x,
          y: s.y,
          radius: 14,
          angle: Math.random() * Math.PI * 2,
          vx: 0,
          vy: 0,
          speed: 1.6,
          hp: s.hp,
          maxHp: s.hp,
          state: 'IDLE_WANDER',
          stateTimer: 0,
          attackCooldown: 0,
          phosphorAlpha: 0.8,
          damageFlashTimer: 0
        });
      });
    }

    /**
     * Основной игровой цикл
     */
    loop() {
      if (!this.isRunning) return;
      this.tick++;

      this.updatePhysics();
      this.updateAI();
      this.render();

      requestAnimationFrame(this.loop);
    }

    /**
     * Обновление физики игрока, выстрелов и частиц
     */
    updatePhysics() {
      // 1. Движение игрока
      let dx = 0;
      let dy = 0;
      if (this.keys['KeyW'] || this.keys['ArrowUp'] || this.keys['w']) dy -= 1;
      if (this.keys['KeyS'] || this.keys['ArrowDown'] || this.keys['s']) dy += 1;
      if (this.keys['KeyA'] || this.keys['ArrowLeft'] || this.keys['a']) dx -= 1;
      if (this.keys['KeyD'] || this.keys['ArrowRight'] || this.keys['d']) dx += 1;

      if (dx !== 0 && dy !== 0) {
        dx *= 0.7071;
        dy *= 0.7071;
      }

      this.player.vx = dx * this.player.speed;
      this.player.vy = dy * this.player.speed;

      let nextX = this.player.x + this.player.vx;
      let nextY = this.player.y + this.player.vy;

      if (!this.checkWallCollision(nextX, this.player.y, this.player.radius)) {
        this.player.x = nextX;
      }
      if (!this.checkWallCollision(this.player.x, nextY, this.player.radius)) {
        this.player.y = nextY;
      }

      // Направление взгляда игрока (на курсор мыши)
      const cam = this.getCameraOffset();
      this.mouse.worldX = this.mouse.x + cam.x;
      this.mouse.worldY = this.mouse.y + cam.y;
      this.player.angle = Math.atan2(this.mouse.worldY - this.player.y, this.mouse.worldX - this.player.x);

      // Текущая комната игрока
      for (let r of this.map.rooms) {
        if (this.player.x >= r.x && this.player.x <= r.x + r.w && this.player.y >= r.y && this.player.y <= r.y + r.h) {
          this.currentRoomName = r.name;
          break;
        }
      }

      // Вращение луча радара
      this.radarAngle = (this.radarAngle + this.radarSpeed) % (Math.PI * 2);

      // 2. Обновление снарядов
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        let p = this.projectiles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life--;

        // Столкновение со стенами
        if (this.checkWallCollision(p.x, p.y, 3) || p.life <= 0) {
          this.spawnHitParticles(p.x, p.y, p.color || '#1fe044', 4);
          this.projectiles.splice(i, 1);
          continue;
        }

        // Попадание по врагам
        if (p.isPlayer) {
          for (let e of this.entities) {
            if (e.type === 'mutant_slime' && Math.hypot(p.x - e.x, p.y - e.y) < e.radius + 4) {
              e.hp -= p.dmg;
              e.damageFlashTimer = 6;
              e.state = 'CHASE'; // Слизень сразу агрится на выстрел
              this.spawnHitParticles(p.x, p.y, '#ff3b30', 8);
              this.projectiles.splice(i, 1);
              if (e.hp <= 0) {
                this.killEntity(e);
              }
              break;
            }
          }
        }
      }

      // 3. Обновление частиц
      for (let i = this.particles.length - 1; i >= 0; i--) {
        let pt = this.particles[i];
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.alpha -= 0.04;
        if (pt.alpha <= 0) {
          this.particles.splice(i, 1);
        }
      }

      // Таймер урона игрока
      if (this.player.damageFlashTimer > 0) this.player.damageFlashTimer--;
    }

    /**
     * Поведение AI сущностей (State Machine: IDLE_WANDER, PATROL, CHASE, ATTACK)
     */
    updateAI() {
      for (let e of this.entities) {
        if (e.damageFlashTimer > 0) e.damageFlashTimer--;

        // Затухание люминофора радара
        if (e.phosphorAlpha > 0.15) {
          e.phosphorAlpha -= 0.006;
        }

        // Проверка развертки луча радара
        let angToEntity = Math.atan2(e.y - this.player.y, e.x - this.player.x);
        if (angToEntity < 0) angToEntity += Math.PI * 2;
        let diff = Math.abs(angToEntity - this.radarAngle);
        if (diff < 0.15 || diff > Math.PI * 2 - 0.15) {
          e.phosphorAlpha = 1.0; // Луч прошел над сущностью — яркая засветка!
        }

        // --- ЛОГИКА МУТАНТА / СЛИЗНЯ ---
        if (e.type === 'mutant_slime') {
          let distToPlayer = Math.hypot(this.player.x - e.x, this.player.y - e.y);

          // Обнаружение игрока в радиусе видимости (или по шуму)
          if (distToPlayer < 240 && this.hasLineOfSight(e.x, e.y, this.player.x, this.player.y)) {
            e.state = 'CHASE';
          }

          if (e.state === 'CHASE') {
            e.angle = Math.atan2(this.player.y - e.y, this.player.x - e.x);
            let spd = e.speed * 1.35;
            let nX = e.x + Math.cos(e.angle) * spd;
            let nY = e.y + Math.sin(e.angle) * spd;
            if (!this.checkWallCollision(nX, e.y, e.radius)) e.x = nX;
            if (!this.checkWallCollision(e.x, nY, e.radius)) e.y = nY;

            // Атака в ближнем бою
            if (distToPlayer < e.radius + this.player.radius + 6) {
              e.attackCooldown = (e.attackCooldown || 0) + 1;
              if (e.attackCooldown > 45) {
                e.attackCooldown = 0;
                let dmg = Math.max(4, 18 - Math.floor(this.player.armor / 3));
                this.player.hp = Math.max(0, this.player.hp - dmg);
                this.player.damageFlashTimer = 8;
                this.spawnHitParticles(this.player.x, this.player.y, '#ff3b30', 10);
                if (typeof playSound === 'function') playSound('hit_player');
              }
            }
          } else {
            // IDLE_WANDER: Блуждание в темных зонах
            e.stateTimer = (e.stateTimer || 0) - 1;
            if (e.stateTimer <= 0) {
              e.stateTimer = Math.floor(Math.random() * 80) + 40;
              e.angle = Math.random() * Math.PI * 2;
            }
            let spd = e.speed * 0.45;
            let nX = e.x + Math.cos(e.angle) * spd;
            let nY = e.y + Math.sin(e.angle) * spd;
            if (!this.checkWallCollision(nX, nY, e.radius)) {
              e.x = nX;
              e.y = nY;
            }
          }
        }

        // --- ЛОГИКА ПАТРУЛЬНОГО ЛИКВИДАТОРА ---
        if (e.type === 'liquidator') {
          // Поиск враждебных слизней в секторе обзора
          let targetSlime = null;
          let nearestDist = 320;
          for (let other of this.entities) {
            if (other.type === 'mutant_slime') {
              let d = Math.hypot(other.x - e.x, other.y - e.y);
              if (d < nearestDist && this.hasLineOfSight(e.x, e.y, other.x, other.y)) {
                nearestDist = d;
                targetSlime = other;
              }
            }
          }

          if (targetSlime) {
            // Атака мутанта из огнемета / карабина
            e.angle = Math.atan2(targetSlime.y - e.y, targetSlime.x - e.x);
            e.stateTimer = (e.stateTimer || 0) + 1;
            if (e.stateTimer > 40) {
              e.stateTimer = 0;
              this.fireProjectile(e.x, e.y, e.angle, 8, 22, '#00ffaa', false);
              this.spawnHitParticles(e.x, e.y, '#00ffaa', 3);
            }
          } else if (e.waypoints && e.waypoints.length > 0) {
            // PATROL: Движение по маршрутным точкам
            let wp = e.waypoints[e.curWaypoint];
            let dist = Math.hypot(wp.x - e.x, wp.y - e.y);
            if (dist < 15) {
              e.curWaypoint = (e.curWaypoint + 1) % e.waypoints.length;
            } else {
              e.angle = Math.atan2(wp.y - e.y, wp.x - e.x);
              let nX = e.x + Math.cos(e.angle) * e.speed;
              let nY = e.y + Math.sin(e.angle) * e.speed;
              if (!this.checkWallCollision(nX, e.y, e.radius)) e.x = nX;
              if (!this.checkWallCollision(e.x, nY, e.radius)) e.y = nY;
            }
          }
        }

        // --- ЛОГИКА ЗАБЛУДШЕГО ЖИЛЬЦА ---
        if (e.type === 'civilian') {
          // Проверяет близость слизней — если близко, бежит в страхе
          let threatNear = false;
          for (let other of this.entities) {
            if (other.type === 'mutant_slime' && Math.hypot(other.x - e.x, other.y - e.y) < 140) {
              threatNear = true;
              e.angle = Math.atan2(e.y - other.y, e.x - other.x); // Бежит от врага
              break;
            }
          }

          if (threatNear) {
            let nX = e.x + Math.cos(e.angle) * (e.speed * 1.5);
            let nY = e.y + Math.sin(e.angle) * (e.speed * 1.5);
            if (!this.checkWallCollision(nX, e.y, e.radius)) e.x = nX;
            if (!this.checkWallCollision(e.x, nY, e.radius)) e.y = nY;
          } else {
            // Медленное хождение по комнате
            e.stateTimer = (e.stateTimer || 0) - 1;
            if (e.stateTimer <= 0) {
              e.stateTimer = Math.floor(Math.random() * 100) + 50;
              e.angle = Math.random() * Math.PI * 2;
            }
            let nX = e.x + Math.cos(e.angle) * (e.speed * 0.4);
            let nY = e.y + Math.sin(e.angle) * (e.speed * 0.4);
            if (!this.checkWallCollision(nX, nY, e.radius)) {
              e.x = nX;
              e.y = nY;
            }
          }
        }
      }
    }

    /**
     * Выстрел игрока
     */
    playerShoot() {
      if (this.player.ammo <= 0) {
        if (typeof playSound === 'function') playSound('click');
        return;
      }
      const now = Date.now();
      if (now - this.lastAttackTime < 240) return;
      this.lastAttackTime = now;

      this.player.ammo--;
      this.fireProjectile(this.player.x, this.player.y, this.player.angle, 12, 35, '#1fe044', true);
      this.spawnHitParticles(this.player.x + Math.cos(this.player.angle) * 14, this.player.y + Math.sin(this.player.angle) * 14, '#1fe044', 4);
      if (typeof playSound === 'function') playSound('hit_enemy');
    }

    fireProjectile(x, y, angle, speed, dmg, color, isPlayer) {
      this.projectiles.push({
        x: x + Math.cos(angle) * 14,
        y: y + Math.sin(angle) * 14,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 50,
        dmg: dmg,
        color: color,
        isPlayer: isPlayer
      });
    }

    reloadAmmo() {
      this.player.ammo = this.player.maxAmmo;
      if (typeof playSound === 'function') playSound('equip');
    }

    interactWithNearbyObject() {
      // Открытие / закрытие дверей
      for (let d of this.map.doors) {
        let dist = Math.hypot(this.player.x - (d.x + d.w / 2), this.player.y - (d.y + d.h / 2));
        if (dist < 45) {
          d.isOpen = !d.isOpen;
          if (typeof playSound === 'function') playSound('click');
          return;
        }
      }

      // Выход через шахту E4
      let exitRoom = this.map.rooms.find(r => r.isExit);
      if (exitRoom) {
        let distToExit = Math.hypot(this.player.x - (exitRoom.x + exitRoom.w / 2), this.player.y - (exitRoom.y + exitRoom.h / 2));
        if (distToExit < 60) {
          this.exitToCell(true);
        }
      }
    }

    killEntity(e) {
      const idx = this.entities.indexOf(e);
      if (idx !== -1) {
        this.entities.splice(idx, 1);
        this.spawnHitParticles(e.x, e.y, '#ff3b30', 25);
        this.player.talonsEarned += 45;
        if (typeof playSound === 'function') playSound('buy');
      }
    }

    spawnHitParticles(x, y, color, count) {
      for (let i = 0; i < count; i++) {
        let ang = Math.random() * Math.PI * 2;
        let spd = Math.random() * 3 + 1;
        this.particles.push({
          x: x,
          y: y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          color: color,
          alpha: 1.0,
          sz: Math.random() * 2.5 + 1.5
        });
      }
    }

    checkWallCollision(x, y, radius) {
      // Проверка границ комнат
      let insideAnyRoom = false;
      for (let r of this.map.rooms) {
        if (x >= r.x + radius && x <= r.x + r.w - radius && y >= r.y + radius && y <= r.y + r.h - radius) {
          insideAnyRoom = true;
          break;
        }
      }

      // Проверка закрытых гермодверей
      for (let d of this.map.doors) {
        if (!d.isOpen) {
          if (x >= d.x - radius && x <= d.x + d.w + radius && y >= d.y - radius && y <= d.y + d.h + radius) {
            return true;
          }
        } else {
          // Если дверь открыта, через нее можно проходить между комнатами
          if (x >= d.x - 2 && x <= d.x + d.w + 2 && y >= d.y - 2 && y <= d.y + d.h + 2) {
            return false;
          }
        }
      }

      return !insideAnyRoom;
    }

    hasLineOfSight(x1, y1, x2, y2) {
      let dist = Math.hypot(x2 - x1, y2 - y1);
      let steps = Math.ceil(dist / 20);
      for (let i = 1; i < steps; i++) {
        let cx = x1 + (x2 - x1) * (i / steps);
        let cy = y1 + (y2 - y1) * (i / steps);
        if (this.checkWallCollision(cx, cy, 2)) return false;
      }
      return true;
    }

    getCameraOffset() {
      return {
        x: Math.round(this.player.x - this.canvas.width / 2),
        y: Math.round(this.player.y - this.canvas.height / 2)
      };
    }

    /**
     * Отрисовка ЭЛТ-радарного экрана
     */
    render() {
      const ctx = this.ctx;
      const w = this.canvas.width;
      const h = this.canvas.height;
      const cam = this.getCameraOffset();

      // Очистка с эффектом фосфорного шлейфа
      ctx.fillStyle = '#010803';
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.translate(-cam.x, -cam.y);

      // 1. Отрисовка пола и стен комнат
      this.drawRoomsAndDoors(ctx);

      // 2. Вращающийся луч тактического радара
      this.drawRadarSweep(ctx);

      // 3. Частицы
      for (let pt of this.particles) {
        ctx.fillStyle = pt.color;
        ctx.globalAlpha = Math.max(0, pt.alpha);
        ctx.fillRect(pt.x, pt.y, pt.sz, pt.sz);
      }
      ctx.globalAlpha = 1.0;

      // 4. Снаряды
      for (let p of this.projectiles) {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }

      // 5. Сущности AI (Ликвидаторы, Слизни, Жильцы)
      for (let e of this.entities) {
        if (typeof SpriteFactory !== 'undefined') {
          SpriteFactory.drawEntity(ctx, e, this.tick);
        }
      }

      // 6. Игрок
      if (typeof SpriteFactory !== 'undefined') {
        SpriteFactory.drawEntity(ctx, this.player, this.tick);
      }

      ctx.restore();

      // 7. Пост-процессинг: Радарная сетка, шкалы и ЭЛТ-телеметрия
      this.drawRadarHUD(ctx, w, h);
    }

    drawRoomsAndDoors(ctx) {
      // Комнаты
      for (let r of this.map.rooms) {
        // Пол
        ctx.fillStyle = r.isDanger ? 'rgba(30, 6, 6, 0.75)' : (r.isSafe ? 'rgba(5, 25, 12, 0.75)' : 'rgba(3, 16, 8, 0.75)');
        ctx.fillRect(r.x, r.y, r.w, r.h);

        // Контур стен
        ctx.strokeStyle = r.isDanger ? '#ff3b30' : '#1fe044';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(r.x, r.y, r.w, r.h);

        // Название комнаты в стиле терминала
        ctx.fillStyle = r.isDanger ? 'rgba(255, 60, 50, 0.55)' : 'rgba(31, 224, 68, 0.45)';
        ctx.font = '10px monospace';
        ctx.fillText(`[ ${r.name.toUpperCase()} ]`, r.x + 8, r.y + 16);
      }

      // Гермодвери
      for (let d of this.map.doors) {
        ctx.fillStyle = d.isOpen ? 'rgba(31, 224, 68, 0.3)' : '#ffaa00';
        ctx.fillRect(d.x, d.y, d.w, d.h);
        ctx.strokeStyle = d.isOpen ? '#1fe044' : '#ff5500';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(d.x, d.y, d.w, d.h);

        if (!d.isOpen) {
          ctx.fillStyle = '#000';
          ctx.fillRect(d.x + 2, d.y + 2, d.w - 4, d.h - 4);
        }
      }
    }

    drawRadarSweep(ctx) {
      const px = this.player.x;
      const py = this.player.y;
      const sweepRadius = 380;

      ctx.save();
      const grad = ctx.createRadialGradient(px, py, 10, px, py, sweepRadius);
      grad.addColorStop(0, 'rgba(31, 224, 68, 0.18)');
      grad.addColorStop(1, 'rgba(31, 224, 68, 0.0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.arc(px, py, sweepRadius, this.radarAngle - 0.45, this.radarAngle);
      ctx.closePath();
      ctx.fill();

      // Сам луч сканирования
      ctx.strokeStyle = '#1fe044';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(this.radarAngle) * sweepRadius, py + Math.sin(this.radarAngle) * sweepRadius);
      ctx.stroke();

      ctx.restore();
    }

    /**
     * ЭЛТ Телеметрия игрока и радарная сетка (Bottom-Right HUD)
     */
    drawRadarHUD(ctx, w, h) {
      ctx.save();

      // Круговая сетка прицела вокруг игрока
      const cx = w / 2;
      const cy = h / 2;
      ctx.strokeStyle = 'rgba(31, 224, 68, 0.15)';
      ctx.lineWidth = 1;
      [80, 160, 240].forEach(rad => {
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.stroke();
      });

      // Перекрестье прицела
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy);
      ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10);
      ctx.stroke();

      // Нижняя правая панель телеметрии
      const hudW = 270;
      const hudH = 110;
      const hudX = w - hudW - 16;
      const hudY = h - hudH - 16;

      ctx.fillStyle = 'rgba(3, 16, 7, 0.9)';
      ctx.fillRect(hudX, hudY, hudW, hudH);
      ctx.strokeStyle = '#1fe044';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(hudX, hudY, hudW, hudH);

      // Заголовок телеметрии
      ctx.fillStyle = '#1fe044';
      ctx.font = 'bold 12px "Share Tech Mono", monospace';
      ctx.fillText(`РАДАР // ${this.currentRoomName.toUpperCase()}`, hudX + 10, hudY + 20);

      // Сегментированная шкала здоровья
      const hpPct = Math.max(0, this.player.hp / this.player.maxHp);
      const totalSegments = 10;
      const filledSegments = Math.round(hpPct * totalSegments);
      let segBar = '[';
      for (let s = 0; s < totalSegments; s++) {
        segBar += (s < filledSegments) ? '|' : ' ';
      }
      segBar += ']';

      ctx.font = '11.5px monospace';
      ctx.fillStyle = this.player.hp < 30 ? '#ff3b30' : '#1fe044';
      ctx.fillText(`HP: ${this.player.hp}/${this.player.maxHp}  ${segBar}`, hudX + 10, hudY + 42);

      // Броня и боезапас
      ctx.fillStyle = '#88ffaa';
      ctx.fillText(`БРОНЯ: ${this.player.armor} DEF | ТАЛОНЫ: +${this.player.talonsEarned}`, hudX + 10, hudY + 64);

      // Боезапас
      ctx.fillStyle = this.player.ammo <= 5 ? '#ffaa00' : '#00ffff';
      ctx.fillText(`БОЕКОМПЛЕКТ: ${this.player.ammo}/${this.player.maxAmmo} [ЛКМ - ОГОНЬ, R - ПЕРЕЗАРЯДКА]`, hudX + 10, hudY + 86);

      // Верхняя статусная строка управления
      ctx.fillStyle = 'rgba(4, 20, 10, 0.85)';
      ctx.fillRect(16, 16, 320, 48);
      ctx.strokeStyle = '#1fe044';
      ctx.lineWidth = 1;
      ctx.strokeRect(16, 16, 320, 48);

      ctx.fillStyle = '#1fe044';
      ctx.font = '11px monospace';
      ctx.fillText(`[WASD] ДВИЖЕНИЕ  [МЫШЬ] ПРИЦЕЛ`, 24, 34);
      ctx.fillText(`[E/ПРОБЕЛ] ДВЕРИ  [ESC] В ЖИЛЯЧЕЙКУ`, 24, 52);

      ctx.restore();
    }

    exitToCell(completed = false) {
      this.stop();
      if (this.player.talonsEarned > 0 && typeof clientMe !== 'undefined' && clientMe) {
        clientMe.talons = (clientMe.talons || 0) + this.player.talonsEarned;
        if (typeof socket !== 'undefined' && socket) {
          socket.emit('terminalError', `ТАКТИЧЕСКИЙ РЕЙД ЗАВЕРШЕН! Получено: +${this.player.talonsEarned} талонов.`);
        }
      }
      if (typeof this.onExitCallback === 'function') {
        this.onExitCallback(completed);
      }
    }
  }

  global.RadarRoguelikeEngine = RadarRoguelikeEngine;
})(typeof window !== 'undefined' ? window : this);

