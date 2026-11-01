/**
 * ============================================================================
 * MODULE: levelGen.js (Procedural Floor Generator for Samosbor Radar Roguelike)
 * ============================================================================
 * Grid-based dungeon generator:
 * - 40x40 grid (tileSize = 32px => 1280x1280 world)
 * - 6-8 interconnected rectangular rooms with 1-2 tile wide corridors
 * - Safe player spawn ("Жилая ячейка №556")
 * - Distant elevator shaft extraction zone ("Шахта Лифта // Эвакуация")
 * - Supply crates, concentrate rations, and firearm drops (PM, Shotgun, AK-74)
 * - 33 Diverse procedural monster archetypes (from character spritesheet)
 * - Wall lanterns ("Фонари") with warm amber illumination in rooms & corridors
 * - Patrol Liquidators (союзники)
 * - Airtight blast doors ("Гермодвери")
 */

(function (global) {
  'use strict';

  const LevelGen = {
    GRID_WIDTH: 40,
    GRID_HEIGHT: 40,
    TILE_SIZE: 32,

    TILE_FLOOR: 0,
    TILE_WALL: 1,
    TILE_DOOR: 2,
    TILE_ELEVATOR: 3,

    ROOM_NAMES: [
      'Жилая ячейка №556',
      'Бойлерная узла 4',
      'Склад фильтров В-2',
      'Архив ликвидаторов',
      'Шлюзовая секция №9',
      'Канализационный отстойник',
      'Трансформаторная сектора Г',
      'Блок гидропоники Н-12'
    ],

    // 33 Monster archetypes catalog mapped directly to sliced sprite assets
    MONSTER_CATALOG: [
      // Common Tier (Swarmers, scavengers, basic mutated fauna)
      { id: 'mold_crawler', name: 'Плесень-ползун', tier: 'common', hp: 45, maxHp: 45, dmg: 12, speed: 2.3, radius: 12, behavior: 'wander_skitter', color: '#88ff44' },
      { id: 'slime_slug', name: 'Слизневик', tier: 'common', hp: 65, maxHp: 65, dmg: 16, speed: 1.5, radius: 14, behavior: 'acid_trail', color: '#66ff66' },
      { id: 'rust_parasite', name: 'Ржавый паразит', tier: 'common', hp: 50, maxHp: 50, dmg: 14, speed: 2.2, radius: 12, behavior: 'wander_skitter', color: '#ff7733' },
      { id: 'plague_rat', name: 'Чумная крыса', tier: 'common', hp: 35, maxHp: 35, dmg: 10, speed: 2.9, radius: 11, behavior: 'fast_chase', color: '#cc4444' },
      { id: 'samosbor_maggot', name: 'Личинка Самосбора', tier: 'common', hp: 55, maxHp: 55, dmg: 15, speed: 1.6, radius: 13, behavior: 'wriggle', color: '#ffeeaa' },
      { id: 'pipe_eater', name: 'Трубный трупоед', tier: 'common', hp: 70, maxHp: 70, dmg: 18, speed: 1.8, radius: 13, behavior: 'corridor_lurker', color: '#bb5555' },
      { id: 'mad_inmate', name: 'Обезумевший жилец', tier: 'common', hp: 60, maxHp: 60, dmg: 16, speed: 2.1, radius: 13, behavior: 'melee_rusher', color: '#ffaa55' },
      { id: 'cherveobrazniy_narost', name: 'Червеобразный нарост', tier: 'common', hp: 85, maxHp: 85, dmg: 22, speed: 0.8, radius: 15, behavior: 'acid_spurt', color: '#ff3344' },

      // Veteran Tier (Aggressive mutated humans, stalkers, spewers)
      { id: 'mad_liquidator', name: 'Обезумевший ликвидатор', tier: 'veteran', hp: 110, maxHp: 110, dmg: 24, speed: 1.9, radius: 14, behavior: 'patrol_melee', color: '#ffcc00' },
      { id: 'fog_drowner', name: 'Туманный утопленник', tier: 'veteran', hp: 85, maxHp: 85, dmg: 20, speed: 1.4, radius: 13, behavior: 'stealth_chase', color: '#33ddff' },
      { id: 'eyeless_guard', name: 'Безглазый конвоир', tier: 'veteran', hp: 130, maxHp: 130, dmg: 28, speed: 1.7, radius: 14, behavior: 'patrol_heavy', color: '#8888aa' },
      { id: 'myasnoy_kultist', name: 'Мясной культист', tier: 'veteran', hp: 95, maxHp: 95, dmg: 25, speed: 2.0, radius: 13, behavior: 'melee_rusher', color: '#cc2222' },
      { id: 'adept_chernobog', name: 'Адепт Чернобога', tier: 'veteran', hp: 105, maxHp: 105, dmg: 26, speed: 1.9, radius: 13, behavior: 'stealth_chase', color: '#9966cc' },
      { id: 'fog_hound', name: 'Гончая тумана', tier: 'veteran', hp: 80, maxHp: 80, dmg: 22, speed: 3.1, radius: 14, behavior: 'fast_chase', color: '#ee5533' },
      { id: 'mutated_welder', name: 'Мутировавший сварщик', tier: 'veteran', hp: 140, maxHp: 140, dmg: 30, speed: 1.6, radius: 14, behavior: 'fire_melee', color: '#ff9900' },
      { id: 'svinoryl', name: 'Свинорыл', tier: 'veteran', hp: 150, maxHp: 150, dmg: 32, speed: 2.2, radius: 15, behavior: 'charge_slam', color: '#dd7755' },
      { id: 'nekro_santehnik', name: 'Некро-сантехник', tier: 'veteran', hp: 120, maxHp: 120, dmg: 26, speed: 1.8, radius: 14, behavior: 'melee_rusher', color: '#55aa77' },
      { id: 'infected_liquidator', name: 'Зараженный ликвидатор', tier: 'veteran', hp: 125, maxHp: 125, dmg: 26, speed: 1.8, radius: 14, behavior: 'patrol_melee', color: '#eecc00' },
      { id: 'toksichniy_plevun', name: 'Токсичный плевун', tier: 'veteran', hp: 90, maxHp: 90, dmg: 24, speed: 1.5, radius: 14, behavior: 'ranged_spit', color: '#00ff66' },
      { id: 'twisted_deserter', name: 'Искаженный дезертир', tier: 'veteran', hp: 115, maxHp: 115, dmg: 25, speed: 2.0, radius: 13, behavior: 'ranged_burst', color: '#88aa55' },
      { id: 'filter_devourer', name: 'Пожиратель фильтров', tier: 'veteran', hp: 135, maxHp: 135, dmg: 24, speed: 2.2, radius: 14, behavior: 'filter_drain', color: '#558877' },

      // Elite Tier (Heavy tanks, mini-bosses, grotesque horrors)
      { id: 'rebar_spider', name: 'Паук-арматурщик', tier: 'elite', hp: 180, maxHp: 180, dmg: 35, speed: 2.7, radius: 18, behavior: 'leap_ambush', color: '#ff4422' },
      { id: 'armored_butcher', name: 'Бронированный мясник', tier: 'elite', hp: 230, maxHp: 230, dmg: 40, speed: 1.4, radius: 16, behavior: 'heavy_tank', color: '#cc3322' },
      { id: 'slime_hive', name: 'Ходячий улей слизи', tier: 'elite', hp: 260, maxHp: 260, dmg: 28, speed: 1.1, radius: 18, behavior: 'hive_spawn', color: '#66ee33' },
      { id: 'concrete_preacher', name: 'Проповедник бетона', tier: 'elite', hp: 175, maxHp: 175, dmg: 32, speed: 1.7, radius: 14, behavior: 'curse_aura', color: '#aa8866' },
      { id: 'amalgama_ploti', name: 'Амальгама плоти', tier: 'elite', hp: 250, maxHp: 250, dmg: 38, speed: 1.5, radius: 16, behavior: 'heavy_tank', color: '#dd4444' },
      { id: 'biomeh_strazh', name: 'Биомеханический страж', tier: 'elite', hp: 270, maxHp: 270, dmg: 38, speed: 1.6, radius: 16, behavior: 'armored_gunner', color: '#44aacc' },
      { id: 'shadow_samosbor', name: 'Тень Самосбора', tier: 'elite', hp: 140, maxHp: 140, dmg: 30, speed: 2.5, radius: 13, behavior: 'stealth_phantom', color: '#222233' },
      { id: 'conjoined_twins', name: 'Сросшиеся близнецы', tier: 'elite', hp: 190, maxHp: 190, dmg: 34, speed: 1.7, radius: 15, behavior: 'double_strike', color: '#cc8877' },

      // Boss Tier (Floor apex horrors)
      { id: 'giant_centipede', name: 'Гигантская сколопендра', tier: 'boss', hp: 480, maxHp: 480, dmg: 45, speed: 2.3, radius: 24, behavior: 'boss_charge', color: '#cc2244' },
      { id: 'cement_priest', name: 'Жрец кровавого цемента', tier: 'boss', hp: 550, maxHp: 550, dmg: 48, speed: 1.6, radius: 18, behavior: 'boss_curse', color: '#ee2222' },
      { id: 'flesh_architect', name: 'Архитектор плоти', tier: 'boss', hp: 680, maxHp: 680, dmg: 52, speed: 1.4, radius: 22, behavior: 'boss_summon', color: '#dd4466' },
      { id: 'fog_abomination', name: 'Истинный обитатель тумана', tier: 'boss', hp: 900, maxHp: 900, dmg: 60, speed: 1.5, radius: 28, behavior: 'boss_colossal', color: '#33ddaa' }
    ],

    /**
     * Generate complete procedural floor
     * @returns {Object} Map data
     */
    generate() {
      const W = this.GRID_WIDTH;
      const H = this.GRID_HEIGHT;
      const TS = this.TILE_SIZE;

      // 1. Initialize full solid wall grid
      const grid = [];
      for (let y = 0; y < H; y++) {
        const row = new Uint8Array(W);
        row.fill(this.TILE_WALL);
        grid.push(row);
      }

      // 2. Generate 6 to 8 rectangular rooms
      const numRooms = 6 + Math.floor(Math.random() * 3);
      const rooms = [];
      let roomNamesPool = [...this.ROOM_NAMES];

      for (let attempt = 0; attempt < 140 && rooms.length < numRooms; attempt++) {
        const rw = 5 + Math.floor(Math.random() * 4); // 5..8 tiles
        const rh = 4 + Math.floor(Math.random() * 4); // 4..7 tiles
        const rx = 2 + Math.floor(Math.random() * (W - rw - 4));
        const ry = 2 + Math.floor(Math.random() * (H - rh - 4));

        const newRoom = {
          id: rooms.length,
          name: roomNamesPool.length > 0 ? roomNamesPool.shift() : `Сектор ${rooms.length + 1}`,
          x: rx,
          y: ry,
          w: rw,
          h: rh,
          worldX: rx * TS,
          worldY: ry * TS,
          worldW: rw * TS,
          worldH: rh * TS,
          centerX: Math.floor(rx + rw / 2),
          centerY: Math.floor(ry + rh / 2)
        };

        // Check buffer distance
        let overlaps = false;
        for (const existing of rooms) {
          if (
            newRoom.x - 2 < existing.x + existing.w &&
            newRoom.x + newRoom.w + 2 > existing.x &&
            newRoom.y - 2 < existing.y + existing.h &&
            newRoom.y + newRoom.h + 2 > existing.y
          ) {
            overlaps = true;
            break;
          }
        }

        if (!overlaps) {
          rooms.push(newRoom);
          for (let y = newRoom.y; y < newRoom.y + newRoom.h; y++) {
            for (let x = newRoom.x; x < newRoom.x + newRoom.w; x++) {
              grid[y][x] = this.TILE_FLOOR;
            }
          }
        }
      }

      // 3. Connect rooms with corridors
      const doors = [];
      for (let i = 0; i < rooms.length - 1; i++) {
        this.connectRooms(grid, rooms[i], rooms[i + 1], doors);
      }
      if (rooms.length > 3) {
        this.connectRooms(grid, rooms[0], rooms[Math.floor(rooms.length / 2)], doors);
        this.connectRooms(grid, rooms[1], rooms[rooms.length - 1], doors);
      }

      // 4. Safe Spawn Room (Room 0)
      rooms[0].name = 'Жилая ячейка №556';
      rooms[0].isSafe = true;

      const playerSpawn = {
        x: rooms[0].centerX * TS + TS / 2,
        y: rooms[0].centerY * TS + TS / 2
      };

      // 5. Extraction Elevator in furthest room
      let maxDist = -1;
      let elevatorRoom = rooms[rooms.length - 1];
      for (let i = 1; i < rooms.length; i++) {
        const d = Math.hypot(rooms[i].centerX - rooms[0].centerX, rooms[i].centerY - rooms[0].centerY);
        if (d > maxDist) {
          maxDist = d;
          elevatorRoom = rooms[i];
        }
      }
      elevatorRoom.isElevator = true;
      elevatorRoom.name = 'Шахта Лифта // Эвакуация';

      const elevator = {
        x: elevatorRoom.centerX * TS,
        y: elevatorRoom.centerY * TS,
        tileX: elevatorRoom.centerX,
        tileY: elevatorRoom.centerY,
        w: TS,
        h: TS
      };
      grid[elevatorRoom.centerY][elevatorRoom.centerX] = this.TILE_ELEVATOR;

      // 6. Loot Crates (Ammo, Food, Medical, Tech)
      const lootCrates = [];
      const numCrates = 8 + Math.floor(Math.random() * 5); // 8..12
      const CRATE_TYPES = ['ammo', 'ration', 'med', 'tech'];

      for (let c = 0; c < numCrates; c++) {
        const room = rooms[Math.floor(Math.random() * rooms.length)];
        const cx = room.x + 1 + Math.floor(Math.random() * (room.w - 2));
        const cy = room.y + 1 + Math.floor(Math.random() * (room.h - 2));

        if (grid[cy][cx] === this.TILE_FLOOR && !(cx === rooms[0].centerX && cy === rooms[0].centerY)) {
          const cType = CRATE_TYPES[Math.floor(Math.random() * CRATE_TYPES.length)];
          let name = 'Патроны 7.62 мм';
          let amount = 24;
          if (cType === 'ration') { name = 'Паёк концентрата'; amount = 35; }
          else if (cType === 'med') { name = 'Аптечка первой помощи'; amount = 45; }
          else if (cType === 'tech') { name = 'Технические талоны'; amount = 50; }

          lootCrates.push({
            id: c,
            x: cx * TS + TS / 2,
            y: cy * TS + TS / 2,
            tileX: cx,
            tileY: cy,
            radius: 12,
            type: cType,
            amount: amount,
            name: name,
            opened: false,
            phosphorAlpha: 0.15
          });
        }
      }

      // 7. Firearm Weapon Drops in rooms (2-4 guns on floor)
      const weaponDrops = [];
      const GUN_TYPES = [
        { id: 'pm_gun', name: 'Пистолет Макарова', dmg: 32, ammo: 16, type: 'pistol', icon: 'pm' },
        { id: 'shotgun', name: 'Дробовик КС-23', dmg: 68, ammo: 10, type: 'shotgun', icon: 'shotgun' },
        { id: 'ak_carbine', name: 'Автомат АК-74У', dmg: 38, ammo: 30, type: 'rifle', icon: 'ak' }
      ];
      const eligibleGunRooms = rooms.slice(1);
      const numGuns = 2 + Math.floor(Math.random() * 3); // 2..4
      for (let g = 0; g < numGuns; g++) {
        const room = eligibleGunRooms[Math.floor(Math.random() * eligibleGunRooms.length)];
        const gx = room.x + 1 + Math.floor(Math.random() * (room.w - 2));
        const gy = room.y + 1 + Math.floor(Math.random() * (room.h - 2));

        if (grid[gy][gx] === this.TILE_FLOOR) {
          const gunTemplate = GUN_TYPES[Math.floor(Math.random() * GUN_TYPES.length)];
          weaponDrops.push({
            id: `drop_gun_${g}`,
            x: gx * TS + TS / 2,
            y: gy * TS + TS / 2,
            radius: 12,
            name: gunTemplate.name,
            gunId: gunTemplate.id,
            dmg: gunTemplate.dmg,
            ammo: gunTemplate.ammo,
            maxAmmo: gunTemplate.ammo,
            gunType: gunTemplate.type,
            pickedUp: false,
            phosphorAlpha: 0.2
          });
        }
      }

      // 8. Wall Lanterns ("Фонари") with warm amber lighting along walls
      const lamps = [];
      for (const room of rooms) {
        // Place lanterns along room walls (North, South, East, West)
        const lampStep = 3;
        for (let x = room.x; x < room.x + room.w; x += lampStep) {
          if (room.y > 0 && grid[room.y - 1][x] === this.TILE_WALL) {
            lamps.push({
              id: `lamp_${lamps.length}`,
              tileX: x,
              tileY: room.y,
              x: x * TS + TS / 2,
              y: room.y * TS + 6,
              wallSide: 'top',
              radius: 95,
              color: '#ffaa33',
              seed: Math.random() * 100
            });
          }
          if (room.y + room.h < H && grid[room.y + room.h][x] === this.TILE_WALL) {
            lamps.push({
              id: `lamp_${lamps.length}`,
              tileX: x,
              tileY: room.y + room.h - 1,
              x: x * TS + TS / 2,
              y: (room.y + room.h) * TS - 6,
              wallSide: 'bottom',
              radius: 95,
              color: '#ffaa33',
              seed: Math.random() * 100
            });
          }
        }
      }

      // 9. Diverse Monster Spawns from 33 Monster Catalog
      const mutantSpawns = [];
      const numMutants = 9 + Math.floor(Math.random() * 5); // 9..13 entities
      const commonPool = this.MONSTER_CATALOG.filter(m => m.tier === 'common');
      const veteranPool = this.MONSTER_CATALOG.filter(m => m.tier === 'veteran');
      const elitePool = this.MONSTER_CATALOG.filter(m => m.tier === 'elite');
      const bossPool = this.MONSTER_CATALOG.filter(m => m.tier === 'boss');

      const nonSafeRooms = rooms.filter(r => !r.isSafe);

      for (let m = 0; m < numMutants; m++) {
        const room = nonSafeRooms[Math.floor(Math.random() * nonSafeRooms.length)];
        const mx = room.x + 1 + Math.floor(Math.random() * (room.w - 2));
        const my = room.y + 1 + Math.floor(Math.random() * (room.h - 2));

        // Determine tier based on room distance and random roll
        const isElevatorRoom = room.isElevator;
        let selected = null;

        if (isElevatorRoom && m === 0) {
          // Elevator room gets an apex boss!
          selected = bossPool[Math.floor(Math.random() * bossPool.length)];
        } else {
          const roll = Math.random();
          if (roll < 0.50) selected = commonPool[Math.floor(Math.random() * commonPool.length)];
          else if (roll < 0.85) selected = veteranPool[Math.floor(Math.random() * veteranPool.length)];
          else selected = elitePool[Math.floor(Math.random() * elitePool.length)];
        }

        mutantSpawns.push({
          x: mx * TS + TS / 2,
          y: my * TS + TS / 2,
          homeRoomId: room.id,
          monsterId: selected.id,
          archetype: selected.id,
          name: selected.name,
          tier: selected.tier,
          hp: selected.hp,
          maxHp: selected.maxHp,
          dmg: selected.dmg,
          speed: selected.speed,
          radius: selected.radius,
          behavior: selected.behavior,
          color: selected.color,
          sprite: `assets/radar/entities/${selected.id}.png`
        });
      }

      // 10. Patrol Liquidators (2 Allies in starting adjacent rooms)
      const patrolSpawns = [];
      const patrolRooms = rooms.slice(1, 3);
      patrolRooms.forEach((r, idx) => {
        patrolSpawns.push({
          x: r.centerX * TS + TS / 2,
          y: r.centerY * TS + TS / 2,
          homeRoomId: r.id,
          hp: 120,
          maxHp: 120,
          speed: 1.8
        });
      });

      return {
        grid,
        width: W,
        height: H,
        tileSize: TS,
        rooms,
        doors,
        playerSpawn,
        elevator,
        lootCrates,
        weaponDrops,
        mutantSpawns,
        patrolSpawns,
        lamps
      };
    },

    connectRooms(grid, roomA, roomB, doors) {
      const x1 = roomA.centerX;
      const y1 = roomA.centerY;
      const x2 = roomB.centerX;
      const y2 = roomB.centerY;

      if (Math.random() < 0.5) {
        this.carveHCorridor(grid, x1, x2, y1);
        this.carveVCorridor(grid, y1, y2, x2);
      } else {
        this.carveVCorridor(grid, y1, y2, x1);
        this.carveHCorridor(grid, x1, x2, y2);
      }

      this.tryPlaceDoor(grid, roomA, doors);
      this.tryPlaceDoor(grid, roomB, doors);
    },

    carveHCorridor(grid, x1, x2, y) {
      const minX = Math.min(x1, x2);
      const maxX = Math.max(x1, x2);
      for (let x = minX; x <= maxX; x++) {
        grid[y][x] = this.TILE_FLOOR;
        if (y + 1 < this.GRID_HEIGHT - 2 && (x % 3 === 0)) {
          grid[y + 1][x] = this.TILE_FLOOR;
        }
      }
    },

    carveVCorridor(grid, y1, y2, x) {
      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);
      for (let y = minY; y <= maxY; y++) {
        grid[y][x] = this.TILE_FLOOR;
        if (x + 1 < this.GRID_WIDTH - 2 && (y % 3 === 0)) {
          grid[y][x + 1] = this.TILE_FLOOR;
        }
      }
    },

    tryPlaceDoor(grid, room, doors) {
      const TS = this.TILE_SIZE;
      const checks = [
        { x: room.centerX, y: room.y - 1 },
        { x: room.centerX, y: room.y + room.h },
        { x: room.x - 1, y: room.centerY },
        { x: room.x + room.w, y: room.centerY }
      ];

      for (const pt of checks) {
        if (pt.x >= 1 && pt.x < this.GRID_WIDTH - 1 && pt.y >= 1 && pt.y < this.GRID_HEIGHT - 1) {
          if (grid[pt.y][pt.x] === this.TILE_FLOOR) {
            doors.push({
              x: pt.x * TS,
              y: pt.y * TS,
              tileX: pt.x,
              tileY: pt.y,
              w: TS,
              h: TS,
              isOpen: false,
              name: 'Гермодверь ГД-4'
            });
            break;
          }
        }
      }
    }
  };

  global.LevelGen = LevelGen;
})(typeof window !== 'undefined' ? window : this);
